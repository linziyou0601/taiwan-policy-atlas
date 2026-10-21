"""管線的命令列入口。

依層執行或一次執行完整的管線，另有設定表檢查、地圖、主題測驗與題組索引的指令。

指令：
  `python -m pipeline run [--election <代碼>] [--offline]`   依序執行各層，省略選舉時跑全部選舉
  `python -m pipeline <fetch|extract|claims|match|score|publish> --election <代碼>`
  `python -m pipeline tables [--sort <路徑>]`                 檢查設定表，加上 `--sort` 時先排序該表
  `python -m pipeline geo [--offline]`                         轉出選區地圖並核對各場名冊，在抽取層之後執行
  `python -m pipeline topic [--topic <代碼>] [--offline]`      發布主題測驗，省略代碼時發布全部，發布後更新索引
  `python -m pipeline index`                                   依已發布的選舉與主題測驗重寫索引，移除題組後執行

慣例：
  - 進度寫入標準錯誤，各層摘要寫入標準輸出。結束代碼 0 為成功，1 為輸入或產物不符規格，2 為參數錯誤（由 argparse 處理）。
"""

import argparse
import sys

from . import claims, extract, fetch, geo, match, publish, score, topic
from .common import ROOT, PipelineError, election_ids, log, topic_ids
from .tables import check_config_tables, sort_table

# ==================================================
# 集中設定
# ==================================================

# 依管線順序的各層與執行函式，run 指令依這個順序執行
STEPS = {
    "fetch": lambda election, args: fetch.run(election, offline=args.offline),
    "extract": lambda election, args: extract.run(election),
    "claims": lambda election, args: claims.run(election),
    "match": lambda election, args: match.run(election),
    "score": lambda election, args: score.run(election),
    "publish": lambda election, args: publish.run(election),
}

# 執行後要更新題組索引的指令
INDEX_COMMANDS = {"run", "publish"}

# 不屬於管線各層的輔助指令
TOOLS = ["tables", "geo", "topic", "index"]


def parse_args(argv):
    """解析命令列參數。

    參數：
        argv：不含程式名稱的參數串列。
    回傳：argparse.Namespace。參數錯誤時 argparse 印出用法並以結束代碼 2 結束。
    """
    parser = argparse.ArgumentParser(
        prog="python -m pipeline", description="台灣政策圖譜的資料管線"
    )
    parser.add_argument("command", choices=["run", *TOOLS, *STEPS])
    parser.add_argument(
        "--election", help="選舉代碼，對應 config/pipeline/elections/{代碼}.yaml"
    )
    # 以下選項只對部分指令有作用
    parser.add_argument(
        "--topic", help="主題測驗代碼，對應 config/pipeline/topics/{代碼}.yaml"
    )
    parser.add_argument(
        "--offline", action="store_true", help="只用 .cache/sources/ 內的原始檔"
    )
    parser.add_argument(
        "--sort", help="依代碼碼位排序 repo 內的一張表，路徑相對於 repo 根目錄"
    )
    return parser.parse_args(argv)


def run_tables(args):
    """執行 tables 指令：給 `--sort` 時先排序，再檢查全部設定表並印出列數。

    參數：
        args：parse_args 的結果。
    """
    # 先排序再檢查，排序後的表才會通過排序檢查
    if args.sort:
        sort_table(ROOT / args.sort)
    # 每張表一行：檔名與列數
    for name, count in check_config_tables():
        print(f"{name}\t{count}")


def run_steps(args):
    """執行管線指令：指定的層或全部層，指定的選舉或全部選舉。

    參數：
        args：parse_args 的結果。
    """
    # 省略選舉時跑全部選舉
    elections = [args.election] if args.election else election_ids()
    # run 指令依序跑各層，其他指令只跑那一層
    steps = list(STEPS) if args.command == "run" else [args.command]
    # 一場選舉跑完各層再換下一場，後一場的輸出不會蓋過前一場的錯誤
    for election in elections:
        # 依管線順序逐層執行
        for step in steps:
            print(STEPS[step](election, args))
    # 發布後索引要反映最新的資料版本
    if args.command in INDEX_COMMANDS:
        print(publish.write_index())


def main(argv):
    """執行指令。

    參數：
        argv：不含程式名稱的參數串列。
    回傳：結束代碼。
    """
    args = parse_args(argv)
    # 不符規格的輸入以 PipelineError 回報，其他例外原樣拋出以保留追蹤資訊
    try:
        # tables 指令不需要選舉
        if args.command == "tables":
            run_tables(args)
        # geo 不分選舉，核對全部選舉的名冊
        elif args.command == "geo":
            print(geo.run(offline=args.offline))
        # index 只重寫索引，移除選舉或主題測驗後用它更新
        elif args.command == "index":
            print(publish.write_index())
        # topic 發布主題測驗，再更新索引
        elif args.command == "topic":
            # 省略代碼時發布全部主題測驗
            for code in [args.topic] if args.topic else topic_ids():
                print(topic.run(code, offline=args.offline))
            print(publish.write_index())
        # 其餘指令依層執行
        else:
            run_steps(args)
        return 0
    # 訊息寫入標準錯誤，結束代碼 1
    except PipelineError as error:
        log(f"失敗：{error}")
        return 1


# 以 python -m pipeline 執行時進入 main，結束代碼交給作業系統
sys.exit(main(sys.argv[1:]))
