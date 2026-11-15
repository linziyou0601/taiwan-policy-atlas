/* ==================================================
 * growth.mjs - 寫作檢查：改動後變長的段落
 * --------------------------------------------------
 * - 角色：從 `git diff -U0` 的輸出找出比修改之前多出門檻字數以上的段落、清單項目與表格的格子。修改既有的文字時，補述、特例與重述通常讓一段變長，列出來逐句判斷。只處理參數收到的 diff 文字
 * - 指令：由 lint.mjs 的 `--grown <基準>` 匯入 grownUnits
 * - 慣例：
 *   - 同一個區塊內依序把刪除的行與新增的行配對，表格的列依欄的位置逐格比較
 *   - 沒有對應刪除行的新增行整行都算增加，新檔案因此每一行都會列出，檢查新檔案時改用一般的檢查
 *   - 變長不一定有錯，這一條的層級是提示
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 多出這個字數以上才列出。
 */
const GROWTH_LIMIT = 5;

/**
 * diff 的區塊標頭，第 1 組是新檔案的起始行號。
 */
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)/;

/**
 * 清單項目開頭的符號，比較長度前先拿掉。
 */
const LIST_MARK_RE = /^(?:[-*+]|\d+[.)])\s+/;

/**
 * 規則的名稱，登錄在 tables/rules.tsv。
 */
const GROWTH_RULE = "改動後變長";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把一行拆成比較的單位：表格的列是每一格，其餘是去掉清單符號的整行。
 * @param {string} line 一行文字。
 * @returns {string[]}
 */
function unitsOf(line) {
  const text = line.trim();
  // 表格的列依格線拆開，頭尾的格線不算一格
  if (text.startsWith("|")) return text.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  return [text.replace(LIST_MARK_RE, "")];
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 找出改動後變長的段落、清單項目與表格的格子。
 * @param {string} diff `git diff -U0` 的輸出。
 * @param {number} [limit] 多出幾個字以上才列出。
 * @returns {{ rule: string, file: string, line: number, hit: string }[]} hit 是多出的字數。
 */
function grownUnits(diff, limit = GROWTH_LIMIT) {
  const findings = [];
  // 目前的檔案、新增行的行號，以及這個區塊的刪除行與新增行
  let file = null;
  let lineNumber = 0;
  let removed = [];
  // 新增行連同它在新檔案裡的行號
  let added = [];
  const flush = () => {
    // 刪除行與新增行依序配對，逐個單位比較長度
    added.forEach(({ text, number }, index) => {
      // 沒有對應的刪除行時，整行都算增加
      const before = removed[index] === undefined ? [] : unitsOf(removed[index]);
      unitsOf(text).forEach((unit, position) => {
        // 長度以碼位計，一個中文字算一個字
        const grown = [...unit].length - [...(before[position] ?? "")].length;
        // 多出的字數達到門檻才列出
        if (grown >= limit) findings.push({ rule: GROWTH_RULE, file, line: number, hit: String(grown) });
      });
    });
    removed = [];
    added = [];
  };
  // 逐行讀 diff，遇到新的檔案或區塊時結算前一個區塊
  for (const line of diff.split("\n")) {
    // 新檔案的路徑
    if (line.startsWith("+++ ")) {
      flush();
      // 刪除的檔案沒有新的路徑
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      continue;
    }
    // 舊檔案的路徑與 diff 的標頭不是內容
    if (line.startsWith("--- ") || line.startsWith("diff ") || line.startsWith("index ")) continue;
    const hunk = HUNK_RE.exec(line);
    // 區塊標頭給出新增行的起始行號
    if (hunk) {
      flush();
      lineNumber = Number(hunk[1]);
      // 區塊標頭本身不是內容
      continue;
    }
    // 刪除的檔案沒有新的路徑，略過它的內容
    if (file === null) continue;
    // 刪除行留著配對，新增行記下行號
    if (line.startsWith("-")) removed.push(line.slice(1));
    // 新增行的行號逐行往下數
    else if (line.startsWith("+")) {
      added.push({ text: line.slice(1), number: lineNumber });
      // 下一個新增行在下一行
      lineNumber += 1;
    }
  }
  flush();
  return findings;
}

export { grownUnits };
