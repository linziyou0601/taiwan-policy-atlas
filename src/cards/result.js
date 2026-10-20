/* ==================================================
 * cards/result.js - 結果頁的卡片
 * --------------------------------------------------
 * - 角色：摘要、候選人勾選列、總分長條、意識形態雷達、議題熱力圖、分數歸屬桑基圖、議題分布、參數調整、敏感度、固定作答、涵蓋率與逐題明細
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 每張卡回答一個問題，問題與讀法寫在 locale 的 cards.{代碼}
 *   - 候選人的顏色依遮蔽順序取 series 色，與號次、政黨無關。政黨色只出現在翻牌後的政黨標記
 *   - 未表態一律寫「此議題未提出政見」，不寫成 0 或中立
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { getPath } from "../lib/objects.js";
import { attribution, issueTree, sourceCoverage, blendBounds, QUESTION_PART, ancestorAt, issueOf, ISSUE_LEVEL, maskIndex, isStated } from "../metrics/index.js";
import { t, pct, num, step, info, constants, dataSources, notAnsweredCard, issueName, partyOf, youLabel, stanceName, blendFormula, barScale, SCORING_PATHS } from "./kit.js";
import { seriesOf } from "./series.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 桑基圖完整模式中，題目節點旁的題幹最多顯示的字數，完整題幹在滑過時的說明。
 */
const SANKEY_STEM_LENGTH = 16;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 聚焦中的候選人：使用者指定的那一位，沒有指定或已不在結果中時取排名第一。
 * @param {object} context 卡片情境。
 * @param {object} results 計分結果。
 * @returns {object} results.entities 的一筆。
 */
function focusEntity(context, results) {
  return results.entities.find((item) => item.id === context.state.focus) ?? results.entities[0];
}

/**
 * 結果頁要顯示的候選人：勾選列有勾選時只顯示勾選的，依排名排列。
 * @param {object} context 卡片情境。
 * @param {object} results 計分結果。
 * @returns {object[]}
 */
