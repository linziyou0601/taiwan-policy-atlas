"""抽取階段共用的片段：把轉錄的輸出寫進這個階段，並列出還要判斷的 OCR 比對。

collect、transcripts 與 ocr 三支工具共用這裡的函式。寫入只合併列與複製轉錄檔，內容由 `extract run` 核對。

指令：
  由同階段的 collect、transcripts 與 ocr 呼叫。

手寫輸入：
  {選區輸出目錄}/notes.tsv 與 {選區代碼}-{號次}.txt   collect 讀取的轉錄輸出，目錄名稱是選區代碼
  {草稿目錄}/transcripts.tsv 與轉錄檔                    transcripts 讀取的草稿
  {選區輸出目錄或草稿目錄}/roster.tsv                    名冊表的草稿，選舉定義的 roster 寫 tables 時才有

產物：
  data/20-extract/{選舉代碼}/transcripts.tsv、transcripts/   段落表與轉錄稿
  data/20-extract/{選舉代碼}/roster.tsv                      名冊表
  data/10-fetch/{選舉代碼}/election.yaml                     collect 把用到的公報登錄到 documents

慣例：
  - notes.tsv 的表頭是選區、號次、文件、頁、影像、說明，文件欄是 `extract units` 素材 docs.tsv 的目錄名稱。用到的公報依 sha256 登錄，來源取 docs.tsv 的來源欄，已登錄的公報沿用原代碼。
  - 公報代碼是 `bulletin-{用到它的選區代碼的共同前段}`，同一個鄉鎮用到數份公報時接上各選區的末段。標題是「{縣市}{鄉鎮}{職稱}選舉選舉公報」，職稱依鄉鎮名稱的字尾查 `--office`，數份公報同名時加上涵蓋的選區或正背面。
  - 草稿的列由寫入的函式排序。同代碼的段落與名冊列覆寫，其餘保留。
  - ocr 只列出有沒對上的行或重合度低於 AGREEMENT_REVIEW 的影像段落，理由欄含「OCR」時已記錄寫「是」。
"""

import re
import shutil
from collections import Counter

from ..common import (
    PipelineError,
    election_config,
    election_path,
    layer_dir,
    product_path,
    read_json,
    require,
)
from ..tables import (
    EMPTY,
    NO,
    YES,
    read_draft,
    read_optional,
    read_table,
    write_sorted,
)
from .run import AGREEMENT_REVIEW, ROSTER_HEADER, TRANSCRIPT_HEADER, current_roster
from .units import DOC_FILE, DOC_HEADER, unit_dir

# ==================================================
# 集中設定
# ==================================================

# 轉錄者在選區輸出目錄寫的說明表
NOTE_FILE = "notes.tsv"
NOTE_HEADER = ["選區", "號次", "文件", "頁", "影像", "說明"]

# 段落的方法與審核狀態，轉錄由模型判讀
METHOD = "模型判讀"
STATUS = "未經獨立複評"

# ocr 輸出的表頭，以及理由欄中表示已記下 OCR 比對判斷的字樣
OCR_HEADER = ["段落", "影像", "重合度", "未對上行數", "已記錄"]
OCR_MARK = "OCR"

# 登錄到選舉定義的一份公報，與既有設定的註解寫法相同
DOCUMENT_ENTRY = """  - # 文件代碼，抽取產物以它命名
    id: {id}
    # 來源代碼
    source: {source}
    # 網站目錄下的路徑
    member: {member}
    # 文件內容的 sha256，抓取後核對
    sha256: {sha256}
    # 文件標題
    title: {title}
    # 政見欄影像，代碼是「p頁碼-嵌入順序」，抽取階段只寫出這些影像。政見在文字層的文件寫空清單
    images: [{images}]
"""


# ==================================================
# 轉錄稿
# ==================================================


def store_transcripts(election_id, passages):
    """把段落與轉錄檔寫進抽取階段。

    參數：
        election_id：選舉代碼。
        passages：每段的 `(段落表的列, 轉錄檔的來源路徑)`，同代碼時後面的覆寫前面的。
    回傳：`(寫入段數, 寫入後的總段數)`。
    """
    base = layer_dir("extract", election_id)
    path = base / "transcripts.tsv"
    # 既有的段落依代碼索引，同代碼的列覆寫
    rows = {row["代碼"]: row for row in read_optional(path, TRANSCRIPT_HEADER)}
    # 每段的轉錄檔複製到抽取階段的 transcripts/，檔名取段落表的轉錄檔欄
    for row, source in passages:
        target = base / "transcripts" / row["轉錄檔"]
        # 抽取階段還沒有轉錄稿時建立目錄
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        rows[row["代碼"]] = row
    # 段落表依代碼排序寫出，與手寫表的規則相同
    write_sorted(path, TRANSCRIPT_HEADER, rows.values())
    return len(passages), len(rows)


