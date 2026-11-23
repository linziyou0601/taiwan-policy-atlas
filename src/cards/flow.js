/* ==================================================
 * cards/flow.js - 首頁與作答前的流程卡片
 * --------------------------------------------------
 * - 角色：首頁、選擇題組（選舉的年度與職位、主題測驗）、選區（地圖與清單）與議題重視度的卡片
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 地圖與清單讀同一份選區關係：選區的 county 與 geo 階段由涵蓋合併的選區圖形，兩個入口能選到的選區相同
 *   - 沒有政見資料的選舉與選區照常列出，標示缺口，選了之後在作答頁說明尚無資料
 * ================================================== */

import { LAYOUT, SETTINGS } from "../config/index.js";
import { groupBy } from "../lib/objects.js";
import { ancestorAt, issueOf, byTaxonomyOrder, questionWeights, importanceOf } from "../metrics/index.js";
import { t, pct, step, info, constants, issueName, listText } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 選區名單一次最多列出的筆數，村里長這類上千選區的選舉要先縮小範圍。
 */
const LIST_LIMIT = 200;

/**
 * 選區清單每一項列出的涵蓋範圍筆數，完整範圍在選區明細。
 */
const AREA_PREVIEW = 8;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 目前選舉的全部選區。
 * @param {object} context 卡片情境。
 * @returns {object[]}
 */
function electionScopes(context) {
  // 尚未載入選舉資料時回傳空清單，呼叫端不必另外判斷
  return context.model ? [...context.model.scopes.values()] : [];
}

/**
 * 依地圖與搜尋條件篩選選區。
 * @param {object} context 卡片情境。
 * @returns {object[]}
 */
function filteredScopes(context) {
  const { county, scopeQuery } = context.state.view;
  const query = scopeQuery.trim();
  return electionScopes(context).filter((scope) => {
    // 選了縣市時只列該縣市
    if (county && scope.county && scope.county !== county) return false;
    // 搜尋比對選區名稱與涵蓋範圍
    return !query || scope.name.includes(query) || scope.areas.some((area) => area.includes(query));
  });
}

/**
 * 一組選區在地圖上的統計：選區數與是否有政見資料，一個選區有政見資料就算有。
 * @param {object[]|undefined} scopes 選區。
 * @returns {{ count: number, policy: boolean }|undefined} 沒有選區時為 undefined。
 */
function scopeSummary(scopes) {
  // 沒有選區的縣市與鄉鎮只是底圖
  return scopes?.length ? { count: scopes.length, policy: scopes.some((scope) => scope.has_policy_data) } : undefined;
}

/**
 * 清單項目的政見資料標示：有資料使用強調色，尚無資料使用中性色。
 * @param {boolean} has 是否有政見資料。
 * @param {string} missingKey 尚無資料時的文案鍵。
 * @returns {{ badge: string, badgeTone: string }}
 */
