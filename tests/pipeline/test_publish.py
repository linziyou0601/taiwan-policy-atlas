"""發布階段與轉交的測試。

測試發布階段與轉交的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

from unittest import mock
import copy
import unittest

from pipeline import common
from pipeline.publish import run as publish
from pipeline.publish._coverage import VillageIndex, scope_villages
from helpers import ELECTION
from pipeline.common import PipelineError, load_product

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


# ==================================================
# 轉交與發布
# ==================================================


class CarryAndPublishTest(unittest.TestCase):
    """產物的雜湊轉交、資料版本與選區檔的分組。"""

    def test_carried_layers_are_complete(self):
        """評分階段產物轉交了前面全部的層。"""
        merged, carried = load_product("score", ELECTION)
        self.assertEqual(
            set(carried), {"fetch", "roster", "extract", "claims", "match", "score"}
        )
        # 合併後的內容包含評分階段與抽取階段另存的名冊
        self.assertIn("specificity", merged)
        self.assertIn("roster", merged)

    def test_changed_upstream_is_detected(self):
        """前面的階段修改過而後面沒有重新執行時讀取失敗。"""
        with mock.patch.object(common, "sha256_file", return_value="0" * 64):
            with self.assertRaisesRegex(PipelineError, "重新執行管線"):
                load_product("score", ELECTION)

    def test_data_version_is_deterministic(self):
        """同樣的內容得到同樣的資料版本，內容改變版本就改變。"""
        content = {"claims": [{"id": "a"}], "questions": []}
        self.assertEqual(
            publish.data_version(content), publish.data_version(copy.deepcopy(content))
        )
        self.assertNotEqual(
            publish.data_version(content), publish.data_version({"claims": []})
        )

    def test_scope_parts_follow_entities(self):
        """選區層級的內容依對象所屬的選區分組，沒有段落引用的影像留在總檔。"""
        content = publish.build_dataset(ELECTION)[0]
        parts = publish.scope_parts(content)
        # 總統只有一個選區，所有段落與主張都在那個選區
        scope = content["scopes"][0]["id"]
        self.assertEqual(len(parts[scope]["claims"]), len(content["claims"]))
        self.assertEqual(parts[scope]["ocr"], content["ocr"])
        # 每個鍵的筆數加總與完整內容相同
        for key in publish.SCOPED_KEYS:
            self.assertEqual(
                sum(len(part[key]) for part in parts.values()), len(content[key])
            )
        # 沒有段落引用的影像沒有所屬選區
        loose = content | {"ocr": content["ocr"] | {"unused": {"lines": []}}}
        self.assertEqual(
            publish.scope_parts(loose)[None]["ocr"], {"unused": {"lines": []}}
        )


# ==================================================
# 選區涵蓋
# ==================================================


class CoverageTest(unittest.TestCase):
    """選區的涵蓋解析成村里代碼。"""

    # 一個縣市的村里地圖，只留比對用的欄位
    COUNTY = {
        "villages": [
            {"code": "a", "town": "彰化市", "name": "磚磘里"},
            {"code": "b", "town": "彰化市", "name": "中央里"},
            {"code": "c", "town": "鹿港鎮", "name": "東石里"},
            {"code": "d", "town": "鹿港鎮", "name": "[埔]崙里"},
            {"code": "e", "town": "鹿港鎮", "name": "埔頂里"},
            {"code": "f", "town": "鹿港鎮", "name": ""},
        ],
        "changes": [
            {"town": "鹿港鎮", "old": "埔頂里", "new": ["埔崙里", "埔頂里"], "date": "2025-12-01"}
        ],
    }

    # 私用區字元與方括號的對照
    EQUIVALENTS = {"臺": "台", "[": "", "]": "", "\ue008": "磘"}

    def scope(self, areas, towns):
        """組出名冊的選區。"""
        return {"id": "e:1", "county": "10007", "areas": areas, "towns": towns}

    def resolve(self, areas, towns, year=2026, defined=None):
        """以指定的選舉年度解析一個選區。"""
        index = VillageIndex({"10007": self.COUNTY}, self.EQUIVALENTS, year)
        return scope_villages(self.scope(areas, towns), index, defined)

    def test_town_and_villages(self):
        """areas 是鄉鎮時納入全部村里，是村里時在 towns 內找，罕用字依對照比對。"""
        self.assertEqual(self.resolve(["鹿港鎮"], ["鹿港鎮"]), ({"c", "d", "e"}, []))
        # 一格寫兩個村里，名冊的私用區字元依對照比對
        self.assertEqual(self.resolve(["磚\ue008里、中央里"], ["彰化市"]), ({"a", "b"}, []))
        # 地圖以方括號標示的罕用字依對照比對
        self.assertEqual(self.resolve(["埔崙里"], ["鹿港鎮"]), ({"d"}, []))

    def test_changed_village_by_year(self):
        """實施之前的選舉，沿用舊名的分割村改成分割後的全部村里；實施之後的選舉不改。"""
        self.assertEqual(self.resolve(["埔頂里"], ["鹿港鎮"], year=2024), ({"d", "e"}, []))
        self.assertEqual(self.resolve(["埔頂里"], ["鹿港鎮"], year=2026), ({"e"}, []))

    def test_defined_rows_override(self):
        """涵蓋表有列時以它為準，村里寫 - 是整個鄉鎮。"""
        defined = [("彰化市", ["中央里"]), ("鹿港鎮", None)]
        found = self.resolve(["彰化市"], ["彰化市"], defined=defined)
        self.assertEqual(found, ({"b", "c", "d", "e"}, []))

    def test_missing_village_listed(self):
        """找不到的村里列入缺漏。"""
        _, missing = self.resolve(["長興里"], ["鹿港鎮"])
        self.assertEqual(missing, ["e:1 的鄉鎮市區或村里 長興里"])

    def test_empty_scope_is_whole_county(self):
        """沒有 areas 也沒有 towns 時是整個縣市的村里，未編定村里不在其中。"""
        found, _ = self.resolve([], [])
        self.assertEqual(found, {"a", "b", "c", "d", "e"})
