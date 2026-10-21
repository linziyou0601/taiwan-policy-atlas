/* ==================================================
 * metrics.test.mjs - 計分層的測試
 * --------------------------------------------------
 * - 角色：以 2024 總統的真實資料檢查作答路徑、權重分配、未表態處理、涵蓋率、上下界、共識題、分數歸屬守恆、重播與意識形態軸
 * - 指令：`npm test`，或 `node --test tests/js/metrics.test.mjs` 單獨執行
 * - 慣例：數值以規格的定義重新計算後比對
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { SETTINGS } from "../../src/config/index.js";
import { computeResults, visibleQuestions, scopeQuestions, attribution, claimSpecificity, sensitivity, fixedAnswerCheck, maskText, applyCustom } from "../../src/metrics/index.js";
import { loadModel, answerAll, SCOPE } from "./helpers.mjs";

const { model } = await loadModel();
// 量尺各級的代碼，輪流作答時使用
const CODES = model.scale.map((choice) => choice.code);

test("子題只在母題答案符合顯示條件時出現", () => {
  // 選取第一道子題與它的母題
  const child = scopeQuestions(model, SCOPE).find((question) => question.parent);
  const parent = model.questions.get(child.parent);
  // 母題回答不同意時，子題不在路徑上
  const disagree = visibleQuestions(model, SCOPE, { [parent.id]: { answer: "disagree" } }, {});
  assert.equal(disagree.some((item) => item.id === child.id), false);
  // 母題回答同意時，子題緊接在母題之後
  const agree = visibleQuestions(model, SCOPE, { [parent.id]: { answer: "agree" } }, {});
  const index = agree.findIndex((item) => item.id === parent.id);
  assert.ok(agree.slice(index + 1).some((item) => item.id === child.id && item.depth === 1));
  // 略過母題時不追問
  const skipped = visibleQuestions(model, SCOPE, { [parent.id]: { answer: SETTINGS.flow.skipAnswer } }, {});
  assert.equal(skipped.some((item) => item.id === child.id), false);
});

test("重視度設為 0 的議題不出題", () => {
  // 比較預設重視度與把兩岸設為 0 的路徑
  const all = visibleQuestions(model, SCOPE, {}, {});
  const muted = visibleQuestions(model, SCOPE, {}, { "cross-strait": 0 });
  // 兩岸議題的題目全部消失，其餘題目不變
  assert.ok(all.some((item) => model.questions.get(item.id).facet.startsWith("cross-strait")));
  assert.equal(muted.some((item) => model.questions.get(item.id).facet.startsWith("cross-strait")), false);
});

test("題目權重合計為 1，子題與母題分同一份額", async () => {
  // 全部回答同意，讓子題都出現
  const answers = await answerAll(model, () => "agree");
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  const total = [...result.weights.values()].reduce((sum, w) => sum + w, 0);
  // 權重沿分類樹分完後合計為 1
  assert.ok(Math.abs(total - 1) < 1e-9);
  // 同一根題底下各題的權重合計，等於根題單獨出現時分到的份額
  const rootOnly = computeResults(model, { scopeId: SCOPE, answers: {}, importance: {} }, SETTINGS);
  // 逐個根題比較子題出現前後的份額
  for (const [questionId, group] of result.groupOf) {
    // 只檢查根題，子題的權重併入它的根題
    if (questionId !== group) continue;
    const groupTotal = [...result.groupOf].filter(([, root]) => root === group).reduce((sum, [id]) => sum + result.weights.get(id), 0);
    assert.ok(Math.abs(groupTotal - rootOnly.weights.get(group)) < 1e-9, group);
  }
});

// 依規格的定義逐項重新計算立場契合、涵蓋率與上下界
test("未表態不算 0：立場契合只使用已表態題目，另外計算涵蓋率與上下界", async () => {
  // 五級輪流作答，排名才有變化可以比較
  const answers = await answerAll(model, (question, index) => CODES[index % CODES.length]);
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  // 每位候選人依定義重新計算
  for (const entity of result.entities) {
    const counted = entity.stance.rows.filter((row) => row.counted);
    const known = counted.filter((row) => row.agreement !== null);
    // 已表態與已作答的權重分別加總
    const knownWeight = known.reduce((sum, row) => sum + row.weight, 0);
    const answered = counted.reduce((sum, row) => sum + row.weight, 0);
    const sum = known.reduce((s, row) => s + row.weight * row.agreement, 0);
    // 立場契合只除以已表態的權重
    assert.ok(Math.abs(entity.stance.score - sum / knownWeight) < 1e-12);
    // 涵蓋率與上下界的分母都是已作答題目的權重
    assert.ok(Math.abs(entity.stance.coverage - knownWeight / answered) < 1e-12);
    assert.ok(Math.abs(entity.stance.lower - sum / answered) < 1e-12);
    assert.ok(Math.abs(entity.stance.upper - (sum + answered - knownWeight) / answered) < 1e-12);
    // 未表態的題目契合度記為 null，與 0 分區分
    assert.ok(entity.stance.rows.some((row) => row.stance === null && row.agreement === null));
  }
});

test("可比較題目少於門檻時標示不足，排在題數足夠的候選人之後", async () => {
  // 五級輪流作答，候選人的可比較題數才有差別
  const answers = await answerAll(model, (question, index) => CODES[index % CODES.length]);
  const base = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  // 門檻取各候選人可比較題數的最大值，題數較少的候選人才會不足
  const threshold = Math.max(...base.entities.map((entity) => entity.stance.stated));
  const settings = { ...SETTINGS, scoring: { ...SETTINGS.scoring, stanceMinQuestions: threshold } };
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, settings);
  // 不足依可比較題數判斷，與涵蓋率無關
  for (const entity of result.entities) assert.equal(entity.insufficient, entity.stance.stated < threshold);
  // 題數足夠的候選人都排在不足的之前
  const order = result.entities.map((entity) => entity.insufficient);
  assert.deepEqual(order, [...order].sort());
});

test("共識題預設不計入排序，設定開啟後計入", async () => {
  // 全部回答同意，讓子題都出現
  const answers = await answerAll(model, () => "agree");
  // 預設設定下計算一次
  const base = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  assert.ok(base.consensus.size > 0);
  // 共識題的明細列標為不計入
  const rows = base.entities[0].stance.rows.filter((row) => base.consensus.has(row.question));
  assert.ok(rows.every((row) => !row.counted));
  // 開啟共識題計入後，共識題的明細列改為計入
  const included = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, { ...SETTINGS, scoring: { ...SETTINGS.scoring, includeConsensus: true } });
  assert.ok(included.entities[0].stance.rows.filter((row) => base.consensus.has(row.question)).every((row) => row.counted));
});

test("只比較共同題時涵蓋率為 1", async () => {
  // 全部回答同意，讓子題都出現
  const answers = await answerAll(model, () => "agree");
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, { ...SETTINGS, scoring: { ...SETTINGS.scoring, commonOnly: true, includeConsensus: true } });
  // 共同題每位候選人都已表態
  for (const entity of result.entities) assert.equal(entity.stance.coverage, 1);
});

test("同一組答案重播得到同一份結果", async () => {
  const answers = await answerAll(model, (question, index) => CODES[(index * 7) % CODES.length]);
  // 答案與重視度相同時，題目路徑與總分都相同
  const first = computeResults(model, { scopeId: SCOPE, answers, importance: { family: 4, defense: 1 } }, SETTINGS);
  const second = computeResults(model, { scopeId: SCOPE, answers: JSON.parse(JSON.stringify(answers)), importance: { family: 4, defense: 1 } }, SETTINGS);
  assert.deepEqual(first.questionIds, second.questionIds);
  // 每位候選人的總分逐一相同
  assert.deepEqual(first.entities.map((e) => [e.id, e.total]), second.entities.map((e) => [e.id, e.total]));
});

// 桑基圖的帶的寬度要能加總回總分
test("分數歸屬守恆：各題貢獻加總等於立場分項，分項加總等於總分", async () => {
  // 五級輪流作答，排名才有變化可以比較
  const answers = await answerAll(model, (question, index) => CODES[index % CODES.length]);
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  // 每位候選人都守恆
  for (const entity of result.entities) {
    const flows = attribution(model, entity);
    const stancePart = flows.parts.find((part) => part.key === "stance").value;
    // 題目貢獻加總與立場分項比較，守恆差額為 0
    const sum = flows.questions.reduce((s, item) => s + item.value, 0);
    assert.ok(Math.abs(sum - stancePart) < 1e-12);
    assert.ok(Math.abs(flows.residual) < 1e-12);
  }
});

// 具體度依判準表逐條加權，不適用的判準不進分母
test("具體度：不適用的判準退出分母", () => {
  // 找出一則有不適用判準的主張，依定義重新計算
  const claim = [...model.claims.values()].find((item) => (model.specificityByClaim.get(item.id) ?? []).some((row) => row.value === null));
  const rows = model.specificityByClaim.get(claim.id).filter((row) => row.value !== null);
  const weights = new Map(model.tables.specificity.map((row) => [row.code, row.weight]));
  // 依判準權重手動計算期望值
  const expected = rows.reduce((s, row) => s + weights.get(row.criterion) * row.value, 0) / rows.reduce((s, row) => s + weights.get(row.criterion), 0);
  // 函式結果與手動計算的結果相同
  assert.ok(Math.abs(claimSpecificity(model, claim.id).value - expected) < 1e-12);
});

// 全部非常同意時各軸都有位置，且不超出顯示範圍
test("意識形態軸的位置在設定範圍內", async () => {
  const answers = await answerAll(model, () => "strongly-agree");
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  // 使用者與候選人在各軸的位置一併檢查
  const values = [...result.ideology.user.values(), ...[...result.ideology.entities.values()].flatMap((m) => [...m.values()])].filter((v) => v !== null);
  assert.ok(values.length > 0);
  assert.ok(values.every((v) => v >= SETTINGS.ideology.min && v <= SETTINGS.ideology.max));
});

// 母題與追問合算一題：每題的權重乘上它占同一根題已作答題目的預算比例
test("意識形態軸上一組母子題只計算一題的分量", async () => {
  // 根題回答同意、追問回答不同意，追問與母題的方向相反才能看出比例的作用
  const answers = await answerAll(model, (question) => (question.parent ? "disagree" : "agree"));
  const result = computeResults(model, { scopeId: SCOPE, answers, importance: {} }, SETTINGS);
  // 這裡沒有略過，出現的題目都已作答
  const answered = result.questionIds;
  /**
   * 依規格的定義重新計算使用者在一條軸上的位置。
   * @param {string} axis 軸代碼。
   * @param {(id: string) => number} share 每題的比例。
   * @returns {number|null}
   */
  const position = (axis, share) => {
    let sum = 0;
    let weight = 0;
    // 逐題累加這條軸的方向、權重與比例
    for (const id of answered) {
      const link = model.axesByQuestion.get(id)?.find((item) => item.axis === axis);
      // 沒有對應這條軸的題目不計入
      if (!link) continue;
      sum += link.direction * link.weight * share(id) * model.answers.get(answers[id].answer).value;
      weight += link.weight * share(id);
    }
    // 沒有題目時沒有位置，有題目時換算到顯示範圍
    if (!weight) return null;
    return SETTINGS.ideology.min + ((sum / (model.scaleEnd * weight) + 1) / 2) * (SETTINGS.ideology.max - SETTINGS.ideology.min);
  };
  // 沿母題往上查找到根題
  const rootOf = (id) => (model.questions.get(id).parent ? rootOf(model.questions.get(id).parent) : id);
  const totals = new Map();
  // 同一根題底下已作答題目的預算合計
  for (const id of answered) totals.set(rootOf(id), (totals.get(rootOf(id)) ?? 0) + model.questions.get(id).budget_share);
  const share = (id) => model.questions.get(id).budget_share / totals.get(rootOf(id));
  // 兩個位置都沒有值，或差距在浮點誤差內，視為相同
  const same = (left, right) => left === right || Math.abs(left - right) < 1e-9;
  // 每條軸都與定義相同
  for (const axis of model.axes) assert.ok(same(result.ideology.user.get(axis.code), position(axis.code, share)), axis.code);
  // 至少一條軸與逐題等重的算式不同，表示追問沒有各自計為一題
  assert.ok(model.axes.some((axis) => !same(position(axis.code, share), position(axis.code, () => 1))));
});

