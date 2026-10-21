#!/usr/bin/env node
/* ==================================================
 * check-comments.mjs - 程式註解的密度檢查
 * --------------------------------------------------
 * - 角色：逐檔檢查註解規則，列出違規的行。只有註解符號沒有內容的空白註解也列為違規
 *   - 分支點：if、else、for、while、try、catch、except、switch、三元運算與帶條件的推導式，上方要有註解，else、catch、except 也可以寫在區塊第一行
 *   - 密度：連續的程式每三個邏輯行至少一則註解，跨行的一個敘述算一個邏輯行，資料字面值與文件字串的內部不計，字面值內的函式本體照常計算
 * - 指令：node scripts/check-comments.mjs [路徑 ...]，省略路徑時檢查 common.mjs 的 CODE_DIRS
 * - 慣例：
 *   - 支援 .js、.jsx、.mjs、.py、.swift。結束代碼 0 為沒有違規，1 為有違規，違規逐行寫入標準輸出
 *   - JSX 子節點內的註解是以大括號包住的區塊註解，寫在同一行，與一般註解同樣計算
 * ================================================== */
import { readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, CODE_DIRS, CODE_EXTENSIONS, walkFiles, commentLines, report } from "./common.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 連續邏輯行的上限，第四個沒有註解的邏輯行列為違規。
 */
const MAX_UNCOMMENTED = 3;

/**
 * 各語言的分支寫法。
 * - branch：一行的開頭符合時是分支點
 * - alternate：else 類的分支，註解也可以寫在區塊第一行
 * - inline：行內的分支，例如三元運算與帶條件的推導式
 * - braces：大括號是否可能是程式區塊
 */
const LANGUAGES = {
  js: {
    branch: /^(\}\s*)?(if\s*\(|else\b|for\s*\(|while\s*\(|try\s*\{|catch\b|switch\s*\(|do\s*\{|\}\s*catch\b|\}\s*else\b)/,
    alternate: /^(\}\s*)?(else\b|catch\b)/,
    inline: /(?<!\?)\?(?![.?:])[^:]*:/,
    braces: true,
  },
  py: {
    branch: /^(if |elif |else:|for |while |try:|except\b)/,
    alternate: /^(elif |else:|except\b)/,
    inline: /\bif\b.*\belse\b|\bfor\b.*\bif\b/,
    braces: false,
  },
  swift: {
    branch: /^(\}\s*)?(if |guard |else\b|for |while |do \{|catch\b|switch )/,
    alternate: /^(\}\s*)?(else\b|catch\b)/,
    inline: /(?<!\?)\?(?![.?:])[^:]*:/,
    braces: true,
  },
};

/**
 * 開大括號前面接這些寫法時是程式區塊（函式、if、迴圈的本體），其餘大括號與小括號、中括號都是資料或參數。
 */
const BLOCK_OPENERS = /(\)|=>|\belse|\btry|\bdo|\bfinally|\bcatch|\bclass\s+\w+(\s+extends\s+[\w.]+)?)\s*$/;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 移除一行中的字串內容，括號計數與分支判斷不受字串裡的符號影響。
 * @param {string} line 一行程式。
 * @returns {string}
 */
