"""配題階段的核對與產物：核對題目、主張到面向的分配與題目的意識形態軸對應。

讀取主張階段的產物，核對這個階段的三張手寫表。分配、出題與立場的規則見 docs/pipeline/match.md。

指令：
  `npm run pipeline -- match run --election <代碼>`

手寫輸入：
  data/40-match/{選舉代碼}/questions.tsv        題目。子題寫母題與顯示條件，子題與母題分同一份預算
  data/40-match/{選舉代碼}/mappings.tsv         主張到面向的分配。有題目的列另記這則主張對這一題的立場
  data/40-match/{選舉代碼}/question-axes.tsv    題目對意識形態軸的方向與權重

產物：
  data/40-match/{選舉代碼}/match.json   題目、配題與軸對應

慣例：
  - 每則主張的分配合計為 1，一則主張分到幾個面向時影響力維持一份。
  - 每題至少有一筆這場選舉的配題證據。
  - 配題列記下核對時的題目版本，題目改版後配題要重新核對。
"""

from ..common import (
    PipelineError,
    election_argument,
    layer_dir,
    load_product,
    sha256_text,
    write_product,
)
from ..tables import (
    AXIS_HEADER,
    EMPTY,
    by_code,
    check_axis,
    parse_integer,
    parse_number,
    parse_optional,
    read_config_table,
    read_optional,
    review_fields,
    review_names,
    split_multi,
)

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "核對題目、配題與軸對應並寫出這個階段的產物"

# 手寫表的表頭
QUESTION_HEADER = [
    "代碼",
    "面向",
    "母題",
    "題幹",
    "說明",
    "顯示條件",
    "預算份額",
    "適用範圍",
    "版本",
]
MAPPING_HEADER = [
    "代碼",
    "主張",
    "面向",
    "題目",
    "題目版本",
    "立場",
    "分配",
    "理由",
    "證據",
    "方法",
    "審核狀態",
]

# 題目適用於選舉內全部選區時的寫法
ALL_SCOPES = "全部"

# 分配合計與 1 的容許誤差，吸收手寫小數的進位
ALLOCATION_TOLERANCE = 1e-6

# 有題目的配題才有的欄位
MEASURED_KEYS = ("question", "question_version", "stance", "stance_value")


def question_hash(row):
    """計算題意雜湊。

    題幹、說明、面向、顯示條件與版本相同時才是同一題，網站以它判斷舊答案能否沿用，題意變了的答案移到待確認紀錄。
    參數：
        row：questions.tsv 的一列。
    回傳：sha256 十六進位字串。
    """
    return sha256_text(
        "\n".join([row["題幹"], row["說明"], row["面向"], row["顯示條件"], row["版本"]])
    )


def check_question(row, codes, taxonomy, scopes, answers):
    """核對一題並轉成產物的形狀。

    參數：
        row：questions.tsv 的一列。
        codes：本表全部題目代碼，用於核對母題。
        taxonomy、scopes、answers：分類樹、選區代碼集合與以名稱為鍵的作答量尺，用於核對面向、適用範圍與顯示條件。
    回傳：產物中的一題。
    例外：PipelineError，面向、母題、顯示條件、預算份額或適用範圍不符。
    """
    where = f"questions.tsv 的 {row['代碼']}"
    # 面向要在分類樹，權重才能沿分類樹分配到這題
    if row["面向"] not in taxonomy:
        raise PipelineError(f"{where} 的面向 {row['面向']} 不在 taxonomy-issues.tsv")
    # 根題的母題寫 -，轉成 None
    parent = parse_optional(row["母題"])
    # 母題要是本表的題目
    if parent and parent not in codes:
        raise PipelineError(f"{where} 的母題 {parent} 不在題目表")
    names = split_multi(row["顯示條件"])
    # 顯示條件依母題的答案決定，根題沒有母題可以依據
    if names and not parent:
        raise PipelineError(f"{where} 不是子題，顯示條件要寫 -")
    # 條件寫作答量尺的名稱
    if any(name not in answers for name in names):
        raise PipelineError(f"{where} 的顯示條件要寫 scale-answers.tsv 的名稱")
    # 產物記代碼，網站以代碼比對答案
    conditions = [answers[name]["代碼"] for name in names]
    share = parse_number(row["預算份額"], where)
    # 預算份額是同一根題底下各題的比例，介於 0 與 1 之間
    if share is None or not 0 < share <= 1:
        raise PipelineError(f"{where} 的預算份額要介於 0 與 1 之間")
    # 適用全部選區時記空串列，網站以空串列表示不限選區
    applies = [] if row["適用範圍"] == ALL_SCOPES else split_multi(row["適用範圍"])
    # 適用範圍要是本選舉的選區，題目不跨選區借用
    if any(scope not in scopes for scope in applies):
        raise PipelineError(f"{where} 的適用範圍有不在名冊的選區")
    return {
        "id": row["代碼"],
        "facet": row["面向"],
        "parent": parent,
        "stem": row["題幹"],
        "note": row["說明"],
        "conditions": conditions,
        "budget_share": share,
        "scopes": applies,
        "version": parse_integer(row["版本"], where),
        "hash": question_hash(row),
    }


