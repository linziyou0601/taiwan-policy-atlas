"""抽取階段的核對與產物：名冊、文件的文字、政見影像、OCR、逐字轉錄與遮蔽詞。

讀取抓取階段的 manifest，匯入名冊，抽取每份文件的文字層與政見影像並執行 OCR，再把手寫的轉錄稿與遮蔽詞核對後組成段落。步驟與轉錄的規則見 docs/pipeline/extract.md。

指令：
  `npm run pipeline -- extract run --election <代碼>`

手寫輸入：
  data/10-fetch/{選舉代碼}/election.yaml          選舉定義的 roster 與 documents
  data/20-extract/{選舉代碼}/scopes.tsv           選區表，選舉定義的 roster 寫 tables 時讀取
  data/20-extract/{選舉代碼}/roster.tsv           名冊表，選舉定義的 roster 寫 tables 時讀取
  data/20-extract/{選舉代碼}/transcripts.tsv      段落表，每段一列
  data/20-extract/{選舉代碼}/transcripts/         轉錄稿，每段一個檔
  data/20-extract/{選舉代碼}/aliases.tsv          名冊以外會洩漏身分的用語
  scripts/pipeline/tables/roster-characters.tsv   名冊姓名中的造字換成什麼字

產物：
  data/20-extract/{選舉代碼}/roster.json    名冊。名冊另存一檔，後面各階段以轉交清單引用
  data/20-extract/{選舉代碼}/extract.json   文件、OCR、段落與遮蔽詞，並轉交 roster.json
  data/20-extract/{選舉代碼}/images/        選舉定義 documents 的 images 列出的政見影像

慣例：
  - 段落的文字一律取自轉錄稿，辨識不出的字以〔?〕標示。OCR 只用來比對，找出可能漏字或誤讀的行，`extract ocr` 列出還要判斷的段落。
  - 姓名、搭檔與黨名由網站依名冊遮蔽，aliases.tsv 只登錄名冊以外的用語。
"""

import difflib
from collections import Counter

from ..adapters import capability
from ..common import (
    ROSTER_FILE,
    PipelineError,
    election_argument,
    election_config,
    layer_dir,
    load_product,
    product_path,
    read_json,
    reference,
    require,
    write_json,
    write_product,
)
from ..fetch.run import cached_path
from ..tables import (
    EMPTY,
    by_code,
    parse_bool,
    parse_integer,
    parse_optional,
    read_config_table,
    read_optional,
    read_table,
    review_fields,
    review_names,
    split_multi,
)
from ._vision import recognize

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "匯入名冊，抽取文件與政見影像，核對轉錄稿與遮蔽詞並寫出這個階段的產物"

# 轉錄稿中標示無法辨識的字，段落的 unresolved 計算它出現的次數
UNREADABLE = "〔?〕"

# 手寫表的表頭，依步驟順序。選區表與名冊表在選舉定義的 roster 寫 tables 時取代 adapter 匯入的名冊
SCOPE_HEADER = ["代碼", "名稱", "縣市", "涵蓋", "鄉鎮市區"]
ROSTER_HEADER = ["代碼", "姓名", "搭檔", "推薦政黨", "現任", "理由"]
# 段落表與遮蔽詞表
TRANSCRIPT_HEADER = [
    "代碼",
    "參選者",
    "文件",
    "影像",
    "頁",
    "轉錄檔",
    "理由",
    "方法",
    "審核狀態",
]
ALIAS_HEADER = ["代碼", "參選者", "詞", "類別", "說明"]

# OCR 行比對：少於這個字數的行不比對，最長相同片段占這行的比例低於門檻時列為找不到
UNMATCHED_MIN_LENGTH = 4
UNMATCHED_THRESHOLD = 0.6

# 轉錄稿與 OCR 的重合度低於這個值的段落，要對照影像判斷差異出在哪一邊
AGREEMENT_REVIEW = 0.95

# 產物中沿用選舉定義的欄位
ELECTION_FIELDS = ("id", "label", "year", "office", "entity_type", "scope_type")


# ==================================================
# 共用片段
# ==================================================


def comparable_text(text):
    """只留文字與數字，比對轉錄稿與 OCR 時忽略標點、空白與換行的差異。

    參數：
        text：文字。
    回傳：移除非文字數字字元後的字串。
    """
    return "".join(char for char in text if char.isalnum())


