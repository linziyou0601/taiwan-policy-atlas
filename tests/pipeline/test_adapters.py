"""來源 adapter 的測試。

測試來源 adapter 的核對與讀取：通過的資料、每一種不符規格的資料，以及工具寫出的檔案。規則見 docs/pipeline/ 的同名文件。

指令：
  `npm test`

慣例：
  - 以已提交的資料測試通過的情形，以記憶體中修改過的副本測試錯誤的情形。
  - 寫入檔案的測試把資料目錄換成暫存目錄。
"""

from pathlib import Path
import io
import tempfile
import unittest
import zipfile

from PIL import Image
from pipeline.adapters.cec_bulletin import extract_document, indexed_palette, png_ready
from pipeline.adapters.cec_roster import (
    DIRECTORY_YEAR,
    SCOPE_NAMES,
    roster_name,
    scope_key,
)
from pipeline.common import PipelineError

# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()


class AdapterTest(unittest.TestCase):
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

    def test_scope_keys_and_names(self):
        """選區代碼依選區類型擷取行政代碼的段，名稱樣板涵蓋全部類型。"""
        codes = ["63", "000", "01", "000", "0000"]
        # 全國性選舉只有一個選區，區域選區使用縣市與選區碼
        self.assertEqual(scope_key(codes, "national"), "national")
        # 每種選區類型都有名稱樣板
        self.assertEqual(scope_key(codes, "district"), "63-000-01")
        self.assertEqual(
            set(SCOPE_NAMES),
            {"national", "county", "district", "town", "town-district", "village"},
        )

    def test_roster_private_use_characters(self):
        """名冊姓名的造字依年度與碼位換成公報的寫法，表外的造字停止。"""
        characters = {"2022-E011": "塗"}
        # 名冊目錄的年份取自 voteData 之下的第一段
        year = DIRECTORY_YEAR.search(
            "votedata/voteData/2022-111年地方公職人員選舉/R1/"
        )[1]
        self.assertEqual(year, "2022")
        # 登錄過的造字替換，前後空白去掉
        self.assertEqual(roster_name(" \ue011明琴 ", year, characters, "e:1"), "塗明琴")
        # 同一碼位在別的年度沒有登錄時停止
        with self.assertRaises(PipelineError):
            roster_name("\ue011明琴", "2014", characters, "e:1")

    def test_bulletin_images_follow_config(self):
        """公報只寫出設定 images 列出的影像。"""
        archive = self.bulletin()
        document = {
            "id": "bulletin",
            "title": "公報",
            "member": "公報.pdf",
            "images": ["p1-0"],
        }
        # 列出的影像寫成 PNG，代碼加上文件代碼
        with tempfile.TemporaryDirectory() as folder:
            extracted = extract_document(
                archive, "utf-8", document, Path(folder) / "images"
            )
            self.assertEqual(
                [image["id"] for image in extracted["images"]], ["bulletin-p1-0"]
            )
            # 空清單的文件只擷取文字層
            empty = extract_document(
                archive, "utf-8", document | {"images": []}, Path(folder) / "images"
            )
            self.assertEqual(empty["images"], [])
            # 設定寫了不存在的影像時失敗
            with self.assertRaisesRegex(PipelineError, "沒有影像 p1-9"):
                extract_document(
                    archive,
                    "utf-8",
                    document | {"images": ["p1-9"]},
                    Path(folder) / "images",
                )

    def test_bulletin_decodes_indexed_images(self):
        """8 位元的 Indexed 影像依調色盤解出原本的顏色，涵蓋以 DeviceCMYK 與 ICCBased 為底的兩種。"""
        from pypdf.generic import (
            ArrayObject,
            ByteStringObject,
            DecodedStreamObject,
            NameObject,
            NumberObject,
        )

        # 調色盤兩色：索引 0 是白（K=0）、索引 1 是黑（K=255），以字串存放
        palette = ByteStringObject(bytes([0, 0, 0, 0, 0, 0, 0, 255]))
        image = DecodedStreamObject()
        # 兩個像素的索引
        image.set_data(bytes([0, 1]))
        # 兩個像素，左白右黑
        image.update(
            {
                NameObject("/Width"): NumberObject(2),
                NameObject("/Height"): NumberObject(1),
                NameObject("/BitsPerComponent"): NumberObject(8),
                NameObject("/ColorSpace"): ArrayObject(
                    [
                        NameObject("/Indexed"),
                        NameObject("/DeviceCMYK"),
                        NumberObject(1),
                        palette,
                    ]
                ),
            }
        )
        picture = indexed_palette(image)
        self.assertEqual(
            (picture.getpixel((0, 0)), picture.getpixel((1, 0))),
            ((255, 255, 255), (0, 0, 0)),
        )
        # 以 ICCBased 三通道為底的調色盤，索引 0 是黑、索引 1 是白
        profile = DecodedStreamObject()
        profile.update({NameObject("/N"): NumberObject(3)})
        image[NameObject("/ColorSpace")] = ArrayObject(
            [
                NameObject("/Indexed"),
                ArrayObject([NameObject("/ICCBased"), profile]),
                NumberObject(1),
                ByteStringObject(bytes([0, 0, 0, 255, 255, 255])),
            ]
        )
        # 同兩個像素改用三通道的調色盤解碼，左黑右白
        picture = indexed_palette(image)
        self.assertEqual(
            (picture.getpixel((0, 0)), picture.getpixel((1, 0))),
            ((0, 0, 0), (255, 255, 255)),
        )

    def test_bulletin_stores_gray_images(self):
        """三個通道相同的 RGB 影像存成灰階且像素不變，三個通道不全相同時維持 RGB。"""
        gray = Image.new("RGB", (2, 1), (120, 120, 120))
        stored = png_ready(gray)
        # 存成單通道，轉回 RGB 後與原影像相同
        self.assertEqual(
            (stored.mode, stored.convert("RGB").tobytes()), ("L", gray.tobytes())
        )
        # 藍色通道不同，三個通道不全相同
        colored = png_ready(Image.new("RGB", (2, 1), (120, 120, 0)))
        self.assertEqual(colored.mode, "RGB")
