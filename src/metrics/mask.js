/* ==================================================
 * metrics/mask.js - 翻牌前的遮蔽
 * --------------------------------------------------
 * - 角色：把原文中的姓名、黨名、暱稱與識別字換成遮蔽標記，並決定翻牌前候選人的代號順序
 * - 指令：import { maskText, maskIndex } from "../metrics/mask.js"
 * - 慣例：
 *   - 遮蔽詞與替換字取自模型的 maskTerms 與 mask-categories.tsv，程式不寫死任何人名或黨名
 *   - 長詞先替換，例如「甲乙丙黨」先於「乙丙黨」，短詞不會切斷長詞
 *   - 代號順序依模型的 maskOrder，與號次無關
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 遮蔽一段文字。
 * @param {object} model 資料模型。
 * @param {string} textContent 原文。
 * @returns {string}
 */
function maskText(model, textContent) {
  let result = textContent ?? "";
  // 依長度由長到短逐詞替換
  for (const { term, category } of model.maskTerms) result = result.split(term).join(model.maskReplacements.get(category) ?? "");
  return result;
}

/**
 * 取得候選人在遮蔽順序中的位置。
 * @param {object} model 資料模型。
 * @param {string} entityId 候選人。
 * @param {string[]} entityIds 同選區的候選人，代號只在選區內排序。
 * @returns {number} 從 0 起算。候選人不在 entityIds 時拋出錯誤。
 */
function maskIndex(model, entityId, entityIds) {
  const order = model.maskOrder.filter((id) => entityIds.includes(id));
  const index = order.indexOf(entityId);
  // 候選人不在這個選區時沒有代號，代號與色票都會錯，是呼叫端的錯誤
  if (index < 0) throw new Error(`候選人 ${entityId} 不在目前的選區`);
  return index;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { maskText, maskIndex };
