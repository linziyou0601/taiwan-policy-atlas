#!/usr/bin/env node
/* ==================================================
 * browser.mjs - 網站的瀏覽器冒煙測試
 * --------------------------------------------------
 * - 角色：以一個無頭的 Chrome 走過選舉比對與主題測驗的整條流程，確認每一步的元素都在、頁面沒有錯誤訊息、沒有橫向捲動、分享連結能重播。卡片與計分的邏輯由 tests/site 的其他測試涵蓋，這裡只驗畫面真的組得出來
 * - 指令：`npm run test:browser`，先以 `npm run build` 建置。需要本機的 Google Chrome，路徑可以用環境變數 CHROME 指定
 * - 慣例：
 *   - 自己啟動本機伺服器與一個 Chrome，結束時兩個都關掉。寬螢幕與手機兩種寬度在同一個 Chrome 依序執行
 *   - 題組取自題組索引：第一場只有一個選區、已收錄政見的選舉，以及每一套主題測驗
 *   - 每一項檢查印出一行，全部通過時結束代碼是 0，有一項沒通過是 1，Chrome 或建置產物不存在是 2
 *   - 版面的細節依 DESIGN.md 的 New Page Checklist 以人工檢查，這支測試只抓得到元素消失、執行錯誤與版面溢出
 * ================================================== */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../scripts/common.mjs";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * Chrome 的路徑、偵錯埠號與本機伺服器的埠號。
 */
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9334;
const SERVE_PORT = 8091;
// 網站的網址，分享連結以它開頭
const ORIGIN = `http://localhost:${SERVE_PORT}/`;

/**
 * 依序測試的視窗寬度：寬螢幕與手機。
 */
const WIDTHS = [1440, 390];
const HEIGHT = 900;

/**
 * 等待的時間（毫秒）：換頁與重新繪製、開啟視窗、每一次輪詢。
 */
const PAGE_WAIT = 900;
const MODAL_WAIT = 400;
const POLL_WAIT = 200;

/**
 * 啟動 Chrome、等待元素出現與作答的輪詢上限。
 */
const START_POLLS = 100;
const CLICK_POLLS = 25;
const MAX_QUESTIONS = 600;

/**
 * 走完流程後逐一開啟的文件頁。
 */
const DOCUMENT_PAGES = ["methods", "faq", "changelog", "dataset"];

/**
 * 狀態在 localStorage 的鍵，取自網站設定。
 */
const SETTINGS = JSON.parse(readFileSync(join(ROOT, "config/app/settings.json"), "utf8"));
const STORAGE_KEY = SETTINGS.storage.key;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 等待一段時間。
 * @param {number} ms 毫秒。
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 啟動本機伺服器與一個無頭的 Chrome，回傳操作頁面的函式。
 * @returns {Promise<{ evaluate: Function, send: Function, errors: string[], close: Function }>}
 */
