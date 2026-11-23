"""發布階段的選區涵蓋：把名冊寫的鄉鎮與村里對到地圖的村里代碼。

依名冊、選舉年度、地圖的村里異動與這場選舉的選區涵蓋表，解析每個選區涵蓋的村里，網站依代碼合併村里畫出選區。每個選區的涵蓋都要找得到村里，同一場選舉的村里不能屬於兩個選區，網站的地圖與清單因此是等價的兩個入口。

指令：
  由同階段的 run 呼叫。

手寫輸入：
  data/60-publish/{選舉代碼}/scope-areas.tsv   名冊寫不出村里的選區，以這張表完整定義涵蓋的鄉鎮市區與村里

慣例：
  - 選區的涵蓋依序取 scope-areas.tsv 的列、名冊的 areas、名冊的 towns，都沒有時是整個縣市。
  - 名冊與地圖的名稱依地圖的 name_equivalents 比對。選舉年度早於村里異動實施日期的年度時，名冊寫的是異動前的村里，先改成新村里再比對。
"""

from ..common import PipelineError, layer_dir, read_json, relative
from ..geo.run import MAP_PATH, VILLAGES_DIR, name_key
from ..tables import read_table

# ==================================================
# 集中設定
# ==================================================

# 選區涵蓋表的檔名與欄名。村里寫 - 表示整個鄉鎮市區
AREAS_FILE = "scope-areas.tsv"
AREAS_HEADER = ["代碼", "選區", "鄉鎮市區", "村里"]

# 名冊的涵蓋一格寫多個村里時的分隔字，也是選區涵蓋表村里欄的分隔字
AREA_SEPARATOR = "、"


class VillageIndex:
    """依縣市、鄉鎮市區與村里名稱查村里代碼。"""

    def __init__(self, counties, equivalents, year):
        """建立索引。

        參數：
            counties：`{縣市代碼: 村里地圖}`，地圖階段的 villages 檔。
            equivalents：視為相同的字。
            year：選舉年度，決定套用哪些村里異動。
        """
        self.equivalents = equivalents
        # 縣市與鄉鎮存代碼串列，村里存單一代碼，名稱都以 name_key 正規化；labels 供訊息寫出村里名稱
        self.counties, self.towns, self.villages, self.changes, self.labels = {}, {}, {}, {}, {}
        # 鄉鎮與村里的鍵都帶縣市代碼，不同縣市的同名鄉鎮不會混淆
        for county, content in counties.items():
            # 未編定村里的名稱是空字串，沒有選民，不屬於任何選區
            for village in (v for v in content["villages"] if v["name"]):
                town = (county, self.key(village["town"]))
                # 整個縣市與整個鄉鎮的涵蓋是其中的全部村里
                self.counties.setdefault(county, []).append(village["code"])
                self.towns.setdefault(town, []).append(village["code"])
                # 村里以鄉鎮加名稱為鍵，訊息以鄉鎮加名稱稱呼
                self.villages[town + (self.key(village["name"]),)] = village["code"]
                self.labels[village["code"]] = village["town"] + village["name"]
            # 選舉年度早於實施的年度時，名冊寫的是異動前的村里
            for change in content["changes"]:
                # 實施之後的選舉，名冊已經寫異動後的村里
                if year < int(change["date"][:4]):
                    key = (county, self.key(change["town"]), self.key(change["old"]))
                    self.changes[key] = [self.key(name) for name in change["new"]]

    def key(self, name):
        """比對用的名稱鍵。"""
        return name_key(name, self.equivalents)

    def town(self, county, name):
        """鄉鎮市區的全部村里代碼，找不到時回傳 None。"""
        return self.towns.get((county, self.key(name)))

    def village(self, county, towns, name):
        """在幾個鄉鎮市區內找村里。

        回傳：村里代碼的串列，找不到時回傳 None。
        """
        # 名冊的村里不帶鄉鎮，依選區所在的鄉鎮逐一找
        for town in towns:
            key = (county, self.key(town), self.key(name))
            # 異動過的村里改用新村里，分割後沿用舊名的村也只是其中一部分，所以先查異動
            names = self.changes.get(key, [key[2]])
            found = [self.villages.get(key[:2] + (name,)) for name in names]
            # 每個名稱都在這個鄉鎮時就是它們，同一選區的鄉鎮內村里不重名
            if None not in found:
                return found
        return None


def read_areas(election):
    """讀這場選舉的選區涵蓋表，依選區分組。

    參數：
        election：選舉代碼。
    回傳：`{選區代碼: [(鄉鎮市區, 村里串列或 None)]}`，村里寫 - 時是 None，表示整個鄉鎮市區。
    """
    path = layer_dir("publish", election) / AREAS_FILE
    # 名冊寫得出每個選區的涵蓋時沒有這張表
    if not path.exists():
        return {}
    grouped = {}
    # 每列是一個選區的一個鄉鎮市區，村里以頓號分隔
    for row in read_table(path, AREAS_HEADER):
        # 村里寫 - 時以 None 表示整個鄉鎮市區
        villages = None if row["村里"] == "-" else row["村里"].split(AREA_SEPARATOR)
        grouped.setdefault(row["選區"], []).append((row["鄉鎮市區"], villages))
    return grouped


