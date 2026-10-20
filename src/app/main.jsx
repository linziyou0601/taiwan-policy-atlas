/* ==================================================
 * app/main.jsx - 網站進入點
 * --------------------------------------------------
 * - 角色：開機、核對建置版本、讀寫 localStorage、依路由組頁、以 Preact 繪製畫面、執行動作與效果（下載、選擇檔案、確認、視窗、分享、複製）
 * - 指令：由 scripts/build.mjs 以 esbuild 打包成 web/app.js
 * - 慣例：
 *   - 狀態與畫面上的暫時內容（視窗、提示、hover 說明）都記在 RUNTIME，任何一項改變就以 Preact 重新繪製，只更新有變的元素
 *   - 頁面與覆蓋層繪製在 #app，hover 說明另外繪製在 body 下的 #tooltip，移動滑鼠時不必重新繪製整頁
 *   - 程式的引擎與設定雜湊在建置時寫入（__BUILD__），與 build.json 不符時顯示擋板，避免舊程式讀新資料
 *   - 狀態寫在 localStorage。其他分頁改了狀態時，這裡讀回新狀態後重新繪製，寫入留給改動的分頁，兩個分頁才不會互相覆蓋
 *   - 任何未預期的錯誤都以擋板顯示，附重新載入鈕
 * ================================================== */

import { SETTINGS, LAYOUT, text } from "../config/index.js";
import { readStore, writeStore } from "../lib/storage.js";
import { buildPage, buildGate, dispatch, enterPage, normalizeState, DEFAULT_STATE, ensureData, reconcile, createContext, buildModal, encodeShare, decodeShare, mismatchMessage, shareImageSpec } from "../cards/index.js";
import { render } from "preact";
import { Page, Modal, Gate, Toast, Tooltip, Loading, drawShareImage } from "../blocks/index.js";
import { currentRoute, routeHash, shareUrl } from "./router.js";
import { bindEvents } from "./events.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 建置時寫入的引擎與設定雜湊，由 esbuild 的 define 代入。
 */
const BUILD = __BUILD__;

/**
 * 提示訊息顯示的時間（毫秒）。
 */
const TOAST_MS = 3200;

/**
 * 目前的狀態與畫面上的暫時內容。
 * - modal：開著的視窗，`{ key, spec }`，spec 由 cards 層的 buildModal 組成，key 每開一次加一
 * - toast：提示內容
 * - tip：hover 說明的文字與位置
 * - page、context：最近一次組成的頁面與脈絡，info 與視窗的動作要用它
 * - shown：最近一次繪製的頁面代碼，切換頁面時捲回頂端，進入作答頁時判斷是否從其他頁進來
 * - opened：已開過的視窗數，當作視窗的 key
 * - shareImage：預覽中的分享圖片，`{ blob, filename, url }`，視窗關閉時釋放
 */
const RUNTIME = { state: null, modal: null, toast: null, tip: null, page: null, context: null, shown: null, opened: 0, shareImage: null };

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 根節點。
 * @returns {HTMLElement}
 */
function root() {
  return document.getElementById("app");
}

/**
 * hover 說明的根節點放在 body 的最後，卡片的 overflow 裁切不到它。
 * @returns {HTMLElement}
 */
function tipRoot() {
  // 第一次使用時建立，之後沿用同一個
  let node = document.getElementById("tooltip");
  // 尚未建立時加到 body 最後
  if (!node) {
    node = document.createElement("div");
    // 固定的 id 讓之後的呼叫找得到同一個節點
    node.id = "tooltip";
    document.body.appendChild(node);
  }
  return node;
}

/**
 * 整個畫面：頁面加上覆蓋層，覆蓋層依序放視窗與提示。
 * @param {{ page: object, modal: object|null, toast: object|null }} props page 是 buildPage 的結果，modal 與 toast 見 RUNTIME。
 * @returns {JSX.Element}
 */
function Screen({ page, modal, toast }) {
  // 視窗內容都由卡片層組成，key 讓每次開的視窗重新掛載並取得焦點
  return (
    <>
      <Page spec={page} />
      <div id="overlay">
        {modal ? <Modal key={modal.key} spec={modal.spec} /> : null}
        {toast ? <Toast spec={toast} /> : null}
      </div>
    </>
  );
}

/**
 * 依 RUNTIME 繪製整個畫面，Preact 只更新與上一次不同的元素。
 */
