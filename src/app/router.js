/* ==================================================
 * app/router.js - 網址與頁面
 * --------------------------------------------------
 * - 角色：解析與組成 hash 路由，格式為 #/{頁面}，分享連結另帶 ?{參數}={壓縮狀態}
 * - 指令：import { currentRoute, routeHash } from "../app/router.js"
 * - 慣例：不認得的頁面回到 layout.json 的 defaultPage，路由只決定頁面，其餘狀態都在 localStorage
 * ================================================== */

import { LAYOUT, SETTINGS } from "../config/index.js";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 解析目前的網址。
 * @returns {{ page: string, share: string|null }}
 */
function currentRoute() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const page = path.split("/")[0];
  // 分享參數可能不存在，get 回傳 null 代表這不是分享連結
  const share = new URLSearchParams(query).get(SETTINGS.share.param);
  // 不認得的頁面回到首頁
  return { page: LAYOUT.pages[page] ? page : LAYOUT.defaultPage, share };
}

/**
 * 組成頁面的 hash。
 * @param {string} page 頁面代碼。
 * @returns {string}
 */
function routeHash(page) {
  return `#/${page}`;
}

/**
 * 組成分享網址。
 * @param {string} packed 壓縮後的狀態。
 * @returns {string}
 */
function shareUrl(packed) {
  const query = new URLSearchParams({ [SETTINGS.share.param]: packed });
  return `${location.origin}${location.pathname}${routeHash(LAYOUT.roles.result)}?${query}`;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { currentRoute, routeHash, shareUrl };
