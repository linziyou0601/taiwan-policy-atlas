"""主張階段共用的片段：把核對過的編碼草稿寫進各階段的手寫表，並依原文的順序重新編號。

merge 與 renumber 兩支工具共用這裡的函式。寫入只合併列，內容由各階段的 run 核對。

指令：
  由同階段的 merge 與 renumber 呼叫。

手寫輸入：
  {草稿目錄} 的 claims.tsv、mappings.tsv、specificity.tsv、questions.tsv、question-axes.tsv、neutrality.tsv，沒有的檔案略過

產物：
  data/30-claims/{選舉代碼}/claims.tsv、data/40-match/{選舉代碼}/ 與 data/50-score/{選舉代碼}/ 的手寫表

慣例：
  - 草稿的主張涵蓋的參選者，repo 中這些參選者的主張連同配題與具體度整批換成草稿的內容。其餘的列依代碼覆寫或新增。
  - 題目、軸對應與中立性的同一個代碼在 repo 已有不同的內容時停止並列出代碼，改寫既有的題目要直接修改 repo 的列。
  - renumber 依段落與原文起的順序替每位參選者的主張重新編號，先以 offsets 填好起訖。
"""

from ..common import PipelineError, layer_dir, require
from ..match.run import MAPPING_HEADER, QUESTION_HEADER
from ..score.run import NEUTRALITY_HEADER, SPECIFICITY_HEADER
from ..tables import (
    AXIS_HEADER,
    conflicts,
    read_draft,
    read_optional,
    read_table,
    write_sorted,
)
from .run import CLAIM_HEADER

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


# ==================================================
# 編碼草稿
# ==================================================


def merge_coding(election_id, drafts):
    """把草稿目錄的編碼寫進主張階段、配題階段與評分階段。

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
        # 有草稿或 repo 已有檔案的表才寫出，沒用到的層不建立空表
        if counts[name] or paths[name].exists():
            write_sorted(paths[name], header, tables[name].values())
    # 摘要只列有草稿的表
    summary = "、".join(f"{name} {count} 列" for name, count in counts.items() if count)
    return f"merge {election_id}: {summary or '沒有草稿'}"


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
    # 起訖由 `claims offsets` 填入，沒有起點就無法排出原文順序
    if not row["原文起"].isdigit():
        raise PipelineError(
            f"{row['代碼']} 的原文起是 {row['原文起']}，先執行 `npm run pipeline -- claims offsets`"
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
        # 沒有這個階段的表時不建立
        if path.exists():
            write_sorted(path, header, rows)
    # 摘要只計算代碼有改變的主張
    changed = sum(1 for old, new in renamed.items() if old != new)
    return f"renumber {election_id}: {changed} 則主張改號，共 {len(claims)} 則"
