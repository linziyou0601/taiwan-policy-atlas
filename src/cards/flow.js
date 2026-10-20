/* ==================================================
 * cards/flow.js - 首頁與作答前的流程卡片
 * --------------------------------------------------
 * - 角色：首頁、選擇題組（選舉的年度與職位、主題測驗）、選區（地圖與清單）與議題重視度的卡片
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 地圖與清單讀同一份選區關係：選區的 county 與 towns，兩個入口能選到的選區相同
 *   - 沒有政見資料的選舉與選區照常列出，標示缺口，選了之後在作答頁說明尚無資料
 * ================================================== */

import { LAYOUT, SETTINGS } from "../config/index.js";
import { ancestorAt, issueOf, byTaxonomyOrder, questionWeights, importanceOf } from "../metrics/index.js";
import { t, pct, step, info, constants, issueName, coversTown, listText } from "./kit.js";

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
  const { county, town, scopeQuery } = context.state.view;
  // 選區只記鄉鎮名稱而沒有鄉鎮代碼，選了鄉鎮時先從地圖查出名稱
  const townName = town ? (context.data.map?.layers.towns.find((item) => item.code === town)?.name ?? null) : null;
  const query = scopeQuery.trim();
  return electionScopes(context).filter((scope) => {
    // 選了縣市時只列該縣市
    if (county && scope.county && scope.county !== county) return false;
    // 選了鄉鎮時只列涵蓋該鄉鎮的選區
    if (townName && !coversTown(context, scope, townName)) return false;
    // 搜尋比對選區名稱與涵蓋範圍
    return !query || scope.name.includes(query) || scope.areas.some((area) => area.includes(query));
  });
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
      // 有政見資料與尚無資料以不同標示區分
      badge: item.manifest.has_policy_data ? t("election.hasPolicy") : t("election.noPolicy"),
      // 有政見資料的職位用強調色，缺資料的用中性色
      badgeTone: item.manifest.has_policy_data ? "accent" : "neutral",
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
  const scopes = electionScopes(context);
  // 選區類型對到 settings 的 scopeMaps，決定地圖怎麼繪製：whole 整片一個選區，county 點縣市就是選區，town 點縣市後展開鄉鎮
  const mapLevel = SETTINGS.scopeMaps[context.set.scope_type];
  const { county, town } = context.state.view;
  // 整片一個選區的選舉，地圖整片可選
  if (mapLevel === "whole") {
    const only = scopes[0];
    // 名冊沒有任何選區時沒有可選的對象，只放提示
    if (!only) return { blocks: [{ type: "notice", tone: "neutral", text: t("scope.empty") }], info: info({ sources: [t("sources.map", { name: map.source.name, license: map.source.license })] }) };
    // 地圖整片對應同一個選區，所以每個圖形的動作都是選這個選區
    return {
      blocks: [
        // 唯一的選區已選取時整張地圖都顯示為選取
        { type: "map", viewBox: map.view_box, features: map.layers.counties.map((item) => ({ id: item.code, path: item.path, label: item.name, state: only.id === context.state.scopeId ? "selected" : "policy", action: `selectScope:${only.id}` })), insets: map.layers.insets.map((item) => item.path), label: t("scope.mapLabel") },
        { type: "notice", tone: "neutral", text: t("scope.national") },
      ],
      info: info({ sources: [t("sources.map", { name: map.source.name, license: map.source.license })] }),
    };
  }
  const byCounty = new Map();
  // 依縣市統計選區數與是否有政見資料
  for (const scope of scopes) {
    const entry = byCounty.get(scope.county) ?? { count: 0, policy: false };
    entry.count += 1;
    // 縣市內只要有一個選區有政見資料，該縣市就算有政見資料
    entry.policy ||= scope.has_policy_data;
    byCounty.set(scope.county, entry);
  }
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
  // 縣市層級的選舉沒有鄉鎮地圖，只有鄉鎮層級的類型才能展開鄉鎮
  const showTowns = Boolean(county) && mapLevel === "town";
  let features;
  // 選了縣市且選區在鄉鎮層級時畫該縣市的鄉鎮
  if (showTowns) {
    const countyScopes = scopes.filter((scope) => scope.county === county);
    // 只取所選縣市的鄉鎮圖形，每個鄉鎮再看有哪些選區涵蓋它
    features = map.layers.towns
      .filter((item) => item.county === county)
      .map((item) => {
        // 一個鄉鎮可能屬於多個選區的涵蓋範圍，名稱由 coversTown 正規化後比對
        const covering = countyScopes.filter((scope) => coversTown(context, scope, item.name));
        // 沒有選區涵蓋的鄉鎮不能點，所以 entry 留空
        const entry = covering.length ? { count: covering.length, policy: covering.some((scope) => scope.has_policy_data) } : undefined;
        // 有選區涵蓋時點擊才選鄉鎮，否則圖形只是底圖
        return { id: item.code, path: item.path, label: t("scope.townTip", { name: item.name, count: covering.length }), state: stateOf(item.code === town, entry), action: entry ? `selectTown:${item.code}` : null };
      });
  } else {
    // 其餘情形畫全部縣市
    features = map.layers.counties.map((item) => {
      const entry = byCounty.get(item.code);
      // 沒有選區的縣市不給點選動作
      return { id: item.code, path: item.path, label: t("scope.countyTip", { name: item.name, count: entry?.count ?? 0 }), state: stateOf(item.code === county, entry), action: entry ? `selectCounty:${item.code}` : null };
    });
  }
  // 返回鈕要顯示縣市名稱，沒選縣市時不需要
  const countyName = county ? map.layers.counties.find((item) => item.code === county)?.name : null;
  return {
    blocks: [
      // 展開鄉鎮時不繪製離島縮圖，並放大到所選縣市
      { type: "map", viewBox: map.view_box, features, insets: showTowns ? [] : map.layers.insets.map((item) => item.path), zoomTo: showTowns, label: t("scope.mapLabel") },
      { type: "legend", items: [{ label: t("scope.legend.policy"), state: "policy" }, { label: t("scope.legend.active"), state: "active" }, { label: t("scope.legend.selected"), state: "selected" }] },
      // 選了縣市時提供回到全部縣市的按鈕
      county ? { type: "buttons", items: [{ label: t("scope.allCounties", { name: countyName }), icon: "arrowLeft", action: "clearMap", tone: "neutral" }] } : null,
      { type: "notice", tone: "neutral", text: t("scope.boundaryNote") },
    ],
    info: info({ sources: [t("sources.map", { name: map.source.name, license: map.source.license })], steps: [step(t("scope.stepChecked"), t("scope.checked", map.checks))] }),
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
    // 沒有政見資料的選區標示缺口
    badge: scope.has_policy_data ? t("election.hasPolicy") : t("scope.noPolicy"),
    // 有政見資料的選區用強調色，缺資料的用中性色
    badgeTone: scope.has_policy_data ? "accent" : "neutral",
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
