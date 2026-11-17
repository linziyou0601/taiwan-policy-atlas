"""配題階段共用的片段：配題的結構性修改。

parents 與 rename 兩支工具共用這裡的函式。補母題的配題列與題目改代碼，都牽動多列與多張表，由這裡一次改齊，內容由 `match run` 與 `score run` 核對。

指令：
  由同階段的 parents 與 rename 呼叫。

手寫輸入：
  data/40-match/{選舉代碼}/ 的 mappings.tsv、questions.tsv、question-axes.tsv 與 data/50-score/{選舉代碼}/neutrality.tsv

產物：
  修改後的同一組手寫表

慣例：
  - parents：主張只分配到子題時，子題列的分配分一半給新增的母題列，立場與證據沿用子題列。子題判為反對的列要判斷與母題的關係，只列出代碼。
  - rename：一場選舉內的題目改代碼，題目、軸對應、中立性與配題的題目欄、子題的母題欄一起改。
"""

from ..common import PipelineError, layer_dir, require
from ..score.run import NEUTRALITY_HEADER
from ..tables import (
    AXIS_HEADER,
    EMPTY,
    by_code,
    read_config_table,
    read_table,
    write_sorted,
)
from .run import MAPPING_HEADER, QUESTION_HEADER

# ==================================================
# 共用
# ==================================================


def table_path(election_id, layer, name):
    """一場選舉某一層的手寫表位置，檔案要存在。

    參數：
        election_id：選舉代碼。
        layer：層名。
        name：檔名。
    回傳：Path。
    例外：PipelineError，檔案不存在。
    """
    return require(layer_dir(layer, election_id) / name, "先寫入這個階段的手寫表")


def next_code(claim, rows):
    """主張下一列配題的代碼。

    參數：
        claim：主張代碼。
        rows：這則主張既有的配題列。
    回傳：`{主張代碼}-m{序號}`，序號接續既有的最大值。
    """
    numbers = [int(row["代碼"].rsplit("-m", 1)[1]) for row in rows]
    return f"{claim}-m{max(numbers, default=0) + 1}"


def halve(value):
    """把分配分成兩半，寫成手寫表的數字。

    參數：
        value：分配的字串。
    回傳：一半的值，去掉多餘的零。
    """
    return f"{float(value) / 2:g}"


# ==================================================
# 母題配題
# ==================================================


def add_parents(election_id):
    """替只分配到子題的主張補母題的配題列。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串，列出要人工判斷的子題列。
    例外：PipelineError，題目表或配題表不存在。
    """
    questions = by_code(
        read_table(table_path(election_id, "match", "questions.tsv"), QUESTION_HEADER)
    )
    path = table_path(election_id, "match", "mappings.tsv")
    rows = read_table(path, MAPPING_HEADER)
    # rubric-stance.tsv 數值小於 0 的是反對方向的立場
    opposed = {
        row["名稱"]
        for row in read_config_table("rubric-stance.tsv")
        if float(row["數值"]) < 0
    }
    by_claim = {}
    # 配題依主張分組，母題是否已掛要看同一則主張的全部列
    for row in rows:
        by_claim.setdefault(row["主張"], []).append(row)
    added, skipped = [], []
    # 逐則主張找出掛子題、卻沒有掛母題的列
    for claim, claim_rows in by_claim.items():
        linked = {row["題目"] for row in claim_rows}
        # 子題列的母題已經在同一則主張的配題中時不必補
        children = [
            row
            for row in claim_rows
            if row["題目"] != EMPTY
            and questions[row["題目"]]["母題"] != EMPTY
            and questions[row["題目"]]["母題"] not in linked
        ]
        # 每一列子題各補一列母題
        for child in children:
            # 反對子題的數額不代表反對母題的方向，交給編碼者判斷
            if child["立場"] in opposed:
                skipped.append(child["代碼"])
                continue
            # 母題的面向、代碼與版本寫進新列
            parent = questions[questions[child["題目"]]["母題"]]
            # 子題列的分配分一半給母題列，主張的分配合計不變
            child["分配"] = halve(child["分配"])
            # 其餘欄位沿用子題列
            row = child | {
                "代碼": next_code(claim, claim_rows + added),
                "面向": parent["面向"],
                "題目": parent["代碼"],
                "題目版本": parent["版本"],
                "理由": f"原文的做法屬於子題「{questions[child['題目']]['題幹']}」，方向與母題相同",
            }
            added.append(row)
            linked.add(parent["代碼"])
    # 原有的列與新增的母題列一起依代碼排序寫出
    write_sorted(path, MAPPING_HEADER, rows + added)
    summary = f"parents {election_id}: 補 {len(added)} 列母題配題"
    # 留給編碼者判斷的列附在摘要後
    if skipped:
        summary += f"，反對方向待判斷：{'、'.join(skipped)}"
    return summary


# ==================================================
# 題目代碼
# ==================================================


def rename_question(election_id, old, new):
    """一場選舉內的題目改代碼。

    參數：
        election_id：選舉代碼。
        old：原題目代碼。
        new：新題目代碼。
    回傳：摘要字串。
    例外：PipelineError，原代碼不存在或新代碼已存在。
    """
    paths = {
        "questions": (
            table_path(election_id, "match", "questions.tsv"),
            QUESTION_HEADER,
        ),
        "axes": (table_path(election_id, "match", "question-axes.tsv"), AXIS_HEADER),
        "mappings": (table_path(election_id, "match", "mappings.tsv"), MAPPING_HEADER),
        "neutrality": (
            table_path(election_id, "score", "neutrality.tsv"),
            NEUTRALITY_HEADER,
        ),
    }
    tables = {key: read_table(path, header) for key, (path, header) in paths.items()}
    codes = {row["代碼"] for row in tables["questions"]}
    # 原代碼要存在，新代碼不能撞到既有的題目
    if old not in codes or new in codes:
        raise PipelineError(f"{old} 要是既有題目、{new} 不能是既有題目")
    # 題目本身與子題的母題欄
    for row in tables["questions"]:
        # 這一題的列換成新代碼
        if row["代碼"] == old:
            row["代碼"] = new
        # 這一題的子題改指向新代碼
        if row["母題"] == old:
            row["母題"] = new
    # 軸對應與中立性的列代碼以題目代碼起首
    for key in ("axes", "neutrality"):
        # 逐列找這一題的軸對應或中立性
        for row in tables[key]:
            # 只改這一題的列，前綴換成新代碼
            if row["題目"] == old:
                row["題目"] = new
                row["代碼"] = new + row["代碼"][len(old) :]
    # 配題只改題目欄，列代碼以主張起首不受影響
    for row in tables["mappings"]:
        # 掛這一題的列換成新代碼
        if row["題目"] == old:
            row["題目"] = new
    # 四張表依代碼排序寫出
    for key, (path, header) in paths.items():
        write_sorted(path, header, tables[key])
    return f"rename {election_id}: {old} 改為 {new}"
