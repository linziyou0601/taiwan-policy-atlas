/* ==================================================
 * app/events.js - 事件委派
 * --------------------------------------------------
 * - 角色：在根節點委派點擊、輸入、右鍵、長按與 hover，鍵盤事件綁在整份文件，把 data-action、data-input、data-info、data-tip 轉成動作或說明
 * - 指令：import { bindEvents } from "../app/events.js"
 * - 慣例：
 *   - data-action 點擊或按 Enter、空白鍵時執行。data-input 在值改變時把值接在動作後面
 *   - 卡片右鍵或長按開啟說明，Esc 關閉視窗，數字鍵依序對應作答頁的選項
 *   - 量尺、單選題與分段按鈕的方向鍵在同組選項間移動焦點
 *   - 會改到網站狀態的互動不綁在元件上，畫面由 Preact 更新時元素可能沿用也可能換新，委派在根節點才不必跟著重綁
 *   - hover 說明只回報文字與目標位置，由 app 層交給說明元件繪製
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 長按開啟說明的時間（毫秒）。
 */
const LONG_PRESS_MS = 600;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 讀出元素的說明與位置，交給說明元件定位。
 * @param {Element} target 有 data-tip 的元素。
 * @returns {{ text: string, rect: DOMRect }}
 */
function tipOf(target) {
  return { text: target.dataset.tip, rect: target.getBoundingClientRect() };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 綁定根節點的事件委派。
 * @param {Element} root 根節點。
 * @param {{ action: (actionString: string) => void, info: (card: string) => void, escape: () => void, tip: (tip: { text: string, rect: DOMRect }|null) => void, digit: (n: number) => void }} handlers 事件處理：action 執行動作，info 開卡片說明，escape 關閉視窗，tip 顯示或隱藏說明，digit 是按下的數字鍵，由 1 起算，作答頁由 app 層選對應的選項。
 */
function bindEvents(root, handlers) {
  let pressTimer = null;
  // 點擊有 data-action 的元素
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    // 點到視窗背景時關閉視窗
    if (!target && event.target.dataset?.backdrop) {
      handlers.escape();
      return;
    }
    // 沒有動作或已停用的元素不處理
    if (!target || target.disabled) return;
    // 勾選框保留瀏覽器的切換，切換後的勾選與狀態的切換一致，畫面更新時瀏覽器的還原不會把舊值蓋回來。其他元素取消預設行為
    if (!target.matches('input[type="checkbox"]')) event.preventDefault();
    // 動作會更新畫面，目標可能換位置或消失，先隱藏說明以免殘留在原處
    handlers.tip(null);
    handlers.action(target.dataset.action);
  });
  // 鍵盤：Enter 與空白鍵觸發非按鈕的可點元素，Esc 關閉視窗，方向鍵移動同組選項，數字鍵作答
  // 鍵盤事件綁在整份文件，焦點在頁面空白處（body）時，數字鍵與 Esc 也有作用
  root.ownerDocument.addEventListener("keydown", (event) => {
    const target = event.target;
    // Esc 關閉視窗
    if (event.key === "Escape") {
      handlers.escape();
      return;
    }
    // SVG 與表格列等非按鈕元素以 Enter 或空白鍵觸發
    if ((event.key === "Enter" || event.key === " ") && target.matches?.("[data-action]:not(button):not(input)")) {
      event.preventDefault();
      handlers.action(target.dataset.action);
      return;
    }
    // 同組的 radio 以方向鍵移動焦點
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && target.getAttribute?.("role") === "radio") {
      const radios = [...target.closest("[role=radiogroup]").querySelectorAll("[role=radio]")];
      // 上下左右都視為前後移動，往左與往上是回上一項，其餘是下一項
      const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const next = radios[(radios.indexOf(target) + step + radios.length) % radios.length];
      // 方向鍵的預設行為會捲動頁面，這裡只該移動焦點
      event.preventDefault();
      next.focus();
      return;
    }
    // 作答頁的數字鍵依序對應作答選項，由 app 層從頁面描述找出選項，輸入框內不處理
    if (/^[1-9]$/.test(event.key) && !target.matches?.("input, select, textarea")) handlers.digit(Number(event.key));
  });
  // 輸入：搜尋框即時送出，滑桿與下拉在確定時送出
  const onInput = (event) => {
    const target = event.target;
    // 沒有 data-input 的輸入不處理
    if (!target.dataset?.input) return;
    // 設定在 change 時才送出的輸入，input 事件略過
    if (target.dataset.commit === "change" && event.type === "input") return;
    const action = target.dataset.input;
    // 輸入值接到動作後面：動作已帶參數時以「=」連接，否則以「:」連接，避免多出的冒號誤讀成動作名稱的一部分
    handlers.action(action.includes(":") ? `${action}=${target.value}` : `${action}:${target.value}`);
  };
  // input 與 change 共用同一個處理，是否送出由 data-commit 決定
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  // 右鍵開啟卡片的 info
  root.addEventListener("contextmenu", (event) => {
    const card = event.target.closest("[data-info]");
    // 卡片沒有 info 時保留瀏覽器內建的選單
    if (!card) return;
    event.preventDefault();
    handlers.info(card.dataset.info);
  });
  // 長按開啟卡片的 info，手指移開或移動時取消
  root.addEventListener("pointerdown", (event) => {
    const card = event.target.closest("[data-info]");
    // 只有觸控長按才開啟說明
    if (!card || event.pointerType !== "touch") return;
    pressTimer = setTimeout(() => handlers.info(card.dataset.info), LONG_PRESS_MS);
  });
  // 放開或移動時取消長按
  for (const type of ["pointerup", "pointermove", "pointercancel"]) root.addEventListener(type, () => clearTimeout(pressTimer));
  // hover 與聚焦顯示說明
  root.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-tip]");
    // 移到有說明的元素時顯示，移到沒有說明的元素上就隱藏，避免說明留在原處
    handlers.tip(target ? tipOf(target) : null);
  });
  // 鍵盤聚焦也要看得到說明，否則不用滑鼠的人讀不到提示
  root.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-tip]");
    // 聚焦到有說明的元素時顯示
    if (target) handlers.tip(tipOf(target));
  });
  root.addEventListener("focusout", () => handlers.tip(null));
}

/* ==================================================
 * 匯出
 * ================================================== */

export { bindEvents };
