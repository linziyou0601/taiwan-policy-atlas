/* ==================================================
 * blocks/charts.jsx - 圖表區塊
 * --------------------------------------------------
 * - 角色：長條圖、兩極光譜、雷達圖、熱力圖、桑基圖、treemap 與直方圖的 Preact 元件
 * - 指令：由 blocks/block.jsx 登錄，不直接匯入
 * - 慣例：
 *   - 互動契約：hover 與鍵盤聚焦顯示 data-tip，點擊或 Enter 執行 data-action 開啟明細，圖例按鈕切換系列
 *   - 長條、兩極光譜、熱力圖、treemap 與直方圖以 HTML 排版，文字維持 CSS 字級。雷達圖與桑基圖用 SVG，圖上的文字一律是螢幕上的 12 px，不隨圖縮放：雷達圖依 SVG 的實際寬度換算字級，桑基圖以 1 個 viewBox 單位等於 1 px 排版，比容器寬時在檢視框內拖曳
 *   - 系列色以 data-series 指定，熱力圖以級距加數值呈現，不只靠顏色
 * ================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { clamp } from "../lib/format.js";
import { hasValue } from "../lib/objects.js";
import { Button, Swatch } from "./ui.jsx";
import { radarGeometry } from "./radar.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 雷達圖的尺寸與同心圓比例，margin 是 viewBox 在圖的左右與上下另外留給軸標籤的空間。
 */
const RADAR = { size: 360, radius: 120, rings: [0.25, 0.5, 0.75, 1], labelGap: 18, margin: { x: 70, y: 10 } };

/**
 * treemap 格內每列第 2 層文字約占的高度比例（%），格子太矮時少列幾項，避免文字只露出一半。
 */
const TREEMAP_LINE = 6;

/**
 * 直方圖最高一條的高度（rem），直條以 rem 指定高度，不依賴父層的百分比高度。
 */
const HISTOGRAM_HEIGHT = 6;

/**
 * 熱力格各級的底色與文字色，鍵是 tierOf 的結果。以 accent 的透明度分級，格子放在 surface 的卡片上，搭配文字數值，不只靠顏色。沒有值的格子是虛線框。
 */
const HEAT_TONES = {
  1: "bg-accent/18",
  2: "bg-accent/38",
  3: "bg-accent/60 text-on-accent",
  4: "bg-accent text-on-accent",
  none: "bg-surface text-ink-muted outline-1 -outline-offset-3 outline-dashed outline-baseline",
};

/**
 * 縮放檢視框的設定：最大倍率、按鈕每次的倍數、滾輪每單位捲動量換成的指數倍率，以及拖曳超過幾個像素才算拖曳。拖曳距離是指標座標，以像素計。最小倍率依內容與檢視框的寬度計算，縮到最小時整張圖放進檢視框。
 */
const ZOOM = { max: 6, step: 1.4, wheel: 0.01, dragThreshold: 4 };

/**
 * SVG 圖表文字在螢幕上的字級（px），與 text-xs 相同。
 */
const CHART_TEXT = 12;

/**
 * treemap 格子的混色比例範圍（百分比）：shade 為 0 時系列色占最低值，為 1 時占最高值，最深時文字仍讀得清楚。
 */
const TREEMAP_SHADE = [12, 55];

/**
 * 桑基圖的尺寸，單位是 px：節點寬、節點間距、最小高度、每個節點的最低列高、欄與欄的最小距離，以及標籤與節點的間距。欄數由節點決定，左右標籤區依標籤的字寬計算。
 */
const SANKEY = { nodeWidth: 12, gap: 8, minHeight: 360, rowHeight: 22, minGap: 113, labelGap: 6 };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 量測元素的內容寬度，寬度改變時更新。手機上不在所在分區的卡片寬度為 0，這時沿用上一次的值，切換到那個分區時再量。
 * @param {{ current: Element|null }} ref 要量測的元素。
 * @returns {number|null} 寬度（px），還沒量到時為 null。
 */
