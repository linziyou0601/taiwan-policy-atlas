/* ==================================================
 * cards/kit.js - 卡片共用的片段
 * --------------------------------------------------
 * - 角色：卡片組成 info（代入步驟、資料來源、設定值）、格式化文字與推出流程步驟時共用的函式
 * - 指令：import { step, info, constants, pct, num, t, flowSteps, stanceName, blendFormula } from "./kit.js"
 * - 慣例：
 *   - 步驟寫成 { label, value, formula, rule }：label 是這一步算什麼，value 是結果，formula 是代入值後的算式，rule 是依據的規則
 *   - 設定值以 settings 的路徑列出，讀者能對照 config/app/settings.json
 * ================================================== */

import { text, SETTINGS, LAYOUT } from "../config/index.js";
import { getPath } from "../lib/objects.js";
import { issueOf } from "../metrics/index.js";
import { percent, fixed, fill, shortHash } from "../lib/format.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 長條圖刻度上限的最小值。全部的值都是 0 時刻度仍有寬度，長條不會因為除以 0 消失。
 */
const SCALE_FLOOR = 0.0001;

/**
 * 計分相關的設定路徑，info 的設定值列出這些。
 */
const SCORING_PATHS = ["scoring.formula", "scoring.formulaParams", "scoring.agreement", "scoring.stanceAggregate", "scoring.consensusRule", "scoring.includeConsensus", "scoring.commonOnly", "scoring.sourceMode", "scoring.coverageThreshold"];

/**
 * 還沒選題組時當作哪一種題組：layout 的 kinds 第一種，流程步驟與卡片依它列出。
 */
const DEFAULT_KIND = Object.keys(LAYOUT.kinds)[0];

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} Step 一個代入步驟。
 * @property {string} label 這一步算什麼。
 * @property {string} value 結果。
 * @property {string} formula 代入值後的算式。
 * @property {string} rule 依據的規則。
 */

/**
 * @typedef {object} CardInfo 卡片說明視窗的內容。
 * @property {Step[]} steps 代入步驟。
 * @property {string[]} sources 資料來源。
 * @property {{ path: string, value: string, changed: boolean }[]} constants 用到的設定值，changed 表示與預設不同。
 */

/**
 * @typedef {object} CardOutput 卡片 build 函式的回傳。
 * @property {(object|null)[]} blocks 區塊描述，選填的區塊以 null 占位，顯示層略過。
 * @property {CardInfo|null} info 說明視窗的內容，沒有說明的卡片為 null。
 * @property {boolean} [titled] 卡片裡有這一頁可見的 h1（首頁主視覺），頁面不另放隱藏的 h1。
 * @property {string[]} [digits] 數字鍵依序對應的動作，作答卡以它讓數字鍵依序選量尺或單選題的選項。
 */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 查文案的簡寫。
 * @param {string} key 文案鍵。
 * @param {Record<string, unknown>} [values] 代入值，有值時以 fill 代入。
 * @returns {any}
 */
function t(key, values) {
  const value = text(key);
  // 有代入值時代入樣板
  return values ? fill(value, values) : value;
}

/**
 * 比例寫成百分比，缺值寫 locale 的缺值文字。
 * @param {number|null} value 比例。
 * @param {number} [digits=0] 小數位數。
 * @returns {string}
 */
function pct(value, digits = 0) {
  return percent(value, digits, text("common.missing"));
}

/**
 * 數值寫成固定小數位，缺值寫 locale 的缺值文字。
 * @param {number|null} value 數值。
 * @param {number} [digits=2] 小數位數。
 * @returns {string}
 */
function num(value, digits = 2) {
  return fixed(value, digits, text("common.missing"));
}

/**
 * 一個代入步驟。
 * @param {string} label 這一步算什麼。
 * @param {string} value 結果。
 * @param {string} [formula] 代入值後的算式。
 * @param {string} [rule] 依據的規則。
 * @returns {{ label: string, value: string, formula: string, rule: string }}
 */
