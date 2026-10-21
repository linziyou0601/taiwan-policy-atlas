"""收錄輔助：中選會選舉公報的嵌入影像預覽與政見格偵測。

讀取選舉設定 documents 列出的每份公報，images 子指令把每張嵌入影像縮小為預覽，cells 子指令依「政見」標籤找出每位參選者的政見格，列出落在格內的嵌入影像代碼，並把格內的文字層整理成轉錄草稿。編碼者依這兩份產出填寫選舉設定的 images 與轉錄稿。

指令：
  `.venv/bin/python .claude/skills/policy-curation/scripts/bulletin.py {images|cells} --election <代碼>`，先執行管線的 fetch。

慣例：
  - 產出寫入 `.cache/curation/{選舉}/{文件}/`，不納入 git：預覽位於 previews/，政見格的清單是 cells.tsv，草稿位於 drafts/{號次}.txt。
  - 影像代碼與抽取層相同，是「p頁碼-嵌入順序」，可以直接登錄到設定的 images。
  - 草稿只是起點：標題、條目與段落各占一行，排版折行合併為一行，全形字旁的空白刪除，重複繪製的粗體只保留一份。編碼者對照頁面確認後才寫入轉錄稿。
  - 政見格的範圍以公報版面推算：「政見」標籤往左右各延伸 CELL_HALF_WIDTH，往下延伸到下一列的「號次」，最後一列依列距推算，並停在頁尾宣導、投開票所名單或選舉公告之上。版面不同的公報（例如整份掃描）偵測不到標籤，改用預覽。
"""

import argparse
import re
import sys
from pathlib import Path

# 本檔位於 .claude/skills/policy-curation/scripts/，往上四層是 repo 根目錄，管線套件從那裡匯入
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from pypdf.generic import ContentStream  # noqa: E402

from pipeline.adapters.cec_bulletin import image_code, png_ready, read_pdf  # noqa: E402
from pipeline.common import (  # noqa: E402
    CACHE_ROOT,
    PipelineError,
    election_config,
    log,
    relative,
)
from pipeline.extract import manifest_sources  # noqa: E402
from pipeline.fetch import cached_path  # noqa: E402
from pipeline.tables import EMPTY, MULTI_SEPARATOR, write_table  # noqa: E402

# ==================================================
# 集中設定
# ==================================================

# 產出的根目錄
OUT_DIR = CACHE_ROOT / "curation"

# 政見格清單的表頭
CELL_HEADER = ["號次", "頁", "影像", "草稿"]

# 處理的來源 adapter：只有中選會公報有這種版面
ADAPTER = "cec-bulletin"

# 預覽縮圖的最長邊（像素），能辨認是政見欄、相片還是廣告即可
PREVIEW_SIZE = 1200

# 政見格以「政見」標籤的中心往左右各延伸的寬度（pt）
CELL_HALF_WIDTH = 259

# 標籤中心相對標籤起點的位移（pt）
LABEL_CENTER = 12

# 同一位置重複繪製的字（假粗體）視為一份的距離（pt）
FAKE_BOLD_GAP = 1.5

# 同一行的字，基線相差在這個距離內（pt）
LINE_GAP = 2.5

# 「政見」標籤拆成「政」「見」兩段時，「見」在「政」右方這個距離內（pt）
SPLIT_LABEL_GAP = 20

# 同一欄的兩個「政見」標籤至少相隔這個距離（pt），更近的是格內的字
LABEL_MIN_GAP = 100

# 上一行的字數達到全格最長一行的這個比例，才視為排版折行，與下一行合併
WRAP_RATIO = 0.85

# 影像大半落在格內、寬度超過格寬一半，才視為這格的政見影像，左欄的相片不符合條件。格內沒有這種影像時，蓋住大半格的影像也算
IMAGE_INSIDE = 0.6
IMAGE_WIDTH = 0.5

# 頁尾宣導、投開票所名單與選舉公告的關鍵字，都不屬於任何一格
END_WORDS = ("反賄選", "檢舉賄選", "投開票", "應行注意事項")

