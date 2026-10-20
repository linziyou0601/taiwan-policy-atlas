#!/usr/bin/env node
/* ==================================================
 * serve.mjs - 本機靜態伺服器
 * --------------------------------------------------
 * - 角色：在本機提供 web/ 的檔案，試玩與截圖使用。正式部署是 GitHub Pages，不使用本檔
 * - 指令：npm run serve（node scripts/serve.mjs [埠號]），預設埠號 8080
 * - 慣例：只提供 web/ 之內的檔案，路徑跳出 web/ 時回 403，網址的百分比編碼無法解碼時回 400。結束代碼 2 為 web/ 不存在
 * ================================================== */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 網站根目錄。
 */
const WEB = join(fileURLToPath(new URL("..", import.meta.url)), "web");

/**
 * 預設埠號。
 */
const DEFAULT_PORT = 8080;

/**
 * 副檔名對應的 Content-Type。
 */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 取出請求網址的路徑並解碼。
 * @param {string} url 請求的網址。
 * @returns {string|null} 解碼後的路徑，網址無法解析或百分比編碼不合法時為 null。
 */
function requestPath(url) {
  // 不合法的百分比編碼會讓 decodeURIComponent 拋出 URIError，攔截後交給呼叫端回 400
  try {
    return decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    // 無法解碼的網址不對應任何檔案
    return null;
  }
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 啟動伺服器。
 * @returns {number} 結束代碼。
 */
function main() {
  // 尚未建置時沒有可提供的檔案
  if (!existsSync(WEB)) {
    process.stderr.write("[serve] 找不到 web/，先執行 npm run build\n");
    return 2;
  }
  // 埠號可由命令列參數指定
  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  createServer((request, response) => {
    const path = requestPath(request.url);
    // 網址無法解碼時回 400，伺服器繼續處理其他請求
    if (path === null) {
      response.writeHead(400).end();
      return;
    }
    // 以 / 結尾的路徑提供該目錄的 index.html
    const file = normalize(join(WEB, path.endsWith("/") ? `${path}index.html` : path));
    // 路徑跳出 web/ 時拒絕，比對含結尾的分隔字元，web-x/ 這類前綴相同的相鄰目錄不算在 web/ 之內
    if (!file.startsWith(WEB + sep)) {
      response.writeHead(403).end();
      return;
    }
    // 檔案不存在時回 404
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    // 本機試玩不快取，重新建置後重新整理就能看到新版
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(readFileSync(file));
  }).listen(port, () => process.stdout.write(`serve: http://localhost:${port}/\n`));
  return 0;
}

// 伺服器啟動後持續執行，結束代碼只在啟動失敗時有意義
process.exitCode = main();
