"""抽取階段的工具：依「政見」標籤找出每位參選者的政見格，列出格內的影像代碼並寫出文字層草稿。

讀取選舉定義 documents 列出的每份公報。步驟見 docs/pipeline/extract.md。

指令：
  `npm run pipeline -- extract cells --election <代碼>`
  先執行 `fetch run`。

手寫輸入：
  data/10-fetch/{選舉代碼}/election.yaml   選舉定義的 documents

產物：
  .cache/pipeline/{選舉代碼}/{文件代碼}/ 的政見格清單 cells.tsv 與草稿 drafts/

慣例：
  - 偵測與輸出的函式在同階段的 _pdf.py。
"""

from ..common import election_argument
from ._pdf import process

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "找出選舉定義登錄的每份公報的政見格，寫出清單與文字層草稿"


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
    return process("cells", args.election)
