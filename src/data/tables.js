/* ==================================================
 * data/tables.js - 設定表的解析
 * --------------------------------------------------
 * - 角色：把 config/tables/ 的 TSV 依 settings.tables 宣告的欄名對應轉成物件，網站與測試共用同一份解析
 * - 指令：由 data/index.js 匯出，上一層 `import { parseTables } from "../data/index.js"`
 * - 慣例：
 *   - 欄位對應寫「英文鍵:型別」，型別 number 把 - 轉成 null，boolean 把是、否轉成 true、false
 *   - 表頭與宣告不符時拋出錯誤，管線的 tables 指令已檢查過同一份表，這裡不符表示建置與設定不一致
 * ================================================== */

import { parseDelimited, EMPTY_CELL } from "../lib/delimited.js";
import { SETTINGS } from "../config/index.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 是非欄的兩個值。
 */
const BOOLEANS = { 是: true, 否: false };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 依型別轉換一格。
 * @param {string} value 儲存格。
 * @param {string|undefined} type 型別。
 * @returns {unknown}
 */
function convert(value, type) {
  // 數值欄的空值轉成 null，其餘轉成數字
  if (type === "number") return value === EMPTY_CELL ? null : Number(value);
  // 是非欄轉成布林值
  if (type === "boolean") return BOOLEANS[value];
  return value;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 解析一張表。
 * @param {string} key settings.tables 的鍵。
 * @param {string} textContent TSV 內容。
 * @returns {object[]}
 */
function parseTable(key, textContent) {
  const spec = SETTINGS.tables[key];
  const { header, rows } = parseDelimited(textContent, "tsv");
  // 宣告的欄名清單，用來和實際表頭逐欄比對
  const expected = Object.keys(spec.fields);
  // 表頭要與宣告的欄名相同，否則欄位會取錯
  if (header.join("\t") !== expected.join("\t")) throw new Error(`${spec.file} 的表頭與 settings.tables.${key} 不符`);
  const fields = Object.entries(spec.fields).map(([column, target]) => [column, ...target.split(":")]);
  return rows.map((row) => Object.fromEntries(fields.map(([column, name, type]) => [name, convert(row[column], type)])));
}

/**
 * 解析全部設定表。
 * @param {Record<string, string>} texts settings.tables 的鍵對應 TSV 內容。
 * @returns {Record<string, object[]>}
 */
function parseTables(texts) {
  return Object.fromEntries(Object.keys(SETTINGS.tables).map((key) => [key, parseTable(key, texts[key])]));
}

/* ==================================================
 * 匯出
 * ================================================== */

export { parseTables };
