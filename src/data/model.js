/* ==================================================
 * data/model.js - 資料模型
 * --------------------------------------------------
 * - 角色：把一個題組的資料集與設定表整理成以代碼查詢的索引，計分層只讀這個模型。題組的種類（選舉、主題測驗）各有一個建立函式，登錄在 MODEL_BUILDERS
 * - 指令：由 data/index.js 匯出，上一層 `import { buildModel, byTaxonomyOrder, lineage, ancestorAt, issueOf, ISSUE_LEVEL } from "../data/index.js"`
 * - 慣例：
 *   - 每種模型都有 SharedModel 的欄位，作答、意識形態軸與遮蔽讀這些欄位，每種模型共用同一套處理
 *   - 模型建好後不再修改，自訂資料以 data/custom.js 產生新的模型
 *   - 選舉的題目依分類樹的碼位順序排列，子題緊接在母題之後，作答順序因此固定、可重播。主題測驗依資料集的題目順序
 *   - 選舉的遮蔽詞由名冊（姓名、搭檔、黨名與簡稱）與 aliases 組成，依長度由長到短替換，避免短詞先替換而切斷長詞
 * ================================================== */

import { fnv1a } from "../lib/codec.js";
import { groupBy, indexBy } from "../lib/objects.js";
import { EMPTY_CELL } from "../lib/delimited.js";

/* ==================================================
 * 型別定義
 * ================================================== */

/**
 * @typedef {object} TaxonomyNode 分類樹節點。
 * @property {string} code 代碼。
 * @property {string|null} parent 父代碼。
 * @property {string} name 名稱。
 * @property {number} level 層級。
 * @property {string[]} children 子節點代碼，依碼位排序。
 * @property {number} order 在全樹中的順序。
 */

/**
 * @typedef {object} SharedModel 每種題組的模型都有的欄位。
 * @property {string} kind 題組的種類，與索引的 kind 相同。
 * @property {object} set 題組本身的資訊：選舉設定或主題測驗設定。
 * @property {object} manifest 資料集的 manifest。
 * @property {Record<string, object[]>} tables 設定表。
 * @property {object[]} axes 意識形態軸，依顯示順序。
 * @property {Map<string, object>} questions 題目，每題有 stem、note、hash、parent、conditions、budget_share、format 與 choices。budget_share 是這題在同一根題底下的預算份額。format 是作答形式，scale 是五級量尺、choice 是題組自訂選項的單選。choices 是這一題可選的答案，依畫面排列的順序。
 * @property {string[]} questionOrder 題目代碼，依作答順序排列。
 * @property {Map<string, object[]>} axesByQuestion 各題目對應的意識形態軸。
 * @property {Map<string, object>} answers 量尺選項，鍵是作答代碼。
 * @property {{ code: string, name: string, value: number }[]} scale 量尺選項，依數值由小到大，左邊是不同意。量尺題的 choices 就是它。
 * @property {number} scaleEnd 量尺端點的絕對值，五級量尺是 2。契合度與意識形態軸以它正規化。
 * @property {Map<string, object>} scopes 選區，沒有選區的種類為空。
 * @property {Map<string, object>} entities 比較對象，沒有比較對象的種類為空。
 * @property {{ term: string, category: string }[]} maskTerms 翻牌前要遮蔽的詞，依長度由長到短。
 * @property {Map<string, string>} maskReplacements 各遮蔽類別的替代字。
 * @property {object} dataset 原始資料集，資料集瀏覽與匯出使用。
 * @property {boolean} custom 是否含使用者匯入的自訂題庫。
 */

