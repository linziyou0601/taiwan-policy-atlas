/* ==================================================
 * cards/index.js - 卡片登錄表與頁面組裝
 * --------------------------------------------------
 * - 角色：集中登錄全部卡片，依 layout.json 組成一頁的卡片描述，並匯出 app 層需要的狀態、動作、分享與視窗函式
 * - 指令：import { buildPage, dispatch, createContext } from "../cards/index.js"
 * - 慣例：
 *   - 卡片的標題、回答的問題與讀法寫在 locale 的 cards.{代碼}，info 視窗依序顯示這三項與代入步驟、資料來源、設定值
 *   - 頁面需要的題組、選區、政見資料或完整作答不足時，以提示卡取代該頁的卡片
 *   - layout 的頁面與卡片位置標了 kinds 時，只用於列出的題組種類：選區與重視度頁只用於選舉，結果頁依種類組不同的卡片。題組宣告了 cards 時，種類專用的卡片只組列在 cards 裡的
 *   - 缺的條件在 layout 的 needs 標了 lock 時，導覽列與步驟列的那一頁停用，滑過時說明還差什麼
 *   - 看別人分享的結果時，需要 own 的頁面以提示卡取代，layout 標為 private 的卡片不組，頁首下方加一條說明
 * ================================================== */

import { LAYOUT, SETTINGS } from "../config/index.js";
import { shortHash } from "../lib/format.js";
import { t, pct, fitsKind, fitsSet, flowSteps, morePages, aboutLines } from "./kit.js";
import { FLOW_CARDS } from "./flow.js";
import { QUIZ_CARDS } from "./quiz.js";
import { RESULT_CARDS } from "./result.js";
import { TOPIC_CARDS } from "./topic.js";
import { partyPalette } from "./series.js";
import { METHODS_CARDS } from "./methods.js";
import { DATASET_CARDS } from "./dataset.js";
import { HELP_CARDS } from "./help.js";
import { missingNeed } from "./session.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 頁首主題與縮放切換的圖示，鍵是選項代碼。
 */
const CONTROL_ICONS = { theme: { system: "monitor", light: "sun", dark: "moon" }, zoom: { small: "zoomOut", default: "zoomReset", large: "zoomIn" } };

/**
 * 版面格線的欄數，卡片的 span 以它為一整列，與顯示層的 grid-cols-12 相同。
 */
const GRID_COLUMNS = 12;

/**
 * 全部卡片。
 */
const CARDS = { ...FLOW_CARDS, ...QUIZ_CARDS, ...RESULT_CARDS, ...TOPIC_CARDS, ...METHODS_CARDS, ...DATASET_CARDS, ...HELP_CARDS };

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 卡片的標題、回答的問題與讀法。卡片代碼含點，以 `cards` 整張表的鍵查詢。
 * @param {string} id 卡片代碼。
 * @returns {{ title: string, question: string, read: string }}
 */
function cardText(id) {
  const entry = t("cards")[id];
  // 缺少文案是設定錯誤
  if (!entry) throw new Error(`locale 缺少 cards 的 ${id}`);
  return { title: entry.title, question: entry.question, read: entry.read };
}

/**
 * 組成一張卡片的描述。
 * @param {string} id 卡片代碼。
 * @param {object} context 卡片情境。
 * @param {object} [slot] layout 中的位置設定。
 * @returns {{ id: string, span: number, frame: string, section: string|null, title: string, question: string, read: string, blocks: (object|null)[], info: import("./kit.js").CardInfo|null }}
 */
function buildCard(id, context, slot = {}) {
  const card = CARDS[id];
  // layout 引用了未登錄的卡片是設定錯誤
  if (!card) throw new Error(`沒有登錄卡片 ${id}`);
  const output = card.build(context);
  return {
    id,
    span: slot.span ?? GRID_COLUMNS,
    frame: slot.frame ?? "card",
    section: slot.section ?? null,
    ...cardText(id),
    blocks: output.blocks,
    info: output.info ?? null,
    titled: Boolean(output.titled),
    digits: output.digits ?? [],
    // 有 info 的卡片才有說明鈕的動作
    infoAction: output.info ? `openInfo:${id}` : null,
  };
}

/**
 * 頁面條件未滿足時取代整頁的提示卡：warning 提示加一個按鈕，按鈕的動作寫在 layout 的 needs。
 * @param {object} context 卡片情境。
 * @param {string} need 未滿足的條件。
 * @param {string} template 這一頁的版型，流程頁的提示卡用流程頁的外框。
 * @returns {object} 卡片描述，欄位與 buildCard 的結果相同。
 */
