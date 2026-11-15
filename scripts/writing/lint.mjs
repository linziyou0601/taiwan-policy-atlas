#!/usr/bin/env node
/* ==================================================
 * lint.mjs - 寫作檢查的進入點
 * --------------------------------------------------
 * - 角色：解析參數，找出要檢查的文件與程式檔，呼叫版面、文字與註解密度的檢查，印出發現項目與摘要
 * - 指令：
 *   - `npm run lint` 檢查根目錄的四份文件、docs/ 與 src/、scripts/、tests/ 的程式註解
 *   - `npm run lint -- <路徑>...` 只檢查指定的檔案或目錄
 *   - `npm run lint -- --text "<文字>"` 檢查一段 commit message 或 PR 描述
 *   - `npm run lint -- --grown <基準>` 列出文件中比基準的 commit 變長的段落、清單項目與表格的格子
 * - 手寫輸入：scripts/writing/tables/ 的規則表、樣式表與用語表
 * - 產物：標準輸出。每筆發現項目一行 `{檔案}:{行}: [{層級}] {規則} {說明}`，警告與提示另附判定問題與改法，最後一行是摘要
 * - 慣例：
 *   - 結束代碼 0 是沒有錯誤層級的發現項目，1 是有，2 是參數有誤
 *   - 文件檢查版面、連結與文字，程式檔檢查註解的密度與註解的文字，`--text` 只檢查文字
 *   - 規則與判讀見 docs/writing/rules.md
 * ================================================== */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CODE_DIRS, CODE_EXTENSIONS, ROOT, commentLines, walkFiles } from "../common.mjs";
import { checkDensity } from "./comments.mjs";
import { grownUnits } from "./growth.mjs";
import { anchorsOf, checkLinks, checkStructure, maskLine, parseMarkdown } from "./markdown.mjs";
import { checkLine, loadTables } from "./text.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 省略路徑時檢查的文件。
 */
const DOCUMENTS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "DESIGN.md", "docs"];

/**
 * 規則表所在的目錄。
 */
const TABLE_DIR = join(dirname(fileURLToPath(import.meta.url)), "tables");

/**
 * 層級的名稱與輸出的順序，錯誤讓結束代碼變成 1，警告與提示附上判定問題。
 */
const LEVELS = ["錯誤", "警告", "提示"];
const FAILING_LEVEL = "錯誤";

/**
 * 讀取 git diff 輸出的緩衝上限（位元組）。
 */
const DIFF_BUFFER = 64 * 1024 * 1024;

/**
 * `--text` 的發現項目寫在位置欄的名稱。
 */
const TEXT_NAME = "(text)";

/**
 * 檢查文字的行種類，程式碼區塊、分隔與空行略過。
 */
const TEXT_KINDS = new Set(["paragraph", "list", "table", "heading"]);

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把一筆發現項目寫成輸出的幾行。
 * @param {{ file: string, line: number, rule: string, hit: string, replace?: string }} finding 發現項目。
 * @param {ReturnType<typeof loadTables>["rules"]} rules 規則表。
 * @returns {string[]}
 */
function format(finding, rules) {
  const rule = rules.get(finding.rule);
  const fill = (text) => text.replace(/\{(?:命中|詞|粗體)\}/g, finding.hit).replace(/\{改用\}/g, finding.replace ?? "");
  // 第一行是位置、層級、規則與說明
  const lines = [`${finding.file}:${finding.line}: [${rule.level}] ${finding.rule} ${fill(rule.message)}`];
  // 要讀上下文才能判定的層級附上判定問題
  if (rule.judge !== "-") lines.push(`    判定：${rule.judge}`);
  // 用語的改法是登錄的寫法，沒有登錄時只列出命中
  if (rule.fix !== "-" && !(rule.fix.includes("{改用}") && (finding.replace ?? "-") === "-")) lines.push(`    改法：${fill(rule.fix)}`);
  return lines;
}

/**
 * 檢查一段文字的每一行。
 * @param {string} file 位置欄的檔名。
 * @param {{ number: number, text: string, kind: string }[]} records 要檢查的行。
 * @param {ReturnType<typeof loadTables>} tables 三張表。
 * @returns {object[]}
 */
