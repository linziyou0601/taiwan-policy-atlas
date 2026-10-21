/* ==================================================
 * registry/formulas.js - 總分公式
 * --------------------------------------------------
 * - 角色：把立場契合、具體度、議題重疊三個分項組成總分的公式，由 settings.scoring.formula 選用
 * - 指令：由 registry/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 分項是 0 到 1 的比例，沒有值的分項（例如資料不足）不納入分子與分母，不當成 0
 *   - 每個公式回傳 { value, terms }，terms 列出各分項的權重與代入值，info 依它寫出代入式
 * ================================================== */
import { weightedMean } from "../lib/stats.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} BlendResult 公式結果。
 * @property {number|null} value 總分，沒有任何分項時為 null。
 * @property {{ key: string, weight: number, value: number|null, used: boolean }[]} terms 各分項。
 */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 線性加權：Σ(權重 × 分項) / Σ(權重)，只加總有值的分項。
 * @param {Record<string, number|null>} parts 分項值。
 * @param {Record<string, number>} params 各分項的權重。
 * @returns {BlendResult}
 */
function linearBlend(parts, params) {
  const terms = Object.entries(params).map(([key, weight]) => {
    const value = parts[key] ?? null;
    // 權重為 0 或分項沒有值時不計入
    return { key, weight, value, used: value !== null && weight > 0 };
  });
  // 沒有可用的分項時總分沒有定義
  return { value: weightedMean(terms.filter((term) => term.used)), terms };
}

/**
 * 總分等於立場契合，具體度與議題重疊顯示在明細，權重為 0。
 * @param {Record<string, number|null>} parts 分項值。
 * @returns {BlendResult}
 */
function stanceOnly(parts) {
  // 只有立場分項的權重為 1，其他分項保留數值但標為未採用，畫面仍能顯示它們
  const terms = Object.entries(parts).map(([key, value]) => ({ key, weight: key === "stance" ? 1 : 0, value, used: key === "stance" && value !== null }));
  return { value: parts.stance ?? null, terms };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 公式登錄表。
 */
const FORMULAS = {
  linearBlend: linearBlend,
  stanceOnly: stanceOnly,
};

export { FORMULAS };
