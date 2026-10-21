/* ==================================================
 * blocks/share-image.js - 分享圖片
 * --------------------------------------------------
 * - 角色：把結果摘要繪製成正方形的 PNG：標題區、雷達圖與右欄清單。選舉的清單是候選人總分長條，主題測驗是單選題的選擇與各軸光譜。顏色取自目前主題的 tokens，淺色與深色主題各自一致
 * - 指令：import { drawShareImage } from "../blocks/share-image.js"
 * - 慣例：
 *   - 圖片的文字與數值全部取自描述。是否翻牌由呼叫端決定，描述中的名稱已依翻牌狀態寫好
 *   - 品牌標誌與首頁插圖沿用網頁的定義：標誌取 icons.js 的 BRAND_MARK，插圖繪製 art.jsx 的 LandingArt
 * ================================================== */

import { h, render } from "preact";
import { clamp } from "../lib/format.js";
import { hasValue } from "../lib/objects.js";
import { BRAND_MARK } from "./icons.js";
import { LandingArt } from "./art.jsx";
import { radarGeometry } from "./radar.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 圖片尺寸與版面，單位是像素，以 2 倍密度輸出。正方形的圖片在電腦與手機上都完整顯示。
 * 上方是標題區，下方左欄是雷達圖、右欄是清單，沒有雷達時清單占滿整寬。選舉的列數上限由 cards 層依 settings 的 `share.imageRows` 決定，右欄的高度放得下該列數。
 */
const IMAGE = {
  width: 1080,
  height: 1080,
  scale: 2,
  padding: 72,
  // 品牌標誌的邊長與它和標題的間距，標誌與標題共用一條中線
  brandSize: 56,
  brandGap: 18,
  // 右上角的首頁插圖：右緣對齊內距，高度與標題區相同
  artHeight: 250,
  artTop: 36,
  // 標題的中線，以及副標題與說明的基線，從上緣內距起算
  titleY: 28,
  subtitleY: 100,
  captionY: 138,
  // 兩欄的小標基線。標題區與兩欄之間留出空白，兩欄整體落在標題區與頁尾之間的中段
  sectionY: 320,
  // 左欄的雷達圖：欄寬、圓心距小標的距離、半徑、軸標籤與外圈的距離、刻度圈與圖例的位置
  radarWidth: 560,
  radarTop: 232,
  radius: 160,
  labelGap: 16,
  rings: [0.25, 0.5, 0.75, 1],
  legendGap: 56,
  // 右欄的長條：第一列名稱基線距小標的最小距離、每列高度、名稱與條的距離、條高、長條下方文字的基線、名稱與註記的間距。列數少時整組對齊雷達圖的圓心
  listTop: 64,
  rowHeight: 104,
  barTop: 18,
  barHeight: 14,
  noteTop: 54,
  noteGap: 12,
};

/**
 * 圖片中各段文字的字重與字級。
 */
const TEXT = {
  title: "700 46px",
  subtitle: "500 28px",
  caption: "400 20px",
  section: "600 22px",
  label: "500 24px",
  value: "700 28px",
  axis: "400 15px",
  legend: "500 18px",
  note: "400 16px",
  detail: "500 20px",
  footer: "400 16px",
};

/**
 * SVG 的 text-anchor 對應到畫布的 textAlign。
 */
const CANVAS_ALIGN = { middle: "center", start: "left", end: "right" };

/**
 * 首頁插圖的原始尺寸，與 LandingArt 的 viewBox 相同。
 */
const ART_SIZE = { width: 520, height: 540 };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 讀取一個 CSS 變數的值。
 * @param {string} name 變數名稱，例如 `--surface`。
 * @returns {string}
 */
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 圖片文字的字型：字級加上 styles.css 的 `--font-sans`。
 * @param {string} size TEXT 的一項。
 * @returns {string} canvas 的 font 值。
 */
function fontOf(size) {
  return `${size} ${token("--font-sans")}`;
}

/**
 * 文字超過寬度時從尾端截短並補上刪節號。
 * @param {CanvasRenderingContext2D} context 已設好字型的繪圖環境。
 * @param {string} text 文字。
 * @param {number} width 可用寬度。
 * @returns {string}
 */