function needCard(context, need, template) {
  return {
    id: `need.${need}`,
    span: GRID_COLUMNS,
    // 流程頁的提示卡用流程頁的外框
    frame: template === "flow" ? "flow" : "card",
    section: null,
    title: t(`needs.${need}.title`),
    question: "",
    read: "",
    blocks: [{ type: "notice", tone: "warning", text: t(`needs.${need}.text`) }, { type: "buttons", items: [{ label: t(`needs.${need}.action`), icon: "arrowRight", trailing: true, action: LAYOUT.needs[need].action, tone: "accent" }] }],
    info: null,
    infoAction: null,
    titled: false,
    digits: [],
  };
}

/**
 * 頁首的主題與縮放切換：每個選項的名稱、圖示與動作。
 * @param {object} context 卡片情境。
 * @returns {{ theme: object, zoom: object }}
 */
function displayControls(context) {
  /**
   * 一組切換的描述。
   * @param {string} key theme 或 zoom。
   * @param {string[]} codes 選項代碼。
   * @param {string} action 動作名稱。
   * @param {string} labels 選項文案在 locale 的前綴。
   * @returns {{ label: string, value: string, options: { value: string, label: string, icon: string, action: string }[] }}
   */
  const control = (key, codes, action, labels) => ({ label: t(`common.${key}`), value: context.state[key], options: codes.map((code) => ({ value: code, label: t(`${labels}.${code}`), icon: CONTROL_ICONS[key][code], action: `${action}:${code}` })) });
  return { theme: control("theme", SETTINGS.display.themes, "setTheme", "themes"), zoom: control("zoom", Object.keys(SETTINGS.display.zooms), "setZoom", "zooms") };
}

/**
 * 一頁的入口鎖定時的說明。
 * @param {object} context 卡片情境。
 * @param {string} page 頁面代碼。
 * @returns {string|null} 缺的條件在 layout 的 needs 標了 lock 時回傳說明，可以前往時為 null。
 */
function lockOf(context, page) {
  const need = missingNeed(context, page);
  // 沒有缺的條件，或缺的條件沒有標 lock 時照常可以前往，到了那一頁再由提示卡說明
  if (!need || !LAYOUT.needs[need].lock) return null;
  return t(`needs.${need}.lock`);
}

/**
 * 流程頁底部的上一步與下一步。只有一個選區的選舉，前後步都跳過選區頁。
 * @param {object} context 卡片情境。
 * @returns {{ prev: object|null, next: object|null, hint: string|null }} prev 與 next 是按鈕描述，hint 說明下一步為什麼還不能按。
 */
function stepNav(context) {
  const steps = flowSteps(context.set);
  const index = steps.indexOf(context.page);
  // 第一步沒有上一步，最後一步沒有下一步
  const prevPage = index > 0 ? steps[index - 1] : null;
  const nextPage = steps[index + 1] ?? null;
  // 下一頁的條件還沒滿足時，下一步停用並說明缺什麼
  const need = nextPage ? missingNeed(context, nextPage) : null;
  // 下一頁是作答時按鈕寫「開始作答」，其餘寫「下一步：頁名」
  const start = nextPage === LAYOUT.roles.answer;
  // 沒有上一頁或下一頁的那一側不放按鈕
  return {
    prev: prevPage ? { label: t("flow.prev", { page: t(`pages.${prevPage}`) }), icon: "arrowLeft", action: `route:${prevPage}`, tone: "neutral" } : null,
    // 下一步在條件不足時停用
    next: nextPage ? { label: t(start ? "flow.start" : "flow.next", { page: t(`pages.${nextPage}`) }), icon: start ? "play" : "arrowRight", trailing: !start, action: `route:${nextPage}`, tone: "accent", disabled: Boolean(need) } : null,
    // 停用時說明缺什麼
    hint: need ? t(`needs.${need}.title`) : null,
  };
}

/**
 * 把 layout 的卡片位置依 span 分成列，每列 span 合計 12。一列中有卡片沒組時，同一列留下的最後一張補滿整列，版面不留空洞。
 * @param {object[]} slots layout 的全部卡片位置，依頁面順序。
 * @param {(slot: object) => boolean} kept 這個位置的卡片是否要組。
 * @returns {object[]} 要組的卡片位置，span 已調整。
 */