async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "atlas-browser-"));
  const server = spawn(process.execPath, [join(ROOT, "scripts/site/serve.mjs"), String(SERVE_PORT)], { stdio: "ignore" });
  // Chrome 用自己的暫存設定檔，和使用者平常的 Chrome 分開
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  const close = () => {
    server.kill();
    // 無頭的 Chrome 直接結束，不留下背景的實例
    chrome.kill("SIGKILL");
    // 暫存的設定檔用完就刪
    rmSync(profile, { recursive: true, force: true });
  };
  // 測試中途出錯或被中斷時也要關掉伺服器與 Chrome
  process.on("exit", close);
  let target = null;
  // Chrome 開好偵錯埠之前連不上，輪詢到列出頁面為止
  for (let attempt = 0; attempt < START_POLLS && !target; attempt += 1) {
    // 連不上時等一下再試
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((item) => item.type === "page") ?? null;
    } catch {
      // 還連不上時等一下再試
      await wait(POLL_WAIT);
    }
  }
  // Chrome 沒有啟動時交給呼叫端回報
  if (!target) throw new Error(`連不上 Chrome 的偵錯埠 ${DEBUG_PORT}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener("open", done));
  // 等待回覆的呼叫依編號記下，錯誤訊息另外收集
  const pending = new Map();
  const errors = [];
  let id = 0;
  // 回覆依編號交給等待的呼叫，執行錯誤與 console 的錯誤訊息另外收集
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    // 有編號的是某一次呼叫的回覆
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    // 沒有被接住的例外
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    // console.error 的訊息
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    // 載入失敗這類瀏覽器記下的錯誤
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(`${message.params.entry.text} ${message.params.entry.url ?? ""}`);
  });
  const send = (method, params = {}) =>
    new Promise((done) => {
      // 每一次呼叫一個新的編號
      id += 1;
      pending.set(id, done);
      socket.send(JSON.stringify({ id, method, params }));
    });
  // 三個領域都要啟用才收得到錯誤訊息
  for (const domain of ["Runtime", "Log", "Page"]) await send(`${domain}.enable`);
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    // 頁面裡拋出的例外當成測試的錯誤
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
    return reply.result.result.value;
  };
  return { evaluate, send, errors, close };
}

/**
 * 從題組索引選出要走的題組。
 * @returns {{ election: string, topics: string[] }}
 */
function pickSets() {
  const index = JSON.parse(readFileSync(join(ROOT, "data/60-publish/index.json"), "utf8"));
  const election = index.elections.find((item) => item.manifest.counts.scopes === 1 && item.manifest.counts.questions > 0);
  return { election: election.id, topics: index.topics.map((item) => item.id) };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 在一種寬度下走過整條流程。
 * @param {Awaited<ReturnType<typeof launch>>} browser 操作頁面的函式。
 * @param {number} width 視窗寬度。
 * @param {{ election: string, topics: string[] }} sets 要走的題組。
 * @param {(name: string, passed: boolean, detail?: string) => void} check 記下一項檢查的結果。
 */
async function walk(browser, width, sets, check) {
  const { evaluate, send } = browser;
  const tag = `${width} px`;
  // 點一個元素，找不到時記成一項沒通過的檢查
  const click = async (selector, pause = PAGE_WAIT) => {
    let found = false;
    // 頁面還在載入時元素還沒出現，輪詢到出現或次數用完
    for (let attempt = 0; attempt < CLICK_POLLS && !found; attempt += 1) {
      found = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
      // 還沒出現時等一下再找
      if (!found) await wait(POLL_WAIT);
    }
    check(`${tag} 找得到 ${selector}`, found);
    await wait(pause);
  };
  // 整頁的寬度不能超過視窗
  const noOverflow = async (page) => check(`${tag} ${page} 沒有橫向捲動`, !(await evaluate("document.documentElement.scrollWidth > window.innerWidth")));
  const hash = () => evaluate("location.hash");
  // 以數字鍵作答並按下一題，直到進入結果頁
  const answerAll = async () => {
    // 每一題按一個數字鍵，再按導覽的最後一顆按鈕
    for (let index = 0; index < MAX_QUESTIONS && !(await hash()).startsWith("#/result"); index += 1) {
      await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "${(index % 5) + 1}", bubbles: true }))`);
      await wait(40);
      // 導覽的最後一顆按鈕是下一題，最後一題時是看結果
      const moved = await evaluate(`(() => { const next = [...document.querySelectorAll('main nav [data-action^="quizGo:"], main nav [data-action="route:result"]')].at(-1); if (!next || next.disabled) return false; next.click(); return true; })()`);
      // 沒有下一題可按時停下，由後面的檢查回報
      if (!moved) break;
      await wait(60);
    }
    await wait(PAGE_WAIT);
  };
  // 先設定視窗的寬度，再開啟首頁
  await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 640 });
  await send("Page.navigate", { url: `${ORIGIN}#/home` });
  await wait(PAGE_WAIT);
  // 每種寬度都從空的狀態開始
  await evaluate("localStorage.clear()");
  await send("Page.reload", { ignoreCache: true });
  await wait(PAGE_WAIT);
  // 首頁是第一項檢查
  await noOverflow("首頁");

  // 選舉比對：選擇、議題重視度、作答、結果
  await evaluate('location.hash = "#/choose"');
  await wait(PAGE_WAIT);
  await click(`[data-action="selectSet:${sets.election}"]`);
  // 選好選舉後進入議題重視度
  await noOverflow("議題重視度");
  await click('[data-action="route:quiz"]');
  await noOverflow("作答");
  // 作答頁先開一次候選人原文的視窗
  await click('[data-action^="openQuestion:"]', MODAL_WAIT);
  // 看過候選人的原文後關掉視窗，再開始作答
  await click('[data-action="closeModal"]', MODAL_WAIT);
  await answerAll();
  check(`${tag} 選舉比對作答後進入結果頁`, (await hash()).startsWith("#/result"), await hash());
  // 結果頁的寬度與內容
  await noOverflow("結果");
  // 結果頁的勾選列要有候選人
  check(`${tag} 結果頁列出候選人`, (await evaluate(`document.querySelectorAll('[data-action^="toggleSelect:"]').length`)) > 0);
  await click('[data-action^="openInfo:"]', MODAL_WAIT);
  await click('[data-action="closeModal"]', MODAL_WAIT);
  // 翻牌之後再開分享視窗
  await click('[data-action="toggleReveal"]');
  // 分享視窗的唯讀欄位是分享連結
  await click('[data-action="share"]', MODAL_WAIT);
  const url = await evaluate(`document.querySelector('[role=dialog] input[readonly]')?.value ?? ""`);
  check(`${tag} 分享視窗有連結`, url.startsWith(ORIGIN), url.slice(0, 60));
  // 關掉分享視窗後才換頁
  await click('[data-action="closeModal"]', MODAL_WAIT);
  // 文件頁各開一次
  for (const page of DOCUMENT_PAGES) {
    await evaluate(`location.hash = "#/${page}"`);
    await wait(PAGE_WAIT);
    // 每一頁都檢查寬度
    await noOverflow(page);
  }

  // 分享連結：清掉本機狀態後開啟，進入觀看模式而且沒有寫入作答
  await evaluate("localStorage.clear()");
  await send("Page.navigate", { url: "about:blank" });
  await send("Page.navigate", { url });
  // 重播要載入資料集與選區檔，多等一下
  await wait(PAGE_WAIT * 3);
  check(`${tag} 分享連結進入觀看模式`, await evaluate(`Boolean(document.querySelector('[data-action="exitShared"]'))`));
  const stored = await evaluate(`Object.keys(JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) ?? "{}").answers ?? {}).length`);
  // 開啟者自己的作答要保持原樣
  check(`${tag} 觀看模式沒有寫入作答`, stored === 0, String(stored));

  // 主題測驗：每一套選好就作答，作答後進入結果頁
  for (const topic of sets.topics) {
    await evaluate("localStorage.clear()");
    await send("Page.navigate", { url: `${ORIGIN}#/choose` });
    // 重新載入後才是空的狀態
    await send("Page.reload", { ignoreCache: true });
    await wait(PAGE_WAIT);
    await click(`[data-action="selectSet:${topic}"]`);
    // 作答頁的寬度
    await noOverflow(`${topic} 作答`);
    // 主題測驗選好就進入作答
    await answerAll();
    check(`${tag} ${topic} 作答後進入結果頁`, (await hash()).startsWith("#/result"), await hash());
    await noOverflow(`${topic} 結果`);
  }
}

