"""評分階段的測試。

測試評分階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

import copy
import unittest

from helpers import authored, upstream
from pipeline.common import PipelineError
from pipeline.score.run import (
    NEUTRALITY_HEADER,
    SPECIFICITY_HEADER,
    check_neutrality,
    check_specificity,
)
from pipeline.tables import by_code, read_config_table, review_names

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


# ==================================================
# 評分階段
# ==================================================


class ScoreLayerTest(unittest.TestCase):
    """評分階段：具體度不得缺少評分，中立性全部通過才能發布。"""

    @classmethod
    def setUpClass(cls):
        """讀取配題階段產物與評分階段的手寫表。"""
        match = upstream("match")
        cls.claims = by_code(match["claims"], "id")
        cls.questions = {question["id"] for question in match["questions"]}
        # 具體度判準、級距與中立性判準
        cls.criteria = by_code(read_config_table("rubric-specificity.tsv"))
        cls.levels = by_code(read_config_table("rubric-levels.tsv"), "名稱")
        cls.neutral = by_code(read_config_table("rubric-neutrality.tsv"))
        # 方法與審核狀態的登錄名稱
        cls.review = review_names()
        # 評分階段的兩張手寫表
        cls.specificity = authored("score", "specificity.tsv", SPECIFICITY_HEADER)
        cls.neutrality = authored("score", "neutrality.tsv", NEUTRALITY_HEADER)

    def test_all_rows_pass(self):
        """已提交的評分全部通過。"""
        rows = check_specificity(
            self.specificity, self.claims, self.criteria, self.levels, self.review
        )
        self.assertEqual(len(rows), len(self.claims) * len(self.criteria))
        check_neutrality(self.neutrality, self.questions, self.neutral, self.review)

    def test_missing_criterion_fails(self):
        """缺少一條判準的評分時失敗。"""
        with self.assertRaisesRegex(PipelineError, "缺少判準"):
            check_specificity(
                self.specificity[1:],
                self.claims,
                self.criteria,
                self.levels,
                self.review,
            )

    def test_explicit_level_needs_evidence(self):
        """評為明示的列要附原文證據。"""
        rows = copy.deepcopy(self.specificity)
        # 找出一列未明示的評分，改為完整明示但不補充證據
        row = next(r for r in rows if r["級距"] == "未明示")
        row["級距"] = "完整明示"
        # 明示的級距沒有證據時失敗
        with self.assertRaisesRegex(PipelineError, "證據要寫主張原文"):
            check_specificity(
                rows, self.claims, self.criteria, self.levels, self.review
            )

    def test_failed_neutrality_blocks_publish(self):
        """有判準不通過的題目不能發布。"""
        rows = copy.deepcopy(self.neutrality)
        # 把第一列中立性審查改為不通過
        rows[0]["結果"] = "不通過"
        with self.assertRaisesRegex(PipelineError, "改寫題目"):
            check_neutrality(rows, self.questions, self.neutral, self.review)
