/* ==================================================
 * blocks/basic.jsx - 文字、清單、表格與版面區塊
 * --------------------------------------------------
 * - 角色：把卡片描述中的文字、統計、清單、表格、提示、分頁等區塊繪製成 Preact 元件
 * - 指令：由 blocks/block.jsx 登錄，不直接匯入
 * - 慣例：
 *   - 每個區塊元件收 spec（一份區塊描述），畫面完全由描述決定，狀態與資料來源留在 cards 層
 *   - 要繪製子區塊的元件另收 Blocks（繪製一串區塊的元件），由 block.jsx 傳入，避免循環引用
 *   - 可點的列與項目設定 data-action，hover 說明設定 data-tip
 *   - 字級、字重與顏色依 DESIGN.md 的角色字級表，同一角色在每個區塊用同一組類別
 * ================================================== */

import { Button, Disclosure, Badge, Note, TONES } from "./ui.jsx";
import { LandingArt } from "./art.jsx";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 文字依角色對應的字級與顏色：內文、讀法說明與圖表下方的註腳。
 */
const TEXT_TONES = { normal: "text-sm leading-relaxed text-ink-secondary", muted: "text-sm leading-relaxed text-ink-muted", caption: "text-xs text-ink-muted" };

/**
 * 長文字欄的門檻：欄內最長的文字超過這個字數時給欄位最小寬度。
 */
const LONG_TEXT = 40;

/**
 * 代碼或雜湊的門檻：沒有空白且超過這個字數的字串截短顯示，完整內容放在 title。
 */
const LONG_TOKEN = 24;

/**
 * 標題層級對應的字級。
 */
const HEADING_SIZES = { 3: "text-base", 4: "text-sm" };

/**
 * 地圖圖例的色塊，鍵是圖例項目的 state，顏色與 blocks/map.jsx 的 SHAPE_STATES 相同。
 */
const SWATCH_STATES = { none: "border-border bg-sunken", active: "border-border bg-baseline", policy: "border-accent bg-accent-soft", selected: "border-border bg-accent" };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 清單與表格沒有資料時的說明。
 * @param {{ text?: string }} props text 是區塊描述的 empty。
 * @returns {JSX.Element}
 */
