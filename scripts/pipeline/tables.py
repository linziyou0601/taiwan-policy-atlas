"""TSV 表的讀取、寫法的檢查與儲存格的解析。

讀取設定表、各階段的手寫表與主題測驗的手寫表，檢查表頭、欄數、空白格、代碼唯一與碼位排序，並解析多值、空值、是非、數值與整數的儲存格。表的寫法見 docs/pipeline/table-contract.md。

指令：
  `npm run pipeline -- tables [--sort <路徑>]`
  檢查全部設定表，加上 `--sort` 時先把一張表依代碼排序。其他模組以 read_table 或 read_config_table 讀取表格。

手寫輸入：
  config/tables/*.tsv              網站與管線都讀的設定表，檔名與表頭取自 config/app/settings.json 的 tables
  scripts/pipeline/tables/*.tsv    只有管線讀的設定表，檔名與表頭登錄在本檔的 PIPELINE_TABLE_HEADERS

產物：
  `--sort` 把排序後的表寫回原處，其餘只讀取。

慣例：
  - 第一欄是代碼，每個代碼一列，列依代碼的 Unicode 碼位排序，列的順序沒有意義。
  - 多值以頓號分隔，空值寫 -，是非欄寫「是」或「否」，每格都要有值。空值的寫法定義在本檔的 EMPTY，各階段從這裡匯入。
  - 兩個目錄中沒有登錄的表與放錯目錄的表都讓檢查失敗。
"""

from .common import (
    PIPELINE_TABLES_DIR,
    TABLES_DIR,
    PipelineError,
    app_settings,
    relative,
    require,
    sha256_text,
    unique_index,
)

# ==================================================
# 集中設定
# ==================================================

# 多值儲存格的分隔字元
MULTI_SEPARATOR = "、"

# 空值的寫法，與 TSV 規格一致，各階段的手寫表與設定表共用
EMPTY = "-"

# 是非欄的兩種寫法，以及對應的布林值
YES, NO = "是", "否"
BOOLEANS = {YES: True, NO: False}

# 軸對應的方向只有兩種：同意時往正極或負極，選舉與主題測驗的 question-axes.tsv 相同
DIRECTIONS = {1, -1}

# question-axes.tsv 的表頭，選舉與主題測驗共用
AXIS_HEADER = ["代碼", "題目", "軸", "方向", "權重", "理由", "方法", "審核狀態"]

# 網站也讀取的設定表的表頭：檔名對應依序的欄名，取自 settings.json 的 `tables.*.fields`，讀表時逐欄比對，表頭不符時讀取失敗
TABLE_HEADERS = {
    table["file"]: list(table["fields"]) for table in app_settings()["tables"].values()
}

# 只有管線讀取的設定表的表頭：方法與審核狀態是各階段手寫表兩個審核欄的登錄名稱，名冊造字是名冊匯入時替換的用字
PIPELINE_TABLE_HEADERS = {
    "review-methods.tsv": ["代碼", "名稱", "說明"],
    "review-statuses.tsv": ["代碼", "名稱", "說明"],
    "roster-characters.tsv": ["代碼", "字", "說明"],
}


# ==================================================
# 讀取
# ==================================================


