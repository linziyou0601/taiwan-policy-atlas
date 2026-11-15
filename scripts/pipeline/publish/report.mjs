#!/usr/bin/env node
/* ==================================================
 * report.mjs - 發布階段的工具：區辨力報告
 * --------------------------------------------------
 * - 角色：以網站的資料層與計分層讀取已發布的選舉，寫出各選舉的共識題比例、隨機作答下第一名同分與差距很小的比例，以及各第 1 層議題的立場分布與分歧比例，收錄政見後判斷題組能不能分出候選人。判讀見 docs/pipeline/publish.md 的區辨力報告
 * - 指令：`npm run pipeline -- publish report [--users <人數>] [<選舉代碼> ...] > <報告>.md`，省略選舉代碼時涵蓋索引的全部選舉。管線的進入點以 node 執行本檔
 * - 手寫輸入：沒有。讀取 data/60-publish/ 的索引、資料集與選區檔
 * - 產物：標準輸出的 Markdown
 * - 慣例：
 *   - 只計有兩位以上參選人的選區，每個選區併入自己的選區檔後計分
 *   - 共識題與立場分布取自全部作答中立的結果，題目全部作答，子題依母題的答案出現，議題重視度用預設值
 *   - 隨機作答以 settings.robustness.seed 為種子，同一份資料每次產生相同的報告
 * ================================================== */
import { parseArgs } from "node:util";
import { installRepoFetch } from "../../common.mjs";
import { SETTINGS } from "../../../src/config/index.js";
import { percent } from "../../../src/lib/format.js";
import { formatStamp } from "../../../src/lib/stamp.js";
import { mulberry32 } from "../../../src/lib/stats.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 每個選區預設的隨機作答人數。
 */
const DEFAULT_USERS = 50;

/**
 * 第一、二名的總分差距小於這個值時算差距很小。
 */
const CLOSE_GAP = 0.01;

/**
 * 每場選舉列出共識題比例最高的選區數。
 */
const TOP_SCOPES = 5;

/**
 * 代替 build.json 的建置清單，格式戳記取自設定。
 */
const BUILD = { ...formatStamp(SETTINGS.formats.build), version: "dev" };

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 以百分比寫出比例，取到小數一位，分母為 0 時寫 -。
 * @param {number} part 分子。
 * @param {number} whole 分母。
 * @returns {string}
 */
function share(part, whole) {
  // 沒有分母時比例沒有意義
  return percent(whole ? part / whole : null, 1, "-");
}

/**
 * 回答選區內全部題目，子題在母題作答後出現。
 * @param {object} M 計分層模組。
 * @param {object} model 資料模型。
 * @param {string} scopeId 選區代碼。
 * @param {() => string} pick 決定每題答案的函式。
 * @returns {Record<string, { answer: string, hash: string }>}
 */
function answerScope(M, model, scopeId, pick) {
  const answers = {};
  // 這一回合有沒有新作答
  let added = true;
  // 每回合為新出現的題目作答，直到沒有新題目
  while (added) {
    added = false;
    // 依目前路徑逐題作答
    for (const item of M.visibleQuestions(model, scopeId, answers, {})) {
      // 已作答的題目不重新作答
      if (answers[item.id]) continue;
      answers[item.id] = { answer: pick(), hash: model.questions.get(item.id).hash };
      added = true;
    }
  }
  return answers;
}

/**
 * 立場值最接近的立場等級。
 * @param {object[]} stances 立場量尺，依數值排序。
 * @param {number} value 彙總後的立場值。
 * @returns {number} 量尺的索引。
 */
function nearestStance(stances, value) {
  const gaps = stances.map((stance) => Math.abs(stance.value - value));
  return gaps.indexOf(Math.min(...gaps));
}

/**
 * 累計一個選區的題目到各議題：題次、只有一位表態、有支持也有反對，以及各立場等級的次數。
 * @param {Map<string, object>} issues 各議題的累計，就地更新。
 * @param {object} M 計分層模組。
 * @param {object} model 資料模型。
 * @param {object} result 全部作答中立的計分結果。
 * @param {object[]} stances 立場量尺，依數值排序。
 */
