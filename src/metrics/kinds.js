/* ==================================================
 * metrics/kinds.js - 各種題組的作答路徑與計分
 * --------------------------------------------------
 * - 角色：依模型的 kind 選用作答路徑與計分函式，卡片層呼叫 questionsFor 與 resultsFor，種類的分派留在本層
 * - 指令：import { questionsFor, resultsFor } from "../metrics/kinds.js"
 * - 慣例：新增一種題組時在 ENGINES 登錄兩個函式，資料層的 MODEL_BUILDERS 登錄模型，卡片依 layout 的 kinds 選用
 * ================================================== */

import { scopeQuestions, visibleQuestions } from "./flow.js";
import { computeResults } from "./results.js";
import { topicQuestions, computeTopic } from "./topic.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 還沒有題目時的作答路徑，例如選舉還沒選選區。
 */
const NO_QUESTIONS = Object.freeze({ all: [], visible: [] });

/**
 * 各種題組的作答路徑與計分，鍵是模型的 kind。
 * - questions(model, state)：全部題目與依答案出現的題目
 * - results(model, state, settings)：計分結果，條件不足時為 null
 */
const ENGINES = {
  election: {
    // 選舉的題目依選區決定，還沒選選區時沒有題目
    questions: (model, state) => (state.scopeId ? { all: scopeQuestions(model, state.scopeId), visible: visibleQuestions(model, state.scopeId, state.answers, state.importance) } : NO_QUESTIONS),
    // 選舉在選定選區後才能計分
    results: (model, state, settings) => (state.scopeId ? computeResults(model, state, settings) : null),
  },
  topic: {
    // 主題測驗的題目全部出現
    questions: (model) => topicQuestions(model),
    // 主題測驗的結果只由作答決定，計分參數是選舉比對的設定
    results: (model, state) => computeTopic(model, state),
  },
};

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依模型的種類取得作答路徑與計分函式。
 * @param {object} model 資料模型。
 * @returns {{ questions: Function, results: Function }}
 */
function engineOf(model) {
  const engine = ENGINES[model.kind];
  // 不認得的種類是索引或程式錯誤，寫出種類名稱
  if (!engine) throw new Error(`沒有登錄題組種類 ${model.kind} 的計分`);
  return engine;
}

/**
 * 全部題目與依答案出現的題目。
 * @param {object} model 資料模型。
 * @param {object} state 狀態。
 * @returns {{ all: object[], visible: { id: string, depth: number, parent: string|null }[] }}
 */
function questionsFor(model, state) {
  return engineOf(model).questions(model, state);
}

/**
 * 目前狀態下的計分結果。
 * @param {object} model 資料模型。
 * @param {object} state 狀態。
 * @param {object} settings 合併使用者參數後的設定。
 * @returns {object|null}
 */
function resultsFor(model, state, settings) {
  return engineOf(model).results(model, state, settings);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { questionsFor, resultsFor };
