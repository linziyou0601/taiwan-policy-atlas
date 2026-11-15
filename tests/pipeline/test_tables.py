"""設定表與 TSV 的讀取的測試。

測試設定表與 TSV 的讀取的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

from pathlib import Path
import tempfile
import unittest

from pipeline.common import PipelineError
from pipeline.tables import check_config_tables, check_taxonomy, read_table

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()

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