function policyBadge(has, missingKey) {
  // 文案與色調都依是否有資料決定
  return { badge: t(has ? "election.hasPolicy" : missingKey), badgeTone: has ? "accent" : "neutral" };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 首頁主視覺。
 * @returns {import("./kit.js").CardOutput}
 */
function homeHero() {
  return {
    blocks: [
      {
        type: "hero",
        title: t("brand.name"),
        // 標語依逗號分段，每段整段排在同一行，窄螢幕只在段與段之間換行
        subtitle: t("home.tagline").split(/(?<=，)/),
        text: t("home.intro"),
        actions: [
          { label: t("home.start"), icon: "play", action: `route:${LAYOUT.flow[0]}`, tone: "accent" },
          { label: t("home.methods"), action: "route:methods", tone: "neutral" },
        ],
      },
      { type: "notice", tone: "neutral", text: t("common.privacy") },
    ],
    info: info({ sources: [t("sources.roster"), t("sources.bulletin")], constants: constants(SETTINGS, ["storage.key"]) }),
    // 主視覺的主標就是這一頁可見的 h1，頁面不另放隱藏的 h1
    titled: true,
  };
}

/**
 * 依受眾分開的入口。
 * @returns {import("./kit.js").CardOutput}
 */
function homeAudiences() {
  const items = LAYOUT.audiences.map((entry) => ({ title: t(`audiences.${entry.key}.title`), text: t(`audiences.${entry.key}.text`), action: `route:${entry.page}` }));
  return { blocks: [{ type: "entries", items }], info: info({ steps: [step(t("home.stepAudiences"), String(items.length))], sources: [t("sources.layout")] }) };
}

/**
 * 使用步驟。
 * @returns {import("./kit.js").CardOutput}
 */
function homeSteps() {
  return { blocks: [{ type: "steps", items: t("home.steps") }], info: info({ steps: [step(t("home.stepFlow"), String(LAYOUT.flow.length))], sources: [t("sources.layout")] }) };
}

/**
 * 選擇頁的選舉組：先選年度，再選職位。
 * @param {object} context 卡片情境。
 * @returns {(object|null)[]} 區塊。
 */
function electionGroup(context) {
  const elections = context.data.index.elections;
  const years = [...new Set(elections.map((item) => item.year))].sort((a, b) => b - a);
  // 預設選有政見資料的最近一屆
  const fallback = elections.filter((item) => item.manifest.has_policy_data).map((item) => item.year).sort((a, b) => b - a)[0] ?? years[0];
  const year = context.state.view.year ?? context.set?.year ?? fallback;
  // 只列選定年度的職位，年度預設用有政見資料的最近一屆
  const items = elections
    .filter((item) => item.year === year)
    .map((item) => ({
      title: item.office,
      text: item.label,
      meta: t("election.counts", { scopes: item.manifest.counts.scopes, entities: item.manifest.counts.entities }),
      ...policyBadge(item.manifest.has_policy_data, "election.noPolicy"),
      action: `selectSet:${item.id}`,
      selected: item.id === context.state.setId,
    }));
  return [
    { type: "tabs", label: t("election.year"), items: years.map((value) => ({ label: t("election.yearLabel", { year: value }), action: `setView:year=${value}`, selected: value === year })) },
    { type: "list", items, columns: 2 },
    { type: "notice", tone: "neutral", text: t("election.gapNote") },
  ];
}

/**
 * 選擇頁的主題測驗組：每套一格，寫出題數與軸數。
 * @param {object} context 卡片情境。
 * @returns {(object|null)[]} 區塊。
 */
function topicGroup(context) {
  const items = context.data.index.topics.map((item) => ({
    title: item.label,
    text: item.description,
    meta: t("topic.counts", { questions: item.manifest.counts.questions, axes: item.manifest.counts.axes }),
    action: `selectSet:${item.id}`,
    selected: item.id === context.state.setId,
  }));
  return [{ type: "list", items, columns: 2, empty: t("topic.none") }];
}

/**
 * 選擇頁各組的內容，鍵是題組的種類，依 layout 的 kinds 順序排列。
 */
const CHOOSE_GROUPS = {
  election: electionGroup,
  topic: topicGroup,
};

/**
 * 選擇題組：選舉比對與主題測驗兩組，各組一個標題與說明。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function choosePicker(context) {
  // 每組的標題與說明寫在 locale 的 choose.{種類}
  const blocks = Object.keys(LAYOUT.kinds).flatMap((kind) => [{ type: "heading", text: t(`choose.${kind}.title`), level: 3 }, { type: "text", text: t(`choose.${kind}.text`), tone: "muted" }, ...CHOOSE_GROUPS[kind](context)]);
  return {
    blocks,
    info: info({ sources: [t("sources.roster"), t("sources.topics")], steps: [step(t("election.stepCount"), String(context.data.index.elections.length)), step(t("topic.stepCount"), String(context.data.index.topics.length))] }),
  };
}

/**
 * 選區地圖。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function scopeMap(context) {
  const map = context.data.map;
  // 地圖的來源與授權，三種地圖都列在 info
  const mapSource = t("sources.map", { name: map.source.name, license: map.source.license });
  const scopes = electionScopes(context);
  // 選區類型對到 settings 的 scopeMaps，決定地圖怎麼繪製：whole 整片一個選區，county 點縣市就是選區，town 點縣市後展開這場選舉的選區
  const mapLevel = SETTINGS.scopeMaps[context.set.scope_type];
  const { county } = context.state.view;
  // 整片一個選區的選舉，地圖整片可選
  if (mapLevel === "whole") {
    const only = scopes[0];
    // 名冊沒有任何選區時沒有可選的對象，只放提示
    if (!only) return { blocks: [{ type: "notice", tone: "neutral", text: t("scope.empty") }], info: info({ sources: [mapSource] }) };
    // 地圖整片對應同一個選區，所以每個圖形的動作都是選這個選區
    return {
      blocks: [
        // 唯一的選區已選取時整張地圖都顯示為選取
        { type: "map", viewBox: map.view_box, features: map.layers.counties.map((item) => ({ id: item.code, path: item.path, label: item.name, state: only.id === context.state.scopeId ? "selected" : "policy", action: `selectScope:${only.id}` })), insets: map.layers.insets.map((item) => item.path), label: t("scope.mapLabel") },
        { type: "notice", tone: "neutral", text: t("scope.national") },
      ],
      info: info({ sources: [mapSource] }),
    };
  }
  // 依縣市分組，每個縣市的圖形以 scopeSummary 統計
  const byCounty = groupBy(scopes, (scope) => scope.county);
  /**
   * 圖形的狀態：選取、有政見資料、有選區、沒有選區。
   * @param {boolean} selected 是否選取。
   * @param {{ count: number, policy: boolean }|undefined} entry 統計。
   * @returns {string}
   */
  const stateOf = (selected, entry) => {
    // 選取優先，其次依資料狀態
    if (selected) return "selected";
    // 沒有選區的縣市不能點
    if (!entry) return "none";
    // 有政見資料的縣市用強調色，其餘只標示有選區
    return entry.policy ? "policy" : "active";
  };
  // 縣市層級的選舉一個縣市就是一個選區，其餘類型點縣市後展開選區
  const showDistricts = Boolean(county) && mapLevel === "town";
  let features;
  // 選了縣市時畫這場選舉在該縣市的選區，每個圖形由選區涵蓋的村里合併，點選就選定選區
  if (showDistricts) {
    const byId = new Map(scopes.map((scope) => [scope.id, scope]));
    // 選區檔還沒載入時沒有圖形，只畫所選縣市內名冊有的選區
    features = (context.data.districts?.districts ?? [])
      .filter((item) => item.county === county && byId.has(item.scope))
      // 每個選區自成一個圖形，點選就選定那個選區
      .map((item) => {
        const scope = byId.get(item.scope);
        // 選取優先，其次依有沒有政見資料決定顏色
        return { id: item.scope, path: item.path, label: t("scope.districtTip", { name: scope.name }), state: stateOf(item.scope === context.state.scopeId, scopeSummary([scope])), action: `selectScope:${item.scope}` };
      });
  } else {
    // 其餘情形畫全部縣市
    features = map.layers.counties.map((item) => {
      const entry = scopeSummary(byCounty.get(item.code));
      // 沒有選區的縣市不給點選動作
      return { id: item.code, path: item.path, label: t("scope.countyTip", { name: item.name, count: entry?.count ?? 0 }), state: stateOf(item.code === county, entry), action: entry ? `selectCounty:${item.code}` : null };
    });
  }
  // 返回鈕要顯示縣市名稱，沒選縣市時不需要
  const countyName = county ? map.layers.counties.find((item) => item.code === county)?.name : null;
  return {
    blocks: [
      // 展開選區時不繪製離島縮圖，並放大到所選縣市
      { type: "map", viewBox: map.view_box, features, insets: showDistricts ? [] : map.layers.insets.map((item) => item.path), zoomTo: showDistricts, label: t("scope.mapLabel") },
      { type: "legend", items: [{ label: t("scope.legend.policy"), state: "policy" }, { label: t("scope.legend.active"), state: "active" }, { label: t("scope.legend.selected"), state: "selected" }] },
      // 選了縣市時提供回到全部縣市的按鈕
      county ? { type: "buttons", items: [{ label: t("scope.allCounties", { name: countyName }), icon: "arrowLeft", action: "clearMap", tone: "neutral" }] } : null,
      { type: "notice", tone: "neutral", text: t("scope.boundaryNote") },
    ],
    info: info({ sources: [mapSource], steps: [step(t("scope.stepChecked"), t("scope.checked", map.checks))] }),
  };
}

