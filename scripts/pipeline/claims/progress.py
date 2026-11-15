"""主張階段的工具：列出各群組已轉錄與有主張的人數，用來排編碼的批次。

依選區代碼的前幾段把名冊分組，數出每組名冊上的人數、已轉錄的人數與有主張的人數，並合計還沒有主張的人的轉錄稿字數。字數是編碼工作量的估計，依它把選區分成大小相近的批次。步驟見 docs/pipeline/claims.md。

指令：
  `npm run pipeline -- claims progress --election <代碼> [--segments <段數>]`
  先執行 `extract run` 匯入名冊。

手寫輸入：
  data/20-extract/{選舉代碼}/transcripts.tsv、transcripts/ 與 data/30-claims/{選舉代碼}/claims.tsv

產物：
  標準輸出的 TSV，列依群組代碼排序

慣例：
  - 群組是選區代碼依「-」分段後的前幾段，`--segments` 預設 3，即省市、縣市、鄉鎮。段數超過選區代碼的段數時，每個選區自成一組。
  - 已轉錄是段落表有段落的參選者，有主張是主張表有列的參選者。編碼後沒有可建立主張的人也算在沒有主張的人數，排批次之前對照編碼紀錄。
  - 字數是這些人轉錄稿的字元數合計，以 Unicode 碼位計，檔尾的換行略過。
"""

import argparse

from ..common import ROSTER_FILE, election_argument, layer_dir, read_json
from ..extract.run import TRANSCRIPT_HEADER
from ..tables import read_optional
from .run import CLAIM_HEADER

# ==================================================
# 集中設定
# ==================================================

# `--help` 顯示的一句說明
SUMMARY = "列出各群組已轉錄、有主張的人數與字數，用來排編碼的批次"

# 輸出的表頭
PROGRESS_HEADER = ["群組", "名冊人數", "已轉錄", "有主張", "沒有主張", "沒有主張的字數"]

# 分組取選區代碼的前幾段，3 段是省市、縣市、鄉鎮
DEFAULT_SEGMENTS = 3

# 選區代碼各段的分隔字元
SEGMENT_SEPARATOR = "-"


def segment_count(text):
    """解析 `--segments` 的值。

    參數：
        text：命令列寫的值。
    回傳：正整數。
    例外：argparse.ArgumentTypeError，值要是正整數，其餘的值由 argparse 以結束代碼 2 回報。
    """
    # 段數至少取一段，0 段會把全部選區併成沒有名稱的一組
    if not text.isdigit() or int(text) < 1:
        raise argparse.ArgumentTypeError("段數要是正整數")
    return int(text)


def group_of(scope_id, segments):
    """選區所屬的群組。

    參數：
        scope_id：選區代碼，含選舉代碼，例如 `2022-township-mayor:10-002-020`。
        segments：取選區代碼的前幾段。
    回傳：群組代碼，例如 `10-002-020`。全國性選區只有一段，回傳 `national`。
    """
    code = scope_id.split(":", 1)[1]
    return SEGMENT_SEPARATOR.join(code.split(SEGMENT_SEPARATOR)[:segments])


def transcript_lengths(election_id):
    """每位已轉錄的參選者轉錄稿的字數。

    參數：
        election_id：選舉代碼。
    回傳：參選者代碼對應字元數，一人多段時加總。還沒有段落表時是空 dict。
    """
    base = layer_dir("extract", election_id)
    lengths = {}
    # 每段的字數與抽取階段的段落文字相同，檔尾的換行不計
    for row in read_optional(base / "transcripts.tsv", TRANSCRIPT_HEADER):
        text = (base / "transcripts" / row["轉錄檔"]).read_text(encoding="utf-8")
        lengths[row["參選者"]] = lengths.get(row["參選者"], 0) + len(text.rstrip("\n"))
    return lengths


def progress(election_id, segments=DEFAULT_SEGMENTS):
    """列出各群組的名冊人數、已轉錄、有主張與沒有主張的人數與字數。

    參數：
        election_id：選舉代碼。
        segments：分組取選區代碼的前幾段。
    回傳：TSV 字串，表頭是 PROGRESS_HEADER。
    例外：PipelineError，名冊不存在，或段落表、主張表不符規格。
    """
    roster = read_json(
        layer_dir("extract", election_id) / ROSTER_FILE,
        hint=f"先執行 `npm run pipeline -- extract run --election {election_id}`",
    )["roster"]
    lengths = transcript_lengths(election_id)
    # 尚未編碼的選舉沒有主張表，有主張的人數都是 0
    claimed = {
        row["參選者"]
        for row in read_optional(
            layer_dir("claims", election_id) / "claims.tsv", CLAIM_HEADER
        )
    }
    groups = {}
    # 名冊上每位參選者計入所屬群組的各欄
    for entity in roster["entities"]:
        counts = groups.setdefault(
            group_of(entity["scope"], segments), dict.fromkeys(PROGRESS_HEADER[1:], 0)
        )
        counts["名冊人數"] += 1
        # 主張表有列的人計入有主張
        if entity["id"] in claimed:
            counts["有主張"] += 1
        # 沒有轉錄稿的人不計入已轉錄，也還沒有可以編碼的原文
        if entity["id"] not in lengths:
            continue
        counts["已轉錄"] += 1
        # 已轉錄而沒有主張的人，字數計入待編碼的工作量
        if entity["id"] not in claimed:
            counts["沒有主張"] += 1
            counts["沒有主張的字數"] += lengths[entity["id"]]
    # 表頭之後每個群組一列
    lines = ["\t".join(PROGRESS_HEADER)]
    # 群組依代碼排序，同一縣市的鄉鎮排在一起
    for group in sorted(groups):
        counts = groups[group]
        lines.append(
            "\t".join([group, *(str(counts[key]) for key in PROGRESS_HEADER[1:])])
        )
    return "\n".join(lines)


def arguments(parser):
    """加上這支工具的參數。

    參數：
        parser：這支工具的 ArgumentParser。
    """
    election_argument(parser)
    parser.add_argument(
        "--segments",
        type=segment_count,
        default=DEFAULT_SEGMENTS,
        help=f"分組取選區代碼的前幾段，預設 {DEFAULT_SEGMENTS}",
    )


def main(args):
    """執行指令。

    參數：
        args：解析後的參數。
    回傳：摘要字串。
    """
    return progress(args.election, args.segments)