def store_roster(election_id, entities):
    """把名冊表的草稿列併入抽取階段的名冊表。

    參數：
        election_id：選舉代碼。
        entities：名冊表的列，同代碼時後面的覆寫前面的。
    回傳：`(寫入人數, 寫入後的總人數)`。
    """
    path = layer_dir("extract", election_id) / "roster.tsv"
    # 既有的名冊列依代碼索引，草稿的同代碼列覆寫
    rows = {row["代碼"]: row for row in read_optional(path, ROSTER_HEADER)}
    rows.update((row["代碼"], row) for row in entities)
    write_sorted(path, ROSTER_HEADER, rows.values())
    return len(entities), len(rows)


def write_transcripts(election_id, drafts):
    """把草稿目錄的段落、轉錄檔與名冊表寫進抽取階段。

    參數：
        election_id：選舉代碼。
        drafts：草稿目錄的 Path 串列。
    回傳：摘要字串。
    例外：PipelineError，草稿表不符規格或缺少轉錄檔。
    """
    passages = []
    entities = []
    # 每個草稿目錄的段落依序收集，後面的目錄覆寫前面的同代碼段落
    for directory in drafts:
        draft = require(directory / "transcripts.tsv", "草稿目錄要有 transcripts.tsv")
        # 每列的轉錄檔在草稿目錄內，檔名與段落表的轉錄檔欄相同
        for row in read_draft(draft, TRANSCRIPT_HEADER):
            source = require(directory / row["轉錄檔"], f"{row['代碼']} 的轉錄檔")
            passages.append((row, source))
        # 名冊表的草稿只在選舉定義的 roster 寫 tables 時出現
        if (directory / "roster.tsv").exists():
            entities.extend(read_draft(directory / "roster.tsv", ROSTER_HEADER))
    # 收齊後一次寫入，摘要列出寫入與總段數
    written, total = store_transcripts(election_id, passages)
    summary = f"transcripts {election_id}: 寫入 {written} 段，共 {total} 段"
    # 沒有名冊表草稿時不建立名冊表
    if not entities:
        return summary
    added, people = store_roster(election_id, entities)
    return f"{summary}；名冊寫入 {added} 人，共 {people} 人"


# ==================================================
# 選區的轉錄輸出
# ==================================================


def common_prefix(codes):
    """選區代碼依「-」分段後的共同前段。

    參數：
        codes：選區代碼的串列，至少一個。
    回傳：共同的前段，以「-」串接。
    """
    shared = []
    # 逐段比對，第一個不同的段之後都不算
    for parts in zip(*(code.split("-") for code in codes)):
        # 這一段各選區都相同時納入前段
        if len(set(parts)) > 1:
            break
        shared.append(parts[0])
    return "-".join(shared)


def side_of(path):
    """公報路徑標示的正面或背面。

    參數：
        path：公報在網站上的路徑。
    回傳：正面、背面或空字串。
    """
    # 檔名寫出正背面的公報才有
    for side in ("正面", "背面"):
        # 路徑含這兩個字時就是那一面
        if side in path:
            return side
    return ""


