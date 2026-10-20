"""評分層：核對主張的具體度評分與題目的中立性審查。

用途：讀配題層的產物，核對 data/50-score/{選舉}/ 的手寫表，寫出 score.json。
指令：`python -m pipeline score --election <代碼>`
手寫輸入：
  - specificity.tsv：每則主張對每條具體度判準的級距、理由與原文證據。
  - neutrality.tsv：每題對每條中立性判準的審查結果、理由與證據。
慣例：
  - 每則主張要涵蓋 rubric-specificity.tsv 的每條判準，缺任一條時本層失敗，尚未評分不當成 0。
  - 評為部分明示或完整明示的列要附主張原文中的一段，未明示與不適用的證據寫 -。
  - 每題要通過 rubric-neutrality.tsv 的每條判準，任一條不通過時本層失敗，先改寫題目再審查。
"""

from .common import PipelineError, layer_dir, load_product, write_product
from .tables import (
    EMPTY,
    by_code,
    check_review,
    read_config_table,
    read_optional,
    review_names,
)

# ---- 集中設定 ----

# 手寫表的表頭
SPECIFICITY_HEADER = [
    "代碼",
    "主張",
    "判準",
    "級距",
    "理由",
    "證據",
    "方法",
    "審核狀態",
]
NEUTRALITY_HEADER = ["代碼", "題目", "判準", "結果", "理由", "證據", "方法", "審核狀態"]

# 中立性審查的結果值，只有通過的題目能發布
PASS = "通過"
RESULTS = {PASS, "不通過"}

# 不附證據的級距代碼：未明示沒有原文可引，不適用不納入分母
NO_EVIDENCE_LEVELS = {"unstated", "not-applicable"}


def check_specificity_row(row, claims, criteria, levels, review):
    """核對一筆具體度評分並轉成產物的形狀。

    參數：
        row：specificity.tsv 的一列。
        claims：主張，以代碼為鍵。
        criteria：具體度判準，以代碼為鍵。
        levels：級距，以名稱為鍵。
        review：review_names 的回傳值。
    回傳：產物中的一筆評分，value 是級距數值，不適用時為 None。
    例外：PipelineError，主張、判準或級距未登錄，或證據不符級距的要求。
    """
    where = f"specificity.tsv 的 {row['代碼']}"
    claim = claims.get(row["主張"])
    # 主張與判準要是登錄的代碼
    if claim is None or row["判準"] not in criteria:
        raise PipelineError(f"{where} 的主張或判準未登錄")
    level = levels.get(row["級距"])
    # 級距寫 rubric-levels.tsv 的名稱
    if level is None:
        raise PipelineError(f"{where} 的級距 {row['級距']} 不在 rubric-levels.tsv")
    needs_evidence = level["代碼"] not in NO_EVIDENCE_LEVELS
    # 有明示的級距要附主張原文中的一段，讀者能對照判準檢查
    if needs_evidence and (row["證據"] == EMPTY or row["證據"] not in claim["quote"]):
        raise PipelineError(f"{where} 評為{row['級距']}，證據要寫主張原文中的一段")
    # 未明示與不適用沒有可引的原文
    if not needs_evidence and row["證據"] != EMPTY:
        raise PipelineError(f"{where} 評為{row['級距']}，證據要寫 -")
    check_review(row, review, where)
    # 不適用的級距沒有數值，計分時不納入分母
    value = None if level["數值"] == EMPTY else float(level["數值"])
    # 證據欄的 - 轉成 None，網站據此判斷有沒有可標示的原文
    evidence = None if row["證據"] == EMPTY else row["證據"]
    return {
        "id": row["代碼"],
        "claim": row["主張"],
        "criterion": row["判準"],
        "level": level["代碼"],
        "value": value,
        "reason": row["理由"],
        "evidence": evidence,
        "method": row["方法"],
        "review_status": row["審核狀態"],
    }


