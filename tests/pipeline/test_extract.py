"""抽取階段的測試。

測試抽取階段的核對與工具：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

from pathlib import Path
from unittest import mock
import argparse
import io
import json
import tempfile
import unittest
import zipfile

from PIL import Image
from pipeline import common
from pipeline.extract import _pdf as pdf_tools
from pipeline.extract import _transcripts as transcript_tools
from pipeline.extract import aliases, collect
from pipeline.extract import units as unit_tools
import pypdf
from helpers import DRAFT_ELECTION, DataTestCase, row
from pipeline.common import PipelineError
from pipeline.extract.run import ocr_check
from pipeline.tables import read_table, write_table

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


class OcrCheckTest(unittest.TestCase):
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


# ==================================================
# 公報
# ==================================================


class BulletinTest(unittest.TestCase):
    """公報的預覽與轉錄草稿。"""

    def test_previews_use_extract_codes(self):
        """預覽的代碼與抽取階段的影像代碼採用同一種寫法。"""
        page = io.BytesIO()
        # Pillow 儲存為 PDF 時，影像成為唯一一頁的嵌入影像
        Image.new("L", (120, 60), 255).save(page, "PDF")
        reader = pypdf.PdfReader(io.BytesIO(page.getvalue()))
        # 預覽寫入暫存目錄，只比對回傳的說明
        with tempfile.TemporaryDirectory() as folder:
            lines = pdf_tools.write_previews(reader, Path(folder))
        # 代碼是「p頁碼-嵌入順序」，說明含原始寬高
        self.assertEqual([line.split("\t")[0] for line in lines], ["p1-0"])
        self.assertEqual(lines[0].split("\t")[1], "120x60")

    def test_render_scales_selected_pages(self):
        """渲染只輸出指定的頁，像素寬高是頁面尺寸乘上倍率，頁碼超出頁數時停止。"""
        # Pillow 以 72 dpi 儲存，每個像素是 1 pt，兩頁各 100 x 50 pt
        pages = [Image.new("L", (100, 50), 255) for _ in range(2)]
        # PDF 與渲染結果都寫在暫存目錄
        with tempfile.TemporaryDirectory() as folder:
            pdf = Path(folder) / "bulletin.pdf"
            pages[0].save(pdf, "PDF", save_all=True, append_images=pages[1:])
            # 只渲染第 2 頁，倍率 2
            lines = pdf_tools.render_pages(pdf, Path(folder) / "pages", 2, [2])
            written = sorted(path.name for path in (Path(folder) / "pages").iterdir())
            # 第 3 頁不存在
            with self.assertRaises(PipelineError):
                pdf_tools.render_pages(pdf, Path(folder) / "pages", 2, [3])
        # 輸出只有第 2 頁，寬高是 100 x 50 pt 乘上倍率
        self.assertEqual(written, ["page-2.png"])
        self.assertEqual(lines[0].split("\t")[:2], ["p2", "200x100"])

    def test_render_clip_keeps_range(self):
        """指定範圍時只渲染那一塊，左上為原點，範圍超出頁面時停止。"""
        # 100 x 50 pt 的頁面，左上 20 x 10 pt 是黑色，其餘白色
        page = Image.new("L", (100, 50), 255)
        page.paste(0, (0, 0, 20, 10))
        # PDF 與渲染結果都寫在暫存目錄
        with tempfile.TemporaryDirectory() as folder:
            pdf = Path(folder) / "bulletin.pdf"
            page.save(pdf, "PDF")
            # 取左上 40 x 20 pt，倍率 2
            lines = pdf_tools.render_pages(pdf, Path(folder), 2, [1], (0, 0, 40, 20))
            picture = Image.open(Path(folder) / "page-1-0-0.png").convert("L")
            # 超出頁寬的範圍
            with self.assertRaises(PipelineError):
                pdf_tools.render_pages(pdf, Path(folder), 2, [1], (0, 0, 120, 20))
        # 寬高是範圍乘上倍率，左上角落在黑色區塊、右下角落在白色區塊
        self.assertEqual(lines[0].split("\t")[:2], ["p1", "80x40"])
        self.assertLess(picture.getpixel((2, 2)), 50)
        self.assertGreater(picture.getpixel((78, 38)), 200)

    def test_split_label_is_found(self):
        """同一行相鄰的「政」「見」兩段合成一個標籤。"""
        parts = [
            (100, 50, "政見"),
            (300, 40, "政\n"),
            (300, 52, "見\n"),
            (500, 40, "政"),
            (520, 52, "見"),
        ]
        self.assertEqual(pdf_tools.label_positions(parts), [(100, 50), (300, 40)])

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
        ordered, guessed = pdf_tools.assign_numbers(read)
        self.assertEqual(
            ([c["number"] for c in ordered], guessed), (["1", "2", "3"], False)
        )
        # 號次重複時依版面位置推定
        wrong = [cell("4", 1, 100, 700), cell("4", 1, 100, 50), cell("5", 1, 600, 50)]
        ordered, guessed = pdf_tools.assign_numbers(wrong)
        self.assertEqual(
            ([(c["left"], c["number"]) for c in ordered], guessed),
            ([(50, "1"), (700, "2"), (50, "3")], True),
        )

    def test_text_below_label_is_not_label(self):
        """標籤正下方的「政」「見」兩字視為格內的字。"""
        parts = [(100, 50, "政見"), (122, 50, "政"), (122, 62, "見"), (600, 50, "政見")]
        self.assertEqual(pdf_tools.label_positions(parts), [(100, 50), (600, 50)])

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
            pdf_tools.draft_lines(parts),
            ["一、推動長照服務到每個社區並提高補助", "二、短行", "下一段"],
        )


class TranscriptDraftsTest(DataTestCase):
    """草稿寫進各階段與重新編號。"""

    def test_transcripts_overwrite_same_code(self):
        """草稿的段落與轉錄檔寫進抽取階段，同代碼的段落覆寫，其餘保留。"""
        from pipeline.extract.run import TRANSCRIPT_HEADER

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
            transcript_tools.write_transcripts(DRAFT_ELECTION, [draft])
        # a-1 換成草稿的理由，a-2 原樣保留
        rows = self.read("extract", "transcripts.tsv", TRANSCRIPT_HEADER)
        self.assertEqual(
            [(r["代碼"], r["理由"]) for r in rows],
            [("a-1-p1", "新"), ("a-2-p1", "保留")],
        )
        # 轉錄檔也換成草稿的內容
        target = common.layer_dir("extract", DRAFT_ELECTION) / "transcripts" / "a-1.txt"
        self.assertEqual(target.read_text(encoding="utf-8"), "新的轉錄\n")

    def test_documents_named_by_shared_prefix(self):
        """公報代碼取選區代碼的共同前段，同一鄉鎮用到數份公報時接上選區並在標題註明。"""
        names = {
            "10-002-010-01": "宜蘭縣 宜蘭市 第 1 選舉區",
            "10-002-010-02": "宜蘭縣 宜蘭市 第 2 選舉區",
            "10-002-020-01": "宜蘭縣 羅東鎮 第 1 選舉區",
            "10-002-020-02": "宜蘭縣 羅東鎮 第 2 選舉區",
            "10-002-020-03": "宜蘭縣 羅東鎮 第 3 選舉區",
        }
        used = {
            "a": ("111/宜蘭市.pdf", {"10-002-010-01", "10-002-010-02"}),
            "b": ("111/羅東1.pdf", {"10-002-020-01"}),
            "c": ("111/羅東2.pdf", {"10-002-020-02"}),
            "d": ("111/羅東3.pdf", {"10-002-020-03"}),
        }
        offices = {"市": "市民代表", "鎮": "鎮民代表"}
        # 四份公報一起命名
        result = transcript_tools.document_names(used, names, offices)
        # 宜蘭市只有一份公報，羅東鎮的三份各接上選區
        self.assertEqual(
            result["a"], ("bulletin-10-002-010", "宜蘭縣宜蘭市市民代表選舉選舉公報")
        )
        self.assertEqual(
            result["b"],
            (
                "bulletin-10-002-020-01",
                "宜蘭縣羅東鎮鎮民代表選舉選舉公報（第 1 選舉區）",
            ),
        )
        # 同名的最後一份也接上選區
        self.assertEqual(
            result["d"][1], "宜蘭縣羅東鎮鎮民代表選舉選舉公報（第 3 選舉區）"
        )
        # 字尾沒有職稱時停止
        with self.assertRaises(PipelineError):
            transcript_tools.document_names(used, names, {"市": "市民代表"})

    def test_units_register_documents_and_write(self):
        """選區輸出寫進抽取階段，新公報登錄到設定，已登錄的沿用代碼，不在公報的參選者列出。"""
        from pipeline.extract.run import TRANSCRIPT_HEADER

        roster = {
            "roster": {
                "scopes": [
                    {"id": "e:10-002-020-01", "name": "宜蘭縣 羅東鎮 第 1 選舉區"}
                ],
                "entities": [
                    {
                        "id": f"e:10-002-020-01:{n}",
                        "scope": "e:10-002-020-01",
                        "number": n,
                    }
                    for n in (1, 2, 3)
                ],
            }
        }
        # 名冊寫在暫存的抽取階段
        extract = common.layer_dir("extract", DRAFT_ELECTION)
        extract.mkdir(parents=True)
        (extract / "roster.json").write_text(json.dumps(roster), encoding="utf-8")
        # 素材的公報清單與選區輸出都放在暫存目錄，選舉定義在暫存的資料目錄
        units, output = self.data / "units", self.data / "out"
        definition = common.election_path(DRAFT_ELECTION)
        # 素材的公報清單有新公報與已登錄的公報各一份
        material = units / DRAFT_ELECTION / "units" / "10-002-020-01"
        material.mkdir(parents=True)
        write_table(
            material / "docs.tsv",
            unit_tools.DOC_HEADER,
            [
                row(unit_tools.DOC_HEADER, "doc1", "111/羅東.pdf", "new", "2"),
                row(unit_tools.DOC_HEADER, "doc2", "111/舊.pdf", "old", "1"),
            ],
        )
        # 1 號引用新公報的影像，2 號引用已登錄的公報，3 號不在公報
        scope = output / "10-002-020-01"
        scope.mkdir(parents=True)
        write_table(
            scope / "notes.tsv",
            transcript_tools.NOTE_HEADER,
            [
                row(
                    transcript_tools.NOTE_HEADER,
                    "10-002-020-01",
                    "1",
                    "doc1",
                    "2",
                    "p2-3",
                    "影像",
                ),
                row(
                    transcript_tools.NOTE_HEADER,
                    "10-002-020-01",
                    "2",
                    "doc2",
                    "1",
                    "-",
                    "文字層",
                ),
                row(
                    transcript_tools.NOTE_HEADER,
                    "10-002-020-01",
                    "3",
                    "-",
                    "-",
                    "-",
                    "不在公報",
                ),
            ],
        )
        # 轉錄稿是每位參選者一個檔
        for number in (1, 2):
            (scope / f"10-002-020-01-{number}.txt").write_text(
                f"政見{number}\n", encoding="utf-8"
            )
        # 選舉定義還沒有文件，已登錄的公報由 election_config 提供
        definition.parent.mkdir(parents=True, exist_ok=True)
        definition.write_text("id: e\ndocuments: []\n", encoding="utf-8")
        registered = {"documents": [{"id": "bulletin-old", "sha256": "old"}]}
        # 以工具的參數解析執行，職稱寫在目錄之前，目錄仍要讀成選區輸出目錄
        parser = argparse.ArgumentParser()
        collect.arguments(parser)
        argv = ["--election", DRAFT_ELECTION, "--office", "鎮=鎮民代表", str(scope)]
        # 素材的目錄換成暫存目錄
        with mock.patch.object(unit_tools, "WORK_DIR", units), mock.patch.object(
            transcript_tools, "election_config", return_value=registered
        ):
            summary = collect.main(parser.parse_args(argv))
        # 讀回寫入的段落表與選舉定義
        rows = self.read("extract", "transcripts.tsv", TRANSCRIPT_HEADER)
        yaml_text = definition.read_text(encoding="utf-8")
        # 兩段寫入，3 號列為問題，新公報登錄且影像欄列出引用的影像
        self.assertEqual(
            [(r["代碼"], r["文件"], r["影像"]) for r in rows],
            [
                (
                    "10-002-020-01-1-p1",
                    "bulletin-10-002-020-01",
                    "bulletin-10-002-020-01-p2-3",
                ),
                ("10-002-020-01-2-p1", "bulletin-old", "-"),
            ],
        )
        self.assertIn("10-002-020-01-3：不在公報", summary)
        # 新公報登錄，已登錄的公報不重複登錄
        self.assertIn("id: bulletin-10-002-020-01\n", yaml_text)
        self.assertIn("images: [p2-3]", yaml_text)
        self.assertNotIn("id: bulletin-old", yaml_text)


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


class UnitsTest(unittest.TestCase):
    """地方公報網站的目錄解析、選區對應與公報解析。"""

    def test_documents_match_county_town_and_folder(self):
        """公報依縣市、類別與鄉鎮名稱或簡稱對到選區。"""
        paths = [
            "111/15宜蘭縣/04鄉鎮市民代表/頭城鎮/頭城鎮第1選舉區.pdf",
            "111/15宜蘭縣/04鄉鎮市民代表/【礁溪】代表公報.pdf",
            "111/15宜蘭縣/03鄉鎮市長/頭城鎮長公報.pdf",
            "111/16花蓮縣/04鄉鎮市民代表/頭城鎮.pdf",
        ]
        found = unit_tools.matching_documents(
            paths, "宜蘭縣", "頭城鎮", {"04鄉鎮市民代表"}
        )
        # 其他類別與其他縣市的公報不屬於這個選區
        self.assertEqual(found, [paths[0]])
        # 去掉字尾的簡稱也對得到，路徑開頭的括號先去掉
        short = unit_tools.matching_documents(
            paths, "宜蘭縣", "礁溪鄉", {"04鄉鎮市民代表"}
        )
        self.assertEqual(short, [paths[1]])

    def test_bulletin_is_parsed_once(self):
        """每頁寫出文字層，影像列出位置與寬高，同一份公報只解析一次。"""
        page = io.BytesIO()
        # Pillow 儲存的 PDF 只有一張嵌入影像，鋪滿 120 x 60 pt 的頁面
        Image.new("L", (120, 60), 255).save(page, "PDF")
        # 公報放在暫存目錄的快取路徑
        with tempfile.TemporaryDirectory() as folder:
            cache, out = Path(folder) / "sources", Path(folder) / "curation"
            pdf = cache / unit_tools.SOURCE / "111" / "a.pdf"
            # 建好快取目錄後寫入公報
            pdf.parent.mkdir(parents=True)
            pdf.write_bytes(page.getvalue())
            # 快取與產出都換成暫存目錄
            with mock.patch.object(unit_tools, "CACHE_DIR", cache), mock.patch.object(
                unit_tools, "WORK_DIR", out
            ):
                parsed, pages = unit_tools.parsed_bulletin("111/a.pdf", "abc")
                images = read_table(parsed / "images.tsv", unit_tools.IMAGE_HEADER)
                # 再次取得時沿用結果，不重新解析
                with mock.patch.object(unit_tools, "parse_bulletin") as parse:
                    unit_tools.parsed_bulletin("111/a.pdf", "abc")
                    parse.assert_not_called()
                # 解析結果的目錄列出寫出的檔案
                written = sorted(path.name for path in parsed.iterdir())
        # 頁數、各頁文字層與影像位置都寫出
        self.assertEqual(pages, "1")
        self.assertEqual(written, ["images.tsv", "page-1.txt", "pages.txt"])
        self.assertEqual(
            [images[0][key] for key in ("代碼", "寬", "高", "x1", "y1")],
            ["p1-0", "120", "60", "120", "60"],
        )
