/* ==================================================
 * common.mjs - 檢查與建置腳本共用的片段
 * --------------------------------------------------
 * - 角色：專案根目錄、git 的檔案清單、遞迴列檔、import 敘述的比對式與檢查程式的目錄，scripts/ 下的腳本共用
 * - 指令：import { ROOT, CODE_DIRS, IMPORT_PATTERN, gitFiles, walkFiles } from "./common.mjs"
 * - 慣例：
 *   - 路徑以 fileURLToPath 轉換，repo 放在含中文或空白的目錄也能運作
 *   - 檔案清單一律依路徑排序，雜湊與輸出不隨檔案系統的列舉順序改變
 * ================================================== */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 專案根目錄：本檔位於 scripts/ 之下。
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * 程式所在的目錄，註解檢查與註解寫作檢查都看這幾個。
 */
const CODE_DIRS = ["src", "scripts", "tests", "pipeline"];

/**
 * `import` 與 `export … from` 敘述的比對式，第 1 組是引用的路徑。
 */
const IMPORT_PATTERN = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm;

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

/* ==================================================
 * 匯出
 * ================================================== */

export { ROOT, CODE_DIRS, IMPORT_PATTERN, gitFiles, walkFiles };
