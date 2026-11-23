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
from helpers import DRAFT_ELECTION, DataTestCase, row
from pipeline.common import PipelineError
from pipeline.extract.run import ROSTER_HEADER, SCOPE_HEADER, build_roster, ocr_check
from pipeline.fetch.list import LIST_HEADER
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
    """公報頁面的渲染。"""

    def test_render_scales_selected_pages(self):
        """渲染只輸出指定的頁與它的文字層，像素寬高是頁面尺寸乘上倍率，頁碼超出頁數時停止。"""
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
        # 輸出只有第 2 頁的渲染圖與文字層，寬高是 100 x 50 pt 乘上倍率
        self.assertEqual(written, ["page-2.png", "page-2.txt"])
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

    def test_transcripts_merge_roster_draft(self):
        """草稿目錄有名冊表時併入抽取階段，同代碼覆寫，其餘保留。"""
        from pipeline.extract.run import ROSTER_HEADER, TRANSCRIPT_HEADER

        kept = row(ROSTER_HEADER, "a-2", "乙", "-", "某黨", "否", "公報第 1 頁")
        old = row(ROSTER_HEADER, "a-1", "甲", "-", "某黨", "否", "公報第 1 頁")
        self.write("extract", "roster.tsv", ROSTER_HEADER, [old, kept])
        # 草稿只有 a-1，現任改為是
        with tempfile.TemporaryDirectory() as folder:
            draft = Path(folder)
            # 這份草稿沒有段落，只有名冊表
            write_table(draft / "transcripts.tsv", TRANSCRIPT_HEADER, [])
            write_table(draft / "roster.tsv", ROSTER_HEADER, [old | {"現任": "是"}])
            transcript_tools.write_transcripts(DRAFT_ELECTION, [draft])
        # a-1 換成草稿的現任，a-2 原樣保留
        rows = self.read("extract", "roster.tsv", ROSTER_HEADER)
        self.assertEqual(
            [(r["代碼"], r["現任"]) for r in rows], [("a-1", "是"), ("a-2", "否")]
        )

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

    def test_district_documents_named_by_county(self):
        """選區沒有鄉鎮時依縣市名稱的字尾查職稱，標題寫縣市與職稱。"""
        names = {"10-004-12": "新竹縣 第 12 選舉區", "63-000-07": "臺北市 第 7 選舉區"}
        used = {
            "a": ("115/新竹縣.pdf", {"10-004-12"}),
            "b": ("115/臺北市.pdf", {"63-000-07"}),
        }
        result = transcript_tools.document_names(
            used, names, {"縣": "議員", "市": "議員"}
        )
        # 選舉區不當成鄉鎮，標題沒有「第」
        self.assertEqual(result["a"], ("bulletin-10-004-12", "新竹縣議員選舉選舉公報"))
        self.assertEqual(result["b"], ("bulletin-63-000-07", "臺北市議員選舉選舉公報"))

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
                row(unit_tools.DOC_HEADER, "doc1", "site", "111/羅東.pdf", "new", "2"),
                row(unit_tools.DOC_HEADER, "doc2", "site", "111/舊.pdf", "old", "1"),
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
        definition.write_text(
            f"id: {DRAFT_ELECTION}\nroster:\n  source: votedata\ndocuments: []\n",
            encoding="utf-8",
        )
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
        # 新公報的來源取素材的來源欄，影像欄列出引用的影像
        self.assertIn("source: site\n", yaml_text)
        self.assertIn("images: [p2-3]", yaml_text)
        self.assertNotIn("id: bulletin-old", yaml_text)

    def test_collect_adds_roster_drafts(self):
        """名冊表的選舉，選區輸出的名冊表草稿先併入名冊表，再依它核對號次。"""
        from pipeline.extract.run import ROSTER_HEADER, SCOPE_HEADER, TRANSCRIPT_HEADER

        code = "10-002-020-01"
        # 選區表有一個選區，名冊表還沒有參選者
        self.write(
            "extract",
            "scopes.tsv",
            SCOPE_HEADER,
            [
                row(
                    SCOPE_HEADER,
                    code,
                    "宜蘭縣 羅東鎮 第 1 選舉區",
                    "10002",
                    "-",
                    "羅東鎮",
                )
            ],
        )
        # 選舉定義寫名冊表，公報已登錄
        definition = common.election_path(DRAFT_ELECTION)
        definition.parent.mkdir(parents=True, exist_ok=True)
        definition.write_text(
            f"id: {DRAFT_ELECTION}\nentity_type: candidate\nroster:\n  tables: true\n"
            "documents:\n  - id: bulletin-old\n    sha256: old\n",
            encoding="utf-8",
        )
        # 素材的公報清單只有已登錄的公報
        units, scope = self.data / "units", self.data / "out" / code
        material = units / DRAFT_ELECTION / "units" / code
        # 素材目錄先建好再寫公報清單
        material.mkdir(parents=True)
        write_table(
            material / "docs.tsv",
            unit_tools.DOC_HEADER,
            [row(unit_tools.DOC_HEADER, "doc1", "site", "111/舊.pdf", "old", "1")],
        )
        # 轉錄者依公報補上名冊表草稿，連同說明表與轉錄稿
        scope.mkdir(parents=True)
        write_table(
            scope / "roster.tsv",
            ROSTER_HEADER,
            [row(ROSTER_HEADER, f"{code}-1", "甲", "-", "某黨", "否", "公報第 1 頁")],
        )
        write_table(
            scope / "notes.tsv",
            transcript_tools.NOTE_HEADER,
            [row(transcript_tools.NOTE_HEADER, code, "1", "doc1", "1", "-", "文字層")],
        )
        # 1 號的轉錄稿
        (scope / f"{code}-1.txt").write_text("政見\n", encoding="utf-8")
        # 素材的目錄換成暫存目錄
        with mock.patch.object(unit_tools, "WORK_DIR", units):
            transcript_tools.collect_units(DRAFT_ELECTION, [scope], {"鎮": "鎮民代表"})
        # 名冊表多了 1 號，段落指向名冊表組成的對象代碼
        entities = self.read("extract", "roster.tsv", ROSTER_HEADER)
        passages = self.read("extract", "transcripts.tsv", TRANSCRIPT_HEADER)
        # 兩張表各一列
        self.assertEqual([r["代碼"] for r in entities], [f"{code}-1"])
        self.assertEqual(
            [r["參選者"] for r in passages], [f"{DRAFT_ELECTION}:{code}:1"]
        )


