"""地圖階段的測試。

測試地圖階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

import unittest

from pipeline import common

from pipeline.adapters.shapefile_map import build_topology, merged_path, ring_path, simplify
from pipeline.common import election_ids, read_json
from pipeline.geo.run import MAP_PATH, VILLAGES_DIR, encode_arc

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


# ==================================================
# 地圖
# ==================================================


class GeoTest(unittest.TestCase):
    """地圖產物與各場選舉的地圖版本。"""

    def test_map_product(self):
        """縣市地圖有 22 縣市與 4 個插圖方框，每個縣市有一份同版本的村里地圖。"""
        product = read_json(MAP_PATH)
        self.assertEqual(len(product["layers"]["counties"]), 22)
        self.assertEqual(len(product["layers"]["insets"]), 4)
        # 村里地圖的縣市與縣市地圖相同，版本也相同
        files = sorted(VILLAGES_DIR.glob("*.json"))
        self.assertEqual([f.stem for f in files], [c["code"] for c in product["layers"]["counties"]])
        self.assertTrue(all(read_json(f)["version"] == product["version"] for f in files))

    def test_datasets_use_current_map(self):
        """每場選舉的資料集記的地圖版本與目前的地圖相同，地圖重新產生後要從發布階段重新執行。"""
        version = read_json(MAP_PATH)["version"]
        # 逐場核對資料集記下的地圖版本
        for election in election_ids():
            dataset = read_json(common.product_path("publish", election))
            self.assertEqual(dataset["map"], version, election)

    def test_encode_arc(self):
        """弧線取整數後寫成差分。"""
        self.assertEqual(encode_arc([(1.04, 2.0), (1.5, 1.96)], 1), [10, 20, 5, 0])


# ==================================================
# 拓撲與合併
# ==================================================


class TopologyTest(unittest.TestCase):
    """相鄰的單位切出共用弧線，合併成外框。"""

    # 兩個相鄰的正方形，以相反方向走過 x=1 的共用邊
    SHAPES = [
        [[(0, 0), (0, 1), (1, 1), (1, 0), (0, 0)]],
        [[(1, 0), (1, 1), (2, 1), (2, 0), (1, 0)]],
    ]

    def test_shared_edge_is_one_arc(self):
        """共用邊是同一條弧線，兩個單位以相反方向使用。"""
        arcs, units = build_topology(self.SHAPES)
        # 左方塊正向用到、右方塊反向用到的弧線
        shared = set(units[0][0]) & {~i for i in units[1][0]}
        self.assertEqual(len(shared), 1)
        self.assertEqual(arcs[next(iter(shared))], [(1, 1), (1, 0)])

    def test_shared_edge_removed(self):
        """合併後共用邊抵銷，只剩一個外框環。"""
        arcs, units = build_topology(self.SHAPES)
        path, rings = merged_path(units[0] + units[1], arcs, 1)
        self.assertEqual(rings, 1)
        # 外框六點，不含共用邊
        self.assertEqual(path, "M1 0l-1 0 0 1 1 0 1 0 0 -1z")

    def test_disjoint_units_keep_rings(self):
        """不相鄰的單位合併後各自一個環。"""
        # 第二個方塊與左方塊隔開
        shapes = [self.SHAPES[0], [[(5, 0), (5, 1), (6, 1), (6, 0), (5, 0)]]]
        arcs, units = build_topology(shapes)
        # 沒有共用邊，兩個環都是外框
        _, rings = merged_path(units[0] + units[1], arcs, 1)
        self.assertEqual(rings, 2)

    def test_simplify_and_path(self):
        """簡化保留端點與偏離的點，路徑寫成相對座標。"""
        # 中間的點偏離 0.05，小於容許距離時去掉
        self.assertEqual(simplify([(0, 0), (1, 0.05), (2, 0)], 0.1), [(0, 0), (2, 0)])
        self.assertEqual(simplify([(0, 0), (1, 1), (2, 0)], 0.1), [(0, 0), (1, 1), (2, 0)])
        # 取捨後與前一點重合的點不寫出
        self.assertEqual(ring_path([(0, 0), (0.04, 0), (1, 1)], 1), "M0 0l1 1z")
