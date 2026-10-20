/* ==================================================
 * data/index.js - 資料層的出口
 * --------------------------------------------------
 * - 角色：集中匯出資料層的載入、模型與自訂資料函式，上一層只從這裡匯入
 * - 指令：import { loadIndex, buildModel } from "../data/index.js"
 * - 慣例：資料層不計算分數，也不知道畫面如何呈現
 * ================================================== */

export { DataError, loadBuild, loadIndex, loadTables, loadDataset, loadMap } from "./load.js";
export { parseTables } from "./tables.js";
export { buildModel, byTaxonomyOrder, lineage, ancestorAt, issueOf, ISSUE_LEVEL } from "./model.js";
export { applyCustom, parseCustomQuestions, parseCustomSettings, CUSTOM_PREFIX } from "./custom.js";