function step(label, value, formula = "", rule = "") {
  return { label, value, formula, rule };
}

/**
 * 列出設定值。
 * @param {object} settings 合併後的設定。
 * @param {string[]} paths 設定路徑。
 * @returns {{ path: string, value: string, changed: boolean }[]}
 */
function constants(settings, paths) {
  // changed 標示與設定檔預設值不同的參數
  return paths.map((path) => ({ path, value: JSON.stringify(getPath(settings, path)), changed: JSON.stringify(getPath(settings, path)) !== JSON.stringify(getPath(SETTINGS, path)) }));
}

/**
 * 組成卡片的 info。
 * @param {object} parts info 的內容。
 * @param {object[]} [parts.steps] 代入步驟。
 * @param {string[]} [parts.sources] 資料來源。
 * @param {object[]} [parts.constants] 設定值。
 * @returns {{ steps: object[], sources: string[], constants: object[] }}
 */
function info({ steps = [], sources = [], constants: values = [] } = {}) {
  return { steps, sources, constants: values };
}

/**
 * 目前題組的資料來源說明，每張與計分有關的卡都列出。
 * @param {object} context 卡片情境。
 * @returns {string[]}
 */
function dataSources(context) {
  // 沒有題組時只列設定表
  if (!context.set) return [t("sources.tables")];
  const manifest = context.set.manifest;
  return [
    t("sources.dataset", { label: context.set.label, version: manifest.data_version }),
    // 選舉的資料集有受控詞表，主題測驗沒有
    manifest.vocab ? t("sources.vocab", { version: manifest.vocab.version, hash: shortHash(manifest.vocab.hash) }) : null,
    t("sources.tables"),
    // 含自訂資料時在來源中標明
    context.model?.custom ? t("sources.custom") : null,
  ].filter(Boolean);
}

/**
 * 沒有作答時的提示卡內容。說明視窗照常可開，列出資料來源，卡片的說明鈕不會時有時無。
 * @param {object} context 卡片情境。
 * @returns {CardOutput}
 */
function notAnsweredCard(context) {
  return { blocks: [{ type: "notice", tone: "warning", text: t("result.notAnswered") }, { type: "buttons", items: [{ label: t("result.toQuiz"), icon: "arrowRight", trailing: true, action: `route:${LAYOUT.roles.answer}`, tone: "accent" }] }], info: info({ sources: dataSources(context) }) };
}

/**
 * 名稱比對用的鍵：依地圖產物的 name_equivalents 替換異體字，名冊與地圖的「臺」「台」才對得上。
 * @param {object} context 卡片情境。
 * @param {string} name 名稱。
 * @returns {string}
 */
function nameKey(context, name) {
  const pairs = Object.entries(context.data.map?.name_equivalents ?? {});
  return pairs.reduce((value, [from, to]) => value.replaceAll(from, to), name ?? "");
}

/**
 * 選區是否涵蓋某個鄉鎮：名稱以 nameKey 比對，「臺」「台」視為相同。
 * @param {object} context 卡片情境。
 * @param {{ towns: string[] }} scope 選區。
 * @param {string} townName 鄉鎮名稱。
 * @returns {boolean}
 */
function coversTown(context, scope, townName) {
  const key = nameKey(context, townName);
  return scope.towns.some((name) => nameKey(context, name) === key);
}

/**
 * 分類節點的名稱。
 * @param {object} context 卡片情境。
 * @param {string} code 節點代碼。
 * @returns {string}
 */
function issueName(context, code) {
  return (context.model?.taxonomy ?? context.data.taxonomy).get(code)?.name ?? code;
}

/**
 * 軸位置換成正極所占的比例，主題測驗的光譜長條與分享圖片共用。
 * @param {number|null} value 軸位置，在 settings.ideology 的範圍內。
 * @returns {number|null} 0 到 1，沒有位置時為 null。
 */