def read_table(path, header, coded=True):
    """讀取一張 TSV 並檢查寫法。

    參數：
        path：檔案位置。
        header：預期的欄名串列，順序也要相同。
        coded：第一欄是代碼時檢查唯一與排序，各階段工具的工作表第一欄不是代碼時傳 False。
    回傳：每列一個 dict 的串列，鍵是欄名，值是移除前後空白的字串。
    例外：PipelineError，檔案不存在、表頭不符、欄數不符、有空白格，或第一欄是代碼而重複、未依碼位排序。
    """
    name = relative(path)
    lines = require(path).read_text(encoding="utf-8").split("\n")
    # 檔尾換行後切出的空字串不是資料列
    if lines and lines[-1] == "":
        lines.pop()
    # 表頭要與登錄的欄名逐欄相同，欄名不同時後續取欄會取錯
    if not lines or lines[0].split("\t") != header:
        # 空檔沒有表頭可以列出
        found = lines[0].split("\t") if lines else []
        raise PipelineError(f"{name} 的表頭是 {found}，預期 {header}")
    rows = []
    # 資料列從第 2 行起，行號用於錯誤訊息
    for number, line in enumerate(lines[1:], start=2):
        cells = line.split("\t")
        # 欄數不同表示少了 tab 或內容含 tab
        if len(cells) != len(header):
            raise PipelineError(
                f"{name}:{number} 有 {len(cells)} 欄，表頭是 {len(header)} 欄"
            )
        # 空白格無法分辨是漏填還是沒有值，沒有值一律寫 -
        if any(cell.strip() == "" for cell in cells):
            raise PipelineError(f"{name}:{number} 有空白儲存格，沒有值時寫 -")
        rows.append(dict(zip(header, (cell.strip() for cell in cells))))
    # 第一欄是代碼時，全部列讀完後檢查唯一與排序
    if coded:
        check_codes(name, rows, header[0])
    return rows


def check_codes(name, rows, column):
    """檢查代碼欄唯一且依碼位排序。

    參數：
        name：表的相對路徑，用於訊息。
        rows：read_table 讀取的列。
        column：代碼欄名，即第一欄。
    例外：PipelineError，代碼重複或未排序，排序錯誤時訊息附上排序指令。
    """
    # 依列序檢查重複，第一個重複的代碼就回報
    unique_index(rows, name, key=column)
    codes = [row[column] for row in rows]
    # 列序固定為碼位排序，差異比對時同一筆資料停在同一位置。Python 的字串本來就逐字比較碼位
    if codes != sorted(codes):
        raise PipelineError(
            f"{name} 的列沒有依代碼的碼位排序，執行 npm run pipeline -- tables --sort {name}"
        )


def config_table(file_name):
    """找出一張設定表所在的目錄與登錄的表頭。

    參數：
        file_name：檔名。
    回傳：`(檔案位置, 表頭)`。
    例外：PipelineError，檔名沒有登錄在任何一處。
    """
    # 網站也讀取的表在 config/tables/
    if file_name in TABLE_HEADERS:
        return TABLES_DIR / file_name, TABLE_HEADERS[file_name]
    # 只有管線讀取的表在 scripts/pipeline/tables/
    if file_name in PIPELINE_TABLE_HEADERS:
        return PIPELINE_TABLES_DIR / file_name, PIPELINE_TABLE_HEADERS[file_name]
    # 未登錄的表沒有可比對的表頭
    raise PipelineError(
        f"{file_name} 沒有登錄在 config/app/settings.json 的 tables，也不在 scripts/pipeline/tables.py 的 PIPELINE_TABLE_HEADERS"
    )


def read_config_table(file_name):
    """讀取一張登錄過的設定表，網站也讀取的表與只有管線讀取的表都由這裡讀取。

    參數：
        file_name：檔名，要登錄在 settings.json 的 tables 或本檔的 PIPELINE_TABLE_HEADERS。
    回傳：read_table 的結果。
    例外：PipelineError，檔名未登錄或表不合規格。
    """
    return read_table(*config_table(file_name))


def read_optional(path, header):
    """讀一張可以缺席的手寫表，檔案不存在時回傳空串列。

    參數：
        path：表的位置。
        header：預期表頭。
    回傳：read_table 的結果，檔案不存在時為空串列。
    """
    # 還沒有編碼的選舉與沒有單選題的主題測驗沒有這張表，回傳空清單
    if not path.exists():
        return []
    return read_table(path, header)


