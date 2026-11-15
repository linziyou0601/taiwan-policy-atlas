"""配題階段共用的片段：沿用另一場選舉的題目，並比對同一個題目代碼在各場選舉的內容。

reuse 與 stems 兩支工具共用這裡的函式。同一個題目代碼在各場選舉是同一個命題。

指令：
  由同階段的 reuse 與 stems 呼叫。

手寫輸入：
  各場選舉 data/40-match/ 的 questions.tsv、question-axes.tsv 與 data/50-score/ 的 neutrality.tsv

產物：
  reuse 寫入這場選舉的三張表，stems 只寫標準輸出

慣例：
  - reuse 連同子題的母題一起複製。這場選舉已有同代碼而內容相同的列略過，內容不同時整批停止並列出代碼，三張表維持原樣。
  - 複製之後有兩處要依這場選舉改寫，見 docs/pipeline/match.md 的沿用，工具在摘要中提醒。
  - stems 比對面向、母題、題幹、顯示條件與預算份額，說明與版本各場可以不同。
"""

from ..common import PipelineError, election_ids, layer_dir, require
from ..score.run import NEUTRALITY_HEADER
from ..tables import (
    AXIS_HEADER,
    EMPTY,
    by_code,
    conflicts,
    read_optional,
    read_table,
    write_sorted,
)
from .run import ALL_SCOPES, QUESTION_HEADER

# ==================================================
# 集中設定
# ==================================================

# 題目表的檔名，沿用與比對都以它為準
QUESTION_FILE = "questions.tsv"

# 沿用時複製的表：檔名對應所屬的層、表頭，以及連到題目代碼的欄
REUSED_TABLES = {
    QUESTION_FILE: ("match", QUESTION_HEADER, "代碼"),
    "question-axes.tsv": ("match", AXIS_HEADER, "題目"),
    "neutrality.tsv": ("score", NEUTRALITY_HEADER, "題目"),
}

# 同一代碼在各場選舉要相同的欄，說明寫各場的現況、版本各場各自計算，兩欄不比對
STEM_FIELDS = ("面向", "母題", "題幹", "顯示條件", "預算份額")

# stems 輸出的表頭
STEM_HEADER = ["代碼", "欄", "選舉", "值"]

# 複製後要依本場改寫的地方，寫在 reuse 的摘要
REWRITE_NOTE = "依本場改寫：說明欄的現況年份依本場的投票日重新查證，中立性「不洩漏身分」的理由寫本場的參選者"


# ==================================================
# 沿用
# ==================================================


def with_parents(codes, questions, source_id):
    """指定的題目連同它們的母題。

    參數：
        codes：指定的題目代碼。
        questions：來源選舉的題目，以代碼為鍵。
        source_id：來源選舉代碼，寫在錯誤訊息中。
    回傳：題目代碼的集合。
    例外：PipelineError，指定的題目或沿途的母題不在來源的題目表。
    """
    missing = sorted(set(codes) - set(questions))
    # 指定的題目都要在來源的題目表
    if missing:
        raise PipelineError(f"{source_id} 的題目表沒有：{'、'.join(missing)}")
    wanted = set()
    # 每題各自沿母題往上收
    for code in codes:
        current = code
        # 走到根題，或遇到已經收過的題目時停止
        while current != EMPTY and current not in wanted:
            # 母題不在表內時來源的題目表不完整，子題複製過去也無法通過配題階段
            if current not in questions:
                raise PipelineError(
                    f"{source_id} 的題目 {code} 往上的母題 {current} 不在題目表"
                )
            # 母題一併複製，再往上找它的母題
            wanted.add(current)
            current = questions[current]["母題"]
    return wanted


