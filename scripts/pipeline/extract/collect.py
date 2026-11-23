"""抽取階段的工具：把各選區的轉錄輸出寫進這個階段，並登錄用到的公報。

讀取每個選區輸出目錄的說明表與轉錄稿，把用到的公報與政見影像依 sha256 登錄到選舉定義的 documents，再寫入轉錄稿與段落表。草稿的格式見 docs/pipeline/review-protocol.md 的草稿格式。

指令：
  `npm run pipeline -- extract collect --election <代碼> --office <字尾>=<職稱> [--office ...] <選區輸出目錄>...`

手寫輸入：
  {選區輸出目錄}/notes.tsv 與 {選區代碼}-{號次}.txt

產物：
  data/20-extract/{選舉代碼}/transcripts.tsv、transcripts/ 與 data/10-fetch/{選舉代碼}/election.yaml 的 documents

慣例：
  - `--office` 每個字尾寫一次，把鄉鎮名稱的字尾對到職稱，選區沒有鄉鎮時對縣市名稱的字尾，公報的標題依它組成。
  - 寫入的函式在同階段的 _transcripts.py。
"""

import argparse
from pathlib import Path

from ..common import election_argument
from ._transcripts import collect_units

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "把各選區的轉錄輸出寫進這個階段，並把用到的公報登錄到選舉定義"


# ==================================================
# 主體
# ==================================================


def office_pair(text):
    """解析 `--office` 的一項。

    參數：
        text：`字尾=職稱`。
    回傳：`(字尾, 職稱)`。
    例外：argparse.ArgumentTypeError，沒有等號或任一邊是空的。
    """
    suffix, _, title = text.partition("=")
    # 兩邊都要有內容，職稱才對得到鄉鎮的字尾
    if not suffix or not title:
        raise argparse.ArgumentTypeError(f"{text} 要寫成 字尾=職稱")
    return suffix, title


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument(
        "--office",
        action="append",
        default=[],
        type=office_pair,
        metavar="字尾=職稱",
        help="鄉鎮名稱的字尾對應的職稱，選區沒有鄉鎮時是縣市名稱的字尾，可以寫多次",
    )
    parser.add_argument("directories", nargs="+", type=Path, help="選區輸出目錄")


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return collect_units(args.election, args.directories, dict(args.office))
