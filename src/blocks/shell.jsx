/* ==================================================
 * blocks/shell.jsx - 頁面外框
 * --------------------------------------------------
 * - 角色：導覽頁首（品牌、導覽、主題與縮放）、流程頁首（品牌、步驟、主題縮放與離開）、步驟導覽、卡片網格、卡片外框、頁尾、視窗、擋板、提示、hover 說明與載入畫面的 Preact 元件
 * - 指令：import { Page, Modal, Gate, Toast, Tooltip, Loading } from "./shell.jsx"，app 層經由 blocks/index.js 取得
 * - 慣例：
 *   - 外框依傳入的描述繪製，頁名、導覽、提示與卡片都由 cards 層寫入描述
 *   - 卡片可以右鍵或長按開啟說明，卡片外框設定 data-info。卡片以代碼當 key，切換頁面時同一張卡沿用同一組元素
 *   - 卡片寬度依 12 欄網格，寬螢幕依 span 排列，窄螢幕一律整欄
 *   - 版型依頁面描述的 template：landing、dashboard、document 用導覽頁首與頁尾，flow 用流程頁首、單欄或寬版的卡片與底部的步驟導覽
 *   - 導覽與步驟列中鎖定的入口加上 aria-disabled、不設定 data-action，滑過或聚焦時以 data-tip 說明還差什麼
 *   - 視窗掛載時把焦點移到標題，關閉後還給開啟前的元素。app 層每開一次視窗換一個 key，重新掛載
 * ================================================== */

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { text } from "../config/index.js";
import { clamp } from "../lib/format.js";
import { BrandMark } from "./art.jsx";
import { Icon, Button, InfoButton, rovingValue } from "./ui.jsx";
import { Block, Blocks } from "./block.jsx";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 主要內容的最大寬度：一般頁面、流程頁的單欄與流程頁的寬版（選區頁的地圖與清單並排）。
 */
const WIDTHS = { page: "max-w-6xl", normal: "max-w-3xl", wide: "max-w-6xl" };

/**
 * 各版型主內容的上下內距。手機上延伸到螢幕邊緣的卡片貼齊頁首，頂端不留空白。引導頁的主視覺不延伸，頂端留與左右相同的 16 px。
 */
const MAIN_PADDING = {
  landing: "py-6 max-sm:pt-4",
  flow: "py-6 max-sm:py-0 sm:py-10",
  dashboard: "py-6 max-sm:pt-0",
  document: "py-6 max-sm:pt-0",
};

/**
 * 卡片寬度對應的網格類別，類別名稱要寫全，Tailwind 才掃描得到。
 */
