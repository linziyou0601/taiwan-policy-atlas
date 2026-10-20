/* ==================================================
 * metrics/index.js - 計分層的出口
 * --------------------------------------------------
 * - 角色：卡片層取得資料與分數的唯一入口：匯出計分函式，並轉交資料層的載入、模型與自訂資料解析。策略的選用留在本層之內，卡片層只取得結果與策略清單
 * - 指令：import { resultsFor, loadIndex } from "../metrics/index.js"
 * - 慣例：卡片層不直接匯入資料層，資料的來源與格式只在資料層與本層之內
 * ================================================== */

export { loadBuild, loadIndex, loadTables, loadDataset, loadMap, buildModel, applyCustom, parseCustomQuestions, parseCustomSettings, ancestorAt, issueOf, byTaxonomyOrder, ISSUE_LEVEL, CUSTOM_PREFIX } from "../data/index.js";
export { scopeQuestions, visibleQuestions, isStated } from "./flow.js";
export { questionWeights, importanceOf } from "./weights.js";
export { stanceMatrix } from "./stance.js";
export { claimSpecificity } from "./specificity.js";
export { computeResults, blendBounds, QUESTION_PART } from "./results.js";
export { questionsFor, resultsFor } from "./kinds.js";
export { bandOf } from "./topic.js";
export { sensitivity, fixedAnswerCheck } from "./robustness.js";
export { attribution, issueAgreement, issueTree, sourceCoverage } from "./views.js";
export { maskText, maskIndex } from "./mask.js";
export { entries as strategyEntries } from "../registry/index.js";
