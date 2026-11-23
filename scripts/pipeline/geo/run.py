"""地圖階段的核對與產物：把村里界線轉成縣市地圖與各縣市的村里地圖。

依地圖設定取得圖形來源，投影並簡化成網站的螢幕座標，寫出縣市地圖與每個縣市的村里地圖，村里地圖附上這個縣市的村里異動。地圖不讀任何選舉，選舉在發布階段以村里代碼指定選區的涵蓋，網站依代碼合併村里畫出選區。步驟見 docs/pipeline/geo.md。

指令：
  `npm run pipeline -- geo run [--offline]`

手寫輸入：
  data/geo/geography.yaml       來源、投影、村里的屬性、圖層、座標的小數位數與名稱對照
  data/geo/village-changes.tsv  村里的改名、分割與合併

產物：
  data/geo/map.json                   縣市的代碼、名稱與路徑，插圖的方框，來源、名稱對照與地圖版本
  data/geo/villages/{縣市代碼}.json   這個縣市的座標位數、弧線、村里與村里異動

慣例：
  - 弧線的座標乘上 10 的 digits 次方取整數，第一點寫絕對座標，其後寫與前一點的差。
  - 村里的環是帶方向的弧線索引，~i 表示第 i 條弧線反向使用，索引只在同一個縣市檔內有效。
  - 地圖版本是全部產物內容的 sha256 前 12 碼，發布階段記下它，地圖重新產生後各場選舉從發布階段重新執行。
"""

from ..common import (
    DATA_DIR,
    PipelineError,
    data_version,
    format_fields,
    read_yaml,
    relative,
    sources_config,
    write_json,
)
from ..fetch import run as fetch
from ..tables import read_table

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "轉出縣市地圖與各縣市的村里地圖"

# 地圖設定與產物的位置
SETTINGS_PATH = DATA_DIR / "geo" / "geography.yaml"
MAP_PATH = DATA_DIR / "geo" / "map.json"
VILLAGES_DIR = DATA_DIR / "geo" / "villages"

# 村里異動表的位置與欄名。新村里以頓號分隔，分割時寫出全部
CHANGES_PATH = DATA_DIR / "geo" / "village-changes.tsv"
CHANGES_HEADER = ["代碼", "縣市代碼", "鄉鎮市區", "舊村里", "新村里", "實施日期", "依據"]
CHANGES_SEPARATOR = "、"


def name_key(name, equivalents):
    """把名稱轉成比對用的鍵。

    參數：
        name：鄉鎮市區或村里名稱。
        equivalents：視為相同的字，例如 {"臺": "台"}。
    回傳：替換後的字串。
    """
    # 逐字替換設定登錄的異體字
    for source, target in equivalents.items():
        name = name.replace(source, target)
    return name


def encode_arc(points, digits):
    """把一條弧線寫成整數的差分序列。

    參數：
        points：(x, y) 的串列。
        digits：座標保留的小數位數。
    回傳：`[x0, y0, dx1, dy1, ...]`，單位是 10 的 -digits 次方。
    """
    scale = 10**digits
    # 先取整數再相減，差分不會累積誤差
    numbers = [(round(x * scale), round(y * scale)) for x, y in points]
    flat = list(numbers[0])
    # 其後每點寫與前一點的差
    for (px, py), (x, y) in zip(numbers, numbers[1:]):
        flat += [x - px, y - py]
    return flat


def county_file(county, units, arcs, changes, digits):
    """組出一個縣市的村里地圖。

    參數：
        county：縣市代碼。
        units：這個縣市的村里，extract_map 的 units。
        arcs：extract_map 的全部弧線。
        changes：這個縣市的村里異動列。
        digits：座標保留的小數位數。
    回傳：村里地圖的內容，不含格式欄位。
    """
    local = {}
    # 只收這個縣市用到的弧線，依第一次用到的順序重新編號
    for index in (i for unit in units for ring in unit["rings"] for i in ring):
        # 反向使用的 ~i 與 i 是同一條弧線
        local.setdefault(index if index >= 0 else ~index, len(local))

    def renumber(index):
        """全域的弧線索引換成縣市檔內的索引，保留方向。"""
        return local[index] if index >= 0 else ~local[~index]

    # 村里只留發布階段比對名冊與網站合併需要的欄位
    villages = [
        {
            "code": unit["code"],
            "town": unit["town"],
            "name": unit["name"],
            "rings": [[renumber(i) for i in ring] for ring in unit["rings"]],
        }
        for unit in units
    ]
    # 異動只留發布階段比對名冊需要的欄位
    moved = [
        {
            "town": row["鄉鎮市區"],
            "old": row["舊村里"],
            "new": row["新村里"].split(CHANGES_SEPARATOR),
            "date": row["實施日期"],
        }
        for row in changes
    ]
    return {
        "county": county,
        "digits": digits,
        "arcs": [encode_arc(arcs[n], digits) for n in local],
        "villages": villages,
        "changes": moved,
    }


