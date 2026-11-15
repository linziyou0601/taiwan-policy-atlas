/* ==================================================
 * lint.test.mjs - 寫作檢查的測試
 * --------------------------------------------------
 * - 角色：以小段的 Markdown、文字與程式測試 scripts/writing 的版面、連結、文字與註解密度的檢查，另以子行程測試進入點的結束代碼
 * - 指令：`npm test`
 * - 慣例：
 *   - 每個情境寫一段會命中的輸入與一段通過的輸入，預期值是規則的名稱
 *   - 規則的寫法見 docs/writing/rules.md
 * ================================================== */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { commentLines } from "../../scripts/common.mjs";
import { checkDensity } from "../../scripts/writing/comments.mjs";
import { grownUnits } from "../../scripts/writing/growth.mjs";
import { anchorsOf, checkLinks, checkStructure, maskLine, parseMarkdown } from "../../scripts/writing/markdown.mjs";
import { checkLine, loadTables } from "../../scripts/writing/text.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * repo 根目錄與規則表、進入點的位置。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TABLES = loadTables(join(ROOT, "scripts/writing/tables"));
const ENTRY = join(ROOT, "scripts/writing/lint.mjs");

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 一份 Markdown 命中的版面規則。
 * @param {string} text Markdown。
 * @returns {string[]} 規則名稱，依行排列。
 */
function structure(text) {
  return checkStructure(parseMarkdown(text)).map((finding) => finding.rule);
}

/**
 * 一行文字命中的規則。
 * @param {string} line 一行文字。
 * @param {string} [kind] 行的種類。
 * @returns {string[]} 規則名稱。
 */
function text(line, kind = "paragraph") {
  return checkLine(line, maskLine(line), kind, TABLES).map((finding) => finding.rule);
}

/**
 * 一段程式命中的註解密度規則。
 * @param {string} source 程式。
 * @param {string} language 語言。
 * @returns {string[]} 規則名稱。
 */
function density(source, language) {
  const lines = source.split("\n");
  return checkDensity(lines, commentLines(lines, language), language).map((finding) => finding.rule);
}

/* ==================================================
 * 主體
 * ================================================== */

describe("產物與段落", () => {
  it("產物之後的段落沒有以冒號引出下一個產物時列出", () => {
    // Given：表格之後接一段補述
    const supplement = "說明如下：\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n這張表另外要注意一件事。\n";
    // When：檢查版面
    const rules = structure(supplement);
    // Then：列出產物之後的補述
    assert.deepEqual(rules, ["產物之後的補述"]);
  });

  it("產物之後接標題，或接一段以冒號引出下一個產物的說明時通過", () => {
    // Given：清單之後接引出表格的說明，表格之後接標題
    const chained = "步驟如下：\n\n1. 第一步\n2. 第二步\n\n完成判準如下：\n\n| 條件 | 證據 |\n|---|---|\n| 甲 | 乙 |\n\n## 下一節\n\n新的說明。\n";
    // When：檢查版面
    const rules = structure(chained);
    // Then：沒有發現項目
    assert.deepEqual(rules, []);
  });

  it("清單項目內縮排的說明與程式碼區塊屬於那個項目", () => {
    // Given：項目內有程式碼區塊，下一個項目接在後面
    const nested = "步驟：\n\n1. 執行指令：\n\n   ```bash\n   npm test\n   ```\n\n2. 看結果。\n";
    // When：檢查版面
    const rules = structure(nested);
    // Then：沒有發現項目
    assert.deepEqual(rules, []);
  });
});

