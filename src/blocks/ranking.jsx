/* ==================================================
 * blocks/ranking.jsx - 結果排名與候選人列
 * --------------------------------------------------
 * - 角色：結果排名、常駐的候選人勾選列與卡片內的候選人切換的 Preact 元件
 * - 指令：由 blocks/block.jsx 登錄，不直接匯入
 * - 慣例：
 *   - 每位候選人以代碼當 key，排序改變時元素跟著候選人移動，焦點與滑過的說明不會換人
 *   - 政黨標記只在描述帶有 party 時繪製，翻牌前 cards 層不提供
 * ================================================== */

import { Button, Badge, PartyMark, Swatch, seriesProps } from "./ui.jsx";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 結果排名：名次、名稱、總分條、分項、註記與標記。
 * @param {{ spec: { items: object[] } }} props 區塊描述，items[].metrics 是選填的分項清單（標籤、顯示值與 0 到 1 的比例）。
 * @returns {JSX.Element}
 */
function Ranking({ spec }) {
  // 副標的政黨標記與備註是選填，條的寬度由 0 到 1 的比例換算成百分比
  return (
    <ol class="flex flex-col gap-2">
      {spec.items.map((item) => (
        <li key={item.id}>
          <button type="button" class="grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg border border-border bg-surface p-3 text-start hover:border-accent" data-action={item.action} {...seriesProps(item.series, item.mark)}>
            <span class="text-base font-semibold tabular-nums text-ink-muted">{String(item.rank)}</span>
            <span class="flex min-w-0 flex-col gap-1.5">
              <span class="flex flex-wrap items-center gap-2">
                <Swatch series={item.series} mark={item.mark} />
                <span class="text-base font-medium text-ink">{item.label}</span>
                {item.party ? <PartyMark party={item.party.mark} name={item.party.name} /> : null}
                {item.badge ? <Badge {...item.badge} /> : null}
              </span>
              <span class="h-1.5 overflow-hidden rounded-full bg-sunken">
                <span class="block h-full rounded-full bg-(--series)" style={`width:${((item.bar ?? 0) * 100).toFixed(1)}%`} />
              </span>
              {/* 分項依描述列出，區塊不認得分項的名稱。手機每項一行，名稱、迷你條與數值三欄對齊。平板起排成一行，放不下時換行 */}
              {item.metrics ? (
                <span class="grid grid-cols-[auto_3rem_auto] items-center justify-start gap-x-2 gap-y-1 text-xs sm:flex sm:flex-wrap sm:gap-x-3">
                  {item.metrics.map((metric) => (
                    <span key={metric.label} class="contents sm:inline-flex sm:items-center sm:gap-1.5">
                      <span class="text-ink-muted">{metric.label}</span>
                      {/* 沒有值的分項不畫迷你條，手機留一格空白讓數值對齊 */}
                      {metric.ratio === null ? (
                        <span class="sm:hidden" />
                      ) : (
                        <span class="h-1.5 w-12 overflow-hidden rounded-full bg-sunken">
                          <span class="block h-full rounded-full bg-(--series)" style={`width:${(metric.ratio * 100).toFixed(1)}%`} />
                        </span>
                      )}
                      <span class="tabular-nums text-ink">{metric.value}</span>
                    </span>
                  ))}
                </span>
              ) : null}
              <span class="text-xs text-ink-muted">{item.note}</span>
            </span>
            <span class="text-2xl font-semibold tabular-nums text-ink">{item.value}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * 常駐的候選人勾選列：勾選比較與翻牌，影響結果頁的每一張圖。
 * @param {{ spec: { label: string, items: { id: string, label: string, checked: boolean, series: number, mark?: object|null, party: object|null, action: string }[], reveal: object|null } }} props 區塊描述，reveal 是選填的翻牌鈕按鈕描述。
 * @returns {JSX.Element}
 */
function CandidateBar({ spec }) {
  // 每位候選人一個膠囊，點一下切換是否納入比較。勾選中的膠囊外框用候選人的系列色，取消的淡化並改為虛線
  // 手機排成一列左右滑動，膠囊縮小一級、黨名只留色點、「比較」標籤隱藏，右緣淡出，提示仍可滑動。翻牌鈕只留圖示，常駐列只占一行高
  return (
    <div class="flex items-center gap-2">
      <span class="me-1 shrink-0 text-xs text-ink-muted max-sm:sr-only">{spec.label}</span>
      <div class="flex min-w-0 flex-1 gap-2 overflow-x-auto pe-6 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)] sm:flex-wrap sm:pe-0">
        {spec.items.map((item) => (
          <button key={item.id} type="button" role="checkbox" aria-checked={String(item.checked)} class={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-2.5 text-xs text-ink hover:bg-sunken sm:h-8 sm:px-3 sm:text-sm ${item.checked ? "border-(--series)" : "border-dashed border-border opacity-60"}`} {...seriesProps(item.series, item.mark)} data-action={item.action}>
            <Swatch series={item.series} mark={item.mark} />
            {item.label}
            {/* 政黨標記只在翻牌後出現，優先用簡稱 */}
            {item.party ? <PartyMark party={item.party.mark} name={item.party.short} compact /> : null}
          </button>
        ))}
      </div>
      {/* 翻牌鈕是選填，檢視他人分享的結果時一律翻牌，沒有這顆鈕 */}
      {spec.reveal ? <Button {...spec.reveal} tone="neutral" size="sm" iconOnly="phone" extra="ms-auto" /> : null}
    </div>
  );
}

/**
 * 卡片內的候選人切換：一次選一位，放在受影響的圖上方。
 * @param {{ spec: { label: string, items: { id: string, label: string, series: number, mark?: object|null, selected: boolean, action: string }[] } }} props 區塊描述，label 是群組名稱。
 * @returns {JSX.Element}
 */
function CandidatePicker({ spec }) {
  // 單選群組，選中的一位填入系列色的淡底，只有選中的一位在 Tab 順序內
  return (
    <div class="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={spec.label}>
      <span class="me-1 text-xs text-ink-muted">{spec.label}</span>
      {spec.items.map((item) => (
        <button key={item.id} type="button" role="radio" aria-checked={String(item.selected)} tabindex={item.selected ? "0" : "-1"} class={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${item.selected ? "border-(--series) bg-sunken font-medium text-ink" : "border-border text-ink-secondary hover:bg-sunken"}`} {...seriesProps(item.series, item.mark)} data-action={item.action}>
          <Swatch series={item.series} mark={item.mark} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Ranking, CandidateBar, CandidatePicker };
