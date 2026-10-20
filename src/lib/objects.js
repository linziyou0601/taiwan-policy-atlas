/* ==================================================
 * lib/objects.js - 物件與串列的通用工具
 * --------------------------------------------------
 * - 角色：依路徑取值與設值、深層合併、串列分組與建索引，與專案的資料內容無關
 * - 指令：import { getPath, setPath, deepMerge, groupBy, indexBy, hasValue, uniqueValues } from "../lib/objects.js"
 * - 慣例：所有函式都回傳新物件，不改動傳入的物件
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依點分隔的路徑取值。
 * @param {object} source 物件。
 * @param {string} path 路徑，例如「scoring.formulaParams.stance」。
 * @returns {unknown} 找不到時為 undefined。
 */
function getPath(source, path) {
  // 路徑中途遇到空值就停止下探，避免讀取空值的屬性而出錯
  return path.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), source);
}

/**
 * 依路徑設值，回傳新物件，沿路複製，不改動原物件。
 * @param {object} source 物件。
 * @param {string} path 路徑。
 * @param {unknown} value 新值。
 * @returns {object}
 */
function setPath(source, path, value) {
  const [head, ...rest] = path.split(".");
  // 最後一段直接換值，其餘各段遞迴複製
  const next = rest.length ? setPath(source?.[head] ?? {}, rest.join("."), value) : value;
  return { ...source, [head]: next };
}

/**
 * 判斷是否為純物件（不是陣列或 null）。
 * @param {unknown} value 值。
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 深層合併，覆蓋值的物件逐鍵合併，陣列與純量整個取代。
 * @param {object} base 基礎。
 * @param {object} patch 覆蓋。
 * @returns {object}
 */
function deepMerge(base, patch) {
  const result = { ...base };
  // 逐鍵合併，雙方都是物件時遞迴
  for (const [key, value] of Object.entries(patch ?? {})) {
    const both = isPlainObject(value) && isPlainObject(base?.[key]);
    // 兩邊都是物件才遞迴合併，否則以覆蓋值直接取代
    result[key] = both ? deepMerge(base[key], value) : value;
  }
  return result;
}

/**
 * 依鍵把串列分組。
 * @param {object[]} items 串列。
 * @param {(item: object) => string} keyOf 取鍵函式。
 * @returns {Map<string, object[]>}
 */
function groupBy(items, keyOf) {
  const groups = new Map();
  // 逐項放進所屬的組
  for (const item of items) {
    const key = keyOf(item);
    // 第一次遇到的鍵建立新組
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * 以代碼建立索引。
 * @param {object[]} items 串列。
 * @param {string} [key="id"] 代碼欄。
 * @returns {Map<string, object>}
 */
function indexBy(items, key = "id") {
  return new Map(items.map((item) => [item[key], item]));
}

/**
 * 值是否存在：null 與 undefined 都視為沒有值，0、空字串與 false 都算有值。
 * @param {unknown} value 值。
 * @returns {boolean}
 */
function hasValue(value) {
  return value !== null && value !== undefined;
}

/**
 * 去掉內容相同的元素，保留第一次出現的順序。物件依 JSON 內容比較，字串與數字依值比較。
 * @param {unknown[]} items 元素。
 * @returns {unknown[]}
 */
function uniqueValues(items) {
  const seen = new Set();
  // 以 JSON 字串當比較鍵，內容相同的兩個物件視為重複
  return items.filter((item) => {
    const key = JSON.stringify(item);
    // 已出現過的內容略過，第一次出現時保留並記下
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ==================================================
 * 匯出
 * ================================================== */

export { getPath, setPath, deepMerge, groupBy, indexBy, hasValue, uniqueValues };
