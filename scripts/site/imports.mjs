#!/usr/bin/env node
/* ==================================================
 * imports.mjs - 前端分層的 import 圖檢查
 * --------------------------------------------------
 * - 角色：讀 src/ 每個 .js 與 .jsx 的 import，依 LAYER_RULES 檢查依賴方向，禁止反向依賴、跨層引用、未登錄的外部套件與指到不存在檔案的 import
 * - 指令：node scripts/site/imports.mjs，npm run check 會執行
 * - 慣例：
 *   - 分層由下而上為 lib、config、registry、data、metrics、cards、blocks、app，每層只能 import 規則列出的層
 *   - 只有 config 層可以讀 src/ 以外的檔案，而且只限 config/app/ 的 JSON
 *   - 外部套件只有 PACKAGE_RULES 登錄的層可以引用：Preact 只在 blocks 與 app 層，計分與卡片層不依賴框架
 *   - .jsx 檔只能放在 blocks 與 app 層，JSX 由 esbuild 轉成 preact/jsx-runtime 的呼叫，等同引用 Preact
 *   - 結束代碼 0 為沒有違規，1 為有違規
 * ================================================== */
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROOT, walkFiles, importsOf, report } from "../common.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 前端原始碼目錄。
 */
const SRC = join(ROOT, "src");

/**
 * 各層可以 import 的層，同層互相 import 也要列出。
 * - lib：與專案無關的工具，不依賴任何層
 * - config：設定與文案，只依賴 lib
 * - registry：具名策略，依賴 config 與 lib
 * - data：載入與模型，依賴 registry、config、lib
 * - metrics：計分，依賴 data、registry、config、lib
 * - cards：卡片與狀態，依賴 metrics、config、lib，不直接引用 data 與 registry
 * - blocks：顯示元件，依賴 config、lib 與 Preact，畫面完全依卡片描述繪製，資料來源留在 cards 層
 * - app：組裝，依賴 cards、blocks、config、lib 與 Preact
 */
const LAYER_RULES = {
  lib: ["lib"],
  config: ["config", "lib"],
  registry: ["registry", "config", "lib"],
  data: ["data", "registry", "config", "lib"],
  metrics: ["metrics", "data", "registry", "config", "lib"],
  cards: ["cards", "metrics", "config", "lib"],
  blocks: ["blocks", "config", "lib"],
  app: ["app", "cards", "blocks", "config", "lib"],
};

/**
 * 各層可以引用的外部套件，未列出的層一律不能引用。
 */
const PACKAGE_RULES = {
  blocks: ["preact", "preact/hooks"],
  app: ["preact", "preact/hooks"],
};

/**
 * config 層可以讀的 src/ 以外目錄。
 */
const CONFIG_EXTERNAL = join(ROOT, "config", "app") + sep;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 檔案所在的層：src/ 下的第一層目錄名稱。
 * @param {string} file 絕對路徑。
 * @returns {string|null} 不在 src/ 內時為 null。
 */
function layerOf(file) {
  const rel = relative(SRC, file);
  // 跳出 src/ 的路徑不屬於任何層
  if (rel.startsWith("..")) return null;
  return rel.split(sep)[0];
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 檢查全部檔案，回傳結束代碼。
 * @returns {number}
 */
function main() {
  const problems = [];
  let edges = 0;
  // 逐檔讀 import
  for (const file of walkFiles(SRC, (path) => /\.jsx?$/.test(path))) {
    const layer = layerOf(file);
    const name = relative(ROOT, file);
    // 檔案要放在登錄的層目錄內
    if (!LAYER_RULES[layer]) {
      problems.push(`${name} 不在任何登錄的層目錄內`);
      continue;
    }
    // JSX 隱含引用 Preact，只有可以引用 Preact 的層能寫 .jsx
    if (file.endsWith(".jsx") && !(PACKAGE_RULES[layer] ?? []).includes("preact")) problems.push(`${name}（${layer}）不能寫 JSX，這一層不依賴 Preact`);
    // 逐一檢查每個 import 與 export from 的來源
    for (const { specifier, target } of importsOf(file)) {
      edges += 1;
      // 外部套件要登錄在這一層的 PACKAGE_RULES，專案內的模組一律以相對路徑引用
      if (!target) {
        // 未登錄的套件或不該依賴框架的層都列為違規
        if (!(PACKAGE_RULES[layer] ?? []).includes(specifier)) problems.push(`${name}（${layer}）引用了未登錄的外部套件 ${specifier}`);
        continue;
      }
      // 指到的檔案要存在
      if (!existsSync(target)) problems.push(`${name} 引用的 ${specifier} 不存在`);
      const targetLayer = layerOf(target);
      // src/ 以外只有 config 層可以讀 config/app/ 的 JSON
      if (targetLayer === null) {
        // 其他層或其他位置都不允許
        if (layer !== "config" || !target.startsWith(CONFIG_EXTERNAL) || !target.endsWith(".json")) problems.push(`${name} 引用了 src/ 以外的 ${specifier}`);
        continue;
      }
      // 依分層規則檢查方向
      if (!LAYER_RULES[layer].includes(targetLayer)) problems.push(`${name}（${layer}）不能引用 ${targetLayer} 層：${specifier}`);
    }
  }
  return report(problems, `site/imports: ${edges} 條 import，${problems.length} 筆違規`);
}

// 結束代碼交給 npm run check 判斷
process.exitCode = main();
