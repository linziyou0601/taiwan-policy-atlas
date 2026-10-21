"""ZIP 封存檔的成員解析，還原以中文命名、未標記 UTF-8 的檔名。

中選會的封存檔以 cp950 寫入檔名，沒有設定 UTF-8 旗標。ZIP 規格規定沒有旗標的檔名以 cp437 解讀，Python 因此解碼為亂碼，這裡把它還原為正確的中文，名冊與公報 adapter 共用。

指令：
  由 adapter 匯入，不單獨執行。

慣例：
  - 檔名編碼取自 sources.yaml 的 name_encoding。有 UTF-8 旗標的成員沿用 Python 解碼的名稱。兩個原始成員還原為同一個名稱時拋出錯誤，避免覆蓋。
"""

import zipfile

from ..common import PipelineError

# ZIP 一般用途旗標中，表示檔名以 UTF-8 編碼的位元
UTF8_FLAG = 0x800


def decode_name(info, encoding):
    """還原一個成員的檔名。

    參數：
        info：zipfile.ZipInfo。
        encoding：來源登錄的 name_encoding，例如 cp950。
    回傳：還原後的檔名。
    """
    # 有 UTF-8 旗標的名稱已由 Python 正確解出
    if info.flag_bits & UTF8_FLAG:
        return info.filename
    # 沒有旗標的名稱先以 cp437 取回原始位元組，再以來源的編碼解讀
    try:
        return info.filename.encode("cp437").decode(encoding)
    except (UnicodeEncodeError, UnicodeDecodeError):
        # 執行環境已用其他方式解出 Unicode 名稱，或位元組不是該編碼，沿用原值讓後續的成員查詢寫出實際名稱
        return info.filename


def open_members(path, encoding):
    """開啟封存檔並建立「還原後檔名」到成員的索引。

    參數：
        path：封存檔位置。
        encoding：檔名編碼。
    回傳：(ZipFile, dict)，dict 的鍵是還原後的檔名，值是 ZipInfo。
    例外：PipelineError，兩個成員還原成同一個名稱。
    """
    archive = zipfile.ZipFile(path)
    members = {}
    # 每個成員以還原後的名稱建索引
    for info in archive.infolist():
        name = decode_name(info, encoding)
        # 同名時無法分辨設定引用的是哪一個成員
        if name in members:
            raise PipelineError(f"{path.name} 內有兩個成員都還原成 {name}")
        members[name] = info
    return archive, members


def read_member(archive, members, name):
    """讀取一個成員的位元組。

    參數：
        archive：open_members 回傳的 ZipFile。
        members：open_members 回傳的索引。
        name：還原後的檔名，即選舉設定寫的路徑。
    回傳：bytes。
    例外：PipelineError，成員不存在，通常是設定的路徑或檔名編碼寫錯。
    """
    # 設定寫的路徑要真的在封存檔內
    if name not in members:
        raise PipelineError(
            f"封存檔內找不到 {name}，檢查選舉設定的路徑與 sources.yaml 的 name_encoding"
        )
    return archive.read(members[name])
