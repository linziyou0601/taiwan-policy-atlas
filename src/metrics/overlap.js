/* ==================================================
 * metrics/overlap.js - 議題分布與重疊度
 * --------------------------------------------------
 * - 角色：比較使用者的議題重視度與候選人政見的議題分布，算出重疊度
 * - 指令：import { issueTotals, candidateDistribution, userDistribution, overlapScores } from "../metrics/overlap.js"
 * - 慣例：
 *   - 比較的單位是第 1 層議題（data/model.js 的 ISSUE_LEVEL），議題分布樹也由 issueTotals 累加，兩邊是同一組議題
 *   - 候選人分布：各議題的 `Σ(分配 × 來源類型權重)` 再正規化，含沒有對應題目的配題，政見寫了多少就算多少。主張數只算來源類型權重大於 0 的主張
 *   - 使用者分布：各議題的重視度正規化，議題範圍是本選區候選人有政見的議題
 *   - 重疊度：`Σ min(使用者比例, 候選人比例)`，介於 0 到 1。主張數少於 overlapMinClaims 時記為資料不足
 * ================================================== */

import { issueOf, detailOf, byTaxonomyOrder } from "../data/index.js";
import { importanceOf } from "./weights.js";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 一位候選人的主張依配題累加到議題：每筆配題的分量是 `分配 × 來源類型權重`，第 1 層議題下再分細項。
 * @param {object} model 資料模型。
 * @param {string} entityId 候選人。
 * @param {Set<string>|null} allowed 允許的來源類型，null 表示全部。
 * @returns {{ tree: Map<string, Map<string, number>>, totals: Map<string, number>, claims: number }} tree 的鍵是議題，值是細項到分量的對照，配題就在議題這一層時細項就是議題本身。totals 是每個議題的分量，即其下細項的加總。claims 是計入的主張數。
 */
function issueTotals(model, entityId, allowed) {
  const tree = new Map();
  let claims = 0;
  // 逐則主張把分配累加到議題與細項
  for (const claim of model.claimsByEntity.get(entityId) ?? []) {
    const sourceWeight = model.sourceWeights.get(claim.source_type) ?? 0;
    // 共同來源模式只看允許的來源類型，權重為 0 的來源（例如新聞）不計分量也不計主張數
    if ((allowed && !allowed.has(claim.source_type)) || sourceWeight <= 0) continue;
    claims += 1;
    // 一則主張的各筆配題依分配累加
    for (const mapping of model.mappingsByClaim.get(claim.id) ?? []) {
      const issue = issueOf(model.taxonomy, mapping.facet);
      // 配題的面向比議題層級更淺時無法歸屬
      if (!issue) continue;
      const detail = detailOf(model.taxonomy, mapping.facet);
      // 第一次遇到的議題建立節點
      if (!tree.has(issue)) tree.set(issue, new Map());
      const details = tree.get(issue);
      details.set(detail, (details.get(detail) ?? 0) + mapping.allocation * sourceWeight);
    }
  }
  // 每個議題的分量是其下細項的加總
  const totals = new Map([...tree].map(([issue, details]) => [issue, [...details.values()].reduce((s, v) => s + v, 0)]));
  return { tree, totals, claims };
}

/**
 * 計算一位候選人的議題分布。
 * @param {object} model 資料模型。
 * @param {string} entityId 候選人。
 * @param {Set<string>|null} allowed 允許的來源類型，null 表示全部。
 * @returns {{ shares: Map<string, number>, claims: number }} 沒有任何分量時 shares 是空的。
 */
function candidateDistribution(model, entityId, allowed) {
  const { totals, claims } = issueTotals(model, entityId, allowed);
  const sum = [...totals.values()].reduce((s, value) => s + value, 0);
  // 正規化成比例，沒有分量時分布為空
  const shares = new Map(sum > 0 ? [...totals].map(([issue, value]) => [issue, value / sum]) : []);
  return { shares, claims };
}

/**
 * 計算使用者的議題分布。
 * @param {string[]} issues 比較的議題。
 * @param {Record<string, number>} importance 議題重視度。
 * @returns {Map<string, number>}
 */
function userDistribution(issues, importance) {
  const values = issues.map((issue) => [issue, importanceOf(importance, issue)]);
  const sum = values.reduce((s, [, v]) => s + v, 0);
  // 全部設為 0 時沒有分布
  return new Map(values.map(([issue, v]) => [issue, sum > 0 ? v / sum : 0]));
}

/**
 * 計算每位候選人的重疊度。
 * @param {object} input 計算輸入。
 * @param {object} input.model 資料模型。
 * @param {string[]} input.entityIds 候選人。
 * @param {Record<string, number>} input.importance 議題重視度。
 * @param {object} input.scoring settings.scoring。
 * @param {Set<string>|null} input.allowed 允許的來源類型。
 * @returns {{ user: Map<string, number>, issues: string[], perEntity: Map<string, { score: number|null, shares: Map<string, number>, claims: number, insufficient: boolean }> }}
 */
function overlapScores({ model, entityIds, importance, scoring, allowed }) {
  const distributions = new Map(entityIds.map((id) => [id, candidateDistribution(model, id, allowed)]));
  // 議題清單取所有候選人出現過的議題聯集，並依分類順序排列讓畫面穩定
  const issues = [...new Set([...distributions.values()].flatMap((d) => [...d.shares.keys()]))].sort(byTaxonomyOrder(model.taxonomy));
  const user = userDistribution(issues, importance);
  const perEntity = new Map();
  // 逐位候選人加總 `min(使用者, 候選人)`
  for (const [id, distribution] of distributions) {
    const insufficient = distribution.claims < scoring.overlapMinClaims;
    const score = issues.reduce((sum, issue) => sum + Math.min(user.get(issue) ?? 0, distribution.shares.get(issue) ?? 0), 0);
    // 主張太少時分布不穩定，記為資料不足
    perEntity.set(id, { score: insufficient ? null : score, shares: distribution.shares, claims: distribution.claims, insufficient });
  }
  return { user, issues, perEntity };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { issueTotals, candidateDistribution, userDistribution, overlapScores };