const SPANS = { 4: "lg:col-span-4", 5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8", 12: "lg:col-span-12" };

/**
 * hover 說明與目標的距離（像素）。
 */
const TIP_GAP = 8;

/**
 * 手機上的卡片延伸到螢幕左右邊緣，移除圓角與左右框線，卡片之間以上下框線分隔，像 app 的分區。
 */
const PHONE_BLEED = "max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:first:border-t-0";

/**
 * 流程頁在手機上整頁滿版：卡片沒有圓角、陰影與左右框線，頁面底色就是卡面，卡片之間只以下框線分隔，像登入頁那樣的單頁畫面。
 */
const PHONE_FLAT = "max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0 max-sm:shadow-none";

/**
 * 一般外框的卡面：一般卡片、重點卡片（glass）與常駐卡片（sticky）。手機上一般與重點卡片延伸到螢幕邊緣，常駐卡片由外層延伸。
 */
const CARD_SURFACES = {
  card: `border-border bg-surface ${PHONE_BLEED}`,
  glass: `glass-float ${PHONE_BLEED} max-sm:shadow-none`,
  sticky: "glass-float max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-4 max-sm:pt-2 max-sm:pb-3 max-sm:shadow-none max-sm:[backdrop-filter:none]",
};

/**
 * 導覽列入口在目前所在、一般與鎖住三種狀態的類別。
 */
const NAV_TONES = { current: "bg-accent-soft font-medium text-accent", idle: "text-ink-secondary hover:bg-sunken", locked: "cursor-not-allowed text-ink-muted opacity-60" };

/**
 * 步驟列入口在目前所在、一般與鎖住三種狀態的類別，三種狀態都是圓角膠囊。
 */
const STEP_TONES = { current: "bg-accent text-on-accent", idle: "bg-sunken text-ink-secondary hover:text-ink", locked: "cursor-not-allowed bg-sunken text-ink-muted opacity-60" };

/**
 * 手機底部分頁列在目前所在、一般與鎖住三種狀態的類別。所在頁面的一格填上淡色的膠囊底。
 */
const TAB_TONES = { current: "bg-accent-soft/70 text-accent", idle: "text-ink-muted hover:text-ink", locked: "cursor-not-allowed text-ink-muted opacity-60" };

/**
 * 視窗內可以用 Tab 聚焦的元素。
 */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 頁首的分段選擇：主題或縮放。
 * @param {{ control: { label: string, value: string, options: { value: string, label: string, icon: string, action: string }[] } }} props control 是群組名稱、目前的值與各選項。
 * @returns {JSX.Element}
 */
function Segment({ control }) {
  // 目前的選項浮起顯示，其餘維持次要文字色。只有目前的選項在 Tab 順序內
  const current = rovingValue(control.options, control.value);
  return (
    <div class="inline-flex rounded-lg bg-sunken p-0.5" role="radiogroup" aria-label={control.label}>
      {control.options.map((option) => (
        // 每個選項繪製成圖示，名稱寫在 aria-label 與滑過的說明。目前的選項浮起，Tab 只停在它上面
        <button key={option.value} type="button" role="radio" aria-checked={String(option.value === control.value)} aria-label={option.label} data-tip={option.label} tabindex={option.value === current ? "0" : "-1"} class={`inline-flex size-7 items-center justify-center rounded-md ${option.value === control.value ? "bg-surface text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`} data-action={option.action}>
          <Icon name={option.icon} />
        </button>
      ))}
    </div>
  );
}

/**
 * 導覽列與步驟列共用的入口按鈕。鎖定時不寫動作，以 aria-disabled 標示並附上說明。
 * @param {{ item: { page: string, label: string, action: string, current: boolean, lock: string|null, popup?: string }, base: string, tones: { current: string, idle: string, locked: string }, currentMark: string, children: unknown }} props item 是入口描述，base 是共用類別，tones 是目前所在、一般與鎖住三種狀態的類別，currentMark 是 aria-current 的值。
 * @returns {JSX.Element}
 */
function EntryButton({ item, base, tones, currentMark, children }) {
  // 目前所在的頁面優先標示，其次是鎖住，其餘是一般狀態。鎖住的入口仍可聚焦，螢幕閱讀器與滑過時都讀得到說明
  const state = item.current ? tones.current : item.lock ? tones.locked : tones.idle;
  // 鎖住時不設定 data-action，點了沒有作用，改設定 data-tip 與 aria-disabled
  return (
    <button type="button" class={`${base} ${state}`} data-action={item.lock ? null : item.action} data-tip={item.lock} aria-label={item.label} aria-disabled={item.lock ? "true" : null} aria-current={item.current ? currentMark : null} aria-haspopup={item.popup ?? null}>
      {children}
    </button>
  );
}

/**
 * 頁首右側的主題與縮放控制。
 * @param {{ controls: { theme: object, zoom: object } }} props controls 是兩組切換的描述。
 * @returns {JSX.Element}
 */
function Controls({ controls }) {
  return (
    <div class="ms-auto flex flex-wrap items-center gap-2">
      <Segment control={controls.theme} />
      {/* 手機可以用瀏覽器的手勢縮放，縮放切換只在平板起顯示，主題切換與品牌名才放得進同一列 */}
      <div class="hidden sm:block">
        <Segment control={controls.zoom} />
      </div>
    </div>
  );
}

/**
 * 頁首左側回首頁的品牌鈕，名稱寫在 aria-label。
 * @param {{ brand: { label: string, action: string }, children?: unknown }} props brand 是名稱與動作，children 是標誌旁另外顯示的文字。
 * @returns {JSX.Element}
 */
function BrandButton({ brand, children }) {
  return (
    <button type="button" class="flex items-center gap-2" data-action={brand.action} aria-label={brand.label}>
      <BrandMark />
      {children}
    </button>
  );
}

/**
 * 頁首。
 * @param {{ spec: object }} props spec 是 buildPage 的結果，用到 page、brand、phoneTitle、nav 與 controls。
 * @returns {JSX.Element}
 */
function Header({ spec }) {
  const bar = useRef(null);
  // 平板的導覽可以左右滑動，切換頁面後把所在頁面的入口捲進畫面，不在可見範圍外
  useEffect(() => bar.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }), [spec.page]);
  // 寬螢幕的品牌、導覽與主題縮放排在同一列。平板的導覽換到第二列並可左右滑動。手機的導覽在底部分頁列，頂端只留頁名與主題
  return (
    <header class="glass border-b">
      <div class={`mx-auto flex ${WIDTHS.page} flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3`}>
        <BrandButton brand={spec.brand}>
          {/* 手機的頂端列寫頁名（首頁寫品牌名），導覽在底部分頁列。平板起寫品牌名 */}
          <span class="hidden text-lg font-semibold text-ink sm:inline">{spec.brand.label}</span>
          <span class="text-lg font-semibold text-ink sm:hidden" aria-hidden="true">{spec.phoneTitle}</span>
        </BrandButton>
        <nav ref={bar} class="order-last -mx-4 hidden w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:flex lg:order-none lg:mx-0 lg:w-auto lg:overflow-visible lg:px-0" aria-label={text("common.nav")}>
          {spec.nav.map((item) => (
            <EntryButton key={item.page} item={item} base="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm" tones={NAV_TONES} currentMark="page">
              {item.label}
            </EntryButton>
          ))}
        </nav>
        <Controls controls={spec.controls} />
      </div>
    </header>
  );
}