function fillRows(slots, kept) {
  const rows = [];
  let width = GRID_COLUMNS;
  // 依序累加 span，滿一整列就換下一列
  for (const slot of slots) {
    // 這一列放不下時另起一列
    if (width + (slot.span ?? GRID_COLUMNS) > GRID_COLUMNS) {
      rows.push([]);
      width = 0;
    }
    // 放進目前這一列並累計寬度
    rows.at(-1).push(slot);
    width += slot.span ?? GRID_COLUMNS;
  }
  // 逐列留下要組的卡片
  return rows.flatMap((row) => {
    const shown = row.filter(kept);
    // 整列都組或整列都不組時不必調整
    if (shown.length === row.length || !shown.length) return shown;
    // 少了卡片的列由最後一張補滿
    const used = shown.slice(0, -1).reduce((sum, slot) => sum + (slot.span ?? GRID_COLUMNS), 0);
    return [...shown.slice(0, -1), { ...shown.at(-1), span: GRID_COLUMNS - used }];
  });
}

/**
 * 組成一頁的卡片。版型由 layout 的 template 決定：landing、flow、dashboard、document。
 * @param {object} context 卡片情境。
 * @returns {{ page: string, template: string, width: string, cards: object[], sticky: object|null, flow: object, nav: object[], progress: object|null, stepNav: object|null, leave: object, tabs: object, banner: object|null, sections: object|null, section: string|null, palette: object|null, titled: boolean }} titled 表示卡片裡已有可見的 h1，palette 是翻牌後的政黨配色，tabs 是手機的底部分頁列，banner 是觀看別人分享的結果時的說明列，sections 與 section 是分區與所在分區。
 */
