/* ==================================================
 * lib/geometry.js - 共用弧線的合併
 * --------------------------------------------------
 * - 角色：把整數差分的弧線還原成座標，把一組環合併成外框，寫成 SVG 路徑
 * - 指令：import { decodeArcs, mergedPath } from "../lib/geometry.js"
 * - 慣例：
 *   - 弧線是 [x0, y0, dx1, dy1, ...] 的整數，單位是 10 的 -digits 次方
 *   - 環是帶方向的弧線索引，~i 表示第 i 條弧線反向使用
 *   - 合併只看拓撲：同一組環中只用到一次的弧線是外框，用到兩次的是內部的共用邊
 *   - 外環與內環方向相反，路徑以 nonzero 填色
 * ================================================== */

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 弧線索引對應的弧線編號，反向使用的 ~i 與 i 是同一條弧線。
 * @param {number} index 弧線索引。
 * @returns {number}
 */
function arcNumber(index) {
  // 負數以位元反轉還原成弧線編號
  return index >= 0 ? index : ~index;
}

/**
 * 依方向取出一條弧線的點。
 * @param {number} index 弧線索引。
 * @param {number[][][]} arcs 還原後的弧線。
 * @returns {number[][]}
 */
function directed(index, arcs) {
  // 反向使用時點序反轉
  return index >= 0 ? arcs[index] : [...arcs[~index]].reverse();
}

/**
 * 把只用到一次的弧線接成閉合的環。
 * @param {number[]} boundary 外框的弧線索引，保留原本的方向。
 * @param {number[][][]} arcs 還原後的弧線。
 * @returns {number[][][]} 每個環的點，不含回到起點的終點。
 */
function chain(boundary, arcs) {
  const starts = new Map();
  // 依起點索引外框弧線，接環時由終點找下一條
  for (const index of boundary) {
    const key = directed(index, arcs)[0].join(",");
    starts.set(key, [...(starts.get(key) ?? []), index]);
  }
  // 記下已經接進環的弧線，每條外框弧線只用一次
  const used = new Set();
  const rings = [];
  // 每次從還沒用過的弧線起筆，接到回到起點為止
  for (const first of boundary) {
    // 已經接進前面某個環的弧線不再起筆
    if (used.has(first)) continue;
    used.add(first);
    // 起筆弧線的起點是這個環的終點
    const points = [...directed(first, arcs)];
    const origin = points[0].join(",");
    // 終點回到起點時這個環閉合，來源的拓撲完整時一定接得回來
    while (points.at(-1).join(",") !== origin) {
      const next = (starts.get(points.at(-1).join(",")) ?? []).find((index) => !used.has(index));
      // 接不上時是損壞的資料，留下已接的部分
      if (next === undefined) break;
      used.add(next);
      // 起點與上一條的終點相同，略過
      points.push(...directed(next, arcs).slice(1));
    }
    rings.push(points.slice(0, -1));
  }
  return rings;
}

/**
 * 環的帶號面積，正負號表示環的方向。
 * @param {number[][]} points 環的點。
 * @returns {number}
 */
function signedArea(points) {
  let sum = 0;
  // 鞋帶公式，最後一點接回第一點
  points.forEach(([ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length];
    sum += ax * by - bx * ay;
  });
  return sum / 2;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 把整數差分的弧線還原成整數座標。
 * @param {number[][]} encoded 每條弧線是 [x0, y0, dx1, dy1, ...]。
 * @returns {number[][][]} 每條弧線的點。
 */
function decodeArcs(encoded) {
  return encoded.map((flat) => {
    // 第一點從 0 累加就是絕對座標，其後逐點累加差值
    const points = [];
    let x = 0;
    let y = 0;
    // 每兩個數字是一點
    for (let index = 0; index < flat.length; index += 2) {
      x += flat[index];
      y += flat[index + 1];
      // 累加後的整數座標
      points.push([x, y]);
    }
    return points;
  });
}

/**
 * 把一組環合併後寫成 SVG 路徑。
 * @param {number[][]} rings 環的串列，環是帶方向的弧線索引。
 * @param {number[][][]} arcs decodeArcs 還原的弧線。
 * @param {number} digits 座標的小數位數。
 * @returns {string} 每個外框環一個以 M 起筆、l 寫相對位移、z 閉合的子路徑。
 */
function mergedPath(rings, arcs, digits) {
  const indexes = rings.flat();
  const counts = new Map();
  // 計算每條弧線出現的次數，相鄰兩個村里的共用邊會出現兩次
  for (const index of indexes) counts.set(arcNumber(index), (counts.get(arcNumber(index)) ?? 0) + 1);
  // 整數座標除以 10 的 digits 次方換回螢幕座標，toFixed 去掉浮點誤差
  const scale = 10 ** digits;
  const number = (value) => String(Number((value / scale).toFixed(digits)));
  // 只用到一次的弧線是外框
  return chain(indexes.filter((index) => counts.get(arcNumber(index)) === 1), arcs)
    // 面積小於一個座標單位的環看不見，方向也不可靠，不畫
    .filter((points) => Math.abs(signedArea(points)) >= scale)
    // 第一點寫絕對座標，其後寫與前一點的差
    .map((points) => {
      // 差值由整數座標相減，不會累積誤差
      const steps = points.slice(1).map(([x, y], index) => `${number(x - points[index][0])} ${number(y - points[index][1])}`);
      return `M${number(points[0][0])} ${number(points[0][1])}l${steps.join(" ")}z`;
    })
    .join("");
}

/* ==================================================
 * 匯出
 * ================================================== */

export { decodeArcs, mergedPath };
