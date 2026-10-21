/* ==================================================
 * cards/dataset.js - 資料集頁的卡片
 * --------------------------------------------------
 * - 角色：瀏覽選舉的名冊、題庫、主張、配題、評分理由、中立性、原文與公報影像，主題測驗的題目、選項、軸、軸對應與參照點，以及詞表、待審詞、分類與來源，匯出 JSON、TSV、CSV，並管理本機資料
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 資料集頁面向研究者，顯示姓名與黨名，頁首提示這一點
 *   - 匯出的是目前檢視篩選後的全部列，不只目前分頁
 *   - 每種檢視的欄位寫在 DATASET_VIEWS，欄名查 locale 的 dataset.columns
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { cellText } from "../lib/delimited.js";
import { claimSpecificity, CUSTOM_PREFIX } from "../metrics/index.js";
import { t, pct, info, listText, fitsKind } from "./kit.js";
import { STATE_GROUPS, IMPORT_MODES } from "./state.js";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把主張的欄位代碼換成詞表名稱。
 * @param {Record<string, string[]>} fields 主張的受控欄位。
 * @param {Map<string, string>} terms 詞代碼對應名稱。
 * @returns {string}
 */
function fieldNames(fields, terms) {
  return Object.entries(fields)
    // 只列出有選到詞的欄位
    .filter(([, codes]) => codes.length)
    .map(([key, codes]) => t("dataset.fieldPair", { field: t(`fields.${key}`), values: listText(codes.map((code) => terms.get(code) ?? code)) }))
    .join(t("dataset.fieldSeparator"));
}

/**
 * 資料集的檢視：rows 取出列，columns 是顯示與匯出的欄位。
 * 讀題組資料的檢視以 kinds 標出適用的題組種類，設定表類的檢視不標，任何時候都能看。rows 用到的 fieldNames 寫在共用片段，呼叫 rows 時才執行。
 */
const DATASET_VIEWS = {
  scopes: { kinds: ["election"], columns: ["id", "name", "county", "towns", "areas", "has_policy_data"], rows: (m) => [...m.scopes.values()] },
  entities: { kinds: ["election"], columns: ["id", "scope", "number", "name", "running_mate", "party", "incumbent", "claim_counts"], rows: (m) => [...m.entities.values()] },
  questions: { kinds: ["election"], columns: ["id", "facet", "parent", "stem", "note", "conditions", "budget_share", "version", "hash"], rows: (m) => m.questionOrder.map((id) => m.questions.get(id)) },
  claims: { kinds: ["election"], columns: ["id", "entity", "quote", "fields", "incumbent_plan", "source_type", "specificity", "reason", "method", "review_status"], rows: (m, terms) => [...m.claims.values()].map((claim) => ({ ...claim, fields: fieldNames(claim.fields, terms), specificity: pct(claimSpecificity(m, claim.id).value) })) },
  mappings: { kinds: ["election"], columns: ["id", "claim", "facet", "question", "question_version", "stance", "allocation", "evidence", "reason", "method", "review_status"], rows: (m) => m.mappings },
  specificity: { kinds: ["election"], columns: ["id", "claim", "criterion", "level", "value", "evidence", "reason", "method", "review_status"], rows: (m) => m.dataset.specificity },
  neutrality: { kinds: ["election"], columns: ["id", "question", "criterion", "result", "reason", "method", "review_status"], rows: (m) => m.dataset.neutrality },
  axes: { kinds: ["election", "topic"], columns: ["id", "question", "axis", "direction", "weight", "reason", "method", "review_status"], rows: (m) => m.dataset.question_axes },
  passages: { kinds: ["election"], columns: ["id", "entity", "document", "page", "image", "text", "agreement", "unresolved", "reason", "method", "review_status"], rows: (m) => [...m.passages.values()].map((p) => ({ ...p, agreement: p.ocr_check?.agreement ?? null })) },
  pages: { kinds: ["election"], columns: ["id", "document", "page", "text_status", "cjk_characters", "text"], rows: (m) => [...m.documents.values()].flatMap((d) => d.pages.map((page) => ({ ...page, id: `${d.id}-p${page.page}`, document: d.id }))) },
  ocrLines: { kinds: ["election"], columns: ["id", "image", "line", "text", "confidence", "x", "y"], rows: (m) => Object.entries(m.dataset.ocr ?? {}).flatMap(([image, result]) => result.lines.map((line, index) => ({ ...line, id: `${image}-${index + 1}`, image, line: index + 1 }))) },
  images: { kinds: ["election"], columns: ["id", "document", "page", "width", "height", "path"], rows: (m) => [...m.documents.values()].flatMap((d) => d.images.map((image) => ({ ...image, document: d.id }))) },
  sources: { kinds: ["election", "topic"], columns: ["id", "name", "adapter", "source_type", "url", "sha256", "license"], rows: (m) => m.dataset.sources },
  topicQuestions: { kinds: ["topic"], columns: ["id", "stem", "short", "original", "note", "source", "hash"], rows: (m) => m.questionOrder.map((id) => m.questions.get(id)) },
  topicOptions: { kinds: ["topic"], columns: ["id", "question", "name"], rows: (m) => m.dataset.questions.flatMap((question) => (question.options ?? []).map((option) => ({ ...option, question: question.id }))) },
  topicAxes: { kinds: ["topic"], columns: ["code", "name", "negative", "positive", "power", "bands"], rows: (m) => m.axes.map((axis) => ({ ...axis, bands: axis.bands.map((band) => band.label).join("、") })) },
  references: { kinds: ["topic"], columns: ["id", "name", "original", "position"], rows: (m) => m.references.map((reference) => ({ ...reference, position: Object.entries(reference.position).map(([axis, value]) => `${axis}=${value}`).join("、") })) },

  vocabTerms: { columns: ["code", "field", "name", "note", "distinction", "status", "version"], rows: (m, terms, tables) => tables.vocabTerms },
  taxonomy: { columns: ["code", "parent", "name", "level", "note", "distinction", "reference"], rows: (m, terms, tables) => tables.taxonomy },
};

