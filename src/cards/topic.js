/* ==================================================
 * cards/topic.js - 主題測驗的卡片
 * --------------------------------------------------
 * - 角色：主題測驗的結果摘要、單選題與全國對照、各軸光譜、雷達、參照點距離表，以及方法頁的計分說明
 * - 指令：由 cards/index.js 登錄，不直接匯入。layout 以 kinds 標成只用於 topic
 * - 慣例：
 *   - 軸、各級標籤、選項、對照、參照點與距離策略都來自題組的資料集，卡片不寫死任何一套測驗的軸、題目或名稱
 *   - 主題測驗沒有候選人，結果只有使用者自己的位置，與選舉比對的結果分開
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { hasValue } from "../lib/objects.js";
import { bandOf } from "../metrics/index.js";
import { t, pct, num, step, info, constants, dataSources, notAnsweredCard, shareButtons, radarCard, poleShare, poleTexts, listText } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 軸位置的顯示位數。
 */
const AXIS_DIGITS = 1;

/**
 * 距離的顯示位數。
 */
const DISTANCE_DIGITS = 0;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 題組的來源說明：資料集版本加原始測驗與授權。
 * @param {object} context 卡片情境。
 * @returns {string[]}
 */
function topicSources(context) {
  const origin = context.model.set.origin;
  // 本站編寫的題組沒有原始測驗的網址
  return [...dataSources(context), t(origin.url ? "topic.origin" : "topic.originNoUrl", origin)];
}

/**
 * 全國對照的來源說明：有比例時寫出調查與期別，只附連結時寫出連結。
 * @param {object} comparison 資料集的一筆對照。
 * @returns {string}
 */
function comparisonText(comparison) {
  // 只附連結的對照沒有比例，來源寫法不同
  return t(comparison.shares ? "topic.comparisonSource" : "topic.comparisonLink", comparison);
}

/**
 * 參照點的顯示名稱：有原文名稱時附在括號裡。
 * @param {{ name: string, original: string|null }} reference 參照點。
 * @returns {string}
 */
function referenceLabel(reference) {
  // 本站命名的參照點沒有原文名稱
  return reference.original ? t("topic.referenceName", { name: reference.name, original: reference.original }) : reference.name;
}

/**
 * 摘要的標題：最接近的參照點、並列的參照點，或沒有可比的軸。
 * @param {object} model 主題測驗的模型。
 * @param {{ closest: object|null, tied: object[] }} results 主題測驗的結果。
 * @returns {object|null} 標題區塊，題組沒有參照點時為 null。
 */
function closestHeading(model, results) {
  // 沒有參照點的題組只列各軸的位置
  if (!model.references.length) return null;
  // 只答了單選題或全部軸都略過時沒有距離
  if (!results.closest) return { type: "heading", text: t("topic.noClosest"), level: 3 };
  // 距離相同的不只一個時全部列出
  return { type: "heading", text: results.tied.length > 1 ? t("topic.tied", { names: listText(results.tied.map(referenceLabel)) }) : t("topic.closest", { name: referenceLabel(results.closest) }), level: 3 };
}

/**
 * 參照點距離的代入式：每條有位置的軸寫出 |你 − 參照點|^次方。
 * @param {object} model 主題測驗的模型。
 * @param {Map<string, number|null>} user 使用者在各軸的位置。
 * @param {object} reference 參照點。
 * @returns {string}
 */
