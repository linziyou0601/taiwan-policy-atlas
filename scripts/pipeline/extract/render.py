"""抽取階段的工具：把一份公報的頁面渲染成 PNG，供轉錄時檢視。

轉錄時依號次與姓名找出每位參選者的政見欄，以 `--clip` 只渲染政見欄，並提高 `--scale` 到字高 30 像素以上。規則見 docs/pipeline/extract.md 的步驟。

指令：
  `npm run pipeline -- extract render <PDF> --out <目錄> [--scale <每 pt 像素>] [--pages <頁碼>...] [--clip <x0> <y0> <x1> <y1>]`

手寫輸入：
  沒有。讀取指定的 PDF。

產物：
  {輸出目錄}/page-{頁碼}.png，`--clip` 的輸出是 page-{頁碼}-{x0}-{y0}.png

慣例：
  - 渲染的函式在同階段的 _pdf.py。
"""

from pathlib import Path

from ._pdf import RENDER_SCALE, render_pages

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "把一份公報的頁面渲染成 PNG"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    parser.add_argument("pdf", type=Path, help="公報 PDF 的路徑")
    parser.add_argument("--out", type=Path, required=True, help="輸出目錄")
    parser.add_argument(
        "--scale", type=float, default=RENDER_SCALE, help="每 pt 的像素數"
    )
    # 只渲染政見欄時寫範圍，提高倍率時不必渲染整頁
    parser.add_argument(
        "--pages", type=int, nargs="*", default=[], help="頁碼，省略時渲染每一頁"
    )
    parser.add_argument(
        "--clip",
        type=float,
        nargs=4,
        metavar=("X0", "Y0", "X1", "Y1"),
        help="只渲染這個範圍，單位是 pt",
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return "\n".join(
        render_pages(args.pdf, args.out, args.scale, args.pages, args.clip)
    )
