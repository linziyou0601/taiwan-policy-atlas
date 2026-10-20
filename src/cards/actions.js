/* ==================================================
 * cards/actions.js - 使用者動作
 * --------------------------------------------------
 * - 角色：畫面上的每個動作以「名稱:參數」登錄在 ACTIONS，回傳新狀態、要前往的頁面或要執行的效果
 * - 指令：import { dispatch } from "../cards/actions.js"
 * - 慣例：
 *   - 動作是純函式：讀狀態與情境，回傳 { state, route, effect }，不直接操作畫面或儲存
 *   - 效果（下載、選擇檔案、確認、開啟視窗、複製、分享）由 app 層執行，執行完需要接續的動作寫在 then
 *   - 輸入類的動作由顯示層在參數後補上「=值」，例如 setParam:scoring.coverageThreshold=0.3
 * ================================================== */

import { SETTINGS, LAYOUT } from "../config/index.js";
import { getPath } from "../lib/objects.js";
import { fnv1a } from "../lib/codec.js";
import { toDelimited } from "../lib/delimited.js";
import { questionsFor, parseCustomQuestions, parseCustomSettings } from "../metrics/index.js";
import { DEFAULT_STATE, STATE_GROUPS } from "./state.js";
import { exportState, importState } from "./share.js";
import { currentRows } from "./dataset.js";
import { settingsFor } from "./session.js";
import { t, coversTown, listText, nextStep } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 檢視狀態中存數字的鍵。
 */
const VIEW_NUMBERS = new Set(["year", "datasetPage", "quizIndex"]);

/**
 * 檢視狀態中「none」表示沒有值的鍵。
 */
const VIEW_NULLABLE = new Set(["datasetSet"]);

/**
 * 匯出檔案的 MIME 類型。
 */
const MIME = { json: "application/json", tsv: "text/tab-separated-values", csv: "text/csv" };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 拆開「鍵=值」。
 * @param {string} arg 參數。
 * @returns {[string, string]}
 */
function pair(arg) {
  const index = arg.indexOf("=");
  // 沒有等號時值為空字串
  return index < 0 ? [arg, ""] : [arg.slice(0, index), arg.slice(index + 1)];
}

/**
 * 判斷狀態是否已有作答，切換題組或選區前要確認。
 * @param {object} state 狀態。
 * @returns {boolean}
 */
function hasAnswers(state) {
  return Object.keys(state.answers).length > 0;
}

/**
 * 作答是否作答到一半：有作答，但還有題目沒有作答或略過。
 * @param {object} state 狀態。
 * @param {object} context 卡片情境。
 * @returns {boolean}
 */
function halfway(state, context) {
  return hasAnswers(state) && context.progress().firstOpen >= 0;
}

/**
 * 放棄這次作答：清空作答，下次從第一題開始，作答中的標記一併清除。議題重視度保留。
 * @param {object} state 狀態。
 * @returns {object} 新狀態。
 */
function abandon(state) {
  return { ...state, answers: {}, view: { ...state.view, quizIndex: 0, quizOpen: false } };
}

/**
 * 切換頁面時套用的作答規則。`view.quizOpen` 記錄使用者是否正在作答：
 * - 離開作答頁時作答到一半就放棄，下次從第一題開始
 * - 開機時不在作答頁、上次的作答卻尚未完成（例如作答中關閉分頁），同樣放棄
 * - 進入作答頁時標記作答中。還有未答題卻不是作答到一半（例如匯入自訂題目後多了新題）時，從第一題未答的題目補上作答
 * 重新整理作答頁時上一頁是 null、這一頁是作答頁，作答中的標記還在，接著作答。
 * @param {object} state 狀態。
 * @param {string|null} from 上一頁，開機時為 null。
 * @param {string} to 這一頁。
 * @param {object} context 這一頁的卡片情境。
 * @returns {object} 新狀態，沒有變動時回傳原狀態。
 */
function enterPage(state, from, to, context) {
  const open = Boolean(state.view.quizOpen);
  const answer = LAYOUT.roles.answer;
  // 離開作答頁，或開機時發現上次的作答尚未完成，都算結束這次作答
  if (open && to !== answer && (from === answer || from === null)) return halfway(state, context) ? abandon(state) : { ...state, view: { ...state.view, quizOpen: false } };
  // 從其他頁進入作答頁時開始一次作答
  if (to === answer && from !== answer && !open) {
    const firstOpen = context.progress().firstOpen;
    // 有未答題時從那一題開始，全部答完時停在先前所在的題目
    return { ...state, view: { ...state.view, quizOpen: true, quizIndex: hasAnswers(state) && firstOpen >= 0 ? firstOpen : state.view.quizIndex } };
  }
  return state;
}

