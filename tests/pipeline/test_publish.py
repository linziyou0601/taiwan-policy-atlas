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
