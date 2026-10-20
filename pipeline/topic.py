"""主題測驗：把手寫的題目、選項、軸對應與參照點發布成網站的題組。

用途：讀 config/pipeline/topics/{代碼}.yaml 與 data/topics/{代碼}/ 的手寫表，設定宣告了 check 時以原始檔核對，宣告了 comparisons 時取出對照資料，寫出 data/60-publish/topics/{代碼}/dataset.json。
指令：`python -m pipeline topic [--topic <代碼>] [--offline]`，省略代碼時發布全部主題測驗，發布後更新索引。
手寫輸入：
  - questions.tsv：題目。原文欄寫原始問卷或測驗的文字，題目欄寫網站顯示的題目，簡稱欄寫分享圖片這類窄處用的短名，說明欄寫節錄或補充，出處欄寫原文或節錄的來源，沒有時寫 -。
  - options.tsv：單選題的選項，選填。列在這張表的題目以這些選項作答，不進任何軸。其餘題目用五級量尺，要有軸對應。
  - question-axes.tsv：題目對軸的方向與權重，與選舉的 question-axes.tsv 同一種寫法，網站以同一條公式推算軸上的位置。
  - references.tsv：參照點。位置欄以頓號分隔「軸=位置」，每條軸都要有值。
慣例：
  - 主題測驗不經過選舉的各層，原始檔登錄在題組自己的設定 sources，刪掉題組的設定與手寫表，題組的來源與對照資料就一併移除。
  - 核對比的是原文、權重與位置，翻譯不核對，翻譯改了題意雜湊跟著改，舊答案移到待確認紀錄。
  - 對照資料只放進題組，網站依題組顯示，程式不寫死任何一題或一個來源。
"""

from . import fetch
from .adapters import ADAPTERS
from .common import (
    DATA_DIR,
    LAYERS,
    ROOT,
    PipelineError,
    app_settings,
    canonical_bytes,
    relative,
    sha256_bytes,
    sha256_text,
    sources_config,
    topic_config,
    write_json,
)
from .tables import EMPTY, parse_integer, parse_number, read_optional, read_table, split_multi

# ---- 集中設定 ----

# 題組的格式名稱與版本，取自 settings.json 的 `formats.topic`，網站載入時以同一份設定核對
FORMAT = app_settings()["formats"]["topic"]

# 題目表與選項表的表頭
QUESTION_HEADER = ["代碼", "原文", "題目", "簡稱", "說明", "出處"]
OPTION_HEADER = ["代碼", "題目", "名稱"]
# 軸對應與參照點的表頭
AXIS_HEADER = ["代碼", "題目", "軸", "方向", "權重"]
REFERENCE_HEADER = ["代碼", "原文", "名稱", "位置"]

# 方向只有兩種：同意時往正極或負極
DIRECTIONS = {1, -1}

# 資料版本取 sha256 的前幾碼，與選舉資料集相同
VERSION_LENGTH = 12

# 參照點位置的範圍，與網站的軸範圍相同
AXIS_RANGE = app_settings()["ideology"]

# 位置欄中軸與值的分隔字元
POSITION_SEPARATOR = "="

# 題組資訊中寫進資料集與索引的設定鍵
TOPIC_FIELDS = ("id", "label", "description", "origin", "note", "distance", "cards")

# 資料集的 manifest 列出筆數的鍵
COUNTED = ("axes", "questions", "references")


def topic_dir(topic):
    """手寫表的目錄。

    參數：
        topic：題組代碼。
    回傳：Path。
    """
    return DATA_DIR / "topics" / topic


def product_path(topic):
    """發布檔的位置。

    參數：
        topic：題組代碼。
    回傳：Path。
    """
    return DATA_DIR / LAYERS["publish"] / "topics" / topic / "dataset.json"


def cell(value):
    """把空值 - 換成 None。

    參數：
        value：儲存格文字。
    回傳：字串或 None。
    """
    return None if value == EMPTY else value


# ---- 核對 ----


def topic_sources(config):
    """讀出題組自己登錄的原始檔。

    參數：
        config：主題測驗設定。
    回傳：來源代碼對應登錄內容。
    例外：PipelineError，代碼重複，或與 sources.yaml 的代碼相同。來源的快取目錄以代碼命名，代碼相同時會共用同一個快取。
    """
    entries = config.get("sources", [])
    registry = {entry["id"]: entry for entry in entries}
    # 轉成 dict 後筆數變少表示代碼重複
    if len(registry) != len(entries):
        raise PipelineError(f"topics/{config['id']}.yaml 的 sources 有重複的代碼")
    clashes = sorted(set(registry) & set(sources_config()))
    # 與共用來源同名時兩者會共用同一個快取目錄
    if clashes:
        raise PipelineError(f"topics/{config['id']}.yaml 的來源 {'、'.join(clashes)} 與 sources.yaml 的代碼相同")
    return registry


