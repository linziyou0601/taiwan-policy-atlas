/* ==================================================
 * blocks/art.jsx - 品牌標誌、首頁插圖與議題圖示
 * --------------------------------------------------
 * - 角色：以 SVG 元件繪製品牌標誌、首頁插圖與第 1 層議題的圖示，形狀依品牌 icon 的風格，顏色取自 tokens，淺深主題自動換色
 * - 指令：import { BrandMark, LandingArt, IssueIcon } from "./art.jsx"
 * - 慣例：
 *   - 圖形以 `fill-*` 與 `stroke-*` 的 token 類別上色，色碼寫在 styles.css。插圖與圖示是裝飾，標為 aria-hidden，議題名稱由文字呈現
 *   - 議題圖示的線條用 `currentColor`，顏色由外層的文字色決定
 *   - 標誌與議題圖示的路徑寫在 icons.js
 * ================================================== */

import { ISSUE_ICONS, FALLBACK_ICON, BRAND_MARK } from "./icons.js";
import { PathIcon } from "./ui.jsx";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 品牌標誌：圓角方塊上的摺頁地圖與定位點。
 * @param {{ size?: string }} props size 是尺寸類別，預設 size-8。
 * @returns {JSX.Element}
 */
function BrandMark({ size = "size-8" }) {
  return (
    <svg viewBox="0 0 64 64" class={size} aria-hidden="true">
      <rect width="64" height="64" rx={BRAND_MARK.radius} class="fill-accent" />
      <path d={BRAND_MARK.map} fill="none" stroke-width={BRAND_MARK.stroke} stroke-linecap="round" stroke-linejoin="round" class="stroke-on-accent" />
      <circle cx={BRAND_MARK.pin.cx} cy={BRAND_MARK.pin.cy} r={BRAND_MARK.pin.r} class="fill-accent-soft" />
    </svg>
  );
}

/**
 * 首頁插圖：圓形底、虛線路徑、傾斜的問卷卡、勾選圓與加號圓。
 * @returns {JSX.Element}
 */
function LandingArt() {
  return (
    <svg viewBox="0 0 520 540" class="h-auto w-full" aria-hidden="true">
      <ellipse cx="268" cy="278" rx="221" ry="232" class="fill-sunken" />
      <path d="M113 168Q268 60 401 214T151 426Q50 301 320 125" fill="none" stroke-width="2" stroke-dasharray="5 8" class="stroke-baseline" />
      {/* 傾斜的問卷卡：底下一層陰影卡、上面一層卡面，卡面上有標題線、房屋與勾選圖示 */}
      <g transform="rotate(-9 260 270)">
        <rect x="126" y="117" width="276" height="328" rx="25" class="fill-border" />
        <rect x="112" y="103" width="276" height="328" rx="25" class="fill-surface stroke-border" />
        <path d="M148 155h113m-113 18h80" stroke-width="7" stroke-linecap="round" class="stroke-border" />
        <g fill="none" stroke-width="2.5" stroke-linejoin="round" class="stroke-accent">
          <path d="m156 255 43-36 43 36m-73-9v55h60v-55m-39 55v-33h20v33" />
          <rect x="152" y="331" width="26" height="26" rx="8" />
          <path d="m158 344 6 6 9-14m25 7h116m-116 30h85" stroke-linecap="round" />
        </g>
        <circle cx="315" cy="240" r="32" class="fill-accent-soft" />
        <path d="M302 250q31-10 22-33-27 1-22 33Zm0 0 17-22" fill="none" stroke-width="2.5" class="stroke-accent" />
      </g>
      {/* 卡片外的勾選圓與加號圓 */}
      <circle cx="402" cy="369" r="49" class="fill-accent" />
      <path d="m380 369 15 15 29-32" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" class="stroke-on-accent" />
      <circle cx="111" cy="138" r="22" class="fill-baseline" />
      <path d="M111 126v24m-12-12h24" stroke-width="3" stroke-linecap="round" class="stroke-surface" />
    </svg>
  );
}

/**
 * 議題圖示：強調色淺底的圓形，中間是線條圖示。
 * @param {{ code: string, size?: string }} props code 是第 1 層議題代碼，size 是外圓的尺寸類別，預設 size-10。
 * @returns {JSX.Element}
 */
function IssueIcon({ code, size = "size-10" }) {
  // 代碼不在圖示表時畫替代圖形
  const paths = ISSUE_ICONS[code] ?? FALLBACK_ICON;
  return (
    <span class={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ${size}`} aria-hidden="true">
      <PathIcon paths={paths} size="size-[55%]" />
    </span>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { BrandMark, LandingArt, IssueIcon };
