"""地圖階段的測試。

測試地圖階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

import unittest

from pipeline.adapters.topojson_map import decode_arcs, ring_path, svg_path
from pipeline.common import PipelineError, election_ids, read_json
from pipeline.geo.run import MAP_PATH, name_key

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
