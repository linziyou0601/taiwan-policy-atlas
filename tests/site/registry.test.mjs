/* ==================================================
 * registry.test.mjs - 具名策略登錄表的測試
 * --------------------------------------------------
 * - 角色：檢查公式、契合度、立場彙總、共識判定與匯入解析的行為，以及設定引用未登錄名稱時的錯誤
 * - 指令：`npm test`，或 `node --test tests/site/registry.test.mjs` 單獨執行
 * - 慣例：測試對象是登錄表本身，輸入寫在測試裡
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve, entries, STRATEGY_KINDS } from "../../src/registry/index.js";
import { SETTINGS } from "../../src/config/index.js";
import { getPath } from "../../src/lib/objects.js";

test("設定檔選用的策略都已登錄", () => {
  // 設定選用的每類計分策略都能以名稱查詢
  for (const { kind, path } of STRATEGY_KINDS.filter((item) => item.path)) {
    assert.equal(resolve(kind, getPath(SETTINGS, path)).name, getPath(SETTINGS, path));
  }
  assert.ok(entries("parser").length >= 2);
});

// 設定寫錯名稱時立刻拋出錯誤
test("引用未登錄的名稱時拋出錯誤並列出可用名稱", () => {
  assert.throws(() => resolve("formula", "missing"), /可用：linearBlend/);
  assert.throws(() => resolve("unknown", "x"), /沒有 unknown 類/);
});

// 總分公式不把缺值當成 0
test("線性加權：沒有值的分項退出分子與分母", () => {
  // 每個分項都有值時是一般的加權平均
  const run = resolve("formula", "linearBlend").run;
  const full = run({ stance: 0.8, specificity: 0.4, overlap: 0.6 }, { stance: 0.7, specificity: 0.15, overlap: 0.15 });
  assert.ok(Math.abs(full.value - (0.7 * 0.8 + 0.15 * 0.4 + 0.15 * 0.6)) < 1e-12);
  // 具體度沒有值的情形
  const missing = run({ stance: 0.8, specificity: null, overlap: 0.6 }, { stance: 0.7, specificity: 0.15, overlap: 0.15 });
  // 具體度沒有值時退出，分母只剩其餘分項的權重
  assert.ok(Math.abs(missing.value - (0.7 * 0.8 + 0.15 * 0.6) / 0.85) < 1e-12);
  assert.equal(missing.terms.find((term) => term.key === "specificity").used, false);
  assert.equal(run({ stance: null, specificity: null, overlap: null }, { stance: 1, specificity: 1, overlap: 1 }).value, null);
});

// 兩種契合度的端點與中間值
test("量尺距離與方向一致", () => {
  // 量尺距離同時考量方向與強弱，五級量尺的端點是 2
  const distance = resolve("agreement", "linearDistance").run;
  const five = { end: 2 };
  // 同一點滿分，兩端相反零分
  assert.equal(distance(2, 2, five), 1);
  assert.equal(distance(2, -2, five), 0);
  // 五級量尺差一級扣四分之一，七級量尺差一級扣六分之一
  assert.equal(distance(1, 0, five), 0.75);
  assert.equal(distance(1, 0, { end: 3 }), 1 - 1 / 6);
  // 方向一致只比較正負號
  const direction = resolve("agreement", "sameDirection").run;
  assert.equal(direction(1, 2), 1);
  assert.equal(direction(-1, 2), 0);
  // 任一方中立時方向無法比較，記為一半
  assert.equal(direction(0, 2), 0.5);
});

// 只有新聞來源時權重為 0，立場記為未表態
test("加權平均：權重合計為 0 時視為未表態", () => {
  const mean = resolve("aggregate", "weightedMean").run;
  assert.equal(mean([{ weight: 0.5, value: 2 }, { weight: 0.5, value: 1 }]), 1.5);
  // 權重為 0 時回傳 null
  assert.equal(mean([{ weight: 0, value: 2 }]), null);
  // 權重相同時選取立場較強的一筆
  const strongest = resolve("aggregate", "strongestEvidence").run;
  assert.equal(strongest([{ weight: 1, value: 1 }, { weight: 1, value: -2 }]), -2);
});

test("共識判定需要至少兩位同方向", () => {
  // 共識規則的各種情形
  const rule = resolve("consensus", "sameDirection").run;
  // 兩位都支持才是共識，一正一負或只有一位表態都不算
  assert.equal(rule([2, 1]), true);
  assert.equal(rule([2, -1]), false);
  assert.equal(rule([2]), false);
  // 一位中立時不是同方向
  assert.equal(rule([0, 1]), false);
});

// 合規的列轉成題目與立場，有問題的列逐列回報
test("題庫 CSV 解析與逐列問題回報", () => {
  const parse = resolve("parser", "questionCsv").run;
  const context = {
    settings: SETTINGS.customData,
    stancesByName: new Map([["支持", { code: "stance.support", value: 1 }]]),
    facets: new Set(["housing"]),
    entitiesByNumber: new Map([[1, "e:1"]]),
  };
  // 每列代表一種情形
  const csv = "代碼,面向,題幹,說明,立場:1,證據:1,立場:2\nc1,housing,題幹一,說明一,支持,原文,\nc2,unknown,題幹二,說明二,-,,\nc3,housing,題幹三,說明三,強烈支持,,支持\n";
  // 第一列合規，第二列面向錯誤，第三列立場名稱與號次都有問題
  const result = parse(csv, context);
  assert.deepEqual(result.questions.map((q) => q.id), ["c1", "c3"]);
  assert.deepEqual(result.stances, [{ question: "c1", entity: "e:1", stance: "stance.support", value: 1, evidence: "原文" }]);
  // 每種問題各回報一次
  assert.deepEqual(result.issues.map((issue) => issue.code), ["unknownFacet", "unknownStance", "unknownNumber"]);
  // 缺少必要欄位時整份檔案不解析
  assert.equal(parse("代碼,題幹\nx,y\n", context).issues[0].code, "missingColumn");
});

test("設定 JSON 只接受登錄的參數路徑與範圍", () => {
  const parse = resolve("parser", "settingsJson").run;
  // 登錄的參數都在範圍內
  const ok = parse(JSON.stringify({ scoring: { stanceShrinkage: 2, includeConsensus: true, sourceMode: "shared" } }), { params: SETTINGS.params });
  // 合規的參數以設定路徑記錄
  assert.deepEqual(ok.overrides, { "scoring.stanceShrinkage": 2, "scoring.includeConsensus": true, "scoring.sourceMode": "shared" });
  const bad = parse(JSON.stringify({ scoring: { stanceShrinkage: 30, sourceMode: "x" } }), { params: SETTINGS.params });
  assert.equal(bad.issues.length, 2);
  // JSON 損壞時整份不套用
  assert.equal(parse("{", { params: SETTINGS.params }).issues[0].code, "invalidJson");
});
