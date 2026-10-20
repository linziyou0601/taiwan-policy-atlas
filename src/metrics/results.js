/* ==================================================
 * metrics/results.js - 結果的總計算
 * --------------------------------------------------
 * - 角色：依作答路徑、權重、立場、具體度、重疊度與公式算出每位候選人的結果，結果頁與分享都讀這一份
 * - 指令：import { computeResults, blendBounds, QUESTION_PART } from "../metrics/results.js"
 * - 慣例：
 *   - 結果非零和：每位候選人各自與使用者比較，分數不互相分配
 *   - 資料不足（涵蓋率低於門檻）的候選人照常計分，排序時排在資料足夠的候選人之後並標示
 *   - 計算是純函式：輸入是模型、狀態與設定，同樣的輸入得到同樣的結果
 *   - 分項由 PART_SOURCES 列出，公式依 formulaParams 的鍵取用。卡片層讀 entity.blend.terms 列出分項，不寫死分項名稱
 * ================================================== */

import { resolve } from "../registry/index.js";
import { visibleQuestions, isStated } from "./flow.js";
import { questionWeights } from "./weights.js";
import { stanceMatrix, consensusQuestions, stanceScores } from "./stance.js";
import { specificityScores } from "./specificity.js";
import { overlapScores } from "./overlap.js";
import { axisPositions } from "./ideology.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 能拆回每一題的分項：立場契合是各題契合度的加權平均，分數歸屬把它攤回題目，其餘分項以整體值流向總分。
 */
const QUESTION_PART = "stance";

/**
 * 分項的來源：每個分項從哪一份計算結果取得候選人的分項值。鍵是分項名稱，與 formulaParams 的鍵相同。
 */
const PART_SOURCES = {
  stance: (computed) => computed.stance,
  specificity: (computed) => computed.specificity,
  overlap: (computed) => computed.overlap.perEntity,
};

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} EntityResult 一位候選人的結果。
 * @property {string} id 候選人。
 * @property {number|null} total 總分。
 * @property {object} blend 公式的分項與權重，terms 依公式列出每個分項。
 * @property {Record<string, number|null>} parts 各分項的值，鍵同 PART_SOURCES。
 * @property {object} stance 立場契合、涵蓋率、上下界與逐題明細。
 * @property {object} specificity 具體度。
 * @property {object} overlap 重疊度與議題分布。
 * @property {boolean} insufficient 是否資料不足。
 * @property {number} rank 排名，從 1 起算。
 */

/**
 * @typedef {object} Results 一次計分的完整結果，卡片層與敏感度分析都讀這一份。
 * @property {{ id: string, depth: number, parent: string|null }[]} items 依作答路徑出現的題目。
 * @property {string[]} questionIds 出現的題目代碼，順序同 items。
 * @property {Map<string, number>} weights 題目權重，鍵是題目代碼。
 * @property {Map<string, number>} nodeShares 分類樹各節點分到的份額。
 * @property {Map<string, string>} groupOf 題目代碼對應它的根題。
 * @property {Map<string, Map<string, object>>} stances 立場矩陣：候選人 → 題目 → 彙總後的立場。
 * @property {Set<string>|null} allowed 「只比共同來源」模式允許的來源類型，null 表示全部。
 * @property {Set<string>} consensus 共識題的代碼。
 * @property {{ user: Map<string, number>, issues: string[], perEntity: Map<string, object> }} overlap 議題分布與重疊度。
 * @property {{ axes: object[], user: Map<string, number|null>, entities: Map<string, Map<string, number|null>>, used: Map<string, string[]> }} ideology 使用者與候選人在各意識形態軸的位置，used 是各軸用到的題目。
 * @property {EntityResult[]} entities 候選人結果，依總分排名。
 * @property {number} answeredCount 表達了立場的題數，略過不算。
 */

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 排序候選人：資料足夠的候選人在前，同組依總分由高到低，總分相同時依遮蔽順序，不依號次。
 * @param {EntityResult[]} list 候選人結果。
 * @param {string[]} maskOrder 遮蔽順序。
 * @returns {EntityResult[]}
 */
