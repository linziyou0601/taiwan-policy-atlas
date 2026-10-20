/* ==================================================
 * metrics/specificity.js - 具體度
 * --------------------------------------------------
 * - 角色：依具體度判準表為每則主張計分，再依使用者的題目權重彙總成候選人的具體度
 * - 指令：import { claimSpecificity, specificityScores } from "../metrics/specificity.js"
 * - 慣例：
 *   - 主張的具體度 = Σ(判準權重 × 級距數值) / Σ(判準權重)，不適用的判準不納入分母
 *   - 候選人對一題的具體度是配題主張具體度的加權平均，權重是 `分配 × 來源類型權重`
 *   - 候選人的具體度 = Σ(題目權重 × 該題具體度) / Σ(題目權重)，只加總已作答且候選人已表態的題目，與立場契合使用同一組題目
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 計算一則主張的具體度。
 * @param {object} model 資料模型。
 * @param {string} claimId 主張代碼。
 * @returns {{ value: number|null, rows: { criterion: object, level: string, value: number|null, row: object }[] }}
 */
function claimSpecificity(model, claimId) {
  const criteria = new Map(model.tables.specificity.map((row) => [row.code, row]));
  const levels = new Map(model.tables.levels.map((row) => [row.code, row]));
  // 每條判準取出對應的級距與分數，之後逐條加權
  const rows = (model.specificityByClaim.get(claimId) ?? []).map((row) => ({ criterion: criteria.get(row.criterion), level: row.level, value: row.value, row }));
  let numerator = 0;
  let denominator = 0;
  // 逐條判準加權，不適用的判準不計入分母
  for (const item of rows) {
    // 級距表標為不計入分母的級距在這裡排除
    if (!levels.get(item.level)?.counted || item.value === null) continue;
    numerator += item.criterion.weight * item.value;
    denominator += item.criterion.weight;
  }
  // 全部判準都不適用時沒有具體度，自訂主張也沒有評分
  return { value: denominator > 0 ? numerator / denominator : null, rows };
}

/**
 * 計算候選人的具體度。
 * @param {object} input 計算輸入。
 * @param {object} input.model 資料模型。
 * @param {Map<string, Map<string, object>>} input.stances 立場矩陣。
 * @param {Map<string, object>} input.stanceResults stanceScores 的結果，取逐題明細中計入的題目。
 * @returns {Map<string, { score: number|null, perQuestion: Map<string, number|null> }>}
 */
function specificityScores({ model, stances, stanceResults }) {
  const cache = new Map();
  /**
   * 取主張具體度，同一則主張只算一次。
   * @param {string} claimId 主張代碼。
   * @returns {number|null}
   */
  const scoreOf = (claimId) => {
    // 尚未算過時計算並快取
    if (!cache.has(claimId)) cache.set(claimId, claimSpecificity(model, claimId).value);
    return cache.get(claimId);
  };
  const results = new Map();
  // 逐位候選人計算
  for (const [entityId, result] of stanceResults) {
    let sum = 0;
    let total = 0;
    // 逐題記錄具體度，供明細畫面顯示每題的落差
    const perQuestion = new Map();
    // 只用計入立場契合、候選人已表態的題目
    for (const row of result.rows.filter((r) => r.counted && r.stance !== null)) {
      const items = stances.get(entityId).get(row.question).items.filter((item) => item.weight > 0 && scoreOf(item.claim.id) !== null);
      const weightSum = items.reduce((s, item) => s + item.weight, 0);
      // 這題的主張都沒有具體度評分時略過
      const value = weightSum > 0 ? items.reduce((s, item) => s + item.weight * scoreOf(item.claim.id), 0) / weightSum : null;
      perQuestion.set(row.question, value);
      // 有值才計入候選人的具體度
      if (value !== null) {
        sum += row.weight * value;
        total += row.weight;
      }
    }
    // 沒有任何可計的題目時沒有具體度
    results.set(entityId, { score: total > 0 ? sum / total : null, perQuestion });
  }
  return results;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { claimSpecificity, specificityScores };