def document_names(used, scope_names, offices):
    """依用到公報的選區決定公報的代碼與標題。

    參數：
        used：每份公報的 sha256 對應 `(路徑, 用到它的選區代碼集合)`。
        scope_names：選區代碼對應名冊的選區名稱，第一段是縣市，接著是鄉鎮或選舉區。
        offices：鄉鎮名稱的字尾對應職稱，例如 {"鄉": "鄉民代表"}。選區沒有鄉鎮時查縣市名稱的字尾，例如 {"縣": "議員"}。
    回傳：每份公報的 sha256 對應 `(代碼, 標題)`。
    例外：PipelineError，鄉鎮的字尾沒有對應的職稱，或代碼重複。
    """
    base = {digest: common_prefix(sorted(codes)) for digest, (_, codes) in used.items()}
    codes_of, titles = {}, {}
    # 代碼取共同前段，標題由縣市、鄉鎮與職稱組成
    for digest, (path, codes) in used.items():
        first = sorted(codes)[0]
        county, *rest = scope_names[first].split()
        # 第二段以「第」開頭時是選舉區，選區沒有鄉鎮
        town = rest[0] if rest and not rest[0].startswith("第") else ""
        # 職稱依鄉鎮名稱的最後一字查表，沒有鄉鎮時依縣市名稱
        place = town or county
        # 字尾沒有寫職稱時停止，標題組不出來
        if place[-1] not in offices:
            raise PipelineError(f"{place} 的字尾「{place[-1]}」沒有在 --office 寫職稱")
        # 代碼先取用到這份公報的選區的共同前段
        code = base[digest]
        # 前段與其他公報相同、又比選區代碼短時，接上各選區的末段
        if list(base.values()).count(code) > 1 and len(code.split("-")) < len(
            first.split("-")
        ):
            code += "-" + "-".join(sorted(c.split("-")[-1] for c in codes))
        # 代碼加上 bulletin- 前綴，與既有的公報代碼一致
        codes_of[digest] = f"bulletin-{code}"
        titles[digest] = f"{county}{town}{offices[place[-1]]}選舉選舉公報"
    # 加上標示前先數好每個標題的份數，加過標示的標題不影響其餘公報的判斷
    counts = Counter(titles.values())
    # 標題重複時加上涵蓋的選區，沒有選區名稱時加上正背面
    for digest, (path, codes) in used.items():
        # 只有一份公報用這個標題時不必區別
        if counts[titles[digest]] < 2:
            continue
        # 選區名稱的第三段起是選區，例如「第 1 選舉區」
        districts = sorted({" ".join(scope_names[c].split()[2:]) for c in codes} - {""})
        label = "、".join(districts) or side_of(path)
        # 選區與正背面都沒有時維持原標題，代碼仍可區別
        if label:
            titles[digest] += f"（{label}）"
    # 代碼必須唯一，抽取產物以它命名
    if len(set(codes_of.values())) < len(codes_of):
        raise PipelineError("公報代碼重複，同一鄉鎮的公報需要人工命名")
    return {digest: (codes_of[digest], titles[digest]) for digest in used}


def register_documents(election_id, entries):
    """把公報登錄到選舉定義的 documents，保留既有內容與註解。

    參數：
        election_id：選舉代碼。
        entries：要新增的公報，每份是 DOCUMENT_ENTRY 欄位的 dict。
    回傳：無。
    """
    path = election_path(election_id)
    text = path.read_text(encoding="utf-8")
    # 還沒有文件的設定寫成空清單，改成清單起首再接上新的公報
    text = text.replace("documents: []\n", "documents:\n")
    text = (
        text.rstrip("\n")
        + "\n"
        + "".join(DOCUMENT_ENTRY.format(**entry) for entry in entries)
    )
    path.write_text(text, encoding="utf-8")


