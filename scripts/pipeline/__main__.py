"""管線的進入點：把「階段 工具」分派到同名的檔案。

管線的每支工具是 scripts/pipeline/{階段}/{工具}.py 的一個檔案，檔名就是子指令。進入點解析參數、找到工具並印出它回傳的摘要，另有兩個跨階段的指令：依序執行各階段的 run，以及檢查設定表的 tables。

指令：
  `npm run pipeline -- <階段> <工具> [參數]`              執行一支工具，階段與工具列在 COMMANDS
  `npm run pipeline -- run [--election <代碼>] [--offline]` 依序執行各階段的 run，省略選舉時執行全部選舉，最後重寫索引
  `npm run pipeline -- tables [--sort <路徑>]`             檢查全部設定表，加上 `--sort` 時先排序一張表

手寫輸入：
  各工具讀取的手寫檔寫在各自的檔頭。

產物：
  各工具寫出的檔案寫在各自的檔頭，進入點把摘要寫到標準輸出。

慣例：
  - 工具的模組提供三個名稱：SUMMARY 是 `--help` 顯示的一句說明，arguments(parser) 加上自己的參數，main(args) 執行並回傳摘要字串，逐步產生摘要的工具回傳產生器。
  - 階段目錄裡檔名以底線開頭的模組是工具共用的片段，沒有子指令。
  - 副檔名是 .mjs 的工具用到網站的資料層與計分層，由本檔以 node 執行，參數原樣傳入。
  - 進度寫入標準錯誤，摘要寫入標準輸出。結束代碼 0 是通過，1 是輸入或產物不符規格，2 是參數有誤，由 argparse 處理。
"""

import argparse
import importlib
import subprocess
import sys
from pathlib import Path

from .common import PROGRAM, ROOT, PipelineError, election_argument, election_ids, log
from .tables import check_config_tables, sort_table

# ==================================================
# 集中設定
# ==================================================

# 指令表：階段依管線的順序排列，`--help` 依這個順序列出。每個階段先寫一句說明，再列出它的工具，工具名稱就是階段目錄裡的檔名
COMMANDS = {
    "fetch": ("抓取：登錄來源，下載並核對原始檔", ("run", "list")),
    "extract": (
        "抽取：匯入名冊，轉錄公報政見，登錄遮蔽詞",
        (
            "run",
            "units",
            "cells",
            "images",
            "render",
            "collect",
            "transcripts",
            "aliases",
            "ocr",
        ),
    ),
    "claims": (
        "主張：把政見拆成主張，填寫受控欄位",
        ("progress", "merge", "offsets", "renumber", "run"),
    ),
    "match": (
        "配題：把主張分配到面向，出題，判讀立場",
        ("facets", "reuse", "parents", "rename", "stems", "run"),
    ),
    "score": ("評分：評主張的具體度，審查題目的中立性", ("run",)),
    "publish": ("發布：寫出資料集與索引，檢視題組的區辨力", ("run", "index", "report")),
    "topics": ("主題測驗：核對手寫表，發布題組", ("run",)),
    "geo": ("地圖：轉出選區地圖，核對名冊", ("run",)),
}

# 以 node 執行的工具與它一句話的說明
NODE_TOOLS = {("publish", "report"): "寫出區辨力報告，省略選舉代碼時涵蓋索引的全部選舉"}

# run 依序執行的階段，每個階段是同名階段的 run 工具
RUN_LAYERS = ("fetch", "extract", "claims", "match", "score", "publish")

# 本檔所在的目錄，以 node 執行的工具從這裡找檔案
PACKAGE_DIR = Path(__file__).resolve().parent


# ==================================================
# 共用片段
# ==================================================


def tool_module(stage, tool):
    """載入一支工具的模組。

    參數：
        stage：階段，COMMANDS 的鍵。
        tool：工具名稱，即檔名。
    回傳：模組，提供 SUMMARY、arguments 與 main。
    """
    return importlib.import_module(f".{stage}.{tool}", __package__)


def node_tool(stage, tool):
    """組出以 node 執行一支工具的處理函式。

    參數：
        stage、tool：階段與工具名稱。
    回傳：接收解析後的參數、執行工具並回傳空摘要的函式。工具自己把報告寫到標準輸出。
    """

    def handler(args):
        command = ["node", str(PACKAGE_DIR / stage / f"{tool}.mjs"), *args.rest]
        # 工具的結束代碼不是 0 時，訊息已經由工具印出，這裡只回報失敗
        if subprocess.run(command, cwd=ROOT, check=False).returncode != 0:
            raise PipelineError(f"{stage} {tool} 沒有完成")
        return ""

    return handler


# ==================================================
# 跨階段的指令
# ==================================================