function paint() {
  render(<Screen page={RUNTIME.page} modal={RUNTIME.modal} toast={RUNTIME.toast} />, root());
}

/**
 * 開一個視窗：內容或卡片擇一。
 * @param {{ title: string, blocks: object[] }} spec 視窗內容，由 buildModal 組成。
 */
function openModal(spec) {
  // 每開一次換一個 key，同一種視窗連開兩次也會重新掛載
  RUNTIME.opened += 1;
  RUNTIME.modal = { key: RUNTIME.opened, spec };
  paint();
}

/**
 * 更新 hover 說明，兩次都沒有說明時不重新繪製。
 * @param {{ text: string, rect: DOMRect }|null} tip 說明與目標位置。
 */
function showTip(tip) {
  // 連續移過沒有說明的元素時，畫面上本來就沒有說明
  if (!tip && !RUNTIME.tip) return;
  RUNTIME.tip = tip;
  render(<Tooltip tip={tip} />, tipRoot());
}

/**
 * 依狀態設定主題與縮放屬性。
 * @param {object} state 狀態。
 */
function applyDisplay(state) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  // 系統主題依作業系統，其餘依使用者選擇
  const theme = state.theme === "system" ? (dark ? "dark" : "light") : state.theme;
  document.documentElement.dataset.theme = theme;
  // 縮放倍數取自 settings 的 display.zooms，只縮放版面，root 字級維持 16 px
  const zoom = String(SETTINGS.display.zooms[state.zoom] ?? 1);
  document.body.style.zoom = zoom;
  // 以視窗高度為準的尺寸（例如視窗最高 90%）會跟著縮放，元件以 `--zoom` 換算回畫面上的比例
  document.body.style.setProperty("--zoom", zoom);
}

/**
 * 寫入狀態並記住，寫入失敗時提示。
 * @param {object} state 新狀態。
 */
function saveState(state) {
  RUNTIME.state = state;
  // 看別人分享的結果時，狀態只留在記憶體，localStorage 裡自己的作答保持原樣
  if (state.shared) return;
  // 停用儲存時網站照常運作，狀態留在這次開啟的頁面，重新整理後回到預設
  if (!writeStore(SETTINGS.storage.key, state)) showToast({ message: text("common.storageFailed"), tone: "critical" });
}

/**
 * 顯示提示訊息。
 * @param {{ message: string, tone?: string }} toast 內容。
 */
function showToast(toast) {
  // 先記下這則提示，計時結束時才能判斷畫面上的還是不是同一則
  RUNTIME.toast = toast;
  // 頁面還沒組成時（例如開機套用分享連結），提示等第一次畫面時一起繪製
  if (RUNTIME.page) paint();
  setTimeout(() => {
    // 期間沒有新的提示時才清除
    if (RUNTIME.toast === toast) {
      RUNTIME.toast = null;
      paint();
    }
  }, TOAST_MS);
}

/**
 * 下載文字或二進位內容。
 * @param {string} filename 檔名。
 * @param {Blob|string} content 內容。
 * @param {string} [mime] MIME 類型。
 */
function download(filename, content, mime = "application/octet-stream") {
  // 傳入 Blob 時直接使用，文字內容補上 charset 才不會在開啟時出現亂碼
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  // 以一個不加入頁面的暫時連結觸發瀏覽器下載
  link.href = url;
  link.download = filename;
  link.click();
  // 延後到下一輪才釋放網址，確保瀏覽器已開始讀取內容
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 釋放分享圖片預覽的暫時網址，視窗關閉或換一張圖時使用。
 */
function releaseShareImage() {
  // 沒有預覽中的圖片時不必處理
  if (!RUNTIME.shareImage) return;
  URL.revokeObjectURL(RUNTIME.shareImage.url);
  RUNTIME.shareImage = null;
}

/**
 * 讓使用者選一個檔案並讀成文字。
 * @param {string} accept 接受的副檔名。
 * @returns {Promise<{ name: string, text: string }|null>} 取消時為 null。
 */
function pickFile(accept) {
  return new Promise((resolve) => {
    // 上一次留下的選擇檔案輸入框先移除，頁面上同時只有一個
    document.getElementById("file-picker")?.remove();
    // 選擇檔案的輸入框只接受呼叫端指定的副檔名
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    // 固定的 id 讓下一次選擇檔案前能找到並移除這一個
    input.id = "file-picker";
    // 選擇檔案的輸入框要加入頁面，Safari 與自動化測試才會開啟選擇檔案視窗，以 hidden 隱藏
    input.hidden = true;
    document.body.appendChild(input);
    // 使用者選好檔案後才讀內容，讀完移除輸入框，交給呼叫端處理
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      // 沒有選擇檔案時視為取消
      resolve(file ? { name: file.name, text: await file.text() } : null);
    });
    input.click();
  });
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依目前路由與狀態重組頁面並繪製。輸入框沿用同一個元素，焦點與游標不受影響。
 * @returns {Promise<void>}
 */