def defined_villages(scope, index, defined):
    """依選區涵蓋表的列解析村里。

    參數：
        scope：名冊的選區。
        index：VillageIndex。
        defined：read_areas 回傳值中這個選區的列。
    回傳：(村里代碼的集合, 缺漏的說明串列)。
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
            codes = index.village(scope["county"], [town], name)
            # 找不到的村里列入缺漏
            if codes is None:
                missing.append(f"{scope['id']} 的村里 {town}{name}")
                continue
            # 找到的村里納入涵蓋
            found.update(codes)
    return found, missing


def roster_villages(scope, index):
    """依名冊的 areas 與 towns 解析村里。

    參數：
        scope：名冊的選區。
        index：VillageIndex。
    回傳：(村里代碼的集合, 缺漏的說明串列)。
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
        codes = index.village(scope["county"], scope["towns"], name)
        # 鄉鎮與村里都找不到時列入缺漏
        if codes is None:
            missing.append(f"{scope['id']} 的鄉鎮市區或村里 {name}")
            continue
        # 是村里時納入它，異動過的村里納入新村里
        found.update(codes)
    return found, missing


def scope_villages(scope, index, defined):
    """解析一個選區涵蓋的村里。

    參數：
        scope：名冊的選區。
        index：VillageIndex。
        defined：read_areas 回傳值中這個選區的列，沒有時為 None。
    回傳：(村里代碼的集合, 缺漏的說明串列)。
    """
    # 涵蓋表有列時以它為準，名冊寫不出村里的選區靠這張表
    if defined is not None:
        return defined_villages(scope, index, defined)
    return roster_villages(scope, index)


def election_villages(election, roster, year):
    """解析一場選舉每個選區涵蓋的村里。

    參數：
        election：選舉代碼。
        roster：這場選舉的名冊。
        year：選舉年度。
    回傳：(`{選區代碼: 依碼位排序的村里代碼}`, 地圖版本)。全國性選區沒有縣市，不在結果中。
    例外：PipelineError，地圖沒有產物、縣市代碼、鄉鎮市區或村里找不到，同一個村里屬於兩個選區，或涵蓋表寫了名冊沒有的選區，訊息列出全部問題。
    """
    # 地圖產物是發布的輸入，地圖還沒轉出時先執行地圖階段
    if not MAP_PATH.exists():
        raise PipelineError(f"找不到 {relative(MAP_PATH)}，先執行 `npm run pipeline -- geo run`")
    geo = read_json(MAP_PATH)
    # 全國性選區沒有縣市，不在地圖上
    scopes = [scope for scope in roster["scopes"] if scope["county"] is not None]
    paths = {county: VILLAGES_DIR / f"{county}.json" for county in {s["county"] for s in scopes}}
    # 縣市代碼沒有村里地圖時，這個縣市的選區都對不到村里
    problems = [f"{s['id']} 的縣市 {s['county']}" for s in scopes if not paths[s["county"]].exists()]
    # 每個用到的縣市讀一份村里地圖，缺檔的縣市已列入問題
    counties = {county: read_json(path) for county, path in paths.items() if path.exists()}
    index = VillageIndex(counties, geo["name_equivalents"], year)
    defined = read_areas(election)
    # owner 記每個村里已屬於哪個選區
    owner, result = {}, {}
    # 逐個選區解析涵蓋，同一個村里只能屬於一個選區
    for scope in (s for s in scopes if s["county"] in counties):
        found, missing = scope_villages(scope, index, defined.get(scope["id"]))
        problems.extend(missing)
        # 重複表示名冊只寫到鄉鎮而選區切開了鄉鎮，要在涵蓋表寫出村里
        for code in sorted(found):
            other = owner.setdefault(code, scope["id"])
            # 第一次出現時登記，之後出現的選區列入問題
            if other != scope["id"]:
                problems.append(f"{index.labels[code]} 同時屬於 {other} 與 {scope['id']}")
        result[scope["id"]] = sorted(found)
    # 涵蓋表寫了名冊沒有的選區，多半是代碼打錯
    problems.extend(f"{AREAS_FILE} 的選區 {scope} 不在名冊" for scope in sorted(set(defined) - set(result)))
    # 有問題時一次列出，修正名冊、涵蓋表或地圖設定後重新執行
    if problems:
        raise PipelineError(f"{election} 的選區涵蓋沒有通過：" + "、".join(problems))
    return result, geo["version"]
