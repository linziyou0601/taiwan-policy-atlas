/* ==================================================
 * topic.test.mjs - 主題測驗的流程與計分測試
 * --------------------------------------------------
 * - 角色：以 8values 依序執行選擇、作答到結果的流程，核對流程略過選區與重視度、軸位置與最接近的參照點和原測驗的計分方式相同、每張卡都能組成、分享圖片與資料集檢視可用。兩岸立場檢查單選題與全國對照，台灣地位詮釋檢查沒有參照點的題組
 * - 指令：`npm test`，或 `node --test tests/js/topic.test.mjs` 單獨執行
 * - 慣例：8values 的期望值依原測驗的寫法另外計算
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT, SETTINGS, text } from "../../src/config/index.js";
import { ROOT } from "../../scripts/common.mjs";
import { installFetch, act } from "./helpers.mjs";

installFetch();
const C = await import("../../src/cards/index.js");
// 卡片層的適用種類判斷
const { fitsKind } = await import("../../src/cards/kit.js");

/**
 * 測試使用的主題測驗。
 */
const TOPIC = "8values";

/**
 * 作答代碼對應原測驗的倍數。
 */
const MULTIPLIERS = { "strongly-agree": 1, agree: 0.5, neutral: 0, disagree: -0.5, "strongly-disagree": -1 };

/**
 * 原測驗 results.html 的分級門檻，由高到低：大於 90、75、60，大於或等於 40、25、10、0。
 */
const EIGHTVALUES_BANDS = [(v) => v > 90, (v) => v > 75, (v) => v > 60, (v) => v >= 40, (v) => v >= 25, (v) => v >= 10, (v) => v >= 0];

/**
 * 原測驗的分級。
 * @param {number} value 分數。
 * @returns {number} 第幾級，從 0 起算。
 */
function eightvaluesBand(value) {
  // 第一個符合的門檻就是這一級
  return EIGHTVALUES_BANDS.findIndex((passes) => passes(value));
}

// 選擇主題測驗、依五級輪流作答完的狀態，全部測試共用
const codes = Object.keys(MULTIPLIERS);
const chosen = await act(C.normalizeState({}), "choose", "selectSet", TOPIC);
let state = chosen.state;
// 逐題作答，第 i 題選擇 codes[i mod 5]
for (let i = 0; i < 70; i += 1) state = (await act(state, "quiz", "answer", `q${String(i + 1).padStart(2, "0")}=${codes[i % codes.length]}`)).state;
// 每一頁需要的資料先載入
for (const page of Object.keys(LAYOUT.pages)) await C.ensureData(state, page);
// 結果頁的情境與結果，各測試共用
const context = C.createContext(state, "result");
const results = context.results();

test("主題測驗選擇之後直接作答，流程沒有選區與重視度", () => {
  // 選擇之後的下一步是作答頁
  assert.equal(chosen.route, "quiz");
  // 步驟列只剩選擇、作答、結果
  const steps = C.buildPage(C.createContext(state, "quiz")).flow.steps.map((item) => item.page);
  assert.deepEqual(steps, ["choose", "quiz", "result"]);
  // 70 題都作答完，結果頁不缺條件
  assert.equal(results.answeredCount, 70);
  // 結果頁的第一張卡是主題測驗的摘要
  assert.equal(C.buildPage(context).cards[0].id, "topic.summary");
});

test("軸位置、級別與最接近的參照點和原測驗的計分方式相同", () => {
  // 期望值直接讀取發布檔的軸對應與參照點計算
  const dataset = JSON.parse(readFileSync(join(ROOT, "data/60-publish/topics/8values/dataset.json"), "utf8"));
  // 依原測驗的寫法：每軸 score = Σ 倍數 × 權重，max = Σ |權重|
  const score = {};
  const max = {};
  // 逐筆軸對應累加，權重帶正負號
  for (const link of dataset.question_axes) {
    const effect = link.direction * link.weight;
    // 作答轉換為原測驗的倍數
    score[link.axis] = (score[link.axis] ?? 0) + MULTIPLIERS[state.answers[link.question].answer] * effect;
    max[link.axis] = (max[link.axis] ?? 0) + Math.abs(effect);
  }
  // 逐軸比對位置與級別，位置 = 100 × (max + score) ÷ (2 × max)
  for (const axis of dataset.axes) {
    const expected = (100 * (max[axis.code] + score[axis.code])) / (2 * max[axis.code]);
    // 位置相同，級別的標籤也相同
    assert.ok(Math.abs(results.ideology.user.get(axis.code) - expected) < 1e-9, axis.code);
    assert.equal(results.bands.get(axis.code).label, axis.bands[eightvaluesBand(expected)].label);
  }
  // 距離：經濟與公民取平方，外交與社會取 1.73856063 次方
  const position = Object.fromEntries(dataset.axes.map((axis) => [axis.code, (100 * (max[axis.code] + score[axis.code])) / (2 * max[axis.code])]));
  const distance = (stats) => Math.abs(stats.econ - position.econ) ** 2 + Math.abs(stats.govt - position.govt) ** 2 + Math.abs(stats.dipl - position.dipl) ** 1.73856063 + Math.abs(stats.scty - position.scty) ** 1.73856063;
  // 距離最小的參照點就是最接近的意識形態
  const closest = [...dataset.references].sort((a, b) => distance(a.position) - distance(b.position))[0];
  assert.equal(results.closest.id, closest.id);
});