def run_layers(args):
    """執行 run：指定的選舉或全部選舉依序執行各階段，最後重寫索引。

    參數：
        args：解析後的參數，使用 election 與 offline。
    回傳：逐層產生摘要字串的產生器，最後一項是索引的摘要。
    例外：PipelineError，任一個階段的輸入或產物不符規格。
    """
    # 省略選舉時執行全部選舉
    elections = [args.election] if args.election else election_ids()
    # 一場選舉執行完各階段再換下一場，前一場的錯誤留在輸出的最後
    for election in elections:
        # 依管線的順序逐層執行，每個階段完成就交出摘要
        for layer in RUN_LAYERS:
            yield tool_module(layer, "run").run(election, offline=args.offline)
    # 發布之後索引要反映最新的資料版本
    yield tool_module("publish", "index").write_index()


def run_tables(args):
    """執行 tables：給 `--sort` 時先排序，再檢查全部設定表。

    參數：
        args：解析後的參數，使用 sort。
    回傳：每張表一行的摘要：檔名與列數。
    例外：PipelineError，要排序的表不存在，或任一張設定表不合規格。
    """
    # 先排序再檢查，排序後的表才會通過排序的檢查
    if args.sort:
        sort_table(ROOT / args.sort)
    return "\n".join(f"{name}\t{count}" for name, count in check_config_tables())


# ==================================================
# 主體
# ==================================================


def build_parser():
    """建立兩層子指令的解析器。

    回傳：argparse.ArgumentParser，每支工具以 handler 記下自己的處理函式。
    """
    parser = argparse.ArgumentParser(prog=PROGRAM, description="台灣政策圖譜的資料管線")
    stages = parser.add_subparsers(dest="stage", required=True, metavar="<階段>")
    # run 跨越各階段，選舉代碼可以省略
    summary = "依序執行各階段的 run，省略選舉時執行全部選舉，最後重寫索引"
    run = stages.add_parser("run", help=summary, description=summary)
    election_argument(run, required=False)
    # 離線時只用已下載的原始檔
    run.add_argument(
        "--offline", action="store_true", help="只用 .cache/sources/ 內的原始檔"
    )
    run.set_defaults(handler=run_layers)
    # tables 檢查兩個目錄的設定表
    summary = "檢查全部設定表，加上 --sort 時先排序一張表"
    tables = stages.add_parser("tables", help=summary, description=summary)
    tables.add_argument("--sort", help="依代碼的碼位排序一張表，路徑相對於 repo 根目錄")
    # 處理函式記在解析結果，main 取出後呼叫
    tables.set_defaults(handler=run_tables)
    # 每個階段一組子指令，工具依指令表的順序登錄
    for stage, (stage_summary, tools) in COMMANDS.items():
        stage_parser = stages.add_parser(
            stage, help=stage_summary, description=stage_summary
        )
        tool_parsers = stage_parser.add_subparsers(
            dest="tool", required=True, metavar="<工具>"
        )
        # 一支工具一個子指令
        for tool in tools:
            # 以 node 執行的工具把其餘的參數原樣交給它
            if (stage, tool) in NODE_TOOLS:
                summary = NODE_TOOLS[(stage, tool)]
                tool_parser = tool_parsers.add_parser(
                    tool, help=summary, description=summary
                )
                # 工具自己解析其餘的參數
                tool_parser.add_argument(
                    "rest", nargs=argparse.REMAINDER, help="交給工具的參數"
                )
                tool_parser.set_defaults(handler=node_tool(stage, tool))
                continue
            # 其餘的工具載入模組，說明與參數都取自模組
            module = tool_module(stage, tool)
            tool_parser = tool_parsers.add_parser(
                tool, help=module.SUMMARY, description=module.SUMMARY
            )
            # 工具自己加上參數，處理函式是它的 main
            module.arguments(tool_parser)
            tool_parser.set_defaults(handler=module.main)
    return parser


def main(argv):
    """執行指令。

    參數：
        argv：程式名稱之後的參數串列。
    回傳：結束代碼。參數有誤時 argparse 印出用法並以結束代碼 2 結束。
    """
    args = build_parser().parse_args(argv)
    # 不符規格的輸入以 PipelineError 回報，其他例外原樣拋出以保留追蹤資訊
    try:
        result = args.handler(args)
        # 回傳字串的工具印出一次，逐步產生摘要的工具每產生一項印出一行
        for line in [result] if isinstance(result, str) else result:
            # 空的摘要是工具已經自己寫出結果
            if line:
                print(line, flush=True)
        return 0
    # 訊息寫入標準錯誤，結束代碼 1
    except PipelineError as error:
        log(f"失敗：{error}")
        return 1


# 進入點
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
