"""收錄輔助：列出遮蔽詞的候選，核對登錄的遮蔽詞會不會誤遮。

網站翻牌前把名冊的姓名、黨名與 aliases.tsv 的詞換成遮蔽用語，替換是全場共用的子字串替換。本腳本只列出線索，要不要登錄由編碼者逐筆判斷。

指令：
  `.venv/bin/python .claude/skills/policy-curation/scripts/aliases.py scan --election <代碼>`
  `.venv/bin/python .claude/skills/policy-curation/scripts/aliases.py check --election <代碼>`

慣例：
  - scan 列出名冊姓名的片段（中文名的後兩字、族名或漢名單獨出現、羅馬拼音的各段）與帳號、網址、電話號碼。完整姓名先從行中移除再比對片段，片段只算本人轉錄稿裡的出現。
  - 兩個指令的最後一欄都列出這個詞在其他參選者轉錄稿的出現，有出現時要改登錄較長、全場唯一的寫法。
  - 輸出 TSV 到標準輸出。
"""

import argparse
import json
import re
import sys
from pathlib import Path

# 本檔位於 .claude/skills/policy-curation/scripts/，往上四層是 repo 根目錄，管線套件從那裡匯入
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from pipeline.common import PipelineError, layer_dir, log, require  # noqa: E402
from pipeline.extract import ALIAS_HEADER, TRANSCRIPT_HEADER  # noqa: E402
from pipeline.tables import EMPTY, read_optional, read_table  # noqa: E402

# ==================================================
# 集中設定
# ==================================================

# 帳號、網址與電話號碼的樣式，都歸為識別字
IDENTIFIER_PATTERNS = [
    r"@[\w.]+",
    r"https?://\S+|www\.\S+|[\w.-]+\.(?:com|tw|org|net)\b\S*",
    r"0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,4}",
]

# 中文姓名取後兩字作為以名字自稱的候選，三字以上的姓名才取
GIVEN_NAME_LENGTH = 2

# 羅馬拼音的族名逐段比對，短於這個長度的片段太常見
ROMAN_MIN_LENGTH = 3

# 輸出的表頭
SCAN_HEADER = ["參選者", "詞", "類別", "所在行", "其他出現"]
CHECK_HEADER = ["代碼", "詞", "其他出現"]


# ==================================================
# 讀取
# ==================================================


def load(election_id):
    """讀取名冊與每位參選者的轉錄稿。

    參數：
        election_id：選舉代碼。
    回傳：`(參選者, 轉錄稿)`，參選者依代碼索引，轉錄稿是參選者代碼到全文的 dict，一人多段時串接。
    例外：PipelineError，名冊或段落表不存在。
    """
    base = layer_dir("extract", election_id)
    roster = json.loads(
        require(base / "roster.json", "先執行 extract").read_text(encoding="utf-8")
    )
    # 名冊依參選者代碼索引
    entities = {entity["id"]: entity for entity in roster["roster"]["entities"]}
    texts = {}
    # 同一位參選者有多個段落時串接，片段比對以人為單位
    for row in read_table(require(base / "transcripts.tsv"), TRANSCRIPT_HEADER):
        text = (base / "transcripts" / row["轉錄檔"]).read_text(encoding="utf-8")
        texts[row["參選者"]] = texts.get(row["參選者"], "") + text
    return entities, texts


def elsewhere(term, owner, texts):
    """這個詞出現在其他哪些參選者的轉錄稿。

    參數：
        term：詞。
        owner：詞所屬的參選者代碼，不計入。
        texts：參選者代碼到轉錄稿全文的 dict。
    回傳：以「、」連接的參選者代碼，沒有出現時是 -。
    """
    others = [
        entity for entity, text in texts.items() if entity != owner and term in text
    ]
    return "、".join(sorted(others)) or EMPTY


# ==================================================
# 候選
# ==================================================


