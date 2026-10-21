/* ==================================================
 * cards/series.js - 候選人的系列色與翻牌後的配色
 * --------------------------------------------------
 * - 角色：決定每位候選人使用哪一個色票序號，以及翻牌後每位候選人的顏色，圖表、勾選列、外框與分享圖片共用
 * - 指令：import { colorOf, byMaskOrder } from "./series.js"
 * - 慣例：
 *   - 色票序號依遮蔽順序指定，與號次、政黨無關。序號 0 保留給使用者
 *   - 翻牌前沒有政黨配色，顏色不能洩漏身分
 *   - 翻牌後依候選人配色，不依序號：候選人多於色票數時，兩位會共用同一個序號
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { clamp } from "../lib/format.js";
import { maskIndex } from "../metrics/index.js";
import { partyOf } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * oklch 色彩字串的格式：亮度百分比、彩度、色相。
 */
const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/;

/**
 * 每份卡片情境的翻牌配色，同一次繪製只計算一次。
 */
const PALETTES = new WeakMap();

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依遮蔽順序排列候選人，與色票序號的順序相同。
 * @param {object} context 卡片情境。
 * @param {{ id: string }[]} list 候選人或計分結果的列。
 * @returns {{ id: string }[]} 排序後的新陣列。
 */
function byMaskOrder(context, list) {
  return [...list].sort((a, b) => maskIndex(context.model, a.id, context.entityIds) - maskIndex(context.model, b.id, context.entityIds));
}

/**
 * 候選人在區塊描述裡的顏色：色票序號，以及翻牌後的配色。
 * @param {object} context 卡片情境。
 * @param {string} id 候選人。
 * @returns {{ series: number, mark: { light: string, dark: string }|null }} mark 在翻牌前為 null。
 */
function colorOf(context, id) {
  // 色票序號依遮蔽順序從 1 起算，候選人多於色票數時循環使用
  const series = (maskIndex(context.model, id, context.entityIds) % SETTINGS.charts.seriesCount) + 1;
  return { series, mark: revealPalette(context)?.get(id) ?? null };
}

/**
 * 翻牌後每位候選人的顏色，淺色與深色主題各一個值，由 CSS 依主題選用。配色規則見 DESIGN.md 的 Colors。
 * @param {object} context 卡片情境。
 * @returns {Map<string, { light: string, dark: string }>|null} 鍵是候選人代碼，翻牌前為 null。
 */
function revealPalette(context) {
  // 翻牌前維持中立色，顏色不能洩漏身分
  if (!context.revealed) return null;
  // 同一份情境只計算一次，每張卡片的每位候選人都會查詢
  if (PALETTES.has(context)) return PALETTES.get(context);
  const reveal = SETTINGS.charts.reveal;
  // 依遮蔽順序配色，與色票序號的順序相同
  const ordered = byMaskOrder(context, context.entities);
  const palette = new Map();
  const counts = new Map();
  // 依遮蔽順序分配政黨色，同黨的第幾位決定亮度的調整
  for (const entity of ordered) {
    const party = partyOf(context, entity.id);
    // 政黨表沒有圖表色的黨改用中立色
    if (!party.mark || !party.series) continue;
    // 同黨的第幾位，第一位使用政黨色本身
    const rank = counts.get(party.name) ?? 0;
    counts.set(party.name, rank + 1);
    palette.set(entity.id, shade(party.mark, reveal.shades[rank % reveal.shades.length]));
  }
  // 已使用的政黨色相，中立色要避開
  const used = [...palette.values()].map((mark) => parseOklch(mark.light)?.hue).filter((hue) => hue !== undefined);
  // 其餘候選人依遮蔽順序逐位選取色相
  for (const entity of ordered) {
    // 已有政黨色的候選人略過
    if (palette.has(entity.id)) continue;
    const hue = farthestHue(used, reveal.hueStep);
    // 選取過的色相列為已使用，下一位避開
    used.push(hue);
    palette.set(entity.id, { light: formatOklch({ ...reveal.neutral.light, hue }), dark: formatOklch({ ...reveal.neutral.dark, hue }) });
  }
  // 記錄這份情境的配色，之後的查詢直接取用
  PALETTES.set(context, palette);
  return palette;
}

/* ==================================================
 * 色彩換算
 * ================================================== */

/**
 * 解析 oklch 色彩字串。
 * @param {string} text 例如 `oklch(45% 0.17 265)`。
 * @returns {{ lightness: number, chroma: number, hue: number }|null} 不是 oklch 格式時為 null。
 */
function parseOklch(text) {
  const match = OKLCH.exec(text.trim());
  // 色票不是 oklch 格式時無法換算
  if (!match) return null;
  return { lightness: Number(match[1]), chroma: Number(match[2]), hue: Number(match[3]) };
}

/**
 * 組成 oklch 色彩字串。
 * @param {{ lightness: number, chroma: number, hue: number }} color 亮度百分比、彩度與色相。
 * @returns {string}
 */
function formatOklch({ lightness, chroma, hue }) {
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

/**
 * 政黨色調整亮度，淺色與深色各自調整，結果限制在 `charts.reveal.lightnessRange` 內。
 * @param {{ light: string, dark: string }} mark 政黨色。
 * @param {number} offset 亮度的增減，單位是百分點。
 * @returns {{ light: string, dark: string }}
 */
function shade(mark, offset) {
  const [low, high] = SETTINGS.charts.reveal.lightnessRange;
  // 淺色與深色主題的值各自換算
  const adjust = (text) => {
    const color = parseOklch(text);
    // 無法換算的色票依原值使用
    if (!color) return text;
    return formatOklch({ ...color, lightness: clamp(color.lightness + offset, low, high) });
  };
  return { light: adjust(mark.light), dark: adjust(mark.dark) };
}

/**
 * 色環上離已使用色相最遠的色相，以固定間隔取樣，距離相同時選擇角度較小的。
 * @param {number[]} used 已使用的色相。
 * @param {number} step 取樣間隔的度數。
 * @returns {number} 沒有已使用色相時為 0。
 */
function farthestHue(used, step) {
  let best = 0;
  let bestGap = -1;
  // 逐一取樣，保留與最近的已使用色相距離最大的一個
  for (let hue = 0; hue < 360; hue += step) {
    // 與每個已使用色相在色環上的距離，選取兩個方向中較短的一邊
    const gaps = used.map((other) => Math.abs(hue - other) % 360).map((gap) => Math.min(gap, 360 - gap));
    // 還沒有已使用色相時每個取樣一樣遠
    const gap = gaps.length > 0 ? Math.min(...gaps) : 360;
    // 距離相同時保留先取樣的，結果固定
    if (gap > bestGap) {
      best = hue;
      bestGap = gap;
    }
  }
  return best;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { colorOf, byMaskOrder };
