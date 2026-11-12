#!/usr/bin/env node
/* ==================================================
 * check-files.mjs - 逐檔清單檢查
 * --------------------------------------------------
 * - 角色：逐一核對 repo 內每個檔案都屬於 INVENTORY 登錄的類別，並檢查雜物、重複內容、前端孤兒模組，以及資料目錄的選舉與主題測驗代碼都有對應的設定
 * - 指令：node scripts/check-files.mjs，npm run check 會執行
 * - 慣例：
 *   - 檔案清單取自 git（已追蹤與沒有列入 .gitignore 的檔案），與提交後的內容一致。列入 .gitignore 且未追蹤的檔案不會進版控，不列入檢查
 *   - 雜物是 JUNK 列的寫法，例如 log 與截圖，一律不得出現。__pycache__ 與 .DS_Store 已由 .gitignore 排除，列在 JUNK 是為了攔阻以 `git add -f` 強制追蹤的檔案
 *   - 內容完全相同的兩個檔案列為重複，小於 MIN_DUPLICATE_BYTES 的檔案不比對
 *   - src/ 的每個模組（.js 與 .jsx）都要能從 src/app/main.jsx 沿 import 走到，走不到的是孤兒
 *   - 結束代碼 0 為沒有違規，1 為有違規
 * ================================================== */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, gitFiles, sha256, importsOf, report } from "./common.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 檔案清單：每類一條路徑規則與用途，每個檔案至少要符合一類。
 */
const INVENTORY = [
  { pattern: /^(\.gitignore|package\.json|package-lock\.json|requirements\.txt)$/, purpose: "套件與版控設定" },
  { pattern: /^(README|AGENTS|CONTRIBUTING|DESIGN)\.md$|^LICENSE(-DATA)?$/, purpose: "說明文件與授權" },
  { pattern: /^docs\/[a-z0-9-]+\.md$/, purpose: "方法文件" },
  { pattern: /^\.github\/workflows\/[a-z-]+\.yml$/, purpose: "GitHub Pages 部署" },
  { pattern: /^\.claude\/skills\/policy-curation\/(SKILL\.md|references\/[a-z-]+\.md|scripts\/[a-z_]+\.py)$/, purpose: "政見收錄 skill" },
  { pattern: /^\.claude\/skills\/rule-writing\/(SKILL\.md|references\/(?:[a-z-]+\/)*[a-z-]+\.(md|tsv)|scripts\/(?:[a-z-]+\/)*[a-z-]+\.(mjs|md|mdx|txt|tsv)|scripts\/cases\/wiki-docs\/chinese\/\.order)$/, purpose: "寫作規則、引擎與標準答案素材" },
  { pattern: /^\.claude\/skills\/skill-studio\/(SKILL\.md|(agents|references)\/[a-z-]+\.md|scripts\/([a-z_]+\.py|\.gitignore))$/, purpose: "skill 的建立與評估" },
  { pattern: /^assets\/[a-z-]+\.svg$/, purpose: "品牌資產" },
  { pattern: /^config\/app\/(settings|layout|locale\.zh-TW)\.json$/, purpose: "網站設定與文案" },
  { pattern: /^config\/tables\/[a-z]+-[a-z-]+\.tsv$/, purpose: "設定表" },
  { pattern: /^config\/writing\/(layout-profiles\.tsv|project-policy\.md|docs-entry-policy\.md)$/, purpose: "寫作檢查的路徑設定" },
  { pattern: /^config\/pipeline\/(sources|geography)\.yaml$|^config\/pipeline\/(elections|topics)\/[a-z0-9-]+\.yaml$/, purpose: "管線設定" },
  { pattern: /^pipeline\/([a-z_]+\.py|ocr_vision\.swift)$|^pipeline\/adapters\/[a-z_]+\.py$/, purpose: "Python 管線" },
  { pattern: /^scripts\/[a-z-]+\.mjs$/, purpose: "建置與檢查腳本" },
  { pattern: /^src\/(lib|config|registry|data|metrics|cards|blocks|app)\/[a-z-]+\.jsx?$|^src\/(styles\.css|index\.html)$/, purpose: "前端原始碼" },
  { pattern: /^tests\/js\/([a-z-]+\.test\.mjs|helpers\.mjs)$|^tests\/python\/(test_[a-z_]+|helpers)\.py$/, purpose: "測試" },
  { pattern: /^data\/10-fetch\/[a-z0-9-]+\/manifest\.json$/, purpose: "抓取層產物" },
  { pattern: /^data\/20-extract\/[a-z0-9-]+\/(extract\.json|roster\.json|transcripts\.tsv|aliases\.tsv|transcripts\/[a-z0-9-]+\.txt|images\/[a-z0-9-]+\.png)$/, purpose: "抽取層產物與轉錄稿" },
  { pattern: /^data\/30-claims\/[a-z0-9-]+\/(claims\.json|claims\.tsv)$/, purpose: "主張層" },
  { pattern: /^data\/40-match\/[a-z0-9-]+\/(match\.json|questions\.tsv|mappings\.tsv|question-axes\.tsv)$/, purpose: "配題層" },
  { pattern: /^data\/50-score\/[a-z0-9-]+\/(score\.json|specificity\.tsv|neutrality\.tsv)$/, purpose: "評分層" },
  { pattern: /^data\/topics\/[a-z0-9-]+\/(questions|options|question-axes|references)\.tsv$/, purpose: "主題測驗手寫表" },
  { pattern: /^data\/60-publish\/(index\.json|[a-z0-9-]+\/dataset\.json|[a-z0-9-]+\/scopes\/[a-z0-9-]+\.json|topics\/[a-z0-9-]+\/dataset\.json)$|^data\/geo\/map\.json$/, purpose: "發布層與地圖" },
];