def check_changes(rows, units, equivalents):
    """核對村里異動表的新村里都在地圖上。

    參數：
        rows：村里異動表的列。
        units：extract_map 的 units。
        equivalents：視為相同的字。
    例外：PipelineError，有新村里不在地圖上，訊息列出全部。
    """
    known = {
        (unit["county"], name_key(unit["town"], equivalents), name_key(unit["name"], equivalents))
        for unit in units
    }
    # 縣市代碼、鄉鎮與村里名稱都依名稱對照比對
    missing = [
        f"{row['代碼']} 的 {row['鄉鎮市區']}{name}"
        for row in rows
        for name in row["新村里"].split(CHANGES_SEPARATOR)
        if (row["縣市代碼"], name_key(row["鄉鎮市區"], equivalents), name_key(name, equivalents))
        not in known
    ]
    # 新村里對不到圖形時，選舉的涵蓋會缺一塊，一次列出後修正
    if missing:
        raise PipelineError(f"{relative(CHANGES_PATH)} 的新村里不在地圖上：" + "、".join(missing))


def run(offline=False):
    """執行 geo 階段。

    參數：
        offline：True 時只使用快取。
    回傳：摘要字串。
    例外：PipelineError，來源未登錄、adapter 沒有 geography 能力、轉換或核對失敗。
    """
    settings = read_yaml(SETTINGS_PATH)
    # 地圖來源要登錄在 sources.yaml，取得原始檔後轉出弧線、村里與圖層
    entry, convert = fetch.fetch_source(
        sources_config(), settings["source"], "geography", offline, "geography.yaml"
    )
    result = convert(fetch.cached_path(entry), settings)
    equivalents = settings["name_equivalents"]
    # 沒有村里異動時可以沒有這張表
    rows = read_table(CHANGES_PATH, CHANGES_HEADER) if CHANGES_PATH.exists() else []
    check_changes(rows, result["units"], equivalents)
    by_county = {}
    # 村里依縣市分檔，網站選了縣市才讀那一份
    for unit in result["units"]:
        by_county.setdefault(unit["county"], []).append(unit)
    # 每個縣市帶著自己的村里異動，依縣市代碼排序
    counties = {
        county: county_file(
            county,
            units,
            result["arcs"],
            [row for row in rows if row["縣市代碼"] == county],
            settings["digits"],
        )
        for county, units in sorted(by_county.items())
    }
    # 縣市地圖帶名稱對照，發布階段以同一套規則比對名冊
    body = {
        "view_box": result["view_box"],
        "layers": result["layers"],
        "source": fetch.public_source(entry),
        "name_equivalents": equivalents,
    }
    # 地圖版本涵蓋全部產物，發布階段以它確認選區的涵蓋是對這一版地圖解析的
    version = data_version({"map": body, "villages": counties})
    write_json(MAP_PATH, format_fields("map") | body | {"version": version})
    VILLAGES_DIR.mkdir(parents=True, exist_ok=True)
    # 舊的村里檔先清掉，來源不再有的縣市不留下檔案
    for stale in VILLAGES_DIR.glob("*.json"):
        stale.unlink()
    # 每個縣市寫一份，帶地圖版本
    for county, content in counties.items():
        stamp = format_fields("villages") | {"version": version}
        write_json(VILLAGES_DIR / f"{county}.json", stamp | content)
    # 摘要寫出縣市數、村里數與地圖版本
    counts = sum(len(content["villages"]) for content in counties.values())
    return f"geo: {relative(MAP_PATH)}，{len(counties)} 個縣市、{counts} 個村里，地圖版本 {version}"


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