def ocr_check(transcript, lines):
    """比對轉錄稿與 OCR，找出要回頭看影像的地方。

    多欄版面的 OCR 行序與轉錄順序不同，因此以字元的多重集合比較，順序不影響結果。另外逐行找出在轉錄稿中找不到的 OCR 行，這些行可能是轉錄漏掉的字，也可能是 OCR 誤讀，編碼者逐行對照影像判斷。
    參數：
        transcript：轉錄稿。
        lines：OCR 的行。
    回傳：{"agreement", "unmatched"}。agreement 是兩邊字元重合的 F1，0 到 1，取四位小數。unmatched 是找不到的 OCR 行文字。
    """
    transcript_text = comparable_text(transcript)
    ocr_counts = Counter(comparable_text("".join(line["text"] for line in lines)))
    transcript_counts = Counter(transcript_text)
    # 兩邊共同出現的字數，同一字取兩邊次數的較小者
    overlap = sum((ocr_counts & transcript_counts).values())
    # 任一邊沒有字時無從比較
    if not overlap:
        return {"agreement": 0.0, "unmatched": [line["text"] for line in lines]}
    # 精確率以 OCR 為分母、召回率以轉錄稿為分母，F1 取兩者的調和平均
    precision = overlap / sum(ocr_counts.values())
    recall = overlap / sum(transcript_counts.values())
    unmatched = []
    # 逐行找轉錄稿中最長的相同片段，覆蓋不到門檻的行列出
    for line in lines:
        text = comparable_text(line["text"])
        # 太短的行多半是標點或頁碼，不列
        if len(text) < UNMATCHED_MIN_LENGTH:
            continue
        match = difflib.SequenceMatcher(
            None, text, transcript_text, autojunk=False
        ).find_longest_match(0, len(text), 0, len(transcript_text))
        # 最長相同片段不到這行的門檻比例，視為轉錄稿中找不到
        if match.size / len(text) < UNMATCHED_THRESHOLD:
            unmatched.append(line["text"])
    return {
        "agreement": round(2 * precision * recall / (precision + recall), 4),
        "unmatched": unmatched,
    }


def build_roster(directory, election):
    """讀手寫的選區表與名冊表，組成與名冊 adapter 相同格式的名冊。

    選舉資料庫還沒有這場選舉時，名冊依公報手寫在這兩張表，寫法見 docs/pipeline/extract.md 的名冊表。
    參數：
        directory：抽取階段的目錄。
        election：選舉定義，取 id 與 entity_type。
    回傳：{"scopes": [...], "entities": [...]}。選區依代碼排序，對象依選區與號次排序。
    例外：PipelineError，參選者的選區不在選區表、號次不是整數，或現任不是是或否。
    """
    # 選區代碼帶選舉代碼前綴，與 adapter 匯入的名冊同一種組法
    scopes = [
        {
            "id": f"{election['id']}:{row['代碼']}",
            "name": row["名稱"],
            "county": parse_optional(row["縣市"]),
            "areas": split_multi(row["涵蓋"]),
            "towns": split_multi(row["鄉鎮市區"]),
        }
        for row in read_table(directory / "scopes.tsv", SCOPE_HEADER)
    ]
    scope_ids = {scope["id"] for scope in scopes}
    entities = []
    # 每列一位參選者，副手寫在同一列的搭檔欄。轉錄前還沒有名冊表時只有選區
    for row in read_optional(directory / "roster.tsv", ROSTER_HEADER):
        where = f"roster.tsv 的 {row['代碼']}"
        # 代碼的最後一段是號次，前面是選區代碼
        scope_key, _, number = row["代碼"].rpartition("-")
        scope_id = f"{election['id']}:{scope_key}"
        # 參選者要屬於選區表的一個選區，地圖與選區清單才找得到這位參選者
        if scope_id not in scope_ids:
            raise PipelineError(f"{where} 的選區 {scope_key} 不在 scopes.tsv")
        # 號次轉成整數，對象代碼與排序都用數值
        number = parse_integer(number, where)
        entities.append(
            {
                "id": f"{scope_id}:{number}",
                "scope": scope_id,
                "number": number,
                "name": row["姓名"],
                "running_mate": parse_optional(row["搭檔"]),
                "party": row["推薦政黨"],
                "incumbent": parse_bool(row["現任"], where),
                "type": election["entity_type"],
            }
        )
    return {
        "scopes": scopes,
        "entities": sorted(
            entities, key=lambda entity: (entity["scope"], entity["number"])
        ),
    }


