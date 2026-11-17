"""抓取階段的工具：列出公報網站某年度指定類別的公報並下載。

中選會的公報網站依年度與類別分目錄存放公報 PDF，`fetch run` 只下載選舉定義登錄的文件。本工具先把一個類別的公報全部下載到快取並寫出清單，抽取階段的 `extract units` 依這份清單把每個選區對到它的公報。步驟見 docs/pipeline/fetch.md。

指令：
  `npm run pipeline -- fetch list --source <來源代碼> --year <民國年> --folders <類別>...`

手寫輸入：
  data/sources.yaml   網站的網址與目錄版型 listing

產物：
  .cache/sources/{來源代碼}/{路徑}               下載的公報，與 `fetch run` 的快取相同，登錄到選舉定義後直接沿用
  .cache/pipeline/{來源代碼}/{民國年}.tsv        公報清單，表頭是路徑、sha256 與大小

慣例：
  - 清單依來源與年度累積，先前列出的其他類別保留。
  - 目錄版型以「/」分段：`{year}` 換成民國年，`{folder}` 換成每個指定的類別，`*` 進入這一層的每個子目錄。版型的最後一段以下的子目錄全部進入。
"""

import html
import re
import time
import urllib.parse
import urllib.request

from ..common import (
    CACHE_DIR,
    WORK_DIR,
    PipelineError,
    relative,
    sha256_file,
    sources_config,
)
from ..tables import read_optional, write_table
from .run import TIMEOUT_SECONDS, TLS_CONTEXT, USER_AGENT, download

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "列出公報網站某年度指定類別的公報，下載到快取並寫出清單"

# 目錄版型中進入每個子目錄的一段
ANY_FOLDER = "*"

# 公報清單的表頭
LIST_HEADER = ["路徑", "sha256", "大小"]

# 讀取目錄頁失敗時的重試次數與間隔（秒），兩次讀取之間也暫停這麼久
LIST_RETRIES = 3
LIST_PAUSE = 0.2
RETRY_PAUSE = 3

# 目錄頁的連結，子目錄以 ?dir= 開頭
LINK = re.compile(r'href="([^"]+)"')


def listing_path(source_id, year):
    """某個網站某年度公報清單的位置。

    參數：
        source_id：網站的來源代碼。
        year：民國年。
    回傳：Path。
    """
    return WORK_DIR / source_id / f"{year}.tsv"


# ==================================================
# 共用片段
# ==================================================


def directory_links(page, path):
    """從網站目錄頁取出子目錄與 PDF。

    參數：
        page：目錄頁的 HTML。
        path：這一頁的目錄路徑，寫成 `111/03新北市`。
    回傳：`(子目錄, PDF 路徑)`，兩者都已解碼並排序。
    """
    folders, files = set(), set()
    # 連結的網址經過 HTML 跳脫與百分比編碼，先還原
    for link in LINK.findall(page):
        target = html.unescape(link)
        # ?dir= 開頭的是目錄，只收下一個階段，上一個階段與同層的連結略過
        if target.startswith("?dir="):
            folder = urllib.parse.unquote(target[len("?dir=") :])
            # 子目錄是這個階段加上一段
            if (
                folder.startswith(path + "/")
                and folder.count("/") == path.count("/") + 1
            ):
                folders.add(folder)
        # 其餘連結中的 PDF 是公報
        elif target.lower().endswith(".pdf"):
            files.add(urllib.parse.unquote(target))
    return sorted(folders), sorted(files)


def read_directory(url, path):
    """讀取一頁網站目錄，失敗時重試。

    參數：
        url：網站目錄的網址，取自 data/sources.yaml。
        path：目錄路徑。
    回傳：directory_links 的結果。
    例外：PipelineError，重試後仍無法讀取。
    """
    request = urllib.request.Request(
        f"{url}?dir={urllib.parse.quote(path)}", headers={"User-Agent": USER_AGENT}
    )
    # 網站偶爾逾時，間隔一段時間再試
    for attempt in range(LIST_RETRIES):
        # 讀到內容就解析，連線錯誤時等待後重試
        try:
            with urllib.request.urlopen(
                request, timeout=TIMEOUT_SECONDS, context=TLS_CONTEXT
            ) as response:
                return directory_links(response.read().decode("utf-8", "replace"), path)
        # 最後一次仍失敗時停止，其餘等待後重試
        except OSError as error:
            # 重試次數用完時回報這一頁
            if attempt == LIST_RETRIES - 1:
                raise PipelineError(f"{path} 無法讀取：{error}") from error
            time.sleep(RETRY_PAUSE)


