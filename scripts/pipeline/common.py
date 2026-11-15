"""管線共用的路徑、定義的讀取、產物的讀寫與雜湊。

各階段與 adapter 共用的檔案位置、選舉與主題測驗定義的讀取、產物的寫出與轉交，產物的格式與位置只定義在這一處。網站與管線共用的設定，也就是設定表的欄名與資料的格式，從 config/app/settings.json 讀取。

指令：
  由其他模組匯入。

手寫輸入：
  data/sources.yaml                        來源登錄
  data/10-fetch/{選舉代碼}/election.yaml   一場選舉的定義
  data/topics/{代碼}/topic.yaml            一套主題測驗的定義

產物：
  各階段經由 write_product 寫出 data/{階段目錄}/{選舉代碼}/ 的產物檔。

慣例：
  - JSON 產物以 UTF-8、鍵排序、緊湊格式寫出，同樣的輸入產生同樣的位元組，git 的差異只反映內容的變動。
  - 每個階段的產物檔含這個階段新增的內容，前面各階段的檔案以 carried 清單轉交，每筆記路徑與 sha256。
  - 下一個階段只讀取上一個階段的產物檔，轉交的檔案經 load_product 核對 sha256 後併入，前面任一個階段修改過而後面沒有重新執行時讀取失敗。
  - 選舉的代碼是 data/10-fetch/ 下含 election.yaml 的目錄名，主題測驗的代碼是 data/topics/ 下含 topic.yaml 的目錄名。
"""

import functools
import hashlib
import json
import sys
from pathlib import Path

import yaml

# ==================================================
# 集中設定
# ==================================================

# 專案根目錄：本檔位於 scripts/pipeline/ 之下，往上兩層
ROOT = Path(__file__).resolve().parents[2]

# 網站執行時讀取的設定目錄，其中的設定表由網站與管線讀取同一份
CONFIG_DIR = ROOT / "config"
TABLES_DIR = CONFIG_DIR / "tables"

# 只有管線讀取的設定表，放在讀它的程式旁邊
PIPELINE_TABLES_DIR = Path(__file__).resolve().parent / "tables"

# 網站設定，設定表的欄名與資料的格式由網站與管線共用，只定義在這份檔
APP_SETTINGS_PATH = CONFIG_DIR / "app" / "settings.json"

# 管線各階段的手寫輸入與產物的根目錄
DATA_DIR = ROOT / "data"

# 來源登錄
SOURCES_PATH = DATA_DIR / "sources.yaml"

# 主題測驗的定義與手寫表的根目錄，每套測驗一個子目錄
TOPICS_DIR = DATA_DIR / "topics"

# 一場選舉與一套主題測驗的定義檔名
ELECTION_FILE = "election.yaml"
TOPIC_FILE = "topic.yaml"

# 快取的根目錄，列在 .gitignore
CACHE_ROOT = ROOT / ".cache"

# 原始下載的快取目錄，依登錄的 sha256 重新取得
CACHE_DIR = CACHE_ROOT / "sources"

# 各階段工具的中間檔目錄：公報網站的清單與解析結果、各選區的轉錄素材、影像預覽與政見格
WORK_DIR = CACHE_ROOT / "pipeline"

# 串流讀寫的區塊大小，數百 MB 的封存檔分塊讀取
CHUNK_BYTES = 1 << 20

# 各階段的代碼與目錄名，依管線的順序排列。目錄名的數字讓檔案總管依序列出，階段的程式目錄與代碼同名
LAYERS = {
    "fetch": "10-fetch",
    "extract": "20-extract",
    "claims": "30-claims",
    "match": "40-match",
    "score": "50-score",
    "publish": "60-publish",
}

# 各階段的產物檔名，下一個階段只讀這個檔
PRODUCTS = {
    "fetch": "manifest.json",
    "extract": "extract.json",
    "claims": "claims.json",
    "match": "match.json",
    "score": "score.json",
    "publish": "dataset.json",
}

# 抽取階段另存的名冊檔名
ROSTER_FILE = "roster.json"

# 資料版本是 sha256 的前幾碼，12 碼足以區分各次發布並保持網址簡短
VERSION_LENGTH = 12

# 轉交內容的合併順序：依管線的順序，後面的階段覆蓋前面的同名鍵。產物以鍵排序寫出，清單本身的順序沒有保留，因此另訂順序
# roster 是抽取階段另存的名冊，排在抽取階段產物之前
CARRY_ORDER = ["fetch", "roster", "extract", "claims", "match", "score"]

