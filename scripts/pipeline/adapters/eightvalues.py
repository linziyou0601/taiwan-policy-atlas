"""8values adapter：讀出 8values 原始碼中的題目、參照意識形態與授權全文。

topics 階段以它核對 data/topics/8values/ 的手寫表，題目原文、各軸權重與參照點位置都要和原始檔一致。

指令：
  由 topics 階段經 adapter 登錄表呼叫 extract_topic，不單獨執行。

慣例：
  - questions.js 與 ideologies.js 是 `變數 = [...];` 形式的 JavaScript，陣列本身是合法的 JSON，取出等號後的陣列再解析，不執行原始檔。
  - 權重為 0 的軸在原始檔也列出，這裡略過，手寫表只寫有作用的軸。
"""

import json
import re

from ..common import PipelineError, relative

# ==================================================
# 集中設定
# ==================================================

# 原始檔的寫法：變數名稱、等號、陣列，結尾的分號可有可無
ASSIGNMENT = r"\s*{name}\s*=\s*(\[.*\])\s*;?\s*"


def read_array(path, name):
    """取出 `name = [...]` 的陣列並解析。

    參數：
        path：原始檔位置。
        name：變數名稱。
    回傳：陣列內容。
    例外：PipelineError，檔案不是預期的寫法，通常是來源改版。
    """
    match = re.fullmatch(
        ASSIGNMENT.format(name=name), path.read_text(encoding="utf-8"), re.S
    )
    # 寫法不同表示來源改版，要重新檢查解析方式
    if match is None:
        raise PipelineError(f"{relative(path)} 不是 `{name} = [...]` 的寫法")
    return json.loads(match.group(1))


def extract_topic(paths):
    """讀出題目、參照點與授權全文。

    參數：
        paths：角色對應原始檔位置，角色是 questions、references、license。
    回傳：`{"questions": [...], "references": [...], "license": 全文}`。題目依原始順序，每題有 original 與 effects（軸代碼對應帶正負號的權重）。參照點有 original 與 position（軸代碼對應位置）。
    """
    questions = [
        {
            "original": item["question"],
            "effects": {axis: value for axis, value in item["effect"].items() if value},
        }
        for item in read_array(paths["questions"], "questions")
    ]
    references = [
        {"original": item["name"], "position": item["stats"]}
        for item in read_array(paths["references"], "ideologies")
    ]
    return {
        "questions": questions,
        "references": references,
        "license": paths["license"].read_text(encoding="utf-8"),
    }
