"""TSV 表的讀取、規格檢查與儲存格解析。

用途：讀取 config/tables/ 的設定表、各層手寫的表與主題測驗的手寫表，檢查表頭、欄數、空白格、代碼唯一與碼位排序，並解析多值、空值、是非、數值與整數儲存格。
指令：`python -m pipeline tables` 檢查全部設定表，加 `--sort <檔名>` 先把該表依代碼排序。其他模組以 read_table 或 read_config_table 讀表。
慣例：
  - 第一欄是代碼，每個代碼一列，列依代碼的 Unicode 碼位排序，列序不承載規則。
  - 多值以頓號分隔，空值寫 -，是非欄寫「是」或「否」，每格都要有值。空值的寫法定義在本檔的 EMPTY，各層從這裡匯入。
  - 設定表的檔名與表頭取自 config/app/settings.json 的 tables，網站與管線讀同一份欄名。目錄中有未登錄的表時檢查失敗，避免孤兒表。
"""

from .common import TABLES_DIR, PipelineError, app_settings, relative, sha256_text

# ---- 寫法常數 ----

# 多值儲存格的分隔字元
MULTI_SEPARATOR = "、"

# 空值的寫法，與 TSV 規格一致，各層的手寫表與設定表共用
EMPTY = "-"

# 是非欄允許的值與對應的布林值
BOOLEANS = {"是": True, "否": False}

# 設定表的表頭：檔名對應依序的欄名，取自 settings.json 的 `tables.*.fields`，讀表時逐欄比對，表頭不符時讀取失敗
TABLE_HEADERS = {
    table["file"]: list(table["fields"]) for table in app_settings()["tables"].values()
}


def code_point_key(text):
    """排序鍵：逐字取 Unicode 碼位，與 TSV 規格的「依碼位排序」相同。

    參數：
        text：代碼字串。
    回傳：碼位的串列，串列比較即逐字比較。
    """
    return [ord(char) for char in text]


# ---- 讀取 ----


def read_table(path, header):
    """讀取一張 TSV 並檢查寫法。

    參數：
        path：檔案位置。
        header：預期的欄名串列，順序也要相同。
    回傳：每列一個 dict 的串列，鍵是欄名，值是移除前後空白的字串。
    例外：PipelineError，檔案不存在、表頭不符、欄數不符、有空白格、代碼重複或未依碼位排序。
    """
    name = relative(path)
    # 檔案缺席時寫出位置
    if not path.exists():
        raise PipelineError(f"找不到 {name}")
    lines = path.read_text(encoding="utf-8").split("\n")
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
    # 第一欄是代碼，全部列讀完後檢查唯一與排序
    check_codes(name, rows, header[0])
    return rows


def check_codes(name, rows, column):
    """檢查代碼欄唯一且依碼位排序。

    參數：
        name：表的相對路徑，用於訊息。
        rows：read_table 讀出的列。
        column：代碼欄名，即第一欄。
    例外：PipelineError，代碼重複或未排序，排序錯誤時訊息附上排序指令。
    """
    codes = [row[column] for row in rows]
    seen = set()
    # 依列序檢查重複，第一個重複的代碼就回報
    for code in codes:
        # 同一代碼兩列時，其他表引用它會有兩種解讀
        if code in seen:
            raise PipelineError(f"{name} 的代碼 {code} 重複")
        seen.add(code)
    # 列序固定為碼位排序，差異比對時同一筆資料停在同一位置
    if codes != sorted(codes, key=code_point_key):
        raise PipelineError(
            f"{name} 的列沒有依代碼的碼位排序，執行 python -m pipeline tables --sort {path_name(name)}"
        )


def path_name(name):
    """從相對路徑取出檔名，排序指令只接受 config/tables/ 下的檔名。

    參數：
        name：相對路徑。
    回傳：最後一段檔名。
    """
    return name.split("/")[-1]


def read_config_table(file_name):
    """讀取 config/tables/ 下一張登錄過的設定表。

    參數：
        file_name：檔名，要登錄在 settings.json 的 tables。
    回傳：read_table 的結果。
    例外：PipelineError，檔名未登錄或表不合規格。
    """
    # 未登錄的表沒有可比對的表頭
    if file_name not in TABLE_HEADERS:
        raise PipelineError(
            f"{file_name} 沒有登錄在 config/app/settings.json 的 tables"
        )
    return read_table(TABLES_DIR / file_name, TABLE_HEADERS[file_name])