describe("標題與分隔", () => {
  it("標題比 H3 深、跳過一層或程式碼區塊沒有語言時列出", () => {
    // Given：H1 直接接 H3，另有 H4 與沒有語言的程式碼區塊
    const broken = "# 標題\n\n### 跳級\n\n#### 太深\n\n```\ncode\n```\n";
    // When：檢查版面
    const rules = structure(broken);
    // Then：三條規則各一筆
    assert.deepEqual(rules, ["標題跳級", "標題過深", "程式碼區塊沒有語言"]);
  });

  it("同一章的 H2 之間要有一行 <br>，章之間要有三行 <br> 與分隔線", () => {
    // Given：第二個 H2 之前沒有 `<br>`，第二章之前只有分隔線
    const broken = "# 第一章\n\n## 甲\n\n文字。\n\n## 乙\n\n文字。\n\n---\n# 第二章\n";
    const separated = "# 第一章\n\n## 甲\n\n文字。\n\n<br>\n\n## 乙\n\n文字。\n\n<br>\n<br>\n<br>\n\n\n---\n# 第二章\n";
    // When：檢查兩份
    const rules = [structure(broken), structure(separated)];
    // Then：只有第一份有發現項目
    assert.deepEqual(rules, [["H2 分隔不符", "H1 分隔不符"], []]);
  });
});

describe("連結", () => {
  it("檔案不存在或章節不在目標的標題中時列出", () => {
    // Given：一份文件連到存在的章節、不存在的章節、不存在的檔案與網址
    const records = parseMarkdown("# 本檔\n\n見 [甲](other.md#有的標題)、[乙](other.md#沒有的標題)、[丙](missing.md)、[丁](https://example.com) 與 [戊](#本檔)。\n");
    // other.md 有一個標題，空的路徑是本檔，其餘的檔案不存在
    const anchorsAt = (path) => (path === "other.md" ? anchorsOf("# Other\n\n## 有的標題\n") : path === "" ? anchorsOf("# 本檔\n") : null);
    // When：檢查連結
    const hits = checkLinks(records, anchorsAt).map((finding) => finding.hit);
    // Then：只列出兩個失效的連結
    assert.deepEqual(hits, ["other.md#沒有的標題", "missing.md"]);
  });

  it("錨點與 GitHub 的寫法相同：小寫、去掉標點、空白換成連字號", () => {
    // Given：含英文、標點與行內程式碼的標題
    const anchors = anchorsOf("# Do's and Don'ts\n\n## Commit 與 PR\n\n### 議題 × 候選人\n");
    // When、Then：三個錨點
    assert.deepEqual([...anchors], ["dos-and-donts", "commit-與-pr", "議題--候選人"]);
  });
});

describe("文字", () => {
  it("破折號、中英之間沒有空白、全形標點旁的空白與大陸用語是錯誤", () => {
    // Given：四種寫法各一句
    const lines = ["這是重點——請注意", "使用Node執行", "結果如下 ，再看一次", "先調用這個方法"];
    // When：逐行比對
    const rules = lines.map((line) => text(line));
    // Then：各自命中對應的規則
    assert.deepEqual(rules, [["破折號"], ["中英之間沒有空白"], ["全形標點旁的空白"], ["簡繁用語"]]);
  });

  it("二元句型、否定補述、缺席宣告與列舉省略是警告", () => {
    // Given：四種寫法各一句
    const lines = ["這不是設定檔，而是產物。", "系統會自動保存，不必手動儲存。", "本檔不處理下載。", "支援甲、乙、丙等。"];
    // When：逐行比對
    const rules = lines.map((line) => text(line));
    // Then：各自命中對應的規則
    assert.deepEqual(rules, [["二元句型"], ["否定補述"], ["缺席宣告"], ["列舉省略"]]);
  });

  it("行內的程式碼、「」裡的引用與改用的寫法本身不比對", () => {
    // Given：三句都含會命中的字樣，但寫在程式碼、引用或正確的寫法裡
    const lines = ["執行 `a--b` 與 `調用`。", "原文寫「延至12歲」，照錄。", "這裡用的是演算法。"];
    // When：逐行比對
    const rules = lines.map((line) => text(line));
    // Then：都沒有發現項目
    assert.deepEqual(rules, [[], [], []]);
  });

  it("一行開頭的粗體是小標，行中的粗體是強調", () => {
    // Given：一行開頭的粗體與句中的粗體
    const lines = ["**Option A：標題與按鈕同列**", "這一步**務必**先執行。"];
    // When：逐行比對
    const rules = lines.map((line) => text(line));
    // Then：只有句中的粗體命中
    assert.deepEqual(rules, [[], ["句中粗體"]]);
  });

  it("表格的列不比對以句子為單位的樣式", () => {
    // Given：同一段文字分別是段落與表格的列
    const line = "| 甲；乙 | 丙 |";
    // When：以兩種種類比對
    const rules = [text("甲是一件事；乙是另一件事。"), text(line, "table")];
    // Then：段落命中分號，表格的列沒有
    assert.deepEqual(rules, [["中文分號黏接"], []]);
  });
});

