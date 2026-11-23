/* ==================================================
 * data/load.js - 載入建置產物與資料集
 * --------------------------------------------------
 * - 角色：讀取建置清單、題組索引、設定表、地圖、各題組的資料集與選舉的選區檔，核對格式名稱與版本。題組是一場選舉或一套主題測驗，索引的每一筆以 kind 標示種類
 * - 指令：由 data/index.js 匯出，上一層 `import { loadBuild, loadIndex, loadTables, loadDataset, loadScope, withScope, loadMap, loadVillages } from "../data/index.js"`
 * - 慣例：
 *   - 只讀索引宣告的路徑，資料集、選區檔與影像的位置都要出現在索引或資料集的 manifest，不接受任意路徑
 *   - 選舉的資料集分成總檔與選區檔，選定選區後以 withScope 合成那個選區的資料集
 *   - 讀取失敗以 DataError 回報，code 對應 locale 的 errors.{code}，畫面依它顯示原因
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { hasFormat } from "../lib/stamp.js";
import { parseTables } from "./tables.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * 資料讀取錯誤。code 是 locale 的錯誤代碼，detail 是出錯的路徑或值。
 */
class DataError extends Error {
  /**
   * @param {string} code 錯誤代碼。
   * @param {string} [detail] 補充說明。
   */
  constructor(code, detail = "") {
    super(`${code}${detail ? `：${detail}` : ""}`);
    this.code = code;
    // 補充說明單獨放在 detail，畫面以代碼查文案，技術細節另外列出
    this.detail = detail;
  }
}

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 各種題組的資料集格式，鍵是索引的 kind，值是 settings.formats 的鍵。
 */
const DATASET_FORMATS = {
  election: "dataset",
  topic: "topic",
};

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 讀取一個路徑，回傳文字。
 * @param {string} path 相對網站根目錄的路徑。
 * @returns {Promise<string>}
 */
async function fetchText(path) {
  let response;
  // 網路錯誤與 HTTP 錯誤都轉成 DataError
  try {
    response = await fetch(path, { cache: "no-cache" });
  } catch {
    // 連線層級的失敗還沒有回應可看，統一回報為網路錯誤並帶上出錯的路徑
    throw new DataError("network", path);
  }
  // 非 2xx 表示檔案缺席或伺服器錯誤
  if (!response.ok) throw new DataError("missing", path);
  return response.text();
}

/**
 * 讀取 JSON 並核對格式名稱與版本。每種產物都以 format 與 format_version 兩欄標示格式，資料集寫在 manifest 裡。
 * @param {string} path 路徑。
 * @param {{ name: string, version: number }} [format] 預期的格式，省略時不核對。
 * @param {(data: object) => object} [stampOf] 取出寫著格式欄位的那一層，預設是檔案本身。
 * @returns {Promise<object>}
 */