# ==================================================
# 遮蔽詞
# ==================================================


class RosterTablesTest(DataTestCase):
    """手寫的選區表與名冊表。"""

    def roster(self, roster_rows):
        """寫入一個縣市選區與名冊表，匯入名冊。

        參數：
            roster_rows：名冊表的列。
        回傳：build_roster 的結果。
        """
        self.write(
            "extract",
            "scopes.tsv",
            SCOPE_HEADER,
            [row(SCOPE_HEADER, "10-002", "宜蘭縣", "10002", "-", "-")],
        )
        self.write("extract", "roster.tsv", ROSTER_HEADER, roster_rows)
        election = {"id": DRAFT_ELECTION, "entity_type": "candidate"}
        return build_roster(common.layer_dir("extract", DRAFT_ELECTION), election)

    def test_tables_match_adapter_format(self):
        """名冊表組成的選區與對象，鍵與 adapter 匯入的名冊相同，對象依號次排序。"""
        roster = self.roster(
            [
                row(
                    ROSTER_HEADER,
                    "10-002-10",
                    "乙",
                    "-",
                    "無黨籍及未經政黨推薦",
                    "否",
                    "公報第 1 頁",
                ),
                row(ROSTER_HEADER, "10-002-2", "甲", "-", "某黨", "是", "公報第 1 頁"),
            ]
        )
        self.assertEqual(roster["scopes"][0]["id"], f"{DRAFT_ELECTION}:10-002")
        # 碼位排序時 10 號在 2 號之前，產物依號次的數值排序
        self.assertEqual([entity["number"] for entity in roster["entities"]], [2, 10])
        self.assertEqual(
            set(roster["entities"][0]),
            {
                "id",
                "scope",
                "number",
                "name",
                "running_mate",
                "party",
                "incumbent",
                "type",
            },
        )
        self.assertTrue(roster["entities"][0]["incumbent"])

    def test_unknown_scope_stops(self):
        """參選者的選區不在選區表時停止。"""
        with self.assertRaises(PipelineError):
            self.roster(
                [row(ROSTER_HEADER, "10-003-1", "甲", "-", "某黨", "否", "公報第 1 頁")]
            )


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
    """公報網站的選區對應與公報解析。"""

    def test_documents_match_county_town_and_folder(self):
        """公報依縣市、類別與鄉鎮名稱或簡稱對到選區。"""
        paths = [
            "111/15宜蘭縣/04鄉鎮市民代表/頭城鎮/頭城鎮第1選舉區.pdf",
            "111/15宜蘭縣/04鄉鎮市民代表/【礁溪】代表公報.pdf",
            "111/15宜蘭縣/03鄉鎮市長/頭城鎮長公報.pdf",
            "111/16花蓮縣/04鄉鎮市民代表/頭城鎮.pdf",
        ]
        found = unit_tools.matching_documents(
            paths, "宜蘭縣 頭城鎮 第 1 選舉區", {"04鄉鎮市民代表"}
        )
        # 其他類別與其他縣市的公報不屬於這個選區
        self.assertEqual(found, [paths[0]])
        # 去掉字尾的簡稱也對得到，路徑開頭的括號先去掉
        short = unit_tools.matching_documents(
            paths, "宜蘭縣 礁溪鄉", {"04鄉鎮市民代表"}
        )
        self.assertEqual(short, [paths[1]])

    def test_documents_match_district_and_county(self):
        """中央公報網站的公報依選舉區編號或縣市對到選區，編號可以補零，一份公報可以列出數個選舉區。"""
        paths = [
            "01選舉公報/06縣市議員/115年/07新竹縣/新竹縣第01選舉區.pdf",
            "01選舉公報/06縣市議員/115年/07新竹縣/新竹縣第11選舉區.pdf",
            "01選舉公報/04縣市長/115年/新竹縣縣長.pdf",
            "01選舉公報/04縣市長/115年/新竹市市長.pdf",
            "01選舉公報/06縣市議員/115年/16宜蘭縣/宜蘭縣議會議員第 2、11、12選舉區選舉公報.pdf",
            "01選舉公報/05直轄市議員/115年/01臺北市/臺北市第15屆議員第7及第8選舉區選舉公報.pdf",
        ]
        district = unit_tools.matching_documents(
            paths, "新竹縣 第 1 選舉區", {"06縣市議員"}
        )
        # 第 11 選舉區不是第 1 選舉區
        self.assertEqual(district, [paths[0]])
        # 列出數個選舉區的公報，每個列出的選舉區都對得到，屆次的編號不算選舉區
        listed = unit_tools.matching_documents(
            paths, "宜蘭縣 第 11 選舉區", {"06縣市議員"}
        )
        self.assertEqual(listed, [paths[4]])
        # 以「及」相連的兩個選舉區，後一個也對得到
        joined = unit_tools.matching_documents(
            paths, "臺北市 第 8 選舉區", {"05直轄市議員"}
        )
        self.assertEqual(joined, [paths[5]])
        # 縣市選區只比類別與縣市，新竹市不是新竹縣
        county = unit_tools.matching_documents(paths, "新竹縣", {"04縣市長"})
        self.assertEqual(county, [paths[2]])

    def test_assigned_documents_replace_matching(self):
        """以 `--assign` 指定公報的選區不比對名稱，指定的公報要在公報清單裡。"""
        # 中文數字的檔名依名稱對不到選區
        path = "01選舉公報/06縣市議員/115年/13屏東縣/議員--第一選舉區.pdf"
        roster = {
            "scopes": [{"id": "e:10-013-01", "name": "屏東縣 第 1 選舉區"}],
            "entities": [],
        }
        written = []
        # 公報清單只有這一份，寫在暫存目錄
        with tempfile.TemporaryDirectory() as folder:
            listed = Path(folder) / "115.tsv"
            write_table(
                listed, LIST_HEADER, [{"路徑": path, "sha256": "abc", "大小": "1"}]
            )
            # 清單、選舉定義、名冊與素材的寫出都換成測試的內容
            with mock.patch.object(
                unit_tools, "listing_path", return_value=listed
            ), mock.patch.object(
                unit_tools, "election_config", return_value={"year": 2026}
            ), mock.patch.object(
                unit_tools, "current_roster", return_value=roster
            ), mock.patch.object(
                unit_tools, "write_unit", side_effect=lambda *a: written.append(a)
            ):
                unit_tools.prepare_units(
                    "e", "site", {"06縣市議員"}, set(), set(), {"10-013-01": [path]}
                )
                # 中文數字的檔名對不到，指定後素材只有這份公報
                self.assertEqual(written[0][-1], [(path, "abc")])
                # 清單沒有的路徑停止，不寫出素材
                with self.assertRaises(PipelineError):
                    unit_tools.prepare_units(
                        "e",
                        "site",
                        {"06縣市議員"},
                        set(),
                        set(),
                        {"10-013-01": ["x.pdf"]},
                    )

    def test_bulletin_is_parsed_once(self):
        """每頁寫出文字層，影像列出位置與寬高，同一份公報只解析一次。"""
        page = io.BytesIO()
        # Pillow 儲存的 PDF 只有一張嵌入影像，鋪滿 120 x 60 pt 的頁面
        Image.new("L", (120, 60), 255).save(page, "PDF")
        # 公報放在暫存目錄的快取路徑
        with tempfile.TemporaryDirectory() as folder:
            cache, out = Path(folder) / "sources", Path(folder) / "curation"
            pdf = cache / "site" / "111" / "a.pdf"
            # 建好快取目錄後寫入公報
            pdf.parent.mkdir(parents=True)
            pdf.write_bytes(page.getvalue())
            # 快取與產出都換成暫存目錄
            with mock.patch.object(unit_tools, "CACHE_DIR", cache), mock.patch.object(
                unit_tools, "WORK_DIR", out
            ):
                parsed, pages = unit_tools.parsed_bulletin("site", "111/a.pdf", "abc")
                images = read_table(parsed / "images.tsv", unit_tools.IMAGE_HEADER)
                # 再次取得時沿用結果，不重新解析
                with mock.patch.object(unit_tools, "parse_bulletin") as parse:
                    unit_tools.parsed_bulletin("site", "111/a.pdf", "abc")
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
