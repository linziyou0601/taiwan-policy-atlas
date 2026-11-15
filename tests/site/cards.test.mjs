/* ==================================================
 * cards.test.mjs - 卡片層與端對端流程的測試
 * --------------------------------------------------
 * - 角色：以 2024 總統依序執行選舉、作答到結果的流程，檢查每一頁的卡片都能組成、info 的代入值與結果一致、分享連結重播、狀態匯出與匯入與翻牌前的遮蔽
 * - 指令：`npm test`，或 `node --test tests/site/cards.test.mjs` 單獨執行
 * - 慣例：卡片層不使用 DOM，因此可以在 node 中組成全部卡片描述
 * ================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT } from "../../src/config/index.js";
import { indexBy } from "../../src/lib/objects.js";
import { installFetch, loadModel, act, answeredState, ELECTION, SCOPE } from "./helpers.mjs";

installFetch();
const C = await import("../../src/cards/index.js");
const K = await import("../../src/cards/kit.js");

// 全國性選舉只有一個選區，選舉頁之後不必再選擇選區
test("全國性選舉選擇之後直接進入議題重視度", async () => {
  const result = await act(C.normalizeState({}), "choose", "selectSet", ELECTION);
  // 選區自動選定，下一頁是議題重視度
  assert.equal(result.state.scopeId, SCOPE);
  assert.equal(result.route, "weights");
});

// 更換選舉會清除作答
test("已有作答時更換選舉要先確認", async () => {
  const state = await answeredState();
  const result = await act(state, "choose", "selectSet", "2024-legislator-district");
  // 回傳確認效果，狀態維持原樣
  assert.equal(result.effect.type, "confirm");
  // 確認後接續的動作是強制更換選舉
  assert.equal(result.effect.then, "forceSet:2024-legislator-district");
  assert.equal(result.state, state);
});

// 每頁的卡片都要能組成，缺文案或區塊錯誤會在這裡拋出
test("每一頁的卡片都能組成，且卡片都有標題與說明文案", async () => {
  const state = await answeredState();
  // 逐頁組成卡片
  for (const page of Object.keys(LAYOUT.pages)) {
    await C.ensureData(state, page);
    const spec = C.buildPage(C.createContext(state, page));
    // 條件都滿足時每頁至少有一張提示卡以外的卡
    assert.ok(spec.cards.length > 0, page);
    // 每張卡都有文案，有 info 的卡都有完整的區段
    for (const card of spec.cards) {
      assert.equal(typeof card.title, "string", card.id);
      // 有 info 時要有步驟、來源與設定值欄位
      if (card.info) assert.ok(Array.isArray(card.info.steps) && Array.isArray(card.info.sources) && Array.isArray(card.info.constants), card.id);
      // 說明視窗能組成，且每一段都有標題
      if (card.info) assert.equal(C.buildModal(C.createContext(state, page), "info", card).blocks[0].type, "heading", card.id);
    }
  }
});

// 網站版本取自建置清單，頁尾與更新紀錄都顯示它
test("頁尾與更新紀錄顯示建置清單的網站版本", async () => {
  const state = C.normalizeState({});
  // 尚未選擇題組也能開啟更新紀錄頁，建置清單在每頁都會載入
  await C.ensureData(state, "changelog");
  const context = C.createContext(state, "changelog");
  // 測試的建置清單由 helpers 提供
  const version = context.data.build.version;
  // 頁尾的第一行是網站版本
  assert.ok(C.buildPage(context).about[0].includes(version));
  // 更新紀錄的版本欄列出網站版本
  assert.ok(JSON.stringify(C.buildPage(context).cards).includes(`"value":"${version}"`));
});

// 結果頁要每一題都作答或略過才開放，導覽列與步驟列的結果入口同時鎖住
test("作答未完成時結果頁改為提示卡，結果的入口鎖住", async () => {
  // 只選擇了選舉、尚未作答的狀態
  const state = (await act(C.normalizeState({}), "choose", "selectSet", ELECTION)).state;
  await C.ensureData(state, "result");
  const spec = C.buildPage(C.createContext(state, "result"));
  // 尚未作答時只有完成作答的提示卡，按鈕前往作答頁
  assert.deepEqual(spec.cards.map((card) => card.id), ["need.complete"]);
  assert.equal(spec.cards[0].blocks[1].items[0].action, "route:quiz");
  // 導覽列與步驟列的結果入口都鎖住，並附上說明
  assert.ok(spec.nav.find((item) => item.page === "result").lock);
  assert.ok(spec.flow.steps.find((item) => item.page === "result").lock);
  // 每一題都作答後解鎖，結果頁組成結果卡
  const done = await answeredState();
  const open = C.buildPage(C.createContext(done, "result"));
  // 入口不再鎖住，第一張卡是結果摘要
  assert.equal(open.nav.find((item) => item.page === "result").lock, null);
  assert.equal(open.cards[0].id, "result.summary");
});

// info 代入式的結果要與畫面上的總分相同
test("結果摘要 info 的代入值與計算結果一致", async () => {
  const state = await answeredState();
  const context = C.createContext(state, "result");
  // 選取第一名的總分與摘要卡第一步的代入式
  const top = context.results().entities[0];
  const summary = C.buildCard("result.summary", context);
  const formula = summary.info.steps[0].formula;
  // 代入式最後的值就是總分，以三位小數比對
  assert.ok(formula.endsWith(`= ${top.total.toFixed(3)}`), formula);
});

// 翻牌前的頁面與題目視窗都經遮蔽
test("翻牌前卡片與視窗不出現姓名與黨名", async () => {
  const state = await answeredState();
  const context = C.createContext(state, "result");
  // 把結果頁、作答頁與前十題的視窗描述串成一段文字檢查
  const output = JSON.stringify([C.buildPage(context), C.buildPage(C.createContext(state, "quiz")), ...context.results().questionIds.slice(0, 10).map((id) => C.buildModal(context, "question", id))]);
  // 名冊的姓名與黨名都不應出現
  for (const entity of context.entities) {
    assert.equal(output.includes(entity.name), false, entity.name);
    assert.equal(output.includes(entity.party), false, entity.party);
  }
  // 翻牌後顯示姓名
  const revealed = C.createContext({ ...state, reveal: true }, "result");
  assert.ok(revealed.label(context.entities[0].id).includes(context.entities[0].name));
  // 翻牌後排名列附帶政黨標記：黨名、簡稱，政黨表有登錄時附色票
  const ranking = C.buildCard("result.summary", revealed).blocks.find((block) => block.type === "ranking");
  // 每一位的黨名都取自名冊，簡稱一定有值
  for (const item of ranking.items) {
    assert.equal(item.party.name, revealed.model.entities.get(item.id).party);
    assert.equal(typeof item.party.short, "string");
  }
  // 名冊的黨名在政黨表登錄時有色票
  assert.ok(ranking.items.some((item) => item.party.mark?.light), "至少一位候選人的政黨有色票");
  // 分項依公式的分項列出，數量與公式權重的鍵相同
  const keys = Object.keys(revealed.settings.scoring.formulaParams);
  // 每位候選人逐一比對
  for (const item of ranking.items) assert.equal(item.metrics.length, keys.length);
  // 分享圖片每列的次要文字寫出可比較題數與每個分項的簡稱，簡稱缺漏時會留下 locale 的鍵名
  const image = C.shareImageSpec(revealed);
  // 每列逐一檢查
  for (const item of image.items) assert.ok(!item.meta.includes("shareImage.parts") && item.meta.split(K.t("common.separator")).length === keys.length + 1, item.meta);
});

// 翻牌後同黨的候選人同色系分深淺，無黨籍與沒有圖表色的黨使用與本選區政黨色相差夠遠的色相
test("翻牌配色依候選人：同黨分深淺，其餘避開政黨色相", async () => {
  const { tables } = await loadModel();
  const { colorOf } = await import("../../src/cards/series.js");
  // 兩位同黨、一位民進黨，其餘是無黨籍與政黨表沒有登錄的黨
  const parties = ["中國國民黨", "中國國民黨", "民主進步黨", "無黨籍及未經政黨推薦", "無黨籍及未經政黨推薦", "未登錄的黨", "無黨籍及未經政黨推薦", "無黨籍及未經政黨推薦"];
  const ids = parties.map((_, index) => `e${index}`);
  const model = { maskOrder: ids, entities: new Map(ids.map((id, index) => [id, { party: parties[index] }])), parties: indexBy(tables.parties, "name") };
  // 只提供配色使用的欄位：遮蔽順序、黨名與政黨表
  const context = (revealed) => ({ revealed, model, entityIds: ids, entities: ids.map((id) => ({ id })) });
  // 從 oklch 字串擷取色相
  const hueOf = (text) => Number(/([\d.]+)\s*\)$/.exec(text)[1]);
  const shown = context(true);
  const marks = ids.map((id) => colorOf(shown, id).mark);
  // 同黨兩位色相相同、亮度不同，各自可以分辨
  assert.equal(hueOf(marks[0].light), hueOf(marks[1].light));
  assert.notEqual(marks[0].light, marks[1].light);
  // 其餘候選人的顏色彼此不同，色相與兩個政黨色的距離不小於色環平均分給全部候選人的半格
  const others = marks.slice(3);
  assert.equal(new Set(others.map((mark) => mark.light)).size, others.length);
  // 每一位都與兩個政黨色比較
  for (const mark of others) {
    // 色環上的距離選取兩個方向中較短的一邊
    for (const party of [marks[0], marks[2]]) {
      const gap = Math.abs(hueOf(mark.light) - hueOf(party.light)) % 360;
      assert.ok(Math.min(gap, 360 - gap) >= 360 / ids.length / 2, mark.light);
    }
  }
  // 翻牌前沒有配色，顏色不能洩漏身分
  assert.equal(colorOf(context(false), ids[0]).mark, null);
});

// 分享連結附帶的答案解碼後，結果要與分享者相同
test("分享連結解碼後重播出同一份結果", async () => {
  const state = await answeredState();
  const context = C.createContext(state, "result");
  // 產生分享參數，長度在上限內才有值
  const shared = await C.encodeShare(context);
  assert.ok(shared.packed);
  // 同一份資料解碼時沒有不一致的版本
  const decoded = await C.decodeShare(shared.packed, context);
  assert.deepEqual(decoded.mismatches, []);
  // 解碼的狀態補齊完整雜湊後與原狀態的答案相同
  const replay = C.reconcile(C.normalizeState({ ...C.normalizeState({}), ...decoded.state }));
  assert.deepEqual(replay.answers, state.answers);
  // 依兩份狀態各自重新計算，比較每位候選人的總分
  const totals = (s) => C.createContext(s, "result").results().entities.map((e) => [e.id, e.total]);
  assert.deepEqual(totals(replay), totals(state));
});

// 檢視他人分享的結果是唯讀的觀看模式，只到議題層級
test("檢視他人分享的結果時只開放結果頁、不顯示逐題作答、參數與作答鎖住", async () => {
  const state = { ...(await answeredState()), reveal: true, shared: true };
  // 作答與流程頁改為提示卡，提示卡的按鈕回到自己的作答
  for (const page of ["choose", "quiz", "dataset"]) {
    await C.ensureData(state, page);
    const spec = C.buildPage(C.createContext(state, page));
    // 每一頁都改為 own 的提示卡，頁首下方有說明列
    assert.equal(spec.cards[0].id, "need.own");
    assert.ok(spec.banner);
  }
  // 結果頁照常組成，沒有含逐題作答的明細分區
  const result = C.buildPage(C.createContext(state, "result"));
  assert.ok(!result.cards.some((card) => card.section === "details"));
  assert.ok(!result.sections.items.some((item) => item.key === "details"));
  // 一律翻牌，常駐列沒有翻牌鈕
  assert.equal(result.sticky.blocks[0].reveal, null);
  // 參數卡只列出值，沒有可以調整的控制項
  const params = result.cards.find((card) => card.id === "result.params");
  assert.ok(params.blocks.some((block) => block.type === "keyValue"));
  assert.ok(!params.blocks.some((block) => ["slider", "toggle", "segmented"].includes(block?.type)));
  // 會修改作答或參數的動作不執行，切換頁面與切換候選人照常
  assert.equal((await act(state, "result", "setParam", "scoring.stanceMinQuestions=5")).state, state);
  assert.equal((await act(state, "result", "toggleReveal", "")).state, state);
  assert.equal((await act(state, "result", "route", "methods")).route, "methods");
  // 離開觀看模式交給 app 層重新讀取本機的狀態
  assert.equal((await act(state, "result", "exitShared", "")).effect.type, "exitShared");
});

// 匯出檔可依每種方式匯入，格式不符時不改動狀態
test("狀態依分類匯出，以不覆寫、附加、覆寫三種方式匯入", async () => {
  const state = await answeredState();
  const exported = (await act(state, "dataset", "exportState", "")).effect.content;
  // 目前狀態只有顯示偏好，用來觀察各匯入方式的差別
  const empty = C.normalizeState({ theme: "dark" });
  // 不覆寫：已有值的鍵保留，沒有值的鍵補齊
  const kept = (await act({ ...empty, view: { ...empty.view, importMode: "keep" } }, "dataset", "applyStateImport", { name: "s.json", text: exported })).state;
  assert.equal(kept.theme, "dark");
  assert.deepEqual(kept.answers, state.answers);
  // 覆寫：整類取代
  const replaced = (await act({ ...empty, view: { ...empty.view, importMode: "replace" } }, "dataset", "applyStateImport", { name: "s.json", text: exported })).state;
  assert.equal(replaced.theme, state.theme);
  // 格式不符的檔案不改動狀態
  const failed = await act(empty, "dataset", "applyStateImport", { name: "x.json", text: "{}" });
  assert.equal(failed.state, empty);
  assert.equal(failed.effect.tone, "critical");
});

// 題意雜湊不符的答案不能沿用
test("題意改變的答案移到封存", async () => {
  const state = await answeredState();
  const id = Object.keys(state.answers)[0];
  // 把一題的雜湊改為不存在的值，模擬題目改版
  const stale = { ...state, answers: { ...state.answers, [id]: { ...state.answers[id], hash: "0".repeat(64) } } };
  const reconciled = C.reconcile(stale);
  // 舊答案移出作答，記錄在封存的最後一筆
  assert.equal(reconciled.answers[id], undefined);
  assert.equal(reconciled.archive.at(-1).question, id);
});

// 作答到一半離開作答頁要先確認，離開或關閉分頁後放棄，下次從第一題開始
test("作答到一半離開時確認並放棄，匯入新題目時從未答的題目繼續作答", async () => {
  // 選擇選舉、尚未作答，選取第一題作答
  const base = (await act(C.normalizeState({}), "choose", "selectSet", ELECTION)).state;
  await C.ensureData(base, "quiz");
  const first = C.createContext(base, "quiz").questions().visible[0].id;
  // 作答後停在同一題，不自動跳到下一題
  const answered = (await act(base, "quiz", "answer", `${first}=agree`)).state;
  assert.equal(answered.view.quizIndex, 0);
  // 離開作答頁時要先確認，確定後清空作答
  const leaving = await act(answered, "quiz", "route", "home");
  assert.equal(leaving.effect.type, "confirm");
  assert.deepEqual((await act(answered, "quiz", "forceRoute", "home")).state.answers, {});
  // 作答中經瀏覽器的上一頁離開或關閉分頁後再開啟，都放棄這次作答
  const inQuiz = { ...answered, view: { ...answered.view, quizOpen: true } };
  assert.deepEqual(C.enterPage(inQuiz, "quiz", "weights", C.createContext(inQuiz, "weights")).answers, {});
  assert.deepEqual(C.enterPage(inQuiz, null, "home", C.createContext(inQuiz, "home")).answers, {});
  // 重新整理作答頁時繼續作答
  assert.equal(C.enterPage(inQuiz, null, "quiz", C.createContext(inQuiz, "quiz")), inQuiz);
  // 不在作答中卻有未答題時，進入作答頁保留答案，從第一題未答開始
  const resumed = C.enterPage(answered, "dataset", "quiz", C.createContext(answered, "quiz"));
  // 答案沿用同一份，序號指向未答的第二題
  assert.equal(resumed.answers, answered.answers);
  assert.equal(resumed.view.quizIndex, 1);
  assert.equal(resumed.view.quizOpen, true);
  // 只按下一題瀏覽、沒有作答就離開，題號回到第一題
  const browsed = { ...base, view: { ...base.view, quizIndex: 5, quizOpen: true } };
  const away = C.enterPage(browsed, "quiz", "home", C.createContext(browsed, "home"));
  assert.equal(C.enterPage(away, "home", "quiz", C.createContext(away, "quiz")).view.quizIndex, 0);
  // 全部答完後停在第 8 題離開，再進入也從第一題開始
  const finished = await answeredState();
  const again = { ...finished, view: { ...finished.view, quizIndex: 7, quizOpen: true } };
  const back = C.enterPage(again, "quiz", "result", C.createContext(again, "result"));
  // 回到結果頁時題號已歸零
  assert.equal(C.enterPage(back, "result", "quiz", C.createContext(back, "quiz")).view.quizIndex, 0);
  // 從結果頁指定題號時依照指定的題目
  const jump = { ...back, view: { ...back.view, quizIndex: 3 } };
  assert.equal(C.enterPage(jump, "result", "quiz", C.createContext(jump, "quiz")).view.quizIndex, 3);
  // 作答完成後離開時不放棄
  const done = { ...(await answeredState()), view: { ...(await answeredState()).view, quizOpen: true } };
  const left = C.enterPage(done, "quiz", "result", C.createContext(done, "result"));
  // 答案保留，作答中的標記清除
  assert.equal(left.answers, done.answers);
  assert.equal(left.view.quizOpen, false);
});

// 匯入檔或分享連結可能帶來量尺上沒有的作答代碼，計分前就要移出
test("作答代碼不在量尺上的答案移到封存，略過的答案保留", async () => {
  const state = await answeredState();
  const [first, second] = Object.keys(state.answers);
  // 一題改為無法辨識的代碼，另一題改為略過
  const odd = { ...state, answers: { ...state.answers, [first]: { ...state.answers[first], answer: "very-agree" }, [second]: { ...state.answers[second], answer: "skip" } } };
  const reconciled = C.reconcile(odd);
  // 無法辨識的代碼封存，略過照常保留，結果頁能計算出結果
  assert.equal(reconciled.answers[first], undefined);
  assert.equal(reconciled.answers[second].answer, "skip");
  assert.ok(C.createContext(reconciled, "result").results());
});

// 匯出的是篩選後的全部列
test("資料集檢視可匯出 CSV，列數與篩選後的資料相同", async () => {
  let state = await answeredState();
  state = (await act(state, "dataset", "setView", "datasetView=claims")).state;
  // 切換到主張檢視後匯出 CSV
  const result = await act(state, "dataset", "exportView", "csv");
  const lines = result.effect.content.trim().split("\n");
  const claims = C.createContext(state, "dataset").model.claims.size;
  // 主張的原文不含換行，每列一則主張加上表頭
  assert.equal(lines.length, claims + 1);
});
