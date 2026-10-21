"""管線共用的路徑、設定讀取、產物讀寫與雜湊。

各層與 adapter 共用的檔案位置、設定讀取、產物的寫出與轉交，讓產物的格式與位置只定義在這一處。網站與管線共用的設定，例如設定表的欄名與資料格式，從 config/app/settings.json 讀取。

指令：
  由其他模組匯入，不單獨執行。

慣例：
  - JSON 產物以 UTF-8、鍵排序、緊湊格式寫出，同樣的輸入產生同樣的位元組，git 的差異只反映內容變動。
  - 每層的產物檔含本層新增的內容，前面各層的檔案以 carried 清單轉交，每筆記路徑與 sha256。
  - 下一層只讀取上一層的產物檔，轉交的檔案經 load_product 核對 sha256 後併入，前面任一層修改過而後面沒有重新執行時讀取失敗。
"""

import functools
import hashlib
import json
import sys
from pathlib import Path

import yaml

# ==================================================
# 路徑
# ==================================================

# 專案根目錄：本檔位於 pipeline/ 之下，往上一層
ROOT = Path(__file__).resolve().parent.parent

# 設定目錄：表格、管線設定
CONFIG_DIR = ROOT / "config"
TABLES_DIR = CONFIG_DIR / "tables"
PIPELINE_CONFIG_DIR = CONFIG_DIR / "pipeline"

# 網站設定，設定表的欄名與資料格式由網站與管線共用，只定義在這份檔
APP_SETTINGS_PATH = CONFIG_DIR / "app" / "settings.json"

# 管線產物的根目錄，各層在其下有自己的編號目錄
DATA_DIR = ROOT / "data"

# 快取的根目錄，不進版控
CACHE_ROOT = ROOT / ".cache"

# 原始下載的快取目錄，依來源登錄的 sha256 重新取得
CACHE_DIR = CACHE_ROOT / "sources"

# 串流讀寫的區塊大小，數百 MB 的封存檔不整份讀入記憶體
CHUNK_BYTES = 1 << 20

# 各層的代碼與目錄名，依管線順序排列，目錄名的數字讓檔案總管依序列出
LAYERS = {
    "fetch": "10-fetch",
    "extract": "20-extract",
    "claims": "30-claims",
    "match": "40-match",
    "score": "50-score",
    "publish": "60-publish",
}

# 各層的產物檔名，下一層只讀這個檔
PRODUCTS = {
    "fetch": "manifest.json",
    "extract": "extract.json",
    "claims": "claims.json",
    "match": "match.json",
    "score": "score.json",
    "publish": "dataset.json",
}

# 抽取層另存的名冊檔名
ROSTER_FILE = "roster.json"

# 資料版本是 sha256 的前幾碼，12 碼足以區分各次發布並保持網址簡短
VERSION_LENGTH = 12

# 轉交內容的合併順序：依管線順序，後面的層覆蓋前面的同名鍵。產物以鍵排序寫出，清單本身的順序不保留，因此另訂順序
# roster 是抽取層另存的名冊，排在抽取層產物之前
CARRY_ORDER = ["fetch", "roster", "extract", "claims", "match", "score"]


class PipelineError(Exception):
    """管線的輸入或產物不符合規格。

    訊息寫出出錯的檔案、列或欄位，以及怎麼修正，命令列入口把它印到標準錯誤並以結束代碼 1 結束。
    """


# ==================================================
# 位置
# ==================================================


def layer_dir(layer, election):
    """回傳某一層某場選舉的目錄，目錄不存在時不建立。

    參數：
        layer：LAYERS 的鍵，例如 "claims"。
        election：選舉代碼，與 config/pipeline/elections/ 的檔名相同。
    回傳：Path。
    """
    return DATA_DIR / LAYERS[layer] / election


def product_path(layer, election):
    """回傳某一層某場選舉的產物檔位置。

    參數：
        layer：LAYERS 的鍵。
        election：選舉代碼。
    回傳：Path，檔名取自 PRODUCTS。
    """
    return layer_dir(layer, election) / PRODUCTS[layer]


def topic_product_path(topic):
    """回傳一套主題測驗的發布檔位置。

    主題測驗不屬於任何選舉，發布檔在發布層目錄下多一層 topics/。
    參數：
        topic：題組代碼。
    回傳：Path。
    """
    return DATA_DIR / LAYERS["publish"] / "topics" / topic / PRODUCTS["publish"]


def relative(path):
    """回傳相對於專案根目錄的路徑字串，產物與訊息不寫本機的絕對路徑。

    參數：
        path：Path 或字串。
    回傳：以 / 分隔的相對路徑。專案以外的路徑原樣回傳，例如系統暫存檔。
    """
    try:
        return Path(path).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        # 專案以外的路徑沒有相對位置，原樣寫出讓訊息仍可追查
        return str(path)


