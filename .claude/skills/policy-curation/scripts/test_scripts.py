"""政見收錄 skill 腳本的測試。

確認 offsets.py 的原文定位、bulletin.py 的預覽代碼與轉錄草稿的整理規則。

指令：
  `.venv/bin/python -m unittest discover -s .claude/skills/policy-curation/scripts`，從 repo 根目錄執行

慣例：
  - PDF 在記憶體中產生，預覽寫入系統暫存目錄，不寫入 repo。
"""

import io
import sys
import tempfile
import unittest
from pathlib import Path

import pypdf
from PIL import Image

# 本檔位於 .claude/skills/policy-curation/scripts/，往上四層是 repo 根目錄，管線套件從那裡匯入
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from pipeline.common import PipelineError  # noqa: E402

# 腳本與本檔在同一個目錄，unittest discover 已把這個目錄加入匯入路徑
import bulletin  # noqa: E402
import offsets  # noqa: E402

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
        ordered, guessed = bulletin.assign_numbers(read)
        self.assertEqual(
            ([c["number"] for c in ordered], guessed), (["1", "2", "3"], False)
        )
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


# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()