/**
 * 執行測試。
 * @returns {Promise<number>} 結束代碼。
 */
async function main() {
  // 建置產物與 Chrome 都要在
  for (const path of [join(ROOT, "web/index.html"), CHROME]) {
    // 缺少時不是測試失敗，是環境沒有準備好
    if (!existsSync(path)) {
      process.stderr.write(`找不到 ${path}，先執行 npm run build，或以環境變數 CHROME 指定 Chrome 的路徑\n`);
      return 2;
    }
  }
  // 啟動之後每一項檢查的結果都記下來
  const browser = await launch();
  const failures = [];
  let total = 0;
  // 一項檢查印出一行
  const check = (name, passed, detail = "") => {
    // 總數與沒通過的名稱分開記
    total += 1;
    // 沒通過的檢查印出細節
    if (!passed) failures.push(name);
    process.stdout.write(`${passed ? "通過" : "失敗"} ${name}${passed || !detail ? "" : `：${detail}`}\n`);
  };
  // 兩種寬度依序執行，共用同一個 Chrome
  try {
    const sets = pickSets();
    // 寬螢幕之後是手機
    for (const width of WIDTHS) await walk(browser, width, sets, check);
    check("整個流程沒有錯誤訊息", browser.errors.length === 0, browser.errors.slice(0, 3).join("｜"));
  } finally {
    // 不論通過與否都關掉伺服器與 Chrome
    browser.close();
  }
  process.stdout.write(`command=test:browser checks=${total} failed=${failures.length}\n`);
  // 有一項沒通過時結束代碼是 1
  return failures.length ? 1 : 0;
}

// 結束代碼交給呼叫端判斷，伺服器與 Chrome 在結束時關掉
process.exit(await main());