# ==================================================
# 讀取
# ==================================================


def require(path, hint=None, label=""):
    """確認檔案存在。

    參數：
        path：檔案位置。
        hint：檔案不存在時附在訊息後面的修正方式，例如「先執行上一層」。
        label：檔案的種類，寫在位置前面，例如「設定檔」。
    回傳：path。
    例外：PipelineError，檔案不存在。
    """
    # 缺席時寫出應有的位置
    if not path.exists():
        # 有修正方式時一併寫出
        raise PipelineError(
            f"找不到{label} {relative(path)}" + (f"，{hint}" if hint else "")
        )
    return path


def read_yaml(path):
    """讀取一份 YAML 設定。

    參數：
        path：設定檔位置。
    回傳：YAML 解析後的物件。
    例外：PipelineError，檔案不存在。
    """
    with require(path, label="設定檔").open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def read_json(path, hint="先執行上一層", label=""):
    """讀取一份 JSON 檔。

    參數：
        path：檔案位置。
        hint、label：見 require。
    回傳：JSON 解析後的物件。
    例外：PipelineError，檔案不存在。
    """
    return json.loads(require(path, hint, label).read_text(encoding="utf-8"))


@functools.cache
def app_settings():
    """讀取網站設定 config/app/settings.json，一個行程只讀取一次。

    管線從這份設定取得設定表的欄名與資料集、地圖的格式，與網站讀取同一份定義。呼叫端不可修改回傳的 dict。
    回傳：設定內容的 dict。
    例外：PipelineError，檔案不存在。
    """
    return read_json(APP_SETTINGS_PATH, hint=None, label="設定檔")


def format_fields(kind):
    """產物的格式戳記：format 與 format_version 兩鍵。

    參數：
        kind：settings.json 的 formats 的鍵，例如 dataset。
    回傳：dict。
    """
    spec = app_settings()["formats"][kind]
    return {"format": spec["name"], "format_version": spec["version"]}


# ==================================================
# 雜湊
# ==================================================


def canonical_bytes(value):
    """把值轉成鍵排序、緊湊的 UTF-8 JSON 位元組。

    寫檔與資料版本共用這個轉換，內容相同時位元組相同，雜湊才穩定。
    參數：
        value：可序列化成 JSON 的值。
    回傳：bytes。
    """
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return text.encode("utf-8")


