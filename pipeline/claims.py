"""主張層：核對手寫的主張表，產出受控欄位齊全的主張。

用途：讀抽取層的段落與名冊，核對 data/30-claims/{選舉}/claims.tsv 每則主張的原文起訖、受控欄位與審核欄，寫出 claims.json。
指令：`python -m pipeline claims --election <代碼>`
手寫輸入：claims.tsv，由政見編碼 skill 把段落拆成主張後填寫。
慣例：
  - 一則主張只含一項政策，同一段原文含多項政策時拆成多則，各自有起訖。
  - 受控欄位的每個值都要登錄在 config/tables/vocab-terms.tsv。未登錄的概念先寫進 vocab-pending.tsv，裁定前引用它時本層失敗。
  - 起訖以 Unicode 碼位計，迄不含，切出的文字要與原文欄一字不差。
  - 現任政府計畫只能標在現任者的主張上，現任者已完成的政績不收錄。
"""

from .common import PipelineError, layer_dir, load_product, write_product
from .tables import (
    check_review,
    parse_bool,
    parse_integer,
    read_config_table,
    read_optional,
    review_names,
    split_multi,
    table_hash,
)

# ---- 集中設定 ----

# 受控欄位：表頭的欄名對應產物的鍵，欄名同時是 vocab-terms.tsv 的欄位值
FIELDS = {
    "主體": "subject",
    "動作": "action",
    "對象": "target",
    "工具": "instrument",
    "受益": "beneficiary",
    "條件": "condition",
    "數量": "quantity",
    "時程": "schedule",
    "財源": "funding",
}

# 主張表的表頭
CLAIM_HEADER = [
    "代碼",
    "參選者",
    "段落",
    "原文起",
    "原文迄",
    "原文",
    *FIELDS,
    "現任政府計畫",
    "理由",
    "方法",
    "審核狀態",
]

# 待審詞的裁定
VERDICTS = {"pending": "待審", "adopted": "採用", "rejected": "駁回"}

# 詞表雜湊涵蓋的表，雜湊寫進產物與分享網址
VOCAB_TABLES = ["vocab-terms.tsv", "vocab-pending.tsv"]


def load_vocab():
    """讀取詞表與待審詞。

    回傳：`(names, pending, version)`。names 以 `(欄位, 名稱)` 對應詞的代碼，pending 是裁定為待審的 `(欄位, 名稱)`，version 是詞表中最大的加入版本，即已封閉的最新版本。
    例外：PipelineError，欄位不是受控欄位、同欄位名稱重複、裁定值未登錄，或已採用的詞沒有加入詞表。
    """
    terms = read_config_table("vocab-terms.tsv")
    names = {}
    # 逐詞建立 `(欄位, 名稱)` 到代碼的索引
    for row in terms:
        # 詞只能屬於 FIELDS 登錄的受控欄位
        if row["欄位"] not in FIELDS:
            raise PipelineError(
                f"vocab-terms.tsv 的 {row['代碼']} 欄位 {row['欄位']} 不是受控欄位"
            )
        key = (row["欄位"], row["名稱"])
        # 主張表以名稱引用詞，同欄位的名稱重複時無法決定代碼
        if key in names:
            raise PipelineError(
                f"vocab-terms.tsv 的 {row['欄位']}「{row['名稱']}」重複登錄"
            )
        names[key] = row["代碼"]
    # 待審詞以 `(欄位, 名稱)` 記錄
    pending = set()
    # 逐筆核對待審詞的裁定
    for row in read_config_table("vocab-pending.tsv"):
        # 裁定只能寫登錄的值
        if row["裁定"] not in VERDICTS.values():
            raise PipelineError(
                f"vocab-pending.tsv 的 {row['代碼']} 裁定寫了 {row['裁定']}"
            )
        key = (row["欄位"], row["名稱"])
        # 採用的詞要同時加入詞表，主張才能引用
        if row["裁定"] == VERDICTS["adopted"] and key not in names:
            raise PipelineError(
                f"vocab-pending.tsv 的 {row['代碼']} 已採用，但 vocab-terms.tsv 沒有這個詞"
            )
        # 待審的詞記下來，主張引用時回報待審而不是未登錄
        if row["裁定"] == VERDICTS["pending"]:
            pending.add(key)
    version = max(
        (
            parse_integer(row["加入版本"], f"vocab-terms.tsv 的 {row['代碼']}")
            for row in terms
        ),
        default=0,
    )
    return names, pending, version


