/* ==================================================
 * blocks/ui.jsx - 顯示層共用的元件
 * --------------------------------------------------
 * - 角色：介面圖示、按鈕、收合面板、標籤、政黨標記、系列色塊與 info 按鈕的 Preact 元件，以及 tone 對應的類別，各區塊共用同一套寫法
 * - 指令：import { Icon, Button, Disclosure, Badge, PartyMark, Swatch, InfoButton, TONES } from "./ui.jsx"
 * - 慣例：
 *   - 會改到網站狀態的互動一律設定 data-action，由 app 層委派處理。只影響元件自己畫面的互動（例如縮放）才以 onClick 綁在元件上
 *   - 顏色只用 styles.css 定義的 token 類別，字級只用 text-* 級距
 * ================================================== */

import { text } from "../config/index.js";
import { UI_ICONS } from "./icons.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 按鈕樣式：accent 是主要動作，neutral 是次要動作，quiet 是不搶眼的動作。
 */
const BUTTON_TONES = {
  accent: "border-accent bg-accent text-on-accent hover:opacity-90",
  neutral: "border-border bg-surface text-ink hover:bg-sunken",
  quiet: "border-transparent text-ink-secondary hover:bg-sunken",
};

/**
 * 按鈕的尺寸：md 用在內容區，sm 用在頁首、常駐列這類與切換鈕並排的位置，高度與切換鈕一致。
 * 只有圖示的按鈕寬度等於高度，phone 是手機只繪製圖示、平板起加上文字的寬度。
 */
const BUTTON_SIZES = {
  md: { text: "h-10 px-4 text-sm", icon: "size-10", phone: "size-10 sm:w-auto sm:px-4 text-sm" },
  sm: { text: "h-8 px-3 text-xs", icon: "size-8", phone: "size-8 sm:w-auto sm:px-3 text-xs" },
};

/**
 * 提示與標籤的 tone 對應類別。good、warning、critical 只用於判斷結果。
 */
const TONES = {
  neutral: "bg-sunken text-ink-secondary",
  accent: "bg-accent-soft text-accent",
  good: "bg-sunken text-good",
  warning: "bg-sunken text-warning",
  critical: "bg-sunken text-critical",
};

/**
 * 按鈕共用的類別。
 */
const BUTTON_BASE = "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 介面圖示：線條圖示，顏色跟著文字色。
 * @param {{ name: string, size?: string }} props name 是 UI_ICONS 的鍵，size 是尺寸類別，預設 size-4。
 * @returns {JSX.Element}
 */
