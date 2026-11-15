"""主張階段的工具：依原文的順序替主張重新編號。

每位參選者的主張依段落與原文起的順序編成三位序號，配題與具體度的代碼跟著改。步驟見 docs/pipeline/claims.md。

指令：
  `npm run pipeline -- claims renumber --election <代碼>`
  先執行 `claims offsets` 填好起訖。

手寫輸入：
  data/30-claims/{選舉代碼}/claims.tsv

產物：
  重新編號後的 claims.tsv、mappings.tsv 與 specificity.tsv

慣例：
  - 重新編號的函式在同階段的 _drafts.py。
"""

from ..common import election_argument
from ._drafts import renumber

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "依原文的順序替主張重新編號，配題與具體度的代碼跟著改"


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
    return renumber(args.election)
