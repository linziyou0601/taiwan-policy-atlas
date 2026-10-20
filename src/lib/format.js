/* ==================================================
 * lib/format.js - 數字與文字的格式化
 * --------------------------------------------------
 * - 角色：把計算結果轉成顯示字串，百分比、小數位與文字樣板的代入集中在這裡
 * - 指令：import { percent, fixed, fill, clamp, shortHash } from "../lib/format.js"
 * - 慣例：沒有值（null、undefined、NaN）時回傳呼叫端給的缺值文字，不回傳 0。缺值文字屬於介面文案，由呼叫端從 locale 傳入
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 雜湊短寫保留的碼數。
 */
const SHORT_HASH = 12;

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 判斷數值是否可以顯示。
 * @param {unknown} value 數值。
 * @returns {boolean}
 */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 把 0 到 1 的比例寫成百分比。
 * @param {number|null} value 比例。
 * @param {number} [digits=0] 小數位數。
 * @param {string} [missing=""] 缺值時的文字。
 * @returns {string}
 */
function percent(value, digits = 0, missing = "") {
  // 缺值不寫成 0%，避免和真的 0 混淆
  if (!isNumber(value)) return missing;
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * 寫成固定小數位。
 * @param {number|null} value 數值。
 * @param {number} [digits=2] 小數位數。
 * @param {string} [missing=""] 缺值時的文字。
 * @returns {string}
 */
function fixed(value, digits = 2, missing = "") {
  // 缺值時回傳缺值文字
  if (!isNumber(value)) return missing;
  return value.toFixed(digits);
}

/**
 * 把樣板中的 {鍵} 換成值。
 * @param {string} template 樣板，例如「第 {n} 題」。
 * @param {Record<string, unknown>} [values] 代入的值。
 * @returns {string}
 */
function fill(template, values = {}) {
  // 找不到的鍵保留原樣，方便發現漏給的值
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

/**
 * 限制數值在範圍內。
 * @param {number} value 數值。
 * @param {number} low 下限。
 * @param {number} high 上限。
 * @returns {number}
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * 雜湊的短寫：畫面與紀錄只顯示前幾碼，完整值另以 title 或檔案提供。
 * @param {string} hash 十六進位雜湊。
 * @returns {string}
 */
function shortHash(hash) {
  return hash.slice(0, SHORT_HASH);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { percent, fixed, fill, clamp, shortHash };