function Icon({ name, size = "size-4" }) {
  const paths = UI_ICONS[name];
  // 名稱沒有登錄是程式錯誤，直接拋出讓開發時發現
  if (!paths) throw new Error(`沒有登錄圖示 ${name}`);
  return (
    <svg viewBox="0 0 24 24" class={`${size} shrink-0`} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * 按鈕。卡片描述的按鈕項目直接展開成屬性傳入。
 * @param {{ label: string, action?: string|null, onClick?: Function|null, tone?: string, size?: string, disabled?: boolean, pressed?: boolean, tip?: string, icon?: string, iconOnly?: boolean|"phone", trailing?: boolean, extra?: string }} props 按鈕描述。size 是 BUTTON_SIZES 的鍵，預設 md。icon 是 UI_ICONS 的名稱。iconOnly 為 true 時只繪製圖示，為 "phone" 時只在手機繪製圖示，文字改寫在 aria-label 與滑過的說明。trailing 時圖示放在文字後面。extra 是額外的類別。onClick 只給元件自己的畫面狀態用（例如縮放），會改變網站狀態的動作一律寫 action。
 * @returns {JSX.Element}
 */
function Button({ label, action = null, onClick = null, tone, size = "md", disabled = false, pressed, tip = null, icon = null, iconOnly = false, trailing = false, extra = "" }) {
  // 只有圖示的按鈕是正方形，文字放進 aria-label 與說明。iconOnly 為 "phone" 時只有手機是正方形，平板起照常寫出文字
  const shape = BUTTON_SIZES[size][iconOnly === "phone" ? "phone" : iconOnly ? "icon" : "text"];
  // 沒有動作也沒有 onClick 的按鈕一律停用，避免畫面上出現看似可點卻沒有作用的控制項。有指定按下狀態時才設定 aria-pressed
  return (
    <button type="button" class={`${BUTTON_BASE} ${BUTTON_TONES[tone ?? "neutral"]} ${shape} ${extra}`} data-action={action} onClick={onClick} data-tip={tip ?? (iconOnly ? label : null)} aria-label={iconOnly ? label : null} disabled={disabled || (!action && !onClick)} aria-pressed={pressed === undefined ? null : String(pressed)}>
      {/* 圖示預設在文字前面，「下一步」這類往前的動作放在後面 */}
      {icon && !trailing ? <Icon name={icon} /> : null}
      {/* 只有圖示時不寫文字，手機限定時文字在平板起才出現 */}
      {iconOnly === true ? null : <span class={iconOnly === "phone" ? "hidden sm:inline" : ""}>{label}</span>}
      {icon && trailing ? <Icon name={icon} /> : null}
    </button>
  );
}

/**
 * 收合面板：整列可點的標題列，右側的箭頭在展開時轉向，瀏覽器內建的三角形不顯示。
 * box 是有外框的面板，展開的內容以分隔線與標題列分開。inline 是放在內容中的小型收合列。
 * @param {{ summary: string, open?: boolean, variant?: string, children: unknown }} props summary 是標題列的文字，open 是預設展開，variant 是 box 或 inline，預設 box。
 * @returns {JSX.Element}
 */
function Disclosure({ summary, open = false, variant = "box", children }) {
  const box = variant === "box";
  // box 與 inline 共用同一套標題列。箭頭只看自己這一層 details 的展開狀態，巢狀在已展開的面板裡也不會跟著轉
  return (
    <details class={box ? "rounded-lg border border-border bg-surface" : ""} open={open}>
      <summary class={`flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden ${box ? "rounded-lg px-4 py-3 text-sm font-medium text-ink hover:bg-sunken" : "text-xs text-ink-muted hover:text-ink"}`}>
        {summary}
        <span class="text-ink-muted transition-transform [details[open]>summary>&]:rotate-180">
          <Icon name="chevronDown" size={box ? "size-4" : "size-3.5"} />
        </span>
      </summary>
      <div class={box ? "border-t border-border" : "mt-2"}>{children}</div>
    </details>
  );
}

/**
 * 標籤。
 * @param {{ label: string, tone?: string }} props label 是文字，tone 是 TONES 的鍵。
 * @returns {JSX.Element}
 */
function Badge({ label, tone = "neutral" }) {
  return <span class={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.neutral}`}>{label}</span>;
}

/**
 * 政黨標記：小色塊加政黨名稱，顏色取自 party-marks.tsv。
 * @param {{ party: { light: string, dark: string }|null, name: string, compact?: boolean }} props party 是政黨的色票，政黨表沒有登錄時為 null，只寫名稱。name 是顯示的政黨名稱，compact 時手機整個隱藏，只留給螢幕閱讀器。
 * @returns {JSX.Element}
 */
function PartyMark({ party, name, compact = false }) {
  // 有登錄色票時畫色塊，色票以 CSS 變數傳入。精簡模式在手機整個隱藏（旁邊的系列色塊已經是政黨色），黨名仍給螢幕閱讀器
  return (
    <span class={`inline-flex items-center gap-1.5 text-xs text-ink-secondary ${compact ? "max-sm:sr-only" : ""}`}>
      {party ? <span class="inline-block size-2.5 rounded-full bg-(--party)" style={`--party:light-dark(${party.light}, ${party.dark})`} aria-hidden="true" /> : null}
      {name}
    </span>
  );
}

/**
 * 系列色的小色塊，圖例與勾選列使用。
 * @param {{ series: number }} props series 是系列序號。
 * @returns {JSX.Element}
 */
function Swatch({ series }) {
  return <span class="inline-block size-3 shrink-0 rounded-full bg-(--series)" data-series={series} aria-hidden="true" />;
}

/**
 * 卡片右上角的 info 按鈕。
 * @param {{ action: string }} props action 是開啟這張卡 info 的動作，由卡片層給定。
 * @returns {JSX.Element}
 */
function InfoButton({ action }) {
  return (
    <button type="button" class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border py-0.5 ps-1.5 pe-2.5 text-xs text-ink-secondary hover:bg-sunken" data-action={action} aria-label={text("common.infoLabel")} data-tip={text("common.infoLabel")}>
      <Icon name="info" size="size-3.5" />
      {text("common.info")}
    </button>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Icon, Button, Disclosure, Badge, PartyMark, Swatch, InfoButton, TONES };