def fetch_source(config, registry, source_id, offline, capability):
    """取得一個原始檔並找出處理它的 adapter 能力。

    參數：
        config：主題測驗設定。
        registry：topic_sources 的結果。
        source_id：來源代碼。
        offline：True 時只用快取。
        capability：adapter 的能力名稱，例如 topic 或 comparison。
    回傳：`(抓取紀錄, 處理函式)`。
    例外：PipelineError，來源沒有登錄，或 adapter 沒有這種能力。
    """
    # 引用的來源要登錄在題組的 sources
    if source_id not in registry:
        raise PipelineError(f"topics/{config['id']}.yaml 引用的來源 {source_id} 沒有登錄在 sources")
    # 能力由來源登錄的 adapter 決定
    source = registry[source_id]
    handler = ADAPTERS.get(source["adapter"], {}).get(capability)
    # adapter 要提供需要的能力
    if handler is None:
        raise PipelineError(f"adapter {source['adapter']} 沒有 {capability} 能力")
    return fetch.ensure_source(source, offline), handler


def check_axes(config):
    """核對設定的軸與門檻，組成產物的軸。

    參數：
        config：主題測驗設定。
    回傳：軸的串列，每條軸帶 bands（門檻與標籤）。
    例外：PipelineError，軸代碼重複、標籤數與門檻數不同，或次方不大於 0。
    """
    bands = config["bands"]
    axes = []
    # 逐軸把門檻與標籤配成一級一筆
    for axis in config["axes"]:
        # 每一級都要有標籤
        if len(axis["labels"]) != len(bands):
            raise PipelineError(
                f"topics/{config['id']}.yaml 的軸 {axis['code']} 有 {len(axis['labels'])} 個標籤，門檻有 {len(bands)} 級"
            )
        # 次方決定距離的形狀，0 以下沒有意義
        if axis["power"] <= 0:
            raise PipelineError(f"topics/{config['id']}.yaml 的軸 {axis['code']} 的次方要大於 0")
        axes.append(
            {key: axis[key] for key in ("code", "name", "negative", "positive", "power")}
            | {"bands": [band | {"label": label} for band, label in zip(bands, axis["labels"])]}
        )
    # 軸代碼是手寫表與網站的鍵，不能重複
    if len({axis["code"] for axis in axes}) != len(axes):
        raise PipelineError(f"topics/{config['id']}.yaml 的軸代碼重複")
    return axes


def option_rows(rows, questions):
    """依題目分組選項。

    參數：
        rows：options.tsv 的列，沒有這張表時為空串列。
        questions：題目代碼的集合。
    回傳：題目代碼對應選項串列，選項依代碼排列。
    例外：PipelineError，選項指向未登錄的題目，或一題只有一個選項。
    """
    options = {}
    # 逐列歸到所屬的題目
    for row in rows:
        # 選項要屬於題目表的題目
        if row["題目"] not in questions:
            raise PipelineError(f"options.tsv 的 {row['代碼']} 指向未登錄的題目 {row['題目']}")
        options.setdefault(row["題目"], []).append({"id": row["代碼"], "name": row["名稱"]})
    # 找出只有一個選項的題目
    single = sorted(question for question, items in options.items() if len(items) < 2)
    # 只有一個選項的題目無從選擇
    if single:
        raise PipelineError(f"options.tsv 的題目 {'、'.join(single)} 只有一個選項")
    return options


def question_rows(rows, options):
    """把題目表轉成產物的題目，並附上題意雜湊。

    參數：
        rows：questions.tsv 的列。
        options：option_rows 的結果。
    回傳：題目串列，依代碼排列。單選題的 options 是選項串列，量尺題為 None。
    """
    questions = []
    # 雜湊涵蓋題目、說明與選項名稱，譯文、節錄或選項改了就是不同的題意
    for row in rows:
        choices = options.get(row["代碼"])
        # 量尺題沒有選項，雜湊只含題目與說明
        names = [option["name"] for option in choices] if choices else []
        questions.append(
            {
                "id": row["代碼"],
                "stem": row["題目"],
                "short": cell(row["簡稱"]),
                "original": cell(row["原文"]),
                "note": cell(row["說明"]),
                "source": cell(row["出處"]),
                "options": choices,
                "hash": sha256_text("\n".join([row["題目"], row["說明"], *names])),
            }
        )
    return questions


