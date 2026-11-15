/* ==================================================
 * comments.mjs - 寫作檢查：程式註解的密度
 * --------------------------------------------------
 * - 角色：檢查一個程式檔的註解密度：每個分支點上方有註解、連續的程式每三個邏輯行至少一則註解、沒有空白註解。只處理參數收到的各行，註解的行由呼叫端以 common.mjs 的 commentLines 標出
 * - 指令：由 lint.mjs 匯入 checkDensity
 * - 慣例：
 *   - 邏輯行是一個敘述的起點，括號內換行的參數與資料字面值屬於同一個敘述
 *   - else 類的分支，註解可以寫在區塊的第一行
 *   - 匯入宣告、只有閉括號的行、函式與類別的宣告行、return 行不列為連續沒有註解的起點
 *   - 規則的寫法見 docs/writing/rules.md 的程式的檔頭與註解
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 連續邏輯行的上限，第四個沒有註解的邏輯行列為違規。
 */
const MAX_UNCOMMENTED = 3;

/**
 * 各語言的分支寫法。branch 是行首的分支點，alternate 是 else 類的分支，inline 是行內的三元運算與帶條件的推導式，braces 表示大括號是否可能是程式區塊。
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
 * 開大括號前面接這些寫法時是程式區塊，其餘的大括號與小括號、中括號都是資料或參數。
 */
const BLOCK_OPENERS = /(\)|=>|\belse|\btry|\bdo|\bfinally|\bcatch|\bclass\s+\w+(\s+extends\s+[\w.]+)?)\s*$/;

/**
 * 不列為連續沒有註解起點的行：匯入宣告、只有閉括號的行、return 與閉括號開頭的行、宣告行。
 */
const IMPORT_RE = /^(import |from \S+ import )/;
const CLOSER_RE = /^[)\]}]+[);,]*$/;
const TAIL_RE = /^(return\b|\}|\)|\])/;
// 函式、類別與匯出的宣告行
const DECLARATION_RE = /^(def |class |function |async function |export )/;

/**
 * 訊息裡節錄程式的長度。
 */
const EXCERPT_LENGTH = 60;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 移除一行中的字串內容，括號的計數與分支的判斷因此只看程式。
 * @param {string} line 一行程式。
 * @returns {string}
 */
function stripStrings(line) {
  return line.replace(/\\./g, "").replace(/(["'`])(?:(?!\1).)*\1/g, '""');
}

/**
 * 依一行的括號更新括號堆疊：區塊記為 block，其餘記為 literal。
 * @param {string[]} stack 括號堆疊，原地修改。
 * @param {string} line 移除字串後的一行。
 * @param {boolean} braces 這個語言的大括號是否可能是區塊。
 */
function updateStack(stack, line, braces) {
  // 逐字處理開閉括號
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    // 大括號依前文判斷是區塊還是字面值
    if (char === "{") stack.push(braces && BLOCK_OPENERS.test(line.slice(0, index)) ? "block" : "literal");
    // 小括號與中括號一律是字面值或參數
    else if (char === "(" || char === "[") stack.push("literal");
    // 閉括號彈出最近的開括號
    else if (")]}".includes(char)) stack.pop();
  }
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 檢查一個程式檔的註解密度。
 * @param {string[]} lines 原始檔的各行。
 * @param {{ comment: boolean, empty: boolean }[]} marks commentLines 的結果，與 lines 同樣行數。
 * @param {string} language 語言：js、py 或 swift。
 * @returns {{ rule: string, line: number, hit: string }[]}
 */
function checkDensity(lines, marks, language) {
  const lang = LANGUAGES[language];
  const findings = [];
  // 括號堆疊判斷一行是新的邏輯行還是敘述的延續
  const stack = [];
  const continuing = () => stack.at(-1) === "literal";
  // 密度的計數、上一行是否為註解，以及所在的敘述開頭有沒有註解
  let sinceComment = 0;
  let previousWasComment = false;
  let statementCommented = false;
  // 逐行判斷：註解重設計數，邏輯行的起點累計，分支點核對上方或區塊的第一行
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    // 空行不影響計數
    if (!raw) continue;
    // 註解行重設計數
    if (marks[index].comment) {
      // 只有註解符號的行不能算成註解
      if (marks[index].empty) {
        findings.push({ rule: "空白註解", line: index + 1, hit: "" });
        // 空白註解之後的分支點仍然算沒有註解
        previousWasComment = false;
        continue;
      }
      sinceComment = 0;
      // 下一行的分支點算有上方的註解
      previousWasComment = true;
      continue;
    }
    // 移除字串後再判斷括號與分支
    const code = stripStrings(raw);
    // 敘述的開頭記下上方有沒有註解，括號內換行的推導式與三元運算以它為準
    if (!continuing()) statementCommented = previousWasComment;
    // 括號內換行的推導式 for 子句沒有條件時不是分支點
    const comprehension = continuing() && raw.startsWith("for ") && !lang.inline.test(code);
    const branch = lang.branch.test(raw) || (lang.inline.test(code) && !raw.startsWith("import "));
    // 分支點要有上方的註解，else 類也可以寫在區塊的第一行
    if (!comprehension && branch) {
      const alternate = lang.alternate.test(raw) && Boolean(marks[index + 1]?.comment);
      // 括號內的分支屬於所在的敘述，敘述的開頭有註解就算有
      const covered = previousWasComment || (continuing() && statementCommented) || alternate;
      // 三處都沒有註解時列出
      if (!covered) findings.push({ rule: "分支點沒有註解", line: index + 1, hit: raw.slice(0, EXCERPT_LENGTH) });
    }
    // 只在新的邏輯行起點累計密度
    if (!continuing() && !IMPORT_RE.test(raw) && !CLOSER_RE.test(raw)) {
      sinceComment += 1;
      // 超過上限時列出，計數重設後同一段只列一次
      if (sinceComment > MAX_UNCOMMENTED && !TAIL_RE.test(raw) && !DECLARATION_RE.test(raw)) {
        findings.push({ rule: "連續程式沒有註解", line: index + 1, hit: String(sinceComment) });
        sinceComment = 0;
      }
    }
    // 這一行判斷完才更新括號堆疊
    updateStack(stack, code, lang.braces);
    previousWasComment = false;
  }
  return findings;
}

export { checkDensity };