/**
 * 作答流程的步驟列，放在流程頁的頁首。
 * @param {{ flow: { steps: { page: string, label: string, current: boolean, lock: string|null }[] } }} props flow 是流程描述。
 * @returns {JSX.Element}
 */
function Stepper({ flow }) {
  // 目前所在的步驟與其他步驟用不同底色標示，鎖住的步驟停用
  return (
    <ol class="flex flex-wrap justify-center gap-2" aria-label={text("common.steps")}>
      {flow.steps.map((item, index) => (
        <li key={item.page}>
          <EntryButton item={item} base="flex items-center gap-2 rounded-full px-3 py-1 text-xs" tones={STEP_TONES} currentMark="step">
            <span class="tabular-nums">{String(index + 1)}</span>
            {/* 窄螢幕只有目前的步驟寫出名稱，其餘只留編號，步驟列維持一行。名稱另寫在 aria-label */}
            <span class={item.current ? "" : "hidden sm:inline"}>{item.label}</span>
          </EntryButton>
        </li>
      ))}
    </ol>
  );
}

/**
 * 流程頁的頁首：品牌、步驟、主題縮放與離開鈕，作答頁多一列作答進度。
 * @param {{ spec: object }} props spec 是 buildPage 的結果，用到 brand、flow、controls、leave 與 progress（作答頁的進度，其他頁為 null）。
 * @returns {JSX.Element}
 */
function FlowHeader({ spec }) {
  // 品牌、步驟與離開鈕排成一行，窄螢幕的離開鈕只顯示圖示，主題縮放隱藏
  return (
    <header class="glass border-b">
      <div class={`mx-auto flex ${WIDTHS.page} items-center gap-3 px-4 py-2 sm:gap-4 sm:py-3`}>
        <BrandButton brand={spec.brand} />
        <div class="min-w-0 flex-1">
          <Stepper flow={spec.flow} />
        </div>
        <div class="hidden sm:block">
          <Controls controls={spec.controls} />
        </div>
        <Button {...spec.leave} tone="neutral" size="sm" iconOnly="phone" />
      </div>
      {/* 作答頁的進度條在步驟下方占滿整行 */}
      {spec.progress ? (
        <div class={`mx-auto ${WIDTHS.page} px-4 pb-3`}>
          <Block spec={{ type: "progress", value: spec.progress.value, label: spec.progress.label }} />
        </div>
      ) : null}
    </header>
  );
}

