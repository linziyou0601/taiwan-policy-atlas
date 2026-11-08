"""政見收錄 skill 腳本的測試。

確認 offsets.py 的原文定位、bulletin.py 的預覽代碼與轉錄草稿的整理規則、drafts.py 的草稿寫入與重新編號、mappings.py 的母題配題、面向與題目改代碼，以及 aliases.py 的姓名片段。

指令：
  `.venv/bin/python -m unittest discover -s .claude/skills/policy-curation/scripts`，從 repo 根目錄執行

慣例：
  - PDF 在記憶體中產生，預覽寫入系統暫存目錄，不寫入 repo。
  - 寫入各層的測試把資料目錄換成系統暫存目錄。
"""

import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pypdf
from PIL import Image

# 本檔位於 .claude/skills/policy-curation/scripts/，往上四層是 repo 根目錄，管線套件從那裡匯入
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from pipeline import common  # noqa: E402
from pipeline.claims import CLAIM_HEADER  # noqa: E402
from pipeline.common import PipelineError  # noqa: E402
from pipeline.match import MAPPING_HEADER, QUESTION_HEADER  # noqa: E402
from pipeline.score import NEUTRALITY_HEADER, SPECIFICITY_HEADER  # noqa: E402
from pipeline.tables import AXIS_HEADER, read_table, write_table  # noqa: E402

# 腳本與本檔在同一個目錄，unittest discover 已把這個目錄加入匯入路徑
import aliases  # noqa: E402
import bulletin  # noqa: E402
import drafts  # noqa: E402
import mappings  # noqa: E402
import offsets  # noqa: E402

# 測試用的選舉代碼
ELECTION = "test-election"


def row(header, *values):
    """依表頭組成一列。

    參數：
        header：表頭。
        values：各欄的值，依表頭順序。
    回傳：dict。
    """
    return dict(zip(header, values))


def claim(code, entity, start):
    """一則主張。

    參數：
        code：主張代碼。
        entity：參選者代碼。
        start：原文起。
    回傳：claims.tsv 的一列。
    """
    values = [code, entity, "p1", str(start), str(start + 1), "甲"] + ["-"] * (
        len(CLAIM_HEADER) - 6
    )
    return dict(zip(CLAIM_HEADER, values))


def mapping(code, claim_code, facet, question, stance, share):
    """一列配題。

    參數：
        code：配題代碼。
        claim_code：主張代碼。
        facet：面向。
        question：題目代碼，不掛題目時是 -。
        stance：立場。
        share：分配。
    回傳：mappings.tsv 的一列。
    """
    version = "-" if question == "-" else "1"
    return row(
        MAPPING_HEADER,
        code,
        claim_code,
        facet,
        question,
        version,
        stance,
        share,
        "理由",
        "甲",
        "模型判讀",
        "未經獨立複評",
    )


def question(code, facet, parent):
    """一道題目。

    參數：
        code：題目代碼。
        facet：面向。
        parent：母題代碼，根題是 -。
    回傳：questions.tsv 的一列。
    """
    condition = "-" if parent == "-" else "中立、同意、非常同意"
    return row(
        QUESTION_HEADER,
        code,
        facet,
        parent,
        f"{code} 題幹。",
        "說明",
        condition,
        "1",
        "全部",
        "1",
    )


class DataTestCase(unittest.TestCase):
    """把資料目錄換成暫存目錄的測試。"""

    def setUp(self):
        """建立暫存的資料目錄，測試結束時移除。"""
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.data = Path(folder.name)
        # 管線的各層目錄都從 DATA_DIR 推得，換掉它就不會寫入 repo
        patcher = mock.patch.object(common, "DATA_DIR", self.data)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, layer, name, header, rows):
        """寫入一張手寫表。

        參數：
            layer：層名。
            name：檔名。
            header：表頭。
            rows：列。
        """
        path = common.layer_dir(layer, ELECTION) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        write_table(path, header, sorted(rows, key=lambda item: item["代碼"]))

    def read(self, layer, name, header):
        """讀取一張手寫表。

        參數：
            layer：層名。
            name：檔名。
            header：表頭。
        回傳：列的串列。
        """
        return read_table(common.layer_dir(layer, ELECTION) / name, header)


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


