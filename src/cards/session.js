/* ==================================================
 * cards/session.js - 資料載入與卡片的共用情境
 * --------------------------------------------------
 * - 角色：依頁面需要載入索引、設定表、地圖與資料集並快取，組成卡片共用的情境：設定、題組、模型、結果與顯示名稱
 * - 指令：import { ensureData, reconcile, createContext, missingNeed, settingsFor } from "./session.js"，app 層經由 cards/index.js 取得
 * - 慣例：
 *   - 同一份檔案只載入一次，資料集依題組代碼快取，選區檔依題組與選區快取，模型依題組、選區與自訂資料快取。題組是一場選舉或一套主題測驗，種類寫在索引的 kind，種類的特性寫在 layout 的 kinds
 *   - 結果依影響計分的狀態快取，參數不變時切換頁面不重新計算
 *   - 翻牌前所有顯示名稱都經遮蔽，卡片一律用 context.label 與 context.mask 取得文字
 * ================================================== */

import { SETTINGS, LAYOUT, text } from "../config/index.js";
import { setPath, deepMerge, indexBy } from "../lib/objects.js";
import { fill } from "../lib/format.js";
import { loadBuild, loadIndex, loadTables, loadDataset, loadScope, withScope, loadMap, loadVillages, buildModel, applyCustom, questionsFor, resultsFor, sensitivity, fixedAnswerCheck, issueAgreement, maskText, maskIndex } from "../metrics/index.js";
import { archiveStale } from "./state.js";
import { fitsKind } from "./kit.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} Context 卡片共用的情境。
 * @property {object} state 狀態。
 * @property {string} page 目前所在的頁面代碼。
 * @property {object} settings 合併使用者參數後的設定。
 * @property {object} data 已載入的檔案：build、index、tables、taxonomy（分類樹以代碼建的索引）、map。
 * @property {object|null} set 目前題組在索引中的一筆：一場選舉或一套主題測驗。
 * @property {string|null} kind 目前題組的種類，索引的 kind，還沒選題組時為 null。
 * @property {object|null} model 目前題組的資料模型。
 * @property {object|null} scope 目前選區。
 * @property {object[]} entities 目前選區的候選人。
 * @property {string[]} entityIds 目前選區的候選人代碼，順序同 entities。
 * @property {boolean} revealed 這一頁是否顯示身分：使用者翻牌，且頁面沒有標 masked。
 * @property {(id: string) => string} label 候選人的顯示名稱，翻牌前為代號。
 * @property {(textContent: string) => string} mask 翻牌前遮蔽文字，翻牌後原樣回傳。
 * @property {{ setId: string|null, scopeId: string|null }} browsed 資料集頁瀏覽的題組與選區，沒有另外選時沿用目前的題組與選區。
 * @property {(setId: string, scopeId: string|null) => object|null} datasetModel 任一個已載入題組與選區的模型，資料集頁瀏覽其他題組或選區時使用。
 * @property {(setId: string) => object|null} findSet 題組在索引中的一筆，找不到時為 null。
 * @property {() => { all: object[], visible: object[] }} questions 本題組全部題目與依答案出現的題目，選舉依選區決定。
 * @property {() => { done: number, total: number, firstOpen: number }} progress 作答進度。
 * @property {() => object|null} results 目前狀態下的計分結果。
 * @property {() => { sensitivity: object, fixed: object[] }|null} robustness 敏感度與固定作答檢驗。
 * @property {() => { issues: string[], cells: Map<string, Map<string, object>> }|null} issueAgreement 議題 × 候選人的契合矩陣。
 */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 已載入的檔案與計算結果的快取。
 */
const CACHE = {
  build: null,
  index: null,
  tables: null,
  taxonomy: null,
  map: null,
  villages: new Map(),
  datasets: new Map(),
  scopes: new Map(),
  models: new Map(),
  results: new Map(),
  robustness: new Map(),
};

/**
 * 選區檔、模型、計分結果與檢驗各留最近幾份的快取。拖動滑桿時每一格都是新的狀態，舊的結果不再需要。
 */
const RESULT_CACHE_LIMIT = 8;

/**
 * 頁面條件的判斷，鍵與 layout.json 的 needs 相同，參數是情境與要檢查的頁面。條件不成立時提示卡的按鈕與是否鎖住入口寫在 layout。
 * - own：目前不是在檢視他人分享的結果
 * - set：已選題組
 * - kind：這一頁適用目前題組的種類（layout 頁面的 kinds），例如選區頁只用於選舉
 * - scope：已選選區，沒有選區的種類（layout kinds 的 scoped 為 false）不需要
 * - policy：選區有政見資料，沒有選區的種類不需要
 * - complete：至少有一題，且每一題都已作答或略過
 */
