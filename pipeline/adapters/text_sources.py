"""文字型來源的 adapter：官網與粉專快照、自訂來源。

把網頁快照與維護者放置在 repo 內的文字檔，抽取為與公報相同形狀的文件，主張層以同一種方式引用。

指令：
  由抽取層經 adapter 登錄表呼叫各 extract 函式，不單獨執行。

慣例：
  - 網頁快照的原始 HTML 儲存在 .cache/sources/，抽取產物只保留文字與 sha256，原始檔依 manifest 重新取得。
  - 文件的形狀與 cec_bulletin.extract_document 相同，images 為空串列。
"""

from html.parser import HTMLParser

from ..common import ROOT, require, sha256_text
from .cec_bulletin import document_record, page_record

# ==================================================
# 網頁快照
# ==================================================

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
    回傳：document_record 的形狀。
    """
    return document_record(
        document, member, digest, [page_record(1, text, "text-layer")], []
    )


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


# ==================================================
# 自訂來源
# ==================================================


def extract_custom(document):
    """讀取維護者放在 repo 內的文字檔。

    參數：
        document：選舉設定 documents 的一筆，path 為相對於專案根目錄的路徑。
    回傳：整份為一頁的文件。
    例外：PipelineError，檔案不存在。自訂來源要放在 repo 內，其他人才能重新執行同樣的結果。
    """
    # 檔案缺席時無法重現
    text = require(ROOT / document["path"], label="自訂來源").read_text(
        encoding="utf-8"
    )
    return single_page(document, text, document["path"], sha256_text(text))
