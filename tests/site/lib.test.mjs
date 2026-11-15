/* ==================================================
 * lib.test.mjs - 工具函式的測試
 * --------------------------------------------------
 * - 角色：檢查 TSV/CSV 讀寫、Kendall τ-b、分位數、可重現亂數、壓縮編碼與格式化
 * - 指令：`npm test`，或 `node --test tests/site/lib.test.mjs` 單獨執行
 * - 慣例：τ-b 以手動計算的小例子核對
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { toDelimited, parseDelimited } from "../../src/lib/delimited.js";
import { kendallTauB, mulberry32, quantile } from "../../src/lib/stats.js";
import { packText, unpackText, fnv1a } from "../../src/lib/codec.js";
import { percent, fill } from "../../src/lib/format.js";

test("CSV 寫出後再讀取，內容相同，含逗號、引號與換行", () => {
  const rows = [{ a: 'x,"y"', b: "第一行\n第二行" }, { a: ["甲", "乙"], b: null }];
  const text = toDelimited(rows, ["a", "b"], "csv");
  // 寫出後再讀取，欄位內容要完全相同
  const parsed = parseDelimited(text, "csv");
  // 表頭與含特殊字元的欄位都還原
  assert.deepEqual(parsed.header, ["a", "b"]);
  assert.equal(parsed.rows[0].a, 'x,"y"');
  assert.equal(parsed.rows[0].b, "第一行\n第二行");
  // 多值以頓號相接，空值寫 -
  assert.equal(parsed.rows[1].a, "甲、乙");
  assert.equal(parsed.rows[1].b, "-");
});

test("TSV 把欄位內的 tab 與換行替換為空白", () => {
  // TSV 不加引號，特殊字元替換為空白
  const text = toDelimited([{ a: "x\ty\nz" }], ["a"], "tsv");
  assert.equal(text, "a\nx y z\n");
});

test("Kendall τ-b：完全一致、完全相反與同分", () => {
  // 排序相同為 1，完全相反為 -1
  assert.equal(kendallTauB([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(kendallTauB([1, 2, 3], [3, 2, 1]), -1);
  // 一對同分：C=2、D=0、n0=3、n1=0、n2=1，τ-b = 2 / √(3×2)
  assert.ok(Math.abs(kendallTauB([1, 2, 3], [1, 2, 2]) - 2 / Math.sqrt(6)) < 1e-12);
  assert.equal(kendallTauB([1, 1], [1, 2]), null);
});

test("分位數線性內插", () => {
  // 偶數個值的中位數取中間兩值的平均，沒有值時為 null
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
});

test("同一個種子產生同一串亂數", () => {
  // 敏感度分析依靠固定種子重現，同一個種子要產生同一串值
  const a = mulberry32(42);
  // 兩個產生器使用同一個種子
  const b = mulberry32(42);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  // 亂數落在 0 到 1 之間
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

// 分享網址的壓縮要能完整還原，並只含 base64url 字元
test("壓縮與還原", async () => {
  const text = JSON.stringify({ answers: { "q.a": ["agree", "abcd1234"] }, 中文: "台灣政策圖譜" });
  const packed = await packText(text);
  // 壓縮後只含網址安全的字元
  assert.match(packed, /^[A-Za-z0-9_-]+$/);
  // 還原後與原文相同，雜湊對相同文字穩定、對不同文字不同
  assert.equal(await unpackText(packed), text);
  assert.equal(fnv1a("abc"), fnv1a("abc"));
  assert.notEqual(fnv1a("abc"), fnv1a("abd"));
});

// 格式化函式的缺值處理與樣板代入
test("缺值不寫成 0%", () => {
  // 缺值寫缺值文字，實際的 0 寫 0%
  assert.equal(percent(null, 0, "－"), "－");
  assert.equal(percent(0, 0, "－"), "0%");
  // 樣板代入給定的值，找不到的鍵保留原樣
  assert.equal(fill("第 {n} 題", { n: 3 }), "第 3 題");
  assert.equal(fill("{missing}", {}), "{missing}");
});