function useWidth(ref) {
  const [width, setWidth] = useState(null);
  useLayoutEffect(() => {
    // 寬度為 0 時不更新，避免隱藏的卡片把圖排成零寬
    const observer = new ResizeObserver(([entry]) => entry.contentRect.width > 0 && setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return width;
}

/**
 * 估算一段標籤在 12 px 字級下的寬度（px）：中日韓文字算一個字寬，其餘算 0.6 個字寬，與網站字型的數字寬度相同。
 * @param {string} text 標籤。
 * @returns {number}
 */
function textWidth(text) {
  // 碼位在中日韓區段以上的字算全形
  return [...text].reduce((sum, char) => sum + (char.codePointAt(0) > 0x2e80 ? 1 : 0.6), 0) * CHART_TEXT;
}

/**
 * 依刻度把值換成 0 到 100 的百分比位置。
 * @param {number} value 值。
 * @param {[number, number]} scaleRange 刻度範圍。
 * @returns {number}
 */
function position(value, [low, high]) {
  return clamp(((value - low) / (high - low || 1)) * 100, 0, 100);
}

/**
 * 互動元素共用的屬性：可聚焦、可點、hover 說明，以展開運算子寫進元素。
 * @param {string|null} action 動作。
 * @param {string|null} tip 說明。
 * @returns {object} tabindex、role、data-action、data-tip 與 aria-label。
 */
function interactive(action, tip) {
  // 有動作才可聚焦並標為按鈕，沒有動作的元素維持純顯示，不干擾鍵盤的跳轉順序
  return { tabindex: action ? "0" : null, role: action ? "button" : null, "data-action": action, "data-tip": tip, "aria-label": tip ?? null };
}

/**
 * 依級距邊界決定熱力格的級數。
 * @param {number|null} value 值。
 * @param {number[]} tiers 邊界。
 * @returns {string}
 */
function tierOf(value, tiers) {
  // 沒有值的格子另有樣式
  if (value === null) return "none";
  return String(tiers.filter((edge) => value >= edge).length + 1);
}

/**
 * Squarified treemap：把值依比例排進矩形，回傳百分比座標。
 * @param {{ value: number }[]} items 已依值由大到小排序。
 * @param {{ x: number, y: number, w: number, h: number }} rect 範圍。
 * @returns {{ item: object, x: number, y: number, w: number, h: number }[]}
 */
function squarify(items, rect) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const placed = [];
  // 尚未排進任何一列的項目，每封閉一列就從前面縮短
  let remaining = [...items];
  let area = { ...rect };
  let left = total;
  // 每次沿短邊排一列，直到放完
  while (remaining.length) {
    const short = Math.min(area.w, area.h);
    const scale = (area.w * area.h) / left;
    // 目前正在累積的一列，worst 記錄加入後最差的長寬比，用來判斷何時封閉
    let row = [];
    let worst = Infinity;
    // 逐項加入這一列，長寬比變差時停止
    for (const item of remaining) {
      const next = [...row, item];
      const sum = next.reduce((s, it) => s + it.value * scale, 0);
      // 長寬比取長邊除以短邊，越接近 1 越方正，整列以最差的一格為準
      const ratios = next.map((it) => {
        const length = (it.value * scale) / (sum / short);
        return Math.max(length / (sum / short), sum / short / length);
      });
      // 這一列加入新項目後的最差長寬比，與加入前比較才知道是否變差
      const candidate = Math.max(...ratios);
      // 長寬比沒有變差時繼續加入
      if (candidate > worst) break;
      worst = candidate;
      row = next;
    }
    // 這一列確定後依總面積算出它沿短邊的厚度，各格再按比例分長度
    const rowSum = row.reduce((s, it) => s + it.value * scale, 0);
    const thickness = rowSum / short;
    let offset = 0;
    // 沿短邊依序放入這一列
    for (const item of row) {
      const length = (item.value * scale) / thickness;
      const horizontal = area.w >= area.h;
      // 範圍橫向較長時這一列成為靠左的一欄由上往下疊放，否則成為靠上的一列由左往右並排
      placed.push(horizontal ? { item, x: area.x, y: area.y + offset, w: thickness, h: length } : { item, x: area.x + offset, y: area.y, w: length, h: thickness });
      offset += length;
    }
    // 剩下的範圍扣除這一列
    area = area.w >= area.h ? { x: area.x + thickness, y: area.y, w: area.w - thickness, h: area.h } : { x: area.x, y: area.y + thickness, w: area.w, h: area.h - thickness };
    left -= row.reduce((s, it) => s + it.value, 0);
    remaining = remaining.slice(row.length);
  }
  return placed;
}

/**
 * 可縮放與拖曳的檢視框：放大、縮小、重設三個鈕，按住拖曳移動，觸控板捏合或 Ctrl 加滾輪縮放。
 * 倍率 1 時一個單位等於一個像素，內容比檢視框寬或高時拖曳查看，縮到最小時整張圖放進檢視框。
 * @param {{ labels: { in: string, out: string, reset: string, hint: string }, size: { width: number, height: number }, children: unknown }} props labels 是按鈕名稱與操作說明，size 是內容在倍率 1 時的寬高（px）。
 * @returns {JSX.Element}
 */
function ZoomPan({ labels, size, children }) {
  // 倍率與位移是這個元件自己的畫面狀態，切換頁面或重新整理時回到原始大小
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const frame = useRef(null);
  // 最小倍率讓整張圖剛好放進檢視框，內容比檢視框窄時最小就是 1
  const frameWidth = useWidth(frame);
  // 還沒量到檢視框時先以 1 為最小倍率
  const min = frameWidth ? Math.min(1, frameWidth / size.width) : 1;
  // 拖曳中的起點，放開後到下一次點擊前保留，用來分辨拖曳與點擊
  const drag = useRef(null);
  /**
   * 以檢視框內的一點為中心縮放，那一點在縮放前後停在同一個位置。
   * @param {number} factor 倍數。
   * @param {number} cx 中心點的 x，相對於檢視框。
   * @param {number} cy 中心點的 y。
   */
  const zoomAt = (factor, cx, cy) =>
    setView((current) => {
      const scale = clamp(current.scale * factor, min, ZOOM.max);
      // 縮到最小時位置一併歸零，圖不會停在偏一邊的地方
      if (scale === min) return { scale, x: 0, y: 0 };
      const k = scale / current.scale;
      return { scale, x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k };
    });
  /**
   * 以檢視框的中心縮放，按鈕使用。
   * @param {number} factor 倍數。
   */
  const zoomCenter = (factor) => {
    const rect = frame.current.getBoundingClientRect();
    zoomAt(factor, rect.width / 2, rect.height / 2);
  };
  // 滾輪要能取消預設的捲動，只能用非被動的監聽，所以在掛載時自行綁定
  useEffect(() => {
    const element = frame.current;
    /**
     * 觸控板捏合會送出帶 ctrlKey 的滾輪事件，一般滾輪要按住 Ctrl 或 Command 才縮放，其餘照常捲動頁面。
     * @param {WheelEvent} event 滾輪事件。
     */
    const onWheel = (event) => {
      // 沒按 Ctrl 的滾輪交給頁面捲動
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      // 滾動量換成倍數，以游標所在的點為中心縮放
      zoomAt(Math.exp(-event.deltaY * ZOOM.wheel), event.clientX - rect.left, event.clientY - rect.top);
    };
    // 卸載時一併移除監聽
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);
  /**
   * 按下時記下起點，移動超過門檻才開始拖曳，短按仍是點擊。
   * @param {PointerEvent} event 指標事件。
   */
  const onPointerDown = (event) => {
    drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false };
  };
  /**
   * 拖曳時移動內容。
   * @param {PointerEvent} event 指標事件。
   */
  const onPointerMove = (event) => {
    const start = drag.current;
    // 沒有按下、主鍵已放開或還沒超過門檻時不移動
    if (!start || !(event.buttons & 1) || (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < ZOOM.dragThreshold)) return;
    // 第一次超過門檻時接管指標，拖到框外也繼續移動
    if (!start.moved) frame.current.setPointerCapture(event.pointerId);
    start.moved = true;
    setView((current) => ({ ...current, x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y }));
  };
  /**
   * 放開或瀏覽器取消指標時結束拖曳。拖曳過的起點留給接著的點擊攔截，沒拖曳過就直接清除。
   * @param {PointerEvent} event 指標事件。
   */
  const onPointerEnd = (event) => {
    // 瀏覽器取消指標時不會有點擊，起點一律清除
    if (event.type === "pointercancel" || !drag.current?.moved) drag.current = null;
  };
  /**
   * 拖曳結束後的那一次點擊不算點擊，節點不會因為放開滑鼠而開啟明細。
   * @param {MouseEvent} event 點擊事件。
   */
  const onClickCapture = (event) => {
    // 剛拖曳過時攔截這次點擊
    if (drag.current?.moved) {
      event.stopPropagation();
      event.preventDefault();
    }
    // 點擊之後清除起點，下一次按下重新開始
    drag.current = null;
  };
  // 檢視框的高度等於內容高度，太高時固定在上限，超出的部分與比檢視框寬的部分都拖曳查看
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-ink-muted">{labels.hint}</span>
        <div class="flex shrink-0 gap-1">
          <Button label={labels.out} icon="zoomOut" iconOnly size="sm" tone="neutral" onClick={() => zoomCenter(1 / ZOOM.step)} disabled={view.scale <= min} />
          <Button label={labels.in} icon="zoomIn" iconOnly size="sm" tone="neutral" onClick={() => zoomCenter(ZOOM.step)} disabled={view.scale >= ZOOM.max} />
          <Button label={labels.reset} icon="fit" iconOnly size="sm" tone="neutral" onClick={() => setView({ scale: 1, x: 0, y: 0 })} />
        </div>
      </div>
      <div ref={frame} class="relative max-h-140 w-full touch-none overflow-hidden rounded-lg border border-border cursor-grab active:cursor-grabbing" style={`height:${size.height + 2}px`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onClickCapture={onClickCapture}>
        <div class="origin-top-left" style={`transform:translate(${view.x}px,${view.y}px) scale(${view.scale})`}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 水平長條圖，可畫上下界。
 * @param {{ spec: { items: { id: string, label: string, value: number|null, lower?: number|null, upper?: number|null, display: string, tip?: string, muted?: boolean, series: number|null, action?: string }[], scale: [number, number], axisLabel: string, compact?: boolean, wrap?: boolean } }} props 區塊描述，lower 與 upper 是選填的上下界，series 為 null 時不寫系列色，wrap 讓標籤完整換行。
 * @returns {JSX.Element}
 */
function Bars({ spec }) {
  // 清單本身只放長條列，軸說明放在清單外面
  return (
    <div class="flex flex-col gap-1">
      <div class="flex flex-col gap-1" role="list" aria-label={spec.axisLabel}>
        {spec.items.map((item) => {
          // 沒有值的列畫空條，仍保留標籤與位置，列與列才對得齊
          const width = hasValue(item.value) ? position(item.value, spec.scale) : 0;
          const hasRange = hasValue(item.lower) && hasValue(item.upper);
          // 外層是清單項目，內層的列才帶動作，兩者的角色不會互相覆蓋
          // 有動作的列才加手型游標與 hover 底色，與熱力格和排名列的互動樣式一致。系列為 null 時不寫系列色
          return (
            <div key={item.id} role="listitem">
              <div class={`grid grid-cols-[minmax(6rem,10rem)_1fr_3.5rem] items-center gap-3 rounded-lg px-1 py-1 ${item.action ? "cursor-pointer hover:bg-sunken" : ""}`} {...interactive(item.action ?? null, item.tip ?? null)} data-series={item.series === null ? null : String(item.series ?? 0)}>
                {/* 標籤預設截短成一行，wrap 時完整換行，例如選項的全文 */}
                <span class={`text-sm text-ink ${spec.wrap ? "" : "truncate"}`}>{item.label}</span>
                <span class={`relative ${spec.compact ? "h-3" : "h-5"} rounded-full bg-sunken`}>
                  {/* 沒有指定系列時用強調色，例如使用者自己的分布 */}
                  <span class={`${item.series === null ? "bg-accent" : "bg-(--series)"} absolute inset-y-0 start-0 rounded-full ${item.muted ? "opacity-40" : ""}`} style={`width:${width.toFixed(1)}%`} />
                  {/* 有上下界時畫一條範圍線 */}
                  {hasRange ? <span class="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ink" style={`left:${position(item.lower, spec.scale).toFixed(1)}%;width:${(position(item.upper, spec.scale) - position(item.lower, spec.scale)).toFixed(1)}%`} aria-hidden="true" /> : null}
                </span>
                <span class="text-end text-sm tabular-nums text-ink-secondary">{item.display ?? ""}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p class="pt-1 text-xs text-ink-muted">{spec.axisLabel}</p>
    </div>
  );
}

/**
 * 兩極光譜：每條軸一列，左端是負極、右端是正極，長條依位置分成兩段，兩端寫出各極的比例。
 * @param {{ spec: { label: string, min: number, max: number, items: { id: string, label: string, band: string|null, value: number|null, negative: string, positive: string, tip: string }[] } }} props 區塊描述，negative 與 positive 是兩端的文字，已含比例。
 * @returns {JSX.Element}
 */
function Spectrum({ spec }) {
  return (
    <ul class="flex flex-col gap-4" aria-label={spec.label}>
      {spec.items.map((item) => {
        // 位置換成正極所占的百分比，沒有位置的軸只畫空的底
        const share = hasValue(item.value) ? clamp(((item.value - spec.min) / (spec.max - spec.min)) * 100, 0, 100) : null;
        // 兩段各取一個系列色，左段是負極、右段是正極
        return (
          <li key={item.id} class="flex flex-col gap-1.5">
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-sm font-medium text-ink">{item.label}</span>
              <span class="text-sm text-ink-secondary">{item.band ?? ""}</span>
            </div>
            <div class="flex h-4 overflow-hidden rounded-full bg-sunken" role="img" aria-label={item.tip} title={item.tip}>
              {share === null ? null : <span class="bg-(--series)" data-series="1" style={`width:${(100 - share).toFixed(1)}%`} />}
              {share === null ? null : <span class="bg-(--series)" data-series="2" style={`width:${share.toFixed(1)}%`} />}
            </div>
            <div class="flex justify-between gap-3 text-xs tabular-nums text-ink-secondary" aria-hidden="true">
              <span>{item.negative}</span>
              <span>{item.positive}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 雷達圖：每軸一條放射線，每個系列一條多邊形（選舉是使用者與各候選人，主題測驗只有使用者），圖例可切換。
 * @param {{ spec: { label: string, axes: { code: string, label: string, tip: string }[], series: { id: string, label: string, values: Record<string, number|null>, tips: Record<string, string>, series: number, hidden: boolean, toggle: string, action?: string }[], min: number, max: number } }} props 區塊描述，values 與 tips 的鍵是軸代碼，toggle 是圖例按鈕的動作。
 * @returns {JSX.Element}
 */
function Radar({ spec }) {
  const svg = useRef(null);
  // 依 SVG 的實際寬度換算字級：一個螢幕像素等於幾個 viewBox 單位，圖縮小時字級的單位跟著放大，軸名在螢幕上維持 12 px
  const viewWidth = RADAR.size + 2 * RADAR.margin.x;
  const width = useWidth(svg);
  // 還沒量到寬度時先用 12 個單位
  const fontSize = width ? (CHART_TEXT * viewWidth) / width : CHART_TEXT;
  // 圓心在 viewBox 的正中央
  const center = RADAR.size / 2;
  const count = spec.axes.length;
  // 第一軸朝正上方，其餘依軸數等分圓周順時針排列
  const { point, side } = radarGeometry(count, center, center, RADAR.radius);
  // 分數換算成 0 到 1 的比例，圓心是最小值，最外圈是最大值
  const ratio = (value) => (value - spec.min) / (spec.max - spec.min);
  // 圖例關閉的系列不繪製，其餘系列各自一個多邊形
  const shown = spec.series.filter((item) => !item.hidden);
  return (
    <div class="flex flex-col gap-3">
      <svg ref={svg} viewBox={`${-RADAR.margin.x} ${-RADAR.margin.y} ${viewWidth} ${RADAR.size + 2 * RADAR.margin.y}`} class="mx-auto w-full max-w-md" style={`font-size:${fontSize.toFixed(2)}px`} role="group" aria-label={spec.label}>
        {RADAR.rings.map((ring) => (
          <polygon key={ring} points={spec.axes.map((_, i) => point(i, ring).join(",")).join(" ")} fill="none" class="stroke-border" />
        ))}
        {spec.axes.map((axis, i) => {
          // 軸線終點在最外圈，標籤再往外移一段，文字才不會蓋到線
          const [x, y] = point(i, 1);
          const [lx, ly] = point(i, 1 + RADAR.labelGap / RADAR.radius);
          // 標籤依所在位置靠左、置中或靠右
          const anchor = side(lx);
          return (
            <g key={axis.code}>
              <line x1={center} y1={center} x2={x} y2={y} class="stroke-border" />
              <text x={lx} y={ly} text-anchor={anchor} dominant-baseline="middle" class="fill-ink-secondary">
                {axis.label}
              </text>
              <title>{axis.tip}</title>
            </g>
          );
        })}
        {shown.map((item) => {
          // 沒有值的軸直接略過，多邊形只連接有資料的軸
          const known = spec.axes.map((axis, i) => ({ i, value: item.values[axis.code] })).filter((entry) => hasValue(entry.value));
          const points = known.map((entry) => point(entry.i, ratio(entry.value)));
          // 至少三點才繪製面，否則只繪製點。每個點的 title 是該軸的說明
          return (
            <g key={item.id} data-series={String(item.series)} {...interactive(item.action ?? null, item.label)}>
              {points.length >= 3 ? <polygon points={points.map((p) => p.join(",")).join(" ")} class="fill-(--series) stroke-(--series)" fill-opacity="0.12" stroke-width="2" /> : null}
              {points.map(([x, y], k) => (
                <circle key={spec.axes[known[k].i].code} cx={x} cy={y} r="3.5" class="fill-(--series)">
                  <title>{item.tips[spec.axes[known[k].i].code]}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {/* 圖例按鈕切換系列，關閉的系列淡化 */}
      <div class="flex flex-wrap gap-2">
        {spec.series.map((item) => (
          <button key={item.id} type="button" class={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs ${item.hidden ? "text-ink-muted opacity-60" : "text-ink"}`} data-action={item.toggle} aria-pressed={String(!item.hidden)}>
            <Swatch series={item.series} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 熱力圖：列是議題，欄是候選人。
 * @param {{ spec: { columns: { id: string, label: string, series: number }[], rows: { id: string, label: string, cells: { value: number|null, display: string, tip: string, action: string }[] }[], tiers: number[], legend: string } }} props 區塊描述，每列的 cells 與 columns 依序對應。
 * @returns {JSX.Element}
 */
function Heatmap({ spec }) {
  // 窄螢幕維持欄寬，改在框內水平捲動，欄名不會擠成一字一行。格子的級距寫在 data-tier
  return (
    <div class="flex flex-col gap-2">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[32rem] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th class="w-40" />
              {spec.columns.map((column) => (
                <th key={column.id} scope="col" class="px-2 py-1 text-xs font-medium text-ink-secondary" data-series={String(column.series)}>
                  <span class="inline-flex items-center gap-1.5">
                    <Swatch series={column.series} />
                    {column.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" class="pe-2 text-start text-sm font-normal text-ink">
                  {row.label}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.action} class={`rounded-lg px-2 py-2 text-center tabular-nums ${HEAT_TONES[tierOf(cell.value, spec.tiers)]}`} {...interactive(cell.action, cell.tip)}>
                    {cell.display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-ink-muted">{spec.legend}</p>
    </div>
  );
}

/**
 * 桑基圖：欄由左到右是題目、議題、分項與總分，帶的寬度代表貢獻。
 * @param {{ spec: { label: string, nodes: { id: string, label: string, short?: string, column: number, series?: number|null, action?: string }[], links: { source: string, target: string, value: number, tip: string, series?: number }[] } }} props 區塊描述，column 是節點所在的欄，由 0 起算，同一欄依描述的順序由上而下排列。series 是系列色的序號，連結通常取目標候選人的序號。
 * @returns {JSX.Element}
 */
function Sankey({ spec }) {
  const box = useRef(null);
  // 容器的寬度決定版面寬度，還沒量到時先以自然寬度排版
  const available = useWidth(box);
  const nodes = new Map(spec.nodes.map((node) => [node.id, { ...node, in: 0, out: 0 }]));
  // 累計每個節點的流入與流出
  for (const link of spec.links) {
    nodes.get(link.source).out += link.value;
    nodes.get(link.target).in += link.value;
  }
  // 欄數由節點的 column 決定。每一欄只放有流量的節點，沒有流入也沒有流出的節點不占高度
  const count = Math.max(...spec.nodes.map((node) => node.column)) + 1;
  const columns = Array.from({ length: count }, (_, column) => [...nodes.values()].filter((node) => node.column === column && Math.max(node.in, node.out) > 0));
  const values = columns.map((column) => column.reduce((sum, node) => sum + Math.max(node.in, node.out), 0));
  // 標籤區的寬度取該欄最長的標籤：第一欄的標籤在節點左側，其餘在右側
  const labelSpace = (column) => Math.max(0, ...column.map((node) => textWidth(node.short ?? node.label))) + SANKEY.labelGap * 2;
  const left = labelSpace(columns[0]);
  const right = labelSpace(columns[count - 1]);
  // 中間各欄的標籤畫在節點右側，欄距要放得下最長的中間標籤，才不會壓到下一欄
  const middle = Math.max(SANKEY.minGap, ...columns.slice(1, -1).map((column) => labelSpace(column) + SANKEY.nodeWidth));
  // 自然寬度放得下全部標籤，容器較寬時拉滿，多出的寬度平均分給各欄的間距
  const natural = left + SANKEY.nodeWidth + middle * (count - 1) + right;
  // 檢視框有 1 px 的框線，拉滿時扣掉左右兩側
  const width = Math.max(natural, (available ?? 0) - (spec.zoom ? 2 : 0));
  // 只有一欄時沒有欄距
  const step = count > 1 ? (width - left - right - SANKEY.nodeWidth) / (count - 1) : 0;
  // 節點最多的一欄決定最低圖高：每個節點至少一列，12 px 的標籤上下才有間隙
  const tallest = Math.max(...columns.map((column) => column.length));
  const height = Math.max(SANKEY.minHeight, tallest * SANKEY.rowHeight);
  // 比例尺取各欄中最小者，最擁擠的一欄才放得下，其餘欄會留白而高度一致
  const scale = Math.min(...columns.map((column, i) => (values[i] > 0 ? (height - SANKEY.gap * (column.length - 1)) / values[i] : Infinity)));
  // 逐欄由上而下放置節點
  columns.forEach((column, i) => {
    let y = 0;
    // 每一欄保留描述給的順序，由卡片層決定排列
    for (const node of column) {
      node.x = left + i * step;
      node.y = y;
      // 節點高度至少 1，流量極小的節點才不會消失
      node.h = Math.max(1, Math.max(node.in, node.out) * scale);
      node.sy = node.y;
      node.ty = node.y;
      // 節點之間留固定的間隙，下一個節點排在這個間隙之後
      y += node.h + SANKEY.gap;
    }
  });
  // 每條帶的起訖位置沿著節點累加，同一節點的多條帶才會上下排開不重疊
  const bands = spec.links.map((link) => {
    const source = nodes.get(link.source);
    const target = nodes.get(link.target);
    // 帶的寬度與貢獻成正比，與節點用同一個比例尺才會前後守恆
    const thickness = link.value * scale;
    // 帶從來源節點右緣出發，到目標節點左緣結束
    const x0 = source.x + SANKEY.nodeWidth;
    const x1 = target.x;
    const y0 = source.sy + thickness / 2;
    // 起點與終點的垂直位置都取帶的中線，曲線才會對準帶的厚度中心
    const y1 = target.ty + thickness / 2;
    // 用掉的厚度累加回節點，下一條帶排在它下方
    source.sy += thickness;
    target.ty += thickness;
    const mid = (x0 + x1) / 2;
    return (
      <path key={`${link.source}>${link.target}`} d={`M${x0},${y0}C${mid},${y0} ${mid},${y1} ${x1},${y1}`} fill="none" stroke-width={Math.max(1, thickness)} class="stroke-(--series)" stroke-opacity="0.32" data-series={String(link.series ?? 0)}>
        <title>{link.tip}</title>
      </path>
    );
  });
  // 未放置的節點沒有高度，不繪製方塊與標籤
  const rects = [...nodes.values()]
    .filter((node) => node.h !== undefined)
    .map((node) => (
      <g key={node.id} {...interactive(node.action ?? null, node.label)}>
        {/* 有系列的節點（候選人）用系列色，其餘節點（議題與分項）用中性的基線色 */}
        <rect x={node.x} y={node.y} width={SANKEY.nodeWidth} height={node.h} rx="2" class={hasValue(node.series) ? "fill-(--series)" : "fill-baseline"} data-series={hasValue(node.series) ? String(node.series) : null} />
        {/* 第一欄的標籤放在節點左側，其餘放在右側 */}
        <text x={node.column === 0 ? node.x - SANKEY.labelGap : node.x + SANKEY.nodeWidth + SANKEY.labelGap} y={node.y + node.h / 2} text-anchor={node.column === 0 ? "end" : "start"} dominant-baseline="middle" class="fill-ink-secondary text-xs">
          {node.short ?? node.label}
        </text>
      </g>
    ));
  // 一個 viewBox 單位等於一個像素，寬高直接寫在 svg 上，標籤就是螢幕上的 12 px
  const svg = (
    <svg width={width} height={height + 8} viewBox={`0 -4 ${width} ${height + 8}`} class="block" role="group" aria-label={spec.label}>
      {bands}
      {rects}
    </svg>
  );
  // 有縮放設定時放進可縮放與拖曳的檢視框，讀者自己放大看完整的標籤與關聯，沒有時比容器寬就水平捲動
  return <div ref={box}>{spec.zoom ? <ZoomPan labels={spec.zoom} size={{ width, height: height + 8 }}>{svg}</ZoomPan> : <div class="overflow-x-auto">{svg}</div>}</div>;
}

/**
 * Treemap：第 1 層議題依政見份量排列，格內列出第 2 層。
 * @param {{ spec: { items: { id: string, label: string, value: number, shade?: number|null, display: string, tip: string, action?: string, children?: { id: string, text: string }[] }[], series: number, label: string, legend?: string } }} props 區塊描述。value 決定面積，shade 是 0 到 1 的第二個維度、決定底色深淺，沒有值時畫虛線框。children 是格內列出的第 2 層，legend 是圖例說明。
 * @returns {JSX.Element}
 */
function Treemap({ spec }) {
  const cells = squarify(spec.items.filter((item) => item.value > 0), { x: 0, y: 0, w: 100, h: 100 });
  // 格子以百分比座標絕對定位。格子高度扣除標題與數值兩列後，能放幾列第 2 層就放幾列
  // 面積是份量，底色深淺是 shade：系列色與卡面底色依比例混色，沒有值的格子用虛線框的凹陷底色
  return (
    <div class="flex flex-col gap-2">
      <div class="relative h-96 w-full overflow-hidden rounded-lg" role="list" aria-label={spec.label} data-series={String(spec.series)}>
        {cells.map(({ item, x, y, w, h }) => (
          <div key={item.id} class="absolute p-0.5" style={`left:${x}%;top:${y}%;width:${w}%;height:${h}%`} role="listitem">
            <div class={`flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-lg border p-2 hover:border-accent ${hasValue(item.shade) ? "border-surface" : "border-dashed border-baseline bg-sunken"}`} style={hasValue(item.shade) ? `background:color-mix(in oklab, var(--series) ${Math.round(TREEMAP_SHADE[0] + item.shade * (TREEMAP_SHADE[1] - TREEMAP_SHADE[0]))}%, var(--surface))` : null} {...interactive(item.action ?? null, item.tip)}>
              <span class="truncate text-sm font-medium text-ink">{item.label}</span>
              <span class="truncate text-xs tabular-nums text-ink-secondary">{item.display}</span>
              {(item.children ?? []).slice(0, Math.max(0, Math.floor(h / TREEMAP_LINE) - 2)).map((child) => (
                <span key={child.id} class="truncate text-xs text-ink-secondary">
                  {child.text}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* 圖例：由淺到深的色條與說明 */}
      {spec.legend ? (
        <p class="flex items-center gap-2 text-xs text-ink-muted">
          <span class="h-2 w-16 rounded-full" style={`background:linear-gradient(to right, color-mix(in oklab, var(--series) ${TREEMAP_SHADE[0]}%, var(--surface)), color-mix(in oklab, var(--series) ${TREEMAP_SHADE[1]}%, var(--surface)))`} data-series={String(spec.series)} aria-hidden="true" />
          {spec.legend}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 直方圖：每個分箱一條直條。
 * @param {{ spec: { bins: { label: string, value: number, tip: string }[], label: string } }} props 區塊描述。
 * @returns {JSX.Element}
 */
function Histogram({ spec }) {
  const top = Math.max(1, ...spec.bins.map((bin) => bin.value));
  // 直條以像素高度依最高一條等比例縮放，分箱標籤另起一列對齊直條
  return (
    <div class="flex flex-col gap-1.5" role="group" aria-label={spec.label}>
      <div class="flex h-32 items-end gap-2">
        {spec.bins.map((bin) => (
          <div key={bin.label} class="flex flex-1 flex-col items-center justify-end gap-1" data-tip={bin.tip} tabindex="0">
            <span class="text-xs tabular-nums text-ink-secondary">{String(bin.value)}</span>
            <span class="w-full rounded-t bg-accent" style={`height:${((bin.value / top) * HISTOGRAM_HEIGHT).toFixed(2)}rem`} />
          </div>
        ))}
      </div>
      <div class="flex gap-2">
        {spec.bins.map((bin) => (
          <span key={bin.label} class="flex-1 text-center text-xs tabular-nums text-ink-secondary">
            {bin.label}
          </span>
        ))}
      </div>
      <p class="text-xs text-ink-muted">{spec.label}</p>
    </div>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { Bars, Spectrum, Radar, Heatmap, Sankey, Treemap, Histogram };
