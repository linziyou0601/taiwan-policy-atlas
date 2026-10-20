/* ==================================================
 * data/custom.js - 使用者自訂題庫併入模型
 * --------------------------------------------------
 * - 角色：解析使用者匯入的題庫 CSV 與設定 JSON，並把解析後的題目與立場併成新的模型，計分層照常計算，結果標示含自訂資料
 * - 指令：import { applyCustom, parseCustomQuestions, parseCustomSettings } from "../data/custom.js"
 * - 慣例：
 *   - 自訂立場轉成來源類型為 custom 的主張與配題，權重依 source-types.tsv，和公報主張走同一條計分路徑
 *   - 自訂題目的代碼與資料集重複時略過該題，不覆蓋原有題目
 *   - 原模型不修改，回傳新的模型物件
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { groupBy, indexBy } from "../lib/objects.js";
import { resolve } from "../registry/index.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 自訂題目雜湊與自訂主張代碼的前綴，資料集瀏覽依它區分來源，答案的題意雜湊也不會與資料集的題目相撞。
 */
const CUSTOM_PREFIX = "custom:";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 把自訂資料併入模型。
 * @param {object} model buildModel 的結果。
 * @param {{ questions: object[], stances: object[] }} custom 解析後的自訂資料。
 * @returns {object} 新的模型，沒有自訂資料時回傳原模型。
 */
function applyCustom(model, custom) {
  // 沒有自訂資料時不必複製
  if (!custom?.questions?.length) return model;
  const sourceType = SETTINGS.customData.sourceType;
  // 自訂題目的代碼要與資料集的題目不同，重複的略過
  const questions = custom.questions
    .filter((q) => !model.questions.has(q.id))
    .map((q) => ({ ...q, parent: null, conditions: [], budget_share: 1, scopes: [], version: 1, hash: `${CUSTOM_PREFIX}${q.id}`, format: "scale", choices: model.scale, custom: true }));
  // 通過檢查的題目，用來過濾指向已捨棄題目的立場，也供立場查面向
  const accepted = indexBy(questions);
  // 每筆立場轉成一則主張與一筆配題
  const claims = [];
  const mappings = [];
  // 只處理通過檢查的題目
  for (const stance of custom.stances.filter((s) => accepted.has(s.question))) {
    const id = `${CUSTOM_PREFIX}${stance.question}:${stance.entity}`;
    const facet = accepted.get(stance.question).facet;
    // 自訂主張標記 custom，讓具體度與來源權重的流程能辨認它不是資料集內建的主張
    claims.push({ id, entity: stance.entity, quote: stance.evidence, fields: {}, source_type: sourceType, custom: true, passage: null, reason: "", method: "", review_status: "" });
    mappings.push({ id: `${id}:m1`, claim: id, facet, question: stance.question, question_version: 1, stance: stance.stance, stance_value: stance.value, allocation: 1, evidence: stance.evidence || null, reason: "", custom: true });
  }
  // 合併後的集合保留原模型的項目在前，自訂項目附在後面
  const allQuestions = [...model.questions.values(), ...questions];
  const allClaims = [...model.claims.values(), ...claims];
  const allMappings = [...model.mappings, ...mappings];
  // 重建受影響的索引，其餘沿用
  return {
    ...model,
    questions: indexBy(allQuestions),
    questionOrder: [...model.questionOrder, ...questions.map((q) => q.id)],
    claims: indexBy(allClaims),
    claimsByEntity: groupBy(allClaims, (c) => c.entity),
    mappings: allMappings,
    mappingsByQuestion: groupBy(allMappings.filter((m) => m.question), (m) => m.question),
    mappingsByClaim: groupBy(allMappings, (m) => m.claim),
    custom: true,
  };
}

/**
 * 解析題庫 CSV：立場以判準名稱、候選人以號次對應到模型裡的代碼。
 * @param {object} model 資料模型。
 * @param {object[]} entities 目前選區的候選人。
 * @param {string} text CSV 內容。
 * @returns {{ questions: object[], stances: object[], issues: string[] }} issues 是逐列的問題，有問題時不應套用。
 */
function parseCustomQuestions(model, entities, text) {
  // 題庫 CSV 的立場與候選人以名稱和號次對應，先建好查表
  const stancesByName = new Map([...model.stances.values()].map((row) => [row.name, row]));
  const entitiesByNumber = new Map(entities.map((entity) => [entity.number, entity.id]));
  return resolve("parser", "questionCsv").run(text, { settings: SETTINGS.customData, stancesByName, facets: new Set(model.taxonomy.keys()), entitiesByNumber });
}

/**
 * 解析設定 JSON：只接受 settings.params 登錄過的參數路徑與型別。
 * @param {string} text JSON 內容。
 * @returns {{ overrides: Record<string, unknown>, issues: string[] }}
 */
function parseCustomSettings(text) {
  return resolve("parser", "settingsJson").run(text, { params: SETTINGS.params });
}

/* ==================================================
 * 匯出
 * ================================================== */

export { applyCustom, parseCustomQuestions, parseCustomSettings, CUSTOM_PREFIX };