def axis_rows(rows, questions, axes):
    """核對題目對軸的對應。

    參數：
        rows：question-axes.tsv 的列。
        questions：question_rows 的結果。
        axes：軸代碼的集合。
    回傳：產物的對應串列。
    例外：PipelineError，題目或軸未登錄、指向單選題、方向不是 1 或 -1、權重不大於 0，或量尺題沒有任何對應。
    """
    scaled = {question["id"] for question in questions if not question["options"]}
    links = []
    # 逐列核對代碼與數值
    for row in rows:
        where = f"question-axes.tsv 的 {row['代碼']}"
        # 題目要是量尺題，軸要是登錄的代碼。單選題的選項沒有方向，不進軸
        if row["題目"] not in scaled or row["軸"] not in axes:
            raise PipelineError(f"{where} 的題目不是量尺題，或軸未登錄")
        # 方向與權重轉成數字後核對範圍
        direction = parse_integer(row["方向"], where)
        weight = parse_number(row["權重"], where)
        # 方向決定同意時往哪一極，權重決定這題在軸上的份量
        if direction not in DIRECTIONS or weight is None or weight <= 0:
            raise PipelineError(f"{where} 的方向要是 1 或 -1，權重要大於 0")
        links.append({"id": row["代碼"], "question": row["題目"], "axis": row["軸"], "direction": direction, "weight": weight})
    # 沒有軸對應的量尺題不影響任何結果，多半是漏寫
    missing = sorted(scaled - {link["question"] for link in links})
    # 有漏寫時列出全部題目代碼
    if missing:
        raise PipelineError(f"question-axes.tsv 沒有寫到量尺題 {'、'.join(missing)}")
    return links


def reference_rows(rows, axes):
    """解析參照點的位置。

    參數：
        rows：references.tsv 的列。
        axes：軸代碼的集合。
    回傳：參照點串列，position 是軸代碼對應位置。
    例外：PipelineError，位置的寫法不對、缺軸、軸未登錄或超出範圍。
    """
    references = []
    # 逐列拆開位置欄
    for row in rows:
        where = f"references.tsv 的 {row['代碼']}"
        position = {}
        # 每一段是「軸=位置」
        for part in split_multi(row["位置"]):
            axis, separator, value = part.partition(POSITION_SEPARATOR)
            # 缺了等號就分不出軸與位置
            if not separator:
                raise PipelineError(f"{where} 的位置 {part} 要寫成 軸=位置")
            position[axis] = parse_number(value, where)
        # 每條軸都要有位置，距離才能逐軸計算
        if set(position) != axes:
            raise PipelineError(f"{where} 的位置要剛好寫出 {'、'.join(sorted(axes))}")
        # 位置要落在軸的範圍內
        if any(not AXIS_RANGE["min"] <= value <= AXIS_RANGE["max"] for value in position.values()):
            raise PipelineError(f"{where} 的位置超出 {AXIS_RANGE['min']} 到 {AXIS_RANGE['max']}")
        references.append({"id": row["代碼"], "name": row["名稱"], "original": cell(row["原文"]), "position": position})
    return references


def check_original(config, registry, questions, links, references, offline):
    """以原始檔核對手寫表，回傳授權全文與用到的來源。

    參數：
        config：主題測驗設定。
        registry：topic_sources 的結果。
        questions、links、references：已解析的手寫表。
        offline：True 時只用快取。
    回傳：`(授權全文, 抓取紀錄串列)`，設定沒有 check 時為 `(None, [])`。
    例外：PipelineError，來源未登錄、adapter 沒有 topic 能力，或原文、權重、位置與原始檔不同。
    """
    roles = config.get("check")
    # 沒有原始檔的題組只靠手寫表
    if not roles:
        return None, []
    # check 的每個角色各取一個來源，題目來源的 adapter 讀出全部角色
    fetched = {role: fetch_source(config, registry, source_id, offline, "topic") for role, source_id in roles.items()}
    extract = fetched["questions"][1]
    original = extract({role: ROOT / entry["file"] for role, (entry, _) in fetched.items()})
    # 題目依代碼排列後與原始順序逐題比對原文
    if [question["original"] for question in questions] != [item["original"] for item in original["questions"]]:
        raise PipelineError("questions.tsv 的原文與原始檔的題目順序或文字不同")
    effects = {}
    # 手寫的方向乘權重要等於原始檔的權重
    for link in links:
        effects.setdefault(link["question"], {})[link["axis"]] = link["direction"] * link["weight"]
    # 逐題比對各軸權重
    for question, item in zip(questions, original["questions"]):
        # 原始檔的權重可能是整數，比對時一律換成浮點數
        if effects.get(question["id"], {}) != {axis: float(value) for axis, value in item["effects"].items()}:
            raise PipelineError(f"question-axes.tsv 的 {question['id']} 與原始檔的權重不同")
    # 參照點依原文名稱建索引
    by_original = {item["original"]: item["position"] for item in original["references"]}
    # 參照點以原文名稱對應，位置要相同
    for reference in references:
        expected = by_original.get(reference["original"])
        # 名稱找不到或位置不同都要修正手寫表
        if expected is None or reference["position"] != {axis: float(value) for axis, value in expected.items()}:
            raise PipelineError(f"references.tsv 的 {reference['id']} 與原始檔不同")
    # 原始檔的參照點都要收錄
    if len(references) != len(original["references"]):
        raise PipelineError("references.tsv 的筆數與原始檔不同")
    return original["license"], [entry for entry, _ in fetched.values()]


