/* ==================================================
 * metrics/ideology.js - 意識形態軸
 * --------------------------------------------------
 * - 角色：依 question-axes 的方向與權重，把使用者的答案與候選人的立場推算成各軸上的位置。軸取自模型的 axes，選舉是設定表的軸，主題測驗是資料集的軸
 * - 指令：import { axisPositions } from "../metrics/ideology.js"
 * - 慣例：
 *   - 位置 = Σ(方向 × 權重 × 比例 × 值) / (2 × Σ 權重 × 比例)，值是 -2 到 2 的作答或立場，結果在 -1 到 1，再換算到 settings.ideology 的範圍
 *   - 比例是這題占同一根題底下已作答題目的預算比例，一組母子題在軸上只算一題的分量，追問出現時不會加重這一組。議題重視度不影響軸位置
 *   - 使用者與候選人用同一組題目：使用者已作答的題目。候選人未表態的題目不計入該候選人的分母
 *   - 一軸沒有任何可用的題目時位置為 null，雷達圖不繪製那一點
 *   - 沒有軸對應的題目（例如主題測驗的單選題）不影響任何一軸
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { hasValue } from "../lib/objects.js";
import { isStated } from "./flow.js";
import { groupShares } from "./weights.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把 -1 到 1 換算到顯示範圍。
 * @param {number} value -1 到 1。
 * @returns {number}
 */
function toRange(value) {
  const { min, max } = SETTINGS.ideology;
  return min + ((value + 1) / 2) * (max - min);
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 計算使用者與各候選人在各軸上的位置。
 * @param {object} input 計算輸入。
 * @param {object} input.model 資料模型。
 * @param {string[]} input.questionIds 本次出現的題目。
 * @param {Record<string, { answer: string }>} input.answers 答案。
 * @param {Map<string, Map<string, { value: number|null }>>} input.stances 立場矩陣。
 * @returns {{ axes: object[], user: Map<string, number|null>, entities: Map<string, Map<string, number|null>>, used: Map<string, string[]> }}
 */
function axisPositions({ model, questionIds, answers, stances }) {
  const axes = model.axes;
  const answered = questionIds.filter((id) => isStated(answers[id]));
  // 一組母子題共用一份，比例只在已作答的題目間分配，略過的追問不占份額
  const { shares } = groupShares(model, answered);
  // 每條軸先備好空的清單與累計值，沒有題目對應的軸之後會得到沒有定義的位置
  const used = new Map(axes.map((axis) => [axis.code, []]));
  const userSums = new Map(axes.map((axis) => [axis.code, { sum: 0, weight: 0 }]));
  const entitySums = new Map([...stances.keys()].map((id) => [id, new Map(axes.map((axis) => [axis.code, { sum: 0, weight: 0 }]))]));
  // 逐題把作答與立場累加到對應的軸，沒有軸對應的題目略過
  for (const questionId of answered.filter((id) => model.axesByQuestion.has(id))) {
    const answer = model.answers.get(answers[questionId].answer).value;
    // 一題可以對應多條軸
    for (const link of model.axesByQuestion.get(questionId)) {
      // 軸對應的權重乘上這題在同一根題底下的比例
      const weight = link.weight * shares.get(questionId);
      const user = userSums.get(link.axis);
      user.sum += link.direction * weight * answer;
      // 權重一併累加，之後以加權平均換算成軸上的位置
      user.weight += weight;
      used.get(link.axis).push(questionId);
      // 每位候選人只在已表態時累加
      for (const [entityId, row] of stances) {
        const stance = row.get(questionId)?.value;
        // 未表態不計入這位候選人的分母
        if (!hasValue(stance)) continue;
        const target = entitySums.get(entityId).get(link.axis);
        target.sum += link.direction * weight * stance;
        // 分母只累加候選人已表態的題目，與使用者的分母各自獨立
        target.weight += weight;
      }
    }
  }
  /**
   * 把累計值換算成位置。
   * @param {{ sum: number, weight: number }} acc 累計值。
   * @returns {number|null}
   */
  const position = (acc) => (acc.weight > 0 ? toRange(acc.sum / (model.scaleEnd * acc.weight)) : null);
  return {
    axes,
    user: new Map([...userSums].map(([code, acc]) => [code, position(acc)])),
    entities: new Map([...entitySums].map(([id, sums]) => [id, new Map([...sums].map(([code, acc]) => [code, position(acc)]))])),
    used,
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { axisPositions };
