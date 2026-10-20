/* ==================================================
 * blocks/flow.jsx - 作答流程的區塊
 * --------------------------------------------------
 * - 角色：議題重視度表、議題標示、作答題目與題號面板的 Preact 元件
 * - 指令：由 blocks/block.jsx 登錄，不直接匯入
 * - 慣例：
 *   - 每個區塊元件收 spec（一份區塊描述），畫面完全由描述決定，作答狀態留在 cards 層
 *   - 第 1 層議題以 IssueIcon 繪製圖示，圖示代碼就是議題代碼
 * ================================================== */

import { useEffect, useRef } from "preact/hooks";
import { Button, Disclosure, Badge } from "./ui.jsx";
import { IssueIcon } from "./art.jsx";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 題號面板三種作答狀態的類別。
 */
const NUMBER_STYLES = { answered: "bg-accent-soft text-accent", skipped: "bg-sunken text-ink-muted line-through", open: "bg-surface text-ink-secondary border border-border" };

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 議題重視度表的一列，第 2 層縮排。
 * @param {{ row: { id: string, label: string, note: string, value: number, action: string, expand: { label: string, action: string }|null }, levels: { value: number, label: string }[], child: boolean, Block: Function }} props row 是列描述，id 是議題代碼，expand 是選填的展開鈕。levels 是重視度的級距，child 表示第 2 層。
 * @returns {JSX.Element}
 */
function ImportanceRow({ row, levels, child, Block }) {
  // 第 1 層的名稱前有議題圖示，第 2 層縮排到名稱的位置並縮小字級
  // 只有帶展開動作的列才繪製展開按鈕，按鈕欄固定寬度，各列的分段按鈕才排在同一條直線上
  return (
    <div class={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${child ? "ps-12" : ""}`}>
      <div class="flex items-center gap-3">
        {child ? null : <IssueIcon code={row.id} size="size-9" />}
        <div class="flex flex-col">
          <span class={`${child ? "text-sm" : "text-base"} font-medium text-ink`}>{row.label}</span>
          <span class="text-xs text-ink-muted">{row.note}</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Block spec={{ type: "segmented", value: row.value, options: levels, action: row.action, label: row.label, compact: true }} />
        <span class="inline-flex w-16 justify-end">{row.expand ? <Button {...row.expand} tone="quiet" /> : null}</span>
      </div>
    </div>
  );
}

/**
 * 議題重視度表：每列一個議題，可展開第 2 層。
 * @param {{ spec: { levels: { value: number, label: string }[], rows: object[] }, Block: Function }} props 區塊描述與區塊元件。rows 的每一列與 ImportanceRow 的 row 相同，另有 children 列出展開的第 2 層。
 * @returns {JSX.Element}
 */
function Importance({ spec, Block }) {
  return (
    <div class="divide-y divide-border">
      {spec.rows.map((row) => (
        <div key={row.id}>
          <ImportanceRow row={row} levels={spec.levels} child={false} Block={Block} />
          {row.children.map((childRow) => (
            <ImportanceRow key={childRow.id} row={childRow} levels={spec.levels} child Block={Block} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 議題標示：置中的大型議題插圖，下方是議題路徑與選填的標籤。
 * @param {{ spec: { icon: string, text: string, badge?: { label: string, tone: string } } }} props 區塊描述，icon 是第 1 層議題代碼，badge 是選填的標籤。
 * @returns {JSX.Element}
 */
function Topic({ spec }) {
  // 插圖用議題圖示放大，外圈再加一圈淡色的環，標籤是選填，沒有就不繪製
  return (
    <div class="flex flex-col items-center gap-3 text-center">
      <span class="rounded-full p-2 ring-1 ring-border">
        <IssueIcon code={spec.icon} size="size-20 sm:size-24" />
      </span>
      <span class="flex flex-wrap items-center justify-center gap-2 text-sm text-ink-secondary">
        {spec.text}
        {spec.badge ? <Badge {...spec.badge} /> : null}
      </span>
    </div>
  );
}

/**
 * 作答題目：追問標示、題幹與說明置中排列，原文節錄靠左放在題幹下方。掛載時把焦點移到題幹。
 * @param {{ spec: { followUp?: string, stem: string, note?: string|null, excerpt?: string|null } }} props 區塊描述，followUp 是追問題依據的母題，note 是置中的短句說明，excerpt 是原文節錄。
 * @returns {JSX.Element}
 */
function Question({ spec }) {
  const heading = useRef(null);
  // 換題時題目重新掛載，焦點移到題幹，鍵盤與螢幕閱讀器的使用者從新題目繼續。不捲動畫面
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  // 追問題的標示是選填，有母題時才繪製。題幹可以接收程式移來的焦點，不在 Tab 順序內
  return (
    <div class="flex flex-col gap-4">
      {spec.followUp ? <p class="self-center rounded-lg bg-accent-soft px-3 py-2 text-center text-sm text-accent">{spec.followUp}</p> : null}
      <div class="flex flex-col gap-2 text-center">
        <h2 ref={heading} tabindex="-1" class="text-2xl font-semibold leading-snug text-balance text-ink outline-none">{spec.stem}</h2>
        {spec.note ? <p class="text-sm leading-relaxed text-pretty text-ink-secondary">{spec.note}</p> : null}
      </div>
      {/* 原文節錄較長，靠左放在 sunken 底的框裡，與置中的題幹分開 */}
      {spec.excerpt ? <blockquote class="rounded-lg bg-sunken px-4 py-3 text-sm leading-relaxed text-ink-secondary">{spec.excerpt}</blockquote> : null}
    </div>
  );
}

/**
 * 題號面板：每題一個號碼，依狀態區分已答、略過與未答。
 * @param {{ spec: { label: string, items: object[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Numbers({ spec }) {
  // 號碼排成自動分欄的格線，每格平均分配整列寬度、保持正方形，右側不留空。目前所在的題號用外框標示，三種作答狀態再用底色區分
  return (
    <Disclosure summary={spec.label}>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5 p-3">
        {spec.items.map((item) => (
          <button key={item.action} type="button" class={`aspect-square w-full rounded-lg text-xs tabular-nums ${NUMBER_STYLES[item.status]} ${item.selected ? "outline-2 outline-accent" : ""}`} data-action={item.action} data-tip={item.tip} aria-current={item.selected ? "step" : null}>
            {item.label}
          </button>
        ))}
      </div>
    </Disclosure>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Importance, Topic, Question, Numbers };