function fitText(context, text, width) {
  // 放得下時原樣回傳
  if (context.measureText(text).width <= width) return text;
  let end = text.length;
  // 逐字縮短到放得下刪節號為止
  while (end > 0 && context.measureText(`${text.slice(0, end)}…`).width > width) end -= 1;
  return `${text.slice(0, end)}…`;
}

/**
 * 64 × 64 的圓角方塊路徑。
 * @param {number} radius 圓角半徑。
 * @returns {Path2D}
 */
function roundedSquare(radius) {
  const path = new Path2D();
  path.roundRect(0, 0, 64, 64, radius);
  return path;
}

/**
 * 圓形路徑。
 * @param {{ cx: number, cy: number, r: number }} shape 圓心與半徑。
 * @returns {Path2D}
 */
function circle(shape) {
  const path = new Path2D();
  path.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
  return path;
}

/**
 * 依序連接各點的封閉路徑，兩個點時是一條線段。
 * @param {number[][]} points 各點的 [x, y]。
 * @returns {Path2D}
 */
function polygon(points) {
  const path = new Path2D();
  points.forEach(([x, y]) => path.lineTo(x, y));
  // 三點以上才封閉，線段不回到起點
  if (points.length > 2) path.closePath();
  return path;
}

/**
 * 在圖片上繪製品牌標誌，圖形與網頁的 BrandMark 相同。
 * @param {CanvasRenderingContext2D} context 繪圖環境。
 * @param {number} x 左上角的 x。
 * @param {number} y 左上角的 y。
 * @param {number} size 邊長。
 */
function drawBrand(context, x, y, size) {
  context.save();
  // 標誌的格線是 64，移到指定位置後縮放到指定邊長
  context.translate(x, y);
  context.scale(size / 64, size / 64);
  // 強調色的圓角方塊底
  context.fillStyle = token("--accent");
  context.fill(roundedSquare(BRAND_MARK.radius));
  // 摺頁地圖的線條用強調色上的文字色，端點與轉角都是圓角，與網頁的 SVG 相同
  Object.assign(context, { strokeStyle: token("--on-accent"), lineWidth: BRAND_MARK.stroke, lineCap: "round", lineJoin: "round" });
  context.stroke(new Path2D(BRAND_MARK.map));
  // 定位點用淺強調色
  context.fillStyle = token("--accent-soft");
  context.fill(circle(BRAND_MARK.pin));
  // 還原座標系，後面的繪製不受縮放影響
  context.restore();
}

/**
 * 把首頁插圖繪製成影像：在畫面外繪製 LandingArt，把 token 類別的顏色換成目前主題的實際色值，再轉成影像。
 * 插圖只有一份定義，網頁與分享圖片繪製出來的一樣。
 * @returns {Promise<HTMLImageElement>}
 */
async function landingArt() {
  const holder = document.createElement("div");
  // 放在畫面外，讀得到計算後的顏色，又不會出現在頁面上
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:520px";
  document.body.append(holder);
  // 用網頁同一個元件繪製插圖
  render(h(LandingArt, {}), holder);
  const svg = holder.querySelector("svg");
  // 每個圖形的填色與線色寫成屬性，序列化後的 SVG 不依賴頁面的 CSS
  for (const element of svg.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    // 沒有填色或線色的圖形，計算值是 none，照樣寫回
    element.setAttribute("fill", style.fill);
    element.setAttribute("stroke", style.stroke);
  }
  // 獨立的 SVG 檔要有命名空間與明確的尺寸，當成影像載入時才繪製得出來
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(ART_SIZE.width));
  svg.setAttribute("height", String(ART_SIZE.height));
  // 序列化成 SVG 檔，以暫時網址載入成影像
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  const image = new Image();
  image.src = url;
  // 影像解碼完成後才能繪製
  await image.decode();
  // 繪製完的暫時元素與網址都清除
  render(null, holder);
  holder.remove();
  URL.revokeObjectURL(url);
  return image;
}

/**
 * 系列的顏色：翻牌後有政黨色時用政黨色，否則用中立的系列色。
 * @param {{ series: number, mark: { light: string, dark: string }|null }} item 系列。
 * @returns {string}
 */
