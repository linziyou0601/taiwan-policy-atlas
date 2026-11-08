"""中選會選舉公報 adapter。

從公報封存檔或網站目錄的快取讀取一份 PDF，抽取每頁的文字層，並把選舉設定列出的政見欄影像儲存為 PNG。候選人的政見有的在文字層，有的是自行排版的影像，影像的政見要從影像轉錄。

指令：
  由抽取層經 adapter 登錄表呼叫 extract_document，不單獨執行。

慣例：
  - 寫出的影像由選舉設定 documents 每筆的 images 列出，代碼是「p頁碼-嵌入順序」。
  - CMYK、RGBA 與調色盤影像轉換為 RGB 後儲存，灰階影像保留灰階，檔案較小。
  - 8 位元的 Indexed 影像由調色盤自行解碼，pypdf 會把部分這類影像解成全黑。
  - 影像代碼為「文件代碼-p頁碼-嵌入順序」，同一份 PDF 重新執行時代碼相同。
"""

import io

import pypdf
from PIL import Image

from ..common import PipelineError, require, sha256_bytes
from .archive import open_members, read_member

# ==================================================
# 集中設定
# ==================================================

# 文字層的 CJK 字數達到這個值才視為有可用文字，低於時這一頁標記為需要從影像轉錄
MIN_CJK_CHARACTERS = 80

# pypdf 解析與解壓的上限。部分公報以向量外框繪製文字，內容串流超過預設的 200 萬個單元與 75 MB
PDF_LIMITS = {
    "stream_parsing_work_maximum_count": 50_000_000,
    "zlib_maximum_output_length": 300_000_000,
}

# Indexed 影像底層色彩空間的通道數，ICCBased 另讀描述檔的 /N
BASE_CHANNELS = {"/DeviceGray": 1, "/DeviceRGB": 3, "/DeviceCMYK": 4}

# 通道數對應的 PIL 色彩模式
MODES = {1: "L", 3: "RGB", 4: "CMYK"}

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


def read_pdf(path, encoding, document):
    """從封存檔或網站目錄的快取讀取一份公報 PDF。

    參數：
        path：公報封存檔的位置，或網站目錄來源的快取目錄。
        encoding：封存檔的檔名編碼。
        document：選舉設定 documents 的一筆，使用 member。
    回傳：`(PDF 位元組, pypdf.PdfReader)`。
    例外：PipelineError，成員不存在或 PDF 無法解析。
    """
    # 網站目錄的文件是快取目錄下的單一檔案，抓取層已核對 sha256
    if path.is_dir():
        data = require(path / document["member"], "先執行 fetch").read_bytes()
    # 封存檔的文件是其中一個成員
    else:
        archive, members = open_members(path, encoding)
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


def indexed_palette(image):
    """以調色盤解碼 8 位元的 Indexed 影像。

    pypdf 會把以 DeviceCMYK 或 ICCBased 為底的部分 Indexed 影像解成全黑，本函式以索引查調色盤，拆成各通道再合成。
    參數：
        image：影像 XObject。
    回傳：8 位元 Indexed 影像回傳解碼後的 RGB 或灰階 PIL 影像，其他影像回傳 None。
    """
    space = image.get("/ColorSpace")
    # 色彩空間可能是間接參照，有值時先取出物件
    space = space.get_object() if space is not None else None
    # 只處理每個索引 8 位元的 Indexed 色彩空間
    if not (
        isinstance(space, list)
        and len(space) == 4
        and space[0] == "/Indexed"
        and image.get("/BitsPerComponent") == 8
    ):
        return None
    base = space[1].get_object()
    # ICCBased 的通道數寫在描述檔的 /N，其餘依色彩空間名稱
    count = (
        base[1].get_object().get("/N")
        if isinstance(base, list) and base[0] == "/ICCBased"
        else BASE_CHANNELS.get(base)
    )
    # 不是灰階、RGB 或 CMYK 的底層交給 pypdf
    if count not in MODES:
        return None
    lookup = space[3].get_object()
    # 調色盤可能存成串流或字串，字串取原始位元組
    palette = (
        lookup.get_data() if hasattr(lookup, "get_data") else lookup.original_bytes
    )
    size = (image["/Width"], image["/Height"])
    indices = Image.frombytes("L", size, image.get_data()[: size[0] * size[1]])
    # 每個通道以索引查調色盤的對應位元組，再依通道數合成
    channels = [
        indices.point(
            [
                palette[i * count + c] if i * count + c < len(palette) else 0
                for i in range(256)
            ]
        )
        for c in range(count)
    ]
    merged = Image.merge(MODES[count], channels)
    # PNG 不支援 CMYK，CMYK 轉成 RGB 後回傳
    return merged.convert("RGB") if MODES[count] == "CMYK" else merged


def extract_document(path, encoding, document, image_dir):
    """抽取一份公報。

    參數：
        path：公報封存檔的位置，或網站目錄來源的快取目錄。
        encoding：封存檔的檔名編碼。
        document：選舉設定 documents 的一筆，使用 id、title、member 與 images。
        image_dir：政見影像的輸出目錄，不存在時建立。
    回傳：{"id", "title", "member", "content_sha256", "pages", "images"}。pages 每頁記錄文字、CJK 字數與文字狀態，images 每張記錄代碼、頁碼、寬高與檔名。
    例外：PipelineError，成員不存在、PDF 無法解析，或 images 列出的影像不在 PDF 中。
    """
    # 向量外框文字的頁面內容串流很長，放寬解析上限才讀得完，PDF 已在抓取層核對 sha256
    with pypdf.apply_configuration(**PDF_LIMITS):
        data, reader = read_pdf(path, encoding, document)
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
                page_record(
                    number, text, "text-layer" if enough else "needs-transcription"
                )
            )
            # 每頁的嵌入影像依 PDF 內的順序編號
            for index, embedded in enumerate(page.images):
                code = image_code(number, index)
                # 只解碼並寫出設定列出的政見欄影像
                if code not in wanted:
                    continue
                # 找到的代碼從待找清單移除
                wanted.discard(code)
                reference = embedded.indirect_reference
                # 有物件參照時先試 Indexed 影像的解碼，其餘交給 pypdf
                decoded = indexed_palette(reference.get_object()) if reference else None
                picture = decoded or embedded.image
                # 影像代碼由文件、頁碼與嵌入順序組成，重新執行時相同
                image_id = f"{document['id']}-{code}"
                image_path = image_dir / f"{image_id}.png"
                png_ready(picture).save(image_path, optimize=True)
                # 產物記錄影像的頁碼、原始寬高與檔名
                images.append(
                    {
                        "id": image_id,
                        "page": number,
                        "width": picture.size[0],
                        "height": picture.size[1],
                        "file": image_path.name,
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