# 條目的開頭：編號或項目符號開頭的行是新條目，不與上一行合併
ITEM = re.compile(
    r"^(?:[一二三四五六七八九十]+[、：:，,]|\d+[\.、．]|[●★■◆▪•☆◎【]|第[一二三四五六七八九十]+|（[一二三四五六七八九十\d]+）|\([一二三四五六七八九十\d]+\)|[①-⑳]|[A-Za-z]\.)"
)

# 全形字與全形標點，旁邊的空白是排版空白
CJK = r"[　-〿一-鿿＀-￯「」『』（）《》、，。：；！？]"


# ==================================================
# 文件
# ==================================================


def bulletins(election_id):
    """列出選舉設定中來自中選會公報的文件。

    參數：
        election_id：選舉代碼。
    回傳：每份文件的 `(文件設定, pypdf.PdfReader)`，依設定的順序。
    例外：PipelineError，抓取層產物不存在或公報無法解析。
    """
    _, _, sources = manifest_sources(election_id)
    found = []
    # 依設定的順序逐份讀取，與抽取的順序相同
    for document in election_config(election_id).get("documents", []):
        source = sources[document["source"]]
        # 其他來源沒有公報版面
        if source["adapter"] != ADAPTER:
            continue
        # 封存檔的位置記錄在抓取層的 manifest
        _, reader = read_pdf(cached_path(source), source["name_encoding"], document)
        found.append((document, reader))
    return found


# ==================================================
# images
# ==================================================


def write_previews(reader, directory):
    """把一份公報的每張嵌入影像縮小為預覽圖。

    參數：
        reader：公報的 pypdf.PdfReader。
        directory：輸出目錄，不存在時建立。
    回傳：每張影像一行的說明：代碼、原始寬高與預覽檔。
    """
    directory.mkdir(parents=True, exist_ok=True)
    lines = []
    # 頁碼與嵌入順序的編號方式與抽取層相同，代碼可以直接登錄到設定
    for number, page in enumerate(reader.pages, start=1):
        # 每張嵌入影像都產生縮圖，檔名含原始寬高
        for index, embedded in enumerate(page.images):
            code = image_code(number, index)
            picture = png_ready(embedded.image)
            # 先記錄原始寬高，縮圖會改變影像的尺寸
            width, height = picture.size
            path = directory / f"{code}-{width}x{height}.png"
            # 縮小到能辨認內容的大小，說明列出原始寬高
            picture.thumbnail((PREVIEW_SIZE, PREVIEW_SIZE))
            picture.save(path)
            lines.append(f"{code}\t{width}x{height}\t{relative(path)}")
    return lines


# ==================================================
# cells
# ==================================================


def multiply(a, b):
    """兩個 PDF 變換矩陣相乘。

    參數：
        a、b：`[a, b, c, d, e, f]` 形式的矩陣，a 先作用。
    回傳：相乘後的矩陣。
    """
    return [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    ]


def placed_images(page, reader, height):
    """找出每張嵌入影像在頁面上的位置。

    參數：
        page：pypdf 的頁面。
        reader：公報的 pypdf.PdfReader。
        height：頁面高度，座標換算為由上往下。
    回傳：每張影像的 `(嵌入順序, x0, y0, x1, y1)`。
    """
    # page.images 的順序就是影像代碼的嵌入順序
    order = {
        embedded.name.rsplit(".", 1)[0]: index
        for index, embedded in enumerate(page.images)
    }
    objects = page["/Resources"].get("/XObject", {})
    # 繪圖狀態的堆疊，從單位矩陣開始
    stack = [[1, 0, 0, 1, 0, 0]]
    placed = []
    # 依繪製指令追蹤變換矩陣，影像繪製在單位方塊經矩陣變換後的位置
    for operands, operator in ContentStream(page.get_contents(), reader).operations:
        # q 儲存繪圖狀態
        if operator == b"q":
            stack.append(list(stack[-1]))
        # Q 還原上一層的繪圖狀態
        elif operator == b"Q":
            stack.pop()
        # cm 把一個變換與目前的矩陣相乘
        elif operator == b"cm":
            stack[-1] = multiply([float(value) for value in operands], stack[-1])
        # Do 繪製一個物件，影像依目前的矩陣定位
        elif operator == b"Do":
            name = str(operands[0])[1:]
            target = objects.get(operands[0])
            # 只計入影像，表單物件與未列在 page.images 的物件不計入
            if (
                target is None
                or target.get_object().get("/Subtype") != "/Image"
                or name not in order
            ):
                continue
            # 單位方塊的兩角經矩陣變換後是影像的範圍
            matrix = stack[-1]
            x0, x1 = sorted([matrix[4], matrix[4] + matrix[0]])
            y0, y1 = sorted([height - matrix[5], height - (matrix[5] + matrix[3])])
            # 記錄嵌入順序，與影像代碼對應
            placed.append((order[name], x0, y0, x1, y1))
    return placed


