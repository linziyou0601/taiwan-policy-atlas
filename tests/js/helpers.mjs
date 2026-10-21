/* ==================================================
 * helpers.mjs - 測試共用的資料載入
 * --------------------------------------------------
 * - 角色：在 node 中以 repo 內的檔案代替網站的 fetch，讓資料層、計分層與卡片層用真實資料測試，並提供執行動作與作答完的狀態
 * - 指令：由各測試檔匯入，以 `npm test` 執行
 * - 慣例：網站的路徑與 repo 的相對路徑相同，只有建置清單以固定的雜湊代替
 * ================================================== */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../scripts/common.mjs";
import { SETTINGS } from "../../src/config/index.js";
import { formatStamp } from "../../src/lib/stamp.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 測試用的建置清單，格式戳記取自設定，與建置寫出的相同。
 */
const BUILD = { ...formatStamp(SETTINGS.formats.build), version: "dev", engine: "e".repeat(64), config: "c".repeat(64) };

/**
 * 端對端測試使用的選舉與選區。
 */
const ELECTION = "2024-president";
const SCOPE = "2024-president:national";

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 以 repo 檔案代替 fetch。
 */
function installFetch() {
  globalThis.fetch = async (path) => {
    // 建置清單在 repo 內沒有，以固定內容代替
    if (path === "build.json") return { ok: true, text: async () => JSON.stringify(BUILD) };
    // 其餘路徑對應 repo 內的同名檔案
    try {
      const body = readFileSync(join(ROOT, path), "utf8");
      return { ok: true, text: async () => body };
    // 讀取不到的檔案對應網站的 404
    } catch {
      return { ok: false, text: async () => "" };
    }
  };
}

/**
 * 讀取設定表與 2024 總統的資料模型，經資料層的載入函式讀取。
 * @returns {Promise<{ tables: object, model: object, dataset: object }>}
 */
async function loadModel() {
  installFetch();
  const { loadIndex, loadTables, loadDataset, buildModel } = await import("../../src/data/index.js");
  // 資料集只能從索引宣告的路徑讀取
  const [index, tables] = await Promise.all([loadIndex(), loadTables()]);
  const dataset = await loadDataset(index.sets.find((set) => set.id === ELECTION), index.allowed);
  return { tables, dataset, model: buildModel("election", dataset, tables) };
}

/**
 * 以同一個答案回答選區內全部題目，子題依答案出現。
 * @param {object} model 資料模型。
 * @param {(question: object, index: number) => string} pick 決定每題答案的函式。
 * @returns {Promise<Record<string, { answer: string, hash: string }>>}
 */
async function answerAll(model, pick) {
  const { visibleQuestions } = await import("../../src/metrics/index.js");
  const answers = {};
  // 這一回合有沒有新作答
  let added = true;
  // 每回合為新出現的題目作答，直到沒有新題目
  while (added) {
    added = false;
    // 依目前路徑逐題作答
    for (const [index, item] of visibleQuestions(model, SCOPE, answers, {}).entries()) {
      // 已作答的題目不重新作答
      if (answers[item.id]) continue;
      const question = model.questions.get(item.id);
      answers[item.id] = { answer: pick(question, index), hash: question.hash };
      // 子題在母題作答後才出現，有新作答時再執行一輪
      added = true;
    }
  }
  return answers;
}

/**
 * 執行一個動作並回傳結果，執行前載入頁面需要的資料。
 * @param {object} state 狀態。
 * @param {string} page 頁面。
 * @param {string} name 動作。
 * @param {unknown} arg 參數。
 * @returns {Promise<{ state: object, route?: string, effect?: object }>}
 */
async function act(state, page, name, arg) {
  const C = await import("../../src/cards/index.js");
  await C.ensureData(state, page);
  return C.dispatch(name, arg, state, C.createContext(state, page));
}

/**
 * 從選擇 2024 總統開始，依路徑以量尺各級輪流回答全部題目。
 * @param {string[]} [extra] 輪流作答時另外加入的答案，例如略過。
 * @returns {Promise<object>} 作答完的狀態。
 */
async function answeredState(extra = []) {
  const C = await import("../../src/cards/index.js");
  let { state } = await act(C.normalizeState({}), "choose", "selectSet", ELECTION);
  // 全國性選舉選擇之後直接選定唯一的選區，作答頁的資料先載入
  await C.ensureData(state, "quiz");
  // 量尺各級輪流作答，讓每種答案與追問題都出現
  const codes = [...C.createContext(state, "quiz").model.scale.map((choice) => choice.code), ...extra];
  // 每次回答目前第一題未答的題目，直到全部答完
  for (let i = 0; i < 300; i += 1) {
    const next = C.createContext(state, "quiz").questions().visible.find((item) => !state.answers[item.id]);
    // 沒有未答的題目時結束
    if (!next) break;
    state = (await act(state, "quiz", "answer", `${next.id}=${codes[i % codes.length]}`)).state;
  }
  return state;
}

/* ==================================================
 * 匯出
 * ================================================== */

export { ELECTION, SCOPE, installFetch, loadModel, answerAll, act, answeredState };
