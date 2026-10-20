/* ==================================================
 * cards/series.js - 候選人的系列色與翻牌後的政黨配色
 * --------------------------------------------------
 * - 角色：決定每位候選人用哪一個色票序號，以及翻牌後每個序號換成哪個政黨色，圖表、勾選列、外框與分享圖片共用
 * - 指令：import { seriesOf, partyPalette } from "./series.js"
 * - 慣例：
 *   - 色票序號依遮蔽順序指定，與號次、政黨無關。序號 0 留給使用者
 *   - 翻牌前沒有政黨配色，顏色不能洩漏身分
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { maskIndex } from "../metrics/index.js";
import { partyOf } from "./kit.js";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 候選人的色票序號，依遮蔽順序，從 1 起算。色票有 `charts.seriesCount` 種，序號 0 留給使用者，候選人多於色票數時循環使用。
 * @param {object} context 卡片情境。
 * @param {string} id 候選人。
 * @returns {number}
 */
function seriesOf(context, id) {
  return (maskIndex(context.model, id, context.entityIds) % SETTINGS.charts.seriesCount) + 1;
}

/**
 * 翻牌後的圖表配色：每個色票序號對到候選人的政黨色，淺色與深色主題各一個值，由 CSS 依主題選用。
 * 政黨表沒有登錄的黨，或同一選區有兩位以上同黨（含無黨籍）而同色時，該序號沿用中立的系列色。
 * @param {object} context 卡片情境。
 * @returns {Record<string, { light: string, dark: string }>|null} 鍵是色票序號，翻牌前為 null。
 */
function partyPalette(context) {
  // 翻牌前維持中立色，顏色不能洩漏身分
  if (!context.revealed) return null;
  const parties = context.entities.map((entity) => entity.party);
  const palette = {};
  // 逐位候選人查政黨色，同黨的不寫，避免兩位同色
  for (const entity of context.entities) {
    const mark = partyOf(context, entity.id).mark;
    // 政黨表有色票且黨名在選區內只出現一次時才採用
    if (mark && parties.filter((name) => name === entity.party).length === 1) palette[seriesOf(context, entity.id)] = mark;
  }
  return palette;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { seriesOf, partyPalette };