def current_roster(election_id):
    """取得一場選舉目前的名冊，抽取階段的工具在 `extract run` 之前也能讀取。

    名冊表的選舉直接由兩張表組成，轉錄時逐批補上的參選者立即可用；其他選舉讀取 `extract run` 匯入的名冊。
    參數：
        election_id：選舉代碼。
    回傳：{"scopes": [...], "entities": [...]}。
    例外：PipelineError，名冊表不符規格，或名冊還沒有匯入。
    """
    election = election_config(election_id)
    directory = layer_dir("extract", election_id)
    # 名冊表的選舉不經 extract run
    if election["roster"].get("tables"):
        return build_roster(directory, election)
    return read_json(
        directory / ROSTER_FILE,
        hint=f"先執行 `npm run pipeline -- extract run --election {election_id}`",
    )["roster"]


def check_transcript_row(row, entities, document_ids, images, review):
    """核對 transcripts.tsv 的一列。

    參數：
        row：一列。
        entities：名冊對象，以代碼為鍵。
        document_ids：本次抽出的文件代碼。
        images：本次抽出的影像代碼。
        review：review_names 的回傳值。
    回傳：review_fields 的結果。
    例外：PipelineError，參選者、文件或影像對不上，或審核欄未登錄。
    """
    where = f"transcripts.tsv 的 {row['代碼']}"
    # 參選者要在名冊，段落才能歸屬到一個對象
    if row["參選者"] not in entities:
        raise PipelineError(f"{where} 的參選者 {row['參選者']} 不在名冊")
    # 文件要登錄在選舉定義
    if row["文件"] not in document_ids:
        raise PipelineError(f"{where} 的文件 {row['文件']} 不在選舉定義的 documents")
    # 有指定影像時，影像要已抽出
    if row["影像"] != EMPTY and row["影像"] not in images:
        raise PipelineError(f"{where} 的影像 {row['影像']} 沒有抽出")
    return review_fields(row, review, where)


def build_passages(directory, entities, documents, ocr):
    """讀 transcripts.tsv 與轉錄稿，組成段落。

    參數：
        directory：這個階段的目錄。
        entities：名冊對象，以代碼為鍵。
        documents：本次抽出的文件。
        ocr：影像代碼對應 OCR 結果。
    回傳：段落串列，每段記對象、文件、影像、頁、文字、待核字數、OCR 比對結果與審核欄。
    例外：PipelineError，check_transcript_row 不通過或轉錄檔不存在。
    """
    review = review_names()
    # 文件與影像的代碼集合，核對每列引用的是本次抽出的檔案
    document_ids = {document["id"] for document in documents}
    images = {image["id"] for document in documents for image in document["images"]}
    passages = []
    # 每列一段，段落文字取自轉錄檔
    for row in read_optional(directory / "transcripts.tsv", TRANSCRIPT_HEADER):
        reviewed = check_transcript_row(row, entities, document_ids, images, review)
        # 轉錄稿是段落文字的唯一來源
        transcript = require(directory / "transcripts" / row["轉錄檔"], label="轉錄檔")
        text = transcript.read_text(encoding="utf-8").rstrip("\n")
        # 文字型來源沒有影像，影像欄記 None
        image = parse_optional(row["影像"])
        lines = ocr.get(image, {}).get("lines", [])
        passages.append(
            {
                "id": row["代碼"],
                "entity": row["參選者"],
                "document": row["文件"],
                "image": image,
                "page": parse_integer(row["頁"], f"transcripts.tsv 的 {row['代碼']}"),
                "text": text,
                "unresolved": text.count(UNREADABLE),
                # 沒有 OCR 的段落沒有比對結果
                "ocr_check": ocr_check(text, lines) if lines else None,
                "reason": row["理由"],
            }
            | reviewed
        )
    return passages


def build_aliases(directory, entities):
    """讀 aliases.tsv 的遮蔽詞。

    參數：
        directory：這個階段的目錄。
        entities：名冊對象，以代碼為鍵。
    回傳：{"entity", "term", "category"} 的串列。
    例外：PipelineError，參選者不在名冊或類別未登錄在 mask-categories.tsv。
    """
    categories = by_code(read_config_table("mask-categories.tsv"))
    aliases = []
    # 每列一個遮蔽詞
    for row in read_optional(directory / "aliases.tsv", ALIAS_HEADER):
        # 參選者與類別要是登錄的代碼，網站依類別換成遮蔽用語
        if row["參選者"] not in entities or row["類別"] not in categories:
            raise PipelineError(f"aliases.tsv 的 {row['代碼']} 參選者或類別未登錄")
        aliases.append(
            {"entity": row["參選者"], "term": row["詞"], "category": row["類別"]}
        )
    return aliases


