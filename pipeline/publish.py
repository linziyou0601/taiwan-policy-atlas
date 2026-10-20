"""發布層：把評分層的產物整理成網站讀取的資料集。

用途：讀 score.json 與它轉交的前面各層，整理成 data/60-publish/{選舉}/dataset.json，附上資料版本、詞表雜湊與政見影像清單，並更新題組索引 data/60-publish/index.json。索引列出各場選舉與各套主題測驗。
指令：`python -m pipeline publish --election <代碼>`，每次發布後一併更新索引。
慣例：
  - 資料版本是資料集內容（不含 manifest）的 sha256 前 12 碼，同樣的內容得到同樣的版本，分享網址以它核對。
  - 發布層不計算分數，立場彙總、涵蓋率與契合度都由網站依設定計算，結果頁的每個數字才能代入參數重算。
  - 政見影像留在抽取層目錄，資料集以 manifest.assets 列出位置，前端建置依清單複製。
"""

from .common import (
    DATA_DIR,
    LAYERS,
    app_settings,
    canonical_bytes,
    election_ids,
    load_product,
    product_path,
    read_json,
    relative,
    sha256_bytes,
    topic_ids,
    write_json,
)
from .topic import product_path as topic_path

# ---- 集中設定 ----

# 資料集的格式名稱與版本，取自 settings.json 的 `formats.dataset`，網站載入時以同一份設定核對，格式改版時在那裡遞增
FORMAT = app_settings()["formats"]["dataset"]

# 題組索引的格式名稱與版本，取自 settings.json 的 `formats.index`，網站載入索引時以同一份設定核對
INDEX_FORMAT = app_settings()["formats"]["index"]

# 資料版本取 sha256 的前幾碼，12 碼足以區分各次發布並保持網址簡短
VERSION_LENGTH = 12

# 題組索引的位置
INDEX_PATH = DATA_DIR / LAYERS["publish"] / "index.json"

# manifest 中各類筆數取自資料集的哪些鍵
COUNTED = ("scopes", "entities", "passages", "claims", "questions", "mappings")


def data_version(content):
    """計算資料集內容的版本碼。

    參數：
        content：不含 manifest 的資料集內容。
    回傳：canonical_bytes 的 sha256 前 VERSION_LENGTH 碼。
    """
    return sha256_bytes(canonical_bytes(content))[:VERSION_LENGTH]


def claim_source_types(upstream):
    """找出每則主張的來源類型。

    主張經段落、文件取得來源類型，網站依類型分開計算涵蓋率，也用於「只比雙方都有的來源」模式。
    參數：
        upstream：score.json 與轉交內容合併後的 dict。
    回傳：主張代碼對應來源類型代碼。
    """
    documents = {document["id"]: document for document in upstream["documents"]}
    passage_type = {
        passage["id"]: documents[passage["document"]]["source_type"]
        for passage in upstream["passages"]
    }
    return {claim["id"]: passage_type[claim["passage"]] for claim in upstream["claims"]}


def claim_counts(claims, source_types):
    """計算每個對象依來源類型分開的主張數。

    參數：
        claims：主張串列。
        source_types：claim_source_types 的結果。
    回傳：對象代碼對應 {來源類型: 主張數}。
    """
    counts = {}
    # 逐則主張累加到所屬對象與來源類型
    for claim in claims:
        by_type = counts.setdefault(claim["entity"], {})
        # 同一來源類型的主張數加一
        kind = source_types[claim["id"]]
        by_type[kind] = by_type.get(kind, 0) + 1
    return counts


def scopes_with_coverage(scopes, entities, counts):
    """標示每個選區有沒有政見資料，選區頁以它明示缺口。

    參數：
        scopes：名冊的選區。
        entities：名冊的對象。
        counts：claim_counts 的結果。
    回傳：每個選區加上 has_policy_data。
    """
    scoped = {}
    # 依選區分組對象代碼
    for entity in entities:
        scoped.setdefault(entity["scope"], []).append(entity["id"])
    result = []
    # 選區內任一對象有主張就算有政見資料
    for scope in scopes:
        covered = any(
            counts.get(entity_id) for entity_id in scoped.get(scope["id"], [])
        )
        result.append(scope | {"has_policy_data": covered})
    return result


