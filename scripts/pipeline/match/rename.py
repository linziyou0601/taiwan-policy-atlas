"""配題階段的工具：替一道題目改代碼。

題目表、軸對應表、中立性表與配題表的題目欄，以及子題的母題欄一起改。

指令：
  `npm run pipeline -- match rename --election <代碼> --old <題目代碼> --new <題目代碼>`

手寫輸入：
  data/40-match/{選舉代碼}/ 的三張表與 data/50-score/{選舉代碼}/neutrality.tsv

產物：
  改好代碼的四張表

慣例：
  - 修改的函式在同階段的 _mappings.py。
"""

from ..common import election_argument
from ._mappings import rename_question

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "替一道題目改代碼，四張表一起改"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument("--old", required=True, help="原來的題目代碼")
    parser.add_argument("--new", required=True, help="新的題目代碼")


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return rename_question(args.election, args.old, args.new)