const NEED_CHECKS = {
  own: (context) => !context.state.shared,
  set: (context) => Boolean(context.set),
  kind: (context, page) => fitsKind(LAYOUT.pages[page], context.kind),
  scope: (context) => !scoped(context) || Boolean(context.scope),
  policy: (context) => !scoped(context) || Boolean(context.scope?.has_policy_data),
  complete: (context) => {
    const { total, firstOpen } = context.progress();
    return total > 0 && firstOpen < 0;
  },
};

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 目前題組的種類是否要選選區。
 * @param {Context} context 情境。
 * @returns {boolean} 還沒選題組時為 true，選區條件照常不成立。
 */
function scoped(context) {
  return !context.kind || LAYOUT.kinds[context.kind].scoped;
}

/**
 * 在索引中找一個題組。
 * @param {string|null} setId 題組代碼。
 * @returns {object|null}
 */
function findSet(setId) {
  return CACHE.index?.sets.find((item) => item.id === setId) ?? null;
}

/**
 * 從有上限的快取取值，沒有時計算後存入，超過上限時捨棄最早存入的一份。
 * @param {Map<string, unknown>} cache 快取。
 * @param {string} key 狀態的鍵。
 * @param {() => unknown} compute 計算函式。
 * @returns {unknown}
 */
function remember(cache, key, compute) {
  // 算過時直接回傳
  if (cache.has(key)) return cache.get(key);
  keep(cache, key, compute());
  return cache.get(key);
}

/**
 * 存入有上限的快取，超過上限時捨棄最早存入的一份。
 * @param {Map<string, unknown>} cache 快取。
 * @param {string} key 鍵。
 * @param {unknown} value 值。
 */
