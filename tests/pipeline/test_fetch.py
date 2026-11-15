"""抓取階段的測試。

測試抓取階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

from pathlib import Path
import io
import tempfile
import unittest
import zipfile

from PIL import Image
from pipeline.fetch import list as listing
from pipeline.adapters.cec_bulletin import extract_document
from pipeline.common import (
    PipelineError,
    ROSTER_FILE,
    election_config,
    election_ids,
    layer_dir,
    read_json,
)
from pipeline.fetch.run import ensure_directory, source_ids

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


class SourceTest(unittest.TestCase):
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

    def test_bulletin_reads_site_directory(self):
        """網站目錄來源的公報從快取目錄下的路徑讀取，文件沒寫 sha256 時抓取失敗。"""
        with zipfile.ZipFile(self.bulletin()) as archive:
            data = archive.read("公報.pdf")
        document = {
            "id": "bulletin",
            "title": "公報",
            "member": "公報/縣長.pdf",
            "images": ["p1-0"],
        }
        # 快取目錄下照網站的路徑存放，抽取結果與封存檔相同
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "公報").mkdir()
            (Path(folder) / "公報" / "縣長.pdf").write_bytes(data)
            # 傳入的位置是目錄時，adapter 讀目錄下的 member
            extracted = extract_document(
                Path(folder), "utf-8", document, Path(folder) / "images"
            )
            self.assertEqual(
                [image["id"] for image in extracted["images"]], ["bulletin-p1-0"]
            )
        # 網站目錄沒有整體的雜湊，每份文件都要寫 sha256
        with self.assertRaisesRegex(PipelineError, "要寫 sha256"):
            ensure_directory(
                {"id": "listing", "url": "https://example.org/"}, [document], True
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
        from pipeline.geo.run import SETTINGS_PATH

        # 引用者是全部選舉的名冊與文件，加上地圖
        used = {read_yaml(SETTINGS_PATH)["source"]}
        # 逐場加入選舉引用的來源
        for election in election_ids():
            used.update(source_ids(election_config(election)))
        # 登錄了卻沒有引用者的來源清單要是空的
        self.assertEqual(sorted(set(sources_config()) - used), [])


class ListingTest(unittest.TestCase):
    """地方公報網站的目錄解析、選區對應與公報解析。"""

    def test_links_keep_next_level(self):
        """目錄頁只收下一個階段的子目錄，PDF 路徑解碼後收錄。"""
        page = (
            '<a href="?dir=111">上層</a>'
            '<a href="?dir=111%2F03%E6%96%B0%E5%8C%97%E5%B8%82%2F04x">子目錄</a>'
            '<a href="?dir=111%2F03%E6%96%B0%E5%8C%97%E5%B8%82%2F04x%2Fy">孫目錄</a>'
            '<a href="111%2F03%E6%96%B0%E5%8C%97%E5%B8%82%2Fa.pdf">公報</a>'
        )
        folders, files = listing.directory_links(page, "111/03新北市")
        # 上層與孫目錄略過，PDF 的百分比編碼還原
        self.assertEqual(folders, ["111/03新北市/04x"])
        self.assertEqual(files, ["111/03新北市/a.pdf"])