async function refresh() {
  const { page } = currentRoute();
  // 先載入這個頁面需要的資料，缺資料時頁面無從組起
  await ensureData(RUNTIME.state, page);
  const reconciled = reconcile(RUNTIME.state);
  // 修正過的狀態要寫回，例如題意改變的答案移到封存
  if (reconciled !== RUNTIME.state) saveState(reconciled);
  // 切換頁面的作答規則：從其他頁進入作答頁時，放棄上次作答到一半的作答
  const entered = enterPage(RUNTIME.state, RUNTIME.shown, page, createContext(RUNTIME.state, page));
  // 規則改了狀態時寫回
  if (entered !== RUNTIME.state) saveState(entered);
  // 以最後的狀態組成這一頁
  const context = createContext(RUNTIME.state, page);
  const spec = buildPage(context);
  // 記下最近一次的頁面與脈絡，info 與視窗的動作要用它
  RUNTIME.page = spec;
  RUNTIME.context = context;
  // 換到另一頁時關閉開著的視窗，例如開著視窗按瀏覽器的上一頁，視窗不會蓋在新頁面上
  if (RUNTIME.shown !== null && RUNTIME.shown !== page) {
    RUNTIME.modal = null;
    releaseShareImage();
  }
  // 主題與縮放寫在 html 元素上，繪製頁面前先套用
  applyDisplay(RUNTIME.state);
  paint();
  // 換到另一頁時捲回頂端，同一頁內的更新維持捲動位置
  if (RUNTIME.shown !== page) window.scrollTo(0, 0);
  RUNTIME.shown = page;
}

/**
 * 數字鍵：執行頁面描述 digits 的第 n 個動作，作答頁以它選量尺或單選題的選項。
 * @param {number} n 數字鍵，由 1 起算。
 * @returns {Promise<void>}
 */
async function pressDigit(n) {
  // 視窗開著時數字鍵不作答，避免改到視窗後面的題目而使用者看不到
  if (RUNTIME.modal) return;
  const action = RUNTIME.page.digits?.[n - 1];
  // 這一頁沒有對應這個數字的動作時不做事
  if (action) await perform(action);
}

/**
 * 前往一個頁面。切換頁面時改 hash，由 hashchange 重新繪製，已在這一頁時直接重新繪製。
 * @param {string} route 頁面代碼。
 * @returns {Promise<void>}
 */
async function goTo(route) {
  // 切換頁面時先關閉視窗，新頁面不帶著舊頁面的視窗
  if (routeHash(route) !== location.hash) {
    RUNTIME.modal = null;
    location.hash = routeHash(route);
    return;
  }
  // 已在這一頁時 hash 不變，不會觸發 hashchange，直接重新繪製
  await refresh();
}

/**
 * 執行一個動作字串，例如「answer:q.x=agree」。
 * @param {string} actionString 動作字串。
 * @param {unknown} [payload] 非字串的參數，例如讀入的檔案。
 * @returns {Promise<void>}
 */
async function perform(actionString, payload) {
  const index = actionString.indexOf(":");
  // 沒有冒號時整個字串就是動作名稱，沒有參數
  const name = index < 0 ? actionString : actionString.slice(0, index);
  // 檔案之類的非字串參數優先，否則取冒號後面的字串
  const arg = payload ?? (index < 0 ? "" : actionString.slice(index + 1));
  // 動作本身是純函式，只回傳新狀態與要執行的路由或效果
  const result = dispatch(name, arg, RUNTIME.state, RUNTIME.context);
  const changed = result.state !== RUNTIME.state;
  // 狀態有變時寫入
  if (changed) saveState(result.state);
  // 有路由時前往，沒有路由但狀態改變時重新繪製這一頁
  if (result.route) await goTo(result.route);
  else if (changed) await refresh();
  // 有效果時執行
  if (result.effect) await runEffect(result.effect);
}