test("略過的題目不計入分母，全部略過時沒有位置也沒有最接近的參照點", async () => {
  // 重新選擇一次主題測驗，全部略過
  let skipped = (await act(C.normalizeState({}), "choose", "selectSet", TOPIC)).state;
  // 70 題逐題作答略過
  for (let i = 0; i < 70; i += 1) skipped = (await act(skipped, "quiz", "answer", `q${String(i + 1).padStart(2, "0")}=skip`)).state;
  // 結果頁照常能組成
  const empty = C.createContext(skipped, "result").results();
  // 略過不算作答，每條軸都沒有位置
  assert.equal(empty.answeredCount, 0);
  assert.equal(empty.closest, null);
  assert.ok([...empty.ideology.user.values()].every((value) => value === null));
});

// 選區與重視度頁不適用主題測驗，其餘頁面的卡片都要能組成
test("每一頁適用主題測驗的每張卡都有文案與 info", () => {
  // 逐頁組成適用主題測驗的頁面
  for (const [page, spec] of Object.entries(LAYOUT.pages).filter(([, item]) => fitsKind(item, "topic"))) {
    // 卡片位置與固定卡片都依 kinds 篩選
    const slots = [...spec.cards, spec.sticky].filter((slot) => slot && fitsKind(slot, "topic"));
    // 每張卡的文案與 info 都要齊全
    for (const slot of slots) {
      const built = C.buildCard(slot.card, C.createContext(state, page));
      // 標題、問題、讀法與 info 都有內容
      assert.ok(built.title && built.question && built.read, `${slot.card} 缺少文案`);
      assert.ok(built.info.steps.length + built.info.sources.length + built.info.constants.length > 0, `${slot.card} 的 info 是空的`);
    }
  }
  // 結果頁沒有候選人勾選列，分區只有摘要與明細
  const page = C.buildPage(context);
  assert.equal(page.sticky, null);
  // 直接前往選區頁時以提示卡取代
  assert.equal(C.buildPage(C.createContext(state, "scope")).cards[0].id, "need.kind");
  assert.deepEqual(page.sections.items.map((item) => item.key), ["overview", "details"]);
});

test("作答卡的說明鈕開啟原題，分享圖片與資料集檢視可用", () => {
  // 作答卡停在第一題
  const quiz = C.buildCard("quiz.question", C.createContext({ ...state, view: { ...state.view, quizIndex: 0 } }, "quiz"));
  // 主題測驗的題目上方沒有議題標示
  assert.ok(!quiz.blocks.some((block) => block?.type === "topic"));
  // 題目顯示正體中文的譯文
  assert.equal(quiz.blocks.find((block) => block?.type === "question").stem, "企業造成的壓迫比政府造成的壓迫更值得擔憂。");
  // 說明視窗列出英文原題
  const modal = C.buildModal(C.createContext(state, "quiz"), "question", "q01");
  assert.ok(modal.blocks.some((block) => block?.type === "text" && block.text.startsWith("Oppression by corporations")));
  // 分享圖片每條軸一條長條
  const image = C.shareImageSpec(context);
  assert.equal(image.items.length, 4);
  // 資料集頁列出主題測驗的檢視
  const browser = C.buildCard("dataset.browser", C.createContext({ ...state, view: { ...state.view, datasetView: "references" } }, "dataset"));
  assert.equal(browser.blocks.find((block) => block.type === "table").rows.length, SETTINGS.dataset.pageSize);
});

// 兩岸立場：單選題、全國對照與兩條軸交叉的四種類型
const CHOICE_TOPIC = "cross-strait";

/**
 * 選擇兩岸立場後依序作答。
 * @param {Record<string, string>} answers 題目代碼對應作答代碼。
 * @returns {Promise<object>} 作答後的狀態。
 */
async function crossStrait(answers) {
  let next = (await act(C.normalizeState({}), "choose", "selectSet", CHOICE_TOPIC)).state;
  // 依給定的順序逐題作答
  for (const [id, code] of Object.entries(answers)) next = (await act(next, "quiz", "answer", `${id}=${code}`)).state;
  // 組卡片前載入這個題組的資料
  await C.ensureData(next, "result");
  return next;
}

