"""配題階段的測試。

測試配題階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

import copy
import unittest

from pipeline.match import _mappings as mappings
from helpers import (
    DRAFT_ELECTION,
    DataTestCase,
    authored,
    mapping,
    question,
    row,
    upstream,
)
from pipeline.common import PipelineError
from pipeline.match.run import (
    MAPPING_HEADER,
    QUESTION_HEADER,
    check_allocations,
    check_cycles,
    check_mapping,
    check_question,
    question_hash,
)
from pipeline.score.run import NEUTRALITY_HEADER
from pipeline.tables import (
    AXIS_HEADER,
    by_code,
    read_config_table,
    review_names,
)

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


# ==================================================
# 配題階段
# ==================================================


class MatchLayerTest(unittest.TestCase):
    """配題階段：題目、母題、分配合計、證據與題目版本。"""

    @classmethod
    def setUpClass(cls):
        """讀取主張階段產物與配題階段的手寫表。"""
        claims = upstream("claims")
        cls.claims = by_code(claims["claims"], "id")
        cls.scopes = {scope["id"] for scope in claims["roster"]["scopes"]}
        # 分類樹、量尺與立場判準是題目與配題核對的依據
        cls.taxonomy = by_code(read_config_table("taxonomy-issues.tsv"))
        cls.answers = by_code(read_config_table("scale-answers.tsv"), "名稱")
        cls.stances = by_code(read_config_table("rubric-stance.tsv"), "名稱")
        # 方法與審核狀態的登錄名稱
        cls.review = review_names()
        # 先收齊題目代碼，母題可以寫在子題之後
        rows = authored("match", "questions.tsv", QUESTION_HEADER)
        codes = {row["代碼"] for row in rows}
        # 保留手寫列供題意雜湊測試，題目依代碼建立索引
        cls.question_rows = rows
        cls.questions = {
            q["id"]: q
            for q in (
                check_question(row, codes, cls.taxonomy, cls.scopes, cls.answers)
                for row in rows
            )
        }
        # 配題表在各測試中逐列核對
        cls.mapping_rows = authored("match", "mappings.tsv", MAPPING_HEADER)

    def map(self, row):
        """以本類別的情境核對一列配題。"""
        return check_mapping(
            row, self.claims, self.questions, self.taxonomy, self.stances, self.review
        )

    def test_all_rows_pass(self):
        """已提交的配題全部通過，分配合計與證據都符合規格。"""
        mappings = [self.map(row) for row in self.mapping_rows]
        check_allocations(mappings, self.claims, self.questions)
        check_cycles(list(self.questions.values()))

    def test_allocation_must_sum_to_one(self):
        """一則主張的分配合計不是 1 時失敗。"""
        mappings = [self.map(row) for row in self.mapping_rows]
        # 把第一筆配題的分配改為 0.5，該主張合計不再是 1
        broken = copy.deepcopy(mappings)
        # 其餘配題保持原樣，合計不足的只有這則主張
        broken[0]["allocation"] = 0.5
        with self.assertRaisesRegex(PipelineError, "分配合計"):
            check_allocations(broken, self.claims, self.questions)

    def test_question_needs_evidence(self):
        """沒有任何配題證據的題目不能發布。"""
        mappings = [self.map(row) for row in self.mapping_rows]
        target = next(iter(self.questions))
        # 移除第一題的配題，其餘配題不變
        remaining = [m for m in mappings if m["question"] != target]
        # 移除那題的配題後，分配合計也會不足，先改為只計入議題分布的配題
        patched = remaining + [
            dict(m, question=None) for m in mappings if m["question"] == target
        ]
        with self.assertRaisesRegex(PipelineError, "沒有任何配題證據"):
            check_allocations(patched, self.claims, self.questions)

    def test_evidence_must_be_in_quote(self):
        """證據不在主張原文中時失敗。"""
        row = next(r for r in self.mapping_rows if r["證據"] != "-")
        with self.assertRaisesRegex(PipelineError, "證據不在主張"):
            self.map(dict(row, 證據="原文沒有的字"))

    def test_stale_question_version_fails(self):
        """題目改版後，舊版的配題要重新核對。"""
        row = next(r for r in self.mapping_rows if r["題目"] != "-")
        with self.assertRaisesRegex(PipelineError, "重新核對配題"):
            self.map(dict(row, 題目版本="0"))

    def test_non_integer_question_version_fails(self):
        """有題目的配題列題目版本寫 - 時回報配題代碼。"""
        row = next(r for r in self.mapping_rows if r["題目"] != "-")
        with self.assertRaisesRegex(PipelineError, f"{row['代碼']} 的整數欄"):
            self.map(dict(row, 題目版本="-"))

    def test_question_hash_tracks_meaning(self):
        """題幹修改後題意雜湊隨之改變。"""
        row = self.question_rows[0]
        self.assertNotEqual(
            question_hash(row), question_hash(dict(row, 題幹="修改過的題幹"))
        )


# ==================================================
# 配題
# ==================================================


class MappingsTest(DataTestCase):
    """母題配題、面向與題目改代碼。"""

    def setUp(self):
        """寫入一道母題與一道子題。"""
        super().setUp()
        self.write(
            "match",
            "questions.tsv",
            QUESTION_HEADER,
            [question("q.x", "x", "-"), question("q.x.y", "x", "q.x")],
        )

    def test_parents_split_child_share(self):
        """只掛子題的主張補一列母題、分配各半，反對子題的列留給編碼者判斷。"""
        rows = [
            mapping("a-1-001-m1", "a-1-001", "x", "q.x.y", "支持", "1"),
            mapping("a-1-002-m1", "a-1-002", "x", "q.x.y", "反對", "1"),
            mapping("a-1-003-m1", "a-1-003", "x", "q.x.y", "支持", "0.5"),
            mapping("a-1-003-m2", "a-1-003", "x", "q.x", "支持", "0.5"),
        ]
        self.write("match", "mappings.tsv", MAPPING_HEADER, rows)
        # 反對子題的列列在摘要中
        summary = mappings.add_parents(DRAFT_ELECTION)
        self.assertIn("a-1-002-m1", summary)
        # 子題列分一半給新增的母題列
        result = {
            r["代碼"]: (r["題目"], r["分配"])
            for r in self.read("match", "mappings.tsv", MAPPING_HEADER)
        }
        self.assertEqual(result["a-1-001-m1"], ("q.x.y", "0.5"))
        self.assertEqual(result["a-1-001-m2"], ("q.x", "0.5"))
        # 反對子題與已掛母題的主張不變
        self.assertEqual(result["a-1-002-m1"], ("q.x.y", "1"))
        self.assertNotIn("a-1-003-m3", result)

    def test_rename_moves_question_rows(self):
        """題目改代碼時，子題的母題、軸對應、中立性與配題一起改。"""
        self.write(
            "match",
            "question-axes.tsv",
            AXIS_HEADER,
            [
                row(
                    AXIS_HEADER,
                    "q.x-welfare",
                    "q.x",
                    "welfare",
                    "1",
                    "1",
                    "理由",
                    "模型判讀",
                    "未經獨立複評",
                )
            ],
        )
        self.write(
            "score",
            "neutrality.tsv",
            NEUTRALITY_HEADER,
            [
                row(
                    NEUTRALITY_HEADER,
                    "q.x-answerable",
                    "q.x",
                    "answerable",
                    "通過",
                    "理由",
                    "-",
                    "模型判讀",
                    "未經獨立複評",
                )
            ],
        )
        self.write(
            "match",
            "mappings.tsv",
            MAPPING_HEADER,
            [mapping("a-1-001-m1", "a-1-001", "x", "q.x", "支持", "1")],
        )
        # 母題改名，子題的母題欄跟著改
        mappings.rename_question(DRAFT_ELECTION, "q.x", "q.z")
        questions = {
            r["代碼"]: r["母題"]
            for r in self.read("match", "questions.tsv", QUESTION_HEADER)
        }
        self.assertEqual(questions, {"q.x.y": "q.z", "q.z": "-"})
        # 軸對應、中立性與配題都指向新代碼
        self.assertEqual(
            self.read("match", "question-axes.tsv", AXIS_HEADER)[0]["代碼"],
            "q.z-welfare",
        )
        self.assertEqual(
            self.read("score", "neutrality.tsv", NEUTRALITY_HEADER)[0]["代碼"],
            "q.z-answerable",
        )
        self.assertEqual(
            self.read("match", "mappings.tsv", MAPPING_HEADER)[0]["題目"], "q.z"
        )
        # 新代碼撞到既有題目時停止
        with self.assertRaisesRegex(PipelineError, "不能是既有題目"):
            mappings.rename_question(DRAFT_ELECTION, "q.z", "q.x.y")