/**
 * 換到新的選區：清除答案、勾選與作答位置。
 * @param {object} state 狀態。
 * @param {string} scopeId 選區。
 * @returns {object} 新狀態，選區換成 scopeId。
 */
function withScope(state, scopeId) {
  // 同一選區不清除答案
  if (state.scopeId === scopeId) return state;
  return { ...state, scopeId, answers: {}, selected: [], focus: null, view: { ...state.view, quizIndex: 0 } };
}

/**
 * 選區清單或地圖只剩一個選項時直接選取。
 * @param {object} state 狀態。
 * @param {object[]} scopes 符合的選區。
 * @param {object} context 卡片情境，選定後依它推出下一步。
 * @returns {{ state: object, route?: string, effect?: object }}
 */
function selectIfSingle(state, scopes, context) {
  // 只有一個符合時視同點選該選區。ACTIONS 宣告在主體，這裡在執行時才查表，兩者互相引用
  if (scopes.length === 1) return ACTIONS.selectScope(state, scopes[0].id, context);
  return { state };
}

/**
 * 解析參數值的型別。
 * @param {string} path 設定路徑。
 * @param {string} raw 字串值。
 * @returns {unknown}
 */
function paramValue(path, raw) {
  const param = SETTINGS.params.find((item) => item.path === path);
  // 是非參數轉成布林值
  if (param?.type === "boolean") return raw === "true";
  // 選項參數保留字串
  if (param?.type === "choice") return raw;
  return Number(raw);
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 看別人分享的結果時可以執行的動作：切換頁面、切換檢視與候選人、開啟說明與明細、分享與顯示偏好。其餘動作會修改作答、參數或本機資料，一律不執行。
 */
const SHARED_ACTIONS = new Set(["route", "setView", "setSection", "toggleSelect", "setFocus", "toggleSeries", "openQuestion", "openCandidate", "openIssue", "openImage", "openMore", "openInfo", "closeModal", "confirmed", "share", "shareImage", "saveShareImage", "copyShareImage", "copy", "setTheme", "setZoom", "reload", "exitShared"]);

/**
 * 動作登錄表。每個動作的參數為 (state, arg, context)。
 */
const ACTIONS = {
  /** 前往頁面。作答到一半時離開作答頁要先確認，確定後放棄這次作答。 */
  route: (state, page, context) => {
    // 留在作答頁或作答已完成時直接前往
    if (context?.page !== LAYOUT.roles.answer || page === LAYOUT.roles.answer || !halfway(state, context)) return { state, route: page };
    return { state, effect: { type: "confirm", message: t("confirm.leaveQuiz"), then: `forceRoute:${page}` } };
  },
  /** 確定離開作答頁：放棄這次作答後前往。 */
  forceRoute: (state, page) => ({ state: abandon(state), route: page }),
  /** 設定檢視狀態：「鍵=值」。 */
  setView: (state, arg) => {
    const [key, raw] = pair(arg);
    // 數字鍵轉成數字，可為空的鍵把 none 轉成 null
    const value = VIEW_NUMBERS.has(key) ? Number(raw) : VIEW_NULLABLE.has(key) && raw === "none" ? null : raw;
    const view = { ...state.view, [key]: value };
    // 換檢視或搜尋時回到第一頁
    if (key === "datasetView" || key === "datasetQuery" || key === "datasetSet") view.datasetPage = 0;
    return { state: { ...state, view } };
  },
  /** 選擇題組（一場選舉或一套主題測驗），已有作答時先確認。 */
  selectSet: (state, id, context) => {
    // 換到不同題組會清除答案，先確認
    if (state.setId && state.setId !== id && hasAnswers(state)) return { state, effect: { type: "confirm", message: t("confirm.changeSet"), then: `forceSet:${id}` } };
    return ACTIONS.forceSet(state, id, context);
  },
  /** 確定選擇題組。全國性選舉只有一個選區，直接選取。 */
  forceSet: (state, id, context) => {
    const entry = context.data.index.sets.find((item) => item.id === id);
    const changed = state.setId !== id;
    // 換題組時清除選區與答案，同一題組保留
    const base = changed ? { ...state, setId: id, scopeId: null, answers: {}, selected: [], focus: null, view: { ...state.view, county: null, town: null, scopeQuery: "", quizIndex: 0 } } : state;
    // 只有一個選區的選舉直接選取那個選區，流程略過選區頁，下一步由 layout 的 flow 推出
    return { state: entry?.default_scope ? withScope(base, entry.default_scope) : base, route: nextStep(context.page, entry) };
  },
  /** 地圖點選縣市。縣市層級的選舉直接選取該縣市的選區。 */
  selectCounty: (state, code, context) => {
    const next = { ...state, view: { ...state.view, county: code, town: null } };
    const scopes = [...context.model.scopes.values()].filter((scope) => scope.county === code);
    // 縣市層級的選舉一個縣市只有一個選區
    if (SETTINGS.scopeMaps[context.set.scope_type] === "county") return selectIfSingle(next, scopes, context);
    return { state: next };
  },
  /** 地圖點選鄉鎮。只有一個選區涵蓋時直接選取。 */
  selectTown: (state, code, context) => {
    const next = { ...state, view: { ...state.view, town: code } };
    const town = context.data.map.layers.towns.find((item) => item.code === code);
    const scopes = [...context.model.scopes.values()].filter((scope) => scope.county === town.county && coversTown(context, scope, town.name));
    return selectIfSingle(next, scopes, context);
  },
  /** 回到全部縣市。 */
  clearMap: (state) => ({ state: { ...state, view: { ...state.view, county: null, town: null } } }),
  /** 選擇選區，已有作答時先確認。 */
  selectScope: (state, id, context) => {
    // 換到不同選區會清除答案，先確認
    if (state.scopeId && state.scopeId !== id && hasAnswers(state)) return { state, effect: { type: "confirm", message: t("confirm.changeScope"), then: `forceScope:${id}` } };
    return ACTIONS.forceScope(state, id, context);
  },
  /** 確定選擇選區。 */
  forceScope: (state, id, context) => ({ state: withScope(state, id), route: nextStep(context.page, context.set) }),
  /** 設定一個分類節點的重視度：「代碼=級數」。 */
  setImportance: (state, arg) => {
    const [code, level] = pair(arg);
    return { state: { ...state, importance: { ...state.importance, [code]: Number(level) }, importanceSkipped: false } };
  },
  /** 展開或收合第 2 層。 */
  toggleExpand: (state, code) => {
    // 已展開的再按一次就收合，否則加入展開清單
    const expanded = state.view.expanded.includes(code) ? state.view.expanded.filter((item) => item !== code) : [...state.view.expanded, code];
    return { state: { ...state, view: { ...state.view, expanded } } };
  },
  /** 略過重視度設定，使用均等權重。 */
  skipImportance: (state, arg, context) => ({ state: { ...state, importance: {}, importanceSkipped: true }, route: nextStep(context.page, context.set) }),
  /** 重設重視度。 */
  resetImportance: (state) => ({ state: { ...state, importance: {}, importanceSkipped: false } }),
  /** 作答：「題目=作答代碼」，作答代碼是量尺或單選題的選項。作答後停在這一題。 */
  answer: (state, arg, context) => {
    const [id, code] = pair(arg);
    const question = context.model.questions.get(id);
    const answers = { ...state.answers, [id]: { answer: code, hash: question.hash } };
    // 追問題由作答決定，用新答案重算目前會出現的題目
    const { visible } = questionsFor(context.model, { ...state, answers });
    // 停在這一題，由使用者按下一題前往，作答後可以先確認或修改答案。追問題插在母題之後，這一題的序號依新的題目清單重算
    const quizIndex = visible.findIndex((item) => item.id === id);
    return { state: { ...state, answers, view: { ...state.view, quizIndex } } };
  },
  /** 前往第幾題。 */
  quizGo: (state, index) => ({ state: { ...state, view: { ...state.view, quizIndex: Number(index) } }, route: LAYOUT.roles.answer }),
  /** 開啟題目明細。 */
  openQuestion: (state, id) => ({ state, effect: { type: "modal", kind: "question", arg: id } }),
  /** 開啟候選人明細。 */
  openCandidate: (state, id) => ({ state, effect: { type: "modal", kind: "candidate", arg: id } }),
  /** 開啟議題明細：「議題=候選人」。 */
  openIssue: (state, arg) => ({ state, effect: { type: "modal", kind: "issue", arg } }),
  /** 開啟公報影像，影像會顯示候選人身分。 */
  openImage: (state, path) => ({ state, effect: { type: "modal", kind: "image", arg: path } }),
  /** 切換結果頁的分區，並捲回頂端，從新分區的開頭看起。 */
  setSection: (state, key) => ({ state: { ...state, view: { ...state.view, resultSection: key } }, effect: { type: "scrollTop" } }),
  /** 開啟手機底部分頁列的「更多」：其餘頁面的入口。 */
  openMore: (state) => ({ state, effect: { type: "modal", kind: "more" } }),
  /** 開啟卡片的 info。 */
  openInfo: (state, card) => ({ state, effect: { type: "info", card } }),
  /** 確認視窗的確定鈕：關閉視窗後執行等待確認的動作，接續的動作照常經過 dispatch。 */
  confirmed: (state, then) => ({ state, effect: { type: "confirmed", then } }),
  /** 關閉視窗。 */
  closeModal: (state) => ({ state, effect: { type: "closeModal" } }),
  /** 翻牌或蓋牌。 */
  toggleReveal: (state) => ({ state: { ...state, reveal: !state.reveal } }),
  /** 勾選或取消一位候選人，至少保留一位。 */
  toggleSelect: (state, id, context) => {
    const all = context.entityIds;
    // 沒有勾選代表全部候選人，取消其中一位時要先展開成完整清單
    const current = state.selected.length ? state.selected : all;
    // 已在清單內的取消，不在的加入
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    // 取消到一位都不剩時維持原狀
    if (!next.length) return { state };
    // 全部勾選時存成空陣列，表示全部
    return { state: { ...state, selected: next.length === all.length ? [] : next } };
  },
  /** 設定聚焦的候選人。 */
  setFocus: (state, id) => ({ state: { ...state, focus: id } }),
  /** 圖例切換一條系列。 */
  toggleSeries: (state, id) => {
    const { hidden } = state.view;
    // 已隱藏的系列再按一次就顯示，否則加入隱藏清單
    return { state: { ...state, view: { ...state.view, hidden: hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id] } } };
  },
  /** 調整參數：「路徑=值」，與預設相同時移除覆蓋。 */
  setParam: (state, arg) => {
    const [path, raw] = pair(arg);
    const value = paramValue(path, raw);
    const params = { ...state.params };
    // 與沒有參數覆蓋時的值相同就不記錄。匯入的設定也算在預設裡，拉回匯入值時移除覆蓋
    if (getPath(settingsFor({ ...state, params: {} }), path) === value) delete params[path];
    // 與預設不同時才記錄覆蓋，狀態裡只留使用者改過的參數
    else params[path] = value;
    return { state: { ...state, params } };
  },
  /** 離開別人分享的結果，回到自己的作答：重新讀取本機的狀態後前往指定的頁面，預設是結果頁。 */
  exitShared: (state, page) => ({ state, effect: { type: "exitShared", route: page || LAYOUT.roles.result } }),
  /** 恢復預設參數。 */
  resetParams: (state) => ({ state: { ...state, params: {} } }),
  /** 產生分享連結。 */
  share: (state) => ({ state, effect: { type: "share" } }),
  /** 產生分享圖片。 */
  shareImage: (state) => ({ state, effect: { type: "shareImage" } }),
  /** 把預覽中的分享圖片存成檔案。 */
  saveShareImage: (state) => ({ state, effect: { type: "saveShareImage" } }),
  /** 把預覽中的分享圖片複製到剪貼簿。 */
  copyShareImage: (state) => ({ state, effect: { type: "copyShareImage" } }),
  /** 複製文字。 */
  copy: (state, value) => ({ state, effect: { type: "copy", text: value } }),
  /** 切換匯出的分類。 */
  toggleExportGroup: (state, group) => {
    const groups = state.view.exportGroups;
    // 匯出分類同樣是切換，已選的取消，未選的加入
    return { state: { ...state, view: { ...state.view, exportGroups: groups.includes(group) ? groups.filter((item) => item !== group) : [...groups, group] } } };
  },
  /** 匯出狀態。 */
  exportState: (state, arg, context) => ({ state, effect: { type: "download", filename: t("local.filename"), content: exportState(context, state.view.exportGroups), mime: MIME.json } }),
  /** 選擇要匯入的狀態檔。 */
  importState: (state) => ({ state, effect: { type: "pickFile", accept: ".json", then: "applyStateImport" } }),
  /** 套用匯入的狀態。 */
  applyStateImport: (state, file) => {
    // 檔案格式錯誤時提示，不改動狀態
    try {
      const result = importState(state, file.text, state.view.importMode);
      return { state: result.state, effect: { type: "toast", message: t("local.imported", { groups: listText(result.groups.map((group) => t(`local.groups.${group}`))) }) } };
    } catch {
      // 壞檔案不能覆蓋使用者已有的作答，保持原狀態並提示失敗
      return { state, effect: { type: "toast", message: t("local.importFailed"), tone: "critical" } };
    }
  },
  /** 重設一類狀態，先確認。 */
  resetGroup: (state, group) => ({ state, effect: { type: "confirm", message: t("confirm.reset", { group: t(`local.groups.${group}`) }), then: `forceReset:${group}` } }),
  /** 確定重設一類狀態。 */
  forceReset: (state, group) => ({ state: { ...state, ...Object.fromEntries(STATE_GROUPS[group].keys.map((key) => [key, DEFAULT_STATE[key]])) } }),
  /** 選擇要匯入的題庫 CSV。 */
  importQuestions: (state) => ({ state, effect: { type: "pickFile", accept: ".csv", then: "applyQuestions" } }),
  /** 解析並套用題庫 CSV，有問題時列出，不套用。 */
  applyQuestions: (state, file, context) => {
    const result = parseCustomQuestions(context.model, context.entities, file.text);
    // 有問題時列出全部問題
    if (result.issues.length || !result.questions.length) return { state, effect: { type: "modal", kind: "import", arg: result.issues } };
    const custom = { setId: state.setId, scopeId: state.scopeId, name: file.name, questions: result.questions, stances: result.stances, hash: String(fnv1a(file.text)) };
    return { state: { ...state, custom }, effect: { type: "toast", message: t("local.customApplied", { count: result.questions.length }) } };
  },
  /** 下載題庫 CSV 範本，立場欄依目前選區的號次。 */
  downloadTemplate: (state, arg, context) => {
    const columns = [...Object.values(SETTINGS.customData.questionColumns), ...context.entities.flatMap((entity) => [`${SETTINGS.customData.stancePrefix}${entity.number}`, `${SETTINGS.customData.evidencePrefix}${entity.number}`])];
    return { state, effect: { type: "download", filename: t("local.templateName"), content: toDelimited([], columns, "csv"), mime: MIME.csv } };
  },
  /** 選擇要匯入的設定 JSON。 */
  importSettings: (state) => ({ state, effect: { type: "pickFile", accept: ".json", then: "applySettings" } }),
  /** 解析並套用設定 JSON。 */
  applySettings: (state, file) => {
    const result = parseCustomSettings(file.text);
    // 有問題時列出，不套用
    if (result.issues.length) return { state, effect: { type: "modal", kind: "import", arg: result.issues } };
    return { state: { ...state, customSettings: { name: file.name, overrides: result.overrides } }, effect: { type: "toast", message: t("local.settingsApplied", { count: Object.keys(result.overrides).length }) } };
  },
  /** 清除自訂資料。 */
  clearCustom: (state) => ({ state: { ...state, custom: null, customSettings: null } }),
  /** 匯出目前資料集檢視。 */
  exportView: (state, format, context) => {
    const { view, columns, rows } = currentRows(context);
    // JSON 保留完整結構，表格格式則依欄位順序輸出
    const content = format === "json" ? `${JSON.stringify(rows, null, 2)}\n` : toDelimited(rows, columns, format);
    return { state, effect: { type: "download", filename: t("dataset.filename", { view, format }), content, mime: MIME[format] } };
  },
  /** 設定主題。 */
  setTheme: (state, theme) => ({ state: { ...state, theme } }),
  /** 設定縮放。 */
  setZoom: (state, zoom) => ({ state: { ...state, zoom } }),
  /** 重新載入頁面。 */
  reload: (state) => ({ state, effect: { type: "reload" } }),
};

/**
 * 執行一個動作。
 * @param {string} name 動作名稱。
 * @param {unknown} arg 參數。
 * @param {object} state 狀態。
 * @param {object} context 卡片情境。
 * @returns {{ state: object, route?: string, effect?: object }}
 */
function dispatch(name, arg, state, context) {
  const action = ACTIONS[name];
  // 未登錄的動作是程式錯誤
  if (!action) throw new Error(`沒有登錄動作 ${name}`);
  // 看別人分享的結果時，會修改作答、參數或本機資料的動作不執行，狀態維持原樣
  if (state.shared && !SHARED_ACTIONS.has(name)) return { state };
  return action(state, arg, context);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { dispatch, enterPage };
