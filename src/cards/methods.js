/* ==================================================
 * cards/methods.js - 方法與公式頁的卡片
 * --------------------------------------------------
 * - 角色：管線、計分公式、權重分配、具名策略、判準表、題目可比性與具體度分布
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 公式以設定宣告的策略為準，有作答時附上以作答結果代入的實例
 *   - 判準表直接讀 config/tables，與管線核對用的是同一份表
 * ================================================== */

import { strategyEntries, issueOf, ISSUE_LEVEL, claimSpecificity, scopeQuestions, questionWeights, stanceMatrix } from "../metrics/index.js";
import { getPath } from "../lib/objects.js";
import { t, pct, step, info, constants, dataSources, issueName, blendFormula, barScale, SCORING_PATHS } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 具名策略的類別，與設定中選用它的路徑。參照點距離由題組的資料集選用，解析器沒有選用的概念，兩者不寫路徑。
 */
const STRATEGY_KINDS = [
  { kind: "formula", path: "scoring.formula" },
  { kind: "agreement", path: "scoring.agreement" },
  { kind: "aggregate", path: "scoring.stanceAggregate" },
  { kind: "consensus", path: "scoring.consensusRule" },
  { kind: "distance", path: null },
  { kind: "parser", path: null },
];

/**
 * 判準表的顯示欄位：表鍵對應欄位清單。
 */
const RUBRIC_TABLES = {
  stances: ["code", "name", "value", "rule"],
  specificity: ["code", "name", "weight", "unstated", "partial", "explicit"],
  levels: ["code", "name", "value", "counted"],
  neutrality: ["code", "name", "rule"],
  sourceTypes: ["code", "name", "weight", "stanceEvidence"],
  answers: ["code", "name", "value"],
  axes: ["code", "name", "negative", "positive", "reference"],
};

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把設定表轉成表格區塊。
 * @param {object[]} rows 表的列。
 * @param {string[]} keys 顯示的欄位。
 * @param {string} table 表鍵，欄名查 locale 的 tables.{表鍵}.{欄位}。
 * @returns {{ type: "table", columns: object[], rows: object[], dense: boolean }}
 */
