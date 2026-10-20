/* ==================================================
 * blocks/inputs.jsx - 輸入區塊
 * --------------------------------------------------
 * - 角色：五級量尺、單選題、分段按鈕、滑桿、開關、下拉與勾選清單的 Preact 元件
 * - 指令：由 blocks/block.jsx 登錄，不直接匯入
 * - 慣例：
 *   - 點選類的輸入在 data-action 填入完整的動作（含「=值」），連續值的輸入設定 data-input，由 app 層在值改變時補上「=值」
 *   - 輸入的值一律由描述給定，畫面更新時 Preact 把值同步回元素，元件不另存狀態
 *   - 量尺與單選題以 radiogroup 呈現，方向鍵移動焦點、Enter 或空白鍵選取，避免移動焦點就替這題作答。數字鍵依序對應選項，由 app 層從描述找出
 * ================================================== */

import { Button } from "./ui.jsx";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 量尺圓圈的尺寸，由中立到最強依序排列：越靠兩端越大，中立最小。手機寬度各縮小一級。選項數值的絕對值依比例對到這三級。
 */
const SCALE_SIZES = ["size-8 sm:size-10", "size-10 sm:size-13", "size-12 sm:size-16"];

/**
 * 量尺圓圈的顏色，鍵是選項數值的正負：外框、選中時的填色與滑過時的淺底。
 */
const SCALE_TONES = {
  oppose: { ring: "border-oppose", fill: "bg-oppose", hover: "group-hover:bg-oppose/15" },
  neutral: { ring: "border-baseline", fill: "bg-baseline", hover: "group-hover:bg-baseline/25" },
  support: { ring: "border-support", fill: "bg-support", hover: "group-hover:bg-support/15" },
};

/**
 * 分段按鈕的選項文字合計超過這個字數時，手機上改成一段一列，避免最後一段單獨折到下一行。
 */
const SEGMENT_STACK_LENGTH = 16;

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 五級量尺加略過：一排大小不同的圓圈，左邊不同意、右邊同意。
 * @param {{ spec: { label: string, options: { code: string, label: string, value: number }[], value: string|null, action: string, skip: { label: string, action: string, selected: boolean } } }} props 區塊描述，options 依 value 由小到大排列，value 為負是不同意、0 是中立、正是同意。
 * @returns {JSX.Element}
 */
function Scale({ spec }) {
  // 尚未作答時可用 Tab 聚焦的是正中間的選項，圓圈大小依數值的絕對值與最強一級的比例
  const middle = Math.floor(spec.options.length / 2);
  const strongest = Math.max(...spec.options.map((option) => Math.abs(option.value)));
  // 所有選項的數值都是 0 時一律用最小的圓圈
  const sizeOf = (value) => SCALE_SIZES[strongest ? Math.round((Math.abs(value) / strongest) * (SCALE_SIZES.length - 1)) : 0];
  // 選項排成單選群組，只有選中的（或尚未選時居中的）選項可用 Tab 聚焦，其餘用方向鍵移動
  return (
    <div class="flex flex-col items-center gap-4">
      <div class="grid w-full items-start gap-1 sm:gap-3" style={`grid-template-columns:repeat(${spec.options.length},minmax(0,1fr))`} role="radiogroup" aria-label={spec.label}>
        {spec.options.map((option, index) => {
          const selected = spec.value === option.code;
          // 數值的正負決定顏色，絕對值決定圓圈大小
          const tone = SCALE_TONES[option.value < 0 ? "oppose" : option.value > 0 ? "support" : "neutral"];
          // 圓圈外留一個固定高度的格子，五個圓圈的圓心排在同一條水平線上，標籤的頂端切齊
          // 選中的圓圈填滿顏色並放上勾號，狀態同時寫進 aria-checked
          return (
            <button
              type="button"
              role="radio"
              aria-checked={String(selected)}
              tabindex={selected || (!spec.value && index === middle) ? "0" : "-1"}
              class="group flex flex-col items-center gap-2 rounded-lg py-1 text-center focus-visible:outline-offset-4"
              data-action={`${spec.action}=${option.code}`}
            >
              <span class="flex h-12 items-center justify-center sm:h-16">
                <span class={`flex items-center justify-center rounded-full border-2 transition-transform group-hover:scale-105 ${tone.ring} ${sizeOf(option.value)} ${selected ? tone.fill : tone.hover}`} aria-hidden="true">
                  {selected ? (
                    <svg viewBox="0 0 24 24" class="size-1/2 text-surface" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </span>
              </span>
              <span class={`text-xs sm:text-sm ${selected ? "font-semibold text-ink" : "text-ink-secondary"}`}>{option.label}</span>
            </button>
          );
        })}
      </div>
      {/* 略過按鈕放在量尺下方置中，已略過時換成強調色，與五個圓圈區分 */}
      <Button {...spec.skip} tone={spec.skip.selected ? "accent" : "neutral"} pressed={spec.skip.selected} />
    </div>
  );
}

/**
 * 單選題：選項由題組自訂，一個選項一列，下方是略過。選項的順序照問卷，不排成量尺。
 * @param {{ spec: { label: string, options: { code: string, label: string }[], value: string|null, action: string, skip: { label: string, action: string, selected: boolean } } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Choice({ spec }) {
  // 選項排成單選群組，只有選中的（或尚未選時第一個）選項可用 Tab 聚焦，其餘用方向鍵移動
  return (
    <div class="flex flex-col items-center gap-4">
      <div class="flex w-full flex-col gap-2" role="radiogroup" aria-label={spec.label}>
        {spec.options.map((option, index) => {
          const selected = spec.value === option.code;
          // 選中的選項用強調色淺底與實心圓點，狀態同時寫進 aria-checked
          return (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={String(selected)}
              tabindex={selected || (!spec.value && index === 0) ? "0" : "-1"}
              class={`flex items-center gap-3 rounded-lg border px-4 py-3 text-start text-sm ${selected ? "border-accent bg-accent-soft font-medium text-ink" : "border-border bg-surface text-ink-secondary hover:border-accent"}`}
              data-action={`${spec.action}=${option.code}`}
            >
              <span class={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-accent" : "border-baseline"}`} aria-hidden="true">
                {selected ? <span class="size-2.5 rounded-full bg-accent" /> : null}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {/* 略過按鈕與量尺的略過相同，已略過時換成強調色 */}
      <Button {...spec.skip} tone={spec.skip.selected ? "accent" : "neutral"} pressed={spec.skip.selected} />
    </div>
  );
}