def comparisons(config, registry, questions, offline):
    """組成單選題的對照資料。

    設定的 comparisons 每筆對應一題單選題：寫了 source 時由該來源的 adapter 取出各選項的比例，只寫 label 與 url 時只附來源連結。
    參數：
        config：主題測驗設定。
        registry：topic_sources 的結果。
        questions：question_rows 的結果。
        offline：True 時只用快取。
    回傳：`(對照串列, 抓取紀錄串列)`。
    例外：PipelineError，題目不是單選題、選項對不上，或原文不是以來源的題目開頭。
    """
    by_id = {question["id"]: question for question in questions}
    results = []
    entries = []
    # 逐筆對照取出資料
    for spec in config.get("comparisons", []):
        question = by_id.get(spec["question"])
        # 對照只用於單選題
        if not question or not question["options"]:
            raise PipelineError(f"topics/{config['id']}.yaml 的對照 {spec['question']} 不是單選題")
        # 只附連結的對照沒有比例
        if "source" not in spec:
            results.append({"question": question["id"], "label": spec["label"], "url": spec["url"], "shares": None})
            continue
        # 由來源的 adapter 取出最新一期的比例
        entry, extract = fetch_source(config, registry, spec["source"], offline, "comparison")
        entries.append(entry)
        found = extract(ROOT / entry["file"], spec)
        # 設定的選項對應要涵蓋這題的全部選項
        if set(spec["options"]) != {option["id"] for option in question["options"]}:
            raise PipelineError(f"topics/{config['id']}.yaml 的對照 {question['id']} 的選項與 options.tsv 不同")
        # 來源只記題目的開頭，原文要以它開頭，比例才是同一題的結果
        if not (question["original"] or "").startswith(found["question"]):
            raise PipelineError(f"questions.tsv 的 {question['id']} 原文不是以對照來源的題目開頭")
        results.append({"question": question["id"], "url": spec["url"]} | {key: found[key] for key in ("label", "date", "sample", "conductor", "shares", "none")})
    return results, entries


# ---- 主體 ----


def build_dataset(topic, offline):
    """組成一套主題測驗的題組內容。

    參數：
        topic：題組代碼。
        offline：True 時只用快取。
    回傳：不含 manifest 的內容。
    """
    config = topic_config(topic)
    folder = topic_dir(topic)
    registry = topic_sources(config)
    # 先核對設定的軸，手寫表的軸欄要寫這些代碼
    axes = check_axes(config)
    axis_codes = {axis["code"] for axis in axes}
    rows = read_table(folder / "questions.tsv", QUESTION_HEADER)
    # 沒有選項表時全部題目都用量尺
    options = option_rows(read_optional(folder / "options.tsv", OPTION_HEADER), {row["代碼"] for row in rows})
    questions = question_rows(rows, options)
    # 軸對應的題目欄要寫量尺題的代碼
    links = axis_rows(read_table(folder / "question-axes.tsv", AXIS_HEADER), questions, axis_codes)
    references = reference_rows(read_table(folder / "references.tsv", REFERENCE_HEADER), axis_codes)
    # 手寫表都讀完後才以原始檔核對，再取出對照資料
    license_text, checked = check_original(config, registry, questions, links, references, offline)
    compared, compared_entries = comparisons(config, registry, questions, offline)
    # 來源只列一次，依代碼排列
    used = {entry["id"]: entry for entry in [*checked, *compared_entries]}
    return {
        "topic": {key: config.get(key) for key in TOPIC_FIELDS},
        "sources": [{key: used[source_id][key] for key in ("id", "name", "url", "sha256", "license")} for source_id in sorted(used)],
        "license": license_text,
        "axes": axes,
        "questions": questions,
        "question_axes": links,
        "references": references,
        "comparisons": compared,
    }


def run(topic, offline=False):
    """發布一套主題測驗。

    參數：
        topic：題組代碼。
        offline：True 時只用快取。
    回傳：摘要字串。
    """
    content = build_dataset(topic, offline)
    # 資料版本是內容的雜湊前綴，分享連結以它核對
    manifest = {
        "format": FORMAT["name"],
        "format_version": FORMAT["version"],
        "topic": topic,
        "data_version": sha256_bytes(canonical_bytes(content))[:VERSION_LENGTH],
        "assets": [],
        "counts": {key: len(content[key]) for key in COUNTED},
    }
    path = product_path(topic)
    write_json(path, content | {"manifest": manifest})
    return f"topic {topic}: 資料版本 {manifest['data_version']}，{relative(path)}"