def check_cycles(questions):
    """核對母題關係沒有環，網站沿母題往上找題組根時才會結束。

    參數：
        questions：產物中的題目。
    例外：PipelineError，母題關係成環。
    """
    parents = {question["id"]: question["parent"] for question in questions}
    # 每題各自往上走一次
    for question in questions:
        # 記下這一趟走過的題目
        seen = set()
        current = question["id"]
        # 沿母題往上走到根題
        while current:
            # 走回走過的題目表示成環
            if current in seen:
                raise PipelineError(f"questions.tsv 的母題關係在 {current} 成環")
            # 往上一個階段，根題的母題是 None，迴圈結束
            seen.add(current)
            current = parents[current]


def check_mapping(row, claims, questions, taxonomy, stances, review):
    """核對一筆配題並轉成產物的形狀。

    參數：
        row：mappings.tsv 的一列。
        claims、questions：以代碼為鍵的主張與題目。
        taxonomy：分類樹，以代碼為鍵。
        stances：立場判準表，以名稱為鍵。
        review：review_names 的回傳值。
    回傳：產物中的一筆配題。
    例外：PipelineError，主張、面向、題目、版本、立場或證據不符。
    """
    where = f"mappings.tsv 的 {row['代碼']}"
    claim = claims.get(row["主張"])
    # 主張要在主張階段的產物
    if claim is None:
        raise PipelineError(f"{where} 的主張 {row['主張']} 不在 claims.json")
    # 面向要在分類樹，議題分布依面向往上加總
    if row["面向"] not in taxonomy:
        raise PipelineError(f"{where} 的面向不在 taxonomy-issues.tsv")
    # 只計入議題分布的列沒有題目與立場
    question = None
    stance = None
    # 有題目的列記立場，用於立場契合計分
    if row["題目"] != EMPTY:
        question = questions.get(row["題目"])
        # 題目要在題目表，面向與題目相同，配題才落在同一個分類節點
        if question is None:
            raise PipelineError(f"{where} 的題目 {row['題目']} 不在題目表")
        # 面向與題目的面向不同時，分配與立場會落在不同節點
        if question["facet"] != row["面向"]:
            raise PipelineError(f"{where} 的面向與題目 {question['id']} 的面向不同")
        # 題目改版後，舊版的配題判讀不能沿用
        if parse_integer(row["題目版本"], where) != question["version"]:
            raise PipelineError(
                f"{where} 核對的是第 {row['題目版本']} 版，題目已是第 {question['version']} 版，重新核對配題"
            )
        stance = stances.get(row["立場"])
        # 立場要寫 rubric-stance.tsv 登錄的名稱，數值與判準代碼由那一列決定
        if stance is None:
            raise PipelineError(f"{where} 的立場不是 rubric-stance.tsv 登錄的名稱")
    # 只計入議題分布的列沒有立場
    elif row["立場"] != EMPTY or row["題目版本"] != EMPTY:
        raise PipelineError(f"{where} 沒有題目，題目版本與立場要寫 -")
    # 證據是主張原文中的一段，結果頁以它標示依據
    if row["證據"] != EMPTY and row["證據"] not in claim["quote"]:
        raise PipelineError(f"{where} 的證據不在主張 {claim['id']} 的原文內")
    reviewed = review_fields(row, review, where)
    # 有題目的列帶出題目與立場欄位，只計入議題分布的列這幾個欄位都是 None
    values = (
        (
            question["id"],
            question["version"],
            stance["代碼"],
            parse_number(stance["數值"], f"rubric-stance.tsv 的 {stance['代碼']}"),
        )
        if question
        else (None,) * len(MEASURED_KEYS)
    )
    return (
        dict(zip(MEASURED_KEYS, values))
        | {
            "id": row["代碼"],
            "claim": claim["id"],
            "facet": row["面向"],
            "allocation": parse_number(row["分配"], where),
            "reason": row["理由"],
            # 證據欄的 - 轉成 None
            "evidence": parse_optional(row["證據"]),
        }
        | reviewed
    )


