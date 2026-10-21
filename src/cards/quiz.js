/* ==================================================
 * cards/quiz.js - 作答卡片
 * --------------------------------------------------
 * - 角色：一題一頁的作答：議題圖示、題目、說明、五級量尺或單選題的選項與略過、追問標示、題號導覽、遮蔽後的原文。作答進度由頁首顯示。題目上方的標示、說明、中間的按鈕與 info 依題組的種類取自 QUIZ_PARTS
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：
 *   - 題號依目前的作答路徑編號，追問題出現後題號跟著調整，導覽與題目面板用同一份路徑
 *   - 作答時不顯示任何候選人姓名與黨名，原文經遮蔽
 *   - 最後一題的下一步在每一題都作答或略過後才是看結果，還有未答題時前往第一題未答的題目
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { clamp } from "../lib/format.js";
import { issueOf } from "../metrics/index.js";
import { t, pct, num, step, info, constants, dataSources, noticeWithAction, facetPath, listText, axisEffects } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 各種題組在作答卡上不同的部分，鍵是模型的 kind。
 * - header(context, question)：題目上方的標示，沒有時為 null
 * - body(context, question)：題目區塊的說明：note 是題幹下方置中的短句，excerpt 是靠左的原文節錄
 * - center(item)：題號導覽中間的按鈕
 * - info(context, item, question, parent)：info 的代入步驟與設定值
 */
const QUIZ_PARTS = {
  election: {
    header: (context, question) => ({
      type: "topic",
      key: `topic:${question.id}`,
      icon: issueOf(context.model.taxonomy, question.facet),
      text: facetPath(context, question.facet),
      // 自訂題庫的題目要標示，避免讓人誤認為官方資料
      badge: question.custom ? { label: t("quiz.custom"), tone: "warning" } : null,
    }),
    // 選舉的說明是短句，經遮蔽後放在題幹下方
    body: (context, question) => ({ note: context.mask(question.note) }),
    center: (item) => ({ label: t("quiz.sources"), icon: "message", action: `openQuestion:${item.id}` }),
    info: (context, item, question, parent) => ({
      steps: [
        step(t("quiz.stepWeight"), pct(context.results()?.weights.get(item.id), 1), t("quiz.weightFormula")),
        // 追問題要說明出現的前提條件，根題沒有前提
        step(t("quiz.stepBudget"), num(question.budget_share), parent ? t("quiz.childRule", { conditions: listText(question.conditions.map((code) => context.model.answers.get(code)?.name)) }) : t("quiz.rootRule")),
        step(t("quiz.stepNeutral"), t("quiz.neutralValue", { count: context.model.neutralityByQuestion.get(item.id)?.length ?? 0 })),
      ],
      constants: ["importance.default", "flow.skipAnswer"],
    }),
  },
  topic: {
    // 主題測驗的題目沒有議題分類
    header: () => null,
    // 主題測驗的說明是一手文件的節錄
    body: (context, question) => ({ excerpt: question.note }),
    center: (item) => ({ label: t("topic.explain"), icon: "info", action: `openQuestion:${item.id}` }),
    // 量尺題每條對應的軸一步：同意時往哪一極、權重多少。單選題不進軸，寫出選項數
    info: (context, item, question) => ({ steps: question.format === "choice" ? [step(t("topic.stepOptions"), String(question.choices.length), t("topic.choiceRule"))] : axisEffects(context.model, item.id).map((effect) => step(effect.axis, effect.text, t("topic.axisFormula"))), constants: ["flow.skipAnswer"] }),
  },
};

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 作答區塊：依題目的作答形式選用區塊，五級量尺是一排圓圈，單選題是一列一個選項。
 * @param {object} question 題目，choices 已依畫面順序排列。
 * @param {string|null} current 目前的作答代碼。
 * @returns {object} 區塊描述。
 */
function answerBlock(question, current) {
  return {
    type: question.format,
    key: `${question.format}:${question.id}`,
    label: t(`quiz.formats.${question.format}`),
    options: question.choices.map((choice) => ({ code: choice.code, label: choice.name, value: choice.value })),
    value: current,
    action: `answer:${question.id}`,
    skip: { label: t("quiz.skip"), icon: "skip", action: `answer:${question.id}=${SETTINGS.flow.skipAnswer}`, selected: current === SETTINGS.flow.skipAnswer },
  };
}

