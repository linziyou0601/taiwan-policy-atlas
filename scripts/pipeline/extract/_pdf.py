"""抽取階段共用的片段：公報頁面的渲染與嵌入影像的位置。

render 把一份公報的頁面渲染成 PNG，整頁渲染時一併寫出該頁的文字層；units 以影像的位置把政見欄的影像對到參選者。

指令：
  由同階段的 render 與 units 呼叫。

手寫輸入：
  沒有。

產物：
  {輸出目錄}/page-{頁碼}.png、page-{頁碼}.txt   render 的頁面與文字層，頁碼從 1 起算。`--clip` 的輸出是 page-{頁碼}-{x0}-{y0}.png，不寫文字層

慣例：
  - `--clip` 以 pt 指定範圍，左上為原點，與 `extract units` 素材 images.tsv 的位置相同。
  - 影像代碼與這個階段的產物相同，是「p頁碼-嵌入順序」，可以直接登錄到選舉定義的 images。
"""

import pypdfium2
from pypdf.generic import ContentStream

from ..common import PipelineError, relative, require

# ==================================================
# 集中設定
# ==================================================

# 渲染的預設倍率（每 pt 的像素），整頁看得出版面與各欄位置
RENDER_SCALE = 2


# ==================================================
# render
# ==================================================


def render_pages(path, directory, scale, pages, clip=None):
    """把一份公報的頁面渲染成 PNG，整頁渲染時一併寫出文字層。

    參數：
        path：公報 PDF 的路徑。
        directory：輸出目錄，不存在時建立。
        scale：每 pt 的像素數。
        pages：要渲染的頁碼串列，空串列時渲染每一頁。
        clip：只渲染的範圍 `(x0, y0, x1, y1)`，單位 pt，左上為原點，與 images.tsv 的位置相同。None 時渲染整頁。
    回傳：每頁一行的說明：頁碼、像素寬高與檔案。
    例外：PipelineError，PDF 不存在或無法開啟、頁碼超出頁數或範圍超出頁面。
    """
    # 路徑寫錯時回報找不到的位置，不讓 PDFium 丟出系統錯誤
    require(path, label="公報")
    # PDFium 開啟整份 PDF，之後逐頁渲染
    try:
        document = pypdfium2.PdfDocument(path)
    # 打不開的檔案以 PipelineError 回報，訊息帶出路徑
    except pypdfium2.PdfiumError as error:
        raise PipelineError(f"{relative(path)} 無法開啟：{error}") from error
    # 頁數用來核對頁碼，輸出目錄先建好
    total = len(document)
    directory.mkdir(parents=True, exist_ok=True)
    lines = []
    # 頁碼從 1 起算，與影像代碼的頁碼相同
    for number in pages or range(1, total + 1):
        # 超出頁數的頁碼是輸入錯誤
        if not 1 <= number <= total:
            raise PipelineError(f"{relative(path)} 只有 {total} 頁，沒有第 {number} 頁")
        # 頁面尺寸以 pt 計，換算範圍時使用
        page = document[number - 1]
        width, height = page.get_size()
        # 整頁不裁切，檔名只帶頁碼
        crop, name = (0, 0, 0, 0), f"page-{number}.png"
        # 指定範圍時換算成 PDFium 從左、下、右、上四邊裁掉的寬度，檔名加上範圍的左上角
        if clip:
            x0, y0, x1, y1 = clip
            # 範圍要在頁面之內，而且有面積
            if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                raise PipelineError(
                    f"範圍 {clip} 超出第 {number} 頁的 {width:g}x{height:g} pt"
                )
            crop = (x0, height - y1, width - x1, y0)
            # 同一頁的不同範圍以左上角區別
            name = f"page-{number}-{x0:g}-{y0:g}.png"
        # 頁面依倍率轉成影像
        picture = page.render(scale=scale, crop=crop).to_pil()
        target = directory / name
        picture.save(target)
        # 整頁渲染時寫出文字層，轉錄者以它為起點對照渲染圖
        if not clip:
            text = page.get_textpage().get_text_range()
            (directory / f"page-{number}.txt").write_text(text, encoding="utf-8")
        # 說明列出像素寬高，裁切時依此換算座標
        lines.append(f"p{number}\t{picture.width}x{picture.height}\t{relative(target)}")
    return lines


# ==================================================
# 影像的位置
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
    # page.images 的順序就是影像代碼的嵌入順序，keys() 列出名稱而不解碼影像
    order = {
        str(key).lstrip("/"): index for index, key in enumerate(page.images.keys())
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
        # Q 還原上一個階段的繪圖狀態
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
