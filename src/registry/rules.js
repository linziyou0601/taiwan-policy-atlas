/* ==================================================
 * registry/rules.js - 契合度、立場彙總與共識判定
 * --------------------------------------------------
 * - 角色：計分中可以替換的三種規則，由 settings.scoring 的 agreement、stanceAggregate、consensusRule 選用
 * - 指令：由 registry/index.js 登錄，不直接匯入
 * - 慣例：作答與立場都在 -2 到 2 的五級量尺上，未表態不進入這些規則，由呼叫端另算涵蓋率
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 量尺距離：1 - |使用者 - 候選人| ÷ 量尺兩端的距離。五級量尺的兩端是 -2 與 2，距離是 4。
 * @param {number} user 使用者作答，在 -end 到 end 之間。
 * @param {number} candidate 候選人立場，同一個範圍，可以是彙總後的小數。
 * @param {{ end: number }} scale 量尺端點的絕對值，由量尺表推出。
 * @returns {number} 0 到 1。
 */
function linearDistance(user, candidate, scale) {
  return 1 - Math.abs(user - candidate) / (2 * scale.end);
}

/**
 * 方向一致：同方向為 1、相反為 0，任一方中立為 0.5。強度不計，非常同意與同意算同一個方向。
 * @param {number} user 使用者作答。
 * @param {number} candidate 候選人立場。
 * @returns {number} 0、0.5 或 1。
 */
function sameDirection(user, candidate) {
  const product = Math.sign(user) * Math.sign(candidate);
  // 任一方中立時方向無法比較，記為一半
  if (product === 0) return 0.5;
  // 同號為一致，異號為相反
  return product > 0 ? 1 : 0;
}

/**
 * 加權平均：Σ(權重 × 立場) / Σ(權重)。
 * @param {{ weight: number, value: number }[]} items 一位候選人對一題的各筆配題。
 * @returns {number|null} 權重合計為 0 時為 null，表示未表態。
 */
function weightedMean(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  // 權重合計為 0（例如只有新聞來源）時視為未表態
  if (total <= 0) return null;
  return items.reduce((sum, item) => sum + item.weight * item.value, 0) / total;
}

/**
 * 取權重最大的一筆，權重相同時取絕對值較大的立場。
 * @param {{ weight: number, value: number }[]} items 各筆配題。
 * @returns {number|null}
 */
function strongestEvidence(items) {
  const usable = items.filter((item) => item.weight > 0);
  // 沒有可用的配題時未表態
  if (!usable.length) return null;
  const best = usable.reduce((top, item) => {
    // 權重較大者優先，相同時比立場強度
    const better = item.weight > top.weight || (item.weight === top.weight && Math.abs(item.value) > Math.abs(top.value));
    // 權重與強度都相同時保留先出現的一筆，資料集的配題順序固定，結果可以重現
    return better ? item : top;
  });
  return best.value;
}

/**
 * 同方向共識：至少兩位已表態，且全部同為正或同為負。
 * @param {number[]} stances 已表態候選人的立場。
 * @returns {boolean}
 */
function sameDirectionConsensus(stances) {
  // 少於兩位表態時談不上共識
  if (stances.length < 2) return false;
  return stances.every((value) => value > 0) || stances.every((value) => value < 0);
}

/**
 * 不標共識題，全部題目都參與排序。
 * @returns {boolean}
 */
function noConsensus() {
  return false;
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 契合度登錄表。
 */
const AGREEMENTS = {
  linearDistance: linearDistance,
  sameDirection: sameDirection,
};

/**
 * 立場彙總登錄表。
 */
const AGGREGATES = {
  weightedMean: weightedMean,
  strongestEvidence: strongestEvidence,
};

/**
 * 共識判定登錄表。
 */
const CONSENSUS_RULES = {
  sameDirection: sameDirectionConsensus,
  none: noConsensus,
};

export { AGREEMENTS, AGGREGATES, CONSENSUS_RULES };
