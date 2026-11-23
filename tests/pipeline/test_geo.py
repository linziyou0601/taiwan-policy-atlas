"""地圖階段的測試。

測試地圖階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

import unittest

from pipeline.adapters.topojson_map import decode_arcs, merged_path, ring_path, svg_path
from pipeline.common import (
    ROSTER_FILE,
    PipelineError,
    election_ids,
    layer_dir,
    read_json,
)
from pipeline.geo.run import DISTRICTS_DIR, MAP_PATH, UnitIndex, name_key, scope_units

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


# ==================================================
# 地圖
# ==================================================


class GeoTest(unittest.TestCase):
    """TopoJSON 解碼與地圖產物。"""

    TOPOLOGY = {
        "transform": {"scale": [1, 1], "translate": [0, 0]},
        "arcs": [[[0, 0], [10, 0], [0, 10], [-10, 0], [0, -10]]],
    }

    def test_decode_and_path(self):
        """差分座標還原後寫成相對座標的閉合路徑。"""
        # 量化差分座標累加後是正方形的五個點
        arcs = decode_arcs(self.TOPOLOGY)
        self.assertEqual(arcs[0], [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)])
        path, rings = svg_path({"type": "Polygon", "arcs": [[0]]}, arcs, 1)
        # 一個環，寫成相對座標並以 z 閉合
        self.assertEqual(rings, 1)
        self.assertEqual(path, "M0 0l10 0 0 10 -10 0z")
        # 取捨後與前一點重合的點不寫出
        self.assertEqual(ring_path([(0, 0), (0.04, 0), (1, 1)], 1), "M0 0l1 1z")

    def test_unclosed_ring_fails(self):
        """未閉合的環表示來源幾何損壞。"""
        arcs = [[(0, 0), (1, 0), (1, 1)]]
        with self.assertRaises(PipelineError):
            svg_path({"type": "Polygon", "arcs": [[0]]}, arcs, 1)

    def test_map_product_covers_rosters(self):
        """地圖產物核對過全部選舉的選區。"""
        # 地圖產物有 22 縣市，核對過每場選舉
        product = read_json(MAP_PATH)
        self.assertEqual(len(product["layers"]["counties"]), 22)
        self.assertEqual(product["checks"]["elections"], len(election_ids()))
        # 名冊的臺與地圖的台視為相同
        self.assertEqual(name_key("臺北市", product["name_equivalents"]), "台北市")

    def test_districts_cover_each_election(self):
        """每場選舉都有選區檔，有縣市的選區各有一個圖形。"""
        # 逐場核對選區檔的選區與名冊有縣市的選區相同
        for election in election_ids():
            roster = read_json(layer_dir("extract", election) / ROSTER_FILE)["roster"]
            # 全國性選區沒有縣市，不在選區檔
            expected = sorted(s["id"] for s in roster["scopes"] if s["county"])
            product = read_json(DISTRICTS_DIR / f"{election}.json")
            self.assertEqual([d["scope"] for d in product["districts"]], expected)


# ==================================================
# 合併
# ==================================================


class MergeTest(unittest.TestCase):
    """相鄰的單位合併成外框。"""

    # 兩個相鄰的正方形：弧線 0 是共用邊，1、2 各是其餘三邊
    ARCS = [
        [(1, 0), (1, 1)],
        [(1, 1), (0, 1), (0, 0), (1, 0)],
        [(1, 0), (2, 0), (2, 1), (1, 1)],
    ]

    def test_shared_edge_removed(self):
        """共用邊只出現在內部，合併後是一個環。"""
        # 左方塊用 0 與 1，右方塊反向用 0 再接 2
        polygons = [[[0, 1]], [[~0, 2]]]
        path, rings = merged_path(polygons, self.ARCS, 1)
        self.assertEqual(rings, 1)
        # 外框六點，不含共用邊
        self.assertEqual(path, "M1 1l-1 0 0 -1 1 0 1 0 0 1z")

    def test_gap_hole_filled(self):
        """被包住而另一側沒有單位的內環補起來，另一側有單位的內環保留。"""
        # 外環的帶號面積是負值，內環是正值
        arcs = [
            [(0, 0), (0, 4), (4, 4), (4, 0), (0, 0)],
            [(1, 1), (3, 1), (3, 3), (1, 3), (1, 1)],
        ]
        # 內環的弧線只屬於這個單位時是空白，補起來只剩外環
        _, rings = merged_path([[[0, 1]]], arcs, 1, frozenset({0, 1}))
        self.assertEqual(rings, 1)
        # 內環的弧線另一側有單位時是真正的洞
        _, rings = merged_path([[[0, 1]]], arcs, 1, frozenset({0}))
        self.assertEqual(rings, 2)

    def test_disjoint_units_keep_rings(self):
        """不相鄰的單位合併後各自一個環。"""
        arcs = [
            [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)],
            [(5, 0), (6, 0), (6, 1), (5, 1), (5, 0)],
        ]
        _, rings = merged_path([[[0]], [[1]]], arcs, 1)
        self.assertEqual(rings, 2)


# ==================================================
# 選區涵蓋
# ==================================================


class ScopeUnitsTest(unittest.TestCase):
    """選區的涵蓋解析成基本單位。"""

    UNITS = [
        {"county": "10007", "town": "彰化市", "name": "磚磘里"},
        {"county": "10007", "town": "彰化市", "name": "中央里"},
        {"county": "10007", "town": "鹿港鎮", "name": "東石里"},
    ]

    def setUp(self):
        """以私用區字元的對照建立索引。"""
        self.index = UnitIndex(self.UNITS, {"臺": "台", "\ue008": "磘"})

    def scope(self, areas, towns):
        """組出名冊的選區。"""
        return {"id": "e:1", "county": "10007", "areas": areas, "towns": towns}

    def test_town_and_villages(self):
        """areas 是鄉鎮時整個納入，是村里時在 towns 內找。"""
        # 整個鎮
        found, missing = scope_units(
            self.scope(["鹿港鎮"], ["鹿港鎮"]), self.index, None
        )
        self.assertEqual((found, missing), ({2}, []))
        # 一格寫兩個村里，私用區字元依對照比對
        found, missing = scope_units(
            self.scope(["磚\ue008里、中央里"], ["彰化市"]), self.index, None
        )
        self.assertEqual((found, missing), ({0, 1}, []))

    def test_defined_rows_override(self):
        """涵蓋表有列時以它為準，村里寫 - 是整個鄉鎮。"""
        defined = [("彰化市", ["中央里"]), ("鹿港鎮", None)]
        found, missing = scope_units(
            self.scope(["彰化市"], ["彰化市"]), self.index, defined
        )
        self.assertEqual((found, missing), ({1, 2}, []))

    def test_missing_village_listed(self):
        """找不到的村里列入缺漏。"""
        _, missing = scope_units(self.scope(["長興里"], ["鹿港鎮"]), self.index, None)
        self.assertEqual(missing, ["e:1 的鄉鎮市區或村里 長興里"])

    def test_empty_scope_is_whole_county(self):
        """沒有 areas 也沒有 towns 時是整個縣市。"""
        found, _ = scope_units(self.scope([], []), self.index, None)
        self.assertEqual(found, {0, 1, 2})
