"""收錄輔助：把核對過的草稿寫進各層的手寫表。

subagent 依各層的表頭寫草稿，主 session 核對後以本腳本寫入 repo。寫入只合併列，內容由管線各層核對。

指令：
  `.venv/bin/python .claude/skills/policy-curation/scripts/drafts.py transcripts --election <代碼> <草稿目錄>...`
  `.venv/bin/python .claude/skills/policy-curation/scripts/drafts.py coding --election <代碼> <草稿目錄>...`
  `.venv/bin/python .claude/skills/policy-curation/scripts/drafts.py renumber --election <代碼>`

慣例：
  - 草稿目錄放各層的檔名與表頭：`transcripts.tsv` 與轉錄檔，`claims.tsv`、`mappings.tsv`、`specificity.tsv`、`questions.tsv`、`question-axes.tsv`、`neutrality.tsv`，沒有的檔案略過。草稿的列不必排序。
  - 草稿的主張涵蓋的參選者，repo 中這些參選者的主張連同配題與具體度整批換成草稿的內容。其餘的列依代碼覆寫或新增。
  - 題目、軸對應與中立性的同一代碼在 repo 已有不同內容時停止並列出代碼，改寫既有題目要直接修改 repo 的列。
  - renumber 依段落與原文起的順序替每位參選者的主張重新編號，先執行 offsets.py 填好起訖。
"""

import argparse
import shutil
import sys
from pathlib import Path

# 本檔位於 .claude/skills/policy-curation/scripts/，往上四層是 repo 根目錄，管線套件從那裡匯入
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from pipeline.claims import CLAIM_HEADER  # noqa: E402
from pipeline.common import PipelineError, layer_dir, log, require  # noqa: E402
from pipeline.extract import TRANSCRIPT_HEADER  # noqa: E402
from pipeline.match import MAPPING_HEADER, QUESTION_HEADER  # noqa: E402
from pipeline.score import NEUTRALITY_HEADER, SPECIFICITY_HEADER  # noqa: E402
from pipeline.tables import (  # noqa: E402
    AXIS_HEADER,
    read_optional,
    read_table,
    sort_table,
    write_table,
)

# ==================================================
# 集中設定
# ==================================================

# 編碼草稿的檔名對應到所屬的層與表頭
CODING_TABLES = {
    "claims.tsv": ("claims", CLAIM_HEADER),
    "mappings.tsv": ("match", MAPPING_HEADER),
    "specificity.tsv": ("score", SPECIFICITY_HEADER),
    "questions.tsv": ("match", QUESTION_HEADER),
    "question-axes.tsv": ("match", AXIS_HEADER),
    "neutrality.tsv": ("score", NEUTRALITY_HEADER),
}

# 跟著主張一起取代的表，以主張欄連到主張
CLAIM_CHILDREN = ("mappings.tsv", "specificity.tsv")

# 同代碼內容不同時停止的表，這些列被多則主張共用
SHARED_TABLES = ("questions.tsv", "question-axes.tsv", "neutrality.tsv")


def read_draft(path, header):
    """讀取一份草稿，先依代碼排序再以手寫表的規則檢查。

    參數：
        path：草稿檔。
        header：該層的表頭。
    回傳：每列一個 dict 的串列。
    例外：PipelineError，表頭不符、欄數不符、有空白格或代碼重複。
    """
    sort_table(path)
    return read_table(path, header)