function buildPage(context) {
  const spec = LAYOUT.pages[context.page];
  const need = missingNeed(context);
  // 流程頁頁首的各步驟與目前所在步驟
  // 每個入口都附上前往的動作，鎖住時由外框改寫成說明
  const entry = (page) => ({ page, label: t(`pages.${page}`), action: `route:${page}`, icon: LAYOUT.pages[page].icon ?? null, current: page === context.page, lock: lockOf(context, page) });
  const flow = { steps: flowSteps(context.set).map(entry) };
  const nav = LAYOUT.nav.map(entry);
  // 手機的底部分頁列：layout 的 mobileNav 各一格，顯示兩個字的短名稱，其餘頁面納入「更多」
  const rest = morePages();
  const tabs = { items: nav.filter((item) => LAYOUT.mobileNav.includes(item.page)).map((item) => ({ ...item, short: t(`nav.tabs.${item.page}`) })), more: { page: "more", label: t("nav.more"), short: t("nav.more"), action: "openMore", icon: "more", popup: "dialog", current: rest.includes(context.page), lock: null } };
  // 流程頁的離開鈕回到首頁，作答到一半時 route 動作先確認
  const quiz = context.page === LAYOUT.roles.answer && !context.state.shared;
  // 作答頁的離開鈕寫「放棄作答」，提醒作答到一半會放棄。看別人分享的結果時沒有作答可以放棄，照常寫「離開」
  const leave = { label: t(quiz ? "quiz.leave" : "flow.leave"), icon: "exit", action: `route:${LAYOUT.defaultPage}`, tip: t(quiz ? "quiz.leaveTip" : "flow.leaveTip") };
  // 看別人分享的結果時，每一頁的頁首下方都有一條說明，附上回到自己的作答與開始作答
  const banner = context.state.shared ? { text: t("shared.banner"), actions: [{ label: t("shared.exit"), icon: "exit", action: "exitShared", tone: "neutral", size: "sm" }, { label: t("shared.start"), icon: "play", action: `exitShared:${LAYOUT.flow[0]}`, tone: "accent", size: "sm" }] } : null;
  // 版型共用的部分，提示卡與一般卡片都用同一個頁首
  // 頁首的品牌鈕回首頁，手機的頂端列寫頁名，首頁寫品牌名
  const title = t(`pages.${context.page}`);
  const brand = { label: t("brand.name"), action: `route:${LAYOUT.defaultPage}` };
  // 有題組時才有政黨配色，首頁之類還沒選題組的頁面維持中立色，主題測驗沒有候選人，配色是空的
  const frame = { page: context.page, template: spec.template, width: spec.width ?? "normal", title, phoneTitle: context.page === LAYOUT.defaultPage ? brand.label : title, brand, controls: displayControls(context), about: aboutLines(context), flow, nav, tabs, leave, banner, palette: context.set ? partyPalette(context) : null };
  // 條件未滿足時只放一張提示卡，沿用這一頁的版型
  if (need) {
    return {
      ...frame,
      progress: null,
      sections: null,
      section: null,
      stepNav: null,
      titled: false,
      sticky: null,
      cards: [needCard(context, need, spec.template)],
      digits: [],
    };
  }
  // 依 layout 的位置逐張組成適用這個題組的卡片。看別人分享的結果時，含逐題作答的卡片（private）不組
  const cards = fillRows(spec.cards, (slot) => fitsKind(slot, context.kind) && fitsSet(slot, context.set) && !(slot.private && context.state.shared)).map((slot) => buildCard(slot.card, context, slot));
  // 分區只列出還有卡片的，含逐題作答的卡片被移除後，空的分區不出現
  const present = spec.sections?.filter((key) => cards.some((card) => card.section === key)) ?? [];
  // 只剩一個分區時不分區，手機不放只有一格的分頁籤
  const sections = present.length > 1 ? present : null;
  // 作答頁的頁首多一列作答進度
  const progress = spec.progress ? context.progress() : null;
  // 總題數為 0 時比例記為 0，避免除以 0
  const ratio = progress?.total ? progress.done / progress.total : 0;
  // 分區：手機一次只顯示一區，寬螢幕照常全部顯示。所在分區記在 view，不認得時回到第一區
  const section = sections?.includes(context.state.view.resultSection) ? context.state.view.resultSection : (sections?.[0] ?? null);
  return {
    ...frame,
    // 有分區的頁面列出分區分頁籤
    sections: sections ? { label: t("sections.label"), items: sections.map((key) => ({ key, label: t(`sections.${key}`), action: `setSection:${key}`, selected: key === section })) } : null,
    section,
    // 只有作答頁有進度列
    progress: progress ? { value: ratio, label: t("quiz.progress", { answered: progress.done, total: progress.total, percent: pct(ratio) }) } : null,
    // 選擇、選區與重視度頁的底部有上一步與下一步，作答頁由題目的上下題導覽
    stepNav: spec.stepNav ? stepNav(context) : null,
    // 有固定在頂端的卡片且適用這種題組時才組，沒有就留空
    sticky: spec.sticky && fitsKind(spec.sticky, context.kind) && fitsSet(spec.sticky, context.set) ? buildCard(spec.sticky.card, context, { frame: "sticky" }) : null,
    cards,
    // 卡片裡已有可見的 h1 時（首頁主視覺），頁面不另放隱藏的 h1
    titled: cards.some((card) => card.titled),
    // 數字鍵的動作取自宣告了 digits 的卡片，沒有的頁面按數字鍵不做事
    digits: cards.find((card) => card.digits.length)?.digits ?? [],
  };
}

/**
 * 取代整頁的擋板：程式與資料版本不一致（stale），或開機時發生錯誤（error）。
 */
const GATES = {
  /** 瀏覽器快取了舊版的程式或資料，顯示兩邊的引擎雜湊。 */
  stale: ({ app, build }) => ({ title: t("gate.staleTitle"), text: t("gate.staleText"), detail: t("gate.staleDetail", { app: shortHash(app), build: shortHash(build) }) }),
  /** 開機錯誤。資料錯誤有對應的說明，其餘顯示一般錯誤。 */
  error: (error) => ({ title: t("gate.errorTitle"), text: error?.code ? t(`errors.${error.code}`, { detail: error.detail ?? "" }) : t("gate.errorText"), detail: String(error?.message ?? error) }),
};

/**
 * 組成擋板的內容。
 * @param {string} kind GATES 的鍵。
 * @param {unknown} input 該種擋板的參數，見 GATES。
 * @returns {{ title: string, text: string, detail: string }}
 */
function buildGate(kind, input) {
  return GATES[kind](input);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { buildCard, buildPage, buildGate };
export { dispatch, enterPage } from "./actions.js";
export { DEFAULT_STATE, STATE_GROUPS, normalizeState } from "./state.js";
export { ensureData, reconcile, createContext } from "./session.js";
export { encodeShare, decodeShare, mismatchMessage, shareImageSpec } from "./share.js";
export { buildModal } from "./modals.js";