function shownEntities(context, results) {
  const selected = context.state.selected;
  // 沒有勾選時顯示全部
  return selected.length ? results.entities.filter((entity) => selected.includes(entity.id)) : results.entities;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 結果摘要。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultSummary(context) {
  const results = context.results();
  // 尚未作答時沒有結果可摘要
  if (!results.answeredCount) return notAnsweredCard(context);
  const top = results.entities[0];
  return {
    blocks: [
      {
        type: "stats",
        items: [
          { label: t("result.answered"), value: t("result.answeredValue", { answered: results.answeredCount, total: results.items.length }) },
          // 共識題是否計入由設定決定，註記要讓人知道這次的計算方式
          { label: t("result.consensus"), value: String(results.consensus.size), note: context.settings.scoring.includeConsensus ? t("result.consensusIncluded") : t("result.consensusExcluded") },
          { label: t("result.candidates"), value: String(results.entities.length) },
        ],
      },
      {
        type: "ranking",
        items: results.entities.map((entity) => ({
          id: entity.id,
          rank: entity.rank,
          label: context.label(entity.id),
          value: pct(entity.total),
          bar: entity.total,
          note: t("result.coverageNote", { coverage: pct(entity.stance.coverage) }),
          // 資料不足的候選人加註
          badge: entity.insufficient ? { label: t("result.insufficient"), tone: "warning" } : null,
          series: seriesOf(context, entity.id),
          // 翻牌前 partyOf 回傳 null，維持匿名
          party: partyOf(context, entity.id),
          action: `openCandidate:${entity.id}`,
        })),
      },
      { type: "notice", tone: "neutral", text: t("result.nonZeroSum") },
      // 含自訂資料時標示
      context.model.custom ? { type: "notice", tone: "warning", text: t("result.customData") } : null,
      {
        type: "buttons",
        items: [
          // 翻牌鈕在常駐的候選人列，這裡放分享與回頭檢視。看別人分享的結果時沒有自己的答案可以檢視，由頁首的說明列回到自己的作答
          { label: t("result.share"), icon: "link", action: "share", tone: "accent" },
          { label: t("result.shareImage"), icon: "image", action: "shareImage", tone: "neutral" },
          // 重新檢視答案只在自己的結果出現
          context.state.shared ? null : { label: t("result.reanswer"), icon: "arrowLeft", action: "quizGo:0", tone: "neutral" },
        ],
      },
    ],
    info: info({
      steps: [step(t("result.stepTotal", { label: context.label(top.id) }), pct(top.total, 1), blendFormula(context, top), t("result.totalRule"))],
      sources: dataSources(context),
      constants: constants(context.settings, SCORING_PATHS),
    }),
  };
}

/**
 * 常駐的候選人勾選列。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultCandidates(context) {
  const results = context.results();
  // 勾選為空代表全部候選人都納入比較
  const selected = context.state.selected;
  return {
    blocks: [
      {
        type: "candidateBar",
        label: t("result.compare"),
        items: [...results.entities]
          .sort((a, b) => maskIndex(context.model, a.id, context.entityIds) - maskIndex(context.model, b.id, context.entityIds))
          .map((entity) => ({
            id: entity.id,
            label: context.label(entity.id),
            checked: !selected.length || selected.includes(entity.id),
            series: seriesOf(context, entity.id),
            // 翻牌前 partyOf 回傳 null，維持匿名
            party: partyOf(context, entity.id),
            action: `toggleSelect:${entity.id}`,
          })),
        // 按鈕文字隨翻牌狀態切換。看別人分享的結果時一律翻牌，不放翻牌鈕
        reveal: context.state.shared ? null : { label: t(context.state.reveal ? "result.hide" : "result.reveal"), icon: context.state.reveal ? "eyeOff" : "eye", action: "toggleReveal" },
      },
    ],
    info: info({ steps: [step(t("result.stepSelected"), String(selected.length || results.entities.length)), step(t("result.stepSeries"), t("result.seriesRule"))], sources: dataSources(context) }),
  };
}

/**
 * 總分長條圖。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultBars(context) {
  const results = context.results();
  // 尚未作答時沒有分數
  if (!results.answeredCount) return notAnsweredCard(context);
  const items = shownEntities(context, results).map((entity) => {
    const range = blendBounds(entity, context.settings.scoring);
    return {
      id: entity.id,
      label: context.label(entity.id),
      value: entity.total,
      lower: range.lower,
      upper: range.upper,
      display: pct(entity.total),
      tip: t("result.barTip", { label: context.label(entity.id), total: pct(entity.total, 1), lower: pct(range.lower), upper: pct(range.upper), coverage: pct(entity.stance.coverage) }),
      // 資料不足的長條以淡色顯示
      muted: entity.insufficient,
      series: seriesOf(context, entity.id),
      action: `openCandidate:${entity.id}`,
    };
  });
  return {
    blocks: [{ type: "bars", items, scale: SETTINGS.charts.barScale, axisLabel: t("result.barAxis") }],
    info: info({
      steps: shownEntities(context, results).flatMap((entity) => [
        step(t("result.stepStance", { label: context.label(entity.id) }), pct(entity.stance.score, 1), t("result.stanceFormula"), t("result.stanceRule")),
        step(t("result.stepTotal", { label: context.label(entity.id) }), pct(entity.total, 1), blendFormula(context, entity)),
      ]),
      sources: dataSources(context),
      constants: constants(context.settings, SCORING_PATHS),
    }),
  };
}

/**
 * 意識形態雷達圖。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultRadar(context) {
  const results = context.results();
  // 全部略過時沒有作答的位置可畫
  if (!results.answeredCount) return notAnsweredCard(context);
  const ideology = results.ideology;
  // 圖例中關閉的系列記在檢視狀態，重新繪製後仍維持隱藏
  const hidden = context.state.view.hidden;
  const axes = ideology.axes.map((axis) => ({ code: axis.code, label: axis.name, tip: t("result.axisTip", { label: axis.name, negative: axis.negative, positive: axis.positive }), used: ideology.used.get(axis.code).length }));
  /**
   * 每條軸上一個點的說明。
   * @param {string} label 系列名稱。
   * @param {Map<string, number|null>} values 各軸位置。
   * @returns {Record<string, string>}
   */
  const tipsOf = (label, values) => Object.fromEntries(ideology.axes.map((axis) => [axis.code, t("result.pointTip", { label, axis: axis.name, value: num(values.get(axis.code) ?? null, 0) })]));
  const series = [
    { id: "user", label: youLabel(context), values: Object.fromEntries(ideology.user), tips: tipsOf(youLabel(context), ideology.user), series: 0, hidden: hidden.includes("user"), toggle: "toggleSeries:user" },
    ...shownEntities(context, results).map((entity) => ({
      id: entity.id,
      label: context.label(entity.id),
      values: Object.fromEntries(ideology.entities.get(entity.id)),
      tips: tipsOf(context.label(entity.id), ideology.entities.get(entity.id)),
      series: seriesOf(context, entity.id),
      hidden: hidden.includes(entity.id),
      toggle: `toggleSeries:${entity.id}`,
      action: `openCandidate:${entity.id}`,
    })),
  ];
  return {
    blocks: [{ type: "radar", label: t("result.radarLabel"), axes, series, min: SETTINGS.ideology.min, max: SETTINGS.ideology.max }],
    info: info({
      steps: axes.map((axis) => step(axis.label, num(ideology.user.get(axis.code) ?? null, 0), t("result.axisFormula"), t("result.axisUsed", { count: axis.used }))),
      sources: [...dataSources(context), ...ideology.axes.map((axis) => t("sources.axis", { name: axis.name, reference: axis.reference, url: axis.url }))],
      constants: constants(context.settings, ["ideology.min", "ideology.max"]),
    }),
  };
}