# 指令的寫法，用法說明以它開頭
PROGRAM = "npm run pipeline --"


class PipelineError(Exception):
    """管線的輸入或產物不符合規格。

    訊息寫出出錯的檔案、列或欄位，以及怎麼修正。進入點 `__main__.py` 把它印到標準錯誤並以結束代碼 1 結束。
    """


# ==================================================
# 位置
# ==================================================


def layer_dir(layer, election):
    """回傳某一層某場選舉的目錄。

    參數：
        layer：LAYERS 的鍵。
        election：選舉代碼。
    回傳：Path，目錄由寫入的函式建立。
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

    主題測驗和選舉互不相依，發布檔在發布階段目錄下多一層 topics/。
    參數：
        topic：主題測驗的代碼。
    回傳：Path。
    """
    return DATA_DIR / LAYERS["publish"] / "topics" / topic / PRODUCTS["publish"]


def relative(path):
    """回傳相對於專案根目錄的路徑字串，產物與訊息只寫相對路徑。

    參數：
        path：Path 或字串。
    回傳：以 / 分隔的相對路徑。專案以外的路徑原樣回傳。
    """
    try:
        return Path(path).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        # 專案以外的路徑沒有相對位置，原樣寫出讓訊息仍然可以追查
        return str(path)


# ==================================================
# 讀取
# ==================================================


def require(path, hint=None, label=""):
    """確認檔案存在。

    參數：
        path：檔案位置。
        hint：檔案不存在時附在訊息後面的修正方式。
        label：檔案的種類，寫在位置前面。
    回傳：path。
    例外：PipelineError，檔案不存在。
    """
    # 檔案不存在時寫出應有的位置
    if not path.exists():
        # 有修正方式時一併寫出
        raise PipelineError(
            f"找不到{label} {relative(path)}" + (f"，{hint}" if hint else "")
        )
    return path


def read_yaml(path):
    """讀取一份 YAML。

    參數：
        path：檔案位置。
    回傳：YAML 解析後的物件。
    例外：PipelineError，檔案不存在。
    """
    with require(path, label="定義檔").open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def read_json(path, hint="先執行上一個階段", label=""):
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

    管線從這份設定取得設定表的欄名與資料集、地圖的格式，與網站讀取同一份定義。回傳的 dict 只供讀取。
    回傳：設定內容的 dict。
    例外：PipelineError，檔案不存在。
    """
    return read_json(APP_SETTINGS_PATH, hint=None, label="設定檔")


def format_fields(kind):
    """產物的格式戳記：format 與 format_version 兩鍵。

    參數：
        kind：settings.json 的 formats 的鍵。
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
        value：可以序列化成 JSON 的值。
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
        content：manifest 以外的內容。
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
    # 暫存檔與目標同目錄，替換是同一個檔案系統內的改名
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
    """寫出一層的產物檔：這個階段新增的內容加上轉交清單。

    參數：
        layer：LAYERS 的鍵。
        election：選舉代碼。
        own：這個階段新增的內容，dict。
        carried：轉交清單，鍵是內容的名稱，值是 reference 的結果。
    回傳：產物檔的 sha256。
    """
    return write_json(product_path(layer, election), own | {"carried": carried})


def load_product(layer, election):
    """讀取一層的產物檔，核對並併入它轉交的檔案。

    轉交的檔案是前面各階段的產物，內容依 CARRY_ORDER 的順序以鍵併入回傳值，鍵重複時以後面的階段為準，這個階段的內容最後併入。
    參數：
        layer：要讀的層，也就是呼叫端的上一個階段。
        election：選舉代碼。
    回傳：(merged, carried)。merged 是這個階段的內容加上轉交內容的 dict，carried 是供下一個階段延續的轉交清單，已含這份產物檔本身。
    例外：PipelineError，產物不存在，或轉交檔的 sha256 與記錄不符。
    """
    path = product_path(layer, election)
    product = read_json(path)
    # 轉交清單取出後另外處理，其餘是這個階段的內容
    carried = product.pop("carried", {})
    merged = {}
    # 依管線的順序逐一核對雜湊並併入內容
    for name in sorted(carried, key=CARRY_ORDER.index):
        entry = carried[name]
        source = ROOT / entry["path"]
        # 前面的階段修改過而後面沒有重新執行時，雜湊對不上，兩層的資料就不是同一批
        if not source.exists() or sha256_file(source) != entry["sha256"]:
            raise PipelineError(
                f"{entry['path']} 在 {relative(path)} 產生後修改過，從那個階段起重新執行管線"
            )
        # 轉交檔本身的轉交清單已經展開在這份清單中，併入時移除
        content = read_json(source)
        content.pop("carried", None)
        merged |= content
    # 這個階段的內容最後併入，與轉交內容同名的鍵以這個階段為準
    merged |= product
    return merged, carried | {layer: reference(path)}


