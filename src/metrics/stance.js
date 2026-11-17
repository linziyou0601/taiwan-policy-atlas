/* ==================================================
 * metrics/stance.js - 候選人立場與立場契合
 * --------------------------------------------------
 * - 角色：彙總每位候選人對每題的立場，與使用者的答案比對，算出立場契合、涵蓋率與缺值上下界。立場契合是估計值，題目少時向中性的 50% 收縮
 * - 指令：import { candidateStance, sharedSources, stanceScores, summarizeRows, coverageOf } from "../metrics/stance.js"
 * - 慣例：
 *   - 立場：以彙總規則合併各筆配題的立場，權重是 `分配 × 來源類型權重`，規則由 settings.scoring.stanceAggregate 選用
 *   - 沒有配題或權重合計為 0 時記為未表態（未知），不記為中立，也不算 0 分，另計入涵蓋率
 *   - 略過的題目不計入分子與分母。共識題預設不納入排序，仍列在逐題明細
 *   - 「只比較雙方都有的來源」模式下，只採用全部候選人都有主張的來源類型
 *   - 「只比較共同題」開啟時，只計入全部候選人都已表態的題目
 * ================================================== */

import { resolve } from "../registry/index.js";
import { isStated } from "./flow.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 虛擬題的契合度：0 到 1 的中點，表示沒有證據時既不偏向契合也不偏向不契合。
 */
const NEUTRAL = 0.5;

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
 * 涵蓋率：已表態題目的權重占已作答題目權重的比例。
 * @param {{ weight: number }[]} rows 計入的明細列。
 * @param {(row: object) => boolean} isKnown 一列是否已表態。
 * @returns {number|null} 沒有已作答的題目時沒有分母，為 null。
 */
function coverageOf(rows, isKnown) {
  const answered = rows.reduce((sum, row) => sum + row.weight, 0);
  // 沒有已作答的題目時涵蓋率沒有定義
  if (answered <= 0) return null;
  return rows.filter(isKnown).reduce((sum, row) => sum + row.weight, 0) / answered;
}

/**
 * 彙總計入的逐題明細列。契合是收縮估計：先放 shrinkage 題契合度 0.5 的虛擬題，每題的權重是計入列的平均權重，再與已表態的題目一起加權平均，題目少時分數靠近 0.5。
 * 涵蓋率見 coverageOf。下界與上界用同一個估計，把未表態的題目當成契合度 0 或 1 一起平均，stated 是已表態的題數。
 * @param {{ weight: number, agreement: number|null }[]} rows 計入的明細列，agreement 為 null 的列是未表態。
 * @param {number} shrinkage 虛擬題的題數，0 表示不收縮。
 * @returns {{ score: number|null, coverage: number|null, lower: number|null, upper: number|null, stated: number, pseudo: number }} 沒有已表態的題目時契合為 null，沒有已作答的題目時涵蓋率與上下界為 null。pseudo 是虛擬題的權重合計。
 */
function summarizeRows(rows, shrinkage) {
  const known = rows.filter((row) => row.agreement !== null);
  const coverage = coverageOf(rows, (row) => row.agreement !== null);
  // 已作答與已表態的權重、已表態的契合總和，三個估計都用到
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const knownWeight = known.reduce((sum, row) => sum + row.weight, 0);
  const agreed = known.reduce((sum, row) => sum + row.weight * row.agreement, 0);
  // 虛擬題的權重合計：題數乘上計入列的平均權重，題目權重的尺度改變時跟著等比例變動
  const pseudo = rows.length ? (shrinkage * total) / rows.length : 0;
  const estimate = (extra, weight) => (agreed + extra + NEUTRAL * pseudo) / (weight + pseudo);
  // 沒有已表態的題目時沒有證據，契合不以虛擬題代替
  const score = known.length && knownWeight + pseudo > 0 ? estimate(0, knownWeight) : null;
  // 沒有已作答的題目時上下界與涵蓋率一樣沒有分母
  if (coverage === null || total + pseudo <= 0) return { score, coverage, lower: null, upper: null, stated: known.length, pseudo };
  // 未表態的題目全當成 0 是下界，全當成 1 是上界，分母都含全部已作答的權重
  return { score, coverage, lower: estimate(0, total), upper: estimate(total - knownWeight, total), stated: known.length, pseudo };
}

/**
 * 計算每位候選人的立場契合。
 * S = (Σ(w × a) + 0.5 × k × w̄) / (Σ(w) + k × w̄)，Σ 只加總已作答、候選人已表態、且計入排序的題目，a 是契合度，k 是 scoring.stanceShrinkage，w̄ 是計入題目的平均權重。
 * 涵蓋率：`已表態題目的權重 / 已作答題目的權重`。
 * 下界把未表態的題目當成契合度 0，上界當成 1，與已表態的題目一起代入同一個估計。
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
      // 排序預設排除共識題，只比較共同題時另外排除非共同題
      const counted = (!isConsensus || scoring.includeConsensus) && (!scoring.commonOnly || common.has(questionId));
      // 未表態的題目契合度沒有定義
      const agreement = stance === null ? null : agree(answer, stance, { end: model.scaleEnd });
      rows.push({ question: questionId, weight, answer, stance, agreement, consensus: isConsensus, common: common.has(questionId), counted });
    }
    // 不納入排序的題目只列在明細，契合、涵蓋率與上下界只彙總計入的列
    results.set(entityId, { ...summarizeRows(rows.filter((r) => r.counted), scoring.stanceShrinkage), rows });
  }
  return results;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { sharedSources, candidateStance, stanceMatrix, consensusQuestions, stanceScores, summarizeRows, coverageOf, NEUTRAL };
