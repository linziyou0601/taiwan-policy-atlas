"""中選會選舉資料庫的名冊 adapter。

從 votedata.zip 的 elbase（行政區）、elcand（候選人）、elpaty（政黨）三張表，匯入一場選舉的選區與參選對象。

指令：
  由抽取階段經 adapter 登錄表呼叫 extract_roster，不單獨執行。

慣例：
  - 行政代碼五段依序為省市、縣市、選區、鄉鎮市區、村里，選區代碼依選區類型取其中幾段，以 - 相接。
  - 參選對象代碼為「選舉代碼:選區代碼:號次」，同一選區的號次唯一。
  - 正副組合的副手與正手同號次，副手欄為 Y，併入正手的 running_mate。
  - elcand 以私用區的造字代替罕用字，碼位的意思依年度不同。姓名中的造字依 scripts/pipeline/tables/roster-characters.tsv 換成公報的寫法，代碼是名冊目錄的西元年與碼位，表中沒有的造字停止並列出。
"""

import csv
import io
import re

from ..common import PipelineError
from ..tables import read_config_table
from .archive import open_members, read_member

# ==================================================
# 集中設定
# ==================================================

# 三張表在每個名冊目錄下的檔名
TABLES = {"base": "elbase.csv", "candidate": "elcand.csv", "party": "elpaty.csv"}

# elcand 各欄的位置：行政代碼五段、號次、姓名、政黨代號、現任註記、副手註記，與中選會的檔案格式說明一致
COLUMN = {
    "codes": slice(0, 5),
    "number": 5,
    "name": 6,
    "party": 7,
    "incumbent": 13,
    "deputy": 15,
}

# 行政代碼五段的位置
CODE = {"province": 0, "city": 1, "area": 2, "town": 3, "village": 4}

# 各選區類型取哪幾段組成選區代碼
SCOPE_PARTS = {
    "national": [],
    "county": ["province", "city"],
    "district": ["province", "city", "area"],
    "town": ["province", "city", "town"],
    "town-district": ["province", "city", "town", "area"],
    "village": ["province", "city", "town", "village"],
}

# 現任與副手欄表示「是」的寫法
YES = "Y"

# 全國範圍的選區代碼與名稱，全國性選舉只有這一個選區
NATIONAL = {"key": "national", "name": "全國"}

# 行政代碼各段沒有值時的寫法
EMPTY_CODES = {"area": "00", "town": "000", "village": "0000"}

# 位在單一鄉鎮市區內的選區類型
TOWN_LEVEL = {"town", "town-district", "village"}

# Unicode 私用區，中選會的造字落在這裡
PRIVATE_USE = re.compile("[\ue000-\uf8ff]")

# 名冊目錄在 voteData 之下的第一段以西元年開頭，造字表的代碼以它區分年度
DIRECTORY_YEAR = re.compile(r"voteData/(\d{4})")

# 各選區類型的顯示名稱寫法，{county}、{town}、{village}、{number} 依行政代碼查出後代入
SCOPE_NAMES = {
    "national": NATIONAL["name"],
    "county": "{county}",
    "district": "{county} 第 {number} 選舉區",
    "town": "{county} {town}",
    "town-district": "{county} {town} 第 {number} 選舉區",
    "village": "{county} {town} {village}",
}


def read_text(archive, members, name):
    """讀取封存檔內的一個文字成員。

    參數：
        archive、members：open_members 的回傳值。
        name：成員路徑。
    回傳：字串。中選會的 CSV 以 UTF-8 加 BOM 編碼。
    """
    return read_member(archive, members, name).decode("utf-8-sig")


def read_csv(archive, members, name):
    """讀取封存檔內的一張 CSV。

    參數：
        archive、members、name：見 read_text。
    回傳：列的串列，每列是字串串列。
    """
    return list(csv.reader(io.StringIO(read_text(archive, members, name))))