describe("註解的密度", () => {
  it("分支點上方沒有註解、連續四個邏輯行沒有註解與空白註解時列出", () => {
    // Given：沒有註解的分支、四行連續的敘述與一則空白註解
    const source = "const a = 1;\nif (a) {\n  run();\n}\nconst b = 2;\nconst c = 3;\n//\nconst d = 4;\n";
    // When：檢查 JavaScript
    const rules = density(source, "js");
    // Then：三條規則各一筆
    assert.deepEqual(rules, ["分支點沒有註解", "連續程式沒有註解", "空白註解"]);
  });

  it("分支點上方有註解、每三個邏輯行有一則註解時通過", () => {
    // Given：Python 的分支與迴圈上方都有註解
    const source = '"""模組說明。"""\n\nvalue = 1\n# 有值時才處理\nif value:\n    run()\n# 逐項處理\nfor item in items:\n    handle(item)\n';
    // When：檢查 Python
    const rules = density(source, "py");
    // Then：沒有發現項目
    assert.deepEqual(rules, []);
  });

  it("括號內換行的參數屬於同一個敘述", () => {
    // Given：一個跨五行的呼叫
    const source = "// 呼叫\ncall(\n  one,\n  two,\n  three,\n  four,\n);\n";
    // When：檢查 JavaScript
    const rules = density(source, "js");
    // Then：沒有發現項目
    assert.deepEqual(rules, []);
  });
});

describe("改動後變長", () => {
  it("段落、清單項目與表格的格子比修改之前多出五個字以上時列出", () => {
    // Given：一段加了一句補述，一格表格變長，另一行只改了兩個字
    const diff = [
      "diff --git a/docs/a.md b/docs/a.md",
      "--- a/docs/a.md",
      "+++ b/docs/a.md",
      "@@ -3,2 +3,2 @@",
      "-這一段說明用途。",
      "-| 甲 | 短 |",
      "+這一段說明用途，另外補上一句不相干的話。",
      "+| 甲 | 這一格變得很長很長 |",
      "@@ -9 +9 @@",
      "-只改兩個字的行。",
      "+只改了兩個字的行。",
    ].join("\n");
    // When：找出變長的單位
    const grown = grownUnits(diff).map((finding) => [finding.file, finding.line, finding.hit]);
    // Then：列出第 3 行的段落與第 4 行的第二格
    assert.deepEqual(grown, [
      ["docs/a.md", 3, "12"],
      ["docs/a.md", 4, "8"],
    ]);
  });
});

describe("進入點", () => {
  it("有錯誤層級的發現項目時結束代碼是 1，路徑不存在時是 2", () => {
    // Given：一段含破折號的文字、一段通過的文字與一個不存在的路徑
    const run = (args) => spawnSync(process.execPath, [ENTRY, ...args], { cwd: ROOT, encoding: "utf8" });
    // When：執行三次
    const failing = run(["--text", "這是重點——請注意"]);
    const passing = run(["--text", "這是一句通過的文字。"]);
    const missing = run(["no-such-file.md"]);
    // Then：結束代碼依序是 1、0、2，輸出的第一行寫出位置、層級與規則
    assert.deepEqual([failing.status, passing.status, missing.status], [1, 0, 2]);
    assert.match(failing.stdout, /^\(text\):1: \[錯誤\] 破折號 /);
    assert.match(passing.stdout, /^command=lint files=1 錯誤=0 警告=0 提示=0\n$/);
  });
});
