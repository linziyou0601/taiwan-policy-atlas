"""地圖步驟：轉出選區地圖並核對名冊。

用途：依 config/pipeline/geography.yaml 取得地圖來源，轉成 data/geo/map.json，再核對每場選舉名冊的縣市代碼與鄉鎮市區名稱都找得到圖形，網站的地圖與清單才是等價的兩個入口。
指令：`python -m pipeline geo [--offline]`
慣例：
  - 地圖不分選舉，名冊匯入後才能核對，因此在各場選舉的抽取層之後執行。
  - 名冊找不到圖形時本步驟失敗並列出名稱，不以相近名稱猜測對應。
  - 產物記下來源的 sha256 與核對結果，網站在地圖下方顯示資料來源與授權。
"""

from . import fetch
from .adapters import ADAPTERS
from .common import (
    DATA_DIR,
    PIPELINE_CONFIG_DIR,
    ROOT,
    PipelineError,
    app_settings,
    election_ids,
    layer_dir,
    read_json,
    read_yaml,
    relative,
    sources_config,
    write_json,
)

# ---- 集中設定 ----

# 地圖設定與產物的位置
SETTINGS_PATH = PIPELINE_CONFIG_DIR / "geography.yaml"
MAP_PATH = DATA_DIR / "geo" / "map.json"

# 產物的格式名稱與版本，取自 settings.json 的 `formats.map`，網站載入時以同一份設定核對
FORMAT = app_settings()["formats"]["map"]


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
    # 缺漏收齊後一次回報，摘要計數寫進產物
    missing = []
    counted = {"elections": 0, "scopes": 0, "towns": 0}
    # 逐場讀抽取層的名冊
    for election in election_ids():
        roster = read_json(layer_dir("extract", election) / "roster.json")["roster"]
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
    """執行地圖步驟。

    參數：
        offline：True 時只用快取。
    回傳：摘要字串。
    例外：PipelineError，來源未登錄、adapter 沒有 geography 能力、轉換或核對失敗。
    """
    settings = read_yaml(SETTINGS_PATH)
    source = sources_config().get(settings["source"])
    # 地圖來源要登錄在 sources.yaml
    if source is None:
        raise PipelineError(f"geography.yaml 的來源 {settings['source']} 沒有登錄")
    convert = ADAPTERS.get(source["adapter"], {}).get("geography")
    # adapter 要提供轉出地圖的能力
    if convert is None:
        raise PipelineError(f"adapter {source['adapter']} 沒有 geography 能力")
    # 取得原始檔後轉出圖層，再核對各場名冊
    entry = fetch.ensure_source(source, offline)
    result = convert(ROOT / entry["file"], settings)
    checks = check_rosters(result["layers"], settings["name_equivalents"])
    # 產物附上來源、核對結果與名稱對應，網站顯示來源並以同一套規則比對名稱
    write_json(
        MAP_PATH,
        result
        | {
            "format": FORMAT["name"],
            "format_version": FORMAT["version"],
            "source": {
                key: entry[key] for key in ("id", "name", "url", "sha256", "license")
            },
            "checks": checks,
            "name_equivalents": settings["name_equivalents"],
        },
    )
    # 摘要列出各圖層的圖形數
    counts = "、".join(
        f"{name} {len(features)}" for name, features in result["layers"].items()
    )
    return f"geo: {relative(MAP_PATH)}，{counts}，核對 {checks['elections']} 場選舉 {checks['scopes']} 個選區"
