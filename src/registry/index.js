/* ==================================================
 * registry/index.js - 具名策略的登錄表
 * --------------------------------------------------
 * - 角色：公式、契合度、立場彙總、共識判定、參照點距離與匯入解析都以名稱登錄，設定檔或資料集宣告使用哪一個，換策略只改設定
 * - 指令：import { resolve, entries } from "../registry/index.js"
 * - 慣例：
 *   - 每筆登錄有 name、kind 與 run，說明文案以 registry.{kind}.{name} 查 locale
 *   - 設定引用了未登錄的名稱時 resolve 拋出錯誤，列出可用的名稱
 *   - run 的回傳依類別而定：公式回傳總分與代入步驟（info 依步驟顯示公式與代入值），契合度、立場彙總與距離回傳數字，共識判定回傳布林值，解析器回傳解析結果與問題清單
 * ================================================== */

import { FORMULAS } from "./formulas.js";
import { AGREEMENTS, AGGREGATES, CONSENSUS_RULES } from "./rules.js";
import { PARSERS } from "./parsers.js";
import { DISTANCES } from "./distances.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} Entry 一筆登錄。
 * @property {string} name 名稱，設定檔以它引用。
 * @property {string} kind 類別：formula、agreement、aggregate、consensus、distance 或 parser，與 REGISTRIES 的鍵相同。
 * @property {Function} run 實作，回傳值依類別而定。
 */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 各類登錄表，鍵是類別名稱。每張表以名稱對應實作函式，設定檔以名稱引用。
 */
const REGISTRIES = {
  formula: FORMULAS,
  agreement: AGREEMENTS,
  aggregate: AGGREGATES,
  consensus: CONSENSUS_RULES,
  distance: DISTANCES,
  parser: PARSERS,
};

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 依類別與名稱取得登錄的實作。
 * @param {string} kind 類別，REGISTRIES 的鍵。
 * @param {string} name 名稱。
 * @returns {Entry}
 */
function resolve(kind, name) {
  const table = REGISTRIES[kind];
  // 類別不存在是程式錯誤
  if (!table) throw new Error(`沒有 ${kind} 類的登錄表`);
  const run = table[name];
  // 設定引用了未登錄的名稱，列出可用的名稱方便修正
  if (!run) throw new Error(`${kind} 沒有登錄 ${name}，可用：${Object.keys(table).join("、")}`);
  return { name, kind, run };
}

/**
 * 列出一個類別的全部登錄，方法頁以它顯示可選的策略。
 * @param {string} kind 類別。
 * @returns {Entry[]}
 */
function entries(kind) {
  return Object.entries(REGISTRIES[kind] ?? {}).map(([name, run]) => ({ name, kind, run }));
}

/* ==================================================
 * 匯出
 * ================================================== */

export { resolve, entries };