def check_fields(row, names, pending, where):
    """核對一則主張的受控欄位。

    參數：
        row：claims.tsv 的一列。
        names、pending：load_vocab 的回傳值。
        where：錯誤訊息中的位置。
    回傳：`{產物鍵: [詞代碼, ...]}`，空值 `-` 為空串列。
    例外：PipelineError，引用了待審詞或未登錄的詞。
    """
    fields = {}
    # 依 FIELDS 逐欄核對
    for column, key in FIELDS.items():
        codes = []
        # 多值欄位逐值核對
        for value in split_multi(row[column]):
            # 待審詞在裁定前不能使用
            if (column, value) in pending:
                raise PipelineError(
                    f"{where} 的{column}引用了待審詞「{value}」，裁定前不能使用"
                )
            # 未登錄的概念要先寫進待審表
            if (column, value) not in names:
                raise PipelineError(
                    f"{where} 的{column}「{value}」不在詞表，先登錄到 vocab-pending.tsv 等待裁定"
                )
            codes.append(names[(column, value)])
        # 產物記詞的代碼，網站依代碼查名稱與說明
        fields[key] = codes
    return fields


def check_claim(row, passages, entities, review, vocab):
    """核對一則主張並轉成產物的形狀。

    參數：
        row：claims.tsv 的一列。
        passages：抽取層的段落，以代碼為鍵。
        entities：名冊對象，以代碼為鍵。
        review：review_names 的回傳值。
        vocab：(names, pending)。
    回傳：產物中的一則主張。
    例外：PipelineError，段落不存在、參選者與段落不同、起訖對不上原文、現任政府計畫標在非現任者，或審核欄未登錄。
    """
    where = f"claims.tsv 的 {row['代碼']}"
    passage = passages.get(row["段落"])
    # 主張要指到抽取層的段落，原文才能追溯到影像
    if passage is None:
        raise PipelineError(f"{where} 的段落 {row['段落']} 不在 extract.json")
    # 主張屬於段落的對象，不能借用別人的原文
    if row["參選者"] != passage["entity"]:
        raise PipelineError(f"{where} 的參選者與段落 {passage['id']} 的對象不同")
    # 起訖以碼位計，寫了整數以外的值時回報主張代碼
    start = parse_integer(row["原文起"], where)
    end = parse_integer(row["原文迄"], where)
    # 起訖切出的文字要與原文欄一字不差，網站以起訖在段落中標示原文
    if passage["text"][start:end] != row["原文"]:
        raise PipelineError(
            f"{where} 的原文與段落第 {start} 到 {end} 字不符，段落為「{passage['text'][start:end]}」"
        )
    plan = parse_bool(row["現任政府計畫"], where)
    # 以政府名義宣布的計畫只有現任者會有
    if plan and not entities[row["參選者"]]["incumbent"]:
        raise PipelineError(f"{where} 標註現任政府計畫，但參選者不是現任")
    check_review(row, review, where)
    return {
        "id": row["代碼"],
        "entity": row["參選者"],
        "passage": row["段落"],
        "start": start,
        "end": end,
        "quote": row["原文"],
        "fields": check_fields(row, *vocab, where),
        "incumbent_plan": plan,
        "reason": row["理由"],
        "method": row["方法"],
        "review_status": row["審核狀態"],
    }


def run(election_id):
    """執行主張層。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，詞表或主張不符規格。
    """
    upstream, carried = load_product("extract", election_id)
    passages = {passage["id"]: passage for passage in upstream["passages"]}
    entities = {entity["id"]: entity for entity in upstream["roster"]["entities"]}
    # 詞表與審核欄的登錄名稱在整張表共用
    names, pending, version = load_vocab()
    review = review_names()
    # 尚未編碼的選舉沒有主張表，產出空的主張清單
    rows = read_optional(layer_dir("claims", election_id) / "claims.tsv", CLAIM_HEADER)
    claims = [
        check_claim(row, passages, entities, review, (names, pending)) for row in rows
    ]
    # 產物記詞表版本與雜湊，分享網址以它確認同一套詞表
    own = {
        "claims": claims,
        "vocab": {"version": version, "hash": table_hash(VOCAB_TABLES)},
    }
    write_product("claims", election_id, own, carried)
    return f"claims {election_id}: {len(claims)} 則主張，詞表第 {version} 版"
