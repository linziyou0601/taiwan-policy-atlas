/* ==================================================
 * info.test.mjs - 卡片 info 的代入值測試
 * --------------------------------------------------
 * - 角色：以 2024 總統作答後的狀態組成每一頁的卡片，逐張核對 info 的代入值與計分層重新計算的結果相同，並確認每張卡都有 info
 * - 指令：`npm test`，或 `node --test tests/js/info.test.mjs` 單獨執行
 * - 慣例：期望值由計分層的函式另外計算後，以卡片層的格式化函式轉成文字
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT, SETTINGS, text } from "../../src/config/index.js";
import { fill } from "../../src/lib/format.js";
import { installFetch, answeredState } from "./helpers.mjs";

// 以 repo 檔案代替網站的 fetch，再載入卡片層、計分層與格式化函式
installFetch();
const C = await import("../../src/cards/index.js");
const M = await import("../../src/metrics/index.js");
// 重新計算總分時直接向策略登錄表取得公式，與卡片層的寫法分開
const { resolve } = await import("../../src/registry/index.js");
// 卡片層的格式化函式與適用種類的判斷
const { pct, num, fitsKind } = await import("../../src/cards/kit.js");

// 全部測試共用同一份作答完的狀態，略過也列入輪流的答案
const state = await answeredState([SETTINGS.flow.skipAnswer]);
// 結果頁、方法頁與資料集頁需要的資料先載入
for (const page of Object.keys(LAYOUT.pages)) await C.ensureData(state, page);
const context = C.createContext(state, "result");
const results = context.results();
// 以指定頁面的情境組成一張卡
const card = (id, page = "result", s = state) => C.buildCard(id, C.createContext(s, page));

test("每一頁適用選舉的每張卡都有標題、回答的問題、讀法與 info", () => {
  // 逐頁逐張檢查適用選舉的卡片
  for (const [page, spec] of Object.entries(LAYOUT.pages)) {
    const slots = [...spec.cards, spec.sticky].filter((slot) => slot && fitsKind(slot, "election"));
    const ids = slots.map((slot) => slot.card);
    // 每張卡的文案與 info 都要齊全
    for (const id of ids) {
      const built = card(id, page);
      assert.ok(built.title && built.question && built.read, `${id} 缺少文案`);
      // info 的每個區段都要是陣列
      assert.ok(built.info && Array.isArray(built.info.steps) && Array.isArray(built.info.sources) && Array.isArray(built.info.constants), `${id} 缺少 info`);
      // info 至少要有一項內容
      assert.ok(built.info.steps.length + built.info.sources.length + built.info.constants.length > 0, `${id} 的 info 是空的`);
    }
  }
});

test("總分長條：每位候選人的立場契合與總分代入值", () => {
  const steps = card("result.bars").info.steps;
  // 每位候選人兩步：立場契合、總分
  results.entities.forEach((entity, i) => {
    assert.equal(steps[2 * i].value, pct(entity.stance.score, 1));
    assert.equal(steps[2 * i + 1].value, pct(entity.total, 1));
    // 總分代入式的最後是三位小數的總分
    assert.ok(steps[2 * i + 1].formula.endsWith(`= ${num(entity.total, 3)}`));
  });
});

test("總分代入式的數值與公式重新計算的結果相同", () => {
  const formula = resolve("formula", SETTINGS.scoring.formula).run;
  // 逐位候選人以分項與設定的權重重新計算
  for (const entity of results.entities) {
    const value = formula(entity.parts, SETTINGS.scoring.formulaParams).value;
    assert.ok(Math.abs(value - entity.total) < 1e-12);
    // 只以有值的分項手動計算加權平均
    const used = entity.blend.terms.filter((term) => term.used);
    const expected = used.reduce((s, term) => s + term.weight * term.value, 0) / used.reduce((s, term) => s + term.weight, 0);
    assert.ok(Math.abs(expected - entity.total) < 1e-12);
  }
});

// 雷達卡每條軸一步
test("意識形態雷達：每軸的使用者位置與題數", () => {
  // 雷達卡的步驟依軸的順序排列
  const steps = card("result.radar").info.steps;
  const axes = results.ideology.axes;
  // 每軸一步，值是使用者位置，規則寫出依幾題推算
  axes.forEach((axis, i) => {
    assert.equal(steps[i].value, num(results.ideology.user.get(axis.code), 0));
    assert.equal(steps[i].rule, fill(text("result.axisUsed"), { count: results.ideology.used.get(axis.code).length }));
  });
});

// 議題數、有貢獻的議題數、守恆差額與重疊度
test("熱力圖、桑基圖、議題分布的代入值", () => {
  assert.equal(card("result.heatmap").info.steps[0].value, String(M.issueAgreement(context.model, results).issues.length));
  // 分數歸屬繪製全部候選人，議題採用各候選人有貢獻的議題聯集
  const flows = results.entities.map((entity) => M.attribution(context.model, entity));
  const sankey = card("result.sankey").info.steps;
  // 桑基圖第一步是有貢獻的議題數，第二步是各候選人中最大的守恆差額
  assert.equal(sankey[0].value, String(new Set(flows.flatMap((flow) => flow.questions.map((item) => item.issue))).size));
  assert.equal(sankey[1].value, num(Math.max(...flows.map((flow) => Math.abs(flow.residual))), 6));
  // 議題分布的重疊度採用聚焦候選人，預設是第一名
  assert.equal(card("result.treemap").info.steps[0].value, pct(results.entities[0].overlap.score, 1));
});

test("參數、敏感度、固定作答、涵蓋率與逐題明細的代入值", () => {
  const adjusted = { ...state, params: { "scoring.stanceMinQuestions": 4 } };
  // 調整一個參數後，已調整的參數數是 1
  assert.equal(card("result.params", "result", adjusted).info.steps[0].value, "1");
  assert.equal(card("result.robustness").info.steps[0].value, String(SETTINGS.robustness.draws));
  assert.equal(card("result.fixed").info.steps[0].value, String(SETTINGS.fixedAnswers.length));
  // 涵蓋率卡第二步是有主張的來源類型數
  assert.equal(card("result.coverage").info.steps[1].value, String(M.sourceCoverage(context.model, results).types.length));
  // 逐題明細列出已作答且沒有略過的題目
  const answered = results.questionIds.filter((id) => M.isStated(state.answers[id])).length;
  assert.equal(card("result.details").info.steps[0].value, String(answered));
});

test("固定作答卡的格內數值與固定作答重新計算的結果相同", () => {
  // 固定作答以同一份狀態重新計算一次
  const checks = M.fixedAnswerCheck(context.model, state, SETTINGS);
  // 表格的列依固定作答的樣式排列
  const rows = card("result.fixed").blocks[0].rows;
  // 逐種作答、逐位候選人比對
  checks.forEach((check, i) => {
    // 每格是該候選人在這種作答下的總分
    for (const entity of check.entities) assert.equal(rows[i].cells[entity.id], pct(entity.total));
  });
});

test("作答卡：目前題目的權重、預算份額與中立性判準數", () => {
  const quizState = { ...state, view: { ...state.view, quizIndex: 3 } };
  // 停在第四題，選取這一題的權重、預算份額與審查數
  const quiz = C.createContext(quizState, "quiz");
  const item = quiz.questions().visible[3];
  const steps = card("quiz.question", "quiz", quizState).info.steps;
  // 第一步是題目權重
  assert.equal(steps[0].value, pct(quiz.results().weights.get(item.id), 1));
  // 預算份額與中立性判準數直接取自題目資料
  assert.equal(steps[1].value, num(quiz.model.questions.get(item.id).budget_share));
  assert.equal(steps[2].value, fill(text("quiz.neutralValue"), { count: quiz.model.neutralityByQuestion.get(item.id).length }));
});

test("重視度、選舉與方法頁的代入值", () => {
  // 重視度卡：第 1 層議題數與份額合計
  const weights = card("weights.importance", "weights").info.steps;
  // 第 1 層議題數由根題的面向往上查找
  const roots = C.createContext(state, "weights").questions().all.filter((q) => !q.parent);
  const level1 = new Set(roots.map((q) => M.issueOf(context.model.taxonomy, q.facet)));
  assert.equal(weights[0].value, fill(text("importance.stepLevel1Value"), { count: level1.size }));
  // 份額合計為 100%
  assert.equal(weights[1].value, pct(1));
  // 選舉卡的步驟是收錄的選舉數
  assert.equal(card("choose.picker", "choose").info.steps[0].value, String(context.data.index.elections.length));
  // 方法頁的公式實例代入第一名
  const formulaCard = card("methods.formula", "methods");
  assert.ok(formulaCard.blocks[1].text.includes(`= ${num(results.entities[0].total, 3)}`));
  // 具體度分布的平均值與逐則重新計算的結果相同
  const entity = context.entities[0];
  // 第一位候選人的主張具體度逐則重新計算後取平均值
  const scores = context.model.claimsByEntity.get(entity.id).map((claim) => M.claimSpecificity(context.model, claim.id).value).filter((v) => v !== null);
  const heading = card("methods.specificity", "methods").blocks.find((block) => block.type === "heading").text;
  assert.ok(heading.includes(pct(scores.reduce((s, v) => s + v, 0) / scores.length)), heading);
});

// 區域選區的地圖分支與清單篩選
test("選區地圖：區域選區點選縣市後繪製鄉鎮，info 寫出地圖核對結果", async () => {
  let district = C.normalizeState({});
  await C.ensureData(district, "scope");
  // 區域立委要先選擇選區，選舉頁之後停在選區頁
  district = C.dispatch("selectSet", "2024-legislator-district", district, C.createContext(district, "choose")).state;
  await C.ensureData(district, "scope");
  // 點選台北市後，地圖改為繪製該市的鄉鎮，且只列出台北市的選區
  district = C.dispatch("selectCounty", "63000", district, C.createContext(district, "scope")).state;
  const scopeContext = C.createContext(district, "scope");
  const mapCard = C.buildCard("scope.map", scopeContext);
  // 地圖的圖形都屬於台北市
  const shapes = mapCard.blocks[0].features;
  assert.ok(shapes.length > 0 && shapes.every((feature) => feature.id.startsWith("63000")));
  assert.equal(mapCard.info.steps[0].value, fill(text("scope.checked"), scopeContext.data.map.checks));
  // 清單的筆數與篩選後的選區數相同
  const listed = C.buildCard("scope.list", scopeContext).blocks.find((block) => block.type === "list").items.length;
  assert.equal(listed, [...scopeContext.model.scopes.values()].filter((scope) => scope.county === "63000").length);
});
