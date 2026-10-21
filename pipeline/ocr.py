"""政見影像的 OCR：編譯 Vision 工具並依影像雜湊快取結果。

抽取層對每張政見影像呼叫 Apple Vision 辨識文字。辨識結果與轉錄稿對照，用於計算轉錄稿與影像的相似度，段落文字一律取自轉錄稿。

指令：
  由抽取層呼叫 recognize，不單獨執行。

慣例：
  - 工具編譯在 .cache/tools/，原始檔的 sha256 記在旁邊的 stamp 檔，原始檔改變時重新編譯。
  - 辨識結果快取在 .cache/ocr/{影像 sha256}-{工具 sha256}.json，影像與工具都沒變時不重新執行。
  - 已提交在 extract.json 的結果，影像與工具雜湊相符時直接沿用，非 macOS 的環境也能重新執行抽取層。
"""

import json
import platform
import shutil
import subprocess

from .common import CACHE_ROOT, ROOT, PipelineError, sha256_file

# ==================================================
# 集中設定
# ==================================================

# Swift 原始檔、編譯產物與記錄原始檔雜湊的 stamp 檔
SOURCE = ROOT / "pipeline" / "ocr_vision.swift"
TOOL = CACHE_ROOT / "tools" / "ocr_vision"
STAMP = CACHE_ROOT / "tools" / "ocr_vision.sha256"

# 辨識結果的快取目錄
OCR_CACHE = CACHE_ROOT / "ocr"

# 單張影像的辨識逾時（秒），2126 像素寬的政見欄約需十秒，留足餘裕
TIMEOUT_SECONDS = 180


def ensure_tool(digest):
    """確保 Vision 工具已依目前的原始檔編譯。

    參數：
        digest：Swift 原始檔目前的 sha256。
    例外：PipelineError，不在 macOS 或找不到 swiftc。Vision 只在 macOS 提供。
    """
    # 已編譯而且原始檔沒有變動時沿用
    if TOOL.exists() and STAMP.exists() and STAMP.read_text().strip() == digest:
        return
    # Vision 框架只在 macOS 提供
    if platform.system() != "Darwin" or shutil.which("swiftc") is None:
        raise PipelineError(
            "OCR 需要 macOS 與 swiftc，其他平台沿用 extract.json 內已提交的結果"
        )
    # 以最佳化模式編譯到快取目錄
    TOOL.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["swiftc", "-O", str(SOURCE), "-o", str(TOOL)], check=True)
    # 編譯成功後才寫 stamp，編譯失敗時下次會再試
    STAMP.write_text(digest + "\n")


def recognize(image_path, previous=None):
    """辨識一張影像。

    參數：
        image_path：PNG 的位置。
        previous：extract.json 中這張影像上一次的結果，沒有時為 None。
    回傳：{"engine", "tool_sha256", "image_sha256", "lines"}。lines 每行有 text、confidence 與左上角為原點、0 到 1 的 x、y、width、height。
    例外：PipelineError，需要重新辨識但不在 macOS。subprocess.CalledProcessError，Vision 工具執行失敗。
    """
    image_digest = sha256_file(image_path)
    digest = sha256_file(SOURCE)
    # 影像與工具都沒變時沿用已提交的結果
    if (
        previous
        and previous.get("image_sha256") == image_digest
        and previous.get("tool_sha256") == digest
    ):
        return previous
    cached = OCR_CACHE / f"{image_digest}-{digest}.json"
    # 本機快取沒有時才執行辨識
    if not cached.exists():
        ensure_tool(digest)
        OCR_CACHE.mkdir(parents=True, exist_ok=True)
        # 工具直接寫入快取檔，失敗時 check=True 拋出，不留下快取
        subprocess.run(
            [str(TOOL), str(image_path), str(cached)],
            check=True,
            timeout=TIMEOUT_SECONDS,
        )
    # 產物記下兩個雜湊，下次可直接沿用
    raw = json.loads(cached.read_text(encoding="utf-8"))
    return {
        "engine": raw["engine"],
        "tool_sha256": digest,
        "image_sha256": image_digest,
        "lines": raw["lines"],
    }
