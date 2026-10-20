"""中選會選舉公報 adapter。

用途：從公報封存檔取出一份 PDF，抽取每頁的文字層，並把嵌入的政見欄影像存成 PNG。公報的政見欄多半是候選人自行排版的影像，文字層只有選務說明，政見原文要從影像轉錄。
指令：由抽取層經 adapter 登錄表呼叫 extract_document，不單獨執行。
慣例：
  - 只寫出寬度達 POLICY_IMAGE_MIN_WIDTH 的影像，候選人相片等小圖不寫出。
  - CMYK、RGBA 與調色盤影像轉成 RGB 後存檔，灰階影像保留灰階，檔案較小。
  - 影像代碼為「文件代碼-p頁碼-嵌入順序」，同一份 PDF 重新執行時代碼相同。
"""

import io

import pypdf

from ..common import PipelineError, sha256_bytes
from .archive import open_members, read_member

# ---- 集中設定 ----

# 政見欄影像的最小寬度（像素）。2024 總統公報的政見欄寬 2126 像素、相片寬 409 至 505 像素，門檻取在兩者之間
POLICY_IMAGE_MIN_WIDTH = 1500

# 文字層的 CJK 字數達到這個值才視為有可用文字，低於時這一頁標記為需要從影像轉錄
MIN_CJK_CHARACTERS = 80

# 存檔前要轉成 RGB 的色彩模式，PNG 不支援 CMYK
CONVERT_TO_RGB = {"CMYK", "RGBA", "P"}


def cjk_count(text):
    """計算 CJK 統一表意文字的字數。

    參數：
        text：文字。
    回傳：U+4E00 至 U+9FFF 範圍內的字元數。
    """
    return sum(1 for char in text if "一" <= char <= "鿿")


def extract_document(archive_path, encoding, document, image_dir):
    """抽取一份公報。

    參數：
        archive_path：公報封存檔的位置。
        encoding：封存檔的檔名編碼。
        document：選舉設定 documents 的一筆，取 id、title、member。
        image_dir：政見影像的輸出目錄，不存在時建立。
    回傳：{"id", "title", "member", "content_sha256", "pages", "images"}。pages 每頁記文字、CJK 字數與文字狀態，images 每張記代碼、頁碼、寬高與檔名。
    例外：PipelineError，成員不存在或 PDF 無法解析。
    """
    archive, members = open_members(archive_path, encoding)
    data = read_member(archive, members, document["member"])
    # PDF 在記憶體中解析，不寫出暫存檔
    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
    # 損毀的 PDF 沒有可抽的頁面，寫出成員路徑方便比對來源
    except pypdf.errors.PdfReadError as error:
        raise PipelineError(f"{document['member']} 無法解析：{error}") from error
    # 每頁記一筆文字，政見影像另外寫檔
    image_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    images = []
    # 頁碼從 1 起算，與 PDF 閱讀器顯示的頁碼一致
    for number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        count = cjk_count(text)
        # 文字層字數不足的頁面，政見要從影像轉錄
        status = "text-layer" if count >= MIN_CJK_CHARACTERS else "needs-transcription"
        pages.append(
            {
                "page": number,
                "text": text,
                "cjk_characters": count,
                "text_status": status,
            }
        )
        # 每頁的嵌入影像依 PDF 內的順序編號
        for index, embedded in enumerate(page.images):
            picture = embedded.image
            # 寬度不足的區塊是相片或標誌，政見欄都比這個寬度寬
            if picture.size[0] < POLICY_IMAGE_MIN_WIDTH:
                continue
            # 影像代碼由文件、頁碼與嵌入順序組成，重新執行時相同
            image_id = f"{document['id']}-p{number}-{index}"
            path = image_dir / f"{image_id}.png"
            # PNG 不支援的色彩模式先轉成 RGB，灰階保留原樣
            converted = (
                picture.convert("RGB") if picture.mode in CONVERT_TO_RGB else picture
            )
            converted.save(path, optimize=True)
            images.append(
                {
                    "id": image_id,
                    "page": number,
                    "width": picture.size[0],
                    "height": picture.size[1],
                    "file": path.name,
                }
            )
    return {
        "id": document["id"],
        "title": document["title"],
        "member": document["member"],
        "content_sha256": sha256_bytes(data),
        "pages": pages,
        "images": images,
    }