/**
 * 資料集頁正在瀏覽的題組：另外選的那一個，沒選時是目前作答的題組。
 * @param {object} context 卡片情境。
 * @returns {object|null} 索引中的一筆。
 */
function browsedSet(context) {
  const setId = context.state.view.datasetSet ?? context.state.setId;
  return context.findSet(setId);
}

/**
 * 適用目前瀏覽的題組的檢視。
 * @param {object|null} set 瀏覽的題組。
 * @returns {string[]} 檢視代碼。
 */
function viewsFor(set) {
  return Object.keys(DATASET_VIEWS).filter((key) => fitsKind(DATASET_VIEWS[key], set?.kind ?? null));
}

/**
 * 取得目前檢視篩選後的全部列。
 * @param {object} context 卡片情境。
 * @returns {{ view: string, columns: string[], rows: object[], model: object|null }}
 */
function currentRows(context) {
  const set = browsedSet(context);
  const views = viewsFor(set);
  // 沒有選過、不認得或不適用這種題組的檢視回到第一種
  const view = views.includes(context.state.view.datasetView) ? context.state.view.datasetView : views[0];
  const spec = DATASET_VIEWS[view];
  // 尚未選題組時沒有模型，後面再依 kinds 判斷要不要出列
  const model = set ? context.datasetModel(set.id) : null;
  // 讀題組資料的檢視在資料尚未載入時沒有列
  if (spec.kinds && !model) return { view, columns: spec.columns, rows: [], model };
  const terms = new Map(context.data.tables.vocabTerms.map((row) => [row.code, row.name]));
  // 搜尋字串移除前後空白，只有空白的查詢視為不搜尋
  const query = context.state.view.datasetQuery.trim();
  const rows = spec.rows(model, terms, context.data.tables);
  // 搜尋比對任一欄的文字
  const filtered = query ? rows.filter((row) => spec.columns.some((column) => cellText(row[column]).includes(query))) : rows;
  return { view, columns: spec.columns, rows: filtered, model };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 資料集瀏覽。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function datasetBrowser(context) {
  const { view, columns, rows } = currentRows(context);
  const size = SETTINGS.dataset.pageSize;
  // 至少有一頁，沒有資料時也要有第一頁可顯示
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(context.state.view.datasetPage, pages - 1);
  const set = browsedSet(context);
  // 只取目前頁的列交給表格，頁碼已限制在範圍內
  const slice = rows.slice(page * size, (page + 1) * size);
  return {
    blocks: [
      { type: "notice", tone: "warning", text: t("dataset.identityNote") },
      { type: "select", label: t("dataset.set"), value: set?.id ?? "none", options: [{ value: "none", label: t("dataset.chooseSet") }, ...context.data.index.sets.map((item) => ({ value: item.id, label: item.label }))], action: "setView:datasetSet" },
      { type: "tabs", label: t("dataset.views"), items: viewsFor(set).map((key) => ({ label: t(`dataset.viewNames.${key}`), action: `setView:datasetView=${key}`, selected: key === view })) },
      { type: "search", value: context.state.view.datasetQuery, placeholder: t("dataset.search"), action: "setView:datasetQuery" },
      {
        type: "table",
        columns: columns.map((key) => ({ key, label: t(`dataset.columns.${key}`) })),
        // 列以資料的代碼對應元素，影像檢視的列可以點開影像
        rows: slice.map((row) => ({ id: row.id ?? row.code, action: view === "images" ? `openImage:${row.path}` : null, cells: Object.fromEntries(columns.map((key) => [key, cellText(row[key])])) })),
        dense: true,
        // 還沒選題組時提示先選，其餘才是真的沒有資料
        empty: t(DATASET_VIEWS[view].kinds && !set ? "dataset.needSet" : "dataset.empty"),
      },
      // 第一頁沒有上一頁，最後一頁沒有下一頁
      { type: "pager", prev: page > 0 ? { label: t("dataset.prev"), icon: "arrowLeft", action: `setView:datasetPage=${page - 1}` } : null, next: page < pages - 1 ? { label: t("dataset.next"), icon: "arrowRight", trailing: true, action: `setView:datasetPage=${page + 1}` } : null, label: t("dataset.page", { page: page + 1, pages, rows: rows.length }) },
      { type: "buttons", items: SETTINGS.dataset.exportFormats.map((format) => ({ label: t(`dataset.export.${format}`), action: `exportView:${format}`, tone: "neutral", disabled: !rows.length })) },
    ],
    info: info({ sources: [t("sources.dataset", { label: set?.label ?? t("common.missing"), version: set?.manifest.data_version ?? t("common.missing") }), t("sources.tables")] }),
  };
}

/**
 * 本機資料：匯出與匯入狀態、重設、匯入自訂題庫與設定。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function datasetLocal(context) {
  const view = context.state.view;
  const groups = view.exportGroups;
  // 匯入方式預設為不覆寫，避免誤把現有資料覆蓋
  const mode = view.importMode;
  const custom = context.state.custom;
  // 四段各包成一組，組與組之間的空白大於組內，段落的分界比段內清楚。間距寫在 Group 與 Heading 元件
  // 按鈕一律有框，每一列按鈕的左緣與小標的文字切齊
  return {
    blocks: [
      { type: "notice", tone: "neutral", text: t("common.privacy") },
      {
        type: "group",
        blocks: [
          { type: "heading", text: t("local.export"), level: 3 },
          { type: "checks", items: Object.keys(STATE_GROUPS).map((group) => ({ label: t(`local.groups.${group}`), checked: groups.includes(group), action: `toggleExportGroup:${group}` })) },
          { type: "buttons", items: [{ label: t("local.exportButton"), icon: "download", action: "exportState", tone: "accent", disabled: !groups.length }] },
        ],
      },
      {
        type: "group",
        blocks: [
          { type: "heading", text: t("local.import"), level: 3 },
          { type: "segmented", label: t("local.mode"), value: mode, options: IMPORT_MODES.map((value) => ({ value, label: t(`local.modes.${value}`) })), action: "setView:importMode" },
          { type: "buttons", items: [{ label: t("local.importButton"), icon: "upload", action: "importState", tone: "neutral" }] },
        ],
      },
      {
        type: "group",
        blocks: [
          { type: "heading", text: t("local.reset"), level: 3 },
          { type: "buttons", items: Object.keys(STATE_GROUPS).map((group) => ({ label: t("local.resetGroup", { group: t(`local.groups.${group}`) }), icon: "reset", action: `resetGroup:${group}`, tone: "neutral" })) },
        ],
      },
      {
        type: "group",
        blocks: [
          { type: "heading", text: t("local.custom"), level: 3 },
          { type: "text", text: t("local.customIntro", { prefix: SETTINGS.customData.stancePrefix, evidence: SETTINGS.customData.evidencePrefix, columns: listText(Object.values(SETTINGS.customData.questionColumns)) }), tone: "muted" },
          // 已匯入時顯示筆數與清除鈕，沒有時放 null，畫面略過
          custom ? { type: "notice", tone: "warning", text: t("local.customLoaded", { name: custom.name, questions: custom.questions.length, stances: custom.stances.length }) } : null,
          {
            type: "buttons",
            items: [
              { label: t("local.importQuestions"), icon: "upload", action: "importQuestions", tone: "neutral", disabled: !context.scope },
              { label: t("local.template"), icon: "file", action: "downloadTemplate", tone: "neutral", disabled: !context.scope },
              { label: t("local.importSettings"), icon: "upload", action: "importSettings", tone: "neutral" },
              { label: t("local.clearCustom"), icon: "trash", action: "clearCustom", tone: "neutral", disabled: !custom && !context.state.customSettings },
            ],
          },
          // 已匯入自訂設定時才顯示筆數，沒有時放 null，畫面略過
          context.state.customSettings ? { type: "notice", tone: "warning", text: t("local.settingsLoaded", { count: Object.keys(context.state.customSettings.overrides).length }) } : null,
        ],
      },
    ],
    info: info({ steps: [], sources: [t("local.prefix", { prefix: CUSTOM_PREFIX })] }),
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const DATASET_CARDS = {
  "dataset.browser": { build: datasetBrowser },
  "dataset.local": { build: datasetLocal },
};

export { DATASET_CARDS, currentRows };
