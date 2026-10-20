/* ==================================================
 * metrics/stance.js - 候選人立場與立場契合
 * --------------------------------------------------
 * - 角色：彙總每位候選人對每題的立場，與使用者的答案比對，算出立場契合、涵蓋率與缺值上下界
 * - 指令：import { candidateStance, sharedSources, stanceScores } from "../metrics/stance.js"
 * - 慣例：
 *   - 立場：以彙總規則合併各筆配題的立場，權重是 `分配 × 來源類型權重`，規則由 settings.scoring.stanceAggregate 選用
 *   - 沒有配題或權重合計為 0 時記為未表態（未知），不記為中立，也不算 0 分，另計入涵蓋率
 *   - 略過的題目不計入分子與分母。共識題預設不納入排序，仍列在逐題明細
 *   - 「只比雙方都有的來源」模式下，只採用全部候選人都有主張的來源類型
 *   - 「只比共同題」開啟時，只計入全部候選人都已表態的題目
 * ================================================== */

import { resolve } from "../registry/index.js";
import { isStated } from "./flow.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} StanceResult 一位候選人對一題的立場。
 * @property {number|null} value 彙總立場，未表態為 null。
 * @property {{ mapping: object, claim: object, weight: number, value: number }[]} items 參與彙總的配題。
 */

/**
 * @typedef {object} QuestionRow 逐題明細的一列。
 * @property {string} question 題目代碼。
 * @property {number} weight 題目權重。
 * @property {number} answer 使用者作答數值。
 * @property {number|null} stance 候選人立場。
 * @property {number|null} agreement 契合度。
 * @property {boolean} consensus 是否為共識題。
 * @property {boolean} common 是否為全部候選人都已表態的共同題。
 * @property {boolean} counted 是否計入立場契合。
 */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 找出全部候選人都有主張的來源類型。
 * @param {object} model 資料模型。
 * @param {string[]} entityIds 參與比較的候選人。
 * @returns {Set<string>}
 */
function sharedSources(model, entityIds) {
  const sets = entityIds.map((id) => new Set((model.claimsByEntity.get(id) ?? []).map((claim) => claim.source_type)));
  // 沒有候選人時沒有共同來源
  if (!sets.length) return new Set();
  return new Set([...sets[0]].filter((type) => sets.every((set) => set.has(type))));
}

/**
 * 彙總一位候選人對一題的立場。
 * @param {object} model 資料模型。
 * @param {string} entityId 候選人。
 * @param {string} questionId 題目。
 * @param {(items: object[]) => number|null} aggregate 彙總規則，由呼叫端依設定選用一次後傳入。
 * @param {Set<string>|null} allowed 允許的來源類型，null 表示全部。
 * @returns {StanceResult}
 */
function candidateStance(model, entityId, questionId, aggregate, allowed) {
  const items = [];
  // 逐筆配題取出屬於這位候選人的主張
  for (const mapping of model.mappingsByQuestion.get(questionId) ?? []) {
    const claim = model.claims.get(mapping.claim);
    // 只收這位候選人、且來源類型在允許範圍內的主張
    if (claim.entity !== entityId || (allowed && !allowed.has(claim.source_type))) continue;
    const weight = mapping.allocation * (model.sourceWeights.get(claim.source_type) ?? 0);
    items.push({ mapping, claim, weight, value: mapping.stance_value });
  }
  // 沒有配題時未表態
  return { value: items.length ? aggregate(items) : null, items };
}

/**
 * 計算全部候選人的立場矩陣。
 * @param {object} model 資料模型。
 * @param {string[]} entityIds 候選人。
 * @param {string[]} questionIds 題目。
 * @param {object} scoring settings.scoring。
 * @returns {{ stances: Map<string, Map<string, StanceResult>>, allowed: Set<string>|null }}
 */
function stanceMatrix(model, entityIds, questionIds, scoring) {
  // 共同來源模式只採用全部候選人都有的來源類型
  const allowed = scoring.sourceMode === "shared" ? sharedSources(model, entityIds) : null;
  // 彙總規則由設定選用，整個矩陣只查一次，換規則不需要改這裡的流程
  const aggregate = resolve("aggregate", scoring.stanceAggregate).run;
  const stances = new Map(entityIds.map((id) => [id, new Map(questionIds.map((q) => [q, candidateStance(model, id, q, aggregate, allowed)]))]));
  return { stances, allowed };
}

