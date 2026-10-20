/* ==================================================
 * cards/state.js - 使用者狀態
 * --------------------------------------------------
 * - 角色：定義使用者狀態的預設值、匯出與匯入分類與題意變更時的答案封存
 * - 指令：import { DEFAULT_STATE, STATE_GROUPS, IMPORT_MODES, normalizeState, archiveStale, mergeGroup } from "./state.js"
 * - 慣例：
 *   - 狀態只存在瀏覽器的 localStorage，匯出成 JSON 才能帶到別處
 *   - 狀態是不可變物件，每次變更產生新物件，畫面依新狀態重新繪製
 *   - 每個答案記下作答時的題意雜湊，資料更新後題意改變的答案移到待確認紀錄，不默默沿用
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { hasValue, uniqueValues } from "../lib/objects.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 匯出與匯入的分類：每類列出包含的狀態鍵。匯出時可只選部分分類，匯入時選一種方式套用到檔案內的全部分類。
 */
const STATE_GROUPS = {
  answers: { keys: ["setId", "scopeId", "answers", "archive"] },
  preferences: { keys: ["importance", "importanceSkipped", "params", "reveal", "selected", "focus"] },
  display: { keys: ["theme", "zoom", "view"] },
  custom: { keys: ["custom", "customSettings"] },
};

/**
 * 匯入方式：排第一的是預設。不覆寫只補上沒有的值，附加合併物件與串列，覆寫整類取代。
 */
const IMPORT_MODES = ["keep", "append", "replace"];

/**
 * 狀態的預設值。
 * - setId、scopeId：目前的題組（一場選舉或一套主題測驗）與選區，主題測驗沒有選區
 * - answers：題目代碼對應 { answer: 作答代碼（量尺或單選題的選項）或 skip, hash: 作答時的題意雜湊 }
 * - archive：題意改變而封存的答案
 * - importance：分類節點對應重視度，沒有設定的節點取預設值
 * - importanceSkipped：使用者選擇略過重視度設定，使用均等權重
 * - params：結果頁調整過的參數，鍵是 settings 的路徑
 * - reveal：是否已翻牌顯示姓名與黨名
 * - selected：結果頁勾選的候選人，空陣列表示全部
 * - focus：議題分布聚焦的候選人
 * - theme、zoom：顯示偏好
 * - custom、customSettings：使用者匯入的題庫與設定
 * - shared：正在觀看別人分享的結果。這時的狀態只留在記憶體，也沒有歸入任何匯出與匯入分類
 * - view：各頁的檢視狀態，例如資料集的分頁與搜尋、隱藏的圖表系列、匯出的分類與匯入方式
 */
const DEFAULT_STATE = Object.freeze({
  setId: null,
  scopeId: null,
  answers: {},
  archive: [],
  importance: {},
  importanceSkipped: false,
  params: {},
  reveal: false,
  selected: [],
  focus: null,
  theme: SETTINGS.display.defaultTheme,
  zoom: SETTINGS.display.defaultZoom,
  custom: null,
  customSettings: null,
  shared: false,
  view: { year: null, county: null, town: null, scopeQuery: "", quizIndex: 0, datasetSet: null, datasetView: null, datasetQuery: "", datasetPage: 0, expanded: [], sankeyDetail: "issue", quizOpen: false, resultSection: null, hidden: [], exportGroups: Object.keys(STATE_GROUPS), importMode: IMPORT_MODES[0] },
});

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依預設值的鍵與型別挑出讀入的值。
 * @param {object|undefined} raw 讀入的物件。
 * @param {object} defaults 預設值。
 * @returns {object} 新物件，鍵與 defaults 相同。
 */
function pickKnown(raw, defaults) {
  const picked = { ...defaults };
  // 只採用預設值有的鍵，型別與預設值不同時沿用預設
  for (const key of Object.keys(defaults)) {
    const value = raw?.[key];
    const fallback = defaults[key];
    // null 與任何型別互通，陣列與物件要分開比，否則 [] 會當成物件通過檢查
    const sameType = value !== undefined && (fallback === null || value === null || typeof value === typeof fallback) && Array.isArray(value) === Array.isArray(fallback);
    // 型別相符才採用
    if (sameType) picked[key] = value;
  }
  return picked;
}

