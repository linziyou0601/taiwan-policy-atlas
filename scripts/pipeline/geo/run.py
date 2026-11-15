"""地圖階段的核對與產物：轉出選區地圖並核對名冊。

依地圖設定取得圖形來源，轉換成網站直接畫出的 SVG 路徑，再核對每場選舉名冊的縣市代碼與鄉鎮市區名稱都有對應的圖形，網站的地圖與清單因此是等價的兩個入口。步驟見 docs/pipeline/geo.md。

指令：
  `npm run pipeline -- geo run [--offline]`

手寫輸入：
  data/geo/geography.yaml   來源、圖層、座標的小數位數與名稱對照

產物：
  data/geo/map.json   縣市與鄉鎮市區的代碼、名稱與路徑，另記來源的 sha256 與核對的結果

慣例：
  - 地圖和選舉互不相依，名冊匯入後才能核對，所以在各場選舉的抽取階段之後執行。
  - 名冊找不到圖形時這個階段失敗並列出名稱，名稱的對照只來自地圖設定的 name_equivalents。
"""

from ..common import (
    DATA_DIR,
    ROSTER_FILE,
    PipelineError,
    election_ids,
    format_fields,
    layer_dir,
    read_json,
    read_yaml,
    relative,
    sources_config,
    write_json,
)
from ..fetch import run as fetch

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "轉出選區地圖並核對每場選舉的名冊"

# 地圖設定與產物的位置
SETTINGS_PATH = DATA_DIR / "geo" / "geography.yaml"
MAP_PATH = DATA_DIR / "geo" / "map.json"


def name_key(name, equivalents):
    """把名稱轉成比對用的鍵。

    參數：
        name：縣市或鄉鎮市區名稱。
        equivalents：視為相同的字，例如 {"臺": "台"}。
    回傳：替換後的字串。
    """
    # 逐字替換設定登錄的異體字
    for source, target in equivalents.items():
        name = name.replace(source, target)
    return name


def check_rosters(layers, equivalents):
    """核對每場選舉名冊的縣市與鄉鎮市區都有圖形。

    參數：
        layers：extract_map 回傳的圖層。
        equivalents：視為相同的字。
    回傳：`{"elections": 場數, "scopes": 有縣市的選區數, "towns": 比對到的鄉鎮名稱數}`。
    例外：PipelineError，有縣市代碼或鄉鎮市區名稱找不到圖形，訊息列出全部缺漏。
    """
    counties = {county["code"] for county in layers["counties"]}
    towns = {
        (town["county"], name_key(town["name"], equivalents))
        for town in layers["towns"]
    }
    # 缺漏收齊後一次回報，摘要計數寫入產物
    missing = []
    counted = {"elections": 0, "scopes": 0, "towns": 0}
    # 逐場讀抽取階段的名冊
    for election in election_ids():
        roster = read_json(layer_dir("extract", election) / ROSTER_FILE)["roster"]
        counted["elections"] += 1
        # 逐個選區核對
        for scope in roster["scopes"]:
            # 全國性選區不在地圖上標示
            if scope["county"] is None:
                continue
            counted["scopes"] += 1
            # 縣市代碼要有圖形
            if scope["county"] not in counties:
                missing.append(f"{scope['id']} 的縣市 {scope['county']}")
            # 選區所在或涵蓋的鄉鎮市區都要有圖形
            for town in scope["towns"]:
                # 名稱以縣市代碼限定，不同縣市的同名鄉鎮不會混淆
                if (scope["county"], name_key(town, equivalents)) not in towns:
                    missing.append(f"{scope['id']} 的鄉鎮市區 {town}")
                # 比對到的名稱計入摘要
                else:
                    counted["towns"] += 1
    # 有缺漏時一次列出，修正設定後重新執行
    if missing:
        raise PipelineError("地圖找不到以下名冊項目：" + "、".join(missing))
    return counted


def run(offline=False):
    """執行 geo 階段。

    參數：
        offline：True 時只使用快取。
    回傳：摘要字串。
    例外：PipelineError，來源未登錄、adapter 沒有 geography 能力、轉換或核對失敗。
    """
    settings = read_yaml(SETTINGS_PATH)
    # 地圖來源要登錄在 sources.yaml，取得原始檔後轉出圖層，再核對各場名冊
    entry, convert = fetch.fetch_source(
        sources_config(), settings["source"], "geography", offline, "geography.yaml"
    )
    result = convert(fetch.cached_path(entry), settings)
    checks = check_rosters(result["layers"], settings["name_equivalents"])
    # 產物附上來源、核對結果與名稱對應，網站顯示來源並以同一套規則比對名稱
    write_json(
        MAP_PATH,
        result
        | format_fields("map")
        | {
            "source": fetch.public_source(entry),
            "checks": checks,
            "name_equivalents": settings["name_equivalents"],
        },
    )
    # 摘要列出各圖層的圖形數
    counts = "、".join(
        f"{name} {len(features)}" for name, features in result["layers"].items()
    )
    return f"geo: {relative(MAP_PATH)}，{counts}，核對 {checks['elections']} 場選舉 {checks['scopes']} 個選區"


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    parser.add_argument(
        "--offline", action="store_true", help="只用 .cache/sources/ 內的原始檔"
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return run(offline=args.offline)