function tableBlock(rows, keys, table) {
  return {
    type: "table",
    columns: keys.map((key) => ({ key, label: t(`tables.${table}.${key}`) })),
    // 是非值轉成文字，其餘原樣顯示
    rows: rows.map((row) => ({ cells: Object.fromEntries(keys.map((key) => [key, typeof row[key] === "boolean" ? t(row[key] ? "common.yes" : "common.no") : String(row[key] ?? t("common.missing"))])) })),
    dense: true,
  };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 管線與資料來源。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsPipeline(context) {
  const elections = context.data.index.elections;
  return {
    blocks: [
      { type: "steps", items: t("methods.layers") },
      {
        type: "stats",
        items: [
          { label: t("methods.elections"), value: String(elections.length) },
          { label: t("methods.withPolicy"), value: String(elections.filter((item) => item.manifest.has_policy_data).length) },
          { label: t("methods.claims"), value: String(elections.reduce((sum, item) => sum + item.manifest.counts.claims, 0)) },
          { label: t("methods.questions"), value: String(elections.reduce((sum, item) => sum + item.manifest.counts.questions, 0)) },
          { label: t("methods.topics"), value: String(context.data.index.topics.length) },
        ],
      },
      { type: "text", text: t("methods.sourceRules"), tone: "muted" },
    ],
    info: info({ sources: [t("sources.roster"), t("sources.bulletin"), t("sources.topics"), t("sources.tables")] }),
  };
}

/**
 * 計分公式，有作答時附上代入實例。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsFormula(context) {
  // 沒有政見資料的選區算不出分數，不代入公式
  const results = context.scope?.has_policy_data ? context.results() : null;
  // 要有作答才有分數可代入，取結果中的第一位候選人當範例
  const example = results?.answeredCount ? results.entities[0] : null;
  return {
    blocks: [
      { type: "formulas", items: t("methods.formulas") },
      // 有作答時用第一名代入公式
      example
        // 沒有作答時只顯示說明，因為沒有數字可代入
        ? { type: "notice", tone: "neutral", text: t("methods.example", { label: context.label(example.id), formula: blendFormula(context, example) }) }
        : { type: "notice", tone: "neutral", text: t("methods.noExample") },
    ],
    info: info({ sources: dataSources(context), constants: constants(context.settings, SCORING_PATHS) }),
  };
}

/**
 * 權重分配。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsWeights(context) {
  const blocks = [{ type: "text", text: t("methods.weightsText") }];
  // 有選區時列出目前重視度下的第 1 層份額
  if (context.scope?.has_policy_data) {
    const items = context.questions().visible;
    const { nodeShares } = questionWeights(context.model, items, context.state.importance);
    // 只取第 1 層議題，依份額由大到小排列
    const level1 = [...nodeShares].filter(([code]) => context.model.taxonomy.get(code).level === ISSUE_LEVEL).sort((a, b) => b[1] - a[1]);
    blocks.push({ type: "bars", items: level1.map(([code, share]) => ({ id: code, label: issueName(context, code), value: share, display: pct(share, 1), series: null })), scale: barScale(level1.map(([, share]) => share)), compact: true, axisLabel: t("methods.shareAxis") });
  }
  return { blocks, info: info({ steps: [step(t("methods.weightsStep"), t("methods.weightsValue"), t("importance.formula"))], constants: constants(context.settings, ["importance.default", "importance.levels"]) }) };
}

/**
 * 具名策略與目前選用的策略。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsRegistry(context) {
  const items = STRATEGY_KINDS.flatMap(({ kind, path }) =>
    strategyEntries(kind).map((entry) => {
      // 沿著設定路徑取出目前選用的策略名稱，沒有路徑的類別不在設定裡選用，不標使用中
      const active = path ? getPath(context.settings, path) === entry.name : false;
      // 只有目前選用的策略標上使用中
      return { title: t(`registry.${kind}.${entry.name}.label`), text: t(`registry.${kind}.${entry.name}.text`), meta: t(`registry.kinds.${kind}`), badge: active ? t("methods.active") : null, badgeTone: "accent" };
    }),
  );
  return { blocks: [{ type: "list", items }], info: info({ constants: constants(context.settings, STRATEGY_KINDS.filter((item) => item.path).map((item) => item.path)) }) };
}

/**
 * 判準表。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsRubrics(context) {
  const tables = context.data.tables;
  const blocks = Object.entries(RUBRIC_TABLES).flatMap(([key, keys]) => [{ type: "heading", text: t(`tables.${key}.title`), level: 3 }, tableBlock(tables[key], keys, key)]);
  return { blocks, info: info({ sources: [t("sources.tables")] }) };
}

/**
 * 題目可比性：每題各候選人是否表態、配題數與是否為共識題。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsComparability(context) {
  // 沒有選區時沒有題目可比
  if (!context.scope?.has_policy_data) return { blocks: [{ type: "notice", tone: "neutral", text: t("methods.needScope") }], info: info({ sources: dataSources(context) }) };
  const results = context.results();
  const questions = scopeQuestions(context.model, context.scope.id);
  // 與計分用同一套立場彙總，題目改成選區的全部題目，不只是作答路徑上的題目
  const { stances } = stanceMatrix(context.model, context.entities.map((entity) => entity.id), questions.map((question) => question.id), context.settings.scoring);
  // 欄位依序是議題、題目、各候選人是否表態與是否為共識題
  const columns = [{ key: "issue", label: t("details.issue") }, { key: "stem", label: t("details.stem") }, ...context.entities.map((entity) => ({ key: entity.id, label: context.label(entity.id), align: "end" })), { key: "consensus", label: t("question.consensus") }];
  const rows = questions.map((question) => ({
    action: `openQuestion:${question.id}`,
    cells: {
      issue: issueName(context, issueOf(context.model.taxonomy, question.facet)),
      stem: context.mask(question.stem),
      ...Object.fromEntries(context.entities.map((entity) => {
        const stance = stances.get(entity.id).get(question.id);
        // 只有新聞等權重為 0 的配題時算未表態，配題數也只數有權重的配題
        return [entity.id, stance.value === null ? t("result.noPolicyShort") : t("methods.mappingCount", { count: stance.items.filter((item) => item.weight > 0).length })];
      })),
      // 共識題由計分結果決定，這裡只顯示是或否
      consensus: t(results.consensus.has(question.id) ? "common.yes" : "common.no"),
    },
  }));
  return { blocks: [{ type: "table", columns, rows, dense: true }], info: info({ sources: dataSources(context), constants: constants(context.settings, ["scoring.consensusRule"]) }) };
}

/**
 * 具體度分布：各候選人的主張在每條判準的級距數。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsSpecificity(context) {
  // 沒有選區時沒有主張
  if (!context.scope?.has_policy_data) return { blocks: [{ type: "notice", tone: "neutral", text: t("methods.needScope") }], info: info({ sources: dataSources(context) }) };
  const levels = context.data.tables.levels;
  const criteria = context.data.tables.specificity;
  // 每位候選人各一組級距表，自訂題庫匯入的主張不列入
  const blocks = context.entities.flatMap((entity) => {
    const claims = (context.model.claimsByEntity.get(entity.id) ?? []).filter((claim) => !claim.custom);
    const scores = claims.map((claim) => claimSpecificity(context.model, claim.id).value).filter((value) => value !== null);
    // 沒有主張時平均沒有意義，留空顯示缺值
    const average = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
    const counts = new Map(criteria.map((criterion) => [criterion.code, new Map(levels.map((level) => [level.code, 0]))]));
    // 逐則主張、逐條判準計數
    for (const claim of claims) {
      // 每條判準的級距加一
      for (const row of context.model.specificityByClaim.get(claim.id) ?? []) counts.get(row.criterion).set(row.level, counts.get(row.criterion).get(row.level) + 1);
    }
    return [
      { type: "heading", text: t("methods.specificityEntity", { label: context.label(entity.id), count: claims.length, average: pct(average) }), level: 3 },
      {
        type: "table",
        columns: [{ key: "criterion", label: t("tables.specificity.name") }, ...levels.map((level) => ({ key: level.code, label: level.name, align: "end" }))],
        rows: criteria.map((criterion) => ({ cells: { criterion: criterion.name, ...Object.fromEntries(levels.map((level) => [level.code, String(counts.get(criterion.code).get(level.code))])) } })),
        dense: true,
      },
    ];
  });
  return { blocks, info: info({ steps: [step(t("methods.specificityStep"), t("methods.specificityFormula"))], sources: dataSources(context) }) };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const METHODS_CARDS = {
  "methods.pipeline": { build: methodsPipeline },
  "methods.formula": { build: methodsFormula },
  "methods.weights": { build: methodsWeights },
  "methods.registry": { build: methodsRegistry },
  "methods.rubrics": { build: methodsRubrics },
  "methods.comparability": { build: methodsComparability },
  "methods.specificity": { build: methodsSpecificity },
};

export { METHODS_CARDS };
