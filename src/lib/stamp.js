/* ==================================================
 * lib/stamp.js - 格式戳記
 * --------------------------------------------------
 * - 角色：每種產物與匯出檔都以 format 與 format_version 兩欄標示格式，本檔寫出與核對這兩欄
 * - 指令：import { formatStamp, hasFormat } from "../lib/stamp.js"
 * - 慣例：
 *   - 格式的名稱與版本取自 settings.json 的 formats，管線、建置與網站用同一份設定
 *   - 名稱或版本任一不同都視為不相容，舊格式的檔案不能用新程式讀
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 寫出格式戳記的兩欄。
 * @param {{ name: string, version: number }} format settings.formats 的一筆。
 * @returns {{ format: string, format_version: number }}
 */
function formatStamp(format) {
  return { format: format.name, format_version: format.version };
}

/**
 * 核對一份資料的格式戳記。
 * @param {object|null|undefined} stamp 寫著 format 與 format_version 的那一層。
 * @param {{ name: string, version: number }} format 預期的格式。
 * @returns {boolean}
 */
function hasFormat(stamp, format) {
  return stamp?.format === format.name && stamp?.format_version === format.version;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { formatStamp, hasFormat };
