/* ==================================================
 * text.mjs - 寫作檢查：句子、用語與排版
 * --------------------------------------------------
 * - 角色：讀取規則表、樣式表與用語表，逐行比對遮罩後的文字，回報命中的規則。文件、程式註解與 `--text` 的文字共用這裡的比對
 * - 指令：由 lint.mjs 匯入 loadTables 與 checkLine
 * - 慣例：
 *   - 規則的層級、說明、判定問題與改法寫在 tables/rules.tsv，樣式寫在 tables/patterns.tsv，用語寫在 tables/terms.tsv，新增一條規則時修改表
 *   - 樣式的比對對象是「遮罩行」時比對每一種行，是「表格以外」時略過表格的列
 *   - 用語的例外欄列出含有這個詞而意思不同的寫法，這一行出現任何一個例外時略過這個詞
 *   - 句中的粗體以原文比對：一行開頭的粗體是小標，行中的粗體才是強調
 * ================================================== */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 三張表的檔名與表頭。
 */
const RULE_TABLE = { file: "rules.tsv", header: ["規則", "層級", "說明", "判定", "改法"] };
const PATTERN_TABLE = { file: "patterns.tsv", header: ["規則", "比對對象", "正規式"] };
const TERM_TABLE = { file: "terms.tsv", header: ["詞", "規則", "改用", "例外"] };

/**
 * 表內沒有值的寫法與多值的分隔。
 */
const EMPTY = "-";
const MULTI_SEPARATOR = "、";

/**
 * 略過表格的比對對象。
 */
const OUTSIDE_TABLES = "表格以外";

/**
 * 句中的粗體：前面已經有文字的粗體。清單符號、表格的格線與引言符號不算文字。
 */
const BOLD_RE = /\*\*[^*\n]+\*\*/g;
// 一行的開頭：引言符號、格線、清單符號與勾選框
const LINE_START_RE = /^[\s>|]*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ x]\]\s+)?$/;
const BOLD_RULE = "句中粗體";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 讀取一張 TSV，核對表頭。
 * @param {string} directory 表所在的目錄。
 * @param {{ file: string, header: string[] }} table 檔名與表頭。
 * @returns {Record<string, string>[]}
 */
function readTable(directory, table) {
  const lines = readFileSync(join(directory, table.file), "utf8").split("\n").filter(Boolean);
  // 表頭不符時欄會取錯，直接停下
  if (lines[0] !== table.header.join("\t")) throw new Error(`${table.file} 的表頭是 ${lines[0]}，預期 ${table.header.join("\t")}`);
  return lines.slice(1).map((line) => Object.fromEntries(line.split("\t").map((cell, index) => [table.header[index], cell])));
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 讀取三張表，樣式先編譯成正規式。
 * @param {string} directory 表所在的目錄。
 * @returns {{ rules: Map<string, { level: string, message: string, judge: string, fix: string }>, patterns: { rule: string, scope: string, regex: RegExp }[], terms: { term: string, rule: string, replace: string, exceptions: string[] }[] }}
 */
function loadTables(directory) {
  const rules = new Map(readTable(directory, RULE_TABLE).map((row) => [row["規則"], { level: row["層級"], message: row["說明"], judge: row["判定"], fix: row["改法"] }]));
  const patterns = readTable(directory, PATTERN_TABLE).map((row) => ({ rule: row["規則"], scope: row["比對對象"], regex: new RegExp(row["正規式"], "gu") }));
  // 用語的例外先拆成清單
  const terms = readTable(directory, TERM_TABLE).map((row) => ({
    term: row["詞"],
    rule: row["規則"],
    replace: row["改用"],
    // 沒有例外的詞是空清單
    exceptions: row["例外"] === EMPTY ? [] : row["例外"].split(MULTI_SEPARATOR),
  }));
  // 樣式與用語引用的規則都要登錄在規則表
  for (const item of [...patterns, ...terms]) {
    // 少了規則時不知道層級與改法
    if (!rules.has(item.rule)) throw new Error(`${item.rule} 沒有登錄在 ${RULE_TABLE.file}`);
  }
  return { rules, patterns, terms };
}

/**
 * 比對一行文字。
 * @param {string} original 原文的一行，用來找句中的粗體。
 * @param {string} masked 遮罩後的一行。
 * @param {string} kind 行的種類，table 時略過「表格以外」的樣式。
 * @param {ReturnType<typeof loadTables>} tables 三張表。
 * @returns {{ rule: string, hit: string, replace?: string }[]}
 */
function checkLine(original, masked, kind, tables) {
  const findings = [];
  // 樣式逐條比對，同一條在一行內只回報第一處
  for (const pattern of tables.patterns) {
    // 表格的列不比對標點與分號這類以句子為單位的樣式
    if (kind === "table" && pattern.scope === OUTSIDE_TABLES) continue;
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(masked);
    // 具名的命中優先，沒有時取整段
    if (match) findings.push({ rule: pattern.rule, hit: (match.groups?.["命中"] ?? match[0]).replace(/\x01/g, "`…`") });
  }
  // 用語逐詞比對，這一行有例外的寫法時略過
  for (const item of tables.terms) {
    // 英文的詞不分大小寫
    const found = /^[\x20-\x7e]+$/.test(item.term) ? masked.toLowerCase().includes(item.term.toLowerCase()) : masked.includes(item.term);
    // 改用的寫法本身含有這個詞時，這一行寫的已經是改用的寫法
    const corrected = item.replace.includes(item.term) && masked.includes(item.replace);
    // 例外是含有這個詞而意思不同的寫法
    if (found && !corrected && !item.exceptions.some((exception) => masked.includes(exception))) findings.push({ rule: item.rule, hit: item.term, replace: item.replace });
  }
  // 行中的粗體是強調，一行開頭的粗體是小標
  for (const match of original.matchAll(BOLD_RE)) {
    // 前面只有清單符號或格線時是小標
    if (!LINE_START_RE.test(original.slice(0, match.index)) && tables.rules.has(BOLD_RULE)) {
      findings.push({ rule: BOLD_RULE, hit: match[0] });
      break;
    }
  }
  return findings;
}

export { loadTables, checkLine };