/**
 * 議題×候選人熱力圖。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultHeatmap(context) {
  const results = context.results();
  // 尚未作答時沒有契合度
  if (!results.answeredCount) return notAnsweredCard(context);
  const matrix = context.issueAgreement();
  const entities = shownEntities(context, results);
  // 每列是一個議題，每格是這位候選人在該議題下的契合度
  const rows = matrix.issues.map((issue) => ({
    id: issue,
    label: issueName(context, issue),
    cells: entities.map((entity) => {
      const cell = matrix.cells.get(entity.id).get(issue);
      return {
        value: cell.score,
        // 沒有政見的格子不給分數，顯示未表態
        display: cell.score === null ? t("result.noPolicyShort") : pct(cell.score),
        tip: t("result.cellTip", { issue: issueName(context, issue), label: context.label(entity.id), score: pct(cell.score), coverage: pct(cell.coverage), count: cell.questions }),
        action: `openIssue:${issue}=${entity.id}`,
      };
    }),
  }));
  return {
    blocks: [{ type: "heatmap", columns: entities.map((entity) => ({ id: entity.id, label: context.label(entity.id), series: seriesOf(context, entity.id) })), rows, tiers: SETTINGS.charts.heatmapTiers, legend: t("result.heatLegend") }],
    info: info({ steps: [step(t("result.stepIssue"), String(matrix.issues.length), t("result.issueFormula"))], sources: dataSources(context), constants: constants(context.settings, ["charts.heatmapTiers"]) }),
  };
}

/**
 * 分數歸屬桑基圖：議題模式是議題與其餘分項流向候選人的總分，每一題模式在議題前多出題目與議題細項兩欄。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultSankey(context) {
  const results = context.results();
  // 尚未作答時沒有歸屬
  if (!results.answeredCount) return notAnsweredCard(context);
  const entities = shownEntities(context, results);
  // 「看到每一題」時多畫題目與細項兩欄，預設只繪製議題。看別人分享的結果時固定在議題層級
  const full = context.state.view.sankeyDetail === "full" && !context.state.shared;
  // 每位候選人的總分拆回各題與另外兩個分項，流量加總要與總分守恆
  const flows = new Map(entities.map((entity) => [entity.id, attribution(context.model, entity)]));
  // 攤平成「候選人 × 題目」的貢獻列，各欄的流量都從這裡加總
  const rows = [...flows.entries()].flatMap(([entityId, flow]) => flow.questions.map((item) => ({ ...item, entityId })));
  const sum = (filter) => rows.filter(filter).reduce((total, item) => total + item.value, 0);
  // 議題依全部候選人的貢獻合計由大到小排列，大的議題排在上面
  const issues = [...new Set(rows.map((item) => item.issue))].map((issue) => ({ issue, value: sum((item) => item.issue === issue) })).sort((a, b) => b.value - a.value);
  // 完整模式的議題在第 3 欄，前面是題目與細項，精簡模式的議題在第 1 欄
  const issueColumn = full ? 2 : 0;
  // 節點與連結分開收集，最後才濾除值為 0 的連結
  const nodes = [];
  const links = [];
  // 完整模式：題目流向細項，細項流向議題，順序跟著議題排列，帶才不會交錯太多
  if (full) {
    const detailOf = (questionId) => ancestorAt(context.model.taxonomy, context.model.questions.get(questionId).facet, ISSUE_LEVEL + 1) ?? issueOf(context.model.taxonomy, context.model.questions.get(questionId).facet);
    // 細項依所屬議題的順序，再依貢獻由大到小
    const details = issues.flatMap(({ issue }) => [...new Set(rows.filter((item) => item.issue === issue).map((item) => detailOf(item.question)))].map((code) => ({ code, issue, value: sum((item) => detailOf(item.question) === code) })).sort((a, b) => b.value - a.value));
    // 每個細項一個節點，連到所屬議題
    for (const detail of details) {
      nodes.push({ id: `d:${detail.code}`, column: 1, label: issueName(context, detail.code), series: null, action: "openInfo:result.sankey" });
      links.push({ source: `d:${detail.code}`, target: `i:${detail.issue}`, value: detail.value, series: 0, tip: t("result.linkTip", { from: issueName(context, detail.code), to: issueName(context, detail.issue), value: pct(detail.value, 1) }) });
    }
    // 題目依細項的順序排列，每題連到它的細項，滑過時列出對各候選人的貢獻
    for (const detail of details) {
      const questions = [...new Set(rows.filter((item) => detailOf(item.question) === detail.code).map((item) => item.question))];
      // 同一細項內依貢獻由大到小
      for (const questionId of questions.sort((a, b) => sum((item) => item.question === b) - sum((item) => item.question === a))) {
        const stem = context.mask(context.model.questions.get(questionId).stem);
        const value = sum((item) => item.question === questionId);
        // 題幹太長時節點旁只寫開頭，完整題幹在滑過的說明
        nodes.push({ id: `q:${questionId}`, column: 0, label: stem, short: stem.length > SANKEY_STEM_LENGTH ? t("result.shortStem", { stem: stem.slice(0, SANKEY_STEM_LENGTH) }) : stem, series: null, action: `openQuestion:${questionId}` });
        links.push({ source: `q:${questionId}`, target: `d:${detail.code}`, value, series: 0, tip: t("result.linkTip", { from: stem, to: issueName(context, detail.code), value: pct(value, 1) }) });
      }
    }
  }
  // 議題連到每位候選人，帶的寬度是這個議題對那位候選人總分的貢獻
  for (const { issue } of issues) {
    nodes.push({ id: `i:${issue}`, column: issueColumn, label: issueName(context, issue), series: null, action: "openInfo:result.sankey" });
    // 每位候選人一條帶，顏色取候選人的系列色
    for (const entity of entities) {
      const value = sum((item) => item.issue === issue && item.entityId === entity.id);
      links.push({ source: `i:${issue}`, target: `c:${entity.id}`, value, series: seriesOf(context, entity.id), tip: t("result.linkTip", { from: issueName(context, issue), to: context.label(entity.id), value: pct(value, 1) }) });
    }
  }
  // 議題欄下方：拆不回題目的其餘分項，以整體值流向每位候選人。分項清單取自公式的分項，不寫死
  for (const key of entities[0].blend.terms.map((term) => term.key).filter((key) => key !== QUESTION_PART)) {
    nodes.push({ id: `p:${key}`, column: issueColumn, label: t(`result.parts.${key}`), series: null, action: "openInfo:result.sankey" });
    // 分項的貢獻取自公式的分項值
    for (const entity of entities) {
      const value = flows.get(entity.id).parts.find((part) => part.key === key)?.value ?? 0;
      links.push({ source: `p:${key}`, target: `c:${entity.id}`, value, series: seriesOf(context, entity.id), tip: t("result.linkTip", { from: t(`result.parts.${key}`), to: context.label(entity.id), value: pct(value, 1) }) });
    }
  }
  // 最右欄：候選人，依排名由上而下，節點高度就是總分
  for (const entity of entities) nodes.push({ id: `c:${entity.id}`, column: issueColumn + 1, label: t("result.totalNode", { label: context.label(entity.id), total: pct(entity.total) }), series: seriesOf(context, entity.id), action: `openCandidate:${entity.id}` });
  // 守恆誤差取各候選人中最大的一個
  const residual = Math.max(...[...flows.values()].map((flow) => Math.abs(flow.residual)));
  return {
    blocks: [
      // 切換顯示到議題或每一題，說明文字跟著模式換。看別人分享的結果時不放切換
      context.state.shared ? null : { type: "segmented", label: t("result.sankeyDetail"), value: full ? "full" : "issue", options: ["issue", "full"].map((value) => ({ value, label: t(`result.sankeyDetails.${value}`) })), action: "setView:sankeyDetail" },
      // 兩種模式各有自己的讀法說明
      { type: "text", text: t(full ? "result.sankeyIntroFull" : "result.sankeyIntro"), tone: "muted" },
      { type: "sankey", key: `sankey:${full ? "full" : "issue"}`, label: t("result.sankeyLabel"), nodes, links: links.filter((link) => link.value > 0), zoom: { in: t("chart.zoomIn"), out: t("chart.zoomOut"), reset: t("chart.zoomReset"), hint: t("chart.zoomHint") } },
      { type: "text", text: t("result.conservation", { residual: num(residual, 6) }), tone: "caption" },
    ],
    info: info({
      steps: [
        step(t("result.stepContribution"), String(issues.length), t("result.contributionFormula")),
        step(t("result.stepResidual"), num(residual, 6), t("result.residualRule")),
      ],
      sources: dataSources(context),
      constants: constants(context.settings, ["scoring.formulaParams"]),
    }),
  };
}

/**
 * 議題分布：候選人政見的議題分布與使用者的重視度。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultTreemap(context) {
  // 沒有指定聚焦的候選人時取排名第一
  const results = context.results();
  const entity = focusEntity(context, results);
  // 議題樹的值是這位候選人的主張分布在各議題的分量
  const tree = issueTree(context.model, entity.id, results.allowed);
  const total = tree.reduce((sum, node) => sum + node.value, 0);
  // 第二個維度：你和這位候選人在各議題的契合度，取自熱力圖的同一份矩陣，沒有可比較的題目時為 null
  const agreement = context.issueAgreement().cells.get(entity.id);
  const items = tree.map((node) => ({
    id: node.code,
    label: issueName(context, node.code),
    value: node.value,
    shade: agreement.get(node.code)?.score ?? null,
    // 沒有任何主張時總量為 0，比例顯示缺值而不是除以零
    display: pct(total > 0 ? node.value / total : null),
    // 提示文字的比例同樣要避開除以零
    tip: t("result.treeTip", { label: issueName(context, node.code), share: pct(total > 0 ? node.value / total : null), agreement: pct(agreement.get(node.code)?.score ?? null) }),
    action: `openIssue:${node.code}=${entity.id}`,
    // 第 2 層議題沿用同一個總量算比例，才能和第 1 層直接比較
    children: node.children.map((child) => ({ id: child.code, text: t("result.treeChild", { label: issueName(context, child.code), share: pct(total > 0 ? child.value / total : null) }) })),
  }));
  // 使用者的重視度分布用同一份議題清單，兩邊才能對照
  const user = results.overlap.issues.map((issue) => ({ id: issue, label: issueName(context, issue), value: results.overlap.user.get(issue), display: pct(results.overlap.user.get(issue)), series: null }));
  const overlap = results.overlap.perEntity.get(entity.id);
  return {
    blocks: [
      // 聚焦的候選人在這張卡內切換，控制項就在受影響的圖上方
      { type: "candidatePicker", label: t("result.focus"), items: results.entities.map((item) => ({ id: item.id, label: context.label(item.id), series: seriesOf(context, item.id), selected: item.id === entity.id, action: `setFocus:${item.id}` })) },
      { type: "heading", text: t("result.treemapFocus", { label: context.label(entity.id), overlap: pct(overlap.score), claims: overlap.claims }), level: 4 },
      { type: "treemap", items, series: seriesOf(context, entity.id), label: t("result.treemapLabel"), legend: t("result.treemapLegend") },
      { type: "heading", text: t("result.userDistribution"), level: 4 },
      { type: "bars", items: user, scale: barScale(user.map((item) => item.value ?? 0)), axisLabel: t("result.userAxis"), compact: true },
      // 主張太少時提示重疊度資料不足
      overlap.insufficient ? { type: "notice", tone: "warning", text: t("result.overlapInsufficient", { min: context.settings.scoring.overlapMinClaims }) } : null,
    ],
    info: info({
      steps: [step(t("result.stepOverlap", { label: context.label(entity.id) }), pct(overlap.score, 1), t("result.overlapFormula"))],
      sources: dataSources(context),
      constants: constants(context.settings, ["scoring.overlapMinClaims"]),
    }),
  };
}

/**
 * 參數的唯讀清單：看別人分享的結果時取代調整控制項，每個參數一列，寫出分享者使用的值。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultParamValues(context) {
  const items = SETTINGS.params.map((param) => {
    const value = getPath(context.settings, param.path);
    // 是非與選項參數寫出文案，數值參數寫出數字
    const display = param.type === "boolean" ? t(value ? "common.yes" : "common.no") : param.type === "choice" ? t(`params.${param.key}.choices.${value}`) : num(value);
    return { label: t(`params.${param.key}.label`), value: display };
  });
  return {
    blocks: [{ type: "text", text: t("shared.params"), tone: "muted" }, { type: "keyValue", items }],
    info: info({ constants: constants(context.settings, SETTINGS.params.map((param) => param.path)) }),
  };
}

/**
 * 參數即時調整。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultParams(context) {
  // 看別人分享的結果時參數鎖住，只列出分享者使用的值
  if (context.state.shared) return resultParamValues(context);
  const controls = SETTINGS.params.map((param) => {
    const value = getPath(context.settings, param.path);
    // 標籤與說明的文案鍵與設定的參數鍵一致，settings 的 params 與 locale 的 params 成對維護
    const label = t(`params.${param.key}.label`);
    // 是非參數以開關呈現
    if (param.type === "boolean") return { type: "toggle", label, note: t(`params.${param.key}.note`), checked: value, action: `setParam:${param.path}=${!value}` };
    // 選項參數以分段按鈕呈現
    if (param.type === "choice") return { type: "segmented", label, note: t(`params.${param.key}.note`), value, options: param.choices.map((choice) => ({ value: choice, label: t(`params.${param.key}.choices.${choice}`) })), action: `setParam:${param.path}` };
    return { type: "slider", label, note: t(`params.${param.key}.note`), value, min: param.min, max: param.max, step: param.step, display: num(value), action: `setParam:${param.path}` };
  });
  const changed = Object.keys(context.state.params).length;
  return {
    blocks: [...controls, { type: "buttons", items: [{ label: t("params.reset"), icon: "reset", action: "resetParams", tone: "neutral", disabled: !changed }] }],
    info: info({ steps: [step(t("params.stepChanged"), String(changed))], constants: constants(context.settings, SETTINGS.params.map((param) => param.path)) }),
  };
}

/**
 * Kendall τ-b 敏感度。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultRobustness(context) {
  const results = context.results();
  // 尚未作答時不做敏感度分析
  if (!results.answeredCount) return notAnsweredCard(context);
  const { sensitivity } = context.robustness();
  // 候選人少於兩位時沒有排序可比
  if (!sensitivity.count) return { blocks: [{ type: "notice", tone: "neutral", text: t("robustness.single") }], info: info({ sources: dataSources(context) }) };
  const taus = sensitivity.draws.map((draw) => draw.tau).filter((tau) => tau !== null);
  const bins = SETTINGS.charts.tauBins.slice(0, -1).map((low, i) => {
    // 最後一箱的上界是略大於 1 的哨兵值，顯示時限制為 1
    const label = t("robustness.bin", { low: num(low, 1), high: num(Math.min(1, SETTINGS.charts.tauBins[i + 1]), 1) });
    const value = taus.filter((tau) => tau >= low && tau < SETTINGS.charts.tauBins[i + 1]).length;
    return { label, value, tip: t("robustness.binTip", { label, value }) };
  });
  return {
    blocks: [
      {
        type: "stats",
        items: [
          { label: t("robustness.median"), value: num(sensitivity.median) },
          { label: t("robustness.min"), value: num(sensitivity.min) },
          { label: t("robustness.top"), value: pct(sensitivity.topStable) },
        ],
      },
      { type: "histogram", bins, label: t("robustness.histogram") },
      { type: "text", text: t("robustness.read"), tone: "muted" },
    ],
    info: info({
      steps: [step(t("robustness.stepDraws"), String(sensitivity.count), t("robustness.formula"), t("robustness.rule"))],
      constants: constants(context.settings, ["robustness.draws", "robustness.seed", "robustness.low", "robustness.high"]),
    }),
  };
}

/**
 * 固定作答檢驗。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultFixed(context) {
  const { fixed } = context.robustness();
  const entities = context.results().entities;
  // 第一欄是固定的作答型態，其後每位候選人各一欄
  const columns = [{ key: "answer", label: t("fixed.pattern") }, ...entities.map((entity) => ({ key: entity.id, label: context.label(entity.id), align: "end" }))];
  const rows = fixed.map((check) => {
    const byId = new Map(check.entities.map((entity) => [entity.id, entity]));
    return { cells: { answer: context.model.answers.get(check.answer).name, ...Object.fromEntries(entities.map((entity) => [entity.id, pct(byId.get(entity.id)?.total)])) } };
  });
  return {
    blocks: [{ type: "table", columns, rows }, { type: "text", text: t("fixed.read"), tone: "muted" }],
    info: info({ steps: [step(t("fixed.stepPatterns"), String(fixed.length), t("fixed.rule"))], sources: dataSources(context), constants: constants(context.settings, ["fixedAnswers"]) }),
  };
}

/**
 * 涵蓋率與資料不足。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultCoverage(context) {
  const results = context.results();
  // 全部略過時沒有已作答的題目，涵蓋率沒有分母
  if (!results.answeredCount) return notAnsweredCard(context);
  // 分來源類型的涵蓋率，欄名用來源類型表的名稱
  const { types, coverage } = sourceCoverage(context.model, results);
  const names = new Map(context.data.tables.sourceTypes.map((row) => [row.code, row.name]));
  // 欄位依序是候選人、整體涵蓋率、未表態題數、本選區有主張的各來源類型的涵蓋率與狀態
  const columns = [
    { key: "label", label: t("coverage.candidate") },
    { key: "coverage", label: t("coverage.coverage"), align: "end" },
    { key: "unknown", label: t("coverage.unknown"), align: "end" },
    ...types.map((type) => ({ key: type, label: t("coverage.byType", { type: names.get(type) }), align: "end" })),
    { key: "status", label: t("coverage.status") },
  ];
  const rows = results.entities.map((entity) => {
    // 未表態題數只算計入排序的題目，與涵蓋率的分母一致
    const unknown = entity.stance.rows.filter((row) => row.counted && row.stance === null).length;
    const counts = context.model.entities.get(entity.id).claim_counts;
    return {
      action: `openCandidate:${entity.id}`,
      cells: {
        label: context.label(entity.id),
        coverage: pct(entity.stance.coverage),
        unknown: String(unknown),
        // 每類來源的涵蓋率後面附上該類的主張則數
        ...Object.fromEntries(types.map((type) => [type, t("coverage.typeCell", { coverage: pct(coverage.get(entity.id).get(type)), claims: counts[type] ?? 0 })])),
        // 資料不足與足夠以文字標示，不只靠顏色
        status: entity.insufficient ? t("result.insufficient") : t("coverage.enough"),
      },
    };
  });
  return {
    blocks: [{ type: "table", columns, rows }, { type: "text", text: t("coverage.read", { threshold: pct(context.settings.scoring.coverageThreshold) }), tone: "muted" }],
    info: info({ steps: [step(t("coverage.stepCoverage"), t("coverage.formula")), step(t("coverage.stepType"), String(types.length), t("coverage.typeFormula"))], sources: dataSources(context), constants: constants(context.settings, ["scoring.coverageThreshold", "scoring.sourceMode", "scoring.commonOnly"]) }),
  };
}

/**
 * 逐題明細。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function resultDetails(context) {
  const results = context.results();
  // 尚未作答時沒有明細
  if (!results.answeredCount) return notAnsweredCard(context);
  const entities = shownEntities(context, results);
  const answered = results.questionIds.filter((id) => isStated(context.state.answers[id]));
  // 先建好候選人與題目的查表，逐格取值時不必重複掃描
  const rowsByEntity = new Map(entities.map((entity) => [entity.id, new Map(entity.stance.rows.map((row) => [row.question, row]))]));
  const columns = [
    { key: "number", label: t("details.number"), align: "end" },
    { key: "issue", label: t("details.issue"), nowrap: true },
    { key: "stem", label: t("details.stem") },
    { key: "answer", label: t("details.answer") },
    { key: "weight", label: t("details.weight"), align: "end" },
    ...entities.map((entity) => ({ key: entity.id, label: context.label(entity.id) })),
  ];
  // 每個作答過的題目一列，題號依作答順序編
  const rows = answered.map((id, index) => {
    const question = context.model.questions.get(id);
    // 共識與權重是題目層級的屬性，各候選人都一樣，取第一位的列即可
    const first = rowsByEntity.get(entities[0].id).get(id);
    return {
      action: `openQuestion:${id}`,
      // 共識題加註，滑過整列時說明這題的立場全部相同
      note: first.consensus ? t("details.consensus") : null,
      cells: {
        number: String(index + 1),
        issue: issueName(context, issueOf(context.model.taxonomy, question.facet)),
        stem: context.mask(question.stem),
        answer: context.model.answers.get(context.state.answers[id].answer).name,
        weight: pct(first.weight, 1),
        ...Object.fromEntries(entities.map((entity) => {
          const row = rowsByEntity.get(entity.id).get(id);
          // 未表態寫此議題未提出政見
          return [entity.id, row.stance === null ? t("result.noPolicy") : t("details.cell", { stance: stanceName(context.model, row.stance), agreement: pct(row.agreement) })];
        })),
      },
    };
  });
  return {
    blocks: [{ type: "table", columns, rows, dense: true }],
    info: info({ steps: [step(t("details.stepRows"), String(rows.length), t("result.stanceFormula"))], sources: dataSources(context), constants: constants(context.settings, ["scoring.agreement", "scoring.stanceAggregate"]) }),
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const RESULT_CARDS = {
  "result.summary": { build: resultSummary },
  "result.candidates": { build: resultCandidates },
  "result.bars": { build: resultBars },
  "result.radar": { build: resultRadar },
  "result.heatmap": { build: resultHeatmap },
  "result.sankey": { build: resultSankey },
  "result.treemap": { build: resultTreemap },
  "result.params": { build: resultParams },
  "result.robustness": { build: resultRobustness },
  "result.fixed": { build: resultFixed },
  "result.coverage": { build: resultCoverage },
  "result.details": { build: resultDetails },
};

export { RESULT_CARDS };
