/* ==================================================
 * metrics/views.js - 圖表用的衍生資料
 * --------------------------------------------------
 * - 角色：從 computeResults 的結果整理出分數歸屬、議題×候選人契合、議題分布樹，圖表只繪製這些資料
 * - 指令：import { attribution, issueAgreement, issueTree, sourceCoverage } from "../metrics/index.js"
 * - 慣例：
 *   - 分數歸屬守恆：各題的貢獻加總等於立場分項，三個分項依公式權重加總等於總分，差額列為守恆誤差
 *   - 議題契合：該議題內計入題目的 `Σ(w × a) / Σ(w)`，只用候選人已表態的題目，同時回傳該議題的涵蓋率
 * ================================================== */

import { questionIssue, byTaxonomyOrder } from "../data/index.js";
import { issueTotals } from "./overlap.js";
import { summarizeRows, coverageOf } from "./stance.js";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 計算一位候選人的分數歸屬。
 * 題目貢獻：`立場權重占比 × w × a / Σ(已表態的 w)`，具體度與重疊度各為一個節點。
 * @param {object} model 資料模型。
 * @param {object} entity computeResults 的一位候選人結果。
 * @returns {{ questions: { question: string, issue: string, value: number }[], parts: { key: string, value: number }[], total: number|null, residual: number }}
 */
function attribution(model, entity) {
  const usedWeight = entity.blend.terms.filter((term) => term.used).reduce((sum, term) => sum + term.weight, 0);
  // 各分項占總分的比重，沒有可用分項時為 0
  const shareOf = (key) => {
    const term = entity.blend.terms.find((item) => item.key === key);
    // 分項未採用或全部分項權重為 0 時，這個分項不分得比重
    return term?.used && usedWeight > 0 ? term.weight / usedWeight : 0;
  };
  // 歸屬只涵蓋計入排序且候選人已表態的題目，與立場契合的分子一致
  const counted = entity.stance.rows.filter((row) => row.counted && row.agreement !== null);
  const knownWeight = counted.reduce((sum, row) => sum + row.weight, 0);
  const stanceShare = shareOf("stance");
  // 每題的貢獻以立場分項的比重與題目權重占比攤算，加總才會回到立場分項
  const questions = counted.map((row) => ({
    question: row.question,
    issue: questionIssue(model, row.question),
    // 已表態權重為 0 時沒有貢獻
    value: knownWeight > 0 ? (stanceShare * row.weight * row.agreement) / knownWeight : 0,
  }));
  // 未採用的分項貢獻記為 0，加總差額才不受它的原始值影響
  const parts = entity.blend.terms.map((term) => ({ key: term.key, value: term.used ? shareOf(term.key) * term.value : 0 }));
  const sum = parts.reduce((s, part) => s + part.value, 0);
  // 沒有總分時沒有守恆誤差可言，記為 0
  return { questions, parts, total: entity.total, residual: entity.total === null ? 0 : entity.total - sum };
}

/**
 * 計算議題×候選人的契合矩陣。
 * @param {object} model 資料模型。
 * @param {object} results computeResults 的結果。
 * @returns {{ issues: string[], cells: Map<string, Map<string, { score: number|null, coverage: number|null, questions: number }>> }}
 */
function issueAgreement(model, results) {
  const issues = [...new Set(results.questionIds.map((id) => questionIssue(model, id)))].sort(byTaxonomyOrder(model.taxonomy));
  // 以議題為列、候選人為欄的格子，每格同時存契合度與涵蓋率
  const cells = new Map();
  // 逐位候選人、逐議題彙總
  for (const entity of results.entities) {
    const row = new Map();
    // 每個議題只看該議題的題目
    for (const issue of issues) {
      const rows = entity.stance.rows.filter((r) => r.counted && questionIssue(model, r.question) === issue);
      // 沒有已表態題目時契合度沒有定義，涵蓋率仍可計算
      const { score, coverage } = summarizeRows(rows);
      row.set(issue, { score, coverage, questions: rows.length });
    }
    cells.set(entity.id, row);
  }
  return { issues, cells };
}

/**
 * 整理一位候選人的議題分布樹：議題下分細項，與重疊度用同一份 issueTotals 的累加。
 * @param {object} model 資料模型。
 * @param {string} entityId 候選人。
 * @param {Set<string>|null} allowed 允許的來源類型。
 * @returns {{ code: string, value: number, children: { code: string, value: number }[] }[]}
 */
function issueTree(model, entityId, allowed) {
  const { tree, totals } = issueTotals(model, entityId, allowed);
  return [...tree]
    // 每個議題的值採用 issueTotals 的合計，細項由大到小排列
    .map(([code, details]) => ({
      code,
      value: totals.get(code),
      children: [...details].map(([child, value]) => ({ code: child, value })).sort((a, b) => b.value - a.value),
    }))
    .filter((node) => node.value > 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * 計算每位候選人分來源類型的涵蓋率：只使用某一類來源時，已作答題目中有表態的權重比例。
 * 候選人的來源類型不一定相同，這張表讓讀者看出比較的基礎是否對等。
 * @param {object} model 資料模型。
 * @param {object} results computeResults 的結果。
 * @returns {{ types: string[], coverage: Map<string, Map<string, number|null>> }} types 是本選區有主張的來源類型。
 */
function sourceCoverage(model, results) {
  const present = new Set(results.entities.flatMap((entity) => (model.claimsByEntity.get(entity.id) ?? []).map((claim) => claim.source_type)));
  // 依來源類型表的順序列出有主張的類型
  const types = model.tables.sourceTypes.map((row) => row.code).filter((code) => present.has(code));
  const coverage = new Map();
  // 逐位候選人、逐類來源計算
  for (const entity of results.entities) {
    // 分母與整體涵蓋率相同，是計入排序的已作答題目
    const counted = entity.stance.rows.filter((row) => row.counted);
    const byType = new Map();
    // 該類來源有權重大於 0 的配題，才算對這題表態
    for (const type of types) byType.set(type, coverageOf(counted, (row) => results.stances.get(entity.id).get(row.question).items.some((item) => item.claim.source_type === type && item.weight > 0)));
    coverage.set(entity.id, byType);
  }
  return { types, coverage };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { attribution, issueAgreement, issueTree, sourceCoverage };
