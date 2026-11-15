"""主張階段的核對與產物：核對手寫的主張表，寫出受控欄位齊全的主張。

讀取抽取階段的段落與名冊，核對主張表每則主張的原文起訖、受控欄位與審核欄。拆分與欄位的規則見 docs/pipeline/claims.md。

指令：
  `npm run pipeline -- claims run --election <代碼>`

手寫輸入：
  data/30-claims/{選舉代碼}/claims.tsv   每則主張一列，草稿以 `claims merge` 寫入，起訖以 `claims offsets` 填寫
  config/tables/vocab-terms.tsv          受控欄位可以寫的詞

產物：
  data/30-claims/{選舉代碼}/claims.json   主張與受控欄位、詞表的版本與雜湊

慣例：
  - 受控欄位的每個值都要是詞表採用的詞。待審的詞裁定之前，引用它的主張讓這個階段失敗。
  - 起訖以 Unicode 碼位計，迄的位置在原文之後，切出的文字要與原文欄一字不差。
  - 現任政府計畫只能標在名冊標為現任的參選者的主張上。
"""

from ..common import (
    PipelineError,
    election_argument,
    layer_dir,
    load_product,
    write_product,
)
from ..tables import (
    EMPTY,
    by_code,
    parse_bool,
    parse_integer,
    read_config_table,
    read_optional,
    review_fields,
    review_names,
    split_multi,
    table_hash,
)

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "核對主張表並寫出這個階段的產物"

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

# 詞的狀態：採用的詞主張才能引用，待審的詞等待裁定
STATUSES = {"adopted": "採用", "pending": "待審"}

# 詞表雜湊涵蓋的表，雜湊寫入產物與分享網址
VOCAB_TABLES = ["vocab-terms.tsv"]


def load_vocab():
    """讀取詞表，採用與待審的詞分開索引。

    回傳：`(names, pending, version)`。names 以 `(欄位, 名稱)` 對應採用詞的代碼，pending 是待審詞的 `(欄位, 名稱)`，version 是採用詞中最大的加入版本，即已封閉的最新版本。
    例外：PipelineError，欄位不是受控欄位、同欄位名稱重複、狀態未登錄，或加入版本與狀態不符。
    """
    terms = read_config_table("vocab-terms.tsv")
    # 採用詞的代碼索引、待審詞與採用詞的加入版本
    names = {}
    pending = set()
    versions = []
    # 逐詞核對欄位、名稱與狀態
    for row in terms:
        where = f"vocab-terms.tsv 的 {row['代碼']}"
        # 詞只能屬於 FIELDS 登錄的受控欄位
        if row["欄位"] not in FIELDS:
            raise PipelineError(f"{where} 欄位 {row['欄位']} 不是受控欄位")
        key = (row["欄位"], row["名稱"])
        # 主張表以名稱引用詞，同欄位的名稱重複時無法決定代碼
        if key in names or key in pending:
            raise PipelineError(
                f"vocab-terms.tsv 的 {row['欄位']}「{row['名稱']}」重複登錄"
            )
        # 狀態只能寫登錄的值
        if row["狀態"] not in STATUSES.values():
            raise PipelineError(f"{where} 的狀態寫了 {row['狀態']}")
        # 待審詞還沒有加入版本，主張引用時回報待審而不是未登錄
        if row["狀態"] == STATUSES["pending"]:
            # 加入版本在採用時才填寫
            if row["加入版本"] != EMPTY:
                raise PipelineError(f"{where} 待審，加入版本要寫 -")
            # 待審詞記在待審集合，主張引用時回報待審
            pending.add(key)
            continue
        # 採用詞記下代碼與加入版本
        names[key] = row["代碼"]
        versions.append(parse_integer(row["加入版本"], where))
    return names, pending, max(versions, default=0)


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
            # 未登錄的概念要先以待審狀態寫入詞表
            if (column, value) not in names:
                raise PipelineError(
                    f"{where} 的{column}「{value}」不在詞表，先以待審狀態登錄到 vocab-terms.tsv"
                )
            codes.append(names[(column, value)])
        # 產物記詞的代碼，網站依代碼查名稱與說明
        fields[key] = codes
    return fields


def passage_of(row, passages, where):
    """找出主張所在的段落。

    參數：
        row：claims.tsv 的一列。
        passages：抽取階段的段落，以代碼為鍵。
        where：錯誤訊息中的位置。
    回傳：段落。
    例外：PipelineError，段落不在抽取階段的產物中。
    """
    passage = passages.get(row["段落"])
    # 主張要指到抽取階段的段落，原文才能追溯到影像
    if passage is None:
        raise PipelineError(f"{where} 的段落 {row['段落']} 不在 extract.json")
    return passage


def check_claim(row, passages, entities, review, vocab):
    """核對一則主張並轉成產物的形狀。

    參數：
        row：claims.tsv 的一列。
        passages：抽取階段的段落，以代碼為鍵。
        entities：名冊對象，以代碼為鍵。
        review：review_names 的回傳值。
        vocab：(names, pending)。
    回傳：產物中的一則主張。
    例外：PipelineError，段落不存在、參選者與段落不同、起訖對不上原文、現任政府計畫標在非現任者，或審核欄未登錄。
    """
    where = f"claims.tsv 的 {row['代碼']}"
    passage = passage_of(row, passages, where)
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
    reviewed = review_fields(row, review, where)
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
    } | reviewed


def run(election_id, offline=False):
    """執行主張階段。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，詞表或主張不符規格。
    """
    upstream, carried = load_product("extract", election_id)
    passages = by_code(upstream["passages"], "id")
    entities = by_code(upstream["roster"]["entities"], "id")
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