function keep(cache, key, value) {
  cache.set(key, value);
  // Map 依存入順序列出鍵，第一個就是最早存入的
  if (cache.size > RESULT_CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/**
 * 資料集頁瀏覽的題組與選區。
 * @param {object} state 狀態。
 * @returns {{ setId: string|null, scopeId: string|null }} 沒有另外選題組時沿用目前的題組，瀏覽目前的題組而沒有另外選選區時沿用目前的選區。
 */
function browsedIds(state) {
  const setId = state.view.datasetSet ?? state.setId;
  // 另外選的選區優先，瀏覽其他題組時沒有預設選區
  return { setId, scopeId: state.view.datasetScope ?? (setId === state.setId ? state.scopeId : null) };
}

/**
 * 把狀態中的參數覆蓋轉成設定。
 * @param {object} state 狀態。
 * @returns {object} 新的設定物件：預設設定依序疊上匯入的設定與結果頁的參數。
 */
function settingsFor(state) {
  let overrides = {};
  // 結果頁調整的參數與匯入的設定都以路徑記錄，匯入的設定先套用
  for (const [path, value] of Object.entries({ ...(state.customSettings?.overrides ?? {}), ...state.params })) overrides = setPath(overrides, path, value);
  return deepMerge(SETTINGS, overrides);
}

/**
 * 計分結果的快取鍵：只含影響計分的狀態。設定由預設設定、匯入的設定與參數疊成，鍵裡放後兩者就足以區分。自訂題庫以雜湊區分，換了題庫鍵就跟著改變。
 * @param {object} state 狀態。
 * @returns {string}
 */
function resultKey(state) {
  return JSON.stringify([state.setId, state.scopeId, state.answers, state.importance, state.params, state.customSettings?.overrides ?? null, state.custom?.hash ?? null]);
}

/**
 * 取得或建立一個題組與選區的模型，自訂資料屬於這個題組時併入。
 * @param {object} state 狀態。
 * @param {string} setId 題組代碼。
 * @param {string|null} scopeId 選區代碼，選舉的選區檔已載入時併入那個選區的資料。
 * @returns {object|null}
 */
function modelFor(state, setId, scopeId) {
  const dataset = CACHE.datasets.get(setId);
  // 資料集尚未載入時沒有模型
  if (!dataset) return null;
  const part = CACHE.scopes.get(`${setId}|${scopeId}`) ?? null;
  // 自訂資料只併入它所屬的那個題組，其他題組不受影響
  const customHash = state.custom?.setId === setId ? state.custom.hash : null;
  // 同一份資料、選區檔與自訂資料只建一次模型。鍵只在選區檔已載入時含選區，舊模型依上限淘汰
  return remember(CACHE.models, `${setId}|${part ? scopeId : ""}|${customHash}`, () => {
    const base = buildModel(findSet(setId).kind, withScope(dataset, part), CACHE.tables);
    // 有自訂資料時在基礎模型上套用，沒有就直接用基礎模型
    return customHash ? applyCustom(base, state.custom) : base;
  });
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依頁面需要載入檔案。
 * @param {object} state 狀態。
 * @param {string} page 頁面代碼。
 * @returns {Promise<void>}
 */
async function ensureData(state, page) {
  // 每頁都需要建置清單、索引與設定表
  if (!CACHE.build) {
    [CACHE.build, CACHE.index, CACHE.tables] = await Promise.all([loadBuild(), loadIndex(), loadTables()]);
    // 分類樹以代碼建索引，還沒有題組模型的頁面也能查議題名稱
    CACHE.taxonomy = indexBy(CACHE.tables.taxonomy, "code");
  }
  // 每頁額外要載入的資料寫在 layout 的 loads：datasetSet 是資料集頁另外選的題組，map 是地圖
  const loads = LAYOUT.pages[page]?.loads ?? [];
  // 目前的題組與選區一律載入，頁面宣告 datasetSet 時多載入資料集頁瀏覽的那一組
  const wanted = [{ setId: state.setId, scopeId: state.scopeId }, loads.includes("datasetSet") ? browsedIds(state) : null].filter((item) => item?.setId);
  // 逐一載入需要的資料集與選區檔
  for (const { setId, scopeId } of wanted) {
    const entry = findSet(setId);
    // 索引沒有的題組不載入，由 reconcile 清除
    if (!entry) continue;
    // 資料集只載入一次
    if (!CACHE.datasets.has(setId)) CACHE.datasets.set(setId, await loadDataset(entry, CACHE.index.allowed));
    const key = `${setId}|${scopeId}`;
    // 選舉選定選區後載入那個選區的選區檔，主題測驗沒有選區
    if (scopeId && entry.manifest.scope_files && !CACHE.scopes.has(key)) keep(CACHE.scopes, key, await loadScope(entry, scopeId, CACHE.index.allowed));
  }
  // 需要地圖的頁面載入一次地圖
  if (loads.includes("map") && !CACHE.map) CACHE.map = await loadMap();
  const { county } = state.view;
  // 選了縣市時另外載入那個縣市的村里地圖，選區由村里合併，每個縣市只載入一次
  if (loads.includes("map") && county && !CACHE.villages.has(county)) CACHE.villages.set(county, await loadVillages(county));
}

/**
 * 依載入的資料修正狀態：題組或選區不存在時清除，題意改變的答案移到封存。
 * @param {object} state 狀態。
 * @returns {object} 新狀態，沒有變動時回傳原狀態。
 */
function reconcile(state) {
  let next = state;
  // 索引沒有這個題組時清除題組、選區與答案
  if (state.setId && !findSet(state.setId)) return { ...state, setId: null, scopeId: null, answers: {} };
  // 還沒選題組時沒有模型，後面不必檢查選區與題意
  const model = state.setId ? modelFor(state, state.setId, state.scopeId) : null;
  // 選區不在這個題組時清除選區
  if (model && state.scopeId && !model.scopes.has(state.scopeId)) next = { ...next, scopeId: null };
  // 題意改變或代碼不認得的答案移到封存
  if (model) next = archiveStale(next, model.questions);
  return next;
}

/**
 * 組成卡片共用的情境。
 * @param {object} state 狀態。
 * @param {string} page 頁面代碼。
 * @returns {Context}
 */
function createContext(state, page) {
  const settings = settingsFor(state);
  const set = findSet(state.setId);
  // 題組資料尚未載入時沒有模型，後面的選區與候選人都是空的
  const model = set ? modelFor(state, set.id, state.scopeId) : null;
  // 沒選選區或選區已不存在時 scope 為 null，沒有選區的種類一律為 null
  const scope = model && state.scopeId ? (model.scopes.get(state.scopeId) ?? null) : null;
  // 沒有選區就沒有候選人
  const entities = scope ? (model.entitiesByScope.get(scope.id) ?? []) : [];
  const entityIds = entities.map((entity) => entity.id);
  // 翻牌只在結果等頁面生效，layout 標了 masked 的頁面（作答頁）一律遮蔽，作答時看不到身分
  const revealed = state.reveal && !LAYOUT.pages[page]?.masked;
  // 本選區題目的快取，第一次呼叫 questions() 時才計算
  let questions = null;
  // 議題契合矩陣同樣只算一次，熱力圖與議題分布共用
  let agreement = null;
  const labels = text("mask.labels");
  /**
   * 候選人的顯示名稱：翻牌後是姓名（正副組合加搭檔），翻牌前是代號。
   * @param {string} id 候選人。
   * @returns {string}
   */
  const label = (id) => {
    const entity = model?.entities.get(id);
    // 不認得的代碼原樣回傳
    if (!entity) return id;
    // 翻牌後顯示姓名
    if (revealed) return entity.running_mate ? fill(text("mask.ticket"), { name: entity.name, mate: entity.running_mate }) : entity.name;
    const index = maskIndex(model, id, entityIds);
    return fill(text("mask.label"), { letter: labels[index] ?? String(index + 1) });
  };
  // 情境把卡片需要的狀態、資料與衍生函式集中在一處，卡片不直接讀取全域快取
  const context = {
    page,
    state,
    settings,
    data: { build: CACHE.build, index: CACHE.index, tables: CACHE.tables, taxonomy: CACHE.taxonomy, map: CACHE.map, villages: CACHE.villages.get(state.view.county) ?? null },
    set,
    kind: set?.kind ?? null,
    model,
    scope,
    entities,
    entityIds,
    revealed,
    label,
    // 翻牌前遮蔽姓名、黨名與識別字
    mask: (textContent) => (revealed || !model ? (textContent ?? "") : maskText(model, textContent)),
    browsed: browsedIds(state),
    datasetModel: (setId, scopeId) => modelFor(state, setId, scopeId),
    findSet,
  };
  return Object.assign(context, {
    /**
     * 本題組全部題目與依答案出現的題目，作答路徑依題組的種類決定。
     * @returns {{ all: object[], visible: object[] }}
     */
    questions() {
      // 情境建立後狀態不變，題目只算一次，導覽、步驟列與作答卡共用同一份
      if (questions) return questions;
      // 沒有模型時沒有題目
      questions = model ? questionsFor(model, state) : { all: [], visible: [] };
      return questions;
    },
    /**
     * 作答進度：依答案出現的題目中，已作答或略過的題數與第一題未答的序號。
     * @returns {{ done: number, total: number, firstOpen: number }} firstOpen 在每一題都有紀錄時為 -1。
     */
    progress() {
      const { visible } = context.questions();
      return { done: visible.filter((entry) => state.answers[entry.id]).length, total: visible.length, firstOpen: visible.findIndex((entry) => !state.answers[entry.id]) };
    },
    /**
     * 目前狀態下的計分結果，依狀態快取。
     * @returns {object|null}
     */
    results() {
      // 沒有模型時無法計分，計分條件依題組的種類另有判斷
      if (!model) return null;
      return remember(CACHE.results, resultKey(state), () => resultsFor(model, state, settings));
    },
    /**
     * 敏感度與固定作答檢驗，計算量較大，依狀態快取。
     * @returns {{ sensitivity: object, fixed: object[] }|null}
     */
    robustness() {
      const base = context.results();
      // 沒有結果時無法檢驗
      if (!base) return null;
      return remember(CACHE.robustness, resultKey(state), () => ({ sensitivity: sensitivity(model, state, settings, base), fixed: fixedAnswerCheck(model, state, settings) }));
    },
    /**
     * 議題 × 候選人的契合矩陣，同一個情境只算一次。
     * @returns {{ issues: string[], cells: Map<string, Map<string, object>> }|null}
     */
    issueAgreement() {
      // 已算過或沒有結果時直接回傳
      if (agreement || !context.results()) return agreement;
      agreement = issueAgreement(model, context.results(), settings.scoring.stanceShrinkage);
      return agreement;
    },
  });
}

/**
 * 頁面需要但狀態尚未滿足的條件。
 * @param {Context} context 情境。
 * @param {string} [page] 要檢查的頁面，預設是目前所在的頁面。
 * @returns {string|null} 第一個未滿足的條件，全部滿足時為 null。
 */
function missingNeed(context, page = context.page) {
  const needs = LAYOUT.pages[page]?.needs ?? [];
  // 條件依 layout 的順序逐一檢查，前面的條件不成立時就停，不先算後面的：沒有選區時算不出作答進度
  return (
    needs.find((need) => {
      const met = NEED_CHECKS[need];
      // 條件沒有登錄是設定錯誤，直接拋出並寫出條件名稱
      if (!met) throw new Error(`沒有登錄頁面條件 ${need}`);
      return !met(context, page);
    }) ?? null
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { ensureData, reconcile, createContext, missingNeed, settingsFor };
