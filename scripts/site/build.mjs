#!/usr/bin/env node
/* ==================================================
 * build.mjs - 建置網站
 * --------------------------------------------------
 * - 角色：只建前端。打包 src/（含 Preact 與 JSX）成 web/app.js、以 Tailwind 產生 web/app.css，複製資料集、地圖、設定表與影像到 web/，抽出網站用到的字做成字型檔，寫出 build.json
 * - 指令：npm run build（node scripts/site/build.mjs）
 * - 慣例：
 *   - 建置只讀取 data/ 已提交的產物，管線另以 `npm run pipeline` 執行
 *   - 引擎雜湊涵蓋 src/，設定雜湊涵蓋 config/app 與 config/tables，兩者寫入 app.js 與 build.json，網站開機時比對
 *   - 網站版本取自環境變數 APP_VERSION，部署流程帶入觸發部署的 git 標籤，本機建置沒有標籤時寫 dev。版本寫入 build.json，畫面的頁尾與更新紀錄顯示它
 *   - 雜湊的檔案清單取自 git（已追蹤與沒有列入 .gitignore 的檔案），.DS_Store 這類本機雜物不影響雜湊，本機與 CI 算出同一個值
 *   - web/ 只放建置產物，每次建置先清空
 *   - 字型的原始檔依固定版本的網址與 sha256 下載到 .cache/sources/fonts/。網站用到的字依碼位每 FONT.chunk 個分成一份抽字，每份依字集的雜湊快取在 .cache/fonts/，字集沒變時不重新抽字；各份的 @font-face 以 unicode-range 宣告，接在 app.css 之後
 *   - 結束代碼 0 為成功，1 為建置失敗，2 為輸入檔案缺失或格式錯誤
 * ================================================== */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, gitFiles, walkFiles, sha256 } from "../common.mjs";
import { build } from "esbuild";
import subsetFont from "subset-font";
import { shortHash } from "../../src/lib/format.js";
import { formatStamp } from "../../src/lib/stamp.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 建置輸出目錄。
 */
const OUT = join(ROOT, "web");

/**
 * 網站設定 config/app/settings.json，建置清單的檔名與格式取自其中的 paths.build 與 formats.build。
 */
const SETTINGS = JSON.parse(readFileSync(join(ROOT, "config/app/settings.json"), "utf8"));

/**
 * 網站版本：部署流程帶入的 git 標籤，例如 v1.0.0，本機建置沒有標籤時是 dev。
 */
const VERSION = process.env.APP_VERSION || "dev";

/**
 * 引擎雜湊涵蓋的目錄。
 */
const ENGINE_DIRS = ["src"];

/**
 * 設定雜湊涵蓋的目錄。
 */
const CONFIG_DIRS = ["config/app", "config/tables"];

/**
 * 原樣複製到 web/ 的檔案與目錄，路徑相對專案根目錄，輸出位置相同。
 */
const COPIES = ["config/tables", "data/geo/map.json", "data/geo/villages", "data/60-publish/index.json", "assets"];

/**
 * 網站字型 Chiron GoRound TC：Google Fonts 收錄的可變字重版本，SIL Open Font License 1.1，沒有保留字型名稱，抽字後可以隨網站發布，授權全文一起附上。
 * 網址固定在 google/fonts 的一個 commit，檔案內容以 sha256 核對。字集取自 web/ 的資料、設定表與 locale，另加可列印的 ASCII。
 */
const FONT = {
  source: { url: "https://raw.githubusercontent.com/google/fonts/acff8706bac584c3149c630864fe0d3c07e34561/ofl/chirongoroundtc/ChironGoRoundTC%5Bwght%5D.ttf", sha256: "47cd5ff5153799d4c0d05bcc64da849e13b8eb842e46728a66bf2d52c480231f", file: ".cache/sources/fonts/ChironGoRoundTC[wght].ttf" },
  license: { url: "https://raw.githubusercontent.com/google/fonts/acff8706bac584c3149c630864fe0d3c07e34561/ofl/chirongoroundtc/OFL.txt", sha256: "7b9cc84fe1935d1418de4af57b4106038fb836b3a162e1b86507c7fc8543a759", file: ".cache/sources/fonts/OFL.txt" },
  cache: ".cache/fonts",
  out: "fonts/chiron-goround-tc-{n}.woff2",
  // harfbuzz 一次抽字超過約七千個字時失敗，每份的字數留在這個上限之下
  chunk: 5000,
  licenseOut: "licenses/chiron-goround-tc.txt",
  scan: ["web/data", "web/config", "config/app/locale.zh-TW.json"],
};

/**
 * index.html 樣板的代入值：樣板鍵對應 locale 的鍵。
 */
const TEMPLATE_KEYS = { title: ["brand", "name"], description: ["home", "tagline"], noscript: ["common", "noscript"] };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把進度寫入標準錯誤。
 * @param {string} message 訊息。
 */
function log(message) {
  process.stderr.write(`[build] ${message}\n`);
}

