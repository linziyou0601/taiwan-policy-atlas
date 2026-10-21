"""抽取層：名冊、文件文字、政見影像、OCR、逐字轉錄與遮蔽詞。

讀取抓取層的 manifest，匯入名冊、抽取每份文件的文字層與政見影像並執行 OCR，再把手寫的轉錄稿與遮蔽詞核對後組成段落。

指令：
  `python -m pipeline extract --election <代碼>`

產物：
  - data/20-extract/{選舉}/roster.json：名冊，名冊大時與其他內容分開存，後面各層以轉交清單引用，不重複寫出。
  - data/20-extract/{選舉}/extract.json：文件、OCR、段落與遮蔽詞，並轉交 roster.json。
  - data/20-extract/{選舉}/images/：選舉設定 documents 的 images 列出的政見影像。

手寫輸入：
  - transcripts.tsv 與 transcripts/：每段政見的逐字轉錄，依政見收錄 skill 對照影像轉錄。
  - aliases.tsv：名冊以外會洩漏身分的用語，例如暱稱、口號、標誌文字。姓名、搭檔與黨名由網站依名冊自動遮蔽。

慣例：
  - 轉錄稿逐字記錄，無法辨識的字以〔?〕標示，不憑推測補齊。段落文字一律取自轉錄稿，OCR 只用於比對，找出可能漏字或誤讀的行。
"""

import difflib
from collections import Counter

from .adapters import capability
from .common import (
    ROSTER_FILE,
    PipelineError,
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
from .fetch import cached_path
from .ocr import recognize
from .tables import (
    EMPTY,
    by_code,
    parse_integer,
    parse_optional,
    read_config_table,
    read_optional,
    review_fields,
    review_names,
)

# ==================================================
# 集中設定
# ==================================================

# 轉錄稿中標示無法辨識的字，段落的 unresolved 計算它出現的次數
UNREADABLE = "〔?〕"

# 手寫表的表頭
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

# 產物中沿用選舉設定的欄位
ELECTION_FIELDS = ("id", "label", "year", "office", "entity_type", "scope_type")


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
    # 文件要在選舉設定中
    if row["文件"] not in document_ids:
        raise PipelineError(f"{where} 的文件 {row['文件']} 不在選舉設定的 documents")
    # 有指定影像時，影像要已抽出
    if row["影像"] != EMPTY and row["影像"] not in images:
        raise PipelineError(f"{where} 的影像 {row['影像']} 沒有抽出")
    return review_fields(row, review, where)


def build_passages(directory, entities, documents, ocr):
    """讀 transcripts.tsv 與轉錄稿，組成段落。

    參數：
        directory：本層目錄。
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
        directory：本層目錄。
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
    """讀取抓取層的 manifest，來源以代碼為鍵。

    參數：
        election_id：選舉代碼。
    回傳：`(manifest, carried, 以代碼為鍵的來源)`。manifest 記錄實際取得的檔案與 adapter 需要的欄位。
    例外：PipelineError，抓取層產物不存在或雜湊不符。
    """
    manifest, carried = load_product("fetch", election_id)
    return manifest, carried, by_code(manifest["sources"], "id")


def extract_documents(election, sources, directory, previous):
    """抽取選舉設定列出的每份文件，並對政見影像做 OCR。

    參數：
        election：選舉設定。
        sources：manifest 的來源，以代碼為鍵，已併入 sources.yaml 的設定欄位。
        directory：本層目錄，影像寫在其下的 images/。
        previous：上一次的 extract.json，沒有時為空 dict，用於沿用 OCR 結果。
    回傳：`(文件串列, 影像代碼對應 OCR 結果)`。
    例外：PipelineError，來源的 adapter 不提供文件抽取。
    """
    documents = []
    ocr = {}
    # 依選舉設定的順序抽取，產物的文件順序與設定相同
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


def run(election_id):
    """執行抽取層。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，來源、adapter、手寫表或轉錄稿不符規格。
    """
    election = election_config(election_id)
    manifest, carried, sources = manifest_sources(election_id)
    directory = layer_dir("extract", election_id)
    # 名冊單獨寫檔，後面各層以轉交清單引用
    roster_source = sources[election["roster"]["source"]]
    roster = capability(roster_source["adapter"], "roster")(
        cached_path(roster_source), roster_source, election
    )
    write_json(directory / ROSTER_FILE, {"roster": roster})
    # 本層產物的位置，同時是下次沿用 OCR 的來源
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
