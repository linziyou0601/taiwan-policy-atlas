/* ==================================================
 * lib/delimited.js - TSV 與 CSV 的讀寫
 * --------------------------------------------------
 * - 角色：資料集匯出成 TSV、CSV，以及讀入使用者匯入的題庫 CSV
 * - 指令：import { parseDelimited, toDelimited } from "../lib/delimited.js"
 * - 慣例：
 *   - CSV 依 RFC 4180：含逗號、引號或換行的欄位以雙引號包住，引號寫兩次
 *   - TSV 不加引號，欄位內的 tab 與換行換成空白，與 repo 內 TSV 的寫法一致
 *   - 讀入時第一列是表頭，回傳以表頭為鍵的物件
 *   - 空值寫 EMPTY_CELL，多值以 LIST_SEPARATOR 分隔，資料層讀 repo 內的 TSV 也用這兩個常數
 * ================================================== */

import { hasValue } from "./objects.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 支援的格式與分隔字元。
 */
const SEPARATORS = { csv: ",", tsv: "\t" };

/**
 * 空值的寫法：repo 內的 TSV、匯出檔與匯入檔都以一個連字號表示沒有值。
 */
const EMPTY_CELL = "-";

/**
 * 多值欄位的分隔字元。
 */
const LIST_SEPARATOR = "、";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 把一格寫成 CSV 欄位。
 * @param {string} text 欄位內容。
 * @returns {string}
 */
function csvCell(text) {
  // 含分隔、引號或換行時加引號，引號寫兩次
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/**
 * 把一格寫成 TSV 欄位。
 * @param {string} text 欄位內容。
 * @returns {string}
 */
function tsvCell(text) {
  return text.replace(/[\t\r\n]+/g, " ");
}

/**
 * 把任意值轉成欄位文字：陣列以頓號相接，物件寫成 JSON，沒有值寫 -。
 * @param {unknown} value 欄位值。
 * @returns {string}
 */
function cellText(value) {
  // 沒有值依 TSV 規格寫 -
  if (!hasValue(value) || value === "") return EMPTY_CELL;
  // 多值以頓號相接
  if (Array.isArray(value)) return value.length ? value.map(cellText).join(LIST_SEPARATOR) : EMPTY_CELL;
  // 巢狀物件保留成 JSON，讀者仍能看到完整內容
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 把列寫成 TSV 或 CSV 文字。
 * @param {Record<string, unknown>[]} rows 資料列。
 * @param {string[]} columns 欄名，依序寫出。
 * @param {"tsv"|"csv"} format 格式。
 * @returns {string}
 */
function toDelimited(rows, columns, format) {
  // 兩種格式只差在儲存格的跳脫規則，其餘寫出流程相同
  const cell = format === "csv" ? csvCell : tsvCell;
  const separator = SEPARATORS[format];
  const lines = [columns.map(cell).join(separator)];
  // 每列依欄名順序取值
  for (const row of rows) lines.push(columns.map((column) => cell(cellText(row[column]))).join(separator));
  return `${lines.join("\n")}\n`;
}

/**
 * 讀入 CSV 或 TSV 文字。
 * @param {string} text 檔案內容，可以有 BOM。
 * @param {"tsv"|"csv"} format 格式。
 * @returns {{ header: string[], rows: Record<string, string>[] }}
 */
function parseDelimited(text, format) {
  const separator = SEPARATORS[format];
  const records = [];
  let record = [];
  // 目前儲存格的內容與是否在引號內，要跨字元保留狀態才能處理含換行的儲存格
  let cellValue = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  // 逐字掃描，引號內的分隔與換行屬於欄位內容
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    // 引號內：遇到成對引號寫入一個引號，單獨引號結束引號區
    if (quoted) {
      // 引號後緊接引號表示跳脫
      if (char === '"' && source[index + 1] === '"') {
        cellValue += '"';
        index += 1;
      } else if (char === '"') {
        // 單獨的引號結束引號區
        quoted = false;
      } else {
        // 其他字元原樣寫入
        cellValue += char;
      }
      continue;
    }
    // CSV 欄位開頭的引號開啟引號區，TSV 不使用引號
    if (char === '"' && format === "csv" && cellValue === "") quoted = true;
    // 分隔字元結束一格
    else if (char === separator) {
      record.push(cellValue);
      cellValue = "";
    } else if (char === "\n") {
      // 換行結束一列，移除 CRLF 的 CR
      record.push(cellValue.replace(/\r$/, ""));
      records.push(record);
      record = [];
      // 一列結束後重置儲存格，下一個字元從新的儲存格開始
      cellValue = "";
    } else {
      // 一般字元累加到目前的欄位
      cellValue += char;
    }
  }
  // 檔尾沒有換行時補上最後一列
  if (cellValue !== "" || record.length) records.push([...record, cellValue.replace(/\r$/, "")]);
  const [header = [], ...body] = records;
  // 移除空白列，其餘依表頭轉成物件
  const rows = body
    .filter((cells) => cells.some((value) => value.trim() !== ""))
    .map((cells) => Object.fromEntries(header.map((name, i) => [name.trim(), (cells[i] ?? "").trim()])));
  return { header: header.map((name) => name.trim()), rows };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { toDelimited, parseDelimited, cellText, EMPTY_CELL };
