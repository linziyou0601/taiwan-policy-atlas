#!/usr/bin/env node
/* ==================================================
 * lint-comments.mjs - 程式註解的寫作檢查
 * --------------------------------------------------
 * - 角色：把程式註解抽成純文字，交給本 repo 的 rule-writing lint 檢查行文，與文件套用同一套寫作規則
 *   - 抽出的內容：區塊註解與 JSDoc、行註解、JSX 子節點的註解、Python 的註解與文件字串
 *   - JSDoc 的標籤只留說明，型別與參數名稱屬於程式，移除後再檢查
 * - 指令：`node scripts/lint-comments.mjs [--lint <lint.mjs 的路徑>]`，lint 預設在 `.claude/skills/rule-writing/scripts/lint.mjs`
 * - 慣例：
 *   - 每個原始檔對應 .cache/comments/ 下同路徑加 .txt 的檔案，程式行寫成空行，lint 回報的行號就是原始檔的行號
 *   - 註解裡的指令、公式、型別與程式符號寫在反引號內，lint 視為程式片段
 *   - 結束代碼沿用 lint 的結束代碼，找不到 lint 時為 2
 * ================================================== */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, CODE_DIRS, walkFiles } from "./common.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 要抽出註解的副檔名。
 */
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".py", ".swift"]);

/**
 * 抽出的純文字寫到這個目錄，每次執行先清空。
 */
const OUT = join(ROOT, ".cache", "comments");

/**
 * lint 的預設位置，以 `--lint` 覆寫。
 */
const DEFAULT_LINT = join(ROOT, ".claude", "skills", "rule-writing", "scripts", "lint.mjs");

/**
 * JSDoc 標籤的程式部分：參數標籤的型別與名稱、回傳與例外標籤的型別，其餘標籤只有標籤名稱。
 */
const TAG_PATTERNS = [/^@(param|property)\s+\{[^}]*\}\s+\[?[\w.$]+(?:=[^\]]*)?\]?\s*/, /^@(returns?|throws)\s+\{[^}]*\}\s*/, /^@\w+\s*/];

/**
 * 區段分隔線與 shebang 不是行文，抽出時略過。
 */
const DIVIDER = /^[=\-#]{3,}$/;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 移除 JSDoc 標籤的程式部分：`@param {型別} 名稱` 與 `@returns {型別}` 只留後面的說明。
 * @param {string} line 移除註解符號後的一行。
 * @returns {string}
 */
function stripTag(line) {
  // 依序套用每一條寫法，前一條移除的部分，後一條不會再比對
  return TAG_PATTERNS.reduce((text, pattern) => text.replace(pattern, ""), line);
}

/**
 * 抽出 JavaScript、JSX 與 Swift 檔每一行的註解文字，程式行為空字串。
 * @param {string[]} lines 原始檔的各行。
 * @returns {string[]} 與原始檔同樣行數的註解文字。
 */
function scriptComments(lines) {
  let inBlock = false;
  // 逐行判斷是不是註解，inBlock 記錄是否在跨行的區塊註解內
  return lines.map((raw) => {
    const line = raw.trim();
    let text = "";
    // 區塊註解的中間行與結束行
    if (inBlock) {
      // 遇到結束符號時離開區塊註解
      if (line.includes("*/")) inBlock = false;
      text = line.replace(/\*\/\s*$/, "").replace(/^\*\s?/, "");
    } else if (line.startsWith("{/*")) {
      // JSX 子節點的註解寫在同一行
      text = line.replace(/^\{\/\*\s*/, "").replace(/\s*\*\/\}$/, "");
    } else if (line.startsWith("/*")) {
      // 區塊註解的開頭，同一行沒有結束時下一行起仍是註解
      inBlock = !line.includes("*/");
      text = line.replace(/^\/\*+\s?/, "").replace(/\*\/\s*$/, "");
    } else if (line.startsWith("//")) {
      // 行註解
      text = line.replace(/^\/\/+\s?/, "");
    }
    return stripTag(text.trim());
  });
}

/**
 * 抽出 Python 檔每一行的註解與文件字串，程式行為空字串。
 * @param {string[]} lines 原始檔的各行。
 * @returns {string[]} 與原始檔同樣行數的註解文字。
 */
function pythonComments(lines) {
  let inDocstring = false;
  // 逐行判斷是不是註解，inDocstring 記錄是否在跨行的文件字串內
  return lines.map((raw) => {
    const line = raw.trim();
    // 文件字串的中間行與結束行
    if (inDocstring) {
      // 以引號結尾的行是文件字串的最後一行
      if (line.endsWith('"""')) inDocstring = false;
      return line.replace(/"""$/, "");
    }
    // 文件字串的開頭，同一行沒有結尾時進入文件字串
    if (line.startsWith('"""')) {
      inDocstring = !(line.length > 3 && line.endsWith('"""'));
      return line.slice(3).replace(/"""$/, "");
    }
    // 註解行，其餘是程式
    return line.startsWith("#") ? line.replace(/^#+\s?/, "") : "";
  });
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 抽出全部註解並執行 lint，回傳結束代碼。
 * @returns {number}
 */
function main() {
  const index = process.argv.indexOf("--lint");
  // 有 `--lint` 時用後面的路徑，否則用預設位置
  const lint = index > 0 ? process.argv[index + 1] : DEFAULT_LINT;
  // 找不到 lint 時無從檢查，與輸入檔案缺失同樣以 2 結束
  if (!existsSync(lint)) {
    process.stderr.write(`lint-comments: 找不到 ${lint}，以 --lint 指定 rule-writing 的 lint.mjs\n`);
    return 2;
  }
  // 先清空上一次抽出的內容，刪除的原始檔才不會留下舊的純文字檔
  rmSync(OUT, { recursive: true, force: true });
  const files = CODE_DIRS.flatMap((dir) => walkFiles(join(ROOT, dir), (path) => EXTENSIONS.has(extname(path))));
  // 每個原始檔寫成一個行號對齊的純文字檔，條列符號與分隔線不算行文
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    // Python 與其他語言的註解寫法不同，各用各的抽法
    const comments = file.endsWith(".py") ? pythonComments(lines) : scriptComments(lines);
    // 分隔線與 shebang 寫成空行，條列的「- 」移除後只留內容
    const text = comments.map((line) => (DIVIDER.test(line) || line.startsWith("!") ? "" : line.replace(/^-\s+/, "")));
    const target = join(OUT, `${relative(ROOT, file)}.txt`);
    // 輸出目錄依原始檔的位置逐層建立
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${text.join("\n")}\n`);
  }
  process.stdout.write(`lint-comments: 抽出 ${files.length} 個檔案的註解到 ${relative(ROOT, OUT)}/\n`);
  // 以抽出的目錄當根目錄執行 lint，回報的路徑是原始檔路徑加 .txt
  const result = spawnSync(process.execPath, [lint, ...CODE_DIRS, "--root", OUT], { cwd: OUT, stdio: "inherit" });
  return result.status ?? 1;
}

process.exitCode = main();
