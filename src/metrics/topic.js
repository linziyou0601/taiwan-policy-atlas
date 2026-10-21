/* ==================================================
 * metrics/topic.js - 主題測驗的計分
 * --------------------------------------------------
 * - 角色：主題測驗的作答路徑與結果：各軸位置、各軸落在哪一級、與每個參照點的距離，以及單選題選了哪一項
 * - 指令：import { topicQuestions, computeTopic, bandOf } from "../metrics/topic.js"
 * - 慣例：
 *   - 軸位置與選舉的意識形態軸用同一條公式，題目全部出現，沒有追問與選區
 *   - 各級由資料集的 bands 由高到低比對，第一個符合的就是這一級
 *   - 參照點依距離由近到遠排列，距離策略由資料集的 distance 宣告，登錄在 registry 的 distance 類。距離最小的不只一個時全部列為並列
 *   - 單選題不進軸，結果只記選了哪一項
 * ================================================== */

import { hasValue } from "../lib/objects.js";
import { resolve } from "../registry/index.js";
import { isStated } from "./flow.js";
import { axisPositions } from "./ideology.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 兩個距離相差小於這個值時視為相同，次方運算的浮點誤差不影響並列的判斷。
 */
const TIE_TOLERANCE = 1e-9;

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} TopicResults 主題測驗的結果。
 * @property {{ id: string, depth: number, parent: null }[]} items 題目，順序同資料集。
 * @property {string[]} questionIds 題目代碼。
 * @property {{ axes: object[], user: Map<string, number|null>, used: Map<string, string[]> }} ideology 使用者在各軸的位置與用到的題目。
 * @property {Map<string, object|null>} bands 各軸所在的一級，軸沒有位置時為 null。
 * @property {{ id: string, name: string, original: string|null, position: Record<string, number>, distance: number|null }[]} references 參照點，依距離由近到遠，本站命名的參照點沒有原文名稱。
 * @property {object|null} closest 最接近的參照點，沒有任何軸有位置或沒有參照點時為 null。
 * @property {object[]} tied 與 closest 距離相同的參照點，含 closest 本身，沒有 closest 時是空陣列。
 * @property {{ question: object, choice: object|null }[]} choices 單選題與選了哪一項，未作答或略過時 choice 為 null。
 * @property {number} answeredCount 表達了立場的題數，略過不算。
 */

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 主題測驗的題目：全部依資料集的順序出現。
 * @param {object} model 主題測驗的模型。
 * @returns {{ all: object[], visible: { id: string, depth: number, parent: null }[] }}
 */
function topicQuestions(model) {
  const all = model.questionOrder.map((id) => model.questions.get(id));
  return { all, visible: all.map((question) => ({ id: question.id, depth: 0, parent: null })) };
}

/**
 * 找出軸位置落在哪一級。
 * @param {{ bands: { min: number, inclusive: boolean, label: string }[] }} axis 軸，bands 由高到低。
 * @param {number|null} value 位置。
 * @returns {object|null} 沒有位置或低於全部門檻時為 null。
 */
function bandOf(axis, value) {
  // 沒有位置就沒有級別
  if (!hasValue(value)) return null;
  return axis.bands.find((band) => value > band.min || (band.inclusive && value === band.min)) ?? null;
}

/**
 * 計算主題測驗的結果。
 * @param {object} model 主題測驗的模型。
 * @param {object} state 狀態，取 answers。
 * @returns {TopicResults}
 */
function computeTopic(model, state) {
  const { visible } = topicQuestions(model);
  const questionIds = visible.map((item) => item.id);
  // 沒有比較對象，立場矩陣是空的，只算使用者的位置
  const ideology = axisPositions({ model, questionIds, answers: state.answers, stances: new Map() });
  const distance = resolve("distance", model.set.distance).run;
  // 每個參照點算一次距離，近的在前，沒有距離的排在最後
  const references = model.references
    .map((reference) => ({ ...reference, distance: distance(ideology.user, reference.position, model.axes) }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  // 第一筆沒有距離表示全部軸都沒有位置，沒有最接近的參照點
  const closest = references[0] && references[0].distance !== null ? references[0] : null;
  // 單選題依題目順序列出選了哪一項
  const choiceQuestions = questionIds.map((id) => model.questions.get(id)).filter((question) => question.format === "choice");
  return {
    items: visible,
    questionIds,
    ideology,
    bands: new Map(model.axes.map((axis) => [axis.code, bandOf(axis, ideology.user.get(axis.code))])),
    references,
    closest,
    // 距離與最接近者相同的參照點並列
    tied: closest ? references.filter((reference) => reference.distance !== null && reference.distance - closest.distance < TIE_TOLERANCE) : [],
    // 略過或未作答的單選題沒有選擇
    choices: choiceQuestions.map((question) => ({ question, choice: isStated(state.answers[question.id]) ? (question.choices.find((choice) => choice.code === state.answers[question.id].answer) ?? null) : null })),
    answeredCount: questionIds.filter((id) => isStated(state.answers[id])).length,
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

export { topicQuestions, computeTopic, bandOf };