# ==================================================
# 公報
# ==================================================


class BulletinTest(unittest.TestCase):
    """公報的預覽與轉錄草稿。"""

    def test_previews_use_extract_codes(self):
        """預覽的代碼與抽取層的影像代碼採用同一種寫法。"""
        page = io.BytesIO()
        # Pillow 儲存為 PDF 時，影像成為唯一一頁的嵌入影像
        Image.new("L", (120, 60), 255).save(page, "PDF")
        reader = pypdf.PdfReader(io.BytesIO(page.getvalue()))
        # 預覽寫入暫存目錄，只比對回傳的說明
        with tempfile.TemporaryDirectory() as folder:
            lines = bulletin.write_previews(reader, Path(folder))
        # 代碼是「p頁碼-嵌入順序」，說明含原始寬高
        self.assertEqual([line.split("\t")[0] for line in lines], ["p1-0"])
        self.assertEqual(lines[0].split("\t")[1], "120x60")

    def test_split_label_is_found(self):
        """同一行相鄰的「政」「見」兩段合成一個標籤。"""
        parts = [
            (100, 50, "政見"),
            (300, 40, "政\n"),
            (300, 52, "見\n"),
            (500, 40, "政"),
            (520, 52, "見"),
        ]
        self.assertEqual(bulletin.label_positions(parts), [(100, 50), (300, 40)])

    def test_numbers_follow_layout(self):
        """號次剛好是 1 到格數時沿用，其餘依頁、列、欄的順序推定。"""
        cell = lambda number, page, top, left: {
            "number": number,
            "page": page,
            "top": top,
            "left": left,
        }
        read = [
            cell("2", 1, 100.004, 700),
            cell("1", 1, 100.0, 50),
            cell("3", 2, 50, 50),
        ]
        # 號次剛好是 1 到 3，依讀到的號次排序
        ordered, guessed = bulletin.assign_numbers(read)
        self.assertEqual(
            ([c["number"] for c in ordered], guessed), (["1", "2", "3"], False)
        )
        # 號次重複時依版面位置推定
        wrong = [cell("4", 1, 100, 700), cell("4", 1, 100, 50), cell("5", 1, 600, 50)]
        ordered, guessed = bulletin.assign_numbers(wrong)
        self.assertEqual(
            ([(c["left"], c["number"]) for c in ordered], guessed),
            ([(50, "1"), (700, "2"), (50, "3")], True),
        )

    def test_text_below_label_is_not_label(self):
        """標籤正下方的「政」「見」兩字視為格內的字。"""
        parts = [(100, 50, "政見"), (122, 50, "政"), (122, 62, "見"), (600, 50, "政見")]
        self.assertEqual(bulletin.label_positions(parts), [(100, 50), (600, 50)])

    def test_draft_joins_wrapped_lines(self):
        """排滿格寬的行與下一行合併，條目開頭另起一行，全形字旁的空白刪除。"""
        parts = [
            (10, 0, "一、推動長照 "),
            (10, 50, "服務到每個社區"),
            (20, 0, "並提高補助"),
            (30, 0, "二、　短行"),
            (40, 0, "下一段"),
        ]
        self.assertEqual(
            bulletin.draft_lines(parts),
            ["一、推動長照服務到每個社區並提高補助", "二、短行", "下一段"],
        )


# ==================================================
# 草稿寫入
# ==================================================