function rank(list, maskOrder) {
  const sorted = [...list].sort((a, b) => {
    // 資料不足者排在後面
    if (a.insufficient !== b.insufficient) return a.insufficient ? 1 : -1;
    const diff = (b.total ?? -1) - (a.total ?? -1);
    // 總分相同時依遮蔽順序
    return diff !== 0 ? diff : maskOrder.indexOf(a.id) - maskOrder.indexOf(b.id);
  });
  return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 計算結果。
 * @param {object} model 資料模型。
 * @param {object} state 狀態，取 scopeId、answers、importance。
 * @param {object} settings 合併使用者設定後的設定。
 * @param {object} [override] 敏感度分析用的覆蓋值：weights 為題目權重的倍數，params 為公式權重。
 * @returns {Results}
 */
function computeResults(model, state, settings, override = {}) {
  const scoring = settings.scoring;
  const entities = model.entitiesByScope.get(state.scopeId) ?? [];
  // 候選人代碼供立場矩陣與分項查表使用，順序與選區內的排列一致
  const entityIds = entities.map((entity) => entity.id);
  const items = visibleQuestions(model, state.scopeId, state.answers, state.importance);
  const questionIds = items.map((item) => item.id);
  // 題目權重來自議題重視度逐層分配的結果，後面的立場與具體度都以它為準
  const weighting = questionWeights(model, items, state.importance);
  // 敏感度分析時題目權重乘上擾動倍數
  const weights = override.weights ? new Map([...weighting.weights].map(([id, w]) => [id, w * (override.weights.get(id) ?? 1)])) : weighting.weights;
  const { stances, allowed } = stanceMatrix(model, entityIds, questionIds, scoring);
  const consensus = consensusQuestions(stances, questionIds, scoring);
  // 立場契合用調整後的題目權重計算，讓敏感度分析的擾動傳到分數
  const stanceResults = stanceScores({ stances, consensus, weights, answers: state.answers, model, questionIds, scoring });
  const specificity = specificityScores({ model, stances, stanceResults });
  const overlap = overlapScores({ model, entityIds, importance: state.importance, scoring, allowed });
  // 公式依設定名稱從登錄表取得，換公式不需要改這裡的流程
  const formula = resolve("formula", scoring.formula).run;
  // 敏感度分析覆蓋公式權重時優先採用覆蓋值，否則用目前設定
  const params = override.params ?? scoring.formulaParams;
  // 各分項的計算結果依 PART_SOURCES 取用，新增分項只在那張表登錄
  const sources = Object.fromEntries(Object.entries(PART_SOURCES).map(([key, pick]) => [key, pick({ stance: stanceResults, specificity, overlap })]));
  // 逐位候選人取出各分項的值，交給公式組成總分
  const list = entityIds.map((id) => {
    const stance = stanceResults.get(id);
    const parts = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.get(id).score]));
    // 缺分項時由公式自行處理權重重分配
    const blend = formula(parts, params);
    // 涵蓋率低於門檻或沒有可比較的題目時資料不足
    const insufficient = stance.coverage === null || stance.coverage < scoring.coverageThreshold;
    return { id, total: blend.value, blend, parts, stance, specificity: specificity.get(id), overlap: overlap.perEntity.get(id), insufficient };
  });
  return {
    items,
    questionIds,
    weights,
    nodeShares: weighting.nodeShares,
    groupOf: weighting.groupOf,
    stances,
    allowed,
    consensus,
    overlap,
    ideology: axisPositions({ model, questionIds, answers: state.answers, stances }),
    entities: rank(list, model.maskOrder),
    answeredCount: questionIds.filter((id) => isStated(state.answers[id])).length,
  };
}

/**
 * 總分的範圍：把能拆回每一題的分項換成它的下界與上界，其餘分項不變，再代入同一個公式。
 * @param {EntityResult} entity 候選人結果。
 * @param {object} scoring settings.scoring。
 * @returns {{ lower: number|null, upper: number|null }}
 */
function blendBounds(entity, scoring) {
  const formula = resolve("formula", scoring.formula).run;
  return {
    lower: formula({ ...entity.parts, [QUESTION_PART]: entity.stance.lower }, scoring.formulaParams).value,
    upper: formula({ ...entity.parts, [QUESTION_PART]: entity.stance.upper }, scoring.formulaParams).value,
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { computeResults, blendBounds, QUESTION_PART };
