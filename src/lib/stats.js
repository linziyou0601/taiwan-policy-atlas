/* ==================================================
 * lib/stats.js - 統計與亂數
 * --------------------------------------------------
 * - 角色：敏感度分析用的可重現亂數、Kendall τ-b、分位數與加權平均
 * - 指令：import { mulberry32, kendallTauB, quantile, weightedMean } from "../lib/stats.js"
 * - 慣例：亂數一律由種子產生，同一組設定重新執行得到同一組結果，分享的連結才能重現
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 以種子建立亂數產生器（mulberry32）。
 * @param {number} seed 32 位元整數種子。
 * @returns {() => number} 每次呼叫回傳 [0, 1) 的亂數。
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    // mulberry32 的位元混合步驟，常數取自原始演算法
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 計算兩組分數的 Kendall τ-b 等級相關。
 * τ-b = (C - D) / √((n0 - n1)(n0 - n2))，n1、n2 是兩組各自的同分對數，同分不算一致也不算不一致。
 * @param {number[]} first 第一組分數。
 * @param {number[]} second 第二組分數，與第一組逐項對應。
 * @returns {number|null} -1 到 1，兩組任一組全部同分時為 null。
 */
function kendallTauB(first, second) {
  let concordant = 0;
  let discordant = 0;
  // 一致、不一致與兩組的同分對分開計數，tau-b 的分母要扣除同分對
  let tiesFirst = 0;
  let tiesSecond = 0;
  const count = first.length;
  // 逐對比較兩組的大小關係
  for (let i = 0; i < count; i += 1) {
    // 只比較 i < j 的配對，每對算一次
    for (let j = i + 1; j < count; j += 1) {
      const a = Math.sign(first[i] - first[j]);
      const b = Math.sign(second[i] - second[j]);
      // 第一組同分，計入第一組的同分對
      if (a === 0) tiesFirst += 1;
      // 第二組同分，計入第二組的同分對
      if (b === 0) tiesSecond += 1;
      // 兩組都不同分時才分一致與不一致
      if (a !== 0 && b !== 0) {
        // 方向相同為一致，相反為不一致
        if (a === b) concordant += 1;
        // 其餘情形是方向相反，計為不一致
        else discordant += 1;
      }
    }
  }
  const pairs = (count * (count - 1)) / 2;
  // 總對數扣除各組的同分對才是 tau-b 的分母
  const denominator = Math.sqrt((pairs - tiesFirst) * (pairs - tiesSecond));
  // 分母為 0 表示有一組完全同分，相關係數沒有定義
  return denominator === 0 ? null : (concordant - discordant) / denominator;
}

/**
 * 計算分位數（線性內插）。
 * @param {number[]} values 數值。
 * @param {number} q 0 到 1 的分位。
 * @returns {number|null} 沒有數值時為 null。
 */
function quantile(values, q) {
  // 沒有數值時沒有分位數
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  // 分位數落在兩個排序值之間，需要上下兩個索引做線性內插
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  // 位置落在兩個值之間時線性內插
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * 加權平均：Σ(權重 × 值) / Σ(權重)。
 * @param {{ weight: number, value: number }[]} items 各筆的權重與值。
 * @returns {number|null} 權重合計不大於 0 時沒有平均，為 null。
 */
function weightedMean(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  // 沒有權重時沒有平均可言
  if (total <= 0) return null;
  return items.reduce((sum, item) => sum + item.weight * item.value, 0) / total;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { mulberry32, kendallTauB, quantile, weightedMean };