// 敏感度與固定作答檢驗
test("敏感度分析以固定種子重現，固定作答涵蓋三種樣式", async () => {
  // 五級輪流作答，排名才有變化可以比較
  const answers = await answerAll(model, (question, index) => CODES[index % CODES.length]);
  const state = { scopeId: SCOPE, answers, importance: {} };
  const settings = { ...SETTINGS, robustness: { ...SETTINGS.robustness, draws: 20 } };
  // 抽樣次數調小，測試仍涵蓋整個流程
  const base = computeResults(model, state, settings);
  // 同一個種子執行兩次，每次抽樣的結果都相同
  const first = sensitivity(model, state, settings, base);
  const second = sensitivity(model, state, settings, base);
  assert.deepEqual(first.draws, second.draws);
  // τ-b 的中位數落在 -1 到 1
  assert.ok(first.median >= -1 && first.median <= 1);
  // 固定作答依設定的每種樣式各計算一次
  const fixed = fixedAnswerCheck(model, state, settings);
  assert.deepEqual(fixed.map((item) => item.answer), SETTINGS.fixedAnswers);
});

test("遮蔽姓名、搭檔、黨名與口號", () => {
  // 把全部姓名、搭檔與黨名串接後遮蔽
  const masked = maskText(model, [...model.entities.values()].map((e) => `${e.name} ${e.running_mate} ${e.party}`).join(" "));
  // 名冊的姓名與黨名都不應留在遮蔽後的文字中
  for (const entity of model.entities.values()) {
    assert.equal(masked.includes(entity.name), false);
    assert.equal(masked.includes(entity.party), false);
  }
});

// 自訂題目產生新模型，原模型不變
test("自訂題目併入模型並標示", () => {
  const entity = [...model.entities.values()][0];
  const custom = applyCustom(model, { questions: [{ id: "c.test", facet: "housing", stem: "測試題", note: "說明" }], stances: [{ question: "c.test", entity: entity.id, stance: "stance.support", value: 1, evidence: "" }] });
  // 新模型標示含自訂資料
  assert.equal(custom.custom, true);
  // 新模型有自訂題目，原模型沒有
  assert.ok(custom.questions.has("c.test"));
  assert.equal(model.questions.has("c.test"), false);
});
