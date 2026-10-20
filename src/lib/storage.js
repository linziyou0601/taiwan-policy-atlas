/* ==================================================
 * lib/storage.js - localStorage 的安全讀寫
 * --------------------------------------------------
 * - 角色：讀寫瀏覽器 localStorage，私密瀏覽或停用儲存時不讓頁面出錯
 * - 指令：import { readStore, writeStore } from "../lib/storage.js"
 * - 慣例：值以 JSON 存放，讀取失敗或內容損壞時回傳 null，寫入失敗回傳 false，呼叫端決定如何提示
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 讀取一個鍵。
 * @param {string} key 鍵。
 * @returns {unknown|null}
 */
function readStore(key) {
  // 停用儲存時 localStorage 存取會拋出例外
  try {
    const text = globalThis.localStorage?.getItem(key);
    // 沒有存過時是 null
    return text ? JSON.parse(text) : null;
  } catch {
    // 讀不到或 JSON 損壞都視為沒有存過
    return null;
  }
}

/**
 * 寫入一個鍵。
 * @param {string} key 鍵。
 * @param {unknown} value 可以 JSON 化的值。
 * @returns {boolean} 是否寫入成功。
 */
function writeStore(key, value) {
  // 空間不足或停用儲存時會拋出例外
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 寫入失敗交給呼叫端提示
    return false;
  }
}

/* ==================================================
 * 匯出
 * ================================================== */

export { readStore, writeStore };
