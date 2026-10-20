/* ==================================================
 * registry/parsers.js - 使用者匯入檔的解析
 * --------------------------------------------------
 * - 角色：解析使用者匯入的題庫 CSV 與設定 JSON，產出資料與逐列的錯誤，寫入狀態由 cards 層處理
 * - 指令：由 registry/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 題庫 CSV 的欄名由 settings.customData 宣告，候選人立場欄寫「立場:號次」，證據欄寫「證據:號次」
 *   - 立場寫 rubric-stance.tsv 的名稱，空白或 - 表示未表態
 *   - 設定 JSON 只接受 settings.params 登錄的路徑，其餘鍵列為錯誤，不默默套用
 * ================================================== */

import { parseDelimited, EMPTY_CELL } from "../lib/delimited.js";
import { getPath } from "../lib/objects.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} ParseIssue 解析問題。
 * @property {number} row 列號，表頭為第 1 列，0 表示整份檔案。
 * @property {string} code 問題代碼，介面以 locale 的 import.issues.{code} 顯示。
 * @property {string} [detail] 出問題的值。
 */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 表示未表態的儲存格。
 */
const EMPTY_CELLS = new Set(["", EMPTY_CELL]);

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 解析自訂題庫 CSV。
 * @param {string} textContent 檔案內容。
 * @param {object} context 核對用的資料。
 * @param {object} context.settings settings.customData。
 * @param {Map<string, object>} context.stancesByName 立場名稱對應判準列。
 * @param {Set<string>} context.facets 分類樹的代碼。
 * @param {Map<number, string>} context.entitiesByNumber 號次對應參選對象代碼。
 * @returns {{ questions: object[], stances: object[], issues: ParseIssue[] }}
 */
function parseQuestionCsv(textContent, context) {
  const { header, rows } = parseDelimited(textContent, "csv");
  const columns = context.settings.questionColumns;
  // 問題收集在清單裡而不是拋出例外，使用者一次就能看到所有要修正的地方
  const issues = [];
  // 必要欄位缺一不可
  for (const column of Object.values(columns)) {
    // 缺欄時整份檔案無法解析
    if (!header.includes(column)) issues.push({ row: 0, code: "missingColumn", detail: column });
  }
  // 缺欄時不再逐列解析
  if (issues.length) return { questions: [], stances: [], issues };
  const stanceColumns = header.filter((name) => name.startsWith(context.settings.stancePrefix));
  const questions = [];
  // 題目與立場分開收集，匯入後再各自驗證與合併
  const stances = [];
  // 逐列轉成題目與立場，列號從 2 起算
  rows.forEach((row, index) => {
    const line = index + 2;
    const code = row[columns.code];
    // 面向要在分類樹，權重才能分到這題
    if (!context.facets.has(row[columns.facet])) {
      issues.push({ row: line, code: "unknownFacet", detail: row[columns.facet] });
      return;
    }
    // 通過驗證的題目才建立，立場另外逐位候選人讀取
    questions.push({ id: code, facet: row[columns.facet], stem: row[columns.stem], note: row[columns.note] });
    // 逐位候選人讀立場
    for (const column of stanceColumns) {
      const number = Number(column.slice(context.settings.stancePrefix.length));
      const value = row[column];
      // 空白表示未表態，不建立立場
      if (EMPTY_CELLS.has(value)) continue;
      const stance = context.stancesByName.get(value);
      const entity = context.entitiesByNumber.get(number);
      // 立場名稱與號次都要能對到
      if (!stance || !entity) {
        // 未知的立場名稱與未知的號次是兩種錯誤，分開回報才知道要改哪一欄
        issues.push({ row: line, code: stance ? "unknownNumber" : "unknownStance", detail: stance ? String(number) : value });
        continue;
      }
      // 佐證欄位依號次對應，沒有填寫時以空字串代替
      const evidence = row[`${context.settings.evidencePrefix}${number}`] ?? "";
      stances.push({ question: code, entity, stance: stance.code, value: stance.value, evidence });
    }
  });
  return { questions, stances, issues };
}

/**
 * 檢查一個參數值的型別與範圍。
 * @param {object} param settings.params 的一筆。
 * @param {unknown} value 值。
 * @returns {boolean}
 */
function validParam(param, value) {
  // 是非參數只接受布林值
  if (param.type === "boolean") return typeof value === "boolean";
  // 選項參數只接受登錄的選項
  if (param.type === "choice") return param.choices.includes(value);
  return typeof value === "number" && value >= param.min && value <= param.max;
}

/**
 * 解析自訂設定 JSON，只接受可調參數登錄的路徑。
 * @param {string} textContent 檔案內容。
 * @param {object} context 核對用的資料。
 * @param {object[]} context.params settings.params。
 * @returns {{ overrides: Record<string, unknown>, issues: ParseIssue[] }}
 */
function parseSettingsJson(textContent, context) {
  let data;
  // JSON 損壞時整份無法使用
  try {
    data = JSON.parse(textContent);
  } catch {
    // 無法解析時整份覆蓋值都不套用，回報錯誤讓使用者知道原因
    return { overrides: {}, issues: [{ row: 0, code: "invalidJson" }] };
  }
  // 覆蓋值與問題分開收集，部分參數有誤時其餘有效的參數仍可套用
  const overrides = {};
  const issues = [];
  // 逐一取出登錄的參數路徑，型別不符時回報
  for (const param of context.params) {
    const value = getPath(data, param.path);
    // 檔案沒有這個參數時沿用預設
    if (value === undefined) continue;
    const valid = validParam(param, value);
    // 型別或範圍不符時不套用
    if (!valid) issues.push({ row: 0, code: "invalidValue", detail: param.path });
    // 有效的值才寫入覆蓋值，其餘進入問題清單
    else overrides[param.path] = value;
  }
  return { overrides, issues };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 匯入解析登錄表。
 */
const PARSERS = {
  questionCsv: parseQuestionCsv,
  settingsJson: parseSettingsJson,
};

export { PARSERS };
