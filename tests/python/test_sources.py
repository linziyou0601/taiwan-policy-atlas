"""抓取、抽取、名冊、地圖與設定表的測試。

確認設定表的寫法檢查、分類樹的父子關係、OCR 比對、名冊選區代碼、公報影像依設定抽取、TopoJSON 解碼與地圖核對、選舉設定引用的來源，以及每個登錄的來源都有引用者。

指令：
  .venv/bin/python -m unittest discover -s tests/python -p 'test_*.py'

慣例：
  - 寫法檢查以系統暫存目錄的暫存檔測試。
"""

import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

import helpers  # noqa: F401  匯入時設定 sys.path

from pipeline.adapters.cec_bulletin import extract_document
from pipeline.adapters.cec_roster import SCOPE_NAMES, scope_key
from pipeline.adapters.topojson_map import decode_arcs, ring_path, svg_path
from pipeline.common import (
    ROSTER_FILE,
    PipelineError,
    election_config,
    election_ids,
    layer_dir,
    read_json,
)
from pipeline.extract import ocr_check
from pipeline.fetch import source_ids
from pipeline.geo import MAP_PATH, name_key
from pipeline.tables import check_config_tables, check_taxonomy, read_table

# ==================================================
# 設定表
# ==================================================


class TableTest(unittest.TestCase):
    """TSV 寫法與分類樹。"""

    def write(self, text):
        """把內容寫入暫存 TSV，回傳路徑。"""
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".tsv", delete=False, encoding="utf-8"
        )
        handle.write(text)
        handle.close()
        # 測試結束後刪除暫存檔
        self.addCleanup(Path(handle.name).unlink)
        return Path(handle.name)

    def test_config_tables_pass(self):
        """repo 內的設定表全部通過寫法檢查。"""
        names = [name for name, _ in check_config_tables()]
        self.assertIn("taxonomy-issues.tsv", names)

    def test_empty_cell_fails(self):
        """空白儲存格要寫 -。"""
        path = self.write("代碼\t名稱\na\t\n")
        with self.assertRaisesRegex(PipelineError, "空白儲存格"):
            read_table(path, ["代碼", "名稱"])

    def test_unsorted_codes_fail(self):
        """列要依代碼的碼位排序。"""
        path = self.write("代碼\t名稱\nb\t乙\na\t甲\n")
        with self.assertRaises(PipelineError):
            read_table(path, ["代碼", "名稱"])

    def test_duplicate_codes_fail(self):
        """代碼不得重複。"""
        path = self.write("代碼\t名稱\na\t甲\na\t乙\n")
        with self.assertRaises(PipelineError):
            read_table(path, ["代碼", "名稱"])

    def test_taxonomy_parent_rules(self):
        """分類樹的父節點要存在、代碼以父代碼開頭、層級逐層加 1。"""
        base = [
            {"代碼": "a", "父代碼": "-", "層級": "1"},
            {"代碼": "a.b", "父代碼": "a", "層級": "2"},
        ]
        # 合規的兩層樹通過，以下每種情形各修改一處
        check_taxonomy(base)
        # 父節點不存在
        with self.assertRaisesRegex(PipelineError, "不在表內"):
            check_taxonomy(base + [{"代碼": "x.y", "父代碼": "x", "層級": "2"}])
        with self.assertRaisesRegex(PipelineError, "層級"):
            # 層級跳號
            check_taxonomy(base + [{"代碼": "a.b.c", "父代碼": "a.b", "層級": "4"}])
        with self.assertRaisesRegex(PipelineError, "開頭"):
            # 代碼不以父代碼開頭
            check_taxonomy(base + [{"代碼": "z.c", "父代碼": "a.b", "層級": "3"}])


# ==================================================
# 抽取
# ==================================================