async function fetchJson(path, format, stampOf = (data) => data) {
  const textContent = await fetchText(path);
  let data;
  // JSON 損壞時視為產物不完整
  try {
    data = JSON.parse(textContent);
  } catch {
    // 解析失敗代表檔案只下載到一部分或格式錯誤，回報為產物損壞而不是網路問題
    throw new DataError("corrupt", path);
  }
  // 有預期格式時核對名稱與版本，舊格式的檔案不能用新程式讀
  if (format) {
    // 名稱或版本不同時拒絕讀取
    if (!hasFormat(stampOf(data), format)) throw new DataError("format", path);
  }
  return data;
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 讀取建置清單：引擎、設定與詞表的雜湊。
 * @returns {Promise<object>}
 */
function loadBuild() {
  return fetchJson(SETTINGS.paths.build, SETTINGS.formats.build);
}

/**
 * 讀取題組索引，並建立可讀路徑的白名單。
 * @returns {Promise<{ elections: object[], topics: object[], sets: object[], allowed: Set<string> }>} sets 是選舉與主題測驗依序合併的全部題組。
 */
async function loadIndex() {
  const index = await fetchJson(SETTINGS.paths.index, SETTINGS.formats.index);
  const sets = [...index.elections, ...index.topics];
  // 白名單之外的路徑一律不讀
  const allowed = new Set();
  // 每個題組的資料集、選區檔與影像路徑列入白名單
  for (const set of sets) {
    allowed.add(set.dataset);
    // 影像路徑寫在 manifest.assets
    for (const asset of set.manifest.assets) allowed.add(asset);
    // 選區檔路徑寫在選舉的 manifest.scope_files，主題測驗沒有選區
    for (const path of Object.values(set.manifest.scope_files ?? {})) allowed.add(path);
  }
  return { elections: index.elections, topics: index.topics, sets, allowed };
}

/**
 * 讀取全部設定表。
 * @returns {Promise<Record<string, object[]>>}
 */
async function loadTables() {
  const keys = Object.keys(SETTINGS.tables);
  const texts = await Promise.all(keys.map((key) => fetchText(`${SETTINGS.paths.tables}${SETTINGS.tables[key].file}`)));
  return parseTables(Object.fromEntries(keys.map((key, i) => [key, texts[i]])));
}

/**
 * 讀取一個題組的資料集，格式依題組的種類核對。
 * @param {object} set 索引中的一筆。
 * @param {Set<string>} allowed loadIndex 的白名單。
 * @returns {Promise<object>}
 */
async function loadDataset(set, allowed) {
  // 只讀索引宣告的路徑
  if (!allowed.has(set.dataset)) throw new DataError("notAllowed", set.dataset);
  const format = SETTINGS.formats[DATASET_FORMATS[set.kind]];
  // 索引寫了不認得的種類時沒有格式可以核對
  if (!format) throw new DataError("format", set.dataset);
  const dataset = await fetchJson(set.dataset, format, (data) => data.manifest);
  // 資料集的版本要與索引記載的相同，否則是建置時複製了不同批的檔案
  if (dataset.manifest.data_version !== set.manifest.data_version) throw new DataError("version", set.dataset);
  return dataset;
}

/**
 * 讀取一場選舉一個選區的選區檔。
 * @param {object} set 索引中的一筆選舉。
 * @param {string} scopeId 選區代碼。
 * @param {Set<string>} allowed loadIndex 的白名單。
 * @returns {Promise<object|null>} 沒有政見資料的選區沒有選區檔，回傳 null。
 */
async function loadScope(set, scopeId, allowed) {
  const path = set.manifest.scope_files[scopeId];
  // 選區沒有段落與主張時不寫選區檔
  if (!path) return null;
  // 只讀索引宣告的路徑
  if (!allowed.has(path)) throw new DataError("notAllowed", path);
  const part = await fetchJson(path, SETTINGS.formats.datasetScope, (data) => data.manifest);
  // 選區檔與總檔的版本要相同，否則是建置時複製了不同批的檔案
  if (part.manifest.data_version !== set.manifest.data_version) throw new DataError("version", path);
  return part;
}

/**
 * 把選區檔併入總檔，得到一個選區的資料集。總檔的選區層級鍵只有沒有所屬選區的內容，串列接上選區檔的列，dict 合併選區檔的鍵。
 * @param {object} dataset loadDataset 的選舉總檔。
 * @param {object|null} part loadScope 的結果，null 時回傳總檔。
 * @returns {object}
 */
function withScope(dataset, part) {
  // 沒有選區檔時總檔就是這個選區可用的全部資料
  if (!part) return dataset;
  const merged = { ...dataset };
  // manifest 以總檔為準，其餘每個鍵併入
  for (const [key, value] of Object.entries(part)) {
    // 選區檔的 manifest 只用於核對
    if (key === "manifest") continue;
    // 串列接上選區檔的列，dict 合併選區檔的鍵
    merged[key] = Array.isArray(value) ? [...dataset[key], ...value] : { ...dataset[key], ...value };
  }
  return merged;
}

/**
 * 讀取選區地圖。
 * @returns {Promise<object>}
 */
function loadMap() {
  return fetchJson(SETTINGS.paths.map, SETTINGS.formats.map);
}

/**
 * 讀取一個縣市的村里地圖，選區由它的村里合併。
 * @param {string} county 縣市代碼。
 * @returns {Promise<{ county: string, digits: number, arcs: number[][], villages: { code: string, town: string, name: string, rings: number[][] }[] }>}
 */
function loadVillages(county) {
  return fetchJson(SETTINGS.paths.villages.replace("{county}", county), SETTINGS.formats.villages);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { DataError, loadBuild, loadIndex, loadTables, loadDataset, loadScope, withScope, loadMap, loadVillages };