/**
 * @typedef {object} Model 一場選舉的資料模型，含 SharedModel 的欄位。Map 的鍵都是代碼，`…By…` 是依右邊的欄位分組。
 * @property {Map<string, TaxonomyNode>} taxonomy 分類樹。
 * @property {Map<string, object[]>} entitiesByScope 各選區的參選對象。
 * @property {Map<string, object[]>} childrenOf 各母題的子題。
 * @property {Map<string, object>} claims 主張。
 * @property {Map<string, object[]>} claimsByEntity 各參選對象的主張。
 * @property {object[]} mappings 配題，含沒有對應題目的配題。
 * @property {Map<string, object[]>} mappingsByQuestion 各題目的配題。
 * @property {Map<string, object[]>} mappingsByClaim 各主張的配題。
 * @property {Map<string, object>} passages 公報段落。
 * @property {Map<string, object>} documents 原始文件與頁面。
 * @property {Map<string, object[]>} specificityByClaim 各主張的具體度判讀。
 * @property {Map<string, object[]>} neutralityByQuestion 各題目的中立性審查。
 * @property {Map<string, number>} sourceWeights 來源類型的權重。
 * @property {Map<string, object>} stances 立場判準的級距。
 * @property {string[]} maskOrder 參選對象的代號順序。
 */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 議題的層級：分類樹的第 1 層。比它深一層的是議題下的細項。
 */
const ISSUE_LEVEL = 1;

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 建立分類樹。
 * @param {object[]} rows taxonomy 表。
 * @returns {Map<string, TaxonomyNode>}
 */
function buildTaxonomy(rows) {
  const nodes = new Map();
  // 表已依碼位排序，順序即樹的前序走訪順序
  rows.forEach((row, order) => nodes.set(row.code, { ...row, parent: row.parent === EMPTY_CELL ? null : row.parent, children: [], order }));
  // 第二趟把每個節點加到父節點的子節點清單
  for (const node of nodes.values()) {
    // 根節點沒有父節點
    if (node.parent) nodes.get(node.parent).children.push(node.code);
  }
  return nodes;
}

/**
 * 量尺選項，依數值由小到大排列。
 * @param {object[]} answers 量尺表。
 * @returns {{ code: string, name: string, value: number }[]}
 */
function scaleChoices(answers) {
  return [...answers].sort((a, b) => a.value - b.value).map((row) => ({ code: row.code, name: row.name, value: row.value }));
}

/**
 * 量尺端點的絕對值。
 * @param {object[]} answers 量尺表。
 * @returns {number}
 */
function scaleEndOf(answers) {
  return Math.max(...answers.map((row) => Math.abs(row.value)));
}

/**
 * 依分類樹的碼位順序比較兩個節點代碼，給 sort 使用，畫面上的議題順序因此固定。
 * @param {Map<string, TaxonomyNode>} taxonomy 分類樹。
 * @returns {(a: string, b: string) => number}
 */
function byTaxonomyOrder(taxonomy) {
  return (a, b) => taxonomy.get(a).order - taxonomy.get(b).order;
}

/**
 * 節點與它全部的祖先，由節點本身往上到第 1 層。
 * @param {Map<string, TaxonomyNode>} taxonomy 分類樹。
 * @param {string} code 節點代碼。
 * @returns {string[]} 不在分類樹的代碼回傳空陣列。
 */
function lineage(taxonomy, code) {
  const codes = [];
  // 沿父節點往上，走到根節點的上一層（不存在）為止
  for (let node = taxonomy.get(code); node; node = taxonomy.get(node.parent)) codes.push(node.code);
  return codes;
}

/**
 * 找出節點在指定層級的祖先，節點本身就在該層時回傳自己。
 * @param {Map<string, TaxonomyNode>} taxonomy 分類樹。
 * @param {string} code 節點代碼。
 * @param {number} level 層級。
 * @returns {string|null}
 */
function ancestorAt(taxonomy, code, level) {
  // 節點比指定層級更淺時沒有該層祖先
  return lineage(taxonomy, code).find((ancestor) => taxonomy.get(ancestor).level === level) ?? null;
}

/**
 * 找出面向所屬的第 1 層議題。議題圖示、熱力圖的列、重疊度與議題分布都以這一層為單位。
 * @param {Map<string, TaxonomyNode>} taxonomy 分類樹。
 * @param {string} code 節點代碼。
 * @returns {string|null}
 */