test("兩岸立場的單選題以選項作答，數字鍵依問卷順序對應選項", async () => {
  // 只選擇題組、尚未作答
  const chosen = await crossStrait({});
  // 第一題是六個選項的單選題
  const quiz = C.buildCard("quiz.question", C.createContext(chosen, "quiz"));
  const input = quiz.blocks.find((block) => block?.type === "choice");
  assert.equal(input.options.length, 6);
  // 選項依照問卷的順序
  assert.equal(input.options[0].label, "儘快統一");
  // 數字鍵 1 到 6 對應六個選項
  assert.equal(quiz.digits.length, 6);
  // 單選題的答案經 reconcile 後保留
  const answered = await crossStrait({ "q1-tondu": "q1-tondu-6" });
  assert.equal(C.reconcile(answered).answers["q1-tondu"].answer, "q1-tondu-6");
});

test("全國對照列出各選項的比例，只回答單選題時沒有最接近的類型", async () => {
  // 只回答兩題單選題
  const answered = await crossStrait({ "q1-tondu": "q1-tondu-6", "q2-identity": "q2-identity-1" });
  const result = C.createContext(answered, "result");
  // 摘要說明尚無可以比較的軸
  const summary = C.buildCard("topic.summary", result);
  assert.equal(summary.blocks.find((block) => block?.type === "heading").text, text("topic.noClosest"));
  // 統獨題繪製六個選項的全國比例
  const choices = C.buildCard("topic.choices", result);
  const bars = choices.blocks.find((block) => block?.type === "bars");
  assert.equal(bars.items.length, 6);
  // 只有你選擇的那一項不淡化
  assert.deepEqual(bars.items.filter((item) => !item.muted).map((item) => item.id), ["q1-tondu-6"]);
  // 認同題只附來源連結，沒有比例
  assert.equal(choices.blocks.filter((block) => block?.type === "bars").length, 1);
});

test("條件式兩題交叉成類型，兩題都中立時四型並列", async () => {
  // 兩題都同意時落在兩種條件都接受
  const either = C.createContext(await crossStrait({ "q3-independence": "agree", "q4-unification": "agree" }), "result").results();
  assert.equal(either.closest.id, "either");
  assert.equal(either.tied.length, 1);
  // 兩題都中立時與四個角落等距
  const neutral = C.createContext(await crossStrait({ "q3-independence": "neutral", "q4-unification": "neutral" }), "result").results();
  assert.equal(neutral.tied.length, 4);
});

test("題組宣告的卡片才組成，沒有雷達卡的題組分享圖片也不繪製雷達", async () => {
  // 四題都有紀錄，結果頁才開放
  const answered = await crossStrait({ "q1-tondu": "q1-tondu-3", "q2-identity": "skip", "q3-independence": "disagree", "q4-unification": "agree" });
  const result = C.createContext(answered, "result");
  // 結果頁有單選題卡，沒有雷達卡
  const ids = C.buildPage(result).cards.map((card) => card.id);
  assert.ok(ids.includes("topic.choices") && !ids.includes("topic.radar"));
  // 分享圖片沒有雷達，單選題列不繪製長條
  const image = C.shareImageSpec(result);
  assert.equal(image.radar, null);
  assert.equal(image.items[0].value, null);
  // 8values 宣告了雷達卡，沒有單選題卡
  const eightIds = C.buildPage(context).cards.map((card) => card.id);
  assert.ok(eightIds.includes("topic.radar") && !eightIds.includes("topic.choices"));
});

test("沒有參照點的探索性題組，摘要不列類型，結果頁沒有參照點卡", async () => {
  // 選擇探索性題組，14 題都回答同意
  let next = (await act(C.normalizeState({}), "choose", "selectSet", "taiwan-status")).state;
  // 依作答順序逐題作答
  for (let i = 0; i < 14; i += 1) {
    // 載入資料後選取第 i 題，回答同意
    await C.ensureData(next, "quiz");
    const item = C.createContext(next, "quiz").questions().visible[i];
    next = (await act(next, "quiz", "answer", `${item.id}=agree`)).state;
  }
  // 結果頁的情境
  await C.ensureData(next, "result");
  const result = C.createContext(next, "result");
  // 每條軸正反題數相同，全部同意時三條軸都在中間
  for (const value of result.results().ideology.user.values()) assert.equal(value, 50);
  // 摘要沒有類型標題，結果頁沒有參照點卡、有雷達
  assert.ok(!C.buildCard("topic.summary", result).blocks.some((block) => block?.type === "heading"));
  const ids = C.buildPage(result).cards.map((card) => card.id);
  assert.ok(ids.includes("topic.radar") && !ids.includes("topic.references"));
});