/**
 * 作答頁的下一步按鈕。
 * @param {number} index 目前題目的序號。
 * @param {boolean} last 是否為最後一題。
 * @param {number} firstOpen 第一題未答的序號，每一題都有紀錄時為 -1。
 * @param {string|null} current 目前題目的作答代碼，未答為 null。
 * @returns {{ label: string, icon: string, trailing: boolean, action: string, tone: string, disabled?: boolean }}
 */
function nextButton(index, last, firstOpen, current) {
  // 不是最後一題時前往下一題，本題已作答時用強調色提示可以繼續
  if (!last) return { label: t("quiz.next"), icon: "arrowRight", trailing: true, action: `quizGo:${index + 1}`, tone: current ? "accent" : "neutral" };
  // 最後一題在每一題都有紀錄時前往結果
  if (firstOpen < 0) return { label: t("quiz.finish"), icon: "chart", trailing: true, action: "route:result", tone: "accent" };
  // 只剩這一題未答時看結果的按鈕先停用，作答或略過後就開放
  if (firstOpen === index) return { label: t("quiz.finish"), icon: "chart", trailing: true, action: "route:result", tone: "accent", disabled: true };
  // 前面還有未答題時前往第一題未答的題目
  return { label: t("quiz.toOpen"), icon: "arrowRight", trailing: true, action: `quizGo:${firstOpen}`, tone: "accent" };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 作答卡片。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function quizQuestion(context) {
  const { visible } = context.questions();
  // 重視度全部設為 0 時沒有題目
  if (!visible.length) return { blocks: noticeWithAction(t("quiz.none"), { label: t("quiz.backWeights"), icon: "arrowLeft", action: "route:weights" }), info: info({ sources: dataSources(context), constants: constants(context.settings, ["importance.default"]) }) };
  const index = clamp(context.state.view.quizIndex, 0, visible.length - 1);
  const item = visible[index];
  // 完整題目內容查題庫，visible 只帶題號與母題關係
  const question = context.model.questions.get(item.id);
  const parts = QUIZ_PARTS[context.model.kind];
  // 本題的作答代碼，未答為 null
  const current = context.state.answers[item.id]?.answer ?? null;
  const last = index === visible.length - 1;
  // 已答題數含略過，題目面板與最後一題的下一步都以作答紀錄為準
  const { firstOpen } = context.progress();
  // 只有追問題有母題，畫面要標示它依據哪一題
  const parent = item.parent ? context.model.questions.get(item.parent) : null;
  const details = parts.info(context, item, question, parent);
  // 題目面板每一格對應一題，點格子跳到那一題
  const panel = visible.map((entry, i) => {
    const code = context.state.answers[entry.id]?.answer;
    // 題目面板以狀態區分已答、略過與未答
    const status = !code ? "open" : code === SETTINGS.flow.skipAnswer ? "skipped" : "answered";
    return { label: String(i + 1), action: `quizGo:${i}`, selected: i === index, status, tip: t(`quiz.status.${status}`) };
  });
  return {
    blocks: [
      // 題目、議題標示與作答區塊以題號當 key，換題時元素整個替換，焦點與按鈕狀態不會帶到下一題
      // 第一列是題號，與說明鈕同列
      { type: "text", text: t("quiz.number", { n: index + 1, total: visible.length }), tone: "muted" },
      parts.header(context, question),
      // 追問題標示依據的母題
      { type: "question", key: `question:${item.id}`, followUp: parent ? t("quiz.followUp", { stem: context.mask(parent.stem) }) : null, stem: context.mask(question.stem), ...parts.body(context, question) },
      answerBlock(question, current),
      {
        type: "pager",
        // 第一題沒有上一題，不顯示上一題按鈕
        prev: index > 0 ? { label: t("quiz.prev"), icon: "arrowLeft", action: `quizGo:${index - 1}` } : null,
        center: parts.center(item),
        next: nextButton(index, last, firstOpen, current),
        label: t("quiz.number", { n: index + 1, total: visible.length }),
      },
      { type: "numbers", label: t("quiz.panel"), items: panel },
    ],
    info: info({ steps: details.steps, sources: dataSources(context), constants: constants(context.settings, details.constants) }),
    // 數字鍵依序對應這一題的選項：量尺的 1 是最左邊的一個，單選題依選項的排列順序
    digits: question.choices.map((choice) => `answer:${item.id}=${choice.code}`),
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const QUIZ_CARDS = {
  "quiz.question": { build: quizQuestion },
};

export { QUIZ_CARDS };
