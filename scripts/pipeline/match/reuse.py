"""配題階段的工具：沿用另一場選舉的題目。

面向與命題和其他場次的題目相同時，把那一題連同軸對應與中立性審查複製到這場選舉。複製之後要改寫的兩處見 docs/pipeline/match.md 的沿用。

指令：
  `npm run pipeline -- match reuse --election <代碼> --from <來源選舉代碼> <題目代碼>...`

手寫輸入：
  來源選舉的 questions.tsv、question-axes.tsv 與 neutrality.tsv

產物：
  這場選舉的同三張表

慣例：
  - 複製的題目還沒有配題證據，掛上這場選舉的配題之後 `match run` 才通過。複製的函式在同階段的 _reuse.py。
"""

from ..common import election_argument
from ._reuse import reuse_questions

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "把另一場選舉的題目連同軸對應與中立性審查複製到這場選舉"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument("--from", dest="source", required=True, help="來源選舉的代碼")
    parser.add_argument("codes", nargs="+", help="要沿用的題目代碼")


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return reuse_questions(args.election, args.source, args.codes)
