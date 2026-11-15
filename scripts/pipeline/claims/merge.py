"""主張階段的工具：把核對過的編碼草稿寫進主張、配題與評分三個階段的手寫表。

草稿涵蓋的參選者，原有的主張連同配題與具體度整批換成草稿的內容。草稿的格式見 docs/pipeline/review-protocol.md 的草稿格式，步驟見 docs/pipeline/claims.md。

指令：
  `npm run pipeline -- claims merge --election <代碼> <草稿目錄>...`

手寫輸入：
  {草稿目錄} 的各張草稿表，表頭與 repo 對應的手寫表相同

產物：
  data/30-claims/、data/40-match/ 與 data/50-score/ 之下這場選舉的手寫表

慣例：
  - 草稿目錄可以給多個，依序合併。合併的函式在同階段的 _drafts.py。
"""

from pathlib import Path

from ..common import election_argument
from ._drafts import merge_coding

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "把編碼草稿寫進主張、配題與評分三個階段的手寫表"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument("directories", nargs="+", type=Path, help="草稿目錄")


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return merge_coding(args.election, args.directories)