/**
 * 流程頁底部的上一步與下一步，貼在視窗底部。下一步停用時旁邊寫出原因。
 * @param {{ nav: { prev: object|null, next: object|null, hint: string|null } }} props nav 是兩個按鈕的描述與停用原因。
 * @returns {JSX.Element}
 */
function StepNav({ nav }) {
  // 沒有上一步時留空，下一步固定在右側
  return (
    <nav class="glass sticky bottom-0 z-10 border-t" aria-label={text("common.steps")}>
      <div class={`mx-auto flex ${WIDTHS.page} flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3`}>
        {/* 下一步停用時說明缺什麼，窄螢幕放在按鈕上方獨占一行 */}
        {nav.hint ? <span class="order-first w-full text-center text-xs text-ink-muted sm:order-none sm:ms-auto sm:w-auto sm:text-end">{nav.hint}</span> : null}
        <div class={nav.hint ? "sm:order-first" : ""}>{nav.prev ? <Button {...nav.prev} /> : null}</div>
        {nav.next ? <Button {...nav.next} /> : null}
      </div>
    </nav>
  );
}

/**
 * 卡片的標題列：標題、回答的問題與說明鈕。
 * @param {{ card: object, size: string }} props card 是卡片描述，size 是標題的字級類別。
 * @returns {JSX.Element}
 */
function CardHeader({ card, size }) {
  // 回答的問題與說明鈕取決於卡片有沒有寫
  return (
    <header class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h2 id={`card-${card.id}`} class={`${size} font-semibold text-ink`}>
          {card.title}
        </h2>
        {card.question ? <p class="text-sm text-ink-muted">{card.question}</p> : null}
      </div>
      {card.infoAction ? <InfoButton action={card.infoAction} /> : null}
    </header>
  );
}

/**
 * 卡片外框。
 * @param {{ card: object, phoneHidden?: boolean }} props card 是卡片描述：id、title、question、span、frame、section、blocks、info。frame 是 card、sticky、bare、flow 或 focus。phoneHidden 表示手機上不在所在分區，隱藏。
 * @returns {JSX.Element}
 */
