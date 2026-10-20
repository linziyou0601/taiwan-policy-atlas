/* ==================================================
 * registry/distances.js - 參照點距離
 * --------------------------------------------------
 * - 角色：主題測驗以距離找出最接近使用者的參照點，題組的資料集以 distance 宣告使用哪一個
 * - 指令：由 registry/index.js 登錄，不直接匯入
 * - 慣例：只比使用者有位置的軸，一軸沒有任何作答時不計入距離，全部軸都沒有位置時距離為 null
 * ================================================== */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 次方和：Σ |使用者 - 參照點|^次方，每條軸的次方寫在題組的軸設定。
 * @param {Map<string, number|null>} user 使用者在各軸的位置。
 * @param {Record<string, number>} reference 參照點在各軸的位置。
 * @param {{ code: string, power: number }[]} axes 軸。
 * @returns {number|null}
 */
function powerSum(user, reference, axes) {
  // 只取使用者有位置的軸
  const used = axes.filter((axis) => user.get(axis.code) !== null && user.get(axis.code) !== undefined);
  // 沒有任何一軸可比時無法計算距離
  if (!used.length) return null;
  return used.reduce((sum, axis) => sum + Math.abs(user.get(axis.code) - reference[axis.code]) ** axis.power, 0);
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 參照點距離登錄表。
 */
const DISTANCES = {
  powerSum: powerSum,
};

export { DISTANCES };
