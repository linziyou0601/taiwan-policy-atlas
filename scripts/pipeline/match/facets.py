"""配題階段的工具：依清單重寫主張的面向與分配。

清單是表頭為主張、面向的 TSV，面向以頓號分隔。這則主張的配題列依清單重寫並平均分配。規則見 docs/pipeline/match.md 的分配。

指令：
  `npm run pipeline -- match facets --election <代碼> --spec <清單>`

手寫輸入：
  清單，以及 data/40-match/{選舉代碼}/mappings.tsv

產物：
  重寫後的 mappings.tsv

慣例：
  - 已掛題目的主張先把題目改回 -。修改的函式在同階段的 _mappings.py。
"""

from pathlib import Path

from ..common import election_argument
from ._mappings import rewrite_facets

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "依清單重寫主張的面向與分配"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument(
        "--spec", type=Path, required=True, help="表頭為主張、面向的 TSV"
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return rewrite_facets(args.election, args.spec)
