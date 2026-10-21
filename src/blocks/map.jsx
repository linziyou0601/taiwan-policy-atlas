/* ==================================================
 * blocks/map.jsx - 選區地圖
 * --------------------------------------------------
 * - 角色：以 Preact 元件繪製縣市或鄉鎮的 SVG 地圖，圖形依狀態上色，可點、可用鍵盤選取
 * - 指令：由 blocks/block.jsx 登錄，不直接匯入
 * - 慣例：
 *   - 路徑已在管線投影成螢幕座標，這裡直接繪製
 *   - 點選鄉鎮時，地圖的 viewBox 縮放到該縣市的範圍，範圍由路徑的座標求出
 *   - 狀態色由本檔的 SHAPE_STATES 決定，與 basic.jsx 圖例的 SWATCH_STATES 同一組顏色，並附文字圖例，不只靠顏色
 * ================================================== */
import { interactive } from "./ui.jsx";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 縮放到縣市時四周留的邊界，單位是地圖座標。
 */
const ZOOM_MARGIN = 6;

/**
 * 地圖圖形四種狀態的填色與框線，鍵是 feature.state：不屬於任何選區、有選區但尚無政見資料、有政見資料與已選取。圖例的色塊在 blocks/basic.jsx 的 SWATCH_STATES 用同一組顏色。
 */
const SHAPE_STATES = { none: "fill-sunken stroke-surface", active: "fill-baseline stroke-surface", policy: "fill-accent-soft stroke-accent", selected: "fill-accent stroke-surface" };

/**
 * 可點的圖形在滑過與鍵盤聚焦時換成強調色並略微淡化。
 */
const SHAPE_HOVER = "hover:fill-accent hover:opacity-85 focus-visible:fill-accent focus-visible:opacity-85";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 求出一組相對座標路徑的外框。
 * @param {string[]} paths 「Mx y lx y ... z」形式的路徑。
 * @returns {[number, number, number, number]} `[x, y, 寬, 高]`。
 */
function pathBounds(paths) {
  let minX = Infinity;
  let minY = Infinity;
  // 外框的四個邊界從無限大開始，第一個點就會取代初始值
  let maxX = -Infinity;
  let maxY = -Infinity;
  // 逐條路徑、逐個子路徑累加相對位移
  for (const path of paths) {
    // 每個子路徑以 M 起筆
    for (const part of path.split("M").filter(Boolean)) {
      const [start, rest = ""] = part.replace("z", "").split("l");
      let [x, y] = start.trim().split(" ").map(Number);
      // 後續的點都是相對前一點的位移，要逐步累加才能還原絕對座標
      const deltas = rest.trim().split(" ").filter(Boolean).map(Number);
      // 起點本身也是邊界上的點，先納入再處理位移
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      // 縱向的邊界同樣在每個點更新，橫縱兩軸都納入才得到完整外框
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // 相對位移兩兩一組
      for (let i = 0; i + 1 < deltas.length; i += 2) {
        x += deltas[i];
        y += deltas[i + 1];
        // 每走一步更新座標後都要重新納入四個邊界，才不會漏掉轉折點
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        // 子路徑裡的每個轉折點都要納入，只看起點會漏掉向外突出的鄉鎮
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return [minX - ZOOM_MARGIN, minY - ZOOM_MARGIN, maxX - minX + ZOOM_MARGIN * 2, maxY - minY + ZOOM_MARGIN * 2];
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 選區地圖。
 * @param {{ spec: { viewBox: number[], features: { id: string, path: string, label: string, state: string, action: string|null }[], insets: string[], zoomTo: boolean, label: string } }} props 區塊描述，zoomTo 為 true 時 viewBox 縮放到圖形的範圍。
 * @returns {JSX.Element}
 */
function DistrictMap({ spec }) {
  // 縮放到縣市時以鄉鎮的範圍當 viewBox
  const box = spec.zoomTo ? pathBounds(spec.features.map((feature) => feature.path)) : spec.viewBox;
  // 離島插圖框以虛線繪製。有動作的區塊才可聚焦，選中的區塊以 aria-pressed 告知螢幕閱讀器
  // 每個區塊以代碼當 key：縣市換成鄉鎮時舊的圖形整個移除，焦點不會留在另一個區塊上
  return (
    <div class="w-full">
      <svg viewBox={box.join(" ")} class="mx-auto h-auto max-h-[36rem] w-full" role="group" aria-label={spec.label}>
        {spec.insets.map((path) => (
          <path key={path} d={path} fill="none" class="stroke-border" stroke-dasharray="3 3" aria-hidden="true" />
        ))}
        {spec.features.map((feature) => (
          <path
            key={feature.id}
            d={feature.path}
            class={`transition-[fill] duration-120 outline-none [stroke-width:0.6] ${SHAPE_STATES[feature.state]} ${feature.action ? SHAPE_HOVER : ""}`}
            fill-rule="evenodd"
            {...interactive(feature.action ?? null, feature.label)}
            aria-pressed={feature.state === "selected" ? "true" : null}
          >
            <title>{feature.label}</title>
          </path>
        ))}
      </svg>
    </div>
  );
}

/* ==================================================
 * 匯出
 * ================================================== */

export { DistrictMap };
