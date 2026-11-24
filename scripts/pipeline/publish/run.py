"""發布階段的核對與產物：把評分階段的產物整理成網站讀取的資料集，並寫出題組索引。

讀取 score.json 與它轉交的前面各階段，整理成資料集的總檔與選區檔，最後更新題組索引，索引列出各場選舉與各套主題測驗。步驟見 docs/pipeline/publish.md。

指令：
  `npm run pipeline -- publish run --election <代碼>`   發布一場選舉，發布後一併更新索引
  `npm run pipeline -- publish index`                    依已發布的選舉與主題測驗重寫索引，由同階段的 index 呼叫 write_index

手寫輸入：
  data/60-publish/{選舉代碼}/scope-areas.tsv   名冊寫不出村里的選區，以這張表完整定義涵蓋的鄉鎮市區與村里，見 _coverage.py
  另讀取 data/50-score/{選舉代碼}/score.json、config/tables/source-types.tsv，以及地圖階段的 data/geo/map.json 與 data/geo/villages/。

產物：
  data/60-publish/{選舉代碼}/dataset.json              總檔：資料版本、詞表雜湊、地圖版本、政見影像清單、選區檔清單與每個選區涵蓋的村里
  data/60-publish/{選舉代碼}/scopes/{選區代碼}.json    選區檔：這個選區的段落、OCR、主張、配題與具體度
  data/60-publish/index.json                           題組索引

慣例：
  - 資料版本是 manifest 以外的完整內容的 sha256 前 12 碼，同樣的內容得到同樣的版本，總檔與選區檔都記這個版本。
  - 總檔中選區層級的鍵只留沒有所屬選區的內容，網站選定選區後再讀取那個選區的選區檔。
  - 分數由網站依設定計算：立場彙總、涵蓋率與契合度都在網站算出，結果頁的每個數字因此可以代入參數重新計算。
  - 政見影像留在抽取階段的目錄，資料集以 manifest.assets 列出位置，網站建置時依清單複製。
"""

import shutil

from ..common import (
    election_argument,
    DATA_DIR,
    LAYERS,
    data_version,
    election_ids,
    format_fields,
    layer_dir,
    load_product,
    product_path,
    read_json,
    relative,
    topic_ids,
    topic_product_path,
    write_json,
)
from ..tables import by_code
from ._coverage import election_villages

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "寫出一場選舉的資料集總檔與選區檔，並更新題組索引"

# 題組索引的位置
INDEX_PATH = DATA_DIR / LAYERS["publish"] / "index.json"

# manifest 中各類筆數取自資料集的哪些鍵
COUNTED = ("scopes", "entities", "passages", "claims", "questions", "mappings")

# 依選區寫入選區檔的鍵
SCOPED_KEYS = ("passages", "ocr", "claims", "mappings", "specificity")

# 選區檔放在選舉發布目錄下的這個子目錄
SCOPE_DIR = "scopes"