function addIssues(issues, M, model, result, stances) {
  // 逐題歸到第 1 層議題
  for (const id of result.questionIds) {
    const issue = M.questionIssue(model, id);
    // 表態的候選人才有立場值
    const values = [...result.stances.values()].map((row) => row.get(id).value).filter((value) => value !== null);
    const stats = issues.get(issue) ?? { name: model.taxonomy.get(issue).name, questions: 0, single: 0, divided: 0, counts: stances.map(() => 0) };
    stats.questions += 1;
    // 只有一位表態的題目無從比較，兩位以上才看有沒有分歧
    if (values.length < 2) stats.single += 1;
    // 同時有正負立場的題目算分歧
    else if (values.some((value) => value > 0) && values.some((value) => value < 0)) stats.divided += 1;
    // 每位表態的候選人計入最接近的立場等級
    for (const value of values) stats.counts[nearestStance(stances, value)] += 1;
    issues.set(issue, stats);
  }
}

/**
 * 隨機作答一次，累計第一名同分、差距很小與全部資料不足的次數。
 * @param {object} draws 隨機作答的累計，就地更新。
 * @param {object} result 隨機作答的計分結果。
 */
function addDraw(draws, result) {
  const ranked = result.entities.filter((entity) => !entity.insufficient && entity.total !== null);
  draws.count += 1;
  // 可比的候選人不到兩位時沒有第一名之爭
  if (ranked.length < 2) {
    draws.insufficient += 1;
    return;
  }
  // 網站顯示整數百分比，同分以顯示值判斷
  const shown = ranked.map((entity) => Math.round(entity.total * 100));
  // 顯示值相同算同分
  draws.ties += shown[0] === shown[1] ? 1 : 0;
  // 總分差距小於門檻算差距很小
  draws.close += ranked[0].total - ranked[1].total < CLOSE_GAP ? 1 : 0;
}

/**
 * 計算一場選舉的報告段落，並把題目累計到各議題。
 * @param {object} context 資料層、計分層、索引、設定表、立場量尺、答案代碼、亂數與作答人數。
 * @param {object} set 索引中的選舉。
 * @param {Map<string, object>} issues 各議題的累計，就地更新。
 * @returns {Promise<string[]>} 報告的行。
 */
async function electionSection(context, set, issues) {
  const { D, M, index, tables, stances, codes, neutral, random, users } = context;
  // 總檔的模型只用來列出各選區的參選人
  const dataset = await D.loadDataset(set, index.allowed);
  const core = D.buildModel("election", dataset, tables);
  // 選舉的累計、隨機作答的累計與各選區的共識題
  const totals = { scopes: 0, questions: 0, consensus: 0 };
  const draws = { count: 0, ties: 0, close: 0, insufficient: 0 };
  const scopes = [];
  // 逐選區併入選區檔後計分
  for (const [scopeId, entities] of core.entitiesByScope) {
    // 只有一位參選人的選區沒有比較
    if (entities.length < 2) continue;
    // 全部作答中立的結果提供題數、共識題與立場
    const model = D.buildModel("election", D.withScope(dataset, await D.loadScope(set, scopeId, index.allowed)), tables);
    const base = M.computeResults(model, { scopeId, answers: answerScope(M, model, scopeId, () => neutral), importance: {} }, SETTINGS);
    // 題數與共識題計入選舉與選區的累計
    totals.scopes += 1;
    totals.questions += base.questionIds.length;
    totals.consensus += base.consensus.size;
    // 選區的題數與共識題留給共識題比例的排序
    scopes.push({ scopeId, questions: base.questionIds.length, consensus: base.consensus.size });
    // 題目的立場累計到所屬議題
    addIssues(issues, M, model, base, stances);
    // 每位隨機作答者各作答一次
    for (let user = 0; user < users; user += 1) {
      const answers = answerScope(M, model, scopeId, () => codes[Math.floor(random() * codes.length)]);
      addDraw(draws, M.computeResults(model, { scopeId, answers, importance: {} }, SETTINGS));
    }
  }
  // 有題目的選區依共識題比例由高到低取前幾個
  const top = scopes
    .filter((scope) => scope.questions)
    .sort((a, b) => b.consensus / b.questions - a.consensus / a.questions)
    // 取共識題比例最高的幾個
    .slice(0, TOP_SCOPES)
    // 選區代碼只寫末段
    .map((scope) => `${scope.scopeId.split(":").pop()}（${scope.consensus}/${scope.questions}）`);
  return [
    "",
    `## ${set.id}`,
    "",
    `- 有兩位以上參選人的選區 ${totals.scopes} 個，平均每區 ${totals.scopes ? (totals.questions / totals.scopes).toFixed(1) : "-"} 題，共識題 ${share(totals.consensus, totals.questions)}`,
    `- 隨機作答 ${draws.count} 次：第一、二名顯示的分數相同 ${share(draws.ties, draws.count)}，差距小於 ${CLOSE_GAP * 100} 個百分點 ${share(draws.close, draws.count)}，全部候選人都資料不足 ${share(draws.insufficient, draws.count)}`,
    `- 共識題比例最高的選區：${top.join("、") || "-"}`,
  ];
}