def check_specificity(rows, claims, criteria, levels, review):
    """核對整張具體度評分表，每則主張要涵蓋每條判準且不重複。

    參數：
        rows：specificity.tsv 的列。
        claims、criteria、levels、review：同 check_specificity_row。
    回傳：產物中的評分串列。
    例外：PipelineError，同一主張的同一判準評了兩次，或有主張缺判準。
    """
    seen = set()
    result = []
    # 逐列核對，同時記下已評的 `(主張, 判準)`
    for row in rows:
        key = (row["主張"], row["判準"])
        # 重複評分時無法決定採用哪一筆
        if key in seen:
            raise PipelineError(
                f"specificity.tsv 的 {row['代碼']} 重複評了主張 {row['主張']} 的判準 {row['判準']}"
            )
        # 記下已評的鍵，再逐欄核對這一列
        seen.add(key)
        result.append(check_specificity_row(row, claims, criteria, levels, review))
    # 逐一檢查每則主張的每條判準都有評分
    for claim_id in claims:
        # 同一主張逐條判準檢查
        for criterion in criteria:
            # 缺少評分的判準不能當成 0，要補上評分
            if (claim_id, criterion) not in seen:
                raise PipelineError(
                    f"主張 {claim_id} 缺少判準 {criterion} 的具體度評分"
                )
    return result


def check_neutrality(rows, questions, criteria, review):
    """核對中立性審查，每題要通過每條判準。

    參數：
        rows：neutrality.tsv 的列。
        questions：題目代碼集合。
        criteria：中立性判準，以代碼為鍵。
        review：review_names 的回傳值。
    回傳：產物中的審查串列。
    例外：PipelineError，題目、判準或結果未登錄，有判準不通過，或有題目缺少審查。
    """
    seen = set()
    result = []
    # 逐列核對，同時記下已審的 `(題目, 判準)`
    for row in rows:
        where = f"neutrality.tsv 的 {row['代碼']}"
        # 題目、判準與結果都要是登錄的值
        if (
            row["題目"] not in questions
            or row["判準"] not in criteria
            or row["結果"] not in RESULTS
        ):
            raise PipelineError(f"{where} 的題目、判準或結果未登錄")
        # 不通過的題目要改寫後重新審查，不能發布
        if row["結果"] != PASS:
            raise PipelineError(
                f"{where}：題目 {row['題目']} 沒有通過中立性判準 {row['判準']}，改寫題目後重新審查"
            )
        # 審核欄核對後記下已審的鍵
        check_review(row, review, where)
        seen.add((row["題目"], row["判準"]))
        # 證據欄的 - 轉成 None
        evidence = None if row["證據"] == EMPTY else row["證據"]
        result.append(
            {
                "id": row["代碼"],
                "question": row["題目"],
                "criterion": row["判準"],
                "result": row["結果"],
                "reason": row["理由"],
                "evidence": evidence,
                "method": row["方法"],
                "review_status": row["審核狀態"],
            }
        )
    # 逐一檢查每題的每條判準都有審查
    for question_id in questions:
        # 同一題逐條判準檢查
        for criterion in criteria:
            # 缺少審查的判準不能視為通過
            if (question_id, criterion) not in seen:
                raise PipelineError(
                    f"題目 {question_id} 缺少中立性判準 {criterion} 的審查"
                )
    return result


def run(election_id):
    """執行評分層。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，手寫表不符規格。
    """
    upstream, carried = load_product("match", election_id)
    directory = layer_dir("score", election_id)
    # 審核欄的登錄名稱，各手寫表共用
    review = review_names()
    claims = {claim["id"]: claim for claim in upstream["claims"]}
    questions = {question["id"] for question in upstream["questions"]}
    # 具體度：判準以代碼查、級距以名稱查，手寫表寫的是級距名稱
    criteria = by_code(read_config_table("rubric-specificity.tsv"))
    levels = by_code(read_config_table("rubric-levels.tsv"), "名稱")
    specificity = check_specificity(
        read_optional(directory / "specificity.tsv", SPECIFICITY_HEADER),
        claims,
        criteria,
        levels,
        review,
    )
    # 中立性：每題逐條判準審查
    neutral_criteria = by_code(read_config_table("rubric-neutrality.tsv"))
    neutrality = check_neutrality(
        read_optional(directory / "neutrality.tsv", NEUTRALITY_HEADER),
        questions,
        neutral_criteria,
        review,
    )
    write_product(
        "score",
        election_id,
        {"specificity": specificity, "neutrality": neutrality},
        carried,
    )
    return f"score {election_id}: {len(specificity)} 筆具體度評分、{len(neutrality)} 筆中立性審查"
