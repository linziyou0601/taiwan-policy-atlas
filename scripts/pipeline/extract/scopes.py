"""抽取階段的工具：由上一屆的名冊寫出這場選舉的選區表。

選舉資料庫還沒有這場選舉時，名冊依公報手寫在選區表與名冊表。同一種選舉的選區多半與上一屆相同，本工具把上一屆名冊的選區寫成選區表，選區有變動時再對照公報改表。寫法見 docs/pipeline/extract.md 的名冊表。

指令：
  `npm run pipeline -- extract scopes --election <代碼> --from <上一屆的選舉代碼>`
  上一屆先執行過 `extract run`。

手寫輸入：
  沒有。讀取 data/20-extract/{上一屆的選舉代碼}/roster.json。

產物：
  data/20-extract/{選舉代碼}/scopes.tsv

慣例：
  - 選區表整張重寫，選區代碼、名稱、縣市與涵蓋範圍照抄上一屆。
"""

from ..common import ROSTER_FILE, election_argument, layer_dir, read_json
from ..tables import EMPTY, MULTI_SEPARATOR, write_sorted
from .run import SCOPE_HEADER

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "由上一屆的名冊寫出這場選舉的選區表"


# ==================================================
# 主體
# ==================================================


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument(
        "--from", dest="previous", required=True, help="上一屆的選舉代碼"
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數，使用 election 與 previous。
    回傳：摘要字串。
    """
    scopes = read_json(
        layer_dir("extract", args.previous) / ROSTER_FILE,
        hint=f"先執行 `npm run pipeline -- extract run --election {args.previous}`",
    )["roster"]["scopes"]
    # 選區代碼去掉上一屆的選舉代碼前綴，沒有值的欄寫 -
    rows = [
        {
            "代碼": scope["id"].split(":", 1)[1],
            "名稱": scope["name"],
            "縣市": scope["county"] or EMPTY,
            "涵蓋": MULTI_SEPARATOR.join(scope["areas"]) or EMPTY,
            "鄉鎮市區": MULTI_SEPARATOR.join(scope["towns"]) or EMPTY,
        }
        for scope in scopes
    ]
    path = layer_dir("extract", args.election) / "scopes.tsv"
    # 這場選舉還沒有抽取階段的目錄時建立
    path.parent.mkdir(parents=True, exist_ok=True)
    write_sorted(path, SCOPE_HEADER, rows)
    return f"scopes {args.election}: 由 {args.previous} 寫出 {len(rows)} 個選區"