def scope_key(codes, scope_type):
    """依選區類型組成選區代碼。

    參數：
        codes：行政代碼五段。
        scope_type：選區類型，SCOPE_PARTS 的鍵。
    回傳：各段以 - 相接的代碼，全國性選舉為 national。
    """
    parts = SCOPE_PARTS[scope_type]
    # 全國性選舉不分選區
    if not parts:
        return NATIONAL["key"]
    return "-".join(codes[CODE[part]] for part in parts)


# ==================================================
# 行政區名稱
# ==================================================


class Places:
    """elbase 的行政區名稱索引。

    elbase 每列是一個行政單位的五段代碼與名稱，沒有值的段寫 00、000 或 0000。選區名稱與選區涵蓋的範圍都由這張表查出。
    """

    def __init__(self, rows):
        """建立索引。

        參數：
            rows：elbase 的列，欄數不足 6 的列略過。
        """
        self.rows = [row for row in rows if len(row) >= 6]
        self.names = {tuple(row[:5]): row[5] for row in self.rows}

    def county(self, codes):
        """縣市名稱。

        參數：
            codes：行政代碼五段。
        回傳：選區、鄉鎮、村里三段都為空的那一列的名稱，找不到時為空字串。
        """
        key = (
            codes[0],
            codes[1],
            EMPTY_CODES["area"],
            EMPTY_CODES["town"],
            EMPTY_CODES["village"],
        )
        return self.names.get(key, "")

    def town(self, codes):
        """鄉鎮市區名稱。

        代表選舉的 elbase 中，帶選區碼的鄉鎮列名稱是選區名稱（例如「南竿鄉選舉區」），因此先找選區碼為空的列。
        參數：
            codes：行政代碼五段。
        回傳：鄉鎮市區名稱，找不到時為空字串。
        """
        for area in (EMPTY_CODES["area"], codes[2]):
            name = self.names.get(
                (codes[0], codes[1], area, codes[3], EMPTY_CODES["village"])
            )
            # 第一個找到的名稱就是鄉鎮名稱
            if name:
                return name
        return ""

    def village(self, codes):
        """村里名稱。

        參數：
            codes：行政代碼五段。
        回傳：村里名稱，合併的村里寫成「甲村、乙村」，找不到時為空字串。
        """
        return self.names.get(tuple(codes[:5]), "")

    def areas_of(self, codes, scope_type):
        """選區涵蓋的下一個階段行政區名稱。

        區域選區列出所含的鄉鎮市區，鄉鎮市民代表選區列出所含的村里，其他選區類型不列。選區清單的搜尋以這些名稱比對，例如輸入「北投區」找到所在的立委選區。
        參數：
            codes：行政代碼五段。
            scope_type：選區類型。
        回傳：名稱串列，依行政代碼排序。
        """
        found = set()
        # 逐列比對代碼，符合選區類型條件的列納入涵蓋範圍
        for row in self.rows:
            same_county = row[0] == codes[0] and row[1] == codes[1]
            # 區域選區：同縣市、同選區碼、有鄉鎮碼而沒有村里碼的列是所含的鄉鎮市區
            if (
                scope_type == "district"
                and same_county
                and row[2] == codes[2]
                and row[3] != EMPTY_CODES["town"]
                and row[4] == EMPTY_CODES["village"]
            ):
                found.add((row[3], row[5]))
            # 代表選區：同鄉鎮、同選區碼、有村里碼的列是所含的村里
            elif (
                scope_type == "town-district"
                and same_county
                and row[3] == codes[3]
                and row[2] == codes[2]
                and row[4] != EMPTY_CODES["village"]
            ):
                found.add((row[4], row[5]))
        return [name for _, name in sorted(found)]

    def towns_of(self, codes, scope_type):
        """選區所在或涵蓋的鄉鎮市區名稱，選區地圖以它把鄉鎮對到選區。

        參數：
            codes：行政代碼五段。
            scope_type：選區類型。
        回傳：名稱串列。區域選區是所含的鄉鎮市區，鄉鎮、代表選區與村里是所在的鄉鎮市區，全國與縣市選區為空串列。
        """
        # 區域選區跨鄉鎮，涵蓋範圍就是所含的鄉鎮市區
        if scope_type == "district":
            return self.areas_of(codes, scope_type)
        # 鄉鎮以下的選區只在一個鄉鎮市區內
        if scope_type in TOWN_LEVEL:
            return [self.town(codes)]
        return []


