"""收錄輔助：配題層的結構性修改。

補母題的配題列、改寫主張的面向與題目改代碼，都牽動多列與多張表，由本腳本一次改齊，內容由配題層與評分層核對。

指令：
  `.venv/bin/python .claude/skills/policy-curation/scripts/mappings.py parents --election <代碼>`
  `.venv/bin/python .claude/skills/policy-curation/scripts/mappings.py facets --election <代碼> --spec <清單>`
  `.venv/bin/python .claude/skills/policy-curation/scripts/mappings.py rename --election <代碼> --old <題目代碼> --new <題目代碼>`

慣例：
  - parents：主張只分配到子題時，子題列的分配分一半給新增的母題列，立場與證據沿用子題列。子題判為反對方向的列要判斷與母題的關係，不自動補，列出代碼。
  - facets：清單是 TSV，表頭 `主張`、`面向`，面向以「、」分隔。該主張的配題列依清單重寫並平均分配，理由取分類樹的名稱與說明。已掛題目的主張不改寫，先把題目改回 -。
  - rename：一場選舉內的題目改代碼，題目、軸對應、中立性與配題的題目欄、子題的母題欄一起改，軸對應與中立性的列代碼以題目代碼起首。
"""

import argparse
import sys
from pathlib import Path

# 本檔位於 .claude/skills/policy-curation/scripts/，往上四層是 repo 根目錄，管線套件從那裡匯入
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from pipeline.common import PipelineError, layer_dir, log, require  # noqa: E402
from pipeline.match import MAPPING_HEADER, QUESTION_HEADER  # noqa: E402
from pipeline.score import NEUTRALITY_HEADER  # noqa: E402
from pipeline.tables import (  # noqa: E402
    AXIS_HEADER,
    EMPTY,
    MULTI_SEPARATOR,
    by_code,
    read_config_table,
    read_table,
)

# 腳本與本檔在同一個目錄，直接執行時這個目錄就在匯入路徑
from drafts import read_draft, write_sorted  # noqa: E402

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
    return require(layer_dir(layer, election_id) / name, "先寫入這一層的手寫表")


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
# 面向
# ==================================================


def shares(count):
    """平均分配，取到小數兩位，餘數加在第一列。

    參數：
        count：面向數。
    回傳：字串串列，合計為 1。
    """
    # 以百分之一為單位整除，避免浮點數的進位誤差
    base = 100 // count
    first = 100 - base * (count - 1)
    return [f"{first / 100:g}"] + [f"{base / 100:g}"] * (count - 1)


def rewrite_facets(election_id, spec):
    """依清單重寫主張的面向配題列。

    參數：
        election_id：選舉代碼。
        spec：清單 TSV 的 Path，表頭 `主張`、`面向`。
    回傳：摘要字串。
    例外：PipelineError，清單的主張沒有配題、面向不在分類樹，或主張已掛題目。
    """
    nodes = by_code(read_config_table("taxonomy-issues.tsv"))
    # 清單每列是一則主張與它的面向
    plan = {
        row["主張"]: row["面向"].split(MULTI_SEPARATOR)
        for row in read_draft(spec, ["主張", "面向"])
    }
    path = table_path(election_id, "match", "mappings.tsv")
    rows = read_table(path, MAPPING_HEADER)
    # 清單外的主張原樣保留
    kept = [row for row in rows if row["主張"] not in plan]
    # 清單的主張取一列當範本，沿用它的方法與審核狀態
    template = {row["主張"]: row for row in rows if row["主張"] in plan}
    missing = sorted(set(plan) - set(template))
    # 清單的主張都要已有配題，才有範本可以沿用
    if missing:
        raise PipelineError(f"清單的主張沒有配題：{'、'.join(missing)}")
    # 已掛題目的列有立場與證據，改寫面向會讓立場失去依據
    linked = sorted(
        {row["主張"] for row in rows if row["主張"] in plan and row["題目"] != EMPTY}
    )
    # 有任何一則已掛題目就整批不改
    if linked:
        raise PipelineError(f"這些主張已掛題目，先把題目改回 -：{'、'.join(linked)}")
    rewritten = []
    # 每則主張依清單的面向依序寫成 m1、m2…
    for claim, facets in plan.items():
        # 面向與分配依序配對
        for number, (facet, share) in enumerate(
            zip(facets, shares(len(facets))), start=1
        ):
            # 面向要是分類樹的節點，理由才有名稱與說明可寫
            if facet not in nodes:
                raise PipelineError(f"{claim} 的面向 {facet} 不在 taxonomy-issues.tsv")
            node = nodes[facet]
            # 一個面向時理由寫這則主張屬於哪個節點
            reason = f"原文的政策屬於「{node['名稱']}」：{node['說明']}"
            # 多個面向時理由另寫平均分配
            if len(facets) > 1:
                reason = f"原文涉及 {len(facets)} 個面向，平均分配，本列是「{node['名稱']}」：{node['說明']}"
            # 新列沿用範本，證據清空，掛題時再寫
            rewritten.append(
                template[claim]
                | {
                    "代碼": f"{claim}-m{number}",
                    "面向": facet,
                    "分配": share,
                    "理由": reason,
                    "證據": EMPTY,
                }
            )
    # 保留的列與重寫的列一起依代碼排序寫出
    write_sorted(path, MAPPING_HEADER, kept + rewritten)
    return f"facets {election_id}: 重寫 {len(plan)} 則主張、{len(rewritten)} 列配題"


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


# ==================================================
# 指令
# ==================================================


def main(argv):
    """執行指令。

    參數：
        argv：不含程式名稱的參數串列。
    回傳：結束代碼，0 為成功，1 為手寫表或清單不符規格。
    """
    parser = argparse.ArgumentParser(description="配題層的結構性修改")
    # 子指令與選舉代碼
    parser.add_argument("command", choices=["parents", "facets", "rename"])
    parser.add_argument("--election", required=True, help="選舉代碼")
    # facets 的清單
    parser.add_argument("--spec", type=Path, help="facets 的清單 TSV")
    # rename 的原代碼與新代碼
    parser.add_argument("--old", help="rename 的原題目代碼")
    parser.add_argument("--new", help="rename 的新題目代碼")
    args = parser.parse_args(argv)
    # 指令名稱對應到要執行的函式
    commands = {
        "parents": lambda: add_parents(args.election),
        "facets": lambda: rewrite_facets(args.election, args.spec),
        "rename": lambda: rename_question(args.election, args.old, args.new),
    }
    # 不符規格的手寫表以 PipelineError 回報，訊息列出要修改的列
    try:
        print(commands[args.command]())
    # 訊息寫入標準錯誤，結束代碼 1 與管線相同
    except PipelineError as error:
        log(f"失敗：{error}", "mappings")
        return 1
    return 0


# 直接執行本檔時執行指令
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