/**
 * 分段按鈕。
 * @param {{ spec: { label: string, note?: string, value: unknown, options: { value: unknown, label: string }[], action: string, compact?: boolean } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Segmented({ spec }) {
  // 選中的一段填滿強調色，狀態同時寫進 aria-checked。外框寬度貼齊選項，放在直排容器裡也不會拉滿整行
  // 只有選中的一段在 Tab 順序內，組內以方向鍵移動，值不在選項中時由第一段接收焦點
  const current = spec.options.some((option) => option.value === spec.value) ? spec.value : spec.options[0]?.value;
  // 選項文字長的分段按鈕在手機上直排，每段拉滿整列、文字靠左
  const stacked = spec.options.reduce((sum, option) => sum + option.label.length, 0) > SEGMENT_STACK_LENGTH;
  const group = (
    <div class={`inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-sunken p-1 ${stacked ? "max-sm:w-full max-sm:flex-col" : ""}`} role="radiogroup" aria-label={spec.label}>
      {spec.options.map((option) => {
        const selected = option.value === spec.value;
        // 選中的一段換成強調色，其餘維持次要文字色
        return (
          <button type="button" role="radio" aria-checked={String(selected)} tabindex={option.value === current ? "0" : "-1"} class={`rounded-md px-2.5 py-1 text-xs ${stacked ? "max-sm:py-2 max-sm:text-start" : ""} ${selected ? "bg-accent text-on-accent" : "text-ink-secondary hover:bg-surface"}`} data-action={`${spec.action}=${option.value}`}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
  // 精簡模式不另外寫標籤，由外層提供
  if (spec.compact) return group;
  // 備註是選填，沒有內容就不繪製，避免標籤下方多出空白
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-sm font-medium text-ink">{spec.label}</span>
      {spec.note ? <span class="text-xs text-ink-muted">{spec.note}</span> : null}
      {group}
    </div>
  );
}

/**
 * 滑桿。
 * @param {{ spec: { label: string, note?: string, value: number, min: number, max: number, step: number, display: string, action: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Slider({ spec }) {
  // 備註是選填，沒有內容就不繪製，滑桿的值一律顯示在標籤右側。拖動時等到放開，才以 change 送出
  return (
    <label class="flex flex-col gap-1.5">
      <span class="flex items-baseline justify-between gap-2">
        <span class="text-sm font-medium text-ink">{spec.label}</span>
        <span class="text-sm tabular-nums text-ink-secondary">{spec.display}</span>
      </span>
      {spec.note ? <span class="text-xs text-ink-muted">{spec.note}</span> : null}
      <input type="range" min={String(spec.min)} max={String(spec.max)} step={String(spec.step)} value={String(spec.value)} class="w-full accent-accent" data-input={spec.action} data-commit="change" />
    </label>
  );
}

/**
 * 開關。
 * @param {{ spec: { label: string, note?: string, checked: boolean, action: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Toggle({ spec }) {
  // 備註是選填，沒有內容就不繪製，勾選框本身由瀏覽器原生處理
  return (
    <label class="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={spec.checked} class="mt-1 accent-accent" data-action={spec.action} />
      <span class="flex flex-col gap-0.5">
        <span class="text-sm font-medium text-ink">{spec.label}</span>
        {spec.note ? <span class="text-xs text-ink-muted">{spec.note}</span> : null}
      </span>
    </label>
  );
}

/**
 * 下拉選單。
 * @param {{ spec: { label: string, value: string, options: { value: string, label: string }[], action: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Select({ spec }) {
  // 選中的項目以 select 的 value 指定，選項變動後 Preact 仍會把值同步回元素
  return (
    <label class="flex flex-col gap-1.5">
      <span class="text-sm font-medium text-ink">{spec.label}</span>
      <select class="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={spec.value} data-input={spec.action} data-commit="change">
        {spec.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * 勾選清單。
 * @param {{ spec: { items: { label: string, checked: boolean, action: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Checks({ spec }) {
  return (
    <div class="flex flex-wrap gap-4">
      {spec.items.map((item) => (
        <label key={item.action} class="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={item.checked} class="accent-accent" data-action={item.action} />
          {item.label}
        </label>
      ))}
    </div>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Scale, Choice, Segmented, Slider, Toggle, Select, Checks };
