/* ==================================================
 * blocks.test.mjs - 顯示層資料的測試
 * --------------------------------------------------
 * - 角色：檢查顯示層的純資料與設定表一致：每個第 1 層議題都有圖示，程式與設定使用的介面圖示都有圖形，CSS 的系列色條數與設定相同
 * - 指令：`npm test`，或 `node --test tests/js/blocks.test.mjs` 單獨執行
 * - 慣例：只匯入 blocks 的 .js 檔，JSX 元件由建置與瀏覽器測試涵蓋
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, walkFiles } from "../../scripts/common.mjs";
import { ISSUE_ICONS, UI_ICONS } from "../../src/blocks/icons.js";
import { LAYOUT, SETTINGS } from "../../src/config/index.js";
import { ISSUE_LEVEL } from "../../src/metrics/index.js";
import { loadModel } from "./helpers.mjs";

// 圖示表的鍵要與分類樹的第 1 層一一對應
test("每個第 1 層議題都有圖示，圖示表沒有多出的代碼", async () => {
  const { model } = await loadModel();
  // 分類樹第 1 層的代碼，依碼位排序後與圖示表比對
  const level1 = [...model.taxonomy.values()].filter((node) => node.level === ISSUE_LEVEL).map((node) => node.code).sort();
  assert.deepEqual(Object.keys(ISSUE_ICONS).sort(), level1);
  // 每個圖示至少有一段路徑，且路徑都以移動指令開頭
  for (const [code, paths] of Object.entries(ISSUE_ICONS)) {
    assert.ok(paths.length > 0, code);
    assert.ok(paths.every((d) => d.startsWith("M")), code);
  }
});

// 卡片與外框以名稱指定介面圖示，名稱寫錯時畫面會出現空白的按鈕
test("程式與設定使用的介面圖示都有圖形", () => {
  // 掃描 src 裡寫成 icon: "名稱"、icon="名稱" 與對照表裡的名稱
  const dirs = ["src/cards", "src/blocks", "src/app"];
  // layout 頁面寫有 icon 時，是底部分頁列的圖示
  const names = new Set(Object.values(LAYOUT.pages).flatMap((page) => (page.icon ? [page.icon] : [])));
  // 逐個檔案收集各種寫法的名稱
  for (const file of dirs.flatMap((dir) => walkFiles(join(ROOT, dir)))) {
    const source = readFileSync(file, "utf8");
    // 按鈕描述與元件屬性的寫法
    for (const match of source.matchAll(/icon(?:: |=)"([a-zA-Z]+)"/g)) names.add(match[1]);
    // 頁首切換的圖示對照表
    for (const match of source.matchAll(/CONTROL_ICONS = (\{.*\});/g)) for (const group of Object.values(Function(`return ${match[1]}`)())) for (const name of Object.values(group)) names.add(name);
  }
  const missing = [...names].filter((name) => !UI_ICONS[name]);
  assert.deepEqual(missing, []);
});

// 系列色的 CSS 規則與設定的色票數一致
test("CSS 的系列色條數等於 charts.seriesCount", () => {
  const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  const series = [...css.matchAll(/^\s*\[data-series="(\d+)"\]/gm)].map((match) => Number(match[1]));
  // 序號 0 保留給使用者，候選人從 1 起算
  assert.deepEqual(series, Array.from({ length: SETTINGS.charts.seriesCount + 1 }, (_, i) => i));
});
