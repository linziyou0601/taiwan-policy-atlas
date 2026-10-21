"""陸委會例行民調 adapter：從政府資料開放平臺的民調 CSV 取出一題最新一期的選項比例。

主題測驗的對照資料。CSV 每列是一期民調的一題，題目欄只記錄問法的開頭，各選項的比例記錄在以選項命名的欄位。

指令：
  由 topic 指令呼叫，不單獨執行。

慣例：
  - 依設定的 match 找出題目以它開頭的列，取調查起始日期最晚的一期。
  - 比例欄寫 0 到 1 的小數，沒有這一題的欄寫 -。選到的列在設定的欄位都要有數字。
  - 檔案是 UTF-8 加 BOM，以 utf-8-sig 讀入。
"""

import csv
import io

from ..common import PipelineError, relative

# ==================================================
# 集中設定
# ==================================================

# 產物沿用的欄位：調查名稱與調查日期
LABEL_COLUMN = "調查名稱"
DATE_COLUMN = "調查日期"

# 產物沿用的欄位：樣本數與執行單位
SAMPLE_COLUMN = "樣本數"
CONDUCTOR_COLUMN = "調查單位"

# 題目與排序用的欄位
QUESTION_COLUMN = "題目"
START_COLUMN = "起始日期"


def share(row, column, where):
    """讀出一欄的比例。

    參數：
        row：CSV 的一列。
        column：欄名。
        where：錯誤訊息中的位置。
    回傳：0 到 1 的小數。
    例外：PipelineError，欄位不存在或不是數字。
    """
    # 欄位要存在且寫了數字
    try:
        return float(row[column])
    # 缺欄或寫 - 都表示這一期沒有這個選項的比例
    except (KeyError, ValueError) as error:
        raise PipelineError(f"{where} 的欄位 {column} 沒有比例") from error


def extract_comparison(path, spec):
    """取出一題最新一期的選項比例。

    參數：
        path：CSV 位置。
        spec：主題測驗設定的一筆 comparisons，含 match（題目開頭）、options（選項代碼對應欄名）與 none（無反應的欄名）。
    回傳：`{"question", "label", "date", "sample", "conductor", "shares", "none"}`，shares 是選項代碼對應比例。
    例外：PipelineError，找不到符合的題目，或選到的列缺比例。
    """
    rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
    # 同一題在各期的列，以題目開頭辨認
    matched = [row for row in rows if row[QUESTION_COLUMN].startswith(spec["match"])]
    # 沒有符合的題目表示 match 寫錯或來源改版
    if not matched:
        raise PipelineError(f"{relative(path)} 沒有以「{spec['match']}」開頭的題目")
    # 起始日期寫成 YYYYMMDD，字串比較即日期先後
    latest = max(matched, key=lambda row: row[START_COLUMN])
    where = f"{relative(path)} 的「{latest[LABEL_COLUMN]}」"
    return {
        "question": latest[QUESTION_COLUMN],
        "label": latest[LABEL_COLUMN],
        "date": latest[DATE_COLUMN],
        "sample": int(latest[SAMPLE_COLUMN]),
        "conductor": latest[CONDUCTOR_COLUMN],
        "shares": {
            code: share(latest, column, where)
            for code, column in spec["options"].items()
        },
        "none": share(latest, spec["none"], where),
    }