/**
 * 選區清單。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function scopeList(context) {
  const scopes = filteredScopes(context);
  const shown = scopes.slice(0, LIST_LIMIT);
  // 每個選區的候選人數事先算成對照表，畫清單時直接查
  const counts = context.model.entitiesByScope;
  const items = shown.map((scope) => ({
    title: scope.name,
    text: listText(scope.areas.slice(0, AREA_PREVIEW)),
    meta: t("scope.candidates", { count: counts.get(scope.id)?.length ?? 0 }),
    ...policyBadge(scope.has_policy_data, "scope.noPolicy"),
    action: `selectScope:${scope.id}`,
    selected: scope.id === context.state.scopeId,
  }));
  return {
    blocks: [
      { type: "search", value: context.state.view.scopeQuery, placeholder: t("scope.search"), action: "setView:scopeQuery" },
      { type: "text", text: t("scope.count", { shown: shown.length, total: scopes.length }), tone: "muted" },
      { type: "list", items, empty: t("scope.empty"), scroll: true },
      // 超過上限時提示縮小範圍
      scopes.length > LIST_LIMIT ? { type: "notice", tone: "warning", text: t("scope.tooMany", { limit: LIST_LIMIT }) } : null,
    ],
    info: info({ steps: [step(t("scope.stepList"), t("scope.count", { shown: shown.length, total: scopes.length }), "", t("scope.listRule", { limit: LIST_LIMIT }))], sources: [t("sources.roster")] }),
  };
}

/**
 * 議題重視度。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function weightsImportance(context) {
  const { all, visible } = context.questions();
  const taxonomy = context.model.taxonomy;
  // 議題只由根題決定，追問題跟著母題歸類
  const roots = all.filter((question) => !question.parent);
  const level1 = [...new Set(roots.map((question) => issueOf(taxonomy, question.facet)))].sort(byTaxonomyOrder(taxonomy));
  const levels = SETTINGS.importance.levels.map((value) => ({ value, label: t(`importance.levels.${value}`) }));
  // 各議題分到的份額由可見題目的權重往上加總
  const importance = context.state.importance;
  const { nodeShares } = questionWeights(context.model, visible, importance);
  // 每一列是一個第 1 層議題，可展開看第 2 層
  const rows = level1.map((code) => {
    const children = [...new Set(roots.map((question) => ancestorAt(taxonomy, question.facet, SETTINGS.importance.depth)).filter((child) => child && taxonomy.get(child).parent === code))];
    const expanded = context.state.view.expanded.includes(code);
    return {
      id: code,
      label: issueName(context, code),
      note: t("importance.rowNote", { count: roots.filter((question) => issueOf(taxonomy, question.facet) === code).length, share: pct(nodeShares.get(code) ?? 0) }),
      value: importanceOf(importance, code),
      action: `setImportance:${code}`,
      // 有兩個以上子項時才給展開鈕
      expand: children.length > 1 ? { label: t(expanded ? "importance.collapse" : "importance.expand"), action: `toggleExpand:${code}` } : null,
      // 展開時列出第 2 層，分配的是第 1 層的份額
      children: expanded
        // 收合時提供空陣列，畫面就不繪製第 2 層
        ? children.map((child) => ({ id: child, label: issueName(context, child), value: importanceOf(importance, child), note: t("importance.childNote", { share: pct(nodeShares.get(child) ?? 0) }), action: `setImportance:${child}`, children: [] }))
        : [],
    };
  });
  return {
    blocks: [
      { type: "text", text: t("importance.intro") },
      { type: "importance", levels, rows },
      {
        type: "buttons",
        items: [
          { label: t("importance.skip"), icon: "skip", action: "skipImportance", tone: "neutral" },
          { label: t("importance.reset"), icon: "reset", action: "resetImportance", tone: "quiet" },
        ],
      },
    ],
    info: info({
      steps: [
        step(t("importance.stepLevel1"), t("importance.stepLevel1Value", { count: level1.length }), t("importance.formula")),
        step(t("importance.stepTotal"), pct(level1.reduce((sum, code) => sum + (nodeShares.get(code) ?? 0), 0))),
      ],
      sources: [t("sources.taxonomy")],
      constants: constants(context.settings, ["importance.default", "importance.levels", "importance.depth"]),
    }),
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const FLOW_CARDS = {
  "home.hero": { build: homeHero },
  "home.audiences": { build: homeAudiences },
  "home.steps": { build: homeSteps },
  "choose.picker": { build: choosePicker },
  "scope.map": { build: scopeMap },
  "scope.list": { build: scopeList },
  "weights.importance": { build: weightsImportance },
};

export { FLOW_CARDS };
