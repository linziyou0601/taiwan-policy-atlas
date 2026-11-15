"""抽取階段的工具：依名冊把每個選區對到公報，寫出轉錄時讀取的素材。

讀取 `fetch list` 的公報清單與這個階段的名冊，把每個選區對到它的公報，解析公報的文字層與影像的位置，寫出每個選區一個目錄的轉錄素材。轉錄的輸出再由 `extract collect` 寫入 repo。步驟見 docs/pipeline/extract.md。

指令：
  `npm run pipeline -- extract units --election <代碼> --folders <類別>... [--fallback <類別>...] [--scopes <選區>...]`
  先執行 `fetch list` 取得公報清單，並執行 `extract run` 匯入名冊。

手寫輸入：
  沒有。讀取 .cache/pipeline/{來源代碼}/{民國年}.tsv 的公報清單與 data/20-extract/{選舉代碼}/roster.json。

產物：
  .cache/pipeline/{來源代碼}/parsed/{sha256}/        一份公報的解析結果：各頁的文字層 page-{頁}.txt 與影像的位置 images.tsv，每份公報只解析一次
  .cache/pipeline/{選舉代碼}/units/{選區代碼}/      一個選區的素材：名冊 roster.tsv、公報清單 docs.tsv，以及每份公報一個 doc{n}/

慣例：
  - 選區與公報依路徑對應：第二段含選區的縣市，第三段是指定的類別，其後各段含選區的鄉鎮，或以去掉字尾「鄉鎮市區」的鄉鎮名稱開頭。指定的類別沒有對到公報時改找 fallback 的類別。
"""

import re
import shutil

import pypdf

from ..adapters.cec_bulletin import PDF_LIMITS
from ..common import (
    CACHE_DIR,
    ROSTER_FILE,
    WORK_DIR,
    election_argument,
    election_config,
    layer_dir,
    read_json,
    require,
)
from ..fetch.list import LIST_HEADER, SOURCE, listing_path
from ..tables import EMPTY, read_table, write_table
from ._pdf import placed_images

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "依名冊把每個選區對到公報，寫出每個選區的轉錄素材"

# 選區公報清單的表頭，`extract collect` 依目錄欄找到轉錄者引用的公報
DOC_HEADER = ["目錄", "路徑", "sha256", "頁數"]

# 選區名冊與影像位置的表頭
ROSTER_HEADER = ["選區", "號次", "姓名", "推薦政黨"]
IMAGE_HEADER = ["代碼", "寬", "高", "x0", "y0", "x1", "y1"]

# 選區的公報清單檔名，寫在選區的素材目錄
DOC_FILE = "docs.tsv"

# 民國紀年加上這個數是西元年，網站的年度目錄以民國年命名
ROC_OFFSET = 1911

# 鄉鎮名稱的字尾，去掉後是路徑中常見的簡稱
TOWN_SUFFIX = re.compile(r"[鄉鎮市區]$")

# 路徑各段開頭的序號與括號，比對鄉鎮名稱前先去掉
SEGMENT_PREFIX = re.compile(r"^[【\[\d\s]+")


def unit_dir(election_id, scope):
    """一個選區的素材目錄。

    參數：
        election_id：選舉代碼。
        scope：選區代碼，不含選舉代碼。
    回傳：Path。
    """
    return WORK_DIR / election_id / "units" / scope


# ==================================================
# 選區與公報的對應
# ==================================================


def matching_documents(paths, county, town, folders):
    """找出屬於一個選區的公報。

    參數：
        paths：公報路徑的串列。
        county：縣市名稱，臺寫成「臺」。
        town：鄉鎮市區名稱。
        folders：類別目錄名稱的集合。
    回傳：符合的路徑，依路徑排序。
    """
    stem = TOWN_SUFFIX.sub("", town)
    found = []
    # 路徑的縣市一律寫成「臺」，與名冊的選區名稱一致
    for path in paths:
        parts = path.replace("台", "臺").split("/")
        # 第二段不含縣市或第三段不是指定類別的公報不屬於這個選區
        if len(parts) < 4 or county not in parts[1] or parts[2] not in folders:
            continue
        # 第三段之後去掉縣市名稱，各段去掉開頭的序號再比對鄉鎮
        tail = "/".join(parts[3:]).replace(county, "")
        segments = [SEGMENT_PREFIX.sub("", segment) for segment in tail.split("/")]
        # 含完整鄉鎮名稱，或某一段以簡稱開頭
        if town in tail or any(segment.startswith(stem) for segment in segments):
            found.append(path)
    return sorted(found)