/**
 * 計算一組檔案的雜湊：依路徑排序，路徑與內容一併納入。
 * @param {string[]} dirs 目錄。
 * @returns {string}
 */
function hashFiles(dirs) {
  const hash = createHash("sha256");
  // 路徑也納入雜湊，檔案改名同樣視為變更
  for (const file of gitFiles(dirs)) hash.update(`${file}\n`).update(readFileSync(join(ROOT, file)));
  return hash.digest("hex");
}

/**
 * 複製一個檔案或目錄到 web/ 的同一相對位置。
 * @param {string} path 相對路徑。
 */
function copyToWeb(path) {
  const target = join(OUT, path);
  // 先建好上層目錄，cpSync 不會自動建立
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(ROOT, path), target, { recursive: true });
}

/**
 * 取得固定版本的下載檔：本機快取的內容與 sha256 相符時直接使用，否則重新下載並核對。
 * @param {{ url: string, sha256: string, file: string }} source 下載網址、雜湊與快取位置。
 * @returns {Promise<Buffer>} 檔案內容。
 */
async function pinnedDownload(source) {
  const path = join(ROOT, source.file);
  // 快取存在且雜湊相符時不重新下載
  if (existsSync(path) && sha256(readFileSync(path)) === source.sha256) return readFileSync(path);
  log(`下載 ${source.url}`);
  const response = await fetch(source.url);
  // 下載失敗時中止建置
  if (!response.ok) throw new Error(`下載失敗 ${response.status} ${source.url}`);
  const content = Buffer.from(await response.arrayBuffer());
  // 內容與記錄的雜湊不同時同樣中止
  if (sha256(content) !== source.sha256) throw new Error(`雜湊不符 ${source.url}`);
  // 核對過的檔案寫入快取，下次建置直接使用
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return content;
}

/**
 * 收集網站會顯示的字：指定目錄與檔案中 JSON、TSV 的全部字元，加上可列印的 ASCII。
 * @param {string[]} paths 目錄或檔案，相對專案根目錄。
 * @returns {string} 排序後的字集。
 */
function siteCharacters(paths) {
  const chars = new Set();
  // 只讀文字資料，影像等二進位檔不列入
  for (const path of paths.flatMap((path) => walkFiles(join(ROOT, path), (file) => /\.(json|tsv)$/.test(file)))) for (const char of readFileSync(path, "utf8")) chars.add(char);
  // 可列印的 ASCII 一律收進來，程式組成的數字、符號與網址都用得到
  for (let code = 0x20; code < 0x7f; code += 1) chars.add(String.fromCodePoint(code));
  // 換行與定位字元不是字形
  return [...chars].filter((char) => char >= " ").sort().join("");
}

/**
 * 把字集寫成 unicode-range：相連的碼位合成一段。
 * @param {string[]} chars 依碼位排序的字。
 * @returns {string} 例如 `U+20-7E,U+4E00`。
 */
function unicodeRange(chars) {
  const ranges = [];
  // 逐一檢視排序後的碼位
  for (const code of chars.map((char) => char.codePointAt(0))) {
    const last = ranges.at(-1);
    // 緊接上一段的結尾時延長那一段
    if (last && code === last[1] + 1) last[1] = code;
    // 不相連時另起一段
    else ranges.push([code, code]);
  }
  // 只有一個碼位的段寫成單一碼位
  return ranges.map(([start, end]) => (start === end ? `U+${start.toString(16)}` : `U+${start.toString(16)}-${end.toString(16)}`)).join(",");
}

/**
 * 寫出網站字型：網站用到的字依碼位分成數份抽字做成 woff2，連同授權全文寫入 web/，各份的 @font-face 接在 app.css 之後。字集沒變時沿用快取。
 * @returns {Promise<number>} 收錄的字數。
 */