# ==================================================
# 選舉、主題測驗與來源的定義
# ==================================================


def defined_ids(directory, file_name):
    """列出一個目錄下有定義檔的子目錄名稱。

    參數：
        directory：選舉是 data/10-fetch/，主題測驗是 data/topics/。
        file_name：定義檔的檔名。
    回傳：子目錄名稱依碼位排序，執行的順序因此固定。
    """
    return sorted(path.parent.name for path in directory.glob(f"*/{file_name}"))


def read_definition(path, code):
    """讀取一份以目錄名為代碼的定義。

    參數：
        path：定義檔位置。
        code：代碼，即定義檔所在的目錄名。
    回傳：定義內容的 dict。
    例外：PipelineError，檔案不存在，或檔內的 id 與目錄名不同。
    """
    definition = read_yaml(path)
    # 目錄名與 id 不一致時，產物目錄與定義無法互相找到
    if definition.get("id") != code:
        raise PipelineError(
            f"{relative(path)} 的 id 是 {definition.get('id')}，要與目錄名 {code} 相同"
        )
    return definition


def election_path(election):
    """回傳一場選舉的定義檔位置。

    參數：
        election：選舉代碼。
    回傳：Path。
    """
    return layer_dir("fetch", election) / ELECTION_FILE


def election_ids():
    """列出已定義的選舉代碼。

    回傳：data/10-fetch/ 下含 election.yaml 的目錄名。
    """
    return defined_ids(DATA_DIR / LAYERS["fetch"], ELECTION_FILE)


def election_config(election):
    """讀取一場選舉的定義。

    參數：
        election：選舉代碼。
    回傳：見 read_definition。
    """
    return read_definition(election_path(election), election)


def topic_path(topic):
    """回傳一套主題測驗的定義檔位置。

    參數：
        topic：主題測驗的代碼。
    回傳：Path。
    """
    return TOPICS_DIR / topic / TOPIC_FILE


def topic_ids():
    """列出已定義的主題測驗代碼。

    回傳：data/topics/ 下含 topic.yaml 的目錄名。
    """
    return defined_ids(TOPICS_DIR, TOPIC_FILE)


def topic_config(topic):
    """讀取一套主題測驗的定義。

    參數：
        topic：主題測驗的代碼。
    回傳：見 read_definition。
    """
    return read_definition(topic_path(topic), topic)


def unique_index(entries, where, key="id"):
    """把定義的串列轉成以代碼為鍵的 dict。

    參數：
        entries：定義的串列，來源或軸。
        where：錯誤訊息中的位置。
        key：當成鍵的欄位。
    回傳：dict，順序與串列相同。
    例外：PipelineError，代碼重複。
    """
    index = {}
    # 依序加入，第一個重複的代碼就回報
    for entry in entries:
        # 同一個代碼有兩筆時，引用它會有兩種解讀
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
        read_yaml(SOURCES_PATH)["sources"], f"{relative(SOURCES_PATH)} 的 sources"
    )


# ==================================================
# 訊息與參數
# ==================================================


def log(message, name="pipeline"):
    """把進度與錯誤訊息寫入標準錯誤，標準輸出只保留各階段的摘要，方便以管線串接。

    參數：
        message：訊息文字。
        name：訊息開頭的程式名稱。
    """
    sys.stderr.write(f"[{name}] {message}\n")


def election_argument(parser, required=True):
    """替一支工具加上 `--election`，選舉代碼的寫法與說明只定義在這裡。

    參數：
        parser：工具的 ArgumentParser。
        required：True 時必填，處理全部選舉的工具傳 False。
    """
    parser.add_argument(
        "--election",
        required=required,
        help="選舉代碼，data/10-fetch/ 下含 election.yaml 的目錄名",
    )