function Empty({ text }) {
  return <p class="text-sm text-ink-muted">{text ?? ""}</p>;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 一段文字。
 * @param {{ spec: { text: string, tone?: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function TextBlock({ spec }) {
  return <p class={TEXT_TONES[spec.tone ?? "normal"]}>{spec.text}</p>;
}

/**
 * 小標題。
 * @param {{ spec: { text: string, level?: number } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Heading({ spec }) {
  const level = spec.level ?? 3;
  // 標籤名稱依層級決定，JSX 以變數當標籤時名稱要大寫開頭
  const Tag = `h${level}`;
  return <Tag class={`${HEADING_SIZES[level]} font-semibold text-ink mt-2`}>{spec.text}</Tag>;
}

/**
 * 首頁主視覺。
 * @param {{ spec: { title: string, subtitle: string[], text: string, actions: object[] } }} props 區塊描述，subtitle 是已分好的幾段，每段排在同一行。
 * @returns {JSX.Element}
 */
function Hero({ spec }) {
  return (
    <section class="glass-float grid items-center gap-8 rounded-3xl border p-6 sm:p-10 md:grid-cols-[1.2fr_1fr]">
      <div class="flex flex-col gap-4">
        <h1 class="text-4xl font-bold tracking-tight text-ink md:text-5xl">{spec.title}</h1>
        {/* 副標的每一段整段排在同一行，窄螢幕在段與段之間換行，詞語保持完整 */}
        <p class="text-xl text-accent">
          {spec.subtitle.map((clause) => (
            <span key={clause} class="inline-block">
              {clause}
            </span>
          ))}
        </p>
        <p class="text-base leading-relaxed text-ink-secondary">{spec.text}</p>
        <div class="flex flex-wrap gap-3 pt-2">
          {spec.actions.map((item) => (
            <Button key={item.action} {...item} />
          ))}
        </div>
      </div>
      <div class="mx-auto w-full max-w-sm">
        <LandingArt />
      </div>
    </section>
  );
}

/**
 * 一排按鈕。
 * @param {{ spec: { items: object[] } }} props 區塊描述，items 可含 null，略過不繪製。
 * @returns {JSX.Element}
 */
function Buttons({ spec }) {
  const items = spec.items.filter(Boolean);
  // 平板起依序排成一列，放不下時換行。手機排成兩欄等寬，顆數是單數時第一顆（主要動作）獨占一整列，不會有一顆單獨留在最後一列
  return (
    <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {items.map((item, index) => (
        <Button key={item.action ?? item.label} {...item} extra={`${item.extra ?? ""} max-sm:w-full ${items.length % 2 === 1 && index === 0 ? "max-sm:col-span-2" : ""} ${items.length === 1 ? "max-sm:col-span-2" : ""}`} />
      ))}
    </div>
  );
}

/**
 * 統計數字。
 * @param {{ spec: { items: { label: string, value: string, note?: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Stats({ spec }) {
  // 平板起每格至少 9rem 寬，放不下時自動換行。手機依格數排成三欄或兩欄，數字縮小一級
  // 兩欄而格數是單數時，第一格（通常是總數）在手機上占滿整列，不會剩一格單獨留在最後一列
  // 標籤列固定兩行高，標籤長短不同時，各格的數字仍排在同一條水平線上
  const columns = spec.items.length % 3 === 0 ? 3 : 2;
  const lead = columns === 2 && spec.items.length % 2 === 1;
  return (
    <dl class={`grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:gap-3 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {spec.items.map((item, index) => (
        <div key={item.label} class={`flex flex-col rounded-lg bg-sunken p-3 ${lead && index === 0 ? "max-sm:col-span-2" : ""}`}>
          <dt class="line-clamp-2 min-h-[2lh] text-xs leading-snug text-ink-muted">{item.label}</dt>
          <dd class="mt-1 text-xl font-semibold tabular-nums text-ink sm:text-2xl">{item.value}</dd>
          {/* 備註是選填，有值時才多畫一行 */}
          {item.note ? <dd class="mt-1 text-xs text-ink-muted">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * 清單：每項有標題、說明、註記與標籤，可點。
 * @param {{ spec: { items: object[], empty?: string, columns?: number, scroll?: boolean } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function List({ spec }) {
  // 沒有項目時顯示空清單的文字
  if (!spec.items.length) return <Empty text={spec.empty} />;
  // 兩欄版面只在呼叫端指定時使用，預設單欄讓長文字有完整寬度
  const grid = spec.columns === 2 ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-2";
  // 項目很多的清單限制高度並在框內捲動，頁面不會變得很長
  const scroll = spec.scroll ? "max-h-[40rem] overflow-y-auto pe-1" : "";
  return (
    <ul class={`${grid} ${scroll}`}>
      {spec.items.map((item) => {
        // 有動作的項目繪製成按鈕才能用鍵盤操作，純顯示的項目用一般容器
        const Tag = item.action ? "button" : "div";
        // 選取的項目用強調色框出，讓使用者看得出目前停在哪一項
        const selected = item.selected ? "border-accent bg-accent-soft" : "border-border bg-surface";
        // 標籤、說明與註記只在有內容時才繪製，避免空白行撐高項目
        return (
          <li>
            <Tag
              type={item.action ? "button" : null}
              class={`flex w-full flex-col gap-1 rounded-lg border p-3 text-start ${selected} ${item.action ? "hover:border-accent" : ""}`}
              data-action={item.action ?? null}
              aria-current={item.selected ? "true" : null}
            >
              <span class="flex items-start justify-between gap-2">
                <span class="min-w-0 text-sm font-medium text-ink">{item.title}</span>
                {item.badge ? <Badge label={item.badge} tone={item.badgeTone} /> : null}
              </span>
              {item.text ? <span class="text-sm leading-relaxed text-ink-secondary">{item.text}</span> : null}
              <Note text={item.meta} />
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 依受眾分開的入口。
 * @param {{ spec: { items: { title: string, text: string, action: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Entries({ spec }) {
  return (
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {spec.items.map((item) => (
        <button key={item.action} type="button" class="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-start hover:border-accent" data-action={item.action}>
          <span class="text-base font-semibold text-ink">{item.title}</span>
          <span class="text-sm leading-relaxed text-ink-secondary">{item.text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 編號步驟。
 * @param {{ spec: { items: { title: string, text?: string, note?: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Steps({ spec }) {
  // 步驟的說明與註記是選填，沒有內容就不繪製，編號則一律依序顯示
  return (
    <ol class="flex flex-col gap-3">
      {spec.items.map((item, index) => (
        <li key={item.title} class="flex gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{String(index + 1)}</span>
          <div class="flex flex-col gap-0.5">
            {/* 標題列與編號圓同高，只有標題時也與編號置中切齊 */}
            <span class="flex min-h-7 items-center text-sm font-medium text-ink">{item.title}</span>
            {item.text ? <span class="text-sm leading-relaxed text-ink-secondary">{item.text}</span> : null}
            <Note text={item.note} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * 表格。列有 action 時整列可點。
 * @param {{ spec: { columns: { key: string, label: string, align?: string, nowrap?: boolean }[], rows: { id?: string, cells: Record<string, string>, action?: string|null, note?: string }[], dense?: boolean, empty?: string } }} props 區塊描述。id 是列的穩定代碼，切換頁面或搜尋時列以它對應元素，note 是滑過整列時的說明。
 * @returns {JSX.Element}
 */
function Table({ spec }) {
  // 沒有列時顯示空表格的文字
  if (!spec.rows.length) return <Empty text={spec.empty} />;
  // 密集模式縮小內距，讓欄數多的表格不必橫向捲動
  const pad = spec.dense ? "px-2 py-1.5" : "px-3 py-2";
  // 數字欄靠右並用等寬數字，位數才對得齊，文字欄維持靠左。短的分類欄可以標 nowrap，不折成兩行
  const align = (column) => `${column.align === "end" ? "text-end tabular-nums" : "text-start"} ${column.nowrap ? "whitespace-nowrap" : ""}`;
  // 依欄內最長的文字決定欄寬：長文字欄給最小寬度，不因代碼欄擠壓而變成一字一行
  const widths = new Map(spec.columns.map((column) => [column.key, Math.max(0, ...spec.rows.map((row) => String(row.cells[column.key] ?? "").length))]));
  // 沒有空白的長字串視為代碼或雜湊
  const isToken = (value) => value.length > LONG_TOKEN && !/\s/.test(value);
  /**
   * 一格的類別：長文字欄設最小寬度，沒有空白的長字串（代碼、雜湊）截短顯示，完整內容在 title 與匯出檔。
   * @param {object} column 欄。
   * @param {string} value 內容。
   * @returns {string}
   */
  const cellClass = (column, value) => [widths.get(column.key) > LONG_TEXT ? "min-w-[16rem]" : "", isToken(value) ? "max-w-[12rem] truncate" : ""].join(" ");
  // 有動作的列才加上游標樣式與焦點，整列可點時鍵盤也要能操作。密集的資料表在窄螢幕維持可讀的欄寬，改在框內水平捲動
  return (
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class={`w-full border-collapse text-sm ${spec.dense ? "min-w-[48rem]" : ""}`}>
        <thead class="bg-sunken">
          <tr>
            {spec.columns.map((column) => (
              <th key={column.key} scope="col" class={`${pad} ${align(column)} text-xs font-medium text-ink-secondary whitespace-nowrap`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row) => (
            <tr key={row.id ?? row.action ?? JSON.stringify(row.cells)} class={`border-t border-border ${row.action ? "cursor-pointer hover:bg-sunken" : ""}`} data-action={row.action ?? null} data-tip={row.note ?? null} tabindex={row.action ? "0" : null}>
              {spec.columns.map((column) => {
                const value = String(row.cells[column.key] ?? "");
                // 截短的代碼與雜湊把完整內容放在 title，滑鼠停留時看得到
                return (
                  <td class={`${pad} ${align(column)} ${cellClass(column, value)} align-top text-ink-secondary`} title={isToken(value) ? row.cells[column.key] : null}>
                    {row.cells[column.key] ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 提示。
 * @param {{ spec: { tone?: string, title?: string, text: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Notice({ spec }) {
  // 警告與嚴重的提示用 status 角色，螢幕閱讀器會主動唸出，其餘語氣當一般內容。標題是選填
  return (
    <div class={`rounded-lg px-4 py-3 text-sm leading-relaxed ${TONES[spec.tone ?? "neutral"]}`} role={spec.tone === "warning" || spec.tone === "critical" ? "status" : null}>
      {spec.title ? <p class="font-medium">{spec.title}</p> : null}
      <p>{spec.text}</p>
    </div>
  );
}

/**
 * 鍵值對。
 * @param {{ spec: { items: { label: string, value: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function KeyValue({ spec }) {
  return (
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {spec.items.flatMap((item) => [<dt class="text-ink-muted whitespace-nowrap">{item.label}</dt>, <dd class="text-ink-secondary break-words">{item.value}</dd>])}
    </dl>
  );
}

/**
 * 分頁籤。
 * @param {{ spec: { label: string, items: { label: string, action: string, selected: boolean }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Tabs({ spec }) {
  // 選中的分頁籤用卡面底色浮起，其餘維持次要文字色。手機排成一列左右滑動，平板起自動換行
  return (
    <div class="flex gap-1 overflow-x-auto rounded-lg bg-sunken p-1 [scrollbar-width:none] sm:flex-wrap" role="tablist" aria-label={spec.label}>
      {spec.items.map((item) => (
        <button key={item.action} type="button" role="tab" aria-selected={String(item.selected)} class={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${item.selected ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`} data-action={item.action}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 上下頁導覽：左上一頁、中間頁碼或一個按鈕、右下一頁。
 * @param {{ spec: { prev: object|null, next: object|null, label: string, center?: object } }} props 區塊描述，label 是導覽的名稱，沒有 center 時也顯示在中間。
 * @returns {JSX.Element}
 */
function Pager({ spec }) {
  // 沒有上一頁或下一頁時留空，三欄格線讓中間的內容永遠置中。center 是選填的按鈕，沒有時中間顯示頁碼
  // 有 center 按鈕時窄螢幕改為兩列：按鈕獨占第一列，上一頁與下一頁排在第二列兩端
  const stacked = spec.center ? "grid-cols-2 sm:grid-cols-[1fr_auto_1fr]" : "grid-cols-[1fr_auto_1fr]";
  return (
    <nav class={`grid items-center gap-3 ${stacked}`} aria-label={spec.label}>
      {/* 第一頁沒有上一頁，格子留空 */}
      <div class="justify-self-start">{spec.prev ? <Button tone="neutral" {...spec.prev} /> : null}</div>
      {/* 中間放按鈕或頁碼 */}
      {spec.center ? <Button tone="quiet" {...spec.center} extra="order-first col-span-2 sm:order-none sm:col-span-1" /> : <span class="text-sm tabular-nums text-ink-muted">{spec.label}</span>}
      {/* 最後一頁沒有下一頁，格子留空 */}
      <div class="justify-self-end">{spec.next ? <Button tone="neutral" {...spec.next} /> : null}</div>
    </nav>
  );
}

/**
 * 搜尋框，輸入時以 data-input 傳出。
 * @param {{ spec: { value: string, placeholder: string, action: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Search({ spec }) {
  return <input type="search" value={spec.value} placeholder={spec.placeholder} aria-label={spec.placeholder} class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted" data-input={spec.action} />;
}

/**
 * 一則主張：原文引述、標籤列、判讀理由，細節收合在下方。
 * @param {{ spec: { quote: string, highlight: string|null, badges: { label: string, tone: string }[], reason: string|null, detailsLabel: string, details: { label: string, value: string }[] } }} props 區塊描述，highlight 是原文中的證據片段，reason 是選填的判讀理由。
 * @returns {JSX.Element}
 */
function Claim({ spec }) {
  // 證據片段在原文中時以螢光筆底色標示，找不到時顯示整段原文
  const index = spec.highlight ? spec.quote.indexOf(spec.highlight) : -1;
  // 找到時分成三段，中間一段加標示
  const body = index >= 0 ? [spec.quote.slice(0, index), <mark class="rounded-xs bg-highlight px-0.5 text-ink">{spec.highlight}</mark>, spec.quote.slice(index + spec.highlight.length)] : [spec.quote];
  // 判讀理由是選填，沒有配題時不繪製
  return (
    <article class="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <p class="text-base leading-relaxed text-ink">{body}</p>
      <div class="flex flex-wrap gap-1.5">
        {spec.badges.map((badge) => (
          <Badge key={badge.label} label={badge.label} tone={badge.tone} />
        ))}
      </div>
      {spec.reason ? <p class="text-sm leading-relaxed text-ink-secondary">{spec.reason}</p> : null}
      <Disclosure summary={spec.detailsLabel} variant="inline">
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs text-ink-muted">
          {spec.details.flatMap((item) => [<dt>{item.label}</dt>, <dd class="break-words text-ink-secondary">{item.value}</dd>])}
        </dl>
      </Disclosure>
    </article>
  );
}

/**
 * 影像。
 * @param {{ spec: { src: string, alt: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Image({ spec }) {
  return <img src={spec.src} alt={spec.alt} loading="lazy" class="w-full rounded-lg border border-border" />;
}

/**
 * 群組：把幾個區塊放在一起。
 * @param {{ spec: { blocks: object[] }, Blocks: Function }} props 區塊描述與繪製一串區塊的元件，blocks 可含 null，略過不繪製。
 * @returns {JSX.Element}
 */
function Group({ spec, Blocks }) {
  return (
    <div class="flex flex-col gap-3">
      <Blocks specs={spec.blocks} />
    </div>
  );
}

/**
 * 可收合的段落。
 * @param {{ spec: { summary: string, blocks: object[], open?: boolean }, Blocks: Function }} props 區塊描述與繪製一串區塊的元件，blocks 可含 null，略過不繪製。
 * @returns {JSX.Element}
 */
function Details({ spec, Blocks }) {
  return (
    <Disclosure summary={spec.summary} open={spec.open ?? false}>
      <div class="flex flex-col gap-3 p-4">
        <Blocks specs={spec.blocks} />
      </div>
    </Disclosure>
  );
}

/**
 * 常見問題：每題一個可收合段落。
 * @param {{ spec: { items: { q: string, a: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Faq({ spec }) {
  return (
    <div class="flex flex-col gap-2">
      {spec.items.map((item) => (
        <Disclosure key={item.q} summary={item.q}>
          <p class="px-4 py-3 text-sm leading-relaxed text-ink-secondary">{item.a}</p>
        </Disclosure>
      ))}
    </div>
  );
}

/**
 * 更新紀錄時間軸。
 * @param {{ spec: { items: { date: string, title: string, text: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Timeline({ spec }) {
  return (
    <ol class="flex flex-col gap-4">
      {spec.items.map((item) => (
        <li key={`${item.date}:${item.title}`} class="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <time class="text-sm tabular-nums text-ink-muted">{item.date}</time>
          <div>
            <p class="text-sm font-medium text-ink">{item.title}</p>
            <p class="text-sm leading-relaxed text-ink-secondary">{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * 公式清單：名稱、算式與說明。
 * @param {{ spec: { items: { name: string, formula: string, text: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Formulas({ spec }) {
  return (
    <dl class="flex flex-col gap-3">
      {spec.items.map((item) => (
        // 每條公式一個外框，名稱、算式與說明用同一個左右內距，左緣切齊。算式的 sunken 底色橫跨整個框寬，與上下兩段分開
        <div class="overflow-hidden rounded-lg border border-border">
          <dt class="px-4 pt-3 pb-2 text-sm font-medium text-ink">{item.name}</dt>
          <dd class="bg-sunken px-4 py-2.5 font-mono text-sm break-words text-ink">{item.formula}</dd>
          <dd class="px-4 pt-2.5 pb-3 text-sm leading-relaxed text-ink-secondary">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 進度條：上方是進度文字，下方是長條，作答頁首的作答進度使用。
 * @param {{ spec: { value: number, label: string } }} props 區塊描述，value 是 0 到 1 的比例。
 * @returns {JSX.Element}
 */
function Progress({ spec }) {
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-xs tabular-nums text-ink-muted">{spec.label}</span>
      <div class="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={String(Math.round(spec.value * 100))} aria-label={spec.label}>
        <div class="h-full rounded-full bg-accent transition-[width]" style={`width:${(spec.value * 100).toFixed(1)}%`} />
      </div>
    </div>
  );
}

/**
 * 圖例。
 * @param {{ spec: { items: { label: string, state: string }[] } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Legend({ spec }) {
  return (
    <ul class="flex flex-wrap gap-4 text-xs text-ink-secondary">
      {spec.items.map((item) => (
        <li key={item.state} class="flex items-center gap-1.5">
          <span class={`inline-block size-3 rounded-full border ${SWATCH_STATES[item.state]}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * 可複製的文字。
 * @param {{ spec: { value: string, label: string, action: string } }} props 區塊描述，action 是複製鈕的動作。
 * @returns {JSX.Element}
 */
function Copy({ spec }) {
  return (
    <div class="flex gap-2">
      <input type="text" readOnly value={spec.value} class="min-w-0 flex-1 rounded-lg border border-border bg-sunken px-3 py-2 font-mono text-sm text-ink" aria-label={spec.label} />
      <Button label={spec.label} action={spec.action} tone="accent" />
    </div>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { TextBlock, Heading, Hero, Buttons, Stats, List, Entries, Steps, Table, Notice, KeyValue, Tabs, Pager, Search, Image, Group, Details, Faq, Timeline, Formulas, Progress, Legend, Copy, Claim };