class ExtractTest(unittest.TestCase):
    """OCR 比對、名冊與公報影像。"""

    def bulletin(self):
        """寫出一份暫存的公報封存檔：一頁 PDF，嵌入一張影像。"""
        page = io.BytesIO()
        # Pillow 儲存為 PDF 時，影像成為唯一一頁的嵌入影像
        Image.new("L", (120, 60), 255).save(page, "PDF")
        handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        handle.close()
        # 測試結束後刪除暫存檔
        self.addCleanup(Path(handle.name).unlink)
        with zipfile.ZipFile(handle.name, "w") as archive:
            archive.writestr(
                zipfile.ZipInfo("公報.pdf", (2024, 1, 1, 0, 0, 0)), page.getvalue()
            )
        return Path(handle.name)

    def test_ocr_check_is_order_independent(self):
        """行序不同不影響重合度，轉錄稿沒有的 OCR 行列出。"""
        lines = [{"text": "第二行政見內容"}, {"text": "第一行政見內容"}]
        # OCR 的行序與轉錄稿相反，重合度仍為 1
        result = ocr_check("第一行政見內容\n第二行政見內容", lines)
        self.assertEqual(result["agreement"], 1.0)
        self.assertEqual(result["unmatched"], [])
        # 轉錄稿缺少一行時，那一行列為找不到
        missing = ocr_check("第一行政見內容", lines + [{"text": "轉錄稿沒有這行字"}])
        self.assertIn("轉錄稿沒有這行字", missing["unmatched"])

    def test_scope_keys_and_names(self):
        """選區代碼依選區類型擷取行政代碼的段，名稱樣板涵蓋全部類型。"""
        codes = ["63", "000", "01", "000", "0000"]
        # 全國性選舉只有一個選區，區域選區使用縣市與選區碼
        self.assertEqual(scope_key(codes, "national"), "national")
        # 每種選區類型都有名稱樣板
        self.assertEqual(scope_key(codes, "district"), "63-000-01")
        self.assertEqual(
            set(SCOPE_NAMES),
            {"national", "county", "district", "town", "town-district", "village"},
        )

    def test_bulletin_images_follow_config(self):
        """公報只寫出設定 images 列出的影像。"""
        archive = self.bulletin()
        document = {
            "id": "bulletin",
            "title": "公報",
            "member": "公報.pdf",
            "images": ["p1-0"],
        }
        # 列出的影像寫成 PNG，代碼加上文件代碼
        with tempfile.TemporaryDirectory() as folder:
            extracted = extract_document(
                archive, "utf-8", document, Path(folder) / "images"
            )
            self.assertEqual(
                [image["id"] for image in extracted["images"]], ["bulletin-p1-0"]
            )
            # 空清單的文件只擷取文字層
            empty = extract_document(
                archive, "utf-8", document | {"images": []}, Path(folder) / "images"
            )
            self.assertEqual(empty["images"], [])
            # 設定寫了不存在的影像時失敗
            with self.assertRaisesRegex(PipelineError, "沒有影像 p1-9"):
                extract_document(
                    archive,
                    "utf-8",
                    document | {"images": ["p1-9"]},
                    Path(folder) / "images",
                )

    def test_every_election_references_registered_sources(self):
        """每場選舉引用的來源都登錄在 sources.yaml，名冊都已匯入。"""
        from pipeline.common import sources_config

        sources = sources_config()
        # 逐場檢查來源與名冊產物
        for election in election_ids():
            self.assertTrue(set(source_ids(election_config(election))) <= set(sources))
            # 名冊產物要有選區與參選對象
            roster = read_json(layer_dir("extract", election) / ROSTER_FILE)["roster"]
            self.assertTrue(roster["scopes"] and roster["entities"], election)

    def test_every_registered_source_is_used(self):
        """sources.yaml 的每個來源都有選舉設定或地圖設定引用。"""
        from pipeline.common import read_yaml, sources_config
        from pipeline.geo import SETTINGS_PATH

        # 引用者是全部選舉的名冊與文件，加上地圖
        used = {read_yaml(SETTINGS_PATH)["source"]}
        # 逐場加入選舉引用的來源
        for election in election_ids():
            used.update(source_ids(election_config(election)))
        # 登錄了卻沒有引用者的來源清單要是空的
        self.assertEqual(sorted(set(sources_config()) - used), [])


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


# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()