async function writeFont() {
  const [font, license] = await Promise.all([pinnedDownload(FONT.source), pinnedDownload(FONT.license)]);
  const chars = [...siteCharacters(FONT.scan)];
  // 每份的 @font-face 依序累積，最後接在 app.css 之後
  const faces = [];
  mkdirSync(join(OUT, dirname(FONT.out)), { recursive: true });
  // 每份依碼位取連續的 FONT.chunk 個字，瀏覽器只下載頁面用到的那幾份
  for (let start = 0; start < chars.length; start += FONT.chunk) {
    const part = chars.slice(start, start + FONT.chunk);
    const out = FONT.out.replace("{n}", String(faces.length + 1));
    // 快取以原始字型與這份字集的雜湊為鍵，資料增加新字時鍵不同，重新抽字
    const cached = join(ROOT, FONT.cache, `${sha256(FONT.source.sha256 + part.join("")).slice(0, 16)}.woff2`);
    // 快取沒有這組字集時才抽字
    if (!existsSync(cached)) {
      log(`抽出 ${part.length} 個字的字型`);
      mkdirSync(dirname(cached), { recursive: true });
      // 只保留用到的字的字形，GSUB 替換才用到的字形不保留
      writeFileSync(cached, await subsetFont(font, part.join(""), { targetFormat: "woff2", noLayoutClosure: true }));
    }
    cpSync(cached, join(OUT, out));
    faces.push(`@font-face{font-family:"Chiron GoRound TC";src:url("${out}") format("woff2");font-weight:200 900;font-display:swap;unicode-range:${unicodeRange(part)}}`);
  }
  // Tailwind 已寫出 app.css，字型的宣告接在後面
  writeFileSync(join(OUT, "app.css"), readFileSync(join(OUT, "app.css"), "utf8") + faces.join(""));
  writeFileSync(join(OUT, FONT.licenseOut), license);
  return chars.length;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 執行建置。
 * @returns {Promise<number>} 結束代碼。
 */
async function main() {
  // 必要的輸入要先存在，缺少時多半是還沒執行管線
  for (const path of ["data/60-publish/index.json", "data/geo/map.json"]) {
    // 缺少時以結束代碼 2 結束
    if (!existsSync(join(ROOT, path))) {
      log(`找不到 ${path}，先執行 npm run pipeline -- run --offline 與 npm run pipeline -- geo run --offline`);
      return 2;
    }
  }
  // 每次建置前清空 web/，不留上一次的產物
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // 引擎與設定雜湊在打包前算好，寫入程式與建置清單
  const engine = hashFiles(ENGINE_DIRS);
  const config = hashFiles(CONFIG_DIRS);
  log(`引擎 ${shortHash(engine)}，設定 ${shortHash(config)}`);
  // 打包 JavaScript，JSX 以 Preact 的自動執行環境轉換，雜湊以 define 寫入
  await build({
    entryPoints: [join(ROOT, "src/app/main.jsx")],
    outfile: join(OUT, "app.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "none",
    jsx: "automatic",
    jsxImportSource: "preact",
    define: { __BUILD__: JSON.stringify({ engine, config }) },
    logLevel: "warning",
  });
  // Tailwind 掃描 src/ 的類別名稱產生 CSS
  execFileSync(join(ROOT, "node_modules/.bin/tailwindcss"), ["-i", join(ROOT, "src/styles.css"), "-o", join(OUT, "app.css"), "--minify"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  // 複製設定表、地圖、索引與品牌資產
  for (const path of COPIES) copyToWeb(path);
  // 打包進 app.js 的 Preact 是 MIT License，授權全文隨網站一起發布
  mkdirSync(join(OUT, "licenses"), { recursive: true });
  cpSync(join(ROOT, "node_modules/preact/LICENSE"), join(OUT, "licenses/preact.txt"));
  const index = JSON.parse(readFileSync(join(ROOT, "data/60-publish/index.json"), "utf8"));
  // 每個題組的資料集、選區檔與影像依索引複製
  for (const set of [...index.elections, ...index.topics]) {
    copyToWeb(set.dataset);
    // 影像路徑寫在 manifest.assets
    for (const asset of set.manifest.assets) copyToWeb(asset);
    // 選區檔路徑寫在選舉的 manifest.scope_files，主題測驗沒有選區
    for (const path of Object.values(set.manifest.scope_files ?? {})) copyToWeb(path);
  }
  // 主題測驗引用的原始測驗授權全文寫在資料集裡，另存一份隨網站發布
  for (const topic of index.topics) {
    const dataset = JSON.parse(readFileSync(join(ROOT, topic.dataset), "utf8"));
    // 沒有原始檔的題組沒有授權全文
    if (dataset.license) writeFileSync(join(OUT, `licenses/topic-${topic.id}.txt`), dataset.license);
  }
  // 資料與設定表都複製好之後才抽字，字集涵蓋網站會顯示的全部文字
  log(`字型收錄 ${await writeFont()} 個字`);
  const locale = JSON.parse(readFileSync(join(ROOT, "config/app/locale.zh-TW.json"), "utf8"));
  let html = readFileSync(join(ROOT, "src/index.html"), "utf8");
  // 樣板的文字取自 locale
  for (const [key, [group, name]] of Object.entries(TEMPLATE_KEYS)) html = html.replaceAll(`{{${key}}}`, locale[group][name]);
  // 寫出首頁與建置清單，網站開機時以建置清單比對程式內的雜湊
  writeFileSync(join(OUT, "index.html"), html);
  writeFileSync(join(OUT, SETTINGS.paths.build), `${JSON.stringify({ ...formatStamp(SETTINGS.formats.build), version: VERSION, engine, config, elections: index.elections.length }, null, 2)}\n`);
  // 進度寫入標準錯誤，摘要寫入標準輸出
  const files = walkFiles(OUT);
  log(`完成：${files.length} 個檔案`);
  process.stdout.write(`build: web/ ${files.length} 個檔案，版本 ${VERSION}，引擎 ${shortHash(engine)}\n`);
  return 0;
}

// 未預期的錯誤以結束代碼 1 結束
try {
  process.exitCode = await main();
} catch (error) {
  // 錯誤的完整堆疊寫入標準錯誤
  log(error.stack ?? String(error));
  process.exitCode = 1;
}