def text_parts(page, height):
    """擷取頁面文字層的每段字與位置，重複繪製的粗體只保留一份。

    參數：
        page：pypdf 的頁面。
        height：頁面高度，座標換算為由上往下。
    回傳：每段字的 `(y, x, 文字)`。
    """
    parts = []

    def visit(text, cm, tm, font, size):
        # 空白段落沒有內容
        if not text.strip():
            return
        # 文字矩陣再經 cm 變換是頁面座標
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        y = height - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
        parts.append((y, x, text))

    # pypdf 逐段回報文字與矩陣
    page.extract_text(visitor_text=visit)
    kept = []
    # 假粗體會在相近的位置重新繪製同一段字，只比對最近的段落
    for y, x, text in parts:
        # 位置相近的同一段字已經收錄
        if any(
            abs(y - ky) < FAKE_BOLD_GAP and abs(x - kx) < FAKE_BOLD_GAP and text == kt
            for ky, kx, kt in kept[-40:]
        ):
            continue
        kept.append((y, x, text))
    return kept


def draft_lines(parts):
    """把格內的字排列成行，排版折行合併到上一行。

    參數：
        parts：格內每段字的 `(y, x, 文字)`。
    回傳：草稿的每一行。
    """
    lines = {}
    # 基線相近的字歸入同一行
    for y, x, text in parts:
        # 尋找已有的相近基線，沒有時以這段字的基線新增一行
        key = next((key for key in lines if abs(key - y) <= LINE_GAP), y)
        lines.setdefault(key, []).append((x, text))
    rows = []
    # 每行依 x 排序後串接，刪除全形字旁的排版空白
    for key in sorted(lines):
        line = "".join(text for _, text in sorted(lines[key])).replace("\n", "")
        # 全形字後面與前面的半形與全形空白各刪除一次
        line = re.sub(rf"(?<={CJK})[ 　]+", "", line)
        rows.append(re.sub(rf"[ 　]+(?={CJK})", "", line).strip())
    # 整理後是空字串的行不保留
    rows = [row for row in rows if row]
    longest = max((len(row) for row in rows), default=0)
    # 全格最長的一行視為格寬
    merged = []
    previous = ""
    # 上一行排滿格寬才是排版折行，合併為一句；上一行較短表示原文在那裡斷行
    for row in rows:
        # 條目開頭的行一律另起一行
        if merged and not ITEM.match(row) and len(previous) >= WRAP_RATIO * longest:
            merged[-1] += row
        # 其餘情形另起一行
        else:
            merged.append(row)
        previous = row
    return merged


def label_positions(parts):
    """找出「政見」標籤的位置。

    標籤在文字層可能是一段「政見」，也可能拆成相鄰的「政」「見」兩段。
    參數：
        parts：text_parts 的結果。
    回傳：每個標籤的 `(y, x)`，依位置排序。
    """
    found = [(y, x) for y, x, text in parts if text.strip() == "政見"]
    # 拆成兩段時以「政」的位置當標籤起點
    seconds = [(y, x) for y, x, text in parts if text.strip() == "見"]
    found += [
        (y, x)
        for y, x, text in parts
        # 「政」的右方、同一行要有「見」
        if text.strip() == "政"
        and any(
            abs(sy - y) <= LINE_GAP and 0 < sx - x <= SPLIT_LABEL_GAP
            for sy, sx in seconds
        )
    ]
    labels = []
    # 由上而下保留標籤，同一欄緊接在已保留標籤下方的略過
    for y, x in sorted(found):
        if not any(
            0 <= y - ly < LABEL_MIN_GAP and abs(x - lx) < CELL_HALF_WIDTH
            for ly, lx in labels
        ):
            labels.append((y, x))
    return labels


