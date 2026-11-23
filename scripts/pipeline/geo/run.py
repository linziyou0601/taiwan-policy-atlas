"""地圖階段的核對與產物：轉出縣市、鄉鎮與每場選舉的選區地圖並核對名冊。

依地圖設定取得圖形來源，由村里合併出縣市、鄉鎮市區與每場選舉的選區，轉換成網站直接畫出的 SVG 路徑。每個選區的涵蓋都要找得到村里，同一場選舉的村里不能屬於兩個選區，網站的地圖與清單因此是等價的兩個入口。步驟見 docs/pipeline/geo.md。

指令：
  `npm run pipeline -- geo run [--offline]`

手寫輸入：
  data/geo/geography.yaml    來源、基本單位、圖層、座標的小數位數與名稱對照
  data/geo/scope-areas.tsv   名冊寫不出村里的選區，以這張表完整定義涵蓋的鄉鎮市區與村里

產物：
  data/geo/map.json                  縣市與鄉鎮市區的代碼、名稱與路徑，另記來源的 sha256 與核對的結果
  data/geo/districts/{選舉代碼}.json   這場選舉每個選區的縣市與路徑

慣例：
  - 地圖和選舉互不相依，名冊匯入後才能核對，所以在各場選舉的抽取階段之後執行。
  - 名冊找不到圖形時這個階段失敗並列出名稱，名稱的對照只來自地圖設定的 name_equivalents。
  - 選區的涵蓋依序取 scope-areas.tsv 的列、名冊的 areas、名冊的 towns，都沒有時是整個縣市。
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
from ..tables import read_table

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "轉出選區地圖並核對每場選舉的名冊"

# 地圖設定與產物的位置
SETTINGS_PATH = DATA_DIR / "geo" / "geography.yaml"
MAP_PATH = DATA_DIR / "geo" / "map.json"
DISTRICTS_DIR = DATA_DIR / "geo" / "districts"

# 選區涵蓋表的位置與欄名。村里寫 - 表示整個鄉鎮市區
AREAS_PATH = DATA_DIR / "geo" / "scope-areas.tsv"
AREAS_HEADER = ["代碼", "選區", "鄉鎮市區", "村里"]

# 名冊的涵蓋一格寫多個村里時的分隔字
AREA_SEPARATOR = "、"


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


class UnitIndex:
    """依縣市、鄉鎮市區與村里名稱查基本單位。"""

    def __init__(self, units, equivalents):
        """建立索引。

        參數：
            units：extract_map 回傳的基本單位。
            equivalents：視為相同的字。
        """
        self.equivalents = equivalents
        # 三層索引的值都是單位編號，縣市與鄉鎮存串列，村里存單一編號
        self.counties = {}
        self.towns = {}
        self.villages = {}
        # 名稱都以 name_key 正規化，縣市以代碼限定，不同縣市的同名鄉鎮不會混淆
        for number, unit in enumerate(units):
            town = (unit["county"], self.key(unit["town"]))
            self.counties.setdefault(unit["county"], []).append(number)
            # 鄉鎮與村里的鍵都帶縣市代碼
            self.towns.setdefault(town, []).append(number)
            self.villages[town + (self.key(unit["name"]),)] = number

    def key(self, name):
        """比對用的名稱鍵。"""
        return name_key(name, self.equivalents)

    def town(self, county, name):
        """鄉鎮市區的全部單位，找不到時回傳 None。"""
        return self.towns.get((county, self.key(name)))

    def village(self, county, towns, name):
        """在幾個鄉鎮市區內找村里，找不到時回傳 None。"""
        # 名冊的村里不帶鄉鎮，依選區所在的鄉鎮逐一找
        for town in towns:
            found = self.villages.get((county, self.key(town), self.key(name)))
            # 找到第一個就是，同一選區的鄉鎮內村里不重名
            if found is not None:
                return found
        return None


def read_areas():
    """讀選區涵蓋表，依選區分組。

    回傳：`{選區代碼: [(鄉鎮市區, 村里串列或 None)]}`，村里寫 - 時是 None，表示整個鄉鎮市區。
    """
    # 沒有任何選區需要另外定義時可以沒有這張表
    if not AREAS_PATH.exists():
        return {}
    grouped = {}
    # 每列是一個選區的一個鄉鎮市區，村里以頓號分隔
    for row in read_table(AREAS_PATH, AREAS_HEADER):
        # 村里寫 - 時以 None 表示整個鄉鎮市區
        villages = None if row["村里"] == "-" else row["村里"].split(AREA_SEPARATOR)
        grouped.setdefault(row["選區"], []).append((row["鄉鎮市區"], villages))
    return grouped


def defined_units(scope, index, defined):
    """依選區涵蓋表的列解析基本單位。

    參數：
        scope：名冊的選區。
        index：UnitIndex。
        defined：read_areas 回傳值中這個選區的列。
    回傳：(單位編號的集合, 缺漏的說明串列)。
    """
    found, missing = set(), []
    # 每列是一個鄉鎮市區，寫出村里時只取那些村里
    for town, villages in defined:
        whole = index.town(scope["county"], town)
        # 涵蓋表寫的鄉鎮要在地圖上
        if whole is None:
            missing.append(f"{scope['id']} 的鄉鎮市區 {town}")
            continue
        # 村里寫 - 時是整個鄉鎮市區
        if villages is None:
            found.update(whole)
            continue
        # 列出村里時逐一找
        for name in villages:
            number = index.village(scope["county"], [town], name)
            # 找不到的村里列入缺漏
            if number is None:
                missing.append(f"{scope['id']} 的村里 {town}{name}")
                continue
            # 找到的村里納入涵蓋
            found.add(number)
    return found, missing


def roster_units(scope, index):
    """依名冊的 areas 與 towns 解析基本單位。

    參數：
        scope：名冊的選區。
        index：UnitIndex。
    回傳：(單位編號的集合, 缺漏的說明串列)。
    """
    # 名冊的 areas 可能是鄉鎮或村里，一格可能以頓號寫多個村里
    names = [name for area in scope["areas"] for name in area.split(AREA_SEPARATOR)]
    # 沒有 areas 時涵蓋 towns
    names = names or list(scope["towns"])
    # 也沒有 towns 時是整個縣市
    if not names:
        return set(index.counties.get(scope["county"], [])), []
    found, missing = set(), []
    # 每個名稱先當鄉鎮找，找不到再到選區所在的鄉鎮內找村里
    for name in names:
        whole = index.town(scope["county"], name)
        # 是鄉鎮時整個納入
        if whole is not None:
            found.update(whole)
            continue
        # 不是鄉鎮時到選區所在的鄉鎮內找村里
        number = index.village(scope["county"], scope["towns"], name)
        # 鄉鎮與村里都找不到時列入缺漏
        if number is None:
            missing.append(f"{scope['id']} 的鄉鎮市區或村里 {name}")
            continue
        # 是村里時納入那一個
        found.add(number)
    return found, missing


def scope_units(scope, index, defined):
    """解析一個選區涵蓋的基本單位。

    參數：
        scope：名冊的選區。
        index：UnitIndex。
        defined：read_areas 回傳值中這個選區的列，沒有時為 None。
    回傳：(單位編號的集合, 缺漏的說明串列)。
    """
    # 涵蓋表有列時以它為準，名冊寫不出村里的選區靠這張表
    if defined is not None:
        return defined_units(scope, index, defined)
    return roster_units(scope, index)


def overlaps(owner, found, scope, units):
    """登記這個選區的單位，列出已屬於其他選區的單位。

    參數：
        owner：這場選舉已登記的 `{單位編號: 選區代碼}`，會被更新。
        found：這個選區的單位編號。
        scope：名冊的選區。
        units：extract_map 回傳的基本單位。
    回傳：問題的說明串列。
    """
    problems = []
    # 同一場選舉的村里只能屬於一個選區，重複表示名冊只寫到鄉鎮而選區切開了鄉鎮
    for number in sorted(found):
        other = owner.setdefault(number, scope["id"])
        # 第一次出現時登記，之後出現的選區列入問題
        if other != scope["id"]:
            unit = units[number]
            problems.append(
                f"{unit['town']}{unit['name']} 同時屬於 {other} 與 {scope['id']}"
            )
    return problems


def election_districts(roster, mapped, index, defined, counties):
    """合併一場選舉的選區。

    參數：
        roster：這場選舉的名冊。
        mapped：extract_map 的回傳值。
        index：UnitIndex。
        defined：read_areas 的回傳值。
        counties：地圖上的縣市代碼。
    回傳：(選區圖形串列, 問題串列, 有縣市的選區數)。
    """
    owner, features, problems = {}, [], []
    # 全國性選區不在地圖上標示
    scopes = [scope for scope in roster["scopes"] if scope["county"] is not None]
    # 逐個選區解析涵蓋並合併
    for scope in scopes:
        # 縣市代碼要有圖形
        if scope["county"] not in counties:
            problems.append(f"{scope['id']} 的縣市 {scope['county']}")
            continue
        # 解析涵蓋，缺漏與重複都列入問題
        found, missing = scope_units(scope, index, defined.get(scope["id"]))
        problems.extend(missing + overlaps(owner, found, scope, mapped["units"]))
        # 有缺漏的選區不畫，問題列出後修正
        if not found or missing:
            continue
        path_text, rings = mapped["draw"]([mapped["units"][n] for n in found])
        # 圖形帶選區代碼與縣市，網站依縣市篩選後畫出
        feature = {"scope": scope["id"], "county": scope["county"]}
        features.append(feature | {"path": path_text, "rings": rings})
    return sorted(features, key=lambda f: f["scope"]), problems, len(scopes)


def build_districts(mapped, equivalents):
    """合併每場選舉的選區並核對名冊。

    參數：
        mapped：extract_map 的回傳值，取 layers、units 與 draw。
        equivalents：視為相同的字。
    回傳：(`{選舉代碼: 選區串列}`, `{"elections": 場數, "scopes": 有縣市的選區數}`)。
    例外：PipelineError，有縣市代碼、鄉鎮市區或村里找不到圖形，或同一場選舉的村里屬於兩個選區，訊息列出全部問題。
    """
    counties = {county["code"] for county in mapped["layers"]["counties"]}
    index = UnitIndex(mapped["units"], equivalents)
    defined = read_areas()
    # 問題收齊後一次回報，摘要計數寫入產物
    problems, districts, known = [], {}, set()
    counted = {"elections": 0, "scopes": 0}
    # 逐場讀抽取階段的名冊
    for election in election_ids():
        roster = read_json(layer_dir("extract", election) / ROSTER_FILE)["roster"]
        features, found, scopes = election_districts(
            roster, mapped, index, defined, counties
        )
        # 記下這場的選區與計數，涵蓋表的選區要在某場名冊中
        districts[election] = features
        problems.extend(found)
        known.update(scope["id"] for scope in roster["scopes"])
        # 摘要計數寫入地圖產物
        counted["elections"] += 1
        counted["scopes"] += scopes
    # 涵蓋表寫了名冊沒有的選區，多半是代碼打錯
    unknown = sorted(set(defined) - known)
    problems.extend(
        f"{relative(AREAS_PATH)} 的選區 {scope} 不在名冊" for scope in unknown
    )
    # 有問題時一次列出，修正名冊、涵蓋表或設定後重新執行
    if problems:
        raise PipelineError("地圖核對沒有通過：" + "、".join(problems))
    return districts, counted


def write_districts(districts, source):
    """每場選舉寫一個選區檔。

    參數：
        districts：build_districts 回傳的選區。
        source：地圖來源的公開資訊。
    """
    DISTRICTS_DIR.mkdir(parents=True, exist_ok=True)
    # 舊的選區檔先清掉，移除的選舉不留下檔案
    for stale in DISTRICTS_DIR.glob("*.json"):
        stale.unlink()
    # 網站選定選舉後才讀那一場的選區檔
    for election, features in districts.items():
        stamp = format_fields("districts")
        # 選區檔帶選舉代碼與來源，網站顯示來源
        body = {"election": election, "source": source, "districts": features}
        write_json(DISTRICTS_DIR / f"{election}.json", stamp | body)


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
    # 先合併並核對選區，有問題時不寫任何產物
    districts, checks = build_districts(result, settings["name_equivalents"])
    source = fetch.public_source(entry)
    # 產物附上來源、核對結果與名稱對應，網站顯示來源並以同一套規則比對名稱
    write_json(
        MAP_PATH,
        {"view_box": result["view_box"], "layers": result["layers"]}
        | format_fields("map")
        | {
            "source": source,
            "checks": checks,
            "name_equivalents": settings["name_equivalents"],
        },
    )
    write_districts(districts, source)
    # 摘要列出各圖層的圖形數與選區檔的場數
    counts = "、".join(
        f"{name} {len(features)}" for name, features in result["layers"].items()
    )
    places = f"{relative(DISTRICTS_DIR)} {len(districts)} 場選舉"
    return f"geo: {relative(MAP_PATH)}，{counts}，{places}，核對 {checks['elections']} 場選舉 {checks['scopes']} 個選區"


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
