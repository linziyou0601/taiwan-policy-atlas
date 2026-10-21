/* ==================================================
 * metrics/robustness.js - 敏感度與固定作答檢驗
 * --------------------------------------------------
 * - 角色：檢查排名對參數的敏感度（Kendall τ-b），以及全同意、全中立、全反對三種固定作答下的結果偏向
 * - 指令：import { sensitivity, fixedAnswerCheck } from "../metrics/robustness.js"
 * - 慣例：
 *   - 擾動以 settings.robustness 的種子產生，每次抽樣把公式權重與每題權重各乘上 [low, high] 的均勻亂數
 *   - τ-b 比較擾動後與目前設定的總分，1 表示排序完全相同
 *   - 固定作答沿用使用者的議題重視度，只把每題的答案換成同一個值，子題依該答案決定是否出現
 * ================================================== */

import { indexBy } from "../lib/objects.js";
import { mulberry32, kendallTauB, quantile } from "../lib/stats.js";
import { computeResults } from "./results.js";
import { uniformAnswers } from "./flow.js";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 以亂數擾動參數，統計排名的穩定度。
 * @param {object} model 資料模型。
 * @param {object} state 狀態。
 * @param {object} settings 設定。
 * @param {object} base 目前設定下的 computeResults 結果。
 * @returns {{ draws: { tau: number|null, top: boolean }[], taus: number[], median: number|null, min: number|null, topStable: number|null, count: number }} taus 是有定義的相關係數，沒有定義的已排除。
 */
function sensitivity(model, state, settings, base) {
  const { draws: count, seed, low, high } = settings.robustness;
  const random = mulberry32(seed);
  // 每次擾動的結果都與基準排名、基準分數比較
  const order = base.entities.map((entity) => entity.id);
  const baseScores = base.entities.map((entity) => entity.total ?? 0);
  const baseTop = base.entities[0]?.id ?? null;
  // 每次抽樣的排名相關係數與第一名是否不變，都存進同一份清單
  const draws = [];
  /**
   * 抽一個擾動倍數。
   * @returns {number}
   */
  const factor = () => low + (high - low) * random();
  // 候選人少於兩位時沒有排序可比
  if (order.length < 2) return { draws, taus: [], median: null, min: null, topStable: null, count: 0 };
  // 逐次抽樣重新計算
  for (let i = 0; i < count; i += 1) {
    const params = Object.fromEntries(Object.entries(settings.scoring.formulaParams).map(([key, value]) => [key, value * factor()]));
    const weights = new Map(base.questionIds.map((id) => [id, factor()]));
    // 同時擾動公式權重與題目權重，才能反映兩種不確定性對排名的影響
    const result = computeResults(model, state, settings, { params, weights });
    const byId = indexBy(result.entities);
    const scores = order.map((id) => byId.get(id).total ?? 0);
    // 第一名是否改變與整體排序的相關係數分開記錄，兩者衡量的穩定度不同
    draws.push({ tau: kendallTauB(baseScores, scores), top: result.entities[0]?.id === baseTop });
  }
  // 沒有定義的相關係數不納入統計，避免拉低中位數
  const taus = draws.map((draw) => draw.tau).filter((tau) => tau !== null);
  return {
    draws,
    taus,
    median: quantile(taus, 0.5),
    // 全部抽樣都沒有定義時最小值也沒有定義
    min: taus.length ? Math.min(...taus) : null,
    // 沒有抽樣時穩定比例沒有定義
    topStable: draws.length ? draws.filter((draw) => draw.top).length / draws.length : null,
    count: draws.length,
  };
}

/**
 * 以固定答案作答，檢查結果是否偏向某位候選人。
 * @param {object} model 資料模型。
 * @param {object} state 狀態，取選區與議題重視度。
 * @param {object} settings 設定。
 * @returns {{ answer: string, entities: object[] }[]}
 */
function fixedAnswerCheck(model, state, settings) {
  // 每種固定答案各算一次
  return settings.fixedAnswers.map((answer) => {
    const { answers } = uniformAnswers(model, state.scopeId, answer, state.importance);
    const result = computeResults(model, { ...state, answers }, settings);
    return { answer, entities: result.entities };
  });
}

/* ==================================================
 * 匯出
 * ================================================== */

export { sensitivity, fixedAnswerCheck };