/**
 * 雜物的寫法，出現即違規。已追蹤的檔案不受 .gitignore 影響，列入 .gitignore 的寫法也列在這裡，強制加入版控時同樣違規。
 */
const JUNK = [/__pycache__/, /\.pyc$/, /\.DS_Store$/, /\.log$/, /\.part$/, /\.tmp$/, /(^|\/)screenshots?\//, /\.orig$/, /~$/];

/**
 * 重複內容比對的最小檔案大小（位元組），太小的檔案（例如只有表頭的 TSV）內容相同是正常的。
 */
const MIN_DUPLICATE_BYTES = 256;

/**
 * 依選舉分目錄的資料層。
 */
const ELECTION_LAYERS = ["10-fetch", "20-extract", "30-claims", "40-match", "50-score", "60-publish"];

/**
 * 主題測驗的目錄名：手寫表在 data/ 下，發布檔在發布層下，都以這個名稱分出。
 */
const TOPIC_DIR = "topics";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 從進入點沿 import 走訪前端模組。
 * @param {string} entry 進入點的絕對路徑。
 * @returns {Set<string>} 走得到的模組，相對路徑。
 */
function reachable(entry) {
  const seen = new Set();
  const queue = [entry];
  // 廣度優先走訪，每個模組只讀一次
  while (queue.length) {
    const file = queue.shift();
    const rel = relative(ROOT, file);
    // 已走過或不存在的模組略過
    if (seen.has(rel) || !existsSync(file)) continue;
    seen.add(rel);
    // 相對路徑的 import 才是專案內的模組
    for (const { specifier, target } of importsOf(file)) {
      // 只追蹤 .js 與 .jsx 模組，設定 JSON 不是模組
      if (target && /\.jsx?$/.test(specifier)) queue.push(target);
    }
  }
  return seen;
}

/**
 * 列出管線設定目錄下的設定代碼。
 * @param {string} kind config/pipeline/ 下的目錄名，elections 或 topics。
 * @returns {Set<string>} YAML 檔名移除副檔名。
 */
function configIds(kind) {
  return new Set(readdirSync(join(ROOT, "config/pipeline", kind)).map((name) => name.replace(/\.yaml$/, "")));
}

/**
 * 列出一個目錄下的子目錄名稱。
 * @param {string} dir 相對專案根目錄的路徑。
 * @returns {string[]} 目錄尚未產生時為空陣列。
 */
function subdirectories(dir) {
  const full = join(ROOT, dir);
  // 尚未產生的目錄沒有子目錄
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 執行檢查，回傳結束代碼。
 * @returns {number}
 */
function main() {
  const files = gitFiles();
  // 違規與各類檔案數分開累計，摘要列出各類的數量
  const problems = [];
  const counts = new Map(INVENTORY.map((item) => [item.purpose, 0]));
  // 每個檔案要屬於一類，且不是雜物
  for (const file of files) {
    const category = INVENTORY.find((item) => item.pattern.test(file));
    // 不屬於任何一類的檔案沒有用途說明
    if (!category) problems.push(`${file} 不在檔案清單的任何一類`);
    // 屬於某一類時計入該類
    else counts.set(category.purpose, counts.get(category.purpose) + 1);
    // 雜物一律不得出現
    if (JUNK.some((pattern) => pattern.test(file))) problems.push(`${file} 是雜物`);
  }
  // 內容完全相同的檔案列為重複
  const byHash = new Map();
  // 逐檔計算 sha256，太小的檔案不比對
  for (const file of files) {
    const content = readFileSync(join(ROOT, file));
    // 小檔案內容相同是正常的，例如只有表頭的 TSV
    if (content.length < MIN_DUPLICATE_BYTES) continue;
    const hash = sha256(content);
    // 第一次出現時記下，再次出現時列為重複
    if (byHash.has(hash)) problems.push(`${file} 與 ${byHash.get(hash)} 內容相同`);
    // 第一次出現的內容記下檔名
    else byHash.set(hash, file);
  }
  // 前端模組要能從進入點走到
  const used = reachable(join(ROOT, "src/app/main.jsx"));
  // 走不到的模組是孤兒
  for (const file of files.filter((item) => /^src\/.+\.jsx?$/.test(item))) {
    // 進入點走不到的模組沒有任何地方使用
    if (!used.has(file)) problems.push(`${file} 是孤兒模組，src/app/main.jsx 沿 import 走不到`);
  }
  // 資料目錄的選舉代碼要有對應的選舉設定，主題測驗的目錄要有對應的主題測驗設定
  const elections = configIds("elections");
  const topics = configIds("topics");
  // 逐層列出選舉目錄，發布層下的 topics 目錄放主題測驗，另外核對
  for (const layer of ELECTION_LAYERS) {
    // 每個子目錄都要是登錄的選舉
    for (const name of subdirectories(join("data", layer)).filter((item) => item !== TOPIC_DIR)) {
      // 沒有選舉設定的目錄是遺留的產物
      if (!elections.has(name)) problems.push(`data/${layer}/${name} 沒有對應的選舉設定`);
    }
  }
  // 主題測驗的手寫表目錄與發布目錄
  for (const dir of [join("data", TOPIC_DIR), join("data/60-publish", TOPIC_DIR)]) {
    // 每個子目錄都要是登錄的主題測驗
    for (const name of subdirectories(dir)) {
      // 沒有主題測驗設定的目錄是遺留的產物
      if (!topics.has(name)) problems.push(`${dir}/${name} 沒有對應的主題測驗設定`);
    }
  }
  // 違規之後列出各類的檔案數，用來核對清單是否涵蓋預期的檔案
  return report(problems, `check-files: ${files.length} 個檔案，${problems.length} 筆違規`, [...counts].map(([purpose, count]) => `  ${purpose}：${count}`));
}

// 結束代碼交給 npm run check 判斷
process.exitCode = main();