def write_sorted(path, header, rows):
    """依代碼排序後寫出手寫表。

    參數：
        path：檔案位置，目錄不存在時建立。
        header：表頭。
        rows：每列一個 dict 的串列。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    write_table(path, header, sorted(rows, key=lambda row: row["代碼"]))


# ==================================================
# 轉錄稿
# ==================================================


def write_transcripts(election_id, drafts):
    """把草稿目錄的段落與轉錄檔寫進抽取層。

    參數：
        election_id：選舉代碼。
        drafts：草稿目錄的 Path 串列。
    回傳：摘要字串。
    例外：PipelineError，草稿表不符規格或缺少轉錄檔。
    """
    base = layer_dir("extract", election_id)
    path = base / "transcripts.tsv"
    # 既有的段落依代碼索引，草稿同代碼的列覆寫
    rows = {row["代碼"]: row for row in read_optional(path, TRANSCRIPT_HEADER)}
    written = 0
    # 每個草稿目錄的段落依序寫入，後面的目錄覆寫前面的同代碼段落
    for directory in drafts:
        draft = require(directory / "transcripts.tsv", "草稿目錄要有 transcripts.tsv")
        # 每列的轉錄檔從草稿目錄複製到抽取層的 transcripts/，檔名不變
        for row in read_draft(draft, TRANSCRIPT_HEADER):
            source = require(directory / row["轉錄檔"], f"{row['代碼']} 的轉錄檔")
            target = base / "transcripts" / row["轉錄檔"]
            # 抽取層還沒有轉錄稿時建立目錄
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            # 段落表的列換成草稿的列
            rows[row["代碼"]] = row
            written += 1
    # 段落表依代碼排序寫出，與手寫表的規則相同
    write_sorted(path, TRANSCRIPT_HEADER, rows.values())
    return f"transcripts {election_id}: 寫入 {written} 段，共 {len(rows)} 段"


# ==================================================
# 編碼
# ==================================================


def conflicts(current, incoming):
    """找出同代碼而內容不同的列。

    參數：
        current：repo 的列，依代碼索引。
        incoming：草稿的列。
    回傳：代碼串列。
    """
    return [
        row["代碼"]
        for row in incoming
        if row["代碼"] in current and current[row["代碼"]] != row
    ]


def merge_coding(election_id, drafts):
    """把草稿目錄的編碼寫進主張層、配題層與評分層。

    參數：
        election_id：選舉代碼。
        drafts：草稿目錄的 Path 串列。
    回傳：摘要字串。
    例外：PipelineError，草稿表不符規格，或共用的表有同代碼而內容不同的列。
    """
    paths = {
        name: layer_dir(layer, election_id) / name
        for name, (layer, _) in CODING_TABLES.items()
    }
    # 每張表讀成依代碼索引的 dict，合併完一次寫出
    tables = {
        name: {row["代碼"]: row for row in read_optional(paths[name], header)}
        for name, (_, header) in CODING_TABLES.items()
    }
    counts = dict.fromkeys(CODING_TABLES, 0)
    # 草稿目錄依序合併，後面的目錄覆寫前面的同代碼列
    for directory in drafts:
        # 草稿目錄只放要寫入的表，沒有的檔案略過
        drafted = {
            name: read_draft(directory / name, header)
            for name, (_, header) in CODING_TABLES.items()
            if (directory / name).exists()
        }
        entities = {row["參選者"] for row in drafted.get("claims.tsv", [])}
        # 草稿涵蓋的參選者重新編碼，找出他們的舊主張
        replaced = {
            code
            for code, row in tables["claims.tsv"].items()
            if row["參選者"] in entities
        }
        # 舊主張移除，草稿的主張稍後加入
        tables["claims.tsv"] = {
            code: row
            for code, row in tables["claims.tsv"].items()
            if code not in replaced
        }
        # 配題與具體度逐表處理
        for name in CLAIM_CHILDREN:
            # 以主張欄連到被取代主張的列一起移除
            tables[name] = {
                code: row
                for code, row in tables[name].items()
                if row["主張"] not in replaced
            }
        # 共用的表找出同代碼而內容不同的列
        clashes = [
            f"{name} {code}"
            for name in SHARED_TABLES
            for code in conflicts(tables[name], drafted.get(name, []))
        ]
        # 有任何衝突就停止，避免只寫入一半
        if clashes:
            raise PipelineError(
                f"{directory} 有同代碼而內容不同的列：{'、'.join(clashes)}"
            )
        # 草稿的列依代碼覆寫或新增
        for name, rows in drafted.items():
            tables[name].update((row["代碼"], row) for row in rows)
            counts[name] += len(rows)
    # 每張表依代碼排序寫出
    for name, (_, header) in CODING_TABLES.items():
        # 有草稿或原本就有檔案的表才寫出，沒用到的層不建立空表
        if counts[name] or paths[name].exists():
            write_sorted(paths[name], header, tables[name].values())
    # 摘要只列有草稿的表
    summary = "、".join(f"{name} {count} 列" for name, count in counts.items() if count)
    return f"coding {election_id}: {summary or '沒有草稿'}"


# ==================================================
# 重新編號
# ==================================================


def claim_prefix(entity_id):
    """主張代碼的前綴。

    參數：
        entity_id：參選者代碼，例如 `2024-president:national:2`。
    回傳：`{選區代碼}-{號次}`，例如 `national-2`。
    """
    return entity_id.split(":", 1)[1].replace(":", "-")


def position(row):
    """主張在原文中的位置，作為編號的順序。

    參數：
        row：claims.tsv 的一列。
    回傳：`(段落, 原文起)`。
    例外：PipelineError，原文起還沒填寫。
    """
    # 起訖由 offsets.py 填入，沒有起點就無法排出原文順序
    if not row["原文起"].isdigit():
        raise PipelineError(
            f"{row['代碼']} 的原文起是 {row['原文起']}，先執行 offsets.py"
        )
    return row["段落"], int(row["原文起"])


def renumber(election_id):
    """依原文順序替每位參選者的主張重新編號，配題與具體度跟著改。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，主張表不存在或原文起還沒填寫。
    """
    claims_path = require(
        layer_dir("claims", election_id) / "claims.tsv", "先撰寫主張表"
    )
    claims = read_table(claims_path, CLAIM_HEADER)
    # 同一位參選者的主張依段落與原文起排序
    order = sorted(claims, key=lambda row: (row["參選者"], *position(row)))
    renamed, sequence = {}, {}
    # 依排好的順序逐則給號，每位參選者各自從 1 起算
    for row in order:
        prefix = claim_prefix(row["參選者"])
        sequence[prefix] = sequence.get(prefix, 0) + 1
        # 序號補成三位數，與代碼的寫法一致
        renamed[row["代碼"]] = f"{prefix}-{sequence[prefix]:03d}"
    # 主張表換成新代碼
    for row in claims:
        row["代碼"] = renamed[row["代碼"]]
    write_sorted(claims_path, CLAIM_HEADER, claims)
    # 配題與具體度的代碼以主張代碼起首，後綴保留
    for layer, name, header in (
        ("match", "mappings.tsv", MAPPING_HEADER),
        ("score", "specificity.tsv", SPECIFICITY_HEADER),
    ):
        path = layer_dir(layer, election_id) / name
        rows = read_optional(path, header)
        # 列代碼的前綴與主張欄都換成新的主張代碼
        for row in rows:
            old = row["主張"]
            # 後綴是配題的 m 序號或具體度的判準代碼
            row["代碼"] = renamed[old] + row["代碼"][len(old) :]
            row["主張"] = renamed[old]
        # 沒有這一層的表時不建立
        if path.exists():
            write_sorted(path, header, rows)
    # 摘要只計算代碼有改變的主張
    changed = sum(1 for old, new in renamed.items() if old != new)
    return f"renumber {election_id}: {changed} 則主張改號，共 {len(claims)} 則"


# ==================================================
# 指令
# ==================================================


def main(argv):
    """執行指令。

    參數：
        argv：不含程式名稱的參數串列。
    回傳：結束代碼，0 為成功，1 為草稿或手寫表不符規格。
    """
    parser = argparse.ArgumentParser(description="把核對過的草稿寫進各層的手寫表")
    # 子指令決定寫入的對象
    parser.add_argument("command", choices=["transcripts", "coding", "renumber"])
    parser.add_argument("--election", required=True, help="選舉代碼")
    # 草稿目錄可以給多個，依序合併
    parser.add_argument("drafts", nargs="*", type=Path, help="草稿目錄")
    args = parser.parse_args(argv)
    # 指令名稱對應到要執行的函式
    commands = {
        "transcripts": lambda: write_transcripts(args.election, args.drafts),
        "coding": lambda: merge_coding(args.election, args.drafts),
        "renumber": lambda: renumber(args.election),
    }
    # 不符規格的草稿以 PipelineError 回報，訊息列出要修改的列
    try:
        print(commands[args.command]())
    # 訊息寫入標準錯誤，結束代碼 1 與管線相同
    except PipelineError as error:
        log(f"失敗：{error}", "drafts")
        return 1
    return 0


# 直接執行本檔時執行指令
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
