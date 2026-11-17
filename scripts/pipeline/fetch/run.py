"""抓取階段的核對與產物：取得一場選舉用到的原始檔並記錄 sha256。

依選舉定義引用的來源，從 .cache/sources/ 取用原始檔，缺少檔案時下載，再核對登錄的 sha256，寫出 manifest。取得單一來源的 ensure_source 與 fetch_source 另供 geo 與 topics 兩個階段使用，download 另供同階段的 list 使用。步驟見 docs/pipeline/fetch.md。

指令：
  `npm run pipeline -- fetch run --election <代碼> [--offline]`

手寫輸入：
  data/sources.yaml                        來源登錄
  data/10-fetch/{選舉代碼}/election.yaml   選舉定義的 roster 與 documents

產物：
  data/10-fetch/{選舉代碼}/manifest.json   每個來源的 adapter、檔案位置、sha256 與授權

慣例：
  - manifest 的內容沒有時間，同樣的原始檔得到同樣的 manifest，git 只在來源的內容改變時出現差異。
  - 登錄了 sha256 的來源要完全相符。網頁快照每次下載的內容不同，這類來源以 manifest 記下的值為準。
  - 自訂來源放在 repo 內，manifest 只記代碼與類型。
  - 沒有 file 的來源是網站目錄，每份文件的路徑與 sha256 寫在選舉定義的 documents，manifest 的 members 逐份記錄。
  - 下載時照常驗證憑證鏈與主機名稱。部分政府網站的憑證缺 Subject Key Identifier，Python 3.13 起預設的 X.509 嚴格檢查會拒絕連線，TLS_CONTEXT 關掉這一項，檔案的內容以 sha256 核對。
"""

import ssl
import urllib.parse
import urllib.request

from ..adapters import capability
from ..common import (
    CACHE_DIR,
    CHUNK_BYTES,
    ROOT,
    PipelineError,
    election_argument,
    election_config,
    election_path,
    log,
    product_path,
    relative,
    sha256_file,
    sources_config,
    write_json,
)

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "下載選舉定義登錄的來源，核對 sha256 並寫出 manifest"

# 單一原始檔的大小上限（位元組），113 年公報封存檔約 276 MB，上限留兩倍以上餘裕並攔阻異常大檔
MAX_BYTES = 512 * 1024 * 1024

# 下載逾時（秒）
TIMEOUT_SECONDS = 120

# 下載時送出的 User-Agent，讓來源端辨識請求者
USER_AGENT = "taiwan-policy-atlas-pipeline/1.0"

# 下載用的 TLS 設定：照常驗證憑證鏈與主機名稱，關掉 Python 3.13 起預設的 RFC 5280 嚴格檢查。
# 部分政府網站的憑證缺 Subject Key Identifier，嚴格檢查會拒絕連線，檔案內容另以 sha256 核對
TLS_CONTEXT = ssl.create_default_context()
TLS_CONTEXT.verify_flags &= ~ssl.VERIFY_X509_STRICT

# 檔案放在 repo 內的 adapter，沒有快取檔
LOCAL_ADAPTERS = {"custom"}

# manifest 每筆沿用自來源登錄的欄位
COPIED_FIELDS = ("id", "adapter", "source_type", "name", "license")

# 對外公開的來源欄位，地圖與題組的來源清單列出這幾欄
PUBLIC_FIELDS = ("id", "name", "url", "sha256", "license")


# ==================================================
# 共用片段
# ==================================================


def source_ids(election):
    """列出一場選舉引用的來源代碼。

    參數：
        election：選舉定義。
    回傳：名冊來源與各文件的來源，移除重複後依碼位排序。手寫名冊表的選舉只有文件的來源。
    """
    # 手寫名冊表的選舉沒有名冊來源
    ids = {election["roster"]["source"]} if "source" in election["roster"] else set()
    ids.update(document["source"] for document in election.get("documents", []))
    return sorted(ids)


