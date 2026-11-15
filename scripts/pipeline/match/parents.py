"""配題階段的工具：替只分配到子題的主張補上母題的配題列。

子題列的分配分一半給新增的母題列，立場與證據沿用子題列。子題判為反對的列由工具列出代碼，依 docs/pipeline/match.md 的出題判斷後手寫。

指令：
  `npm run pipeline -- match parents --election <代碼>`

手寫輸入：
  data/40-match/{選舉代碼}/mappings.tsv、questions.tsv

產物：
  補上母題列的 mappings.tsv

慣例：
  - 修改的函式在同階段的 _mappings.py。
"""

from ..common import election_argument
from ._mappings import add_parents

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "替只分配到子題的主張補上母題的配題列"


# ==================================================
# 主體
# ==================================================


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
    return add_parents(args.election)
