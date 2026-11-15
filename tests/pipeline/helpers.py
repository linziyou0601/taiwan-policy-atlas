"""管線測試共用的資料與輔助函式。

讀取 2024 總統各階段已提交的產物與手寫表，讓各階段的核對函式以真實的資料測試。另有組出手寫表的列的函式，以及把資料目錄換成暫存目錄的測試基底。

指令：
  由 tests/pipeline 的測試匯入，`npm test` 執行。

慣例：
  - 要變造的資料在記憶體中複製後修改。
  - ELECTION 是已提交資料的選舉，DRAFT_ELECTION 是暫存目錄裡測試寫入用的選舉。
"""

from pathlib import Path
from unittest import mock
import tempfile
import unittest

from pipeline import common
from pipeline.claims.run import CLAIM_HEADER
from pipeline.common import layer_dir, load_product
from pipeline.match.run import MAPPING_HEADER, QUESTION_HEADER
from pipeline.tables import read_table, write_table

# ==================================================
# 集中設定
# ==================================================

# 端對端測試使用的選舉
ELECTION = "2024-president"

# ==================================================
# 讀取
# ==================================================


def upstream(layer):
    """讀取一層的產物與轉交內容。

    參數：
        layer：層的代碼，例如 "claims"。
    回傳：load_product 合併後的 dict。
    """
    merged, _ = load_product(layer, ELECTION)
    return merged


def authored(layer, name, header):
    """讀取一層的手寫表。

    參數：
        layer：層的代碼。
        name：檔名，例如 "mappings.tsv"。
        header：表頭。
    回傳：read_table 的結果。
    """
    return read_table(layer_dir(layer, ELECTION) / name, header)


# 測試用的選舉代碼
DRAFT_ELECTION = "test-election"


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
        # 管線的各階段目錄都從 DATA_DIR 推得，換掉它就不會寫入 repo
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
        path = common.layer_dir(layer, DRAFT_ELECTION) / name
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
        return read_table(common.layer_dir(layer, DRAFT_ELECTION) / name, header)


# 直接執行本檔時執行全部測試
if __name__ == "__main__":
    unittest.main()