function stripStrings(line) {
  return line.replace(/\\./g, "").replace(/(["'`])(?:(?!\1).)*\1/g, '""');
}

/**
 * 依一行的括號更新括號堆疊：區塊記為 block，其餘記為 literal。
 * 區塊內的每一行都是新的邏輯行，資料字面值與參數內的換行則屬於同一個敘述。
 * @param {string[]} stack 括號堆疊，原地修改。
 * @param {string} line 移除字串後的一行。
 * @param {boolean} braces 這個語言的大括號是否可能是區塊，Python 的大括號一律是字面值。
 */
function updateStack(stack, line, braces) {
  // 逐字處理開閉括號
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    // 大括號依前文判斷是區塊還是字面值
    if (char === "{") stack.push(braces && BLOCK_OPENERS.test(line.slice(0, i)) ? "block" : "literal");
    // 小括號與中括號一律是字面值或參數
    else if (char === "(" || char === "[") stack.push("literal");
    // 閉括號彈出最近的開括號
    else if (")]}".includes(char)) stack.pop();
  }
}

/**
 * 判斷目前是否在一個敘述的延續中：最內層的開括號是字面值或參數時是延續，在區塊內或最外層時是新的邏輯行。
 * @param {string[]} stack 括號堆疊。
 * @returns {boolean}
 */
function continuing(stack) {
  return stack.at(-1) === "literal";
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 檢查一個檔案，回傳違規訊息。
 * @param {string} file 絕對路徑。
 * @returns {string[]} 每筆為「路徑:行號 說明」。
 */
function checkFile(file) {
  const language = CODE_EXTENSIONS[extname(file)];
  const lang = LANGUAGES[language];
  const lines = readFileSync(file, "utf8").split("\n");
  // 註解行、區塊註解與文件字串的每一行都標為註解
  const marks = commentLines(lines, language);
  const name = relative(ROOT, file);
  // 違規逐筆收集，最後一起回傳
  const problems = [];
  // 括號堆疊判斷一行是新的邏輯行還是敘述的延續
  const stack = [];
  // 密度計數與上一行是否為註解，分支點與密度規則共用
  let sinceComment = 0;
  let previousWasComment = false;
  let statementCommented = false;
  // 逐行判斷：註解重設計數，邏輯行起點累計，分支點核對上方或區塊第一行
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    // 空行不影響計數
    if (!raw) continue;
    // 註解行重設計數，文件字串與區塊註解的每一行都算註解
    if (marks[index].comment) {
      // 只有註解符號、沒有內容的行不算註解，避免以空白註解湊數
      if (marks[index].empty) {
        problems.push(`${name}:${index + 1} 空白註解`);
        // 空白註解不能讓下一行的分支點算作有註解
        previousWasComment = false;
        continue;
      }
      // 註解行重設密度計數，下一行的分支點視為有上方註解
      sinceComment = 0;
      previousWasComment = true;
      continue;
    }
    // 移除字串後再判斷括號與分支，字串裡的符號不影響結果
    const code = stripStrings(raw);
    // 敘述開頭記下上方有沒有註解，括號內換行的推導式與三元運算以它為準
    if (!continuing(stack)) statementCommented = previousWasComment;
    // 括號內換行的推導式 for 子句與單行推導式同樣處理，沒有條件時不是分支點
    const comprehension = continuing(stack) && raw.startsWith("for ") && !lang.inline.test(code);
    // 分支點要有上方註解，else 類也可以寫在區塊第一行。行內的三元運算與帶條件的推導式在資料字面值內也算分支點
    if (!comprehension && (lang.branch.test(raw) || (lang.inline.test(code) && !raw.startsWith("import ")))) {
      // else 類分支的註解可以寫在區塊第一行
      const alternate = lang.alternate.test(raw);
      const nextIsComment = Boolean(marks[index + 1]?.comment);
      // 括號內的分支屬於所在的敘述，敘述開頭有註解就算有
      const covered = previousWasComment || (continuing(stack) && statementCommented) || (alternate && nextIsComment);
      // 上方、所在敘述與區塊第一行都沒有註解
      if (!covered) problems.push(`${name}:${index + 1} 分支點上方沒有註解：${raw.slice(0, 60)}`);
    }
    // 只在新的邏輯行起點累計密度，匯入宣告與只有閉括號的行不計
    if (!continuing(stack) && !/^(import |from \S+ import )/.test(raw) && !/^[)\]}]+[);,]*$/.test(raw)) {
      sinceComment += 1;
      // 超過上限時列出，計數重設避免同一段重複列出
      if (sinceComment > MAX_UNCOMMENTED && !/^(return\b|\}|\)|\])/.test(raw) && !/^(def |class |function |async function |export )/.test(raw)) {
        problems.push(`${name}:${index + 1} 連續 ${sinceComment} 個邏輯行沒有註解：${raw.slice(0, 60)}`);
        sinceComment = 0;
      }
    }
    // 這一行判斷完才更新括號堆疊，下一行依堆疊判斷是新的邏輯行還是敘述的延續
    updateStack(stack, code, lang.braces);
    previousWasComment = false;
  }
  return problems;
}

/**
 * 執行檢查，回傳結束代碼。
 * @returns {number}
 */
function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  // 有給路徑時只檢查那些路徑，否則檢查預設目錄
  const targets = positionals.length ? positionals : CODE_DIRS.map((dir) => join(ROOT, dir));
  const problems = targets.flatMap((path) => walkFiles(path, (file) => Object.hasOwn(CODE_EXTENSIONS, extname(file)))).flatMap(checkFile);
  return report(problems, `check-comments: ${problems.length} 筆違規`);
}

// 結束代碼交給 npm run check 判斷
process.exitCode = main();