def page_cells(page, reader, number, pitch=None):
    """找出一頁的每個政見格。

    參數：
        page：pypdf 的頁面。
        reader：公報的 pypdf.PdfReader。
        number：頁碼，從 1 起算。
        pitch：前面的頁量到的列距，這一頁只有一列時沿用。
    回傳：`(格, 列距)`。格是 {"number", "page", "top", "left", "images", "lines"}，number 是號次，無法讀取時是「p頁碼-標籤位置」，top 是格所在列的號次基線，left 是標籤的位置。
    """
    height = float(page.mediabox.height)
    parts = text_parts(page, height)
    placed = placed_images(page, reader, height)
    # 宣導、名單與公告的上緣
    ends = [y for y, _, text in parts if any(word in text for word in END_WORDS)]
    # 「政見」標籤的位置
    labels = label_positions(parts)
    rows = []
    # 號次標籤是一列的上緣，各欄的號次基線相同
    for y in sorted(y for y, _, text in parts if "號次" in text):
        # 與上一列相差在一行之內的號次屬於同一列
        if not rows or y - rows[-1] > LINE_GAP:
            rows.append(y)
    # 列距取前兩列的差，只有一列時沿用前面的頁
    pitch = rows[1] - rows[0] if len(rows) > 1 else pitch
    cells = []
    # 每個「政見」標籤是一格的上緣
    for label_y, label_x in labels:
        center = label_x + LABEL_CENTER
        x0, x1 = center - CELL_HALF_WIDTH, center + CELL_HALF_WIDTH
        # 下一列的號次是格的下緣
        below = [y for y in rows if y > label_y + 5]
        # 最後一列的格停在下方的宣導、名單、公告或頁底留白之上
        limits = [height - 40, *(y - 5 for y in ends if y > label_y)]
        tops = [y for y in rows if y < label_y]
        # 有列距時，最後一列的格不超過一個列距
        if pitch and tops:
            limits.append(tops[-1] + pitch - 5)
        bottom = below[0] - 5 if below else min(limits)
        # 格內的字
        inside = [
            (y, x, text)
            for y, x, text in parts
            if x0 <= x <= x1 and label_y + 6 < y < bottom
        ]
        # 號次是標籤左上方的一兩位數字
        numbers = [
            text.strip()
            for y, x, text in parts
            if re.fullmatch(r"\d{1,2}", text.strip())
            and label_y - 200 < y < label_y
            and x0 - 200 < x < x0
        ]
        images = []
        covering = []
        # 影像大半在格內而且夠寬才視為政見影像
        for index, ix0, iy0, ix1, iy1 in placed:
            # 影像與格的重疊範圍，以及重疊占影像與格的面積比例
            overlap_x = max(0, min(ix1, x1) - max(ix0, x0))
            overlap_y = max(0, min(iy1, bottom) - max(iy0, label_y))
            share = overlap_x * overlap_y / max((ix1 - ix0) * (iy1 - iy0), 1)
            cover = overlap_x * overlap_y / max((x1 - x0) * (bottom - label_y), 1)
            # 相片與左欄的影像不會同時滿足兩個條件
            if share > IMAGE_INSIDE and overlap_x > IMAGE_WIDTH * (x1 - x0):
                images.append(image_code(number, index))
            # 蓋住大半格的影像先記下，格內沒有政見影像時才採用
            elif cover > IMAGE_INSIDE:
                covering.append(image_code(number, index))
        images = images or covering
        # 無法讀取號次時以頁碼與標籤位置命名
        cells.append(
            {
                "number": numbers[0] if numbers else f"p{number}-{int(label_y)}",
                "page": number,
                # 同一列各格的標籤高度不一，分列以號次基線為準
                "top": tops[-1] if tops else label_y,
                "left": label_x,
                "images": images,
                "lines": draft_lines(inside),
            }
        )
    return cells, pitch


