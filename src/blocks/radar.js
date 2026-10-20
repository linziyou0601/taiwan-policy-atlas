/* ==================================================
 * blocks/radar.js - 雷達圖的幾何
 * --------------------------------------------------
 * - 角色：雷達圖各軸上點的座標與軸標籤的對齊方式，網頁的 SVG 雷達圖與分享圖片的畫布共用
 * - 指令：import { radarGeometry } from "./radar.js"
 * - 慣例：第一軸朝正上方，其餘依軸數等分圓周順時針排列
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 標籤與圓心的水平距離小於這個值（座標單位）時視為在正上方或正下方，標籤置中。
 */
const CENTER_TOLERANCE = 4;

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依軸數、圓心與半徑算出雷達圖的幾何。
 * @param {number} count 軸數。
 * @param {number} cx 圓心的 x。
 * @param {number} cy 圓心的 y。
 * @param {number} radius 最外圈的半徑。
 * @returns {{ point: (index: number, ratio: number) => [number, number], side: (x: number) => "middle"|"start"|"end" }} point 是第 index 軸上比例 ratio 的點，side 是位在 x 的標籤以哪一側貼齊位置。
 */
function radarGeometry(count, cx, cy, radius) {
  /**
   * 第 index 軸上比例 ratio 的點，ratio 為 1 時在最外圈。
   * @param {number} index 軸的序號。
   * @param {number} ratio 0 到 1，可以超過 1 放標籤。
   * @returns {[number, number]}
   */
  const point = (index, ratio) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio];
  };
  /**
   * 標籤的位置：圓心正上下方的標籤置中，右半邊的標籤從位置往右寫，左半邊的往左寫，文字都往圖外延伸。
   * @param {number} x 標籤的 x。
   * @returns {"middle"|"start"|"end"}
   */
  const side = (x) => (Math.abs(x - cx) < CENTER_TOLERANCE ? "middle" : x > cx ? "start" : "end");
  return { point, side };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { radarGeometry };
