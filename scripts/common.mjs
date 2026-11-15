/* ==================================================
 * common.mjs - 檢查與建置腳本共用的片段
 * --------------------------------------------------
 * - 角色：專案根目錄、本機伺服器的預設埠號、git 的檔案清單、遞迴列檔、sha256、模組的 import、程式的註解行、檢查程式的目錄與副檔名，以及在 node 中以 repo 檔案代替網站的 fetch，scripts/ 下的腳本與 tests/ 的測試共用
 * - 指令：import { ROOT, CODE_DIRS, CODE_EXTENSIONS, gitFiles, walkFiles, sha256, importsOf, commentLines, report, installRepoFetch } from "./common.mjs"
 * - 慣例：
 *   - 路徑以 fileURLToPath 轉換，repo 放在含中文或空白的目錄也能運作
 *   - 檔案清單一律依路徑排序，雜湊與輸出不隨檔案系統的列舉順序改變
 * ================================================== */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 專案根目錄：本檔位於 scripts/ 之下。
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * 程式所在的目錄。
 */
const CODE_DIRS = ["src", "scripts", "tests"];

/**
 * 程式的副檔名與對應的語言。
 */
const CODE_EXTENSIONS = { ".js": "js", ".jsx": "js", ".mjs": "js", ".py": "py", ".swift": "swift" };

/**
 * `import` 與 `export … from` 敘述的比對式，第 1 組是引用的路徑。
 */
const IMPORT_PATTERN = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm;

/**
 * 各語言的註解寫法：行註解的符號、是否有區塊註解與 JSX 子節點的註解，以及文件字串的引號。
 */
const COMMENT_SYNTAX = {
  js: { line: /^\/\/+\s?/, block: true, jsx: true, docstring: null },
  swift: { line: /^\/\/+\s?/, block: true, jsx: false, docstring: null },
  py: { line: /^#+\s?/, block: false, jsx: false, docstring: '"""' },
};

/**
 * 遞迴列檔時略過的目錄：套件、Python 的編譯快取，以及 . 開頭的目錄。
 */
const SKIPPED_DIRS = new Set(["node_modules", "__pycache__"]);

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 列出 git 已追蹤與沒有列入 .gitignore 的檔案，依路徑排序。
 * @param {string[]} [dirs] 只列這幾個目錄，相對專案根目錄，省略時列全部。
 * @returns {string[]} 相對路徑。
 */
function gitFiles(dirs = []) {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...dirs], { cwd: ROOT });
  // 以 NUL 分隔，檔名含中文或空白也不會切錯
  const files = output.toString("utf8").split("\0");
  // 刪除後尚未提交的檔案略過，其餘依路徑排序
  return files.filter((file) => file && existsSync(join(ROOT, file))).sort();
}

/**
 * 遞迴列出一個路徑下的檔案，依路徑排序，略過 SKIPPED_DIRS 與 . 開頭的目錄。
 * @param {string} path 檔案或目錄的絕對路徑。
 * @param {(file: string) => boolean} [keep] 檔案的篩選條件，省略時全部保留。
 * @returns {string[]} 絕對路徑。
 */
function walkFiles(path, keep = () => true) {
  // 單一檔案依篩選條件決定是否列入
  if (!statSync(path).isDirectory()) return keep(path) ? [path] : [];
  // 目錄略過套件、快取與隱藏目錄，其餘依名稱排序後遞迴展開
  const names = readdirSync(path).filter((name) => !name.startsWith(".") && !SKIPPED_DIRS.has(name));
  return names.sort().flatMap((name) => walkFiles(join(path, name), keep));
}

/**
 * 讀出一個模組的 `import` 與 `export … from`，相對路徑解析成絕對路徑。
 * @param {string} file 模組的絕對路徑。
 * @returns {{ specifier: string, target: string|null }[]} specifier 是原本寫的路徑，target 是解析後的絕對路徑，外部套件為 null。
 */
function importsOf(file) {
  const specifiers = [...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)].map((match) => match[1]);
  // 專案內的模組一律以相對路徑引用，其餘是外部套件
  return specifiers.map((specifier) => ({ specifier, target: specifier.startsWith(".") ? resolve(dirname(file), specifier) : null }));
}

