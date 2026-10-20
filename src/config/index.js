/* ==================================================
 * config/index.js - 設定與介面文案
 * --------------------------------------------------
 * - 角色：載入 config/app/ 的設定、版面與文案，提供文案查詢
 * - 指令：import { SETTINGS, LAYOUT, text } from "../config/index.js"
 * - 慣例：
 *   - 設定檔是唯一權威，程式讀取設定、從不寫回。使用者匯入的設定由 cards/session.js 以 deepMerge 合併成新物件，原設定不變
 *   - 文案以點分隔的鍵查詢，缺少的鍵直接拋出錯誤，避免畫面出現空白
 * ================================================== */

import SETTINGS from "../../config/app/settings.json" with { type: "json" };
import LAYOUT from "../../config/app/layout.json" with { type: "json" };
import LOCALE from "../../config/app/locale.zh-TW.json" with { type: "json" };
import { getPath } from "../lib/objects.js";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 查詢介面文案。
 * @param {string} key 點分隔的鍵，例如「quiz.next」。
 * @returns {any} 字串、陣列或物件。
 */
function text(key) {
  const value = getPath(LOCALE, key);
  // 缺少的文案是設定錯誤，直接讓開發時發現
  if (value === undefined) throw new Error(`locale 缺少 ${key}`);
  return value;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { SETTINGS, LAYOUT, text };
