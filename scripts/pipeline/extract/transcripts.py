"""抽取階段的工具：把段落表格式的草稿寫進這個階段。

公報已經登錄在選舉定義時，轉錄者直接依段落表的表頭寫草稿，本工具把草稿的段落、轉錄檔與名冊表合併進 repo。草稿的格式見 docs/pipeline/review-protocol.md 的草稿格式。

指令：
  `npm run pipeline -- extract transcripts --election <代碼> <草稿目錄>...`

手寫輸入：
  {草稿目錄}/transcripts.tsv 與它的轉錄檔欄列出的檔案
  {草稿目錄}/roster.tsv   名冊表的草稿，選舉定義的 roster 寫 tables 時才有

產物：
  data/20-extract/{選舉代碼}/transcripts.tsv、transcripts/、roster.tsv

慣例：
  - 同代碼的段落與名冊列覆寫，其餘保留。寫入的函式在同階段的 _transcripts.py。
"""

from pathlib import Path

from ..common import election_argument
from ._transcripts import write_transcripts

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "把草稿目錄的段落、轉錄檔與名冊表寫進這個階段"


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
    return write_transcripts(args.election, args.directories)
