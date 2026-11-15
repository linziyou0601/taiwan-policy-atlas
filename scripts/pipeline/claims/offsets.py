"""主張階段的工具：依原文欄填入主張的起訖位置。

拆分主張時只填寫原文，起訖由本工具在段落中找出原文的位置後寫入主張表，`claims run` 仍逐字核對起訖。步驟見 docs/pipeline/claims.md。

指令：
  `npm run pipeline -- claims offsets --election <代碼>`

手寫輸入：
  data/30-claims/{選舉代碼}/claims.tsv 的原文欄

產物：
  填好原文起與原文迄的 claims.tsv

慣例：
  - 已填寫的起訖切出的正是原文時保留。原文在段落中出現多次時，由編碼者填寫要使用的位置。
  - 起訖沒有填寫或與原文不符時，原文要在段落中只出現一次，出現零次或多次時列出代碼並停止。
"""

from ..common import PipelineError, election_argument, layer_dir, load_product, require
from ..tables import EMPTY, by_code, read_table, write_table
from .run import CLAIM_HEADER, passage_of

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "依原文欄填入主張的起訖位置"

# 起訖兩欄的欄名
START, END = "原文起", "原文迄"


def locate(text, quote, where, start=EMPTY, end=EMPTY):
    """找出原文在段落中的位置。

    參數：
        text：段落文字。
        quote：原文。
        where：錯誤訊息中的位置。
        start、end：claims.tsv 已填寫的起訖，未填寫時是 -。
    回傳：`(起, 迄)`，以碼位計，迄不含。
    例外：PipelineError，已填寫的起訖擷取不到原文，而原文不在段落內或出現不只一次。
    """
    # 已填寫的起訖擷取出的正是原文時沿用，原文出現多次時由編碼者指定位置
    if start.isdigit() and end.isdigit() and text[int(start) : int(end)] == quote:
        return int(start), int(end)
    first = text.find(quote)
    # 找不到時通常是轉錄稿與原文欄的用字不同
    if first < 0:
        raise PipelineError(f"{where} 的原文不在段落中：「{quote}」")
    # 出現兩次以上時無法決定是哪一處
    if text.find(quote, first + 1) >= 0:
        raise PipelineError(
            f"{where} 的原文在段落中出現不只一次，加長原文直到能唯一定位"
        )
    return first, first + len(quote)


def fill_offsets(election_id):
    """填寫 claims.tsv 的起訖欄並寫入檔案。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，claims.tsv 不存在、段落不存在或原文無法唯一定位。
    """
    upstream, _ = load_product("extract", election_id)
    passages = by_code(upstream["passages"], "id")
    # 沒有主張表時沒有可填寫的欄
    path = require(layer_dir("claims", election_id) / "claims.tsv", "先撰寫主張表")
    rows = read_table(path, CLAIM_HEADER)
    # 記錄更新的列數，摘要回報給編碼者
    changed = 0
    # 逐列找出原文的位置，與已填的值不同時更新
    for row in rows:
        where = f"claims.tsv 的 {row['代碼']}"
        # 段落要在抽取階段的產物中
        text = passage_of(row, passages, where)["text"]
        start, end = locate(text, row["原文"], where, row[START], row[END])
        # 只計算改動過的列，摘要才反映這次填寫的筆數
        if row[START] != str(start) or row[END] != str(end):
            row[START], row[END] = str(start), str(end)
            changed += 1
    # 依原表頭與原列序寫入，read_table 已保證每格有值
    write_table(path, CLAIM_HEADER, rows)
    return f"offsets {election_id}: {changed} 列更新，共 {len(rows)} 列"


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return fill_offsets(args.election)