def download(url, path):
    """以串流下載到暫存檔，完成後替換。

    參數：
        url：下載網址，路徑可以含中文，送出前編碼。
        path：存檔位置。
    例外：PipelineError，超過 MAX_BYTES。urllib 的錯誤原樣拋出，訊息含狀態碼。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # 網址路徑中的中文以百分比編碼送出
    parts = urllib.parse.urlsplit(url)
    safe = urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path)))
    request = urllib.request.Request(safe, headers={"User-Agent": USER_AGENT})
    # 先寫入 .part，下載完整才替換成正式檔名
    temp = path.with_suffix(path.suffix + ".part")
    total = 0
    with urllib.request.urlopen(
        request, timeout=TIMEOUT_SECONDS, context=TLS_CONTEXT
    ) as response, temp.open("wb") as handle:
        # 逐塊寫入並累計大小，讀取到檔尾時 read 回傳空位元組
        for block in iter(lambda: response.read(CHUNK_BYTES), b""):
            total += len(block)
            # 超過上限時刪除暫存檔並停止
            if total > MAX_BYTES:
                # 先關閉再刪除，不留下不完整的暫存檔
                handle.close()
                temp.unlink()
                raise PipelineError(f"{url} 超過 {MAX_BYTES} 位元組")
            # 未超過上限的區塊寫入暫存檔
            handle.write(block)
    # 下載完整後才換成正式檔名
    temp.replace(path)


def ensure_source(source, offline):
    """確保一個來源的原始檔在快取內且 sha256 相符。

    參數：
        source：來源登錄的一筆，取自 data/sources.yaml 或測驗定義的 sources。
        offline：True 時不下載，快取缺檔即失敗。
    回傳：manifest 的一筆，含檔案位置、sha256、大小與檔名編碼。
    例外：PipelineError，離線而缺檔，或 sha256 與登錄值不符。
    """
    # 來源類型只有政見來源才登錄，地圖與主題測驗的來源沒有，記為 None
    base = {field: source.get(field) for field in COPIED_FIELDS}
    # 自訂來源在 repo 內，沒有快取檔
    if source["adapter"] in LOCAL_ADAPTERS:
        return base | {
            "url": None,
            "file": None,
            "sha256": None,
            "bytes": None,
            "name_encoding": "utf-8",
        }
    path = CACHE_DIR / source["id"] / source["file"]
    # 快取缺檔時下載，離線模式無法下載
    if not path.exists():
        # 離線模式不能下載
        if offline:
            raise PipelineError(
                f"離線模式下找不到 {relative(path)}，先在有網路時執行 `npm run pipeline -- fetch run`"
            )
        # 下載進度寫入標準錯誤
        log(f"下載 {source['url']}")
        download(source["url"], path)
    # 不論新下載或沿用快取都重新計算雜湊
    digest = sha256_file(path)
    expected = source.get("sha256")
    # 登錄了 sha256 的來源，內容要與登錄時相同
    if expected and digest != expected:
        raise PipelineError(
            f"{relative(path)} 的 sha256 是 {digest}，來源登錄的是 {expected}"
        )
    return base | {
        "url": source["url"],
        "file": relative(path),
        "sha256": digest,
        "bytes": path.stat().st_size,
        "name_encoding": source.get("name_encoding", "utf-8"),
    }


def ensure_directory(source, documents, offline):
    """確保網站目錄來源被引用的每份文件都在快取內且 sha256 相符。

    參數：
        source：來源登錄的一筆，沒有 file，url 是網站目錄的網址。
        documents：選舉定義中引用這個來源的文件，使用 member 與 sha256。
        offline：True 時不下載，快取缺檔即失敗。
    回傳：manifest 的一筆，file 是快取目錄，members 列出每份文件的路徑、sha256 與大小。
    例外：PipelineError，文件沒有寫 sha256，或 ensure_source 失敗。
    """
    members = []
    # 每份文件當成一個單檔來源取得，網址是網站目錄加上文件的路徑
    for document in documents:
        # 網站目錄沒有整體的雜湊，每份文件都要寫 sha256 才能核對內容
        if not document.get("sha256"):
            raise PipelineError(
                f"文件 {document['id']} 引用 {source['id']}，要寫 sha256"
            )
        entry = ensure_source(
            source
            | {
                "file": document["member"],
                "url": source["url"] + document["member"],
                "sha256": document["sha256"],
            },
            offline,
        )
        # manifest 逐份記下路徑、雜湊與大小，文件內容改變時 manifest 跟著改變
        members.append(
            {
                "member": document["member"],
                "sha256": entry["sha256"],
                "bytes": entry["bytes"],
            }
        )
    return {field: source.get(field) for field in COPIED_FIELDS} | {
        "url": source["url"],
        "file": relative(CACHE_DIR / source["id"]),
        "sha256": None,
        "bytes": None,
        "name_encoding": source.get("name_encoding", "utf-8"),
        "members": members,
    }


def registered(registry, source_id, where):
    """找出定義引用的一筆來源登錄。

    參數：
        registry：以來源代碼為鍵的登錄，data/sources.yaml 或測驗定義的 sources。
        source_id：來源代碼。
        where：引用它的定義檔，寫在錯誤訊息中。
    回傳：來源登錄的一筆。
    例外：PipelineError，來源沒有登錄。
    """
    # 定義只能引用登錄過的來源
    if source_id not in registry:
        raise PipelineError(f"{where} 引用的來源 {source_id} 沒有登錄")
    return registry[source_id]


def fetch_source(registry, source_id, kind, offline, where):
    """取得定義引用的一個原始檔，並查出處理它的 adapter 能力。

    參數：
        registry、source_id、where：見 registered。
        kind：adapter 的能力名稱：geography、topic 或 comparison。
        offline：True 時只使用快取。
    回傳：`(抓取紀錄, 處理函式)`。
    例外：PipelineError，來源沒有登錄、adapter 沒有這種能力，或 ensure_source 失敗。
    """
    source = registered(registry, source_id, where)
    # 先確認能力再下載，定義寫錯時立刻回報
    handler = capability(source["adapter"], kind)
    return ensure_source(source, offline), handler


def cached_path(entry):
    """manifest 一筆的原始檔位置。

    參數：
        entry：ensure_source 的回傳值。
    回傳：Path，自訂來源沒有快取檔時為 None。
    """
    return ROOT / entry["file"] if entry["file"] else None


def public_source(entry):
    """產物對外列出的來源欄位。

    參數：
        entry：ensure_source 的回傳值。
    回傳：PUBLIC_FIELDS 的各欄。
    """
    return {key: entry[key] for key in PUBLIC_FIELDS}


# ==================================================
# 主體
# ==================================================


def run(election_id, offline=False):
    """執行抓取階段。

    參數：
        election_id：選舉代碼。
        offline：True 時只使用快取。
    回傳：摘要字串。
    例外：PipelineError，選舉定義引用了沒有登錄的來源，或 ensure_source 失敗。
    """
    election = election_config(election_id)
    sources = sources_config()
    entries = []
    # 逐一確保引用的來源已取得
    for source_id in source_ids(election):
        source = registered(sources, source_id, relative(election_path(election_id)))
        # 沒有 file 的來源是網站目錄，依引用它的文件逐份取得
        if "file" not in source:
            documents = [
                document
                for document in election.get("documents", [])
                # 只取引用這個來源的文件
                if document["source"] == source_id
            ]
            entries.append(ensure_directory(source, documents, offline))
        # 其餘來源是單一檔案
        else:
            entries.append(ensure_source(source, offline))
    # manifest 是這個階段唯一的產物
    write_json(
        product_path("fetch", election_id),
        {"election": election_id, "sources": entries},
    )
    return f"fetch {election_id}: {len(entries)} 個來源"


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument(
        "--offline", action="store_true", help="只用 .cache/sources/ 內的原始檔"
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數，使用 election 與 offline。
    回傳：摘要字串。
    """
    return run(args.election, offline=args.offline)