def scope_name(codes, scope_type, places):
    """組成選區的顯示名稱。

    參數：
        codes：行政代碼五段。
        scope_type：選區類型。
        places：Places 索引。
    回傳：例如「臺北市 第 1 選舉區」「連江縣 南竿鄉」「全國」。
    """
    area = codes[CODE["area"]]
    # 選區碼是數字時轉成選區編號，非數字的代碼不會出現在需要編號的選區類型
    number = int(area) if area.isdigit() else 0
    # 依選區類型的寫法代入名稱，寫法沒有用到的值不影響結果
    return SCOPE_NAMES[scope_type].format(
        county=places.county(codes),
        town=places.town(codes),
        village=places.village(codes),
        number=number,
    )


def roster_name(raw, year, characters, entity_id):
    """名冊的姓名，造字換成公報的寫法。

    參數：
        raw：elcand 的姓名欄。
        year：名冊目錄的西元年。
        characters：造字表，代碼「{西元年}-{碼位}」對應用字。
        entity_id：參選對象代碼，造字沒有登錄時寫進訊息。
    回傳：去掉前後空白、造字已替換的姓名。
    例外：PipelineError，姓名含造字表沒有的造字。
    """
    name = raw.strip()
    # 每個造字依年度與碼位查表
    for character in set(PRIVATE_USE.findall(name)):
        code = f"{year}-{ord(character):04X}"
        # 表外的造字無法判斷用字，要先查公報登錄
        if code not in characters:
            raise PipelineError(
                f"{entity_id} 的姓名含造字 {code}，依公報的寫法登錄到 roster-characters.tsv"
            )
        name = name.replace(character, characters[code])
    return name


# ==================================================
# 匯入
# ==================================================


def extract_roster(archive_path, encoding, election):
    """匯入一場選舉的名冊。

    參數：
        archive_path：votedata.zip 的位置。
        encoding：封存檔的檔名編碼。
        election：選舉定義，取 id、scope_type、entity_type 與 roster。
    回傳：{"scopes": [...], "entities": [...]}。選區依代碼排序，對象依選區與號次排序。
    例外：PipelineError，設定的表不存在、elcand 欄位不足或同選區號次重複。
    """
    archive, members = open_members(archive_path, encoding)
    scope_type = election["scope_type"]
    characters = {
        row["代碼"]: row["字"] for row in read_config_table("roster-characters.tsv")
    }
    # 以代碼為鍵累積，同一選區或對象只建立一次
    scopes = {}
    entities = {}
    # 一場選舉可能分在幾個目錄，例如直轄市與縣市分開存放
    for prefix in election["roster"]["paths"]:
        places = Places(read_csv(archive, members, prefix + TABLES["base"]))
        match = DIRECTORY_YEAR.search(prefix)
        # 造字表依名冊目錄的年度查，目錄名稱沒有年份時沒有可用的對照
        year = match[1] if match else ""
        # 政黨代號對應名稱，欄數不足的列略過
        parties = {
            row[0]: row[1]
            for row in read_csv(archive, members, prefix + TABLES["party"])
            if len(row) >= 2
        }
        # 每列一位候選人，副手另占一列
        for row in read_csv(archive, members, prefix + TABLES["candidate"]):
            # 欄位不足的列無法取到副手註記
            if len(row) <= COLUMN["deputy"]:
                raise PipelineError(
                    f"{prefix}{TABLES['candidate']} 有欄位不足的列：{row}"
                )
            # 選區代碼帶選舉代碼前綴，不同選舉的選區不會同名
            codes = row[COLUMN["codes"]]
            scope_id = f"{election['id']}:{scope_key(codes, scope_type)}"
            # 選區第一次出現時建立名稱與涵蓋範圍
            if scope_id not in scopes:
                scopes[scope_id] = {
                    "id": scope_id,
                    "name": scope_name(codes, scope_type, places),
                    # 全國性選舉不屬於任何縣市，地圖不標選區
                    "county": None if scope_type == "national" else codes[0] + codes[1],
                    "areas": places.areas_of(codes, scope_type),
                    "towns": places.towns_of(codes, scope_type),
                }
            entity_id = f"{scope_id}:{row[COLUMN['number']]}"
            # 副手列與正手同號次，名字併入正手
            if row[COLUMN["deputy"]].strip() == YES:
                entities[entity_id]["running_mate"] = roster_name(
                    row[COLUMN["name"]], year, characters, entity_id
                )
                continue
            # 同選區號次重複時，配題與結果無法對到唯一對象
            if entity_id in entities:
                raise PipelineError(f"{election['id']} 的參選對象代碼 {entity_id} 重複")
            entities[entity_id] = {
                "id": entity_id,
                "scope": scope_id,
                "number": int(row[COLUMN["number"]]),
                "name": roster_name(row[COLUMN["name"]], year, characters, entity_id),
                "running_mate": None,
                "party": parties.get(row[COLUMN["party"]], row[COLUMN["party"]]),
                "incumbent": row[COLUMN["incumbent"]].strip() == YES,
                "type": election["entity_type"],
            }
    # 補充名冊在主名冊之後併入，同選區代碼時取代原有資料
    for supplement in election["roster"].get("supplements", []):
        add_supplement(archive, members, election, supplement, scopes, entities)
    return {
        "scopes": [scopes[key] for key in sorted(scopes)],
        "entities": sorted(
            entities.values(), key=lambda entity: (entity["scope"], entity["number"])
        ),
    }