def claim_source_types(upstream):
    """找出每則主張的來源類型。

    主張經段落、文件取得來源類型，網站依類型分開計算涵蓋率，也用於「只比較雙方都有的來源」模式。
    參數：
        upstream：score.json 與轉交內容合併後的 dict。
    回傳：主張代碼對應來源類型代碼。
    """
    documents = by_code(upstream["documents"], "id")
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
        documents：抽取階段的文件。
        extract_dir：抽取階段的目錄，影像在其下的 images/。
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
    例外：PipelineError，評分階段產物不存在或轉交檔已變更。
    """
    upstream, _ = load_product("score", election_id)
    roster = upstream["roster"]
    # 每個選區涵蓋的村里，網站依代碼合併村里畫出選區
    villages, map_version = election_villages(
        election_id, roster, upstream["election"]["year"]
    )
    # 主張的來源類型與各對象的主張數
    source_types = claim_source_types(upstream)
    counts = claim_counts(upstream["claims"], source_types)
    # 影像留在抽取階段目錄，資料集只記位置
    documents, assets = documents_with_assets(
        upstream["documents"], layer_dir("extract", election_id)
    )
    content = {
        "election": upstream["election"],
        "sources": upstream["sources"],
        "scopes": [
            scope | {"villages": villages.get(scope["id"], [])}
            for scope in scopes_with_coverage(
                roster["scopes"], roster["entities"], counts
            )
        ],
        "map": map_version,
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


def scope_parts(content):
    """把選區層級的內容依所屬選區分組。

    段落與主張依對象的選區，配題與具體度依主張，OCR 依引用影像的段落，沒有段落引用的影像沒有所屬選區。
    參數：
        content：build_dataset 的內容。
    回傳：選區代碼對應 {SCOPED_KEYS 的鍵: 內容}，沒有所屬選區的內容放在鍵 None。每個鍵都有值，沒有內容時是空串列或空 dict。
    """
    scope_of = {entity["id"]: entity["scope"] for entity in content["entities"]}
    claim_scope = {
        claim["id"]: scope_of[claim["entity"]] for claim in content["claims"]
    }
    # 有影像的段落把影像歸到段落所屬的選區
    image_scope = {
        passage["image"]: scope_of[passage["entity"]]
        for passage in content["passages"]
        if passage["image"]
    }
    # 每種內容的一筆屬於哪個選區，OCR 以影像代碼為鍵
    owners = {
        "passages": lambda row: scope_of[row["entity"]],
        "ocr": image_scope.get,
        "claims": lambda row: scope_of[row["entity"]],
        "mappings": lambda row: claim_scope[row["claim"]],
        "specificity": lambda row: claim_scope[row["claim"]],
    }
    parts = {}
    # 逐鍵逐筆依資料集內的順序放進所屬選區
    for key in SCOPED_KEYS:
        value = content[key]
        # OCR 是以影像代碼為鍵的 dict，其餘是串列
        if isinstance(value, dict):
            # 每張影像的 OCR 結果依影像代碼放進所屬選區
            for image, result in value.items():
                ocr = parts.setdefault(owners[key](image), {}).setdefault(key, {})
                ocr[image] = result
            # OCR 分完就換下一個鍵
            continue
        # 串列的每一筆依 owners 找到選區
        for row in value:
            parts.setdefault(owners[key](row), {}).setdefault(key, []).append(row)
    # 沒有內容的鍵寫成與原值同型的空值，讀取端不必判斷鍵是否存在
    return {
        scope: {key: part.get(key, type(content[key])()) for key in SCOPED_KEYS}
        for scope, part in parts.items()
    }


def write_scopes(election_id, parts, version):
    """寫出各選區的選區檔，先清掉上一次發布的選區檔。

    參數：
        election_id：選舉代碼。
        parts：scope_parts 的結果，不含鍵 None。
        version：資料集的資料版本。
    回傳：選區代碼對應選區檔的相對路徑，依選區代碼排序。
    """
    directory = layer_dir("publish", election_id) / SCOPE_DIR
    # 選區改名或沒有資料後，舊的選區檔不能留下
    shutil.rmtree(directory, ignore_errors=True)
    files = {}
    # 檔名是選區代碼去掉選舉代碼的部分
    for scope in sorted(parts):
        path = directory / f"{scope.removeprefix(f'{election_id}:')}.json"
        # 選區檔帶格式與資料版本，網站核對它與總檔是同一批
        manifest = format_fields("datasetScope") | {
            "election": election_id,
            "scope": scope,
            "data_version": version,
        }
        write_json(path, parts[scope] | {"manifest": manifest})
        files[scope] = relative(path)
    return files


def run(election_id, offline=False):
    """執行發布階段。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    """
    content, assets = build_dataset(election_id)
    version = data_version(content)
    parts = scope_parts(content)
    # 沒有所屬選區的內容留在總檔，其餘選區層級的鍵在總檔留空
    shared = parts.pop(None, {key: type(content[key])() for key in SCOPED_KEYS})
    # manifest 記版本、雜湊、筆數與選區檔，網站不必讀完整份資料就能列出選舉狀態
    manifest = format_fields("dataset") | {
        "election": election_id,
        "data_version": version,
        "vocab": content["vocab"],
        "has_policy_data": bool(content["claims"]),
        "assets": assets,
        "scope_files": write_scopes(election_id, parts, version),
        "counts": {key: len(content[key]) for key in COUNTED},
    }
    write_json(
        product_path("publish", election_id),
        content | shared | {"manifest": manifest},
    )
    return f"publish {election_id}: 資料版本 {version}，{len(parts)} 個選區檔"


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
        path = topic_product_path(topic)
        # 尚未發布的主題測驗不列入索引
        if not path.exists():
            continue
        # 索引只帶題組資訊、用到的卡片、資料集位置與 manifest
        dataset = read_json(path)
        topics.append(
            {
                key: dataset["topic"][key]
                for key in ("id", "label", "description", "cards")
            }
            | {
                "kind": "topic",
                "dataset": relative(path),
                "manifest": dataset["manifest"],
            }
        )
    write_json(
        INDEX_PATH,
        format_fields("index") | {"elections": elections, "topics": topics},
    )
    return f"index: {len(elections)} 場選舉，{len(topics)} 套主題測驗"


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return run(args.election)
