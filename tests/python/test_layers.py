"""管線各層核對規則的測試。

以 2024 總統的真實資料確認各層的核對函式接受合規的輸入，並對變造的輸入回報錯誤：主張的詞表與起訖、配題的分配與證據、評分的缺少評分與中立性、產物的雜湊轉交與資料版本。

指令：
  .venv/bin/python -m unittest discover -s tests/python -p 'test_*.py'

慣例：
  - 每個錯誤情形只修改一處，確認錯誤訊息指出那一處。
"""

import copy
import unittest
from unittest import mock

from helpers import ELECTION, authored, upstream

from pipeline import common, publish
from pipeline.claims import CLAIM_HEADER, check_claim, load_vocab
from pipeline.common import PipelineError, load_product
from pipeline.match import (
    MAPPING_HEADER,
    QUESTION_HEADER,
    check_allocations,
    check_cycles,
    check_mapping,
    check_question,
    question_hash,
)
from pipeline.score import (
    NEUTRALITY_HEADER,
    SPECIFICITY_HEADER,
    check_neutrality,
    check_specificity,
)
from pipeline.tables import by_code, read_config_table, review_names

# ==================================================
# 主張層
# ==================================================


class ClaimLayerTest(unittest.TestCase):
    """主張層：受控詞表、待審詞、原文起訖與現任政府計畫。"""

    @classmethod
    def setUpClass(cls):
        """讀取抽取層的段落、名冊與主張表。"""
        extract = upstream("extract")
        cls.passages = by_code(extract["passages"], "id")
        cls.entities = by_code(extract["roster"]["entities"], "id")
        # 主張表、審核欄登錄名稱與詞表
        cls.rows = authored("claims", "claims.tsv", CLAIM_HEADER)
        # 方法與審核狀態的登錄名稱
        cls.review = review_names()
        # 詞表的採用詞與待審詞
        names, pending, _ = load_vocab()
        cls.vocab = (names, pending)

    def check(self, row):
        """以本類別的情境核對一列。"""
        return check_claim(row, self.passages, self.entities, self.review, self.vocab)

    def test_all_rows_pass(self):
        """已提交的主張表全部通過。"""
        claims = [self.check(row) for row in self.rows]
        self.assertEqual(len(claims), len(self.rows))
        # 每則主張的起訖切出的文字就是原文
        for claim in claims:
            text = self.passages[claim["passage"]]["text"]
            self.assertEqual(text[claim["start"] : claim["end"]], claim["quote"])

    def test_unregistered_term_fails(self):
        """引用未登錄的詞時失敗，並提示先以待審狀態登錄到詞表。"""
        row = dict(self.rows[0], 對象="不存在的概念")
        with self.assertRaisesRegex(PipelineError, "待審狀態"):
            self.check(row)

    def test_pending_term_fails(self):
        """引用待審詞時失敗。"""
        names, _ = self.vocab
        # 以一個待審詞代替詞表的待審清單
        pending = {("對象", "待審的概念")}
        # 主張的對象改為待審詞
        row = dict(self.rows[0], 對象="待審的概念")
        with self.assertRaisesRegex(PipelineError, "待審詞"):
            check_claim(
                row, self.passages, self.entities, self.review, (names, pending)
            )

    def test_offset_mismatch_fails(self):
        """起訖與原文不符時失敗。"""
        row = dict(self.rows[0], 原文起=str(int(self.rows[0]["原文起"]) + 1))
        with self.assertRaisesRegex(PipelineError, "原文與段落"):
            self.check(row)

    def test_non_integer_offset_fails(self):
        """起訖寫了整數以外的值時回報主張代碼。"""
        row = dict(self.rows[0], 原文起="一")
        with self.assertRaisesRegex(PipelineError, f"{row['代碼']} 的整數欄"):
            self.check(row)

    def test_plan_on_non_incumbent_fails(self):
        """非現任者標註現任政府計畫時失敗。"""
        row = next(r for r in self.rows if not self.entities[r["參選者"]]["incumbent"])
        with self.assertRaisesRegex(PipelineError, "不是現任"):
            self.check(dict(row, 現任政府計畫="是"))


# ==================================================
# 配題層
# ==================================================


class MatchLayerTest(unittest.TestCase):
    """配題層：題目、母題、分配合計、證據與題目版本。"""

    @classmethod
    def setUpClass(cls):
        """讀取主張層產物與配題層的手寫表。"""
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
# 評分層
# ==================================================


class ScoreLayerTest(unittest.TestCase):
    """評分層：具體度不得缺少評分，中立性全部通過才能發布。"""

    @classmethod
    def setUpClass(cls):
        """讀取配題層產物與評分層的手寫表。"""
        match = upstream("match")
        cls.claims = by_code(match["claims"], "id")
        cls.questions = {question["id"] for question in match["questions"]}
        # 具體度判準、級距與中立性判準
        cls.criteria = by_code(read_config_table("rubric-specificity.tsv"))
        cls.levels = by_code(read_config_table("rubric-levels.tsv"), "名稱")
        cls.neutral = by_code(read_config_table("rubric-neutrality.tsv"))
        # 方法與審核狀態的登錄名稱
        cls.review = review_names()
        # 評分層的兩張手寫表
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


# ==================================================
# 轉交與發布
# ==================================================


class CarryAndPublishTest(unittest.TestCase):
    """產物的雜湊轉交與資料版本。"""

    def test_carried_layers_are_complete(self):
        """評分層產物轉交了前面全部的層。"""
        merged, carried = load_product("score", ELECTION)
        self.assertEqual(
            set(carried), {"fetch", "roster", "extract", "claims", "match", "score"}
        )
        # 合併後的內容包含評分層與抽取層另存的名冊
        self.assertIn("specificity", merged)
        self.assertIn("roster", merged)

    def test_changed_upstream_is_detected(self):
        """前面的層修改過而後面沒有重新執行時讀取失敗。"""
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


# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()
