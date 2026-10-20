/* ==================================================
 * cards/help.js - FAQ 與更新紀錄
 * --------------------------------------------------
 * - 角色：常見問題與更新紀錄頁的卡片，內容寫在 locale，資料版本取自題組索引
 * - 指令：由 cards/index.js 登錄，不直接匯入
 * - 慣例：更新紀錄同時列出程式的變更與各題組目前的資料版本
 * ================================================== */

import { shortHash } from "../lib/format.js";
import { t, info, step } from "./kit.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 版本表「政見資料」一欄依題組的種類寫，鍵是索引的 kind：選舉分有政見資料與尚無資料，主題測驗寫種類名稱。
 */
const SET_STATUS = {
  election: (item) => t(item.manifest.has_policy_data ? "election.hasPolicy" : "election.noPolicy"),
  topic: () => t("choose.topic.title"),
};

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 常見問題。
 * @returns {import("./kit.js").CardOutput}
 */
function faqList() {
  return { blocks: [{ type: "faq", items: t("faq.items") }], info: info({ steps: [step(t("faq.stepCount"), String(t("faq.items").length))], sources: [t("sources.locale")] }) };
}

/**
 * 更新紀錄與資料版本。
 * @param {object} context 卡片情境。
 * @returns {import("./kit.js").CardOutput}
 */
function changelogList(context) {
  // 每個題組一列，沒有詞表的題組（主題測驗）詞表欄寫缺
  const versions = context.data.index.sets.map((item) => ({
    cells: {
      label: item.label,
      version: item.manifest.data_version,
      vocab: item.manifest.vocab ? t("changelog.vocabValue", { version: item.manifest.vocab.version }) : t("common.missing"),
      policy: SET_STATUS[item.kind](item),
    },
  }));
  return {
    blocks: [
      { type: "timeline", items: t("changelog.items") },
      { type: "heading", text: t("changelog.versions"), level: 3 },
      { type: "table", columns: ["label", "version", "vocab", "policy"].map((key) => ({ key, label: t(`changelog.columns.${key}`) })), rows: versions, dense: true },
      { type: "keyValue", items: [{ label: t("changelog.appVersion"), value: context.data.build.version }, { label: t("changelog.engine"), value: shortHash(context.data.build.engine) }, { label: t("changelog.config"), value: shortHash(context.data.build.config) }] },
    ],
    info: info({ sources: [t("sources.roster"), t("sources.topics")] }),
  };
}

/* ==================================================
 * 匯出
 * ================================================== */

/**
 * 本模組的卡片。
 */
const HELP_CARDS = {
  "faq.list": { build: faqList },
  "changelog.list": { build: changelogList },
};

export { HELP_CARDS };
