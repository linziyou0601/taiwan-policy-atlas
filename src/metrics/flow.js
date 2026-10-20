/* ==================================================
 * metrics/flow.js - 作答路徑
 * --------------------------------------------------
 * - 角色：決定一個選區要作答哪些題目、依什麼順序，子題依母題的答案出現
 * - 指令：import { scopeQuestions, visibleQuestions } from "../metrics/flow.js"
 * - 慣例：
 *   - 路徑只由題目順序、選區與答案決定，同一組答案重新執行得到同一條路徑，分享連結因此可以重播
 *   - 議題重視度設為 0 的面向不出題，其題目的權重為 0
 *   - 題目要有本選區候選人的配題，或題目明列適用本選區，才算本選區的題目
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { lineage } from "../data/index.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} FlowItem 路徑上的一題。
 * @property {string} id 題目代碼。
 * @property {number} depth 母題為 0，子題逐層加 1。
 * @property {string|null} parent 母題代碼。
 */

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 判斷題目是否屬於本選區。
 * @param {object} model 資料模型。
 * @param {object} question 題目。
 * @param {Set<string>} entityIds 本選區的參選對象。
 * @param {string} scopeId 選區代碼。
 * @returns {boolean}
 */
function inScope(model, question, entityIds, scopeId) {
  // 題目明列適用範圍時以範圍為準
  if (question.scopes.length) return question.scopes.includes(scopeId);
  const mappings = model.mappingsByQuestion.get(question.id) ?? [];
  return mappings.some((mapping) => entityIds.has(model.claims.get(mapping.claim)?.entity));
}

/**
 * 判斷題目所在的面向是否設為不重視。
 * @param {object} model 資料模型。
 * @param {string} facet 面向代碼。
 * @param {Record<string, number>} importance 使用者設定的重視度。
 * @returns {boolean} 面向或任一祖先為 0 時為 true。
 */
function muted(model, facet, importance) {
  // 沿分類樹往上，任一層被使用者明確設為 0 就不出題
  return lineage(model.taxonomy, facet).some((code) => importance[code] === 0);
}

/**
 * 作答紀錄是否表達了立場：有作答且不是略過。計分、意識形態軸與追問都只看這類作答。
 * @param {{ answer: string }|undefined} entry 一題的作答紀錄。
 * @returns {boolean}
 */
function isStated(entry) {
  return Boolean(entry?.answer) && entry.answer !== SETTINGS.flow.skipAnswer;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 列出選區內的全部題目，依作答順序。
 * @param {object} model 資料模型。
 * @param {string} scopeId 選區代碼。
 * @returns {object[]}
 */
function scopeQuestions(model, scopeId) {
  const entityIds = new Set((model.entitiesByScope.get(scopeId) ?? []).map((entity) => entity.id));
  return model.questionOrder.map((id) => model.questions.get(id)).filter((question) => inScope(model, question, entityIds, scopeId));
}

/**
 * 依答案列出目前要作答的題目。
 * @param {object} model 資料模型。
 * @param {string} scopeId 選區代碼。
 * @param {Record<string, { answer: string }>} answers 目前的答案，鍵是題目代碼。
 * @param {Record<string, number>} importance 議題重視度。
 * @returns {FlowItem[]}
 */
function visibleQuestions(model, scopeId, answers, importance) {
  const questions = scopeQuestions(model, scopeId);
  const shown = new Map();
  // 結果依走訪順序累積，同時保留題目的原始排序
  const result = [];
  // 題目已依母題在前的順序排列，一次走訪即可決定子題是否出現
  for (const question of questions) {
    // 不重視的面向不出題
    if (muted(model, question.facet, importance)) continue;
    // 根題一律出現
    if (!question.parent) {
      shown.set(question.id, 0);
      result.push({ id: question.id, depth: 0, parent: null });
      // 根題不受母題條件限制，記錄後直接處理下一題
      continue;
    }
    const entry = answers[question.parent];
    // 子題要母題出現，且母題的答案在顯示條件內，略過母題時不追問
    if (shown.has(question.parent) && isStated(entry) && question.conditions.includes(entry.answer)) {
      const depth = shown.get(question.parent) + 1;
      shown.set(question.id, depth);
      // 子題的層級比母題深一層，供畫面縮排與追問顯示使用
      result.push({ id: question.id, depth, parent: question.parent });
    }
  }
  return result;
}

/**
 * 以同一個答案回答全部題目，固定作答檢驗以它模擬路徑。
 * @param {object} model 資料模型。
 * @param {string} scopeId 選區代碼。
 * @param {string} answer 量尺代碼。
 * @param {Record<string, number>} importance 議題重視度。
 * @returns {{ items: FlowItem[], answers: Record<string, { answer: string }> }}
 */
function uniformAnswers(model, scopeId, answer, importance) {
  const answers = {};
  // 先讓全部題目都有答案，子題是否出現再由路徑決定
  for (const question of scopeQuestions(model, scopeId)) answers[question.id] = { answer };
  return { items: visibleQuestions(model, scopeId, answers, importance), answers };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { scopeQuestions, visibleQuestions, uniformAnswers, isStated };