def sha256_file(path):
    """以 CHUNK_BYTES 的串流計算檔案的 sha256。

    參數：
        path：檔案位置。
    回傳：十六進位字串。
    """
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        # 讀到檔尾時 read 回傳空位元組，iter 依此停止
        for block in iter(lambda: handle.read(CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(data):
    """回傳位元組的 sha256。

    參數：
        data：位元組。
    回傳：十六進位字串。
    """
    return hashlib.sha256(data).hexdigest()


def sha256_text(text):
    """回傳文字以 UTF-8 編碼後的 sha256。

    參數：
        text：字串。
    回傳：十六進位字串。
    """
    return sha256_bytes(text.encode("utf-8"))


def data_version(content):
    """計算資料集或題組內容的版本碼，分享網址以它核對。

    參數：
        content：不含 manifest 的內容。
    回傳：canonical_bytes 的 sha256 前 VERSION_LENGTH 碼。
    """
    return sha256_bytes(canonical_bytes(content))[:VERSION_LENGTH]


# ==================================================
# 寫出與轉交
# ==================================================


def write_json(path, value):
    """以 canonical_bytes 寫出 JSON 產物。

    先寫入同目錄的暫存檔再替換，寫入途中失敗時舊產物保持完整。
    參數：
        path：產物位置，上層目錄不存在時建立。
        value：要寫出的值。
    回傳：寫出內容的 sha256，轉交清單記錄它。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    data = canonical_bytes(value) + b"\n"
    # 暫存檔與目標同目錄，替換是同一檔案系統內的改名，不會留下寫一半的檔
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(data)
    temp.replace(path)
    return sha256_bytes(data)


def reference(path):
    """組成轉交清單的一筆：相對路徑與目前內容的 sha256。

    參數：
        path：要轉交的產物檔位置。
    回傳：`{"path": 相對路徑, "sha256": 雜湊}`。
    """
    return {"path": relative(path), "sha256": sha256_file(path)}


def write_product(layer, election, own, carried):
    """寫出一層的產物檔：本層新增的內容加上轉交清單。

    參數：
        layer：LAYERS 的鍵。
        election：選舉代碼。
        own：本層新增的內容，dict。
        carried：轉交清單，鍵為內容名稱，值為 reference 的結果。
    回傳：產物檔的 sha256。
    """
    return write_json(product_path(layer, election), own | {"carried": carried})


def load_product(layer, election):
    """讀取一層的產物檔，核對並併入它轉交的檔案。

    轉交的檔案是前面各層的產物，內容依 CARRY_ORDER 的順序以鍵併入回傳值，鍵重複時以後面的層為準，本層內容最後併入。
    參數：
        layer：要讀的層，也就是呼叫端的上一層。
        election：選舉代碼。
    回傳：(merged, carried)。merged 是本層內容加上轉交內容的 dict，carried 是供下一層延續的轉交清單，已含這份產物檔本身。
    例外：PipelineError，產物不存在，或轉交檔的 sha256 與記錄不符。
    """
    path = product_path(layer, election)
    product = read_json(path)
    # 轉交清單不屬於內容，取出後另外處理
    carried = product.pop("carried", {})
    merged = {}
    # 依管線順序逐一核對雜湊並併入內容
    for name in sorted(carried, key=CARRY_ORDER.index):
        entry = carried[name]
        source = ROOT / entry["path"]
        # 前面的層修改過而後面沒有重新執行時，雜湊對不上，資料就不是同一批
        if not source.exists() or sha256_file(source) != entry["sha256"]:
            raise PipelineError(
                f"{entry['path']} 在 {relative(path)} 產生後修改過，從那一層起重新執行管線"
            )
        # 轉交檔本身的轉交清單已展開在這份清單中，併入時移除
        content = read_json(source)
        content.pop("carried", None)
        merged |= content
    # 本層內容最後併入，與轉交內容同名的鍵以本層為準
    merged |= product
    return merged, carried | {layer: reference(path)}


# ==================================================
# 選舉、主題測驗與來源設定
# ==================================================


def config_ids(folder):
    """列出一類設定的代碼。

    參數：
        folder：config/pipeline/ 下的子目錄，elections 或 topics。
    回傳：子目錄下 YAML 檔名移除副檔名，依碼位排序，執行順序因此固定。
    """
    return sorted(path.stem for path in (PIPELINE_CONFIG_DIR / folder).glob("*.yaml"))


def named_config(folder, code):
    """讀取一份以代碼命名的設定。

    參數：
        folder：config/pipeline/ 下的子目錄。
        code：代碼，即檔名。
    回傳：設定內容的 dict。
    例外：PipelineError，檔案不存在，或檔內 id 與檔名不同。
    """
    config = read_yaml(PIPELINE_CONFIG_DIR / folder / f"{code}.yaml")
    # 檔名與 id 不一致時，產物目錄與設定無法互相找到
    if config.get("id") != code:
        raise PipelineError(
            f"{folder}/{code}.yaml 的 id 是 {config.get('id')}，要與檔名相同"
        )
    return config


def election_ids():
    """列出已設定的選舉代碼。

    回傳：config/pipeline/elections/ 的代碼。
    """
    return config_ids("elections")


def election_config(election):
    """讀取一場選舉的設定。

    參數：
        election：選舉代碼。
    回傳：見 named_config。
    """
    return named_config("elections", election)


def topic_ids():
    """列出已設定的主題測驗代碼。

    回傳：config/pipeline/topics/ 的代碼。
    """
    return config_ids("topics")


def topic_config(topic):
    """讀取一套主題測驗的設定。

    參數：
        topic：題組代碼。
    回傳：見 named_config。
    """
    return named_config("topics", topic)


def unique_index(entries, where, key="id"):
    """把設定的串列轉成以代碼為鍵的 dict。

    參數：
        entries：設定的串列，例如來源或軸。
        where：錯誤訊息中的位置，例如「sources.yaml 的 sources」。
        key：當鍵的欄位。
    回傳：dict，順序與串列相同。
    例外：PipelineError，代碼重複。
    """
    index = {}
    # 依序加入，第一個重複的代碼就回報
    for entry in entries:
        # 同一代碼兩筆時，引用它會有兩種解讀
        if entry[key] in index:
            raise PipelineError(f"{where} 的代碼 {entry[key]} 重複")
        index[entry[key]] = entry
    return index


def sources_config():
    """讀取來源登錄。

    回傳：以來源代碼為鍵的 dict。
    例外：PipelineError，代碼重複。
    """
    return unique_index(
        read_yaml(PIPELINE_CONFIG_DIR / "sources.yaml")["sources"],
        "sources.yaml 的 sources",
    )


# ==================================================
# 訊息
# ==================================================


def log(message, name="pipeline"):
    """把進度與錯誤訊息寫入標準錯誤，標準輸出只保留各層的摘要，方便以管線串接。

    參數：
        message：訊息文字。
        name：訊息開頭的程式名稱。
    """
    sys.stderr.write(f"[{name}] {message}\n")
