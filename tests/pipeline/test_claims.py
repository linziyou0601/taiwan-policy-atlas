"""主張階段的測試。

測試主張階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

from pathlib import Path
import tempfile
import unittest

from pipeline.claims import _drafts as drafts
from pipeline.claims import offsets
from helpers import (
    DRAFT_ELECTION,
    DataTestCase,
    authored,
    claim,
    mapping,
    question,
    row,
    upstream,
)
from pipeline.claims.run import CLAIM_HEADER, check_claim, load_vocab
from pipeline.common import PipelineError
from pipeline.match.run import MAPPING_HEADER, QUESTION_HEADER
from pipeline.score.run import SPECIFICITY_HEADER
from pipeline.tables import by_code, review_names, write_table

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()

# ==================================================
# 主張階段
# ==================================================


class ClaimLayerTest(unittest.TestCase):
    """主張階段：受控詞表、待審詞、原文起訖與現任政府計畫。"""

    @classmethod
    def setUpClass(cls):
        """讀取抽取階段的段落、名冊與主張表。"""
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
# 起訖
# ==================================================


class OffsetsTest(unittest.TestCase):
    """原文在段落中的定位。"""

    def test_locate_requires_unique_quote(self):
        """起訖未填寫時原文要在段落中只出現一次，已填寫的起訖擷取出原文時沿用。"""
        self.assertEqual(offsets.locate("甲乙丙", "乙", "x"), (1, 2))
        with self.assertRaisesRegex(PipelineError, "不只一次"):
            offsets.locate("甲乙甲", "甲", "x")
        # 原文出現兩次時，編碼者填寫的第二處沿用
        self.assertEqual(offsets.locate("甲乙甲", "甲", "x", "2", "3"), (2, 3))
        # 填寫的起訖擷取不到原文時重新定位，出現兩次仍然失敗
        with self.assertRaisesRegex(PipelineError, "不只一次"):
            offsets.locate("甲乙甲", "甲", "x", "1", "2")
        # 原文不在段落中時無法定位
        with self.assertRaisesRegex(PipelineError, "不在段落中"):
            offsets.locate("甲乙丙", "丁", "x")


class CodingDraftsTest(DataTestCase):
    """草稿寫進各階段與重新編號。"""

    def test_coding_replaces_drafted_entities(self):
        """草稿涵蓋的參選者，舊的主張連同配題與具體度整批換掉，其他參選者保留。"""
        self.write(
            "claims",
            "claims.tsv",
            CLAIM_HEADER,
            [
                claim("a-1-001", "e:a:1", 0),
                claim("a-1-002", "e:a:1", 5),
                claim("a-2-001", "e:a:2", 0),
            ],
        )
        self.write(
            "match",
            "mappings.tsv",
            MAPPING_HEADER,
            [
                mapping("a-1-002-m1", "a-1-002", "x", "-", "-", "1"),
                mapping("a-2-001-m1", "a-2-001", "x", "-", "-", "1"),
            ],
        )
        # 草稿只把 a-1 重新編成一則
        with tempfile.TemporaryDirectory() as folder:
            draft = Path(folder)
            write_table(
                draft / "claims.tsv", CLAIM_HEADER, [claim("a-1-001", "e:a:1", 3)]
            )
            # 草稿的配題連到草稿的主張
            write_table(
                draft / "mappings.tsv",
                MAPPING_HEADER,
                [mapping("a-1-001-m1", "a-1-001", "y", "-", "-", "1")],
            )
            # a-1 只剩草稿的一則，a-2 保留
            drafts.merge_coding(DRAFT_ELECTION, [draft])
        claims = self.read("claims", "claims.tsv", CLAIM_HEADER)
        self.assertEqual(
            [(r["代碼"], r["原文起"]) for r in claims],
            [("a-1-001", "3"), ("a-2-001", "0")],
        )
        # a-1 舊主張的配題一起移除
        rows = self.read("match", "mappings.tsv", MAPPING_HEADER)
        self.assertEqual(
            [(r["代碼"], r["面向"]) for r in rows],
            [("a-1-001-m1", "y"), ("a-2-001-m1", "x")],
        )

    def test_coding_stops_on_shared_conflict(self):
        """題目同代碼而內容不同時停止，repo 的題目不變。"""
        self.write(
            "match", "questions.tsv", QUESTION_HEADER, [question("q.x", "x", "-")]
        )
        # 草稿的同一題換了題幹
        with tempfile.TemporaryDirectory() as folder:
            draft = Path(folder)
            changed = question("q.x", "x", "-") | {"題幹": "另一個題幹。"}
            # 衝突時整批不寫，回報衝突的代碼
            write_table(draft / "questions.tsv", QUESTION_HEADER, [changed])
            with self.assertRaisesRegex(PipelineError, "questions.tsv q.x"):
                drafts.merge_coding(DRAFT_ELECTION, [draft])
        # repo 的題幹維持原樣
        self.assertEqual(
            self.read("match", "questions.tsv", QUESTION_HEADER)[0]["題幹"],
            "q.x 題幹。",
        )

    def test_renumber_follows_quote_order(self):
        """主張依原文起重新編號，配題與具體度的代碼跟著改。"""
        self.write(
            "claims",
            "claims.tsv",
            CLAIM_HEADER,
            [claim("a-1-001", "e:a:1", 9), claim("a-1-003", "e:a:1", 2)],
        )
        self.write(
            "match",
            "mappings.tsv",
            MAPPING_HEADER,
            [
                mapping("a-1-001-m1", "a-1-001", "x", "-", "-", "1"),
                mapping("a-1-003-m1", "a-1-003", "y", "-", "-", "1"),
            ],
        )
        self.write(
            "score",
            "specificity.tsv",
            SPECIFICITY_HEADER,
            [
                row(
                    SPECIFICITY_HEADER,
                    "a-1-003-funding",
                    "a-1-003",
                    "funding",
                    "未明示",
                    "理由",
                    "-",
                    "模型判讀",
                    "未經獨立複評",
                )
            ],
        )
        # a-1-003 的原文起較前，改為 001
        drafts.renumber(DRAFT_ELECTION)
        claims = self.read("claims", "claims.tsv", CLAIM_HEADER)
        self.assertEqual(
            [(r["代碼"], r["原文起"]) for r in claims],
            [("a-1-001", "2"), ("a-1-002", "9")],
        )
        # 配題與具體度的代碼跟著主張改
        rows = self.read("match", "mappings.tsv", MAPPING_HEADER)
        self.assertEqual(
            [(r["代碼"], r["面向"]) for r in rows],
            [("a-1-001-m1", "y"), ("a-1-002-m1", "x")],
        )
        self.assertEqual(
            self.read("score", "specificity.tsv", SPECIFICITY_HEADER)[0]["代碼"],
            "a-1-001-funding",
        )