def review_names():
    """讀取方法與審核狀態的登錄名稱，各階段手寫表的這兩欄要寫這些名稱。

    回傳：`(方法名稱集合, 審核狀態名稱集合)`。
    """
    methods = {row["名稱"] for row in read_config_table("review-methods.tsv")}
    statuses = {row["名稱"] for row in read_config_table("review-statuses.tsv")}
    return methods, statuses


def review_fields(row, review, where):
    """核對一列的方法欄與審核狀態兩欄，轉成產物的兩個鍵。

    參數：
        row：手寫表的一列，含「方法」與「審核狀態」欄。
        review：review_names 的回傳值。
        where：錯誤訊息中的位置。
    回傳：`{"method", "review_status"}`。
    例外：PipelineError，任一欄不是登錄的名稱。
    """
    methods, statuses = review
    # 兩欄都要寫登錄的名稱，網站依此標示審核程度
    if row["方法"] not in methods or row["審核狀態"] not in statuses:
        raise PipelineError(f"{where} 的方法或審核狀態未登錄")
    return {"method": row["方法"], "review_status": row["審核狀態"]}


def by_code(rows, column="代碼"):
    """把列轉成以某欄為鍵的 dict，查表時以代碼或名稱取列。

    參數：
        rows：dict 的串列，read_table 讀取的列或產物的一個串列。
        column：當鍵的欄名，預設為代碼。
    回傳：dict。
    """
    return {row[column]: row for row in rows}


# ==================================================
# 儲存格
# ==================================================


def split_multi(cell):
    """解析多值儲存格。

    參數：
        cell：儲存格文字。
    回傳：值的串列，空值 - 為空串列。
    """
    # 空值沒有任何值
    if cell == EMPTY:
        return []
    return [part.strip() for part in cell.split(MULTI_SEPARATOR)]


def parse_optional(cell):
    """解析可以沒有值的文字欄。

    參數：
        cell：儲存格文字。
    回傳：字串，空值 - 回傳 None。
    """
    return None if cell == EMPTY else cell


def parse_bool(cell, where):
    """解析是非欄。

    參數：
        cell：儲存格文字。
        where：錯誤訊息中的位置，寫成「claims.tsv 的 C-001」。
    回傳：True 或 False。
    例外：PipelineError，值不是「是」或「否」。
    """
    # 只接受登錄的兩種寫法，表內的是非欄因此只有一種讀法
    if cell not in BOOLEANS:
        raise PipelineError(f"{where} 的是非欄寫了 {cell}，只能寫是或否")
    return BOOLEANS[cell]


def parse_number(cell, where):
    """解析數值欄。

    參數：
        cell：儲存格文字。
        where：錯誤訊息中的位置。
    回傳：float，空值 - 回傳 None，代表不適用。
    例外：PipelineError，寫了不能轉成數字的文字。
    """
    # 空值代表這一列沒有這個數值
    if cell == EMPTY:
        return None
    # 其餘的值要能轉成數字
    try:
        return float(cell)
    # 數值欄寫了文字，通常是欄位錯位
    except ValueError as error:
        raise PipelineError(f"{where} 的數值欄寫了 {cell}") from error


def parse_integer(cell, where):
    """解析整數欄：起訖、版本與層級。

    參數：
        cell：儲存格文字。
        where：錯誤訊息中的位置。
    回傳：int。
    例外：PipelineError，寫了 - 或不能轉成整數的文字。
    """
    # 整數欄每列都要有值，寫 - 或小數同樣回報位置
    try:
        return int(cell)
    # 整數欄寫了文字或小數，通常是欄位錯位
    except ValueError as error:
        raise PipelineError(f"{where} 的整數欄寫了 {cell}，要寫整數") from error