/**
 * 效果登錄表：動作回傳的效果種類對應的處理。處理函式收效果與目前的卡片情境，需要畫面時開視窗或重新繪製。
 */
const EFFECTS = {
  /** 確認視窗：確定時執行接續的動作。 */
  confirm: (effect, context) => openModal(buildModal(context, "confirm", effect)),
  /** 確認視窗的確定鈕：關閉視窗後執行等待確認的動作。 */
  confirmed: async (effect) => {
    RUNTIME.modal = null;
    await perform(effect.then);
  },
  /** 視窗內容由卡片層依種類組成。 */
  modal: (effect, context) => openModal(buildModal(context, effect.kind, effect.arg)),
  /** 開啟一張卡片的 info，卡片沒有 info 時不開。 */
  info: (effect, context) => {
    const card = [RUNTIME.page.sticky, ...RUNTIME.page.cards].find((item) => item?.id === effect.card);
    // 卡片有 info 時才開
    if (card?.info) openModal(buildModal(context, "info", card));
  },
  /** 切換分區後從頂端看起。 */
  scrollTop: () => window.scrollTo(0, 0),
  /** 關閉視窗並釋放分享圖片的暫時網址。 */
  closeModal: () => {
    // 沒有開著的視窗時直接結束，例如在沒有視窗時按 Esc
    if (!RUNTIME.modal) return;
    RUNTIME.modal = null;
    releaseShareImage();
    // 清除視窗後重新繪製，覆蓋層就會消失
    paint();
  },
  /** 下載檔案。 */
  download: (effect) => download(effect.filename, effect.content, effect.mime),
  /** 選擇檔案後交給接續的動作。 */
  pickFile: async (effect) => {
    const file = await pickFile(effect.accept);
    // 使用者取消選擇檔案時不做事
    if (file) await perform(effect.then, file);
  },
  /** 產生分享連結並開啟分享視窗。 */
  share: async (effect, context) => {
    const encoded = await encodeShare(context);
    // 太長時沒有連結，視窗改提示匯出
    const url = encoded.packed ? shareUrl(encoded.packed) : null;
    openModal(buildModal(context, "share", { url, bytes: encoded.bytes }));
  },
  /** 繪製分享圖片並開啟預覽。 */
  shareImage: async (effect, context) => {
    const spec = shareImageSpec(context);
    const blob = await drawShareImage(spec);
    // 上一張預覽的暫時網址先釋放，再開這一張的預覽
    releaseShareImage();
    RUNTIME.shareImage = { blob, filename: spec.filename, url: URL.createObjectURL(blob) };
    openModal(buildModal(context, "shareImage", RUNTIME.shareImage.url));
  },
  /** 下載預覽中的分享圖片。 */
  saveShareImage: () => {
    // 預覽視窗開著時才有圖片可存
    if (RUNTIME.shareImage) download(RUNTIME.shareImage.filename, RUNTIME.shareImage.blob);
  },
  /** 把預覽中的分享圖片複製到剪貼簿。 */
  copyShareImage: async () => {
    // 剪貼簿寫入圖片需要瀏覽器支援 ClipboardItem，不支援時提示改用下載
    try {
      await navigator.clipboard.write([new ClipboardItem({ [RUNTIME.shareImage.blob.type]: RUNTIME.shareImage.blob })]);
      showToast({ message: text("shareImage.copied") });
    } catch {
      // 複製失敗時要讓使用者知道，改用下載
      showToast({ message: text("shareImage.copyFailed"), tone: "critical" });
    }
  },
  /** 複製文字到剪貼簿。 */
  copy: async (effect) => {
    // 剪貼簿不可用時提示手動複製
    try {
      await navigator.clipboard.writeText(effect.text);
      showToast({ message: text("common.copied") });
    } catch {
      // 複製失敗時不能靜默，要讓使用者知道改用手動複製
      showToast({ message: text("common.copyFailed"), tone: "critical" });
    }
  },
  /** 顯示提示，訊息與語氣由動作層指定。 */
  toast: (effect) => showToast({ message: effect.message, tone: effect.tone }),
  /** 重新載入整頁。 */
  reload: () => location.reload(),
  /** 離開別人分享的結果：捨棄記憶體裡的分享狀態，重新讀取本機的狀態後前往指定的頁面。 */
  exitShared: async (effect) => {
    RUNTIME.state = normalizeState(readStore(SETTINGS.storage.key));
    RUNTIME.modal = null;
    // 主題與縮放換回自己的偏好，再前往指定的頁面
    applyDisplay(RUNTIME.state);
    await goTo(effect.route);
  },
};