function issueOf(taxonomy, code) {
  return ancestorAt(taxonomy, code, ISSUE_LEVEL);
}

/**
 * 依分類樹排序題目，子題緊接在母題之後。
 * @param {object[]} questions 題目。
 * @param {Map<string, TaxonomyNode>} taxonomy 分類樹。
 * @returns {object[]}
 */
function orderQuestions(questions, taxonomy) {
  const children = groupBy(questions.filter((q) => q.parent), (q) => q.parent);
  // 先依面向在分類樹的順序，同面向時比代碼，讓排序在每次載入都一致
  const byFacet = (a, b) => taxonomy.get(a.facet).order - taxonomy.get(b.facet).order || (a.id < b.id ? -1 : 1);
  // 排序結果依母題在前、子題在後的順序累積
  const ordered = [];
  /**
   * 放入一題與它的子題。
   * @param {object} question 題目。
   */
  const visit = (question) => {
    ordered.push(question);
    // 子題依分類樹順序接在母題之後
    for (const child of (children.get(question.id) ?? []).sort(byFacet)) visit(child);
  };
  // 從根題開始走訪
  for (const root of questions.filter((q) => !q.parent).sort(byFacet)) visit(root);
  return ordered;
}

/**
 * 組成遮蔽詞清單。
 * @param {object[]} entities 參選對象。
 * @param {object[]} aliases 資料集的 aliases。
 * @param {Record<string, object[]>} tables 設定表。
 * @returns {{ term: string, category: string }[]} 依長度由長到短。
 */