function poleShare(value) {
  // 沒有作答的軸沒有比例
  if (value === null || value === undefined) return null;
  const { min, max } = SETTINGS.ideology;
  return (value - min) / (max - min);
}

/**
 * 一題對各軸的影響：同意時往哪一極、權重多少。作答卡的 info 與題目明細共用。
 * @param {object} model 資料模型。
 * @param {string} questionId 題目。
 * @returns {{ axis: string, text: string }[]} axis 是軸名稱。
 */
function axisEffects(model, questionId) {
  const axes = new Map(model.axes.map((axis) => [axis.code, axis]));
  // 一題可以對應多條軸，每條一筆
  return (model.axesByQuestion.get(questionId) ?? []).map((link) => {
    const axis = axes.get(link.axis);
    // 方向為正時同意往正極，否則往負極
    return { axis: axis.name, text: t("topic.effect", { pole: link.direction > 0 ? axis.positive : axis.negative, weight: num(link.weight, 0) }) };
  });
}

/**
 * 圖表上代表作答者的名稱：自己的結果寫「你」，看別人分享的結果時寫「分享者」。
 * @param {object} context 卡片情境。
 * @returns {string}
 */
function youLabel(context) {
  // 依是否在看別人分享的結果選用文案
  return t(context.state.shared ? "shared.sharer" : "result.you");
}

/**
 * 頁面或卡片位置是否適用某種題組：layout 標了 kinds 時只用於列出的種類，沒標時每種都適用。
 * @param {{ kinds?: string[] }} spec layout 的頁面或卡片位置。
 * @param {string|null} kind 題組的種類，還沒選題組時視為 layout 的 kinds 第一種。
 * @returns {boolean}
 */
function fitsKind(spec, kind) {
  return !spec.kinds || spec.kinds.includes(kind ?? DEFAULT_KIND);
}

/**
 * 卡片位置是否用於目前的題組。只用於特定種類的卡片（layout 標了 kinds）在題組宣告了 cards 時，要列在 cards 裡才組，例如沒有雷達的題組不組雷達卡。
 * @param {{ card: string, kinds?: string[] }} slot layout 的卡片位置。
 * @param {object|null} set 題組的索引資料。
 * @returns {boolean}
 */
function fitsSet(slot, set) {
  return !slot.kinds || !set?.cards || set.cards.includes(slot.card);
}

/**
 * 一個題組要走的流程步驟：layout 的 flow 中適用這種題組的頁面，選舉有預設選區時再略過標了 skipWithDefaultScope 的頁面（選區頁）。
 * @param {object|null} set 題組的索引資料，沒有題組時列出第一種題組的步驟。
 * @returns {string[]} 頁面代碼。
 */
function flowSteps(set) {
  return LAYOUT.flow.filter((page) => fitsKind(LAYOUT.pages[page], set?.kind ?? null) && !(LAYOUT.pages[page].skipWithDefaultScope && set?.default_scope));
}

/**
 * 流程中某一頁的下一步。
 * @param {string} page 目前的頁面。
 * @param {object|null} set 題組的索引資料。
 * @returns {string|null} 下一步的頁面，已是最後一步時為 null。
 */
function nextStep(page, set) {
  const steps = flowSteps(set);
  // 不在流程中的頁面沒有下一步
  return steps.includes(page) ? (steps[steps.indexOf(page) + 1] ?? null) : null;
}

/**
 * 收進「更多」的頁面：導覽列有、手機底部分頁列沒有的頁面。
 * @returns {string[]}
 */
function morePages() {
  return LAYOUT.nav.filter((page) => !LAYOUT.mobileNav.includes(page));
}

/**
 * 頁尾與「更多」視窗共用的說明：網站版本、資料儲存、授權，以及題組資料載入後的資料版本。
 * @param {object} context 卡片情境。
 * @returns {string[]}
 */
