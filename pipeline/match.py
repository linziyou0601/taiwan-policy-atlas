"""配題層：核對題目、主張到面向的分配與題目的意識形態軸對應。

用途：讀主張層的產物，核對 data/40-match/{選舉}/ 的手寫表，寫出 match.json。
指令：`python -m pipeline match --election <代碼>`
手寫輸入：
  - questions.tsv：題目。子題寫母題與顯示條件，作答到母題時依答案決定是否出現，子題與母題分同一份預算。
  - mappings.tsv：主張到面向的分配。有題目的列另記這則主張對該題的立場，沒有題目的列只計入議題分布。
  - question-axes.tsv：題目對意識形態軸的方向與權重，雷達圖依此推算位置。
慣例：
  - 每則主張的分配合計為 1，一則主張拆到幾個面向時影響力不會倍增。
  - 每題至少有一筆本選舉的配題證據，題目只來自該選舉候選人的主張。
  - 配題列記下核對時的題目版本，題目改版後配題要重新核對。
"""

from .common import PipelineError, layer_dir, load_product, sha256_text, write_product
from .tables import (
    EMPTY,
    by_code,
    check_review,
    parse_integer,
    parse_number,
    read_config_table,
    read_optional,
    review_names,
    split_multi,
)

# ---- 集中設定 ----

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
    "判準",
    "理由",
    "證據",
    "方法",
    "審核狀態",
]
AXIS_HEADER = ["代碼", "題目", "軸", "方向", "權重", "理由", "方法", "審核狀態"]

# 題目適用於選舉內全部選區時的寫法
ALL_SCOPES = "全部"

# 分配合計與 1 的容許誤差，吸收手寫小數的進位
ALLOCATION_TOLERANCE = 1e-6

# 意識形態軸方向的允許值：1 為同意時往正極，-1 為同意時往負極
DIRECTIONS = {1, -1}

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
        taxonomy、scopes、answers：分類樹、選區代碼集合與作答量尺，用於核對面向、適用範圍與顯示條件。
    回傳：產物中的一題。
    例外：PipelineError，面向、母題、顯示條件、預算份額或適用範圍不符。
    """
    where = f"questions.tsv 的 {row['代碼']}"
    # 面向要在分類樹，權重才能沿分類樹分配到這題
    if row["面向"] not in taxonomy:
        raise PipelineError(f"{where} 的面向 {row['面向']} 不在 taxonomy-issues.tsv")
    # 根題的母題寫 -，轉成 None
    parent = None if row["母題"] == EMPTY else row["母題"]
    # 母題要是本表的題目
    if parent and parent not in codes:
        raise PipelineError(f"{where} 的母題 {parent} 不在題目表")
    conditions = split_multi(row["顯示條件"])
    # 顯示條件依母題的答案決定，根題沒有母題可以依據
    if conditions and not parent:
        raise PipelineError(f"{where} 不是子題，顯示條件要寫 -")
    # 條件寫作答量尺的代碼
    if any(value not in answers for value in conditions):
        raise PipelineError(f"{where} 的顯示條件要寫 scale-answers.tsv 的代碼")
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
            # 往上一層，根題的母題是 None，迴圈結束
            seen.add(current)
            current = parents[current]


def check_mapping(row, claims, questions, taxonomy, stances, review):
    """核對一筆配題並轉成產物的形狀。

    參數：
        row：mappings.tsv 的一列。
        claims、questions：以代碼為鍵的主張與題目。
        taxonomy、stances：分類樹與立場判準表，以代碼為鍵。
        review：review_names 的回傳值。
    回傳：產物中的一筆配題。
    例外：PipelineError，主張、面向、題目、版本、立場或證據不符。
    """
    where = f"mappings.tsv 的 {row['代碼']}"
    claim = claims.get(row["主張"])
    # 主張要在主張層的產物
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
        stance = stances.get(row["判準"])
        # 立場名稱與判準代碼要是同一列，避免名稱與數值不一致
        if stance is None or stance["名稱"] != row["立場"]:
            raise PipelineError(
                f"{where} 的立場與判準要是 rubric-stance.tsv 同一列的名稱與代碼"
            )
    # 只計入議題分布的列沒有立場
    elif row["立場"] != EMPTY or row["判準"] != EMPTY or row["題目版本"] != EMPTY:
        raise PipelineError(f"{where} 沒有題目，題目版本、立場與判準要寫 -")
    # 證據是主張原文中的一段，結果頁以它標示依據
    if row["證據"] != EMPTY and row["證據"] not in claim["quote"]:
        raise PipelineError(f"{where} 的證據不在主張 {claim['id']} 的原文內")
    check_review(row, review, where)
    # 有題目的列帶出題目與立場欄位，只計入議題分布的列這幾個欄位都是 None
    measured = (
        {
            "question": question["id"],
            "question_version": question["version"],
            "stance": stance["代碼"],
            "stance_value": float(stance["數值"]),
        }
        if question
        else dict.fromkeys(MEASURED_KEYS)
    )
    return measured | {
        "id": row["代碼"],
        "claim": claim["id"],
        "facet": row["面向"],
        "allocation": parse_number(row["分配"], where),
        "reason": row["理由"],
        # 證據欄的 - 轉成 None
        "evidence": None if row["證據"] == EMPTY else row["證據"],
        "method": row["方法"],
        "review_status": row["審核狀態"],
    }


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


def check_axis(row, questions, axes, review):
    """核對一筆題目到意識形態軸的對應。

    參數：
        row：question-axes.tsv 的一列。
        questions、axes：題目與軸，以代碼為鍵。
        review：review_names 的回傳值。
    回傳：產物中的一筆對應。
    例外：PipelineError，題目或軸未登錄、方向不是 1 或 -1、權重不大於 0，或審核欄未登錄。
    """
    where = f"question-axes.tsv 的 {row['代碼']}"
    # 題目與軸要是登錄的代碼
    if row["題目"] not in questions or row["軸"] not in axes:
        raise PipelineError(f"{where} 的題目或軸未登錄")
    # 方向與權重轉成數字後核對範圍
    direction = parse_integer(row["方向"], where)
    weight = parse_number(row["權重"], where)
    # 方向決定同意時往哪一極，權重決定這題在軸上的份量
    if direction not in DIRECTIONS or weight is None or weight <= 0:
        raise PipelineError(f"{where} 的方向要是 1 或 -1，權重要大於 0")
    check_review(row, review, where)
    return {
        "id": row["代碼"],
        "question": row["題目"],
        "axis": row["軸"],
        "direction": direction,
        "weight": weight,
        "reason": row["理由"],
        "method": row["方法"],
        "review_status": row["審核狀態"],
    }


def run(election_id):
    """執行配題層。

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
    claims = {claim["id"]: claim for claim in upstream["claims"]}
    # 題目：先收齊代碼再逐題核對，母題可以寫在子題之後
    scopes = {scope["id"] for scope in upstream["roster"]["scopes"]}
    answers = by_code(read_config_table("scale-answers.tsv"))
    question_rows = read_optional(directory / "questions.tsv", QUESTION_HEADER)
    # 全部題目代碼，用於核對母題
    codes = {row["代碼"] for row in question_rows}
    questions = [
        check_question(row, codes, taxonomy, scopes, answers) for row in question_rows
    ]
    check_cycles(questions)
    # 配題：逐列核對後檢查分配合計與題目證據
    by_question = {question["id"]: question for question in questions}
    stances = by_code(read_config_table("rubric-stance.tsv"))
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