function buildMaskTerms(entities, aliases, tables) {
  const parties = indexBy(tables.parties, "name");
  const terms = [];
  // 名冊的姓名、搭檔與黨名
  for (const entity of entities) {
    terms.push({ term: entity.name, category: "name" });
    // 正副組合的搭檔也要遮蔽
    if (entity.running_mate) terms.push({ term: entity.running_mate, category: "name" });
    const party = parties.get(entity.party);
    terms.push({ term: entity.party, category: "party" });
    // 政黨表有簡稱時一併遮蔽
    if (party?.short) terms.push({ term: party.short, category: "party" });
  }
  // 公報中的口號、暱稱與標誌文字
  for (const alias of aliases) terms.push({ term: alias.term, category: alias.category });
  const unique = [...new Map(terms.filter((t) => t.term).map((t) => [t.term, t])).values()];
  return unique.sort((a, b) => b.term.length - a.term.length);
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 建立一場選舉的資料模型。
 * @param {object} dataset 一場選舉的資料集。
 * @param {Record<string, object[]>} tables 設定表。
 * @returns {Model}
 */
function buildElectionModel(dataset, tables) {
  const taxonomy = buildTaxonomy(tables.taxonomy);
  const scale = scaleChoices(tables.answers);
  // 選舉的題目都用五級量尺作答
  const questions = orderQuestions(dataset.questions, taxonomy).map((question) => ({ ...question, format: "scale", choices: scale }));
  // 來源類型的權重：不能當立場證據的類型權重記為 0
  const sourceWeights = new Map(tables.sourceTypes.map((row) => [row.code, row.stanceEvidence ? row.weight : 0]));
  // 遮蔽的顯示順序依雜湊打散，翻牌前的代號不洩漏號次
  const maskOrder = [...dataset.entities].sort((a, b) => fnv1a(`${dataset.election.id}|${a.id}`) - fnv1a(`${dataset.election.id}|${b.id}`)).map((e) => e.id);
  return {
    kind: "election",
    set: dataset.election,
    manifest: dataset.manifest,
    tables,
    // 選舉的意識形態軸由設定表定義，每場選舉相同
    axes: tables.axes,
    taxonomy,
    scopes: indexBy(dataset.scopes),
    entities: indexBy(dataset.entities),
    entitiesByScope: groupBy(dataset.entities, (e) => e.scope),
    questions: indexBy(questions),
    questionOrder: questions.map((q) => q.id),
    childrenOf: groupBy(questions.filter((q) => q.parent), (q) => q.parent),
    claims: indexBy(dataset.claims),
    claimsByEntity: groupBy(dataset.claims, (c) => c.entity),
    mappings: dataset.mappings,
    mappingsByQuestion: groupBy(dataset.mappings.filter((m) => m.question), (m) => m.question),
    mappingsByClaim: groupBy(dataset.mappings, (m) => m.claim),
    passages: indexBy(dataset.passages),
    documents: indexBy(dataset.documents),
    specificityByClaim: groupBy(dataset.specificity, (s) => s.claim),
    neutralityByQuestion: groupBy(dataset.neutrality, (n) => n.question),
    axesByQuestion: groupBy(dataset.question_axes, (a) => a.question),
    sourceWeights,
    stances: indexBy(tables.stances, "code"),
    answers: indexBy(tables.answers, "code"),
    scale,
    scaleEnd: scaleEndOf(tables.answers),
    maskTerms: buildMaskTerms(dataset.entities, dataset.aliases, tables),
    maskReplacements: new Map(tables.masks.map((row) => [row.code, row.replacement])),
    maskOrder,
    dataset,
    custom: false,
  };
}

/**
 * 建立一套主題測驗的資料模型。主題測驗沒有選區、比較對象與追問，軸、題目與參照點都來自資料集。
 * @param {object} dataset 一套主題測驗的資料集。
 * @param {Record<string, object[]>} tables 設定表。
 * @returns {SharedModel & { references: object[], comparisons: Map<string, object> }} comparisons 是單選題的全國對照，鍵是題目代碼。
 */
function buildTopicModel(dataset, tables) {
  const scale = scaleChoices(tables.answers);
  // 題目補上作答路徑讀的欄位：沒有母題、沒有顯示條件，每題自成一組，預算份額記為 1。有選項的題目是單選題，其餘用五級量尺
  const questions = dataset.questions.map((question) => ({ ...question, parent: null, conditions: [], budget_share: 1, format: question.options ? "choice" : "scale", choices: question.options ? question.options.map((option) => ({ code: option.id, name: option.name, value: null })) : scale }));
  return {
    kind: "topic",
    set: dataset.topic,
    manifest: dataset.manifest,
    tables,
    axes: dataset.axes,
    questions: indexBy(questions),
    questionOrder: questions.map((question) => question.id),
    axesByQuestion: groupBy(dataset.question_axes, (link) => link.question),
    references: dataset.references,
    comparisons: indexBy(dataset.comparisons, "question"),
    answers: indexBy(tables.answers, "code"),
    scale,
    scaleEnd: scaleEndOf(tables.answers),
    // 主題測驗沒有選區與比較對象，也沒有要遮蔽的身分
    scopes: new Map(),
    entities: new Map(),
    maskTerms: [],
    maskReplacements: new Map(),
    dataset,
    custom: false,
  };
}

/**
 * 各種題組的模型建立函式，鍵是索引的 kind。
 */
const MODEL_BUILDERS = {
  election: buildElectionModel,
  topic: buildTopicModel,
};

/**
 * 依題組的種類建立資料模型。
 * @param {string} kind 題組的種類，MODEL_BUILDERS 的鍵。
 * @param {object} dataset 資料集。
 * @param {Record<string, object[]>} tables 設定表。
 * @returns {SharedModel}
 */
function buildModel(kind, dataset, tables) {
  const build = MODEL_BUILDERS[kind];
  // 不認得的種類是索引或程式錯誤，寫出種類名稱
  if (!build) throw new Error(`沒有登錄題組種類 ${kind} 的模型`);
  return build(dataset, tables);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { buildModel, byTaxonomyOrder, lineage, ancestorAt, issueOf, ISSUE_LEVEL };