function aboutLines(context) {
  // 網站版本取自建置清單，題組資料載入後才有資料版本
  return [t("common.appVersion", { version: context.data.build.version }), t("common.privacy"), t("common.license"), ...(context.set ? [t("common.dataVersion", { version: context.set.manifest.data_version })] : [])];
}

/**
 * 長條圖的刻度：0 到最大值，全部是 0 時上限取 SCALE_FLOOR。
 * @param {number[]} values 各條的值。
 * @returns {[number, number]}
 */
function barScale(values) {
  return [0, Math.max(SCALE_FLOOR, ...values)];
}

/**
 * 把幾個名稱接成一串，分隔字元取自 locale 的 `common.listSeparator`。
 * @param {string[]} items 名稱。
 * @returns {string}
 */
function listText(items) {
  return items.join(t("common.listSeparator"));
}

/**
 * 面向的路徑文字：「議題 › 面向」，面向本身就是議題時只寫一次。
 * @param {object} context 卡片情境。
 * @param {string} facet 面向代碼。
 * @returns {string}
 */
function facetPath(context, facet) {
  const names = [issueOf(context.model.taxonomy, facet), facet].map((code) => issueName(context, code));
  // 兩層同名時只留一個
  return [...new Set(names)].join(t("common.pathSeparator"));
}

/**
 * 候選人的政黨標記：黨名、簡稱與 party-marks.tsv 的色票。翻牌前回傳 null，畫面不出現黨名。
 * @param {object} context 卡片情境。
 * @param {string} entityId 候選人代碼。
 * @returns {{ name: string, short: string, mark: { light: string, dark: string }|null }|null} 政黨表沒有登錄的黨名，mark 為 null，畫面只寫名稱。
 */
function partyOf(context, entityId) {
  // 翻牌前不給任何政黨資訊
  if (!context.revealed) return null;
  const name = context.model.entities.get(entityId).party;
  const row = context.data.tables.parties.find((item) => item.name === name) ?? null;
  // 政黨表有簡稱時用簡稱，沒有時沿用全名
  return { name, short: row?.short ?? name, mark: row ? { light: row.light, dark: row.dark } : null };
}

/**
 * 立場數值對應的判準名稱，取最接近的整數級。
 * @param {object} model 資料模型。
 * @param {number|null} value 立場。
 * @returns {string}
 */
function stanceName(model, value) {
  // 未表態時寫此議題未提出政見
  if (value === null) return t("result.noPolicy");
  const rounded = Math.round(value);
  const row = [...model.stances.values()].find((item) => item.value === rounded);
  // 找不到對應判準時退回顯示數值本身，不讓畫面出現空白
  return row ? row.name : num(value, 1);
}

/**
 * 總分的代入式。
 * @param {object} context 卡片情境。
 * @param {object} entity 候選人結果。
 * @returns {string}
 */
function blendFormula(context, entity) {
  const used = entity.blend.terms.filter((term) => term.used);
  // 沒有可用分項時只寫缺值
  if (!used.length) return t("common.missing");
  // 分子是各分項的權重乘值，分母是權重和，樣板與運算子寫在 locale
  const numerator = used.map((term) => t("result.blendTerm", { weight: num(term.weight), value: num(term.value, 3) })).join(t("result.blendPlus"));
  const denominator = used.map((term) => num(term.weight)).join(t("result.blendPlus"));
  return t("result.blendFormula", { numerator, denominator, total: num(entity.total, 3) });
}

/* ==================================================
 * 匯出
 * ================================================== */

export { t, pct, num, step, constants, info, dataSources, notAnsweredCard, poleShare, axisEffects, issueName, partyOf, facetPath, coversTown, fitsKind, fitsSet, flowSteps, nextStep, morePages, aboutLines, listText, youLabel, stanceName, blendFormula, barScale, SCORING_PATHS };