function textFindings(file, records, tables) {
  return records.flatMap((record) => checkLine(record.text, maskLine(record.text), record.kind, tables).map((finding) => ({ ...finding, file, line: record.number })));
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 檢查一份 Markdown：版面、連結與文字。
 * @param {string} path 檔案的絕對路徑。
 * @param {ReturnType<typeof loadTables>} tables 三張表。
 * @returns {object[]}
 */
function lintDocument(path, tables) {
  const file = relative(ROOT, path);
  const text = readFileSync(path, "utf8");
  // 先拆成帶種類的行，版面、連結與文字共用
  const records = parseMarkdown(text);
  // 連結的目標相對於這份文件所在的目錄，空的路徑是本檔
  const anchorsAt = (target) => {
    // 空的路徑指本檔，其餘相對於這份文件所在的目錄
    const destination = target ? resolve(dirname(path), target) : path;
    // 檔案不存在時連結失效
    if (!existsSync(destination)) return null;
    // 只有 Markdown 才有標題可以核對
    return extname(destination) === ".md" && statSync(destination).isFile() ? anchorsOf(readFileSync(destination, "utf8")) : new Set();
  };
  const located = [...checkStructure(records), ...checkLinks(records, anchorsAt)].map((finding) => ({ ...finding, file }));
  return [...located, ...textFindings(file, records.filter((record) => TEXT_KINDS.has(record.kind)), tables)];
}

/**
 * 檢查一個程式檔：註解的密度與註解的文字。
 * @param {string} path 檔案的絕對路徑。
 * @param {ReturnType<typeof loadTables>} tables 三張表。
 * @returns {object[]}
 */
function lintCode(path, tables) {
  const file = relative(ROOT, path);
  const language = CODE_EXTENSIONS[extname(path)];
  // 先標出註解的行，密度與文字的檢查共用
  const lines = readFileSync(path, "utf8").split("\n");
  const marks = commentLines(lines, language);
  const density = checkDensity(lines, marks, language).map((finding) => ({ ...finding, file }));
  // 註解的每一行當成一段文字檢查
  const comments = marks.flatMap((mark, index) => (mark.comment && mark.text.trim() ? [{ number: index + 1, text: mark.text, kind: "paragraph" }] : []));
  return [...density, ...textFindings(file, comments, tables)];
}

/**
 * 執行檢查。
 * @returns {number} 結束代碼。
 */
function main() {
  const { values, positionals } = parseArgs({ options: { text: { type: "string" }, grown: { type: "string" }, help: { type: "boolean", short: "h" } }, allowPositionals: true });
  // 說明列出三種用法
  if (values.help) {
    process.stdout.write('用法：npm run lint -- [<路徑>...]\n      npm run lint -- --text "<文字>"\n      npm run lint -- --grown <基準> [<路徑>...]\n省略路徑時檢查根目錄的四份文件、docs/ 與 src/、scripts/、tests/ 的程式註解。\n');
    return 0;
  }
  // 三張表只讀一次
  const tables = loadTables(TABLE_DIR);
  let findings = [];
  let count = 0;
  // 給了 `--grown` 時只比對文件和基準的差異
  if (values.grown !== undefined) {
    // 沒有給路徑時比對預設的文件
    const paths = positionals.length ? positionals : DOCUMENTS;
    const diff = execFileSync("git", ["diff", "-U0", values.grown, "--", ...paths], { cwd: ROOT, encoding: "utf8", maxBuffer: DIFF_BUFFER });
    // 只列出文件，程式檔的註解以一般的檢查處理
    findings = grownUnits(diff).filter((finding) => extname(finding.file) === ".md");
    count = new Set(findings.map((finding) => finding.file)).size;
  } else if (values.text !== undefined) {
    // 給了 `--text` 時只檢查那一段文字
    const records = values.text.split("\n").map((text, index) => ({ number: index + 1, text, kind: "paragraph" }));
    findings = textFindings(TEXT_NAME, records, tables);
    // 摘要的檔案數把這段文字算成一份
    count = 1;
  // 其餘情形檢查檔案
  } else {
    // 沒有給路徑時檢查預設的文件與程式目錄
    const targets = (positionals.length ? positionals : [...DOCUMENTS, ...CODE_DIRS]).map((path) => resolve(ROOT, path));
    // 指定的路徑要存在
    for (const target of targets) {
      // 路徑打錯時當成參數有誤
      if (!existsSync(target)) {
        process.stderr.write(`找不到 ${relative(ROOT, target)}\n`);
        return 2;
      }
    }
    // 只收 Markdown 與登錄的程式副檔名
    const files = targets.flatMap((target) => walkFiles(target, (file) => extname(file) === ".md" || Object.hasOwn(CODE_EXTENSIONS, extname(file))));
    count = files.length;
    // 文件與程式檔各走自己的檢查
    findings = files.flatMap((file) => (extname(file) === ".md" ? lintDocument(file, tables) : lintCode(file, tables)));
  }
  // 依檔案、行與規則排序，同樣的輸入得到同樣的輸出
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  // 每筆發現項目印出一到三行
  for (const finding of findings) process.stdout.write(`${format(finding, tables.rules).join("\n")}\n`);
  const totals = LEVELS.map((level) => `${level}=${findings.filter((finding) => tables.rules.get(finding.rule).level === level).length}`);
  // 最後一行是摘要
  process.stdout.write(`command=lint files=${count} ${totals.join(" ")}\n`);
  // 有錯誤層級的發現項目時結束代碼是 1
  return findings.some((finding) => tables.rules.get(finding.rule).level === FAILING_LEVEL) ? 1 : 0;
}

// 結束代碼交給呼叫端判斷
process.exitCode = main();
