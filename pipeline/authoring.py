"""編碼輔助：依原文欄填入主張的起訖位置。

用途：政見編碼 skill 拆主張時只寫原文，起訖由本模組在段落中找出原文的位置後寫回 claims.tsv，避免人工計算字元位置時出錯。主張層仍逐字核對起訖。
指令：`python -m pipeline fill-offsets --election <代碼>`
慣例：原文要在段落中只出現一次，出現零次或多次時列出代碼並停止，由編碼者把原文改成可唯一定位的一段。已填的起訖若與原文相符則保留。
"""

from .claims import CLAIM_HEADER
from .common import PipelineError, layer_dir, load_product
from .tables import read_table

# ---- 集中設定 ----

# 起訖兩欄的欄名
START, END = "原文起", "原文迄"


def locate(text, quote, where):
    """找出原文在段落中的唯一位置。

    參數：
        text：段落文字。
        quote：原文。
        where：錯誤訊息中的位置。
    回傳：`(起, 迄)`，以碼位計，迄不含。
    例外：PipelineError，原文不在段落內或出現不只一次。
    """
    first = text.find(quote)
    # 找不到時通常是轉錄稿與原文欄的用字不同
    if first < 0:
        raise PipelineError(f"{where} 的原文不在段落中：「{quote}」")
    # 出現兩次以上時無法決定是哪一處
    if text.find(quote, first + 1) >= 0:
        raise PipelineError(
            f"{where} 的原文在段落中出現不只一次，加長原文到可以唯一定位"
        )
    return first, first + len(quote)


def fill_offsets(election_id):
    """填寫 claims.tsv 的起訖欄並寫回。

    參數：
        election_id：選舉代碼。
    回傳：摘要字串。
    例外：PipelineError，claims.tsv 不存在、段落不存在或原文無法唯一定位。
    """
    upstream, _ = load_product("extract", election_id)
    passages = {passage["id"]: passage["text"] for passage in upstream["passages"]}
    path = layer_dir("claims", election_id) / "claims.tsv"
    # 沒有主張表時沒有可填的欄
    if not path.exists():
        raise PipelineError(f"找不到 {path.name}，先寫主張表")
    rows = read_table(path, CLAIM_HEADER)
    # 記錄改了幾列，摘要回報給編碼者
    changed = 0
    # 逐列找出原文的位置，與已填的值不同時更新
    for row in rows:
        where = f"claims.tsv 的 {row['代碼']}"
        # 段落要在抽取層的產物中
        if row["段落"] not in passages:
            raise PipelineError(f"{where} 的段落 {row['段落']} 不在 extract.json")
        start, end = locate(passages[row["段落"]], row["原文"], where)
        # 只計算改動過的列，摘要才反映這次填了幾筆
        if row[START] != str(start) or row[END] != str(end):
            row[START], row[END] = str(start), str(end)
            changed += 1
    # 依原表頭與原列序寫回，read_table 已保證每格有值
    lines = ["\t".join(CLAIM_HEADER)] + [
        "\t".join(row[column] for column in CLAIM_HEADER) for row in rows
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"fill-offsets {election_id}: {changed} 列更新，共 {len(rows)} 列"
