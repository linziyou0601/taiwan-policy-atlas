"""抓取層：取得一場選舉用到的原始檔並記錄 sha256。

依選舉設定引用的來源，從 .cache/sources/ 取用原始檔，缺少檔案時下載，再核對 sources.yaml 登錄的 sha256，寫出 data/10-fetch/{選舉}/manifest.json。取得單一來源的 ensure_source 與 fetch_source 另供地圖步驟與主題測驗使用。

指令：
  `python -m pipeline fetch --election <代碼> [--offline]`

慣例：
  - manifest 不寫時間，同樣的原始檔得到同樣的 manifest，git 只在來源內容改變時出現差異。
  - 登錄了 sha256 的來源要完全相符，網頁快照這類每次不同的來源不登錄 sha256，以 manifest 記下的值為準。
  - 自訂來源放在 repo 內，不經快取，manifest 只記代碼與類型。
"""

import ssl
import urllib.parse
import urllib.request

from .adapters import capability
from .common import (
    CACHE_DIR,
    CHUNK_BYTES,
    ROOT,
    PipelineError,
    election_config,
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

# 不經快取的 adapter
LOCAL_ADAPTERS = {"custom"}

# manifest 每筆沿用自來源登錄的欄位
COPIED_FIELDS = ("id", "adapter", "source_type", "name", "license")

# 對外公開的來源欄位，地圖與題組的來源清單列出這幾欄
PUBLIC_FIELDS = ("id", "name", "url", "sha256", "license")


def source_ids(election):
    """列出一場選舉引用的來源代碼。

    參數：
        election：選舉設定。
    回傳：名冊來源加上各文件的來源，移除重複後依碼位排序。
    """
    ids = {election["roster"]["source"]}
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
        source：來源登錄的一筆，取自 sources.yaml 或主題測驗設定的 sources。
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
                f"離線模式下找不到 {relative(path)}，先在有網路時執行 fetch"
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


def registered(registry, source_id, where):
    """找出設定引用的一筆來源登錄。

    參數：
        registry：以來源代碼為鍵的登錄，sources.yaml 或主題測驗設定的 sources。
        source_id：來源代碼。
        where：引用它的設定檔，寫在錯誤訊息中。
    回傳：來源登錄的一筆。
    例外：PipelineError，來源沒有登錄。
    """
    # 設定只能引用登錄過的來源
    if source_id not in registry:
        raise PipelineError(f"{where} 引用的來源 {source_id} 沒有登錄")
    return registry[source_id]


def fetch_source(registry, source_id, kind, offline, where):
    """取得設定引用的一個原始檔，並查出處理它的 adapter 能力。

    參數：
        registry、source_id、where：見 registered。
        kind：adapter 的能力名稱，例如 geography、topic、comparison。
        offline：True 時只使用快取。
    回傳：`(抓取紀錄, 處理函式)`。
    例外：PipelineError，來源沒有登錄、adapter 沒有這種能力，或 ensure_source 失敗。
    """
    source = registered(registry, source_id, where)
    # 先確認能力再下載，設定錯誤時不必等待下載
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


def run(election_id, offline=False):
    """執行抓取層。

    參數：
        election_id：選舉代碼。
        offline：True 時只使用快取。
    回傳：摘要字串。
    例外：PipelineError，選舉設定引用了未登錄的來源，或 ensure_source 失敗。
    """
    election = election_config(election_id)
    sources = sources_config()
    entries = []
    # 逐一確保引用的來源已取得
    for source_id in source_ids(election):
        source = registered(sources, source_id, f"elections/{election_id}.yaml")
        entries.append(ensure_source(source, offline))
    # manifest 是本層唯一的產物
    write_json(
        product_path("fetch", election_id),
        {"election": election_id, "sources": entries},
    )
    return f"fetch {election_id}: {len(entries)} 個來源"