# ==================================================
# 補充名冊
# ==================================================

# 補充檔的格式：格式名稱對應「對象欄位 → 補充檔欄名」
SUPPLEMENT_FORMATS = {
    "named-candidate-csv": {"number": "號次", "name": "名字", "party": "政黨名稱"},
}

# 補充檔中沒有政黨的寫法，換成主名冊使用的名稱，政黨標記才一致
NO_PARTY = {"value": "無", "name": "無黨籍及未經政黨推薦"}


def add_supplement(archive, members, election, supplement, scopes, entities):
    """併入一份補充名冊，例如 2022 嘉義市長的延選。

    參數：
        archive、members：open_members 的回傳值。
        election：選舉定義。
        supplement：選舉定義中 roster.supplements 的一筆。補充檔沒有現任欄，現任者的號次寫在 incumbent_numbers。
        scopes、entities：extract_roster 累積中的選區與對象，原地修改。
    例外：PipelineError，補充檔格式沒有登錄在 SUPPLEMENT_FORMATS。
    """
    columns = SUPPLEMENT_FORMATS.get(supplement["format"])
    # 未登錄的格式沒有欄名對應
    if columns is None:
        raise PipelineError(
            f"補充名冊格式 {supplement['format']} 沒有登錄在 SUPPLEMENT_FORMATS"
        )
    # 補充檔的選區名稱與縣市寫在選舉定義，覆蓋主名冊的同代碼選區
    scope_id = f"{election['id']}:{supplement['scope_key']}"
    scopes[scope_id] = {
        "id": scope_id,
        "name": supplement["name"],
        "county": supplement["county"],
        "areas": [],
        "towns": [],
    }
    # 補充檔有表頭，以欄名取值
    for row in csv.DictReader(
        io.StringIO(read_text(archive, members, supplement["member"]))
    ):
        # 檔尾的空白列沒有姓名
        if not row.get(columns["name"]):
            continue
        # 對象代碼與主名冊同一種組法
        party = row[columns["party"]].strip()
        entity_id = f"{scope_id}:{row[columns['number']].strip()}"
        entities[entity_id] = {
            "id": entity_id,
            "scope": scope_id,
            "number": int(row[columns["number"]]),
            "name": row[columns["name"]].strip(),
            "running_mate": None,
            # 補充檔的「無」換成主名冊的寫法
            "party": NO_PARTY["name"] if party == NO_PARTY["value"] else party,
            "incumbent": int(row[columns["number"]])
            in supplement.get("incumbent_numbers", []),
            "type": election["entity_type"],
        }
