"""Python 測試共用的資料載入。

讀取 2024 總統各層已提交的產物與手寫表，讓各層的核對函式以真實資料測試，再以修改過的副本測試錯誤情形。

指令：
  由 tests/python 的測試匯入，python -m unittest discover -s tests/python 執行。

慣例：
  - 需要變造的資料在記憶體中複製後修改。
"""

import sys
from pathlib import Path

# ==================================================
# 路徑
# ==================================================

# 專案根目錄：本檔位於 tests/python/ 之下，往上兩層
ROOT = Path(__file__).resolve().parents[2]

# 讓測試以 `import pipeline` 匯入專案的管線套件
sys.path.insert(0, str(ROOT))

# 端對端測試使用的選舉
ELECTION = "2024-president"

# ==================================================
# 讀取
# ==================================================

from pipeline.common import layer_dir, load_product  # noqa: E402
from pipeline.tables import read_table  # noqa: E402


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