# ==================================================
# 公報的解析
# ==================================================


def xobject_size(page, key):
    """從影像物件的字典讀取寬高，不解碼影像。

    參數：
        page：pypdf 的頁面。
        key：page.images 的鍵，表單內的影像以 / 串接各階段名稱。
    回傳：`(寬, 高)`，字典沒有寫時是 -。
    """
    target = page
    # 逐層進入表單物件的資源，最後一層是影像本身
    for name in [part for part in str(key).split("/") if part]:
        target = target["/Resources"]["/XObject"]["/" + name].get_object()
    return str(target.get("/Width", EMPTY)), str(target.get("/Height", EMPTY))


def parse_bulletin(path, directory):
    """解析一份公報的各頁文字層與影像位置。

    參數：
        path：公報 PDF 的路徑。
        directory：輸出目錄，寫出 page-{頁}.txt 與 images.tsv。
    回傳：頁數，無法解析時是「讀取失敗：{錯誤種類}」，轉錄者依此改看渲染圖。
    """
    directory.mkdir(parents=True, exist_ok=True)
    # 解析上限與抽取階段相同，向量外框文字的頁面才讀得完
    try:
        with pypdf.apply_configuration(**PDF_LIMITS):
            # 影像位置逐頁累積，最後寫成一張表
            reader = pypdf.PdfReader(path)
            rows = []
            # 每頁寫出文字層，並列出每張嵌入影像的位置
            for number, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                (directory / f"page-{number}.txt").write_text(text, encoding="utf-8")
                # page.images 的鍵依嵌入順序排列，列出鍵不解碼影像
                keys = list(page.images.keys())
                # 影像代碼與抽取階段相同，寬高從影像字典讀取
                for index, x0, y0, x1, y1 in placed_images(
                    page, reader, float(page.mediabox.height)
                ):
                    width, height = xobject_size(page, keys[index])
                    rows.append(
                        dict(
                            zip(
                                IMAGE_HEADER,
                                [f"p{number}-{index}", width, height]
                                + [f"{value:.0f}" for value in (x0, y0, x1, y1)],
                            )
                        )
                    )
            # 影像位置合成一張表，頁數回報給公報清單
            write_table(directory / "images.tsv", IMAGE_HEADER, rows)
            return str(len(reader.pages))
    # 壞檔與不合規格的串流記下錯誤種類，不中斷其他公報
    except (pypdf.errors.PyPdfError, ValueError, KeyError) as error:
        return f"讀取失敗：{type(error).__name__}"


def parsed_bulletin(path, digest):
    """取得一份公報的解析結果，每份公報只解析一次。

    參數：
        path：公報在網站上的路徑。
        digest：公報的 sha256，解析結果依它存放。
    回傳：`(解析結果的目錄, 頁數或讀取失敗的說明)`。
    """
    directory = WORK_DIR / SOURCE / "parsed" / digest
    marker = directory / "pages.txt"
    # 已解析過的公報沿用結果，頁數記在 pages.txt
    if not marker.exists():
        pages = parse_bulletin(CACHE_DIR / SOURCE / path, directory)
        marker.write_text(pages, encoding="utf-8")
    return directory, marker.read_text(encoding="utf-8")


# ==================================================
# 選區素材
# ==================================================


