/* ==================================================
 * blocks/index.js - 顯示層的入口
 * --------------------------------------------------
 * - 角色：匯出 app 層會用到的顯示元件：頁面外框、視窗、擋板、提示、載入畫面，以及分享圖片的繪製函式
 * - 指令：import { Page, Modal, Gate, Toast, Tooltip, Loading, drawShareImage } from "../blocks/index.js"
 * - 慣例：app 層只從本檔取用顯示層，各區塊模組之間的引用不經過本檔
 * ================================================== */

export { Page, Modal, Gate, Toast, Tooltip, Loading } from "./shell.jsx";
export { drawShareImage } from "./share-image.js";
