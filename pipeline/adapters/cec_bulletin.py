"""中選會選舉公報 adapter。

從公報封存檔讀取一份 PDF，抽取每頁的文字層，並把選舉設定列出的政見欄影像儲存為 PNG。候選人的政見有的在文字層，有的是自行排版的影像，影像的政見要從影像轉錄。

指令：
  由抽取層經 adapter 登錄表呼叫 extract_document，不單獨執行。

慣例：
  - 寫出的影像由選舉設定 documents 每筆的 images 列出，代碼是「p頁碼-嵌入順序」。
  - CMYK、RGBA 與調色盤影像轉換為 RGB 後儲存，灰階影像保留灰階，檔案較小。
  - 影像代碼為「文件代碼-p頁碼-嵌入順序」，同一份 PDF 重新執行時代碼相同。
"""

import io

import pypdf

from ..common import PipelineError, sha256_bytes
from .archive import open_members, read_member

# ==================================================
# 集中設定
# ==================================================

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


def image_code(page, index):
    """嵌入影像的代碼，選舉設定的 images 寫這個代碼。

    參數：
        page：頁碼，從 1 起算。
        index：影像在這一頁的嵌入順序，從 0 起算。
    回傳：「p頁碼-嵌入順序」。
    """
    return f"p{page}-{index}"


def page_record(number, text, status):
    """文件一頁的紀錄。

    參數：
        number：頁碼。
        text：這一頁的文字。
        status：文字狀態，text-layer 或 needs-transcription。
    回傳：dict，含 CJK 字數。
    """
    return {
        "page": number,
        "text": text,
        "cjk_characters": cjk_count(text),
        "text_status": status,
    }


def document_record(document, member, digest, pages, images):
    """抽取產物中一份文件的形狀。

    參數：
        document：選舉設定 documents 的一筆，使用 id 與 title。
        member：來源位置，封存檔內的成員、網址或 repo 內的路徑。
        digest：原始內容的 sha256。
        pages：page_record 的串列。
        images：政見影像的紀錄。
    回傳：{"id", "title", "member", "content_sha256", "pages", "images"}。
    """
    return {
        "id": document["id"],
        "title": document["title"],
        "member": member,
        "content_sha256": digest,
        "pages": pages,
        "images": images,
    }


def read_pdf(archive_path, encoding, document):
    """從封存檔讀取一份公報 PDF。

    參數：
        archive_path：公報封存檔的位置。
        encoding：封存檔的檔名編碼。
        document：選舉設定 documents 的一筆，使用 member。
    回傳：`(PDF 位元組, pypdf.PdfReader)`。
    例外：PipelineError，成員不存在或 PDF 無法解析。
    """
    archive, members = open_members(archive_path, encoding)
    data = read_member(archive, members, document["member"])
    # PDF 在記憶體中解析，不寫出暫存檔
    try:
        return data, pypdf.PdfReader(io.BytesIO(data))
    # 損毀的 PDF 沒有可抽的頁面，寫出成員路徑方便比對來源
    except pypdf.errors.PdfReadError as error:
        raise PipelineError(f"{document['member']} 無法解析：{error}") from error


def png_ready(picture):
    """把嵌入影像轉換為 PNG 可儲存的色彩模式。

    參數：
        picture：PIL 影像。
    回傳：CMYK、RGBA 與調色盤影像轉換為 RGB，其餘原樣回傳，灰階保留灰階。
    """
    return picture.convert("RGB") if picture.mode in CONVERT_TO_RGB else picture


def extract_document(archive_path, encoding, document, image_dir):
    """抽取一份公報。

    參數：
        archive_path：公報封存檔的位置。
        encoding：封存檔的檔名編碼。
        document：選舉設定 documents 的一筆，使用 id、title、member 與 images。
        image_dir：政見影像的輸出目錄，不存在時建立。
    回傳：{"id", "title", "member", "content_sha256", "pages", "images"}。pages 每頁記錄文字、CJK 字數與文字狀態，images 每張記錄代碼、頁碼、寬高與檔名。
    例外：PipelineError，成員不存在、PDF 無法解析，或 images 列出的影像不在 PDF 中。
    """
    data, reader = read_pdf(archive_path, encoding, document)
    image_dir.mkdir(parents=True, exist_ok=True)
    # 還沒找到的影像代碼，處理完全部頁面後應該清空
    wanted = set(document["images"])
    # 每頁記錄一筆文字，設定列出的政見影像另外寫入檔案
    pages = []
    images = []
    # 頁碼從 1 起算，與 PDF 閱讀器顯示的頁碼一致
    for number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        # 文字層字數不足的頁面，政見要從影像轉錄
        enough = cjk_count(text) >= MIN_CJK_CHARACTERS
        # 字數足夠的頁面標為文字層，其餘標為需要轉錄
        pages.append(
            page_record(number, text, "text-layer" if enough else "needs-transcription")
        )
        # 每頁的嵌入影像依 PDF 內的順序編號
        for index, embedded in enumerate(page.images):
            code = image_code(number, index)
            # 只解碼並寫出設定列出的政見欄影像
            if code not in wanted:
                continue
            # 找到的代碼從待找清單移除
            wanted.discard(code)
            picture = embedded.image
            # 影像代碼由文件、頁碼與嵌入順序組成，重新執行時相同
            image_id = f"{document['id']}-{code}"
            path = image_dir / f"{image_id}.png"
            png_ready(picture).save(path, optimize=True)
            # 產物記錄影像的頁碼、原始寬高與檔名
            images.append(
                {
                    "id": image_id,
                    "page": number,
                    "width": picture.size[0],
                    "height": picture.size[1],
                    "file": path.name,
                }
            )
    # 設定列出卻沒有找到的影像表示頁碼或順序填寫錯誤
    if wanted:
        raise PipelineError(
            f"{document['member']} 沒有影像 {'、'.join(sorted(wanted))}"
        )
    return document_record(
        document, document["member"], sha256_bytes(data), pages, images
    )