function CardFrame({ card, phoneHidden = false }) {
  // 手機上不在所在分區的卡片隱藏，寬螢幕照常顯示
  const phone = phoneHidden ? "max-sm:hidden" : "";
  const span = `col-span-12 ${SPANS[card.span] ?? ""}`;
  // 有說明的卡片才設定 data-info，右鍵與長按依它開啟說明，其餘卡片右鍵開啟的是瀏覽器內建的選單
  const info = { "data-info": card.info ? card.id : null };
  // 有標題列的外框以標題當名稱，沒有標題列的外框把標題寫在 aria-label
  const name = (headed) => (headed ? { "aria-labelledby": `card-${card.id}` } : { "aria-label": card.title });
  const body = (
    <div class="flex flex-col gap-4">
      <Blocks specs={card.blocks} />
    </div>
  );
  // 專注作答的卡片置中並限制寬度，沒有標題列，說明鈕與第一個區塊排在同一列
  if (card.frame === "focus") {
    const [head, ...rest] = card.blocks.filter(Boolean);
    return (
      <section class={`col-span-12 mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-border bg-surface p-5 shadow-sm sm:p-8 ${PHONE_FLAT} max-sm:w-auto max-sm:border-b-0`} {...info} {...name(false)}>
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <Block spec={head} />
          </div>
          {/* 說明鈕靠右，與第一個區塊的頂端切齊 */}
          {card.infoAction ? <InfoButton action={card.infoAction} /> : null}
        </div>
        <Blocks specs={rest} />
      </section>
    );
  }
  // 流程頁的卡片：較大的圓角與內距，標題列與一般卡片相同
  if (card.frame === "flow") {
    return (
      <section class={`${span} flex flex-col gap-5 border border-border bg-surface p-5 shadow-sm sm:rounded-3xl sm:p-7 ${PHONE_FLAT} ${phone}`} {...info} {...name(true)}>
        <CardHeader card={card} size="text-xl" />
        {body}
      </section>
    );
  }
  // 無外框的卡片只放內容
  if (card.frame === "bare") {
    return (
      <section class={span} {...info} {...name(false)}>
        {body}
      </section>
    );
  }
  // 卡面依外框選用：一般卡片是不透明的卡面，重點卡片與常駐卡片是浮起的玻璃。貼在頂端由外層負責
  // 手機上常駐列的外層已經是延伸到螢幕邊緣的玻璃並繪製底線，這張卡改為透明，不再往外延伸，也不繪製框線
  const surface = CARD_SURFACES[card.frame] ?? CARD_SURFACES.card;
  // 一般卡片有標題列，以標題當名稱。常駐列不顯示標題列只放內容，名稱寫在 aria-label。問題與資訊按鈕取決於卡片有沒有寫
  const headed = card.frame !== "sticky";
  return (
    <section class={`${span} flex flex-col gap-4 border p-5 sm:rounded-2xl ${surface} ${phone}`} {...info} {...name(headed)}>
      {/* 常駐列沒有標題列，其餘卡片在內容上方放標題列 */}
      {headed ? <CardHeader card={card} size="text-lg" /> : null}
      {body}
    </section>
  );
}

/**
 * 頁尾：資料儲存、授權與資料版本，與「更多」視窗同一份。
 * @param {{ lines: string[] }} props lines 是由上而下的各行。
 * @returns {JSX.Element}
 */
