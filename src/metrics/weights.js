/* ==================================================
 * metrics/weights.js - 題目權重
 * --------------------------------------------------
 * - 角色：把議題重視度沿分類樹往下分配到題目，子題分母題的預算
 * - 指令：import { questionWeights, groupShares } from "../metrics/weights.js"
 * - 慣例：
 *   - 只有本次出現的根題所在的節點參與分配，沒有題目的節點不占份額
 *   - 節點的份額依子節點的重視度比例往下分。節點本身也有根題時，這些根題合為一個虛擬子節點，重視度取預設值
 *   - 同一節點的根題均分該節點的份額。根題與它出現的子題共用根題的份額，依各題的預算份額正規化
 *   - 全部題目的權重合計為 1
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { groupBy } from "../lib/objects.js";
import { ISSUE_LEVEL, byTaxonomyOrder, lineage } from "../data/index.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} WeightResult 權重結果。
 * @property {Map<string, number>} weights 題目代碼對應權重，合計為 1。
 * @property {Map<string, number>} nodeShares 分類節點對應份額，議題分布與 info 以它說明分配。
 * @property {Map<string, string>} groupOf 題目代碼對應它的根題。
 */

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 取得節點的重視度，沒有設定時取預設值。
 * @param {Record<string, number>} importance 使用者設定。
 * @param {string} code 節點代碼。
 * @returns {number}
 */
function importanceOf(importance, code) {
  return importance[code] ?? SETTINGS.importance.default;
}

/**
 * 同一根題底下的題目共用一份，依預算份額算出每題占的比例。總分以它拆根題的份額，意識形態軸以它讓一組母子題只算一題的分量。
 * @param {object} model 資料模型。
 * @param {string[]} ids 參與正規化的題目，子題的母題也要在內。
 * @returns {{ groupOf: Map<string, string>, shares: Map<string, number> }} groupOf 是每題的根題，shares 是每題占同一根題預算合計的比例，同一根題的比例合計為 1。
 */
function groupShares(model, ids) {
  const groupOf = new Map();
  // 沿母題往上，走到沒有母題的那一題
  for (const id of ids) {
    let root = id;
    // 往上直到根題
    while (model.questions.get(root).parent) root = model.questions.get(root).parent;
    groupOf.set(id, root);
  }
  const totals = new Map();
  // 先加總每個根題底下各題的預算份額
  for (const id of ids) {
    const group = groupOf.get(id);
    totals.set(group, (totals.get(group) ?? 0) + model.questions.get(id).budget_share);
  }
  // 每題的比例是 `本題預算份額 / 同一根題的預算合計`
  const shares = new Map(ids.map((id) => [id, model.questions.get(id).budget_share / totals.get(groupOf.get(id))]));
  return { groupOf, shares };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 計算題目權重。
 * @param {object} model 資料模型。
 * @param {{ id: string, parent: string|null }[]} items 本次出現的題目，visibleQuestions 的結果。
 * @param {Record<string, number>} importance 議題重視度。
 * @returns {WeightResult}
 */
function questionWeights(model, items, importance) {
  const roots = items.filter((item) => !item.parent).map((item) => model.questions.get(item.id));
  // 每個節點掛著哪些根題
  const rootsAt = groupBy(roots, (root) => root.facet);
  const rootIdsAt = (code) => (rootsAt.get(code) ?? []).map((root) => root.id);
  // 根題所在節點與其祖先都是有效節點，沿父節點往上標記
  const active = new Set(roots.flatMap((root) => lineage(model.taxonomy, root.facet)));
  // 節點份額與根題份額分開存放，前者供畫面顯示，後者決定每題權重
  const nodeShares = new Map();
  const rootShares = new Map();
  /**
   * 把一個節點的份額分給有效子節點與本節點的根題。
   * @param {string[]} codes 同層的有效節點。
   * @param {number} share 這一層可分的份額。
   * @param {string[]} ownRoots 上一層節點本身掛的根題，當成虛擬子節點參與分配。
   */
  const distribute = (codes, share, ownRoots) => {
    const parts = codes.map((code) => ({ code, weight: importanceOf(importance, code) }));
    // 上一層節點本身有根題時，以預設重視度加入分配
    if (ownRoots.length) parts.push({ code: null, weight: SETTINGS.importance.default });
    const total = parts.reduce((sum, part) => sum + part.weight, 0);
    // 逐份分配，重視度合計為 0 時這一層的份額全部為 0
    for (const part of parts) {
      // 重視度合計為 0 時沒有可分的比例，避免除以 0
      const portion = total > 0 ? (share * part.weight) / total : 0;
      // 虛擬子節點的份額由根題均分
      if (part.code === null) {
        // 每題分到相同份額
        for (const id of ownRoots) rootShares.set(id, portion / ownRoots.length);
        continue;
      }
      nodeShares.set(part.code, portion);
      // 有效子節點才參與往下分配，沒有出題的子樹不占份額
      const node = model.taxonomy.get(part.code);
      const children = node.children.filter((code) => active.has(code));
      // 沒有有效子節點時，份額全由本節點的根題均分
      if (!children.length) {
        const own = rootIdsAt(part.code);
        // 每題分到相同份額
        for (const id of own) rootShares.set(id, portion / own.length);
        continue;
      }
      distribute(children, portion, rootIdsAt(part.code));
    }
  };
  // 從第 1 層議題開始分配整體的 1，依分類順序排列讓結果穩定
  const level1 = [...active].filter((code) => model.taxonomy.get(code).level === ISSUE_LEVEL).sort(byTaxonomyOrder(model.taxonomy));
  distribute(level1, 1, []);
  // 最後權重：根題份額依本題占同一根題的比例拆給各題，比例只算本次出現的題目
  const { groupOf, shares } = groupShares(model, items.map((item) => item.id));
  const weights = new Map(items.map((item) => [item.id, (rootShares.get(groupOf.get(item.id)) ?? 0) * shares.get(item.id)]));
  return { weights, nodeShares, groupOf };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { questionWeights, groupShares, importanceOf };