/**
 * 補齊狀態的缺鍵並捨棄未知的鍵，讀入舊版或手動編輯的狀態時使用。
 * @param {object} raw 讀入的狀態。
 * @returns {object} 新狀態，鍵與 DEFAULT_STATE 相同。
 */
function normalizeState(raw) {
  const state = pickKnown(raw, DEFAULT_STATE);
  // 檢視狀態同樣逐鍵比對，新版增加的鍵也有預設值
  state.view = pickKnown(raw?.view, DEFAULT_STATE.view);
  // 附加匯入可能讓封存超過上限，只留最新的部分
  state.archive = state.archive.slice(-SETTINGS.storage.archiveLimit);
  return state;
}

/**
 * 把題意已改變、題目已不存在或作答代碼不是這一題選項的答案移到封存。
 * @param {object} state 狀態。
 * @param {Map<string, object>} questions 目前資料集的題目，每題的 choices 是可選的答案。略過的代碼另由 `flow.skipAnswer` 認得。
 * @returns {object} 新狀態，沒有變動時回傳原狀態。
 */
function archiveStale(state, questions) {
  const kept = {};
  const moved = [];
  // 前綴補成完整雜湊也算一次變動，要記下才會寫回狀態
  let completed = false;
  // 逐題比對題意雜湊，分享連結帶的是前綴，以前綴比對後補成完整雜湊
  for (const [id, entry] of Object.entries(state.answers)) {
    const question = questions.get(id);
    // 作答代碼要是這一題的選項或略過，匯入的檔案與分享連結可能帶來不認得的代碼
    const known = entry.answer === SETTINGS.flow.skipAnswer || Boolean(question?.choices.some((choice) => choice.code === entry.answer));
    const same = known && question && entry.hash && question.hash.startsWith(entry.hash);
    // 題目還在、題意相同且代碼認得時保留，前綴時補成完整雜湊
    if (same) {
      completed ||= entry.hash !== question.hash;
      kept[id] = { ...entry, hash: question.hash };
    } else {
      // 題意改變、題目已不存在或代碼不認得時封存
      moved.push({ question: id, answer: entry.answer, hash: entry.hash, set: state.setId });
    }
  }
  // 沒有變動時不產生新物件，避免多餘的重新繪製
  if (!moved.length && !completed) return state;
  const archive = [...state.archive, ...moved].slice(-SETTINGS.storage.archiveLimit);
  return { ...state, answers: kept, archive };
}

/**
 * 依匯入方式合併一類狀態。
 * @param {object} current 目前狀態。
 * @param {object} incoming 匯入的狀態。
 * @param {string} group 分類名稱。
 * @param {string} mode IMPORT_MODES 之一。
 * @returns {object} 新狀態，只有這個分類的鍵依匯入方式改變。
 */
function mergeGroup(current, incoming, group, mode) {
  const next = { ...current };
  // 逐鍵依匯入方式合併
  for (const key of STATE_GROUPS[group].keys) {
    const value = incoming[key];
    // 匯入檔沒有這個鍵時保留目前的值
    if (value === undefined) continue;
    const empty = !hasValue(current[key]) || (typeof current[key] === "object" && !Object.keys(current[key]).length);
    // 不覆寫：只在目前沒有值時採用
    if (mode === "keep") next[key] = empty ? value : current[key];
    // 附加：串列接在後面並移除內容相同的元素（封存列是物件，依內容比較），物件逐鍵合併，純量以匯入值為準
    else if (mode === "append") next[key] = Array.isArray(value) ? uniqueValues([...(current[key] ?? []), ...value]) : typeof value === "object" && value !== null ? { ...(current[key] ?? {}), ...value } : value;
    // 覆寫：整個取代
    else next[key] = value;
  }
  return normalizeState(next);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { DEFAULT_STATE, STATE_GROUPS, IMPORT_MODES, normalizeState, archiveStale, mergeGroup };
