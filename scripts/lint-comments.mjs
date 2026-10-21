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
import { parseArgs } from "node:util";
import { ROOT, CODE_DIRS, CODE_EXTENSIONS, walkFiles, commentLines } from "./common.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 抽出的純文字寫入這個目錄，每次執行先清空。
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
 * 主體
 * ================================================== */

/**
 * 抽出全部註解並執行 lint，回傳結束代碼。
 * @returns {number}
 */
function main() {
  // 有 `--lint` 時使用後面的路徑，否則使用預設位置
  const { lint } = parseArgs({ options: { lint: { type: "string", default: DEFAULT_LINT } } }).values;
  // 找不到 lint 時無從檢查，與輸入檔案缺失同樣以 2 結束
  if (!existsSync(lint)) {
    process.stderr.write(`lint-comments: 找不到 ${lint}，以 --lint 指定 rule-writing 的 lint.mjs\n`);
    return 2;
  }
  // 先清空上一次抽出的內容，刪除的原始檔才不會留下舊的純文字檔
  rmSync(OUT, { recursive: true, force: true });
  const files = CODE_DIRS.flatMap((dir) => walkFiles(join(ROOT, dir), (path) => Object.hasOwn(CODE_EXTENSIONS, extname(path))));
  // 每個原始檔寫成一個行號對齊的純文字檔，條列符號與分隔線不算行文
  for (const file of files) {
    // 程式行寫成空行，註解只保留文字，JSDoc 標籤移除 TAG_PATTERNS 比對到的部分
    const comments = commentLines(readFileSync(file, "utf8").split("\n"), CODE_EXTENSIONS[extname(file)]).map((mark) => (mark.comment ? TAG_PATTERNS.reduce((text, pattern) => text.replace(pattern, ""), mark.text.trim()) : ""));
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
