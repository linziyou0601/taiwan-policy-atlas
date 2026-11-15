"""發布階段的工具：依已發布的選舉與主題測驗重寫題組索引。

移除一場選舉或一套主題測驗之後執行，索引只列出資料集還在的題組。步驟見 docs/pipeline/publish.md 的產物。

指令：
  `npm run pipeline -- publish index`

手寫輸入：
  沒有。讀取 data/60-publish/ 各題組的資料集。

產物：
  data/60-publish/index.json

慣例：
  - 重寫的函式 write_index 在同階段的 run.py，`publish run`、`topics run` 與跨階段的 `run` 也呼叫它。
"""

from .run import write_index

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "依已發布的選舉與主題測驗重寫題組索引"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """這支工具沒有自己的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return write_index()