def listing_roots(url, layout, year, folders):
    """依目錄版型找出要往下列出的目錄。

    參數：
        url：網站目錄的網址。
        layout：目錄版型，寫在 data/sources.yaml 的 listing。
        year：民國年。
        folders：類別目錄名稱的集合。
    回傳：目錄路徑的串列。
    """
    paths = [""]
    # 版型逐段展開，路徑從網站根目錄往下接
    for segment in layout.split("/"):
        # 「*」進入每個子目錄，例如地方網站年度之下的各縣市
        if segment == ANY_FOLDER:
            paths = [sub for path in paths for sub in read_directory(url, path)[0]]
            # 兩次讀取之間暫停，展開下一段
            time.sleep(LIST_PAUSE)
            continue
        # 含類別的一段依每個類別各展開一次，其餘只代入年度
        values = (
            [segment.format(year=year, folder=folder) for folder in sorted(folders)]
            if "{folder}" in segment
            else [segment.format(year=year)]
        )
        paths = [f"{path}/{value}".lstrip("/") for path in paths for value in values]
    return paths


# ==================================================
# 主體
# ==================================================


def list_bulletins(source_id, year, folders):
    """列出某個網站某年度指定類別的公報，下載到快取並計算 sha256。

    參數：
        source_id：網站的來源代碼，登錄在 data/sources.yaml 並寫了 listing。
        year：民國年，網站的年度目錄名稱。
        folders：類別目錄名稱的集合，寫成 `{"04鄉鎮市民代表"}`。
    回傳：公報清單的路徑。
    例外：PipelineError，來源沒有目錄版型、目錄頁無法讀取或下載失敗。
    """
    source = sources_config()[source_id]
    # 只有網站目錄的來源才有版型可以展開
    if "listing" not in source:
        raise PipelineError(f"data/sources.yaml 的 {source_id} 沒有 listing")
    # 版型展開到的目錄是往下列出的起點
    queue = listing_roots(source["url"], source["listing"], year, folders)
    files = []
    # 版型展開到的目錄之下逐層讀取，收下每一層的公報
    while queue:
        subfolders, pdfs = read_directory(source["url"], queue.pop(0))
        files += pdfs
        # 子目錄排進佇列，兩次讀取之間暫停
        queue += subfolders
        time.sleep(LIST_PAUSE)
    target = listing_path(source_id, year)
    # 清單依來源與年度存放並累積，先前列出的其他類別保留
    rows = {row["路徑"]: row for row in read_optional(target, LIST_HEADER)}
    # 逐份下載到抓取階段的快取，已下載的檔案沿用
    for path in set(files):
        cached = CACHE_DIR / source_id / path
        # 快取沒有這份公報時才下載
        if not cached.exists():
            download(source["url"] + path, cached)
        rows[path] = {
            "路徑": path,
            "sha256": sha256_file(cached),
            "大小": str(cached.stat().st_size),
        }
    # 清單依路徑排序，`extract units` 依來源與選舉的年度讀取，第一次寫出時建立目錄
    target.parent.mkdir(parents=True, exist_ok=True)
    write_table(target, LIST_HEADER, [rows[path] for path in sorted(rows)])
    return target


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    parser.add_argument(
        "--source", required=True, help="網站的來源代碼，登錄在 data/sources.yaml"
    )
    parser.add_argument("--year", required=True, help="民國年，網站的年度目錄名稱")
    parser.add_argument(
        "--folders",
        nargs="+",
        required=True,
        help="類別目錄的名稱，寫在目錄版型的 {folder}",
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數，使用 source、year 與 folders。
    回傳：摘要字串，寫出清單的位置。
    """
    target = list_bulletins(args.source, args.year, set(args.folders))
    return f"fetch list {args.source} {args.year}: {relative(target)}"