class DraftsTest(DataTestCase):
    """草稿寫進各層與重新編號。"""

    def test_transcripts_overwrite_same_code(self):
        """草稿的段落與轉錄檔寫進抽取層，同代碼的段落覆寫，其餘保留。"""
        from pipeline.extract import TRANSCRIPT_HEADER

        old = [
            "a-1-p1",
            "e:a:1",
            "doc",
            "-",
            "1",
            "a-1.txt",
            "舊",
            "模型判讀",
            "未經獨立複評",
        ]
        kept = [
            "a-2-p1",
            "e:a:2",
            "doc",
            "-",
            "1",
            "a-2.txt",
            "保留",
            "模型判讀",
            "未經獨立複評",
        ]
        self.write(
            "extract",
            "transcripts.tsv",
            TRANSCRIPT_HEADER,
            [row(TRANSCRIPT_HEADER, *old), row(TRANSCRIPT_HEADER, *kept)],
        )
        # 草稿只有 a-1，理由與轉錄檔都換成新的
        with tempfile.TemporaryDirectory() as folder:
            draft = Path(folder)
            # 草稿表的轉錄檔欄寫草稿目錄內的檔名
            (draft / "a-1.txt").write_text("新的轉錄\n", encoding="utf-8")
            write_table(
                draft / "transcripts.tsv",
                TRANSCRIPT_HEADER,
                [row(TRANSCRIPT_HEADER, *old[:6], "新", *old[7:])],
            )
            drafts.write_transcripts(ELECTION, [draft])
        # a-1 換成草稿的理由，a-2 原樣保留
        rows = self.read("extract", "transcripts.tsv", TRANSCRIPT_HEADER)
        self.assertEqual(
            [(r["代碼"], r["理由"]) for r in rows],
            [("a-1-p1", "新"), ("a-2-p1", "保留")],
        )
        # 轉錄檔也換成草稿的內容
        target = common.layer_dir("extract", ELECTION) / "transcripts" / "a-1.txt"
        self.assertEqual(target.read_text(encoding="utf-8"), "新的轉錄\n")

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
            drafts.merge_coding(ELECTION, [draft])
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
                drafts.merge_coding(ELECTION, [draft])
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
        drafts.renumber(ELECTION)
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
        summary = mappings.add_parents(ELECTION)
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

    def test_facets_split_evenly(self):
        """面向依清單重寫、平均分配，已掛題目的主張不改寫。"""
        self.write(
            "match",
            "mappings.tsv",
            MAPPING_HEADER,
            [mapping("a-1-001-m1", "a-1-001", "family", "-", "-", "1")],
        )
        # 三等分時餘數加在第一列
        self.assertEqual(mappings.shares(3), ["0.34", "0.33", "0.33"])
        with tempfile.TemporaryDirectory() as folder:
            # 清單把一則主張改成兩個面向
            spec = Path(folder) / "spec.tsv"
            write_table(
                spec, ["主張", "面向"], [{"主張": "a-1-001", "面向": "family、health"}]
            )
            mappings.rewrite_facets(ELECTION, spec)
        # 兩個面向各分一半
        rows = self.read("match", "mappings.tsv", MAPPING_HEADER)
        self.assertEqual(
            [(r["代碼"], r["面向"], r["分配"]) for r in rows],
            [("a-1-001-m1", "family", "0.5"), ("a-1-001-m2", "health", "0.5")],
        )

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
        mappings.rename_question(ELECTION, "q.x", "q.z")
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
            mappings.rename_question(ELECTION, "q.z", "q.x.y")


# ==================================================
# 遮蔽詞
# ==================================================


class AliasesTest(unittest.TestCase):
    """遮蔽詞的候選。"""

    def test_name_fragments(self):
        """中文名取後兩字，漢名與族名各自成為候選，羅馬拼音逐段。"""
        self.assertEqual(aliases.name_fragments("王小明"), {("小明", "nickname")})
        self.assertEqual(
            aliases.name_fragments("朱仲一 Kalih·Tahes"),
            {
                ("仲一", "nickname"),
                ("朱仲一", "name"),
                ("Kalih·Tahes", "name"),
                ("Kalih", "name"),
                ("Tahes", "name"),
            },
        )
        self.assertEqual(
            aliases.elsewhere(
                "小明", "e:a:1", {"e:a:1": "小明", "e:a:2": "找小明", "e:a:3": "無"}
            ),
            "e:a:2",
        )


# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()