def check_axis(row, questions, axes, review):
    """核對 question-axes.tsv 的一列，選舉與主題測驗共用。

    參數：
        row：question-axes.tsv 的一列。
        questions、axes：可以對應的題目代碼與軸代碼，任何支援 in 的集合。
        review：review_names 的回傳值。
    回傳：產物中的一筆對應。
    例外：PipelineError，題目或軸未登錄、方向不是 1 或 -1、權重不大於 0，或審核欄未登錄。
    """
    where = f"question-axes.tsv 的 {row['代碼']}"
    # 題目與軸要是登錄的代碼
    if row["題目"] not in questions or row["軸"] not in axes:
        raise PipelineError(f"{where} 的題目或軸未登錄")
    # 方向與權重都是數值欄
    direction = parse_integer(row["方向"], where)
    weight = parse_number(row["權重"], where)
    # 方向決定同意時往哪一極，權重決定這題在軸上的份量
    if direction not in DIRECTIONS or weight is None or weight <= 0:
        raise PipelineError(f"{where} 的方向要是 1 或 -1，權重要大於 0")
    return {
        "id": row["代碼"],
        "question": row["題目"],
        "axis": row["軸"],
        "direction": direction,
        "weight": weight,
        "reason": row["理由"],
    } | review_fields(row, review, where)


def table_hash(file_names):
    """計算幾張設定表的合併雜湊，詞表雜湊以它算出並寫入分享網址。

    參數：
        file_names：登錄過的設定表檔名。
    回傳：依檔名排序後，以「檔名、換行、內容」串接的 sha256，檔案順序不影響結果。
    例外：PipelineError，檔名未登錄。
    """
    parts = [
        name + "\n" + config_table(name)[0].read_text(encoding="utf-8")
        for name in sorted(file_names)
    ]
    return sha256_text("\n".join(parts))


# ==================================================
# 整理
# ==================================================


def sort_table(path):
    """把一張 TSV 的資料列依第一欄碼位排序後寫回，表頭不動。

    參數：
        path：檔案位置。
    例外：PipelineError，檔案不存在。
    """
    lines = require(path).read_text(encoding="utf-8").rstrip("\n").split("\n")
    head, body = lines[0], lines[1:]
    # 只排資料列，排序鍵是第一欄
    body.sort(key=lambda line: line.split("\t")[0])
    path.write_text("\n".join([head, *body]) + "\n", encoding="utf-8")


