"""抽取階段的工具：列出還要判斷 OCR 比對的影像段落。

`extract run` 為每個影像段落記錄轉錄稿與 OCR 的重合度與沒對上的行。本工具列出有沒對上的行或重合度偏低的段落，轉錄者對照影像判斷後把結論寫進段落表的理由欄。判斷的規則見 docs/pipeline/extract.md 的 OCR 比對。

指令：
  `npm run pipeline -- extract ocr --election <代碼>`
  先執行 `extract run`。

手寫輸入：
  data/20-extract/{選舉代碼}/transcripts.tsv 的理由欄

產物：
  標準輸出的 TSV：段落、影像、重合度、未對上行數、已記錄

慣例：
  - 理由欄含「OCR」的段落已記錄寫「是」，每一列都寫「是」時這場選舉的影像段落都已比對。
  - 列出的函式在同階段的 _transcripts.py。
"""

from ..common import election_argument
from ._transcripts import ocr_pending

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "列出還要判斷 OCR 比對的影像段落"


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
    return ocr_pending(args.election)