/**
 * 標示共識題：全部已表態的候選人依共識規則判定為同一立場。
 * @param {Map<string, Map<string, StanceResult>>} stances stanceMatrix 的結果。
 * @param {string[]} questionIds 題目。
 * @param {object} scoring settings.scoring。
 * @returns {Set<string>}
 */
function consensusQuestions(stances, questionIds, scoring) {
  const rule = resolve("consensus", scoring.consensusRule).run;
  const result = new Set();
  // 逐題收集已表態的立場
  for (const questionId of questionIds) {
    const known = [...stances.values()].map((row) => row.get(questionId).value).filter((value) => value !== null);
    // 共識規則判定為共識的題目
    if (rule(known)) result.add(questionId);
  }
  return result;
}

/**
 * 計算每位候選人的立場契合。
 * S = Σ(w × a) / Σ(w)，只加總已作答、候選人已表態、且計入排序的題目，a 是契合度。
 * 涵蓋率：`已表態題目的權重 / 已作答題目的權重`。
 * 下界把未表態的題目當成契合度 0，上界當成 1，分母都是已作答題目的權重。
 * @param {object} input 計算輸入。
 * @param {Map<string, Map<string, StanceResult>>} input.stances 立場矩陣。
 * @param {Set<string>} input.consensus 共識題。
 * @param {Map<string, number>} input.weights 題目權重。
 * @param {Record<string, { answer: string }>} input.answers 答案。
 * @param {object} input.model 資料模型。
 * @param {string[]} input.questionIds 本次出現的題目。
 * @param {object} input.scoring settings.scoring。
 * @returns {Map<string, { score: number|null, coverage: number|null, lower: number|null, upper: number|null, rows: QuestionRow[] }>}
 */
function stanceScores({ stances, consensus, weights, answers, model, questionIds, scoring }) {
  const agree = resolve("agreement", scoring.agreement).run;
  const results = new Map();
  // 共同題：全部候選人都已表態的題目
  const common = new Set(questionIds.filter((id) => [...stances.values()].every((row) => row.get(id).value !== null)));
  // 逐位候選人計算
  for (const [entityId, row] of stances) {
    let sum = 0;
    let known = 0;
    // 分子、分母與已表態的權重分開累計，才能同時算出契合、涵蓋率與上下界
    let answered = 0;
    const rows = [];
    // 逐題比對答案與立場
    for (const questionId of questionIds) {
      // 沒有作答或略過的題目不計入
      if (!isStated(answers[questionId])) continue;
      const answer = model.answers.get(answers[questionId].answer).value;
      const weight = weights.get(questionId) ?? 0;
      // 立場取自這位候選人的彙總結果，未表態時為 null
      const stance = row.get(questionId).value;
      const isConsensus = consensus.has(questionId);
      // 排序預設排除共識題，只比共同題時另外排除非共同題
      const counted = (!isConsensus || scoring.includeConsensus) && (!scoring.commonOnly || common.has(questionId));
      // 未表態的題目契合度沒有定義
      const agreement = stance === null ? null : agree(answer, stance, { end: model.scaleEnd });
      rows.push({ question: questionId, weight, answer, stance, agreement, consensus: isConsensus, common: common.has(questionId), counted });
      // 不納入排序的題目只列在明細
      if (!counted) continue;
      answered += weight;
      // 已表態才計入契合與涵蓋
      if (agreement !== null) {
        sum += weight * agreement;
        known += weight;
      }
    }
    // 沒有可比較的題目時各項都沒有定義
    results.set(entityId, {
      score: known > 0 ? sum / known : null,
      coverage: answered > 0 ? known / answered : null,
      lower: answered > 0 ? sum / answered : null,
      upper: answered > 0 ? (sum + (answered - known)) / answered : null,
      rows,
    });
  }
  return results;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { sharedSources, candidateStance, stanceMatrix, consensusQuestions, stanceScores };