def assign_numbers(cells):
    """依版面順序排列政見格，讀到的號次不能用時依順序推定。

    公報依號次由左而右、由上而下排列政見格。
    參數：
        cells：一份公報每一頁的 page_cells 結果依頁序串接。
    回傳：`(依版面順序排列的格, 號次是否推定)`。
    """
    rows = []
    # 同一頁、號次基線相近的格屬於同一列
    for cell in sorted(cells, key=lambda c: (c["page"], c["top"])):
        head = rows[-1][0] if rows else None
        # 換頁或標籤低於這一列時另起一列
        if (
            not head
            or head["page"] != cell["page"]
            or cell["top"] - head["top"] > LINE_GAP
        ):
            rows.append([cell])
        # 其餘併入這一列
        else:
            rows[-1].append(cell)
    ordered = [cell for row in rows for cell in sorted(row, key=lambda c: c["left"])]
    numbers = [cell["number"] for cell in ordered]
    # 號次剛好是 1 到格數時沿用
    if sorted(numbers) == sorted(str(i) for i in range(1, len(numbers) + 1)):
        return ordered, False
    return [{**cell, "number": str(i)} for i, cell in enumerate(ordered, start=1)], True


def write_cells(reader, directory):
    """產生一份公報的政見格清單與轉錄草稿。

    參數：
        reader：公報的 pypdf.PdfReader。
        directory：輸出目錄，不存在時建立。
    回傳：每格一行的說明：號次、頁、格內影像、草稿行數與字數。
    """
    drafts = directory / "drafts"
    drafts.mkdir(parents=True, exist_ok=True)
    # 清單的列與回傳的說明逐格累積
    rows = []
    lines = []
    found = []
    pitch = None
    # 逐頁尋找政見格，列距帶到下一頁
    for number, page in enumerate(reader.pages, start=1):
        cells, pitch = page_cells(page, reader, number, pitch)
        found += cells
    cells, guessed = assign_numbers(found)
    # 推定的號次要對照頁面確認
    if guessed:
        lines.append("號次依版面順序推定，對照頁面確認")
    # 每格產生一份草稿，影像代碼列入清單
    for cell in cells:
        path = drafts / f"{cell['number']}.txt"
        path.write_text("\n".join(cell["lines"]) + "\n", encoding="utf-8")
        # 沒有影像的格寫 -，草稿就是文字層
        images = MULTI_SEPARATOR.join(cell["images"]) or EMPTY
        rows.append(
            {
                "號次": cell["number"],
                "頁": str(cell["page"]),
                "影像": images,
                "草稿": relative(path),
            }
        )
        lines.append(
            f"{cell['number']}\tp{cell['page']}\t{images}\t{len(cell['lines'])} 行 {sum(len(line) for line in cell['lines'])} 字"
        )
    # 清單與草稿位於同一個目錄
    write_table(directory / "cells.tsv", CELL_HEADER, rows)
    return lines


# ==================================================
# 指令
# ==================================================


def run(command, election_id):
    """對一場選舉的每份公報執行子指令。

    參數：
        command：images 或 cells。
        election_id：選舉代碼。
    回傳：摘要字串，每份文件一段。
    """
    output = []
    # 每份公報一段，標示文件代碼與輸出目錄
    for document, reader in bulletins(election_id):
        directory = OUT_DIR / election_id / document["id"]
        # images 產生預覽，cells 產生政見格清單與草稿
        lines = (
            write_previews(reader, directory / "previews")
            if command == "images"
            else write_cells(reader, directory)
        )
        output.append(
            f"{command}: {election_id} {document['id']} {len(lines)} 筆，產出位於 {relative(directory)}"
        )
        output.extend(lines)
    return "\n".join(output)


def main(argv):
    """執行指令。

    參數：
        argv：不含程式名稱的參數串列。
    回傳：結束代碼，0 為成功，1 為抓取層產物不存在或公報無法解析。
    """
    parser = argparse.ArgumentParser(description="公報的嵌入影像預覽與政見格偵測")
    # 子指令與選舉代碼
    parser.add_argument("command", choices=["images", "cells"])
    parser.add_argument("--election", required=True, help="選舉代碼")
    args = parser.parse_args(argv)
    # 不符規格的輸入以 PipelineError 回報
    try:
        print(run(args.command, args.election))
    # 訊息寫入標準錯誤，結束代碼 1 與管線相同
    except PipelineError as error:
        log(f"失敗：{error}", "bulletin")
        return 1
    return 0


# 直接執行本檔時執行指令
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