def reuse_questions(election_id, source_id, codes):
    """把來源選舉的題目連同軸對應與中立性審查複製到本場。

    參數：
        election_id：本場的選舉代碼。
        source_id：來源選舉代碼。
        codes：要沿用的題目代碼串列。
    回傳：摘要字串：各表複製的列數、複製的題目代碼與要依本場改寫的地方。
    例外：PipelineError，來源與本場相同、來源沒有題目表或沒有指定的題目，或本場已有同代碼而內容不同的列。
    """
    # 同一場選舉沒有可以沿用的對象
    if source_id == election_id:
        raise PipelineError(f"來源與本場都是 {election_id}，--from 要寫另一場選舉")
    source = require(
        layer_dir("match", source_id) / QUESTION_FILE, "來源選舉要有題目表"
    )
    # 要複製的題目連同往上的母題
    wanted = with_parents(
        codes, by_code(read_table(source, QUESTION_HEADER)), source_id
    )
    # 三張表先全部比對，確定沒有衝突才寫入
    plans = {}
    clashes = []
    # 每張表取出來源中屬於這些題目的列，與本場既有的列比對
    for name, (layer, header, column) in REUSED_TABLES.items():
        # 只取要複製的題目的列
        incoming = [
            row
            for row in read_optional(layer_dir(layer, source_id) / name, header)
            if row[column] in wanted
        ]
        # 這場選舉現有的列依代碼索引，用來比對內容
        path = layer_dir(layer, election_id) / name
        current = by_code(read_optional(path, header))
        clashes += [f"{name} {code}" for code in conflicts(current, incoming)]
        # 本場已有而內容相同的列略過，只留本場沒有的列
        fresh = [row for row in incoming if row["代碼"] not in current]
        plans[name] = (path, header, current, fresh)
    # 有任何衝突就整批停止，避免只寫入一半
    if clashes:
        raise PipelineError(
            f"{election_id} 已有同代碼而內容不同的列：{'、'.join(clashes)}"
        )
    # 有列要加入的表依代碼排序寫出，其餘的表不動
    for path, header, current, fresh in plans.values():
        # 沒有要加入的列時不改寫這張表，也不建立空表
        if fresh:
            write_sorted(path, header, [*current.values(), *fresh])
    # 摘要列出每張表複製的列數
    counts = "、".join(f"{name} {len(plan[3])} 列" for name, plan in plans.items())
    questions = plans[QUESTION_FILE][3]
    # 摘要第一行寫來源與每張表的列數
    copied = [row["代碼"] for row in questions]
    lines = [f"reuse {election_id}: 從 {source_id} 複製 {counts}"]
    # 沒有複製任何題目時，指定的題目本場都已有相同的內容
    if not copied:
        return "\n".join([*lines, "指定的題目本場都已有相同的內容，沒有複製"])
    # 複製之後要依這場選舉改寫的地方一併提醒
    lines += [f"複製的題目：{'、'.join(copied)}", REWRITE_NOTE]
    # 適用範圍不是全部選區的題目另外列出
    scoped = [row["代碼"] for row in questions if row["適用範圍"] != ALL_SCOPES]
    # 適用範圍寫的是來源選舉的選區代碼，本場的名冊沒有這些選區
    if scoped:
        lines.append(
            f"適用範圍寫的是 {source_id} 的選區，改成本場的選區：{'、'.join(scoped)}"
        )
    return "\n".join(lines)


# ==================================================
# 比對
# ==================================================


def compare_stems():
    """列出同一題目代碼在各場選舉內容不同的地方。

    回傳：TSV 字串，表頭是 STEM_HEADER。有差異的欄每場選舉一列，沒有差異時只有表頭。
    例外：PipelineError，某場選舉的題目表不符規格。
    """
    found = {}
    # 讀取全部選舉的題目表，還沒有題目的選舉略過
    for election in election_ids():
        rows = read_optional(
            layer_dir("match", election) / QUESTION_FILE, QUESTION_HEADER
        )
        # 每題記下它在這場選舉的列
        for row in rows:
            found.setdefault(row["代碼"], {})[election] = row
    lines = ["\t".join(STEM_HEADER)]
    # 依題目代碼與欄的順序逐一比對
    for code in sorted(found):
        rows = found[code]
        # 每欄各自比對，值不只一種時列出各場的寫法
        for field in STEM_FIELDS:
            # 各場的值都相同的欄不列
            if len({row[field] for row in rows.values()}) < 2:
                continue
            lines += [
                "\t".join([code, field, election, rows[election][field]])
                for election in sorted(rows)
            ]
    return "\n".join(lines)