def write_table(path, header, rows):
    """依表頭寫出一張 TSV，寫法與 read_table 讀取的相同。

    參數：
        path：檔案位置。
        header：欄名串列，依序寫出。
        rows：dict 的串列，鍵是欄名，值是字串。
    """
    lines = ["\t".join(header)] + [
        "\t".join(row[column] for column in header) for row in rows
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def read_draft(path, header):
    """讀取一份列序不拘的草稿表，先依代碼排序再以手寫表的規則檢查。

    參數：
        path：草稿檔，排序後寫回原處。
        header：預期的表頭。
    回傳：每列一個 dict 的串列。
    例外：PipelineError，檔案不存在、表頭不符、欄數不符、有空白格或代碼重複。
    """
    sort_table(path)
    return read_table(path, header)


def write_sorted(path, header, rows):
    """依代碼排序後寫出手寫表，各階段的工具以它寫回 repo 的表。

    參數：
        path：檔案位置，目錄不存在時建立。
        header：表頭。
        rows：每列一個 dict 的串列。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    write_table(path, header, sorted(rows, key=lambda row: row["代碼"]))


def conflicts(current, incoming):
    """找出同代碼而內容不同的列，合併前用它確認不會蓋掉既有的內容。

    參數：
        current：既有的列，依代碼索引。
        incoming：要併入的列。
    回傳：代碼串列，依 incoming 的順序。
    """
    return [
        row["代碼"]
        for row in incoming
        if row["代碼"] in current and current[row["代碼"]] != row
    ]


# ==================================================
# 設定表檢查
# ==================================================


def check_taxonomy(rows):
    """檢查分類樹的父子關係。

    權重沿分類樹往下分配，父節點缺席或層級跳號時，子面向分不到父節點的份額。
    參數：
        rows：taxonomy-issues.tsv 讀取的列。
    例外：PipelineError，根節點寫了父代碼、父代碼不存在、代碼不以父代碼開頭，或層級不是父節點加 1。
    """
    nodes = by_code(rows)
    # 逐列核對父節點
    for row in rows:
        where = f"taxonomy-issues.tsv 的 {row['代碼']}"
        level = parse_integer(row["層級"], where)
        # 第 1 層是議題的根，沒有父節點
        if level == 1:
            # 根節點的父代碼寫 -
            if row["父代碼"] != EMPTY:
                raise PipelineError(f"{where} 是第 1 層，父代碼要寫 -")
            continue
        # 第 2 層以下逐層往上核對
        parent = nodes.get(row["父代碼"])
        # 父節點要在表內
        if parent is None:
            raise PipelineError(f"{where} 的父代碼 {row['父代碼']} 不在表內")
        # 代碼以父代碼加一段組成，讀代碼就能知道所屬議題
        if not row["代碼"].startswith(row["父代碼"] + "."):
            raise PipelineError(f"{where} 的代碼要以父代碼 {row['父代碼']}. 開頭")
        # 層級逐層加 1，份額才能逐層往下分
        if level != parse_integer(parent["層級"], where) + 1:
            raise PipelineError(f"{where} 的層級要是父節點的層級加 1")


def misplaced_tables():
    """列出兩個設定表目錄中不該出現的表。

    回傳：問題的串列，每筆是一句說明，依目錄與檔名排序。沒有問題時是空串列。
    """
    # 每個目錄各自的登錄表，以及另一個目錄的登錄表與位置
    folders = (
        (TABLES_DIR, TABLE_HEADERS, PIPELINE_TABLE_HEADERS, PIPELINE_TABLES_DIR),
        (PIPELINE_TABLES_DIR, PIPELINE_TABLE_HEADERS, TABLE_HEADERS, TABLES_DIR),
    )
    problems = []
    # 兩個目錄各掃一次
    for folder, registered, elsewhere, home in folders:
        # 逐檔比對登錄表，登錄在本目錄的表不必處理
        for name in sorted(path.name for path in folder.glob("*.tsv")):
            # 登錄在本目錄的表位置正確
            if name in registered:
                continue
            # 登錄在另一個目錄的表放錯位置，程式讀不到這一份
            if name in elsewhere:
                problems.append(
                    f"{relative(folder / name)} 放錯目錄，要放在 {relative(home)}/"
                )
            # 兩處都沒有登錄的表沒有程式讀取，屬於孤兒檔
            else:
                problems.append(f"{relative(folder / name)} 沒有登錄")
    return problems


def check_config_tables():
    """檢查全部設定表：網站也讀取的表與只有管線讀取的表。

    除了各表的寫法，另外檢查分類樹的父子關係，以及兩個目錄沒有未登錄或放錯目錄的表。
    回傳：`(檔名, 列數)` 的串列，依檔名排序。
    例外：PipelineError，同一檔名登錄在兩處、任一表不合規格，或目錄中有未登錄、放錯目錄的表。
    """
    shared = sorted(set(TABLE_HEADERS) & set(PIPELINE_TABLE_HEADERS))
    # 同一檔名登錄在兩處時，讀取會取到哪一份取決於查表順序
    if shared:
        raise PipelineError(
            f"{'、'.join(shared)} 同時登錄在 settings.json 的 tables 與 PIPELINE_TABLE_HEADERS"
        )
    problems = misplaced_tables()
    # 放錯目錄與未登錄的表先回報，讀表時才不會只看到「找不到」
    if problems:
        raise PipelineError("設定表的位置不對：" + "；".join(problems))
    # 兩處登錄的表合在一起依檔名逐張讀取
    names = sorted([*TABLE_HEADERS, *PIPELINE_TABLE_HEADERS])
    results = [(name, len(read_config_table(name))) for name in names]
    check_taxonomy(read_config_table("taxonomy-issues.tsv"))
    return results