def check_allocations(mappings, claims, questions):
    """核對分配合計與題目證據。

    參數：
        mappings：產物中的配題。
        claims、questions：以代碼為鍵的主張與題目。
    例外：PipelineError，某則主張的分配合計不是 1，或某題沒有任何配題證據。
    """
    totals = {}
    # 依主張加總分配
    for mapping in mappings:
        totals[mapping["claim"]] = (
            totals.get(mapping["claim"], 0) + mapping["allocation"]
        )
    # 每則主張逐一核對合計
    for claim_id in claims:
        # 每則主張都要完整分配到面向
        if abs(totals.get(claim_id, 0) - 1) > ALLOCATION_TOLERANCE:
            raise PipelineError(
                f"主張 {claim_id} 的分配合計是 {totals.get(claim_id, 0)}，要等於 1"
            )
    # 有配題證據的題目，沒有題目的列不算
    supported = {mapping["question"] for mapping in mappings if mapping["question"]}
    # 每題逐一核對有沒有證據
    for question_id in questions:
        # 題目要由本選舉的主張支撐
        if question_id not in supported:
            raise PipelineError(f"題目 {question_id} 沒有任何配題證據")


def run(election_id, offline=False):
    """執行配題階段。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，手寫表不符規格。
    """
    upstream, carried = load_product("claims", election_id)
    directory = layer_dir("match", election_id)
    # 各手寫表共用的登錄表與上游內容
    taxonomy = by_code(read_config_table("taxonomy-issues.tsv"))
    review = review_names()
    claims = by_code(upstream["claims"], "id")
    # 題目：先收齊代碼再逐題核對，母題可以寫在子題之後
    scopes = {scope["id"] for scope in upstream["roster"]["scopes"]}
    answers = by_code(read_config_table("scale-answers.tsv"), "名稱")
    question_rows = read_optional(directory / "questions.tsv", QUESTION_HEADER)
    # 全部題目代碼，用於核對母題
    codes = {row["代碼"] for row in question_rows}
    questions = [
        check_question(row, codes, taxonomy, scopes, answers) for row in question_rows
    ]
    check_cycles(questions)
    # 配題：逐列核對後檢查分配合計與題目證據
    by_question = by_code(questions, "id")
    stances = by_code(read_config_table("rubric-stance.tsv"), "名稱")
    mappings = [
        check_mapping(row, claims, by_question, taxonomy, stances, review)
        for row in read_optional(directory / "mappings.tsv", MAPPING_HEADER)
    ]
    # 全部配題讀完才能核對每則主張的合計
    check_allocations(mappings, claims, by_question)
    # 意識形態軸：題目與軸都要是登錄的代碼
    axes = by_code(read_config_table("axis-ideology.tsv"))
    question_axes = [
        check_axis(row, by_question, axes, review)
        for row in read_optional(directory / "question-axes.tsv", AXIS_HEADER)
    ]
    write_product(
        "match",
        election_id,
        {"questions": questions, "mappings": mappings, "question_axes": question_axes},
        carried,
    )
    return f"match {election_id}: {len(questions)} 題、{len(mappings)} 筆配題、{len(question_axes)} 筆軸對應"


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