function Footer({ lines }) {
  return (
    <footer class="mt-12 border-t border-border bg-surface max-sm:hidden">
      <div class={`mx-auto flex ${WIDTHS.page} flex-col gap-2 px-4 py-6 text-xs text-ink-muted`}>
        {lines.map((line) => (
          <p key={line} class="tabular-nums">
            {line}
          </p>
        ))}
      </div>
    </footer>
  );
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 檢視他人分享的結果時的說明列：accent-soft 底，左邊是說明，右邊是回到自己的作答與開始作答。手機上按鈕排到說明下方。
 * @param {{ banner: { text: string, actions: object[] } }} props banner 是說明與按鈕描述。
 * @returns {JSX.Element}
 */
function SharedBanner({ banner }) {
  return (
    <div class="border-b border-border bg-accent-soft" role="status">
      <div class={`mx-auto flex ${WIDTHS.page} flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between`}>
        <p class="text-sm leading-relaxed text-ink">{banner.text}</p>
        <div class="flex shrink-0 gap-2">
          {banner.actions.map((item) => (
            <Button key={item.action} {...item} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 手機的底部分頁列：layout 的 mobileNav 各一格，加上「更多」。平板起不顯示，改用頁首的導覽。
 * @param {{ tabs: { items: { page: string, label: string, short: string, icon: string, action: string, current: boolean, lock: string|null }[], more: object } }} props tabs 是分頁與「更多」的描述，「更多」與分頁的欄位相同。
 * @returns {JSX.Element}
 */
function BottomNav({ tabs }) {
  // 浮在畫面底部的玻璃膠囊，左右與下緣留空，下緣至少讓出手機的安全區域
  // 各格等寬，格數是分頁加上「更多」。每格是圖示加兩個字的短名稱，完整頁名留在 aria-label。所在頁面填上淡色膠囊，鎖住的入口淡化
  const items = [...tabs.items, tabs.more];
  return (
    <nav class="glass-float fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 grid gap-1 rounded-full border p-1 sm:hidden" style={`grid-template-columns:repeat(${items.length},minmax(0,1fr))`} aria-label={text("common.nav")}>
      {items.map((item) => (
        <EntryButton key={item.page} item={item} base="flex h-14 flex-col items-center justify-center gap-0.5 rounded-full text-xs" tones={TAB_TONES} currentMark="page">
          <Icon name={item.icon} size="size-5" />
          {item.short}
        </EntryButton>
      ))}
    </nav>
  );
}

/**
 * 手機結果頁的分區分頁籤：等寬的文字分頁，所在分區以強調色底線標示。平板起所有分區照常同時顯示，這一列不出現。
 * @param {{ sections: { label: string, items: { key: string, label: string, action: string, selected: boolean }[] } }} props sections 是分區描述。
 * @returns {JSX.Element}
 */
function SectionTabs({ sections }) {
  // 各格平分整列寬度，不依文字長短伸縮。320 px 寬時一格 64 px，放得下四個字
  return (
    <div class="grid auto-cols-[minmax(0,1fr)] grid-flow-col border-b border-border sm:hidden" role="tablist" aria-label={sections.label}>
      {sections.items.map((item) => (
        <button key={item.key} type="button" role="tab" aria-selected={String(item.selected)} class={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm ${item.selected ? "border-accent font-medium text-accent" : "border-transparent text-ink-muted"}`} data-action={item.action}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 整頁：跳到主要內容的連結、頁首、卡片網格，以及頁尾或流程頁的步驟導覽。
 * @param {{ spec: object }} props spec 是 buildPage 的結果，外框需要的品牌、頁名、導覽、切換與頁尾都在其中。
 * @returns {JSX.Element}
 */
function Page({ spec }) {
  const flow = spec.template === "flow";
  const top = useRef(null);
  // 頁首的高度隨寬度、導覽行數與縮放改變，量測畫面上的高度並寫入 `--header-height`，常駐列固定在它下方，捲動定位也保留這段高度
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--header-height", `${top.current.getBoundingClientRect().height}px`));
    observer.observe(top.current);
    return () => observer.disconnect();
  }, []);
  // 流程頁換成流程頁首與底部的步驟導覽，沒有頁尾。其餘版型用導覽頁首與頁尾。常駐卡片是選填，有的話排在一般卡片之前
  // 外層裁切橫向超出的內容，整頁維持視窗的寬度，不會左右捲動。clip 不建立捲動容器，固定的頁首與勾選列仍然貼齊頂端
  return (
    <div class={`flex min-h-screen flex-col overflow-x-clip ${flow ? "max-sm:bg-surface" : "max-sm:pb-[calc(6rem+env(safe-area-inset-bottom))]"}`}>
      {/* 頁面底下的柔光固定在視窗後面，捲動時不移動，玻璃透出的顏色來自它 */}
      <div class="pointer-events-none fixed inset-0 -z-10 bg-(image:--glow)" aria-hidden="true" />
      <a href="#main" class="sr-only text-sm focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        {text("common.skip")}
      </a>
      {/* 頁首固定在頂端，與流程頁的步驟導覽、手機的底部分頁列對稱，兩種頁首共用這一層 */}
      <div ref={top} class="sticky top-0 z-10">
        {flow ? <FlowHeader spec={spec} /> : <Header spec={spec} />}
      </div>
      {/* 檢視他人分享的結果時，頁首下方多一條說明列 */}
      {spec.banner ? <SharedBanner banner={spec.banner} /> : null}
      <main id="main" class={`mx-auto w-full flex-1 px-4 ${WIDTHS[flow ? spec.width : "page"]} ${MAIN_PADDING[spec.template]}`}>
        {/* 頁面有可見的主標時不另放視覺隱藏的 h1，每頁只有一個 h1 */}
        {spec.titled ? null : <h1 class="sr-only">{spec.title}</h1>}
        <div class={`grid grid-cols-12 ${flow ? "gap-5 max-sm:gap-0" : "gap-4 max-sm:gap-3"}`}>
          {/* 常駐卡片與手機的分區分頁籤一起固定在頁首下方，沒有常駐卡片的頁面只固定分頁籤。頁首高度以畫面上的像素量測，除以縮放倍數換算為版面的像素 */}
          {spec.sticky || spec.sections ? (
            <div class={`sticky top-[calc(var(--header-height,0px)/var(--zoom,1))] z-10 col-span-12 flex flex-col max-sm:glass max-sm:-mx-4 max-sm:border-b ${spec.sticky ? "" : "sm:hidden"}`}>
              {/* 手機的分區分頁籤在最上面，下面是勾選列，兩者是同一塊卡面。寬螢幕沒有分頁籤，沒有常駐卡片時整塊隱藏，不多占一列間距 */}
              {spec.sections ? <SectionTabs sections={spec.sections} /> : null}
              {spec.sticky ? <CardFrame key={spec.sticky.id} card={spec.sticky} /> : null}
            </div>
          ) : null}
          {/* 有分區時，手機只顯示所在分區的卡片 */}
          {spec.cards.map((card) => (
            <CardFrame key={card.id} card={card} phoneHidden={Boolean(card.section && spec.section && card.section !== spec.section)} />
          ))}
        </div>
      </main>
      {/* 流程頁的底部是步驟導覽，作答頁由題目自己的上下題導覽 */}
      {flow && spec.stepNav ? <StepNav nav={spec.stepNav} /> : null}
      {/* 手機沒有頁尾，資料儲存與授權寫在「更多」裡 */}
      {flow ? null : <Footer lines={spec.about} />}
      {/* 手機的底部分頁列，流程頁用步驟導覽取代 */}
      {flow ? null : <BottomNav tabs={spec.tabs} />}
    </div>
  );
}

/**
 * 視窗。掛載時把焦點移到標題，Tab 在視窗內循環，關閉後焦點回到開啟前的元素。
 * @param {{ spec: { title: string, blocks: object[] } }} props spec 是視窗內容，blocks 可含 null，略過不繪製。
 * @returns {JSX.Element}
 */
function Modal({ spec }) {
  const dialog = useRef(null);
  const title = useRef(null);
  // 掛載時記下開啟視窗前的焦點並把焦點移到標題，卸載時還給原來的元素。內容更新時不重新執行，不搶走使用者正在操作的焦點
  // 移動焦點時不捲動，頁面停在開啟視窗前的位置
  useEffect(() => {
    const opener = document.activeElement;
    title.current?.focus({ preventScroll: true });
    // 畫面更新可能替換開啟視窗的元素，還在頁面上時才還回焦點
    return () => opener?.isConnected && opener.focus({ preventScroll: true });
  }, []);
  /**
   * Tab 在視窗內循環：到最後一個可聚焦元素時回到第一個，Shift+Tab 反向。
   * @param {KeyboardEvent} event 鍵盤事件。
   */
  const trap = (event) => {
    // 只處理 Tab
    if (event.key !== "Tab") return;
    // 停用的按鈕不能聚焦，不算在循環內
    const focusable = [...dialog.current.querySelectorAll(FOCUSABLE)].filter((element) => !element.disabled);
    const first = focusable[0];
    const last = focusable.at(-1);
    // Shift+Tab 從第一個元素或標題往前時跳到最後一個
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title.current)) {
      event.preventDefault();
      last?.focus();
      return;
    }
    // Tab 從最後一個元素往後時回到第一個
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  // 背景設定 data-backdrop，點到背景時由 app 層關閉視窗。窄螢幕貼齊底部，寬螢幕置中
  return (
    <div class="fixed inset-0 z-40 flex items-end justify-center bg-scrim p-0 backdrop-blur-xs sm:items-center sm:p-6" data-backdrop="true">
      <div ref={dialog} class="raised flex max-h-[calc(90vh/var(--zoom,1))] w-full max-w-3xl flex-col rounded-t-3xl border border-b-0 sm:rounded-3xl sm:border-b" role="dialog" aria-modal="true" aria-labelledby="modal-title" onKeyDown={trap}>
        <header class="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <h2 ref={title} id="modal-title" tabindex="-1" class="text-lg font-semibold text-ink outline-none">
            {spec.title}
          </h2>
          <Button label={text("common.close")} icon="close" iconOnly size="sm" action="closeModal" tone="quiet" />
        </header>
        {/* 內容區有高度上限，區塊一律不壓縮，可橫向捲動的表格才高度不會縮成零，超出時整區上下捲動 */}
        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4 [scrollbar-width:thin] [&>*]:shrink-0">
          <Blocks specs={spec.blocks} />
        </div>
      </div>
    </div>
  );
}

/**
 * 擋板：程式與資料不一致或載入失敗時取代整頁。
 * @param {{ spec: { title: string, text: string, detail?: string } }} props spec 是擋板內容。
 * @returns {JSX.Element}
 */
function Gate({ spec }) {
  // 詳細錯誤訊息是選填，沒有時不留空行
  return (
    <div class="flex min-h-screen items-center justify-center p-6">
      <div class="flex max-w-lg flex-col gap-4 rounded-2xl border border-border bg-surface p-6" role="alert">
        <div class="flex items-center gap-2">
          <BrandMark />
          <span class="text-lg font-semibold text-ink">{text("brand.name")}</span>
        </div>
        <h1 class="text-xl font-semibold text-ink">{spec.title}</h1>
        <p class="text-sm leading-relaxed text-ink-secondary">{spec.text}</p>
        {spec.detail ? <p class="font-mono text-xs text-ink-muted break-all">{spec.detail}</p> : null}
        <div>
          <Button label={text("gate.reload")} action="reload" tone="accent" />
        </div>
      </div>
    </div>
  );
}

/**
 * 提示訊息。
 * @param {{ spec: { message: string, tone?: string } }} props spec 是提示內容。
 * @returns {JSX.Element}
 */
function Toast({ spec }) {
  // 嚴重的提示用警示色，其餘維持一般文字色
  const tone = spec.tone === "critical" ? "text-critical" : "text-ink";
  return (
    <div class={`glass-float fixed bottom-24 start-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-2xl border px-4 py-2 text-sm sm:bottom-6 ${tone}`} role="status">
      {spec.message}
    </div>
  );
}

/**
 * hover 與聚焦的說明，固定定位在目標上方，上方空間不夠時改放下方。
 * @param {{ tip: { text: string, rect: { top: number, bottom: number, left: number, width: number } }|null }} props tip 是說明文字與目標的位置，null 時隱藏。
 * @returns {JSX.Element}
 */
function Tooltip({ tip }) {
  const node = useRef(null);
  // 說明出現或換目標時，依說明實際的大小重新定位，橫向不超出視窗
  useLayoutEffect(() => {
    // 隱藏時不必定位
    if (!tip) return;
    const box = node.current;
    const top = tip.rect.top - box.offsetHeight - TIP_GAP;
    // 上方空間不夠時放在下方
    box.style.top = `${top < 0 ? tip.rect.bottom + TIP_GAP : top}px`;
    box.style.left = `${clamp(tip.rect.left + tip.rect.width / 2 - box.offsetWidth / 2, TIP_GAP, window.innerWidth - box.offsetWidth - TIP_GAP)}px`;
  }, [tip]);
  // 隱藏時保留元素只加 hidden，下次出現不必重建
  return (
    <div ref={node} class={`pointer-events-none fixed z-50 ${tip ? "" : "hidden"} max-w-xs rounded-lg bg-ink px-2.5 py-1.5 text-xs text-page shadow-lg`} role="tooltip">
      {tip?.text ?? ""}
    </div>
  );
}

/**
 * 載入中的畫面。
 * @returns {JSX.Element}
 */
function Loading() {
  return (
    <div class="flex min-h-screen items-center justify-center gap-3 text-sm text-ink-muted" role="status">
      <BrandMark size="size-6" />
      {text("common.loading")}
    </div>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Page, Modal, Gate, Toast, Tooltip, Loading };