/**
 * 執行一個效果。
 * @param {object} effect 動作回傳的效果。
 * @returns {Promise<void>}
 */
async function runEffect(effect) {
  const handler = EFFECTS[effect.type];
  // 效果種類沒有登錄是程式錯誤，直接拋出
  if (!handler) throw new Error(`沒有登錄效果 ${effect.type}`);
  await handler(effect, RUNTIME.context);
}

/**
 * 讀取分享連結中的狀態，套用後前往結果頁。
 * @param {string} packed 網址參數。
 * @returns {Promise<void>}
 */
async function applyShare(packed) {
  const context = createContext(RUNTIME.state, LAYOUT.roles.result);
  let decoded;
  // 分享連結只帶答案與版本戳記，要用目前載入的資料才能解碼。連結損壞或格式不同時移除參數回到首頁，以提示說明，網站照常開啟
  try {
    decoded = await decodeShare(packed, context);
  } catch (error) {
    // 錯誤寫進主控台供除錯，畫面只顯示提示
    console.error(error);
    history.replaceState(null, "", routeHash(LAYOUT.defaultPage));
    showToast({ message: text("share.invalid"), tone: "critical" });
    return;
  }
  // 解碼成功時以分享的狀態進入觀看模式：從預設狀態起算，沿用自己的主題與縮放，一律翻牌。狀態只留在記憶體，localStorage 維持原樣
  const { state, mismatches } = decoded;
  RUNTIME.state = normalizeState({ ...DEFAULT_STATE, theme: RUNTIME.state.theme, zoom: RUNTIME.state.zoom, ...state, reveal: true, shared: true });
  history.replaceState(null, "", routeHash(LAYOUT.roles.result));
  // 版本不同時說明哪一項不同，仍以目前的資料開啟
  if (mismatches.length) showToast({ message: mismatchMessage(mismatches), tone: "critical" });
}

/**
 * 開機。
 * @returns {Promise<void>}
 */
async function boot() {
  render(<Loading />, root());
  RUNTIME.state = normalizeState(readStore(SETTINGS.storage.key));
  // 事件只在根節點委派一次，畫面更新替換元素也不必重綁
  bindEvents(root(), {
    action: (actionString) => perform(actionString).catch(fail),
    info: (card) => runEffect({ type: "info", card }).catch(fail),
    escape: () => runEffect({ type: "closeModal" }),
    tip: showTip,
    digit: (n) => pressDigit(n).catch(fail),
  });
  await ensureData(RUNTIME.state, currentRoute().page);
  const build = createContext(RUNTIME.state, LAYOUT.defaultPage).data.build;
  // 程式與建置清單不同時，表示瀏覽器快取了舊版程式或資料
  if (build.engine !== BUILD.engine || build.config !== BUILD.config) {
    render(<Gate spec={buildGate("stale", { app: BUILD.engine, build: build.engine })} />, root());
    return;
  }
  // 建置清單相符才往下走，以下是正常的開機流程
  const { share } = currentRoute();
  // 網址帶分享參數時先套用
  if (share) await applyShare(share);
  await refresh();
  // 切換頁面時重新繪製。已開著網站時貼上分享連結只會改 hash，同樣要先套用分享的狀態
  window.addEventListener("hashchange", () => {
    const { share: shared } = currentRoute();
    // 有分享參數時先套用再重新繪製，沒有時直接重新繪製
    (shared ? applyShare(shared).then(() => refresh()) : refresh()).catch(fail);
  });
  // 其他分頁改了狀態時重讀並重新繪製，不回寫
  window.addEventListener("storage", (event) => {
    // 只處理本站的鍵。看別人分享的結果時不替換畫面上的分享狀態，回到自己的作答時再讀
    if (event.key !== SETTINGS.storage.key || RUNTIME.state.shared) return;
    RUNTIME.state = normalizeState(readStore(SETTINGS.storage.key));
    refresh().catch(fail);
  });
  // 作業系統切換深淺色時，系統主題跟著換
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyDisplay(RUNTIME.state));
}

/**
 * 顯示錯誤擋板。
 * @param {Error} error 錯誤。
 */
function fail(error) {
  console.error(error);
  // 擋板的文字由卡片層依錯誤組成
  render(<Gate spec={buildGate("error", error)} />, root());
}

boot().catch(fail);