/**
 * 各第 1 層議題的表格，依題次由多到少。
 * @param {Map<string, object>} issues 各議題的累計。
 * @param {object[]} stances 立場量尺，依數值排序。
 * @returns {string[]} 報告的行。
 */
function issueSection(issues, stances) {
  const rows = [...issues.values()].sort((a, b) => b.questions - a.questions);
  // 每列寫題次、只有一位表態與分歧的比例，以及各立場等級占表態次數的比例
  const lines = rows.map((stats) => {
    const stated = stats.counts.reduce((sum, count) => sum + count, 0);
    const shares = stats.counts.map((count) => share(count, stated));
    return `| ${stats.name} | ${stats.questions} | ${share(stats.single, stats.questions)} | ${share(stats.divided, stats.questions)} | ${shares.join(" | ")} |`;
  });
  return [
    "",
    "## 各第 1 層議題",
    "",
    `| 議題 | 題次 | 只有一位表態 | 有支持也有反對 | ${stances.map((stance) => stance.name).join(" | ")} |`,
    `|---|---:|---:|---:|${stances.map(() => "---:").join("|")}|`,
    ...lines,
  ];
}

/**
 * 讀取參數與資料，寫出報告。
 * @returns {Promise<number>} 結束代碼，0 為成功，1 為選舉代碼不在索引。
 */
async function main() {
  const { values, positionals } = parseArgs({ options: { users: { type: "string" } }, allowPositionals: true });
  const users = Number(values.users ?? DEFAULT_USERS);
  // 資料層讀取的檔案改從 repo 取得
  installRepoFetch(BUILD);
  // 資料層與計分層在 fetch 換成 repo 檔案之後載入
  const D = await import("../../../src/data/index.js");
  const M = await import("../../../src/metrics/index.js");
  const [index, tables] = await Promise.all([D.loadIndex(), D.loadTables()]);
  // 省略選舉代碼時涵蓋索引的全部選舉
  const ids = positionals.length ? positionals : index.elections.map((set) => set.id);
  const missing = ids.filter((id) => !index.elections.some((set) => set.id === id));
  // 選舉代碼都要在索引中
  if (missing.length) {
    process.stderr.write(`索引沒有這些選舉：${missing.join("、")}\n`);
    return 1;
  }
  // 立場量尺依數值排序，作答中立用數值為 0 的答案
  const stances = [...tables.stances].sort((a, b) => a.value - b.value);
  const codes = tables.answers.map((answer) => answer.code);
  const neutral = tables.answers.find((answer) => answer.value === 0).code;
  // 各選舉共用的資料與亂數
  const context = { D, M, index, tables, stances, codes, neutral, random: mulberry32(SETTINGS.robustness.seed), users };
  const issues = new Map();
  const lines = ["# 區辨力報告", "", `隨機作答每個選區 ${users} 人，題目全部作答，議題重視度用預設值。`];
  // 選舉依參數順序逐場寫出
  for (const id of ids) lines.push(...(await electionSection(context, index.elections.find((set) => set.id === id), issues)));
  lines.push(...issueSection(issues, stances));
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

// 直接執行本檔時寫出報告
process.exitCode = await main();