def name_fragments(name):
    """名冊姓名中可能單獨出現的片段。

    參數：
        name：名冊的姓名。
    回傳：`(詞, 類別)` 的集合。
    """
    han = re.sub(r"[^一-鿿]", "", name)
    fragments = set()
    # 漢名長於名字的長度才有姓可去
    if len(han) > GIVEN_NAME_LENGTH:
        fragments.add((han[-GIVEN_NAME_LENGTH:], "nickname"))
    # 漢名以外的部分是族名
    rest = name.replace(han, "").strip()
    # 名冊同時寫漢名與族名時，兩者各自單獨出現也是姓名
    if han and rest:
        fragments |= {(han, "name"), (rest, "name")}
    # 羅馬拼音的族名逐段，分隔號不同時仍找得到
    pattern = rf"[A-Za-z'’]{{{ROMAN_MIN_LENGTH},}}"
    fragments |= {(part, "name") for part in re.findall(pattern, name)}
    return fragments


def scan(election_id):
    """列出遮蔽詞的候選。

    參數：
        election_id：選舉代碼。
    回傳：TSV 字串。
    例外：PipelineError，名冊或段落表不存在。
    """
    entities, texts = load(election_id)
    lines = ["\t".join(SCAN_HEADER)]
    # 逐位參選者比對自己的轉錄稿，同一個詞只列一次
    for owner, text in sorted(texts.items()):
        name = entities[owner]["name"]
        found = set()
        # 逐行比對，輸出時附上所在行
        for line in text.splitlines():
            # 完整姓名由網站依名冊遮蔽，移除後再比對片段
            rest = line.replace(name, "")
            # 只留這一行出現的片段
            candidates = {pair for pair in name_fragments(name) if pair[0] in rest}
            # 帳號、網址與電話在原行比對，完整姓名不影響
            for pattern in IDENTIFIER_PATTERNS:
                candidates |= {
                    (match, "identifier") for match in re.findall(pattern, line)
                }
            # 新找到的詞連同所在行與其他出現一起輸出
            for term, kind in sorted(candidates - found):
                found.add((term, kind))
                lines.append(
                    "\t".join(
                        [owner, term, kind, line.strip(), elsewhere(term, owner, texts)]
                    )
                )
    return "\n".join(lines)


def check(election_id):
    """核對 aliases.tsv 的每個詞在其他參選者轉錄稿的出現。

    參數：
        election_id：選舉代碼。
    回傳：TSV 字串，只列出有其他出現的詞。
    例外：PipelineError，名冊或段落表不存在，或遮蔽詞表不符規格。
    """
    _, texts = load(election_id)
    path = layer_dir("extract", election_id) / "aliases.tsv"
    lines = ["\t".join(CHECK_HEADER)]
    # 逐詞找其他參選者的出現
    for row in read_optional(path, ALIAS_HEADER):
        others = elsewhere(row["詞"], row["參選者"], texts)
        # 只出現在本人轉錄稿的詞不會誤遮
        if others != EMPTY:
            lines.append("\t".join([row["代碼"], row["詞"], others]))
    return "\n".join(lines)


# ==================================================
# 指令
# ==================================================


def main(argv):
    """執行指令。

    參數：
        argv：不含程式名稱的參數串列。
    回傳：結束代碼，0 為成功，1 為名冊或手寫表不符規格。
    """
    parser = argparse.ArgumentParser(description="列出遮蔽詞的候選與誤遮")
    # 子指令與選舉代碼
    parser.add_argument("command", choices=["scan", "check"])
    parser.add_argument("--election", required=True, help="選舉代碼")
    args = parser.parse_args(argv)
    # 指令名稱對應到要執行的函式
    commands = {"scan": scan, "check": check}
    # 不符規格的手寫表以 PipelineError 回報
    try:
        print(commands[args.command](args.election))
    # 訊息寫入標準錯誤，結束代碼 1 與管線相同
    except PipelineError as error:
        log(f"失敗：{error}", "aliases")
        return 1
    return 0


# 直接執行本檔時執行指令
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
