"""文字型來源的 adapter：官網與粉專快照、立法院開放資料、自訂來源。

用途：把網頁快照、立法院開放資料的 JSON 與維護者放在 repo 內的文字檔，抽成與公報相同形狀的文件，主張層以同一種方式引用。
指令：由抽取層經 adapter 登錄表呼叫各 extract 函式，不單獨執行。
慣例：
  - 網頁快照與立法院的原始 JSON 存在 .cache/sources/，抽取產物只保留文字與 sha256，原始檔依 manifest 重新取得。
  - 立法院資料的欄位對應寫在 sources.yaml 的 fields，程式不寫死欄名，資料集改版時只改設定。
  - 文件的形狀與 cec_bulletin.extract_document 相同，images 為空串列。
"""

import json
from html.parser import HTMLParser

from ..common import ROOT, PipelineError, sha256_text

# ---- 網頁快照 ----

# 抽取文字時連同內容一起略過的標籤，這些標籤的文字不是頁面上的可見內容
SKIPPED_TAGS = {"script", "style", "noscript", "template"}

# 視為段落邊界的標籤，遇到時換行，讓段落在文字中分行
BLOCK_TAGS = {
    "p",
    "div",
    "li",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "section",
    "article",
}


class TextCollector(HTMLParser):
    """收集網頁的可見文字，區塊標籤之間換行。"""

    def __init__(self):
        """建立收集器，skip 記錄目前位於幾層略過的標籤之內。"""
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        """遇到開始標籤：略過的標籤加一層，區塊標籤換行。

        參數：
            tag：標籤名稱。
            attrs：屬性，不使用。
        """
        # 略過的標籤可能巢狀，逐層計數
        if tag in SKIPPED_TAGS:
            self.skip += 1
        # 區塊標籤是段落的開始
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        """遇到結束標籤：離開一層略過的標籤。

        參數：
            tag：標籤名稱。
        """
        # 計數為 0 時是不成對的結束標籤，不再遞減
        if tag in SKIPPED_TAGS and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        """收集 HTML 的文字片段，位於略過的標籤之內時不收集。

        參數：
            data：文字內容。
        """
        # 腳本與樣式的內容不是可見文字
        if not self.skip:
            self.parts.append(data)

    def text(self):
        """回傳收集到的文字。

        回傳：移除每行前後空白並刪除空行，每段一行。
        """
        lines = "".join(self.parts).split("\n")
        # 只留移除空白後仍有內容的行
        return "\n".join(line.strip() for line in lines if line.strip())


def single_page(document, text, member, digest):
    """組成只有一頁、沒有影像的文件。

    參數：
        document：選舉設定 documents 的一筆。
        text：整份文字。
        member：來源位置，網址或 repo 內的路徑。
        digest：原始內容的 sha256。
    回傳：與 cec_bulletin.extract_document 相同形狀的 dict。
    """
    return {
        "id": document["id"],
        "title": document["title"],
        "member": member,
        "content_sha256": digest,
        "pages": [
            {
                "page": 1,
                "text": text,
                "cjk_characters": len(text),
                "text_status": "text-layer",
            }
        ],
        "images": [],
    }


def extract_web_snapshot(path, document):
    """把一份網頁快照抽成文件。

    參數：
        path：.cache/sources/ 內的 HTML 快照。
        document：選舉設定 documents 的一筆，可選 encoding，預設 UTF-8。
    回傳：整頁為一頁的文件。
    """
    html = path.read_text(encoding=document.get("encoding", "utf-8"), errors="replace")
    collector = TextCollector()
    collector.feed(html)
    return single_page(
        document, collector.text(), document.get("url", ""), sha256_text(html)
    )


# ---- 立法院開放資料 ----

# 立法院來源在 fields 必須登錄的欄位對應：紀錄陣列的路徑、委員姓名、內容與紀錄代碼
LEGISLATURE_FIELDS = {"records", "legislator", "text", "id"}


def extract_legislature(path, document, source):
    """把立法院開放資料的 JSON 抽成文件，每筆紀錄一頁。

    參數：
        path：.cache/sources/ 內的 JSON。
        document：選舉設定 documents 的一筆，legislator 寫要收的委員姓名。來源規則只收該屆在任者本人的提案、質詢與表決。
        source：來源登錄，fields 寫欄位對應，records 是以點分隔的路徑，指到紀錄陣列，空字串表示根即陣列。
    回傳：每筆符合的紀錄一頁，頁上記紀錄代碼。
    例外：PipelineError，fields 缺少 LEGISLATURE_FIELDS 中的欄位。
    """
    fields = source.get("fields") or {}
    # 欄位對應不全時無法判讀紀錄
    if not LEGISLATURE_FIELDS <= set(fields):
        raise PipelineError(
            f"來源 {source['id']} 要在 fields 登錄 {'、'.join(sorted(LEGISLATURE_FIELDS))}"
        )
    # 原始文字留著算 sha256，解析後取紀錄
    raw = path.read_text(encoding="utf-8")
    records = json.loads(raw)
    # 沿路徑逐層取出紀錄陣列，路徑的空段略過
    for key in [part for part in fields["records"].split(".") if part]:
        records = records[key]
    pages = []
    # 每筆符合的紀錄一頁
    for record in records:
        # 只收這份文件指定的委員本人的紀錄
        if record.get(fields["legislator"]) != document["legislator"]:
            continue
        # 頁上記紀錄代碼，主張可以追溯到立法院的那一筆
        text = str(record.get(fields["text"], "")).strip()
        pages.append(
            {
                "page": len(pages) + 1,
                "record": str(record.get(fields["id"])),
                "text": text,
                "cjk_characters": len(text),
                "text_status": "text-layer",
            }
        )
    return {
        "id": document["id"],
        "title": document["title"],
        "member": source["url"],
        "content_sha256": sha256_text(raw),
        "pages": pages,
        "images": [],
    }


# ---- 自訂來源 ----


def extract_custom(document):
    """讀取維護者放在 repo 內的文字檔。

    參數：
        document：選舉設定 documents 的一筆，path 為相對於專案根目錄的路徑。
    回傳：整份為一頁的文件。
    例外：PipelineError，檔案不存在。自訂來源要放在 repo 內，其他人才能重新執行同樣的結果。
    """
    path = ROOT / document["path"]
    # 檔案缺席時無法重現
    if not path.exists():
        raise PipelineError(f"找不到自訂來源 {document['path']}")
    text = path.read_text(encoding="utf-8")
    return single_page(document, text, document["path"], sha256_text(text))