def documents_with_assets(documents, extract_dir):
    """補上政見影像的位置，並列出要由前端建置複製的檔案。

    參數：
        documents：抽取層的文件。
        extract_dir：抽取層的目錄，影像在其下的 images/。
    回傳：`(文件串列, 影像相對路徑串列)`。
    """
    assets = []
    result = []
    # 逐份文件、逐張影像補上相對於專案根目錄的位置
    for document in documents:
        images = []
        # 影像位置同時記在文件中與資產清單
        for image in document["images"]:
            # 位置相對於專案根目錄，前端建置依它複製
            path = relative(extract_dir / "images" / image["file"])
            assets.append(path)
            images.append(image | {"path": path})
        # 文件帶著補上位置的影像清單
        result.append(document | {"images": images})
    return result, sorted(assets)


def build_dataset(election_id):
    """組成一場選舉的資料集內容。

    參數：
        election_id：選舉代碼。
    回傳：(content, assets)。content 不含 manifest，assets 是政見影像的相對路徑。
    例外：PipelineError，評分層產物不存在或轉交檔已變更。
    """
    upstream, _ = load_product("score", election_id)
    roster = upstream["roster"]
    # 主張的來源類型與各對象的主張數
    source_types = claim_source_types(upstream)
    counts = claim_counts(upstream["claims"], source_types)
    # 影像留在抽取層目錄，資料集只記位置
    documents, assets = documents_with_assets(
        upstream["documents"], product_path("extract", election_id).parent
    )
    content = {
        "election": upstream["election"],
        "sources": upstream["sources"],
        "scopes": scopes_with_coverage(roster["scopes"], roster["entities"], counts),
        "entities": [
            entity | {"claim_counts": counts.get(entity["id"], {})}
            for entity in roster["entities"]
        ],
        "aliases": upstream["aliases"],
        "documents": documents,
        "ocr": upstream["ocr"],
        "passages": upstream["passages"],
        "claims": [
            claim | {"source_type": source_types[claim["id"]]}
            for claim in upstream["claims"]
        ],
        "questions": upstream["questions"],
        "mappings": upstream["mappings"],
        "question_axes": upstream["question_axes"],
        "specificity": upstream["specificity"],
        "neutrality": upstream["neutrality"],
        "vocab": upstream["vocab"],
    }
    return content, assets


def run(election_id):
    """執行發布層。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    """
    content, assets = build_dataset(election_id)
    # manifest 記版本、雜湊與筆數，網站不必讀完整份資料就能列出選舉狀態
    manifest = {
        "format": FORMAT["name"],
        "format_version": FORMAT["version"],
        "election": election_id,
        "data_version": data_version(content),
        "vocab": content["vocab"],
        "has_policy_data": bool(content["claims"]),
        "assets": assets,
        "counts": {key: len(content[key]) for key in COUNTED},
    }
    write_json(product_path("publish", election_id), content | {"manifest": manifest})
    return f"publish {election_id}: 資料版本 {manifest['data_version']}"


def write_index():
    """依已發布的選舉資料集與主題測驗寫出題組索引。

    索引的每一筆帶 kind，網站依種類選用模型、計分與卡片。
    回傳：摘要字串。
    """
    elections = []
    # 依選舉代碼的碼位順序列入，網站依年度與職位重新分組
    for election_id in election_ids():
        path = product_path("publish", election_id)
        # 尚未發布的選舉不列入索引
        if not path.exists():
            continue
        # 索引只帶選舉資訊、資料集位置與 manifest，不帶資料本身
        dataset = read_json(path)
        # 只有一個選區的選舉（例如總統）寫出預設選區，網站選定選舉後直接選取
        only = dataset["scopes"][0]["id"] if len(dataset["scopes"]) == 1 else None
        elections.append(
            dataset["election"]
            | {
                "kind": "election",
                "dataset": relative(path),
                "default_scope": only,
                "manifest": dataset["manifest"],
            }
        )
    topics = []
    # 主題測驗依代碼順序列入
    for topic in topic_ids():
        path = topic_path(topic)
        # 尚未發布的主題測驗不列入索引
        if not path.exists():
            continue
        # 索引只帶題組資訊、用到的卡片、資料集位置與 manifest
        dataset = read_json(path)
        topics.append(
            {key: dataset["topic"][key] for key in ("id", "label", "description", "cards")}
            | {"kind": "topic", "dataset": relative(path), "manifest": dataset["manifest"]}
        )
    write_json(
        INDEX_PATH,
        {
            "format": INDEX_FORMAT["name"],
            "format_version": INDEX_FORMAT["version"],
            "elections": elections,
            "topics": topics,
        },
    )
    return f"index: {len(elections)} 場選舉，{len(topics)} 套主題測驗"