function distanceFormula(model, user, reference) {
  const terms = model.axes.filter((axis) => hasValue(user.get(axis.code))).map((axis) => t("topic.distanceTerm", { axis: axis.name, user: num(user.get(axis.code), AXIS_DIGITS), reference: num(reference.position[axis.code], 0), power: num(axis.power, 2) }));
  return t("topic.distanceFormula", { terms: terms.join(t("result.blendPlus")), total: num(reference.distance, 2) });
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 主題測驗的結果摘要：最接近的參照點與各軸所在的一級。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function topicSummary(context) {
  const results = context.results();
  // 尚未作答時沒有位置可摘要
  if (!results.answeredCount) return notAnsweredCard(context);
  const { closest, ideology, bands } = results;
  return {
    blocks: [
      closestHeading(context.model, results),
      {
        type: "stats",
        items: [
          { label: t("result.answered"), value: t("result.answeredValue", { answered: results.answeredCount, total: results.items.length }) },
          // 各軸所在的一級，沒有作答的軸寫未作答
          ...ideology.axes.map((axis) => ({ label: axis.name, value: bands.get(axis.code)?.label ?? t("topic.noAxis"), note: ideology.user.get(axis.code) === null ? null : t("topic.axisNote", { value: num(ideology.user.get(axis.code), AXIS_DIGITS) }) })),
        ],
      },
      { type: "notice", tone: "neutral", text: t("topic.independent") },
      shareButtons(context),
    ],
    info: info({
      // 沒有最接近的參照點時說明原因，不代入距離
      steps: [closest ? step(t("topic.stepClosest", { name: closest.name }), num(closest.distance, 2), distanceFormula(context.model, ideology.user, closest), t(`registry.distance.${context.model.set.distance}.text`)) : step(t("topic.stepClosest", { name: t("common.missing") }), t("topic.noAxis"))],
      sources: topicSources(context),
    }),
  };
}

/**
 * 單選題的結果：每題你選了哪一項，題組附了全國對照時並列各選項的比例。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function topicChoices(context) {
  const results = context.results();
  // 尚未作答時沒有選擇可列
  if (!results.answeredCount) return notAnsweredCard(context);
  const blocks = results.choices.flatMap(({ question, choice }) => {
    const comparison = context.model.comparisons.get(question.id) ?? null;
    // 有比例的對照畫成長條，你選的那一項用強調色，其餘淡色
    const bars = comparison?.shares ? { type: "bars", items: question.choices.map((option) => ({ id: option.code, label: option.name, value: comparison.shares[option.code], display: pct(comparison.shares[option.code], 1), muted: option.code !== choice?.code, series: null })), scale: [0, 1], axisLabel: t("topic.comparisonAxis", { none: pct(comparison.none, 1) }), compact: true, wrap: true } : null;
    // 對照的說明：有比例時寫調查名稱、日期與樣本數，只有連結時寫來源
    const source = comparison ? { type: "text", text: comparisonText(comparison), tone: "caption" } : null;
    // 每題依序是題目、你的選擇、全國比例與來源，沒有作答時寫未作答
    return [{ type: "heading", text: question.stem, level: 3 }, { type: "text", text: choice ? t("topic.yourChoice", { name: choice.name }) : t("topic.noChoice") }, bars, source];
  });
  return {
    blocks,
    info: info({
      steps: results.choices.map(({ question, choice }) => step(question.short ?? question.stem, choice?.name ?? t("topic.noChoice"))),
      // 每筆對照列一則來源，有比例與只有連結的寫法不同
      sources: [...topicSources(context), ...context.model.dataset.comparisons.map(comparisonText)],
    }),
  };
}

/**
 * 各軸的兩極光譜。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function topicAxes(context) {
  const results = context.results();
  // 尚未作答時沒有位置
  if (!results.answeredCount) return notAnsweredCard(context);
  const { ideology } = results;
  // 每條軸一列，兩端寫出兩極的比例
  const items = ideology.axes.map((axis) => {
    const value = ideology.user.get(axis.code);
    const positive = poleShare(value);
    // 每列都有的欄位：軸名、級別與位置
    const base = { id: axis.code, label: axis.name, band: bandOf(axis, value)?.label ?? t("topic.noAxis"), value };
    // 沒有比例時兩端只寫極名，說明寫沒有作答
    if (positive === null) return { ...base, negative: axis.negative, positive: axis.positive, tip: t("topic.noAxis") };
    const [negativeText, positiveText] = poleTexts(axis, positive, AXIS_DIGITS);
    return { ...base, negative: negativeText, positive: positiveText, tip: t("topic.axisTip", { axis: axis.name, negative: axis.negative, positive: axis.positive, low: pct(1 - positive, AXIS_DIGITS), high: pct(positive, AXIS_DIGITS) }) };
  });
  return {
    blocks: [{ type: "spectrum", label: t("topic.spectrumLabel"), min: SETTINGS.ideology.min, max: SETTINGS.ideology.max, items }],
    info: info({
      steps: ideology.axes.map((axis) => step(axis.name, num(ideology.user.get(axis.code) ?? null, AXIS_DIGITS), t("topic.axisFormula"), t("result.axisUsed", { count: ideology.used.get(axis.code).length }))),
      sources: topicSources(context),
      constants: constants(context.settings, ["ideology.min", "ideology.max"]),
    }),
  };
}

/**
 * 各軸位置的雷達圖，只有使用者一個系列。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function topicRadar(context) {
  const results = context.results();
  // 尚未作答時沒有位置可畫
  if (!results.answeredCount) return notAnsweredCard(context);
  // 主題測驗只繪製作答者自己
  return radarCard(context, results.ideology, [], "topic.axisFormula", topicSources(context));
}

/**
 * 參照點距離表：依距離由近到遠列出全部參照點與各軸位置。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function topicReferences(context) {
  const results = context.results();
  // 尚未作答時沒有距離
  if (!results.answeredCount) return notAnsweredCard(context);
  const axes = context.model.axes;
  const columns = [{ key: "rank", label: t("topic.rank"), align: "end" }, { key: "name", label: t("topic.reference") }, { key: "distance", label: t("topic.distance"), align: "end" }, ...axes.map((axis) => ({ key: axis.code, label: axis.name, align: "end" }))];
  // 每列一個參照點，有原文名稱時附在名稱後面
  const rows = results.references.map((reference, index) => ({
    id: reference.id,
    cells: { rank: String(index + 1), name: referenceLabel(reference), distance: num(reference.distance, DISTANCE_DIGITS), ...Object.fromEntries(axes.map((axis) => [axis.code, num(reference.position[axis.code], 0)])) },
  }));
  return {
    blocks: [{ type: "table", columns, rows, dense: true }, { type: "text", text: t("topic.referencesRead"), tone: "muted" }],
    info: info({
      steps: [step(t("topic.stepReferences"), String(rows.length), t(`registry.distance.${context.model.set.distance}.text`))],
      sources: topicSources(context),
    }),
  };
}

/**
 * 方法頁：主題測驗的軸、各級門檻與距離。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function methodsTopic(context) {
  const { set, axes } = context.model;
  // 各軸共用同一組門檻，取第一條軸的門檻寫出
  const bands = axes[0]?.bands ?? [];
  const columns = [{ key: "name", label: t("topic.axis") }, { key: "poles", label: t("topic.poles") }, { key: "power", label: t("topic.power"), align: "end" }, { key: "labels", label: t("topic.labels") }];
  // 每條軸一列，各級標籤依門檻由高到低
  const rows = axes.map((axis) => ({ id: axis.code, cells: { name: axis.name, poles: t("topic.polesValue", { negative: axis.negative, positive: axis.positive }), power: num(axis.power, 2), labels: axis.bands.map((band) => band.label).join("、") } }));
  return {
    blocks: [
      { type: "text", text: set.note ?? "" },
      { type: "formulas", items: t("topic.formulas") },
      // 門檻依是否含等於寫成 > 或 ≥
      { type: "text", text: t("topic.bands", { bands: bands.map((band) => t(band.inclusive ? "topic.bandInclusive" : "topic.bandExclusive", { min: num(band.min, 0) })).join("、") }), tone: "muted" },
      { type: "table", columns, rows, dense: true },
    ],
    info: info({ steps: [step(t("topic.stepAxes"), String(axes.length)), step(t("topic.stepReferences"), String(context.model.references.length))], sources: topicSources(context) }),
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const TOPIC_CARDS = {
  "topic.summary": { build: topicSummary },
  "topic.choices": { build: topicChoices },
  "topic.axes": { build: topicAxes },
  "topic.radar": { build: topicRadar },
  "topic.references": { build: topicReferences },
  "methods.topic": { build: methodsTopic },
};

export { TOPIC_CARDS };