/**
 * 逐行標出註解與文件字串，跨行的區塊註解與文件字串依前面的行判斷。
 * @param {string[]} lines 原始檔的各行。
 * @param {string} language CODE_EXTENSIONS 的語言。
 * @returns {{ comment: boolean, text: string, empty: boolean }[]} 與原始檔同樣行數。comment 表示這一行是註解或文件字串，text 是移除註解符號後的文字，empty 表示只有註解符號、沒有內容的行註解。
 */
function commentLines(lines, language) {
  const syntax = COMMENT_SYNTAX[language];
  // 是否在跨行的區塊註解或文件字串內
  let inBlock = false;
  let inDocstring = false;
  // 逐行判斷，程式行的 text 是空字串
  return lines.map((raw) => {
    const line = raw.trim();
    // 文件字串的中間行與結束行
    if (inDocstring) {
      // 以引號結尾的行是文件字串的最後一行
      if (line.endsWith(syntax.docstring)) inDocstring = false;
      return { comment: true, text: line.replace(/"""$/, ""), empty: false };
    }
    // 文件字串的開頭，同一行沒有結尾時進入文件字串
    if (syntax.docstring && line.startsWith(syntax.docstring)) {
      inDocstring = !(line.length > syntax.docstring.length && line.endsWith(syntax.docstring));
      return { comment: true, text: line.slice(syntax.docstring.length).replace(/"""$/, ""), empty: false };
    }
    // 區塊註解的中間行與結束行
    if (inBlock) {
      // 遇到結束符號時離開區塊註解
      if (line.includes("*/")) inBlock = false;
      // 移除結束符號與行首的星號
      return { comment: true, text: line.replace(/\*\/\s*$/, "").replace(/^\*\s?/, ""), empty: false };
    }
    // JSX 子節點的註解寫在同一行
    if (syntax.jsx && line.startsWith("{/*")) {
      const text = line.replace(/^\{\/\*\s*/, "").replace(/\s*\*\/\}$/, "");
      return { comment: true, text, empty: !text };
    }
    // 區塊註解的開頭，同一行沒有結束時下一行起仍是註解
    if (syntax.block && line.startsWith("/*")) {
      inBlock = !line.includes("*/");
      // 移除開頭的斜線與星號，同一行結束時連結束符號一起移除
      return { comment: true, text: line.replace(/^\/\*+\s?/, "").replace(/\*\/\s*$/, ""), empty: false };
    }
    // 行註解，其餘是程式
    if (!syntax.line.test(line)) return { comment: false, text: "", empty: false };
    const text = line.replace(syntax.line, "");
    return { comment: true, text, empty: !text.trim() };
  });
}

/**
 * 檢查腳本的收尾：寫出結果並決定結束代碼。
 * @param {string[]} problems 違規。
 * @param {string} summary 摘要。
 * @param {string[]} [details] 寫在違規與摘要之間的明細。
 * @returns {number} 結束代碼。
 */
function report(problems, summary, details = []) {
  // 違規在前、明細在中、摘要在最後一行
  for (const line of [...problems, ...details, summary]) process.stdout.write(`${line}\n`);
  // 有違規時以結束代碼 1 結束
  return problems.length ? 1 : 0;
}

/**
 * 計算內容的 sha256。
 * @param {Buffer|string} content 內容。
 * @returns {string} 十六進位的雜湊。
 */
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 以 repo 檔案代替網站的 fetch，讓資料層與計分層在 node 中讀取真實資料。網站的路徑與 repo 的相對路徑相同，只有建置清單以傳入的內容代替。
 * @param {object} build 代替 build.json 的建置清單。
 */
function installRepoFetch(build) {
  globalThis.fetch = async (path) => {
    // 建置清單在 repo 內沒有，以傳入的內容代替
    if (path === "build.json") return { ok: true, text: async () => JSON.stringify(build) };
    // 其餘路徑對應 repo 內的同名檔案
    try {
      const body = readFileSync(join(ROOT, path), "utf8");
      return { ok: true, text: async () => body };
    // 讀取不到的檔案對應網站的 404
    } catch {
      return { ok: false, text: async () => "" };
    }
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { ROOT, CODE_DIRS, CODE_EXTENSIONS, gitFiles, walkFiles, sha256, importsOf, commentLines, report, installRepoFetch };