def read_optional(path, header):
    """讀一張可以缺席的手寫表，檔案不存在時回傳空串列。

    參數：
        path：表的位置。
        header：預期表頭。
    回傳：read_table 的結果，檔案不存在時為空串列。
    """
    # 沒有這張表時回傳空清單，例如尚未編碼的選舉，或沒有單選題的主題測驗
    if not path.exists():
        return []
    return read_table(path, header)


def review_names():
    """讀取方法與審核狀態的登錄名稱，各層手寫表的這兩欄要寫這些名稱。

    回傳：`(方法名稱集合, 審核狀態名稱集合)`。
    """
    methods = {row["名稱"] for row in read_config_table("review-methods.tsv")}
    statuses = {row["名稱"] for row in read_config_table("review-statuses.tsv")}
    return methods, statuses


def check_review(row, review, where):
    """核對一列的方法欄與審核狀態兩欄。

    參數：
        row：手寫表的一列，含「方法」與「審核狀態」欄。
        review：review_names 的回傳值。
        where：錯誤訊息中的位置。
    例外：PipelineError，任一欄不是登錄的名稱。
    """
    methods, statuses = review
    # 兩欄都要寫登錄的名稱，網站依此標示審核程度
    if row["方法"] not in methods or row["審核狀態"] not in statuses:
        raise PipelineError(f"{where} 的方法或審核狀態未登錄")


def by_code(rows, column="代碼"):
    """把列轉成以某欄為鍵的 dict，查表時以代碼或名稱取列。

    參數：
        rows：read_table 讀出的列。
        column：當鍵的欄名，預設為代碼，以名稱查表時傳「名稱」。
    回傳：dict。
    """
    return {row[column]: row for row in rows}


# ---- 儲存格 ----


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


def parse_bool(cell, where):
    """解析是非欄。

    參數：
        cell：儲存格文字。
        where：錯誤訊息中的位置，例如「claims.tsv 的 C-001」。
    回傳：True 或 False。
    例外：PipelineError，值不是「是」或「否」。
    """
    # 只接受登錄的寫法，避免 Y、true 等各種寫法混用
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
    """解析整數欄，例如起訖、版本與層級。

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


def table_hash(file_names):
    """計算幾張設定表的合併雜湊，詞表雜湊以它算出並寫進分享網址。

    參數：
        file_names：config/tables/ 下的檔名。
    回傳：依檔名排序後，以「檔名、換行、內容」串接的 sha256，檔案順序不影響結果。
    """
    parts = [
        name + "\n" + (TABLES_DIR / name).read_text(encoding="utf-8")
        for name in sorted(file_names)
    ]
    return sha256_text("\n".join(parts))


# ---- 整理 ----


def sort_table(path):
    """把一張 TSV 的資料列依第一欄碼位排序後寫回，表頭不動。

    參數：
        path：檔案位置。
    """
    lines = path.read_text(encoding="utf-8").rstrip("\n").split("\n")
    head, body = lines[0], lines[1:]
    # 只排資料列，排序鍵是第一欄的碼位
    body.sort(key=lambda line: code_point_key(line.split("\t")[0]))
    path.write_text("\n".join([head, *body]) + "\n", encoding="utf-8")


def check_taxonomy(rows):
    """檢查分類樹的父子關係。

    權重沿分類樹往下分配，父節點缺席或層級跳號時，子面向分不到父節點的份額。
    參數：
        rows：taxonomy-issues.tsv 讀出的列。
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


def check_config_tables():
    """檢查全部設定表。

    除了各表的寫法，另外檢查分類樹的父子關係。
    回傳：`(檔名, 列數)` 的串列，依檔名排序。
    例外：PipelineError，任一表不合規格，或目錄中有未登錄的表。
    """
    results = [(name, len(read_config_table(name))) for name in sorted(TABLE_HEADERS)]
    check_taxonomy(read_config_table("taxonomy-issues.tsv"))
    # 目錄中有、登錄表沒有的檔名
    unknown = sorted(
        path.name for path in TABLES_DIR.glob("*.tsv") if path.name not in TABLE_HEADERS
    )
    # 未登錄的表沒有程式讀取，屬於孤兒檔
    if unknown:
        raise PipelineError(f"config/tables/ 有未登錄的表：{'、'.join(unknown)}")
    return results