function seriesColor(item) {
  // 政黨色依目前主題取淺色或深色
  if (item.mark) return item.mark[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
  return token(`--series-${item.series}`);
}

/**
 * 在左欄繪製雷達圖：刻度圈、軸線、軸標籤、各系列的多邊形，以及下方的圖例。
 * @param {CanvasRenderingContext2D} context 繪圖環境。
 * @param {object} radar 雷達圖描述：axes、series、min、max、you。
 * @param {number} cx 圓心的 x。
 * @param {number} cy 圓心的 y。
 */
function drawRadar(context, radar, cx, cy) {
  const count = radar.axes.length;
  // 軸上的點與標籤的對齊與網頁的雷達圖共用同一套幾何
  const { point, side, seriesPoints } = radarGeometry(count, cx, cy, IMAGE.radius);

  // 刻度圈與軸線用框線色，當作底圖
  Object.assign(context, { strokeStyle: token("--border"), lineWidth: 1 });
  // 每一圈是連接各軸同一比例位置的多邊形
  for (const ring of IMAGE.rings) context.stroke(polygon(radar.axes.map((_, index) => point(index, ring))));
  // 軸標籤用次要文字色的小字，以中線對齊標籤的位置
  Object.assign(context, { font: fontOf(TEXT.axis), fillStyle: token("--ink-secondary"), textBaseline: "middle" });
  radar.axes.forEach((axis, index) => {
    // 軸線從圓心畫到最外圈
    context.stroke(polygon([[cx, cy], point(index, 1)]));
    const [x, y] = point(index, 1 + IMAGE.labelGap / IMAGE.radius);
    // 標籤再往外退一段，依所在位置靠左、置中或靠右，文字不壓到線
    context.textAlign = CANVAS_ALIGN[side(x)];
    context.fillText(axis.label, x, y);
  });
  // 每個系列各畫一個多邊形，第一個是作答者
  for (const item of radar.series) {
    // 只連接有值的軸，沒有值的軸直接略過
    const points = seriesPoints(radar.axes, item.values, radar.min, radar.max).map((entry) => entry.point);
    const color = seriesColor(item);
    Object.assign(context, { fillStyle: color, strokeStyle: color, lineWidth: 2 });
    // 點數足以圍成多邊形時繪製面：面積用淡色填滿、外框用實色，多位候選人重疊時仍分得出輪廓
    if (points.length >= 3) {
      const shape = polygon(points);
      // 面積降低不透明度後填色
      context.globalAlpha = 0.12;
      context.fill(shape);
      // 外框恢復不透明
      context.globalAlpha = 1;
      context.stroke(shape);
    }
    // 每個點是小圓，只有一兩個點的系列也看得到
    for (const [x, y] of points) context.fill(circle({ cx: x, cy: y, r: 4 }));
  }
  // 圖例只標示作答者，候選人的顏色與右欄的長條相同
  const legendY = cy + IMAGE.radius + IMAGE.legendGap;
  context.fillStyle = seriesColor(radar.series[0]);
  context.fill(circle({ cx: cx - 20, cy: legendY, r: 7 }));
  // 圖例文字接在色點右側
  Object.assign(context, { fillStyle: token("--ink-secondary"), font: fontOf(TEXT.legend), textAlign: "left" });
  context.fillText(radar.you, cx - 6, legendY);
  // 還原基線，後面的文字照常以基線排列
  context.textBaseline = "alphabetic";
}

/**
 * 長條的圓角矩形路徑，兩端是半圓。
 * @param {number} x 左緣。
 * @param {number} y 上緣。
 * @param {number} width 寬度。
 * @returns {Path2D}
 */
function roundedBar(x, y, width) {
  const path = new Path2D();
  path.roundRect(x, y, width, IMAGE.barHeight, IMAGE.barHeight / 2);
  return path;
}

/**
 * 兩極光譜的長條：左段是負極、右段是正極，顏色與網頁的兩極光譜相同。
 * @param {CanvasRenderingContext2D} context 繪圖環境。
 * @param {number} left 左緣。
 * @param {number} y 長條上緣。
 * @param {number} width 寬度。
 * @param {number} split 正極所占的比例，0 到 1。
 */
function drawSplit(context, left, y, width, split) {
  const positive = width * clamp(split, 0, 1);
  // 整條先填負極色，再從右端蓋上正極色，兩段之間不留縫
  context.fillStyle = token("--series-1");
  context.fill(roundedBar(left, y, width));
  // 正極色限制在圓角長條的範圍內，右端維持半圓
  context.save();
  context.clip(roundedBar(left, y, width));
  // 正極的寬度從右端量起
  context.fillStyle = token("--series-2");
  context.fillRect(left + width - positive, y, positive, IMAGE.barHeight);
  context.restore();
}

/**
 * 在右欄繪製清單：每列名稱與數值在上，下方依列的內容畫長條、兩極光譜或一行文字。
 * @param {CanvasRenderingContext2D} context 繪圖環境。
 * @param {object[]} items 清單列：value 是長條的比例，split 是兩極光譜正極的比例，ends 是光譜下方兩端的文字，detail 是不畫長條時的一行文字，meta 是長條下方的一行次要文字，note 是名稱後面的警示註記。
 * @param {number} left 欄的左緣。
 * @param {number} top 第一列名稱的基線。
 */
function drawScores(context, items, left, top) {
  const width = IMAGE.width - IMAGE.padding - left;
  // 每個項目一列，列與列等距
  items.forEach((item, index) => {
    const y = top + index * IMAGE.rowHeight;
    // 數值靠右、字重加粗，一眼可讀
    Object.assign(context, { font: fontOf(TEXT.value), fillStyle: token("--ink"), textAlign: "right" });
    context.fillText(item.display, left + width, y);
    const valueWidth = context.measureText(item.display).width;
    // 候選人的註記接在名稱後面，名稱先讓出註記的寬度
    Object.assign(context, { font: fontOf(TEXT.note), textAlign: "left" });
    // 註記寬度加上與名稱的間距
    const noteWidth = item.note ? context.measureText(item.note).width + IMAGE.noteGap : 0;
    // 名稱靠左，用數值與註記以外的寬度，太長時截短
    context.font = fontOf(TEXT.label);
    const label = fitText(context, item.label, width - valueWidth - IMAGE.barTop - noteWidth);
    context.fillText(label, left, y);
    // 名稱寬度要在換成註記字型之前量
    const labelWidth = context.measureText(label).width;
    // 註記用警示色與較小的字，和名稱共用基線
    if (item.note) {
      Object.assign(context, { fillStyle: token("--warning"), font: fontOf(TEXT.note) });
      context.fillText(item.note, left + labelWidth + IMAGE.noteGap, y);
    }
    // 兩極光譜畫兩段，兩端寫出各極的比例
    if (hasValue(item.split)) {
      drawSplit(context, left, y + IMAGE.barTop, width, item.split);
      // 兩端的文字用次要文字色與小一級的字
      Object.assign(context, { fillStyle: token("--ink-secondary"), font: fontOf(TEXT.note) });
      context.fillText(item.ends[0], left, y + IMAGE.noteTop);
      // 右端靠右對齊
      context.textAlign = "right";
      context.fillText(item.ends[1], left + width, y + IMAGE.noteTop);
      context.textAlign = "left";
    }
    // 沒有值的列不畫長條，未知不畫成 0。例如主題測驗的單選題只寫選了哪一項
    else if (hasValue(item.value)) {
      // 先繪製滿全寬的底軌，讓不同分數的條有共同的比較基準
      context.fillStyle = token("--surface-sunken");
      context.fill(roundedBar(left, y + IMAGE.barTop, width));
      // 填色部分依系列色，比例限制在 0 到 1 之間
      context.fillStyle = seriesColor(item);
      context.fill(roundedBar(left, y + IMAGE.barTop, width * clamp(item.value, 0, 1)));
    }
    // 不畫長條的列在長條的位置寫一行文字，太長時截短
    if (item.detail) {
      Object.assign(context, { fillStyle: token("--ink-secondary"), font: fontOf(TEXT.detail) });
      context.fillText(fitText(context, item.detail, width), left, y + IMAGE.noteTop - IMAGE.barTop);
    }
    // 次要文字寫在長條下方，太長時截短
    if (item.meta) {
      Object.assign(context, { fillStyle: token("--ink-secondary"), font: fontOf(TEXT.note) });
      context.fillText(fitText(context, item.meta, width), left, y + IMAGE.noteTop);
    }
  });
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 繪製分享圖片。
 * @param {{ title: string, subtitle: string, caption: string, scores: string, items: { label: string, value: number|null, display: string, series: number, mark: { light: string, dark: string }|null, note: string, meta?: string }[], radar: { title: string, you: string, min: number, max: number, axes: { code: string, label: string }[], series: { series: number, mark: object|null, values: Record<string, number|null> }[] }|null, more: string|null, footer: string }} spec 內容。items 已截到列數上限，value 為 null 的列不畫長條。radar 的第一個系列是作答者，為 null 時不畫雷達，清單占滿整寬。more 是另有幾位候選人的說明。
 * @returns {Promise<Blob>}
 */
async function drawShareImage(spec) {
  const canvas = document.createElement("canvas");
  // 畫布的實際像素放大 scale 倍，高解析螢幕上的文字與色條才不會模糊
  canvas.width = IMAGE.width * IMAGE.scale;
  canvas.height = IMAGE.height * IMAGE.scale;
  const context = canvas.getContext("2d");
  // 畫布不會等字型載入，先等網站字型就緒，沒載入成功時改用系統字照常繪製
  await document.fonts.load(fontOf(TEXT.title)).catch(() => null);
  // 座標系縮回邏輯尺寸，之後的繪製都以 1 倍的座標思考
  context.scale(IMAGE.scale, IMAGE.scale);
  // 底色與標題
  context.fillStyle = token("--page");
  context.fillRect(0, 0, IMAGE.width, IMAGE.height);
  // 右上角放首頁插圖當裝飾，先繪製，文字與長條疊在上面
  const art = await landingArt();
  const artWidth = (art.width / art.height) * IMAGE.artHeight;
  context.drawImage(art, IMAGE.width - IMAGE.padding - artWidth, IMAGE.artTop, artWidth, IMAGE.artHeight);
  // 標題左邊是品牌標誌，兩者的垂直中心在同一條線上
  drawBrand(context, IMAGE.padding, IMAGE.padding + IMAGE.titleY - IMAGE.brandSize / 2, IMAGE.brandSize);
  context.fillStyle = token("--accent");
  context.font = fontOf(TEXT.title);
  // 標題以中線為準繪製，繪製完改回以基線為準，後面的文字照常排列
  context.textBaseline = "middle";
  context.fillText(spec.title, IMAGE.padding + IMAGE.brandSize + IMAGE.brandGap, IMAGE.padding + IMAGE.titleY);
  context.textBaseline = "alphabetic";
  // 副標題用次要文字色與較輕的字重，與標題區分
  context.fillStyle = token("--ink-secondary");
  context.font = fontOf(TEXT.subtitle);
  context.fillText(spec.subtitle, IMAGE.padding, IMAGE.padding + IMAGE.subtitleY);
  // 說明文字再小一級，當作補充
  context.font = fontOf(TEXT.caption);
  context.fillText(spec.caption, IMAGE.padding, IMAGE.padding + IMAGE.captionY);
  // 兩欄的小標：左欄雷達圖、右欄清單，與標題區之間留出空白。沒有雷達時清單從左緣排起、占滿整寬
  const sectionY = IMAGE.padding + IMAGE.sectionY;
  // 清單的左緣依有沒有雷達決定
  const listLeft = spec.radar ? IMAGE.padding + IMAGE.radarWidth : IMAGE.padding;
  // 小標用主要文字色與半粗體
  Object.assign(context, { fillStyle: token("--ink"), font: fontOf(TEXT.section) });
  // 右欄的小標與長條共用左緣
  context.fillText(spec.scores, listLeft, sectionY);
  // 有雷達時畫在左欄，圓心在左欄的水平中央
  if (spec.radar) {
    context.fillText(spec.radar.title, IMAGE.padding, sectionY);
    drawRadar(context, spec.radar, IMAGE.padding + IMAGE.radarWidth / 2, sectionY + IMAGE.radarTop);
  }
  // 長條整組的中線對齊雷達圖的圓心，列數多時改從小標下方的最小距離排起
  const centered = IMAGE.radarTop - ((spec.items.length - 1) * IMAGE.rowHeight + IMAGE.barTop) / 2;
  drawScores(context, spec.items, listLeft, sectionY + Math.max(IMAGE.listTop, centered));
  // 頁尾的字最小，位置貼近底部邊界的一半，不與列表重疊
  context.fillStyle = token("--ink-muted");
  context.font = fontOf(TEXT.footer);
  // 列數超過上限時頁尾前面寫出另有幾位
  context.fillText(spec.more ? `${spec.more}${spec.footer}` : spec.footer, IMAGE.padding, IMAGE.height - IMAGE.padding / 2);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/* ==================================================
 * 匯出
 * ================================================== */

export { drawShareImage };