def manifest_sources(election_id):
    """讀取抓取階段的 manifest，來源以代碼為鍵。

    參數：
        election_id：選舉代碼。
    回傳：`(manifest, carried, 以代碼為鍵的來源)`。manifest 記錄實際取得的檔案與 adapter 需要的欄位。
    例外：PipelineError，抓取階段產物不存在或雜湊不符。
    """
    manifest, carried = load_product("fetch", election_id)
    return manifest, carried, by_code(manifest["sources"], "id")


def extract_documents(election, sources, directory, previous):
    """抽取選舉定義列出的每份文件，並對政見影像做 OCR。

    參數：
        election：選舉定義。
        sources：manifest 的來源，以代碼為鍵，已併入來源登錄的欄位。
        directory：這個階段的目錄，影像寫在其下的 images/。
        previous：上一次的 extract.json，沒有時為空 dict，用於沿用 OCR 結果。
    回傳：`(文件串列, 影像代碼對應 OCR 結果)`。
    例外：PipelineError，來源的 adapter 不提供文件抽取。
    """
    documents = []
    ocr = {}
    # 依選舉定義的順序抽取，產物的文件順序與定義相同
    for document in election.get("documents", []):
        source = sources[document["source"]]
        # 自訂來源沒有快取檔，adapter 自行讀取 repo 內的路徑
        extract = capability(source["adapter"], "document")
        extracted = extract(cached_path(source), source, document, directory / "images")
        # 文件記下來源與授權，資料集頁依此標示
        documents.append(
            extracted
            | {
                "source": source["id"],
                "source_type": source["source_type"],
                "url": source["url"],
                "license": source["license"],
            }
        )
        # 每張政見影像都做 OCR，與轉錄稿對照
        for image in extracted["images"]:
            ocr[image["id"]] = recognize(
                directory / "images" / image["file"],
                previous.get("ocr", {}).get(image["id"]),
            )
    return documents, ocr


# ==================================================
# 主體
# ==================================================


def run(election_id, offline=False):
    """執行抽取階段。

    參數：
        election_id：選舉代碼。
        offline：各階段的 run 共用的參數，這個階段只讀取已下載的原始檔。
    回傳：摘要字串。
    例外：PipelineError，來源、adapter、手寫表或轉錄稿不符規格。
    """
    election = election_config(election_id)
    manifest, carried, sources = manifest_sources(election_id)
    directory = layer_dir("extract", election_id)
    # 名冊單獨寫檔，後面各階段以轉交清單引用。選舉資料庫還沒有這場選舉時讀手寫的名冊表
    if election["roster"].get("tables"):
        roster = build_roster(directory, election)
    # 其餘選舉由名冊來源的 adapter 匯入
    else:
        roster_source = sources[election["roster"]["source"]]
        roster = capability(roster_source["adapter"], "roster")(
            cached_path(roster_source), roster_source, election
        )
    # 兩種來源的名冊格式相同，後面各階段不分來源
    write_json(directory / ROSTER_FILE, {"roster": roster})
    # 這個階段產物的位置，同時是下次沿用 OCR 的來源
    previous_path = product_path("extract", election_id)
    # 上一次的產物用來沿用 OCR，第一次執行時沒有
    previous = read_json(previous_path) if previous_path.exists() else {}
    documents, ocr = extract_documents(election, sources, directory, previous)
    # 段落與遮蔽詞都以名冊核對參選者
    entities = by_code(roster["entities"], "id")
    own = {
        "election": {key: election[key] for key in ELECTION_FIELDS},
        "sources": manifest["sources"],
        "documents": documents,
        "ocr": ocr,
        "passages": build_passages(directory, entities, documents, ocr),
        "aliases": build_aliases(directory, entities),
    }
    write_product(
        "extract",
        election_id,
        own,
        carried | {"roster": reference(directory / ROSTER_FILE)},
    )
    return f"extract {election_id}: {len(roster['scopes'])} 選區、{len(roster['entities'])} 對象、{len(documents)} 份文件、{len(own['passages'])} 段"


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)


def main(args):
    """執行指令。

    參數：
        args：解析後的參數，使用 election。
    回傳：摘要字串。
    """
    return run(args.election)