def write_unit(directory, scope, entities, documents):
    """寫出一個選區的轉錄素材。

    參數：
        directory：選區的素材目錄，存在時整個重寫。
        scope：選區代碼，不含選舉代碼。
        entities：這個選區名冊上的參選者。
        documents：這個選區的公報，每份是 `(路徑, sha256)`。
    回傳：無。
    """
    # 每次重寫整個目錄，素材與名冊、公報清單一致
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    # 名冊依號次排列，沒有推薦政黨寫 -
    roster = [
        dict(
            zip(
                ROSTER_HEADER, [scope, str(e["number"]), e["name"], e["party"] or EMPTY]
            )
        )
        for e in sorted(entities, key=lambda e: e["number"])
    ]
    write_table(directory / "roster.tsv", ROSTER_HEADER, roster)
    rows = []
    # 每份公報複製解析結果到 doc{n}/，編號依公報路徑的順序
    for number, (path, digest) in enumerate(documents, start=1):
        parsed, pages = parsed_bulletin(path, digest)
        shutil.copytree(
            parsed,
            directory / f"doc{number}",
            ignore=shutil.ignore_patterns("pages.txt"),
        )
        # 公報清單記下頁數或讀取失敗的說明
        rows.append(dict(zip(DOC_HEADER, [f"doc{number}", path, digest, pages])))
    write_table(directory / DOC_FILE, DOC_HEADER, rows)


def prepare_units(election_id, folders, fallback, scopes):
    """依名冊把每個選區對到公報，寫出轉錄素材。

    參數：
        election_id：選舉代碼。
        folders：類別目錄名稱的集合。
        fallback：指定類別沒有對到公報時改找的類別集合。
        scopes：只處理這些選區代碼，空集合時處理全部選區。
    回傳：每個選區一行的摘要：選區、參選者數與公報數。
    例外：PipelineError，公報清單或名冊不存在。
    """
    year = election_config(election_id)["year"] - ROC_OFFSET
    # 公報清單由 `fetch list` 寫出，還沒有清單時提示先盤點
    listed = require(
        listing_path(year),
        f"先執行 `npm run pipeline -- fetch list --year {year} --folders <類別>...`",
    )
    listing = {row["路徑"]: row["sha256"] for row in read_table(listed, LIST_HEADER)}
    # 名冊取自抽取階段
    roster = read_json(
        layer_dir("extract", election_id) / ROSTER_FILE,
        hint=f"先執行 `npm run pipeline -- extract run --election {election_id}`",
    )["roster"]
    entities = {}
    # 名冊的參選者依選區分組
    for entity in roster["entities"]:
        entities.setdefault(entity["scope"], []).append(entity)
    lines = []
    # 選區名稱的前兩段是縣市與鄉鎮，依此對到公報
    for scope in roster["scopes"]:
        code = scope["id"].split(":", 1)[1]
        # 指定選區時只處理那些選區
        if scopes and code not in scopes:
            continue
        # 指定類別沒有對到公報時改找 fallback 的類別
        county, town = scope["name"].replace("台", "臺").split()[:2]
        paths = matching_documents(
            listing, county, town, folders
        ) or matching_documents(listing, county, town, fallback)
        documents, seen = [], set()
        # 同一份公報可能放在數個目錄，依 sha256 只取一次
        for path in paths:
            # 內容已收錄過的副本略過
            if listing[path] in seen:
                continue
            # 第一次出現的內容收錄，記下 sha256
            seen.add(listing[path])
            documents.append((path, listing[path]))
        # 每個選區寫出素材，摘要列出人數與公報數
        members = entities.get(scope["id"], [])
        write_unit(unit_dir(election_id, code), code, members, documents)
        lines.append(f"{code}\t{len(members)} 人\t{len(documents)} 份公報")
    return lines


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument("--folders", nargs="+", required=True, help="類別目錄的名稱")
    parser.add_argument(
        "--fallback", nargs="*", default=[], help="指定的類別沒有對到公報時改找的類別"
    )
    # 只重做部分選區時指定選區代碼
    parser.add_argument("--scopes", nargs="*", default=[], help="只處理這些選區")


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return "\n".join(
        prepare_units(
            args.election, set(args.folders), set(args.fallback), set(args.scopes)
        )
    )