def collect_units(election_id, directories, offices):
    """把選區的轉錄輸出寫進抽取階段，並登錄用到的公報。

    參數：
        election_id：選舉代碼。
        directories：選區輸出目錄的 Path 串列，目錄名稱是選區代碼。
        offices：鄉鎮名稱的字尾對應職稱。
    回傳：摘要字串，接著每行一個需要處理的問題。
    例外：PipelineError，說明表或素材不符規格、職稱缺漏或公報代碼重複。
    """
    drafted = []
    # 名冊表的選舉，轉錄者把公報上的參選者寫在選區輸出目錄的 roster.tsv
    for directory in directories:
        # 名冊來自來源的選舉沒有這張草稿
        if (directory / "roster.tsv").exists():
            drafted.extend(read_draft(directory / "roster.tsv", ROSTER_HEADER))
    # 先併入名冊表，核對號次時才找得到新補上的參選者
    if drafted:
        store_roster(election_id, drafted)
    # 選區名稱用來替新公報命名，參選者以選區與號次查找
    roster = current_roster(election_id)
    scope_names = {s["id"].split(":", 1)[1]: s["name"] for s in roster["scopes"]}
    entities = {
        (e["scope"].split(":", 1)[1], str(e["number"])): e for e in roster["entities"]
    }
    # 說明、用到的公報、公報的來源與問題逐選區累積
    notes, used, origins, problems = [], {}, {}, []
    # 每個選區的說明表對照素材的公報清單，記下用到的公報
    for directory in directories:
        scope = directory.name
        documents = {
            row["目錄"]: row
            for row in read_table(
                unit_dir(election_id, scope) / DOC_FILE, DOC_HEADER, coded=False
            )
        }
        # 每位參選者一列說明，文件欄指向素材的 doc{n}
        for note in read_table(directory / NOTE_FILE, NOTE_HEADER, coded=False):
            notes.append((directory, scope, note))
            # 不在公報的參選者沒有用到公報
            if note["文件"] != EMPTY:
                document = documents[note["文件"]]
                # 公報依 sha256 記下路徑與用到它的選區
                used.setdefault(document["sha256"], (document["路徑"], set()))[1].add(
                    scope
                )
                origins[document["sha256"]] = document["來源"]
                note["sha256"] = document["sha256"]
    # 已登錄的公報沿用原代碼，只替新的公報命名
    registered = {
        d["sha256"]: d["id"] for d in election_config(election_id).get("documents", [])
    }
    # 還沒登錄的公報才需要命名
    unregistered = {d: entry for d, entry in used.items() if d not in registered}
    names = document_names(unregistered, scope_names, offices)
    # 每份公報的代碼，已登錄與新命名的合在一起查
    ids = {**registered, **{digest: name for digest, (name, _) in names.items()}}
    passages = []
    # 每列說明換成段落表的一列，轉錄檔從選區輸出目錄複製
    for directory, scope, note in notes:
        entity = entities.get((scope, note["號次"]))
        source = directory / f"{scope}-{note['號次']}.txt"
        # 名冊沒有這個號次、缺轉錄檔或不在公報時列出，不寫入
        if entity is None or not source.exists() or note["文件"] == EMPTY:
            problems.append(f"{scope}-{note['號次']}：{note['說明']}")
            continue
        # 公報代碼查表，影像欄先取說明表的寫法
        document = ids[note["sha256"]]
        image = note["影像"]
        # 影像欄寫完整的影像代碼，前面接上公報代碼
        if image != EMPTY:
            image = f"{document}-{image}"
        # 段落表的一列依表頭的順序組成
        values = [f"{scope}-{note['號次']}-p1", entity["id"], document, image]
        values += [note["頁"], source.name, note["說明"], METHOD, STATUS]
        passages.append((dict(zip(TRANSCRIPT_HEADER, values)), source))
    # 每份新公報一筆登錄資料
    entries = []
    # 新的公報依代碼排序登錄，影像欄列出這份公報被引用的影像
    for digest, (name, title) in sorted(names.items(), key=lambda item: item[1][0]):
        prefix = name + "-"
        # 引用這份公報影像的段落，影像代碼去掉公報代碼
        cited = {
            r["影像"][len(prefix) :]
            for r, _ in passages
            if r["文件"] == name and r["影像"] != EMPTY
        }
        # 依頁碼與嵌入順序排列
        images = sorted(cited, key=lambda c: [int(n) for n in re.findall(r"\d+", c)])
        entries.append(
            {
                "id": name,
                "source": origins[digest],
                "member": used[digest][0],
                "sha256": digest,
                "title": title,
                "images": ", ".join(images),
            }
        )
    # 先登錄公報再寫段落，抽取階段依設定讀取公報
    register_documents(election_id, entries)
    written, total = store_transcripts(election_id, passages)
    summary = f"collect {election_id}: 寫入 {written} 段，共 {total} 段，新登錄 {len(entries)} 份公報"
    return "\n".join([summary, *problems])


# ==================================================
# OCR 比對
# ==================================================


def ocr_pending(election_id):
    """列出還要判斷 OCR 比對的影像段落。

    參數：
        election_id：選舉代碼。
    回傳：TSV 字串，表頭是 OCR_HEADER，沒有要判斷的段落時只有表頭。
    例外：PipelineError，抽取階段的產物不存在或段落表不符規格。
    """
    product = read_json(
        product_path("extract", election_id),
        hint=f"先執行 `npm run pipeline -- extract run --election {election_id}`",
    )
    # 理由欄取自段落表目前的內容，剛寫下的判斷不必重新執行抽取階段就會反映
    reasons = {
        row["代碼"]: row["理由"]
        for row in read_optional(
            layer_dir("extract", election_id) / "transcripts.tsv", TRANSCRIPT_HEADER
        )
    }
    lines = ["\t".join(OCR_HEADER)]
    # 依產物的段落順序逐段檢視比對結果
    for passage in product["passages"]:
        check = passage["ocr_check"]
        # 文字型來源的段落沒有影像，影像沒有辨識出任何一行時也沒有比對結果
        if not passage["image"] or check is None:
            continue
        # 每一行都對得上而且重合度達到門檻的段落不必判斷
        if not check["unmatched"] and check["agreement"] >= AGREEMENT_REVIEW:
            continue
        # 理由欄寫到 OCR 表示轉錄者已對照影像記下判斷
        recorded = YES if OCR_MARK in reasons.get(passage["id"], "") else NO
        lines.append(
            "\t".join(
                [
                    passage["id"],
                    passage["image"],
                    str(check["agreement"]),
                    str(len(check["unmatched"])),
                    recorded,
                ]
            )
        )
    return "\n".join(lines)
