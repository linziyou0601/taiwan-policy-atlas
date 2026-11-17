/* ==================================================
 * cards/modals.js - 明細視窗
 * --------------------------------------------------
 * - 角色：候選人明細、題目明細（選舉是各候選人的原文與判讀理由，主題測驗是原題與對各軸的影響）、議題明細、卡片說明、分享、確認、公報影像與匯入問題視窗的內容
 * - 指令：import { buildModal } from "../cards/modals.js"
 * - 慣例：
 *   - 視窗內容與卡片一樣是 `{ title, blocks }` 的區塊描述，由顯示層繪製，app 層只負責開關
 *   - 選舉的原文一律經 context.mask，翻牌前看不到姓名、黨名與識別字。主題測驗沒有候選人，原題照原文顯示
 *   - 判讀附判準、理由、證據、方法與審核狀態，讀者能自行核對
 * ================================================== */

import { shortHash, splitOnce } from "../lib/format.js";
import { issueOf, questionIssue, claimSpecificity, blendBounds } from "../metrics/index.js";
import { stamps } from "./share.js";
import { t, yesNo, pct, num, step, noticeWithAction, facetPath, listText, stanceName, stanceCell, blendFormula, stanceSubstitution, partItems, morePages, aboutLines, axisEffects } from "./kit.js";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 代入步驟轉成步驟清單的項目：標題寫名稱與代入值，內文是公式，註記是規則。
 * @param {{ label: string, value: string, formula: string, rule: string }[]} steps kit.js 的 step 組成的步驟。
 * @returns {{ title: string, text: string, note: string }[]}
 */
function stepItems(steps) {
  return steps.map((item) => ({ title: t("info.stepTitle", { label: item.label, value: item.value }), text: item.formula, note: item.rule }));
}

/**
 * 一則主張的明細區塊。
 * @param {object} context 卡片情境。
 * @param {object} claim 主張。
 * @param {object} [mapping] 這則主張對目前題目的配題。
 * @returns {{ type: "claim", quote: string, highlight: string|null, badges: object[], reason: string|null, detailsLabel: string, details: object[] }} 一則主張的區塊描述。
 */
function claimBlock(context, claim, mapping) {
  const specificity = claimSpecificity(context.model, claim.id);
  const sourceType = context.model.sourceTypes.get(claim.source_type);
  // 沒有對應公報段落的主張不列頁碼
  const passage = claim.passage ? context.model.passages.get(claim.passage) : null;
  // 標籤列：來源類型、對這題的立場與具體度，一眼看出這則主張的份量
  const badges = [
    { label: sourceType?.name ?? claim.source_type, tone: "neutral" },
    // 有配題時列出立場，沒有對應題目的配題只計入議題分布
    mapping ? { label: mapping.stance ? t("claim.stanceValue", { name: context.model.stances.get(mapping.stance)?.name, value: num(mapping.stance_value, 0) }) : t("claim.noQuestion"), tone: "accent" } : null,
    { label: t("claim.specificityBadge", { value: pct(specificity.value) }), tone: "neutral" },
    // 現任政府計畫另外標示
    claim.incumbent_plan ? { label: t("claim.plan"), tone: "warning" } : null,
  ];
  // 收合的細節：分配、方法與審核、原文位置
  const details = [
    // 同一則主張可配到多題，分配比例顯示它對本題的份額
    mapping ? { label: t("claim.allocation"), value: num(mapping.allocation) } : null,
    { label: t("claim.review"), value: listText([claim.method, claim.review_status].filter(Boolean)) || t("common.missing") },
    // 只有引用公報段落的主張才列出處頁碼
    passage ? { label: t("claim.passage"), value: t("claim.passageValue", { id: passage.id, page: passage.page }) } : null,
    { label: t("claim.code"), value: claim.id },
  ];
  // 有配題證據時標示證據片段，判讀理由同樣經過遮蔽，作答中不洩漏候選人身分
  return {
    type: "claim",
    quote: context.mask(claim.quote),
    highlight: mapping?.evidence ? context.mask(mapping.evidence) : null,
    badges: badges.filter(Boolean),
    reason: mapping ? context.mask(mapping.reason) : null,
    detailsLabel: t("claim.details"),
    details: details.filter(Boolean),
  };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 候選人明細。
 * @param {object} context 卡片情境。
 * @param {string} id 候選人。
 * @returns {{ title: string, blocks: (object|null)[] }}
 */
function candidateModal(context, id) {
  const results = context.results();
  const entity = results.entities.find((item) => item.id === id);
  // 原始資料列才有政黨與現任註記，翻牌後才會用到
  const record = context.model.entities.get(id);
  const range = blendBounds(entity, context.settings.scoring);
  const unknown = entity.stance.rows.filter((row) => row.counted && row.stance === null);
  return {
    title: context.label(id),
    blocks: [
      {
        type: "stats",
        items: [
          { label: t("candidate.total"), value: pct(entity.total, 1), note: t("candidate.range", { lower: pct(range.lower), upper: pct(range.upper) }) },
          // 各分項依公式列出，分項清單不寫死
          ...partItems(entity, 1),
          { label: t("coverage.coverage"), value: pct(entity.stance.coverage) },
        ],
      },
      // 翻牌後顯示政黨與現任註記
      context.revealed ? { type: "keyValue", items: [{ label: t("candidate.party"), value: record.party }, { label: t("candidate.incumbent"), value: yesNo(record.incumbent) }] } : null,
      {
        type: "steps",
        items: stepItems([
          step(t("result.parts.stance"), pct(entity.stance.score, 1), stanceSubstitution(entity), t("result.stanceFormula")),
          step(t("candidate.bounds"), t("candidate.range", { lower: pct(entity.stance.lower), upper: pct(entity.stance.upper) }), t("candidate.boundsRule")),
          step(t("candidate.total"), pct(entity.total, 1), blendFormula(context, entity)),
        ]),
      },
      // 未表態的題目清單看得出作答者答了哪些題，檢視他人分享的結果時不列
      ...(context.state.shared
        ? []
        : [
            { type: "heading", text: t("candidate.unknown", { count: unknown.length }), level: 3 },
            { type: "list", items: unknown.map((row) => ({ title: context.mask(context.model.questions.get(row.question).stem), meta: t("result.noPolicy"), action: `openQuestion:${row.question}` })), empty: t("candidate.noUnknown") },
          ]),
    ],
  };
}

/**
 * 選舉的題目明細：各候選人的立場、主張原文與判讀理由。
 * @param {object} context 卡片情境。
 * @param {string} id 題目。
 * @returns {{ title: string, blocks: (object|null)[] }}
 */
function electionQuestionModal(context, id) {
  const question = context.model.questions.get(id);
  const results = context.results();
  // 沒有中立性檢查紀錄的題目以空陣列處理
  const neutrality = context.model.neutralityByQuestion.get(id) ?? [];
  const sections = context.entities.map((entity) => {
    // 某位候選人在本題的立場與支撐它的主張，沒有政見時立場為空
    const stance = results.stances.get(entity.id)?.get(id);
    const items = stance?.items ?? [];
    return {
      type: "details",
      open: items.length > 0,
      summary: t("question.entityStance", { label: context.label(entity.id), stance: stanceName(context.model, stance?.value ?? null) }),
      // 未表態時說明此議題未提出政見
      blocks: items.length ? items.map((item) => claimBlock(context, item.claim, item.mapping)) : [{ type: "text", text: t("question.noClaims"), tone: "muted" }],
    };
  });
  return {
    title: context.mask(question.stem),
    blocks: [
      { type: "text", text: context.mask(question.note), tone: "muted" },
      {
        type: "keyValue",
        items: [
          { label: t("question.facet"), value: facetPath(context, question.facet) },
          { label: t("question.weight"), value: pct(results.weights.get(id), 1) },
          // 是否為共識題直接取自計分結果，與使用者的作答無關
          { label: t("question.consensus"), value: yesNo(results.consensus.has(id)) },
          { label: t("question.neutrality"), value: t("question.neutralityValue", { total: neutrality.length }) },
          { label: t("question.code"), value: t("question.codeValue", { id, version: question.version }) },
        ],
      },
      ...sections,
    ],
  };
}

/**
 * 主題測驗的題目明細：說明、原題、出處與這題對各軸的影響。
 * @param {object} context 卡片情境。
 * @param {string} id 題目。
 * @returns {{ title: string, blocks: (object|null)[] }}
 */
function topicQuestionModal(context, id) {
  const question = context.model.questions.get(id);
  // 每條對應的軸寫成「軸名：同意時往哪一極、權重」，單選題沒有軸對應
  const effects = axisEffects(context.model, id).map((effect) => ({ label: effect.axis, value: effect.text }));
  return {
    title: question.stem,
    blocks: [
      // 說明是題組作者寫的節錄或補充，沒有時不顯示
      question.note ? { type: "text", text: question.note } : null,
      // 原題只有引用自既有問卷或測驗的題目才有
      question.original ? { type: "heading", text: t("topic.original"), level: 3 } : null,
      // 原題照原文顯示，不經遮蔽：主題測驗沒有候選人
      question.original ? { type: "text", text: question.original, tone: "muted" } : null,
      // 出處寫原題或節錄的來源，沒有時沿用題組的來源
      question.source ? { type: "text", text: t("topic.questionSource", { source: question.source }), tone: "caption" } : null,
      { type: "heading", text: t("topic.effects"), level: 3 },
      // 單選題不進軸，改寫說明
      effects.length ? null : { type: "text", text: t("topic.choiceRule"), tone: "muted" },
      { type: "keyValue", items: [...effects, { label: t("question.code"), value: id }] },
    ],
  };
}

/**
 * 題目明細依題組的種類組成，鍵是模型的 kind。
 */
const QUESTION_MODALS = {
  election: electionQuestionModal,
  topic: topicQuestionModal,
};

/**
 * 題目明細。
 * @param {object} context 卡片情境。
 * @param {string} id 題目。
 * @returns {{ title: string, blocks: (object|null)[] }}
 */
function questionModal(context, id) {
  return QUESTION_MODALS[context.model.kind](context, id);
}

/**
 * 議題明細：一位候選人在一個議題下的題目立場與主張。
 * @param {object} context 卡片情境。
 * @param {string} arg 「議題=候選人」。
 * @returns {{ title: string, blocks: (object|null)[] }}
 */
function issueModal(context, arg) {
  const [issue, entityId] = splitOnce(arg, "=");
  const taxonomy = context.model.taxonomy;
  // 先找出這位候選人的結果，再以題目所屬的第 1 層議題篩選
  const results = context.results();
  const entity = results.entities.find((item) => item.id === entityId);
  const rows = entity.stance.rows.filter((row) => questionIssue(context.model, row.question) === issue);
  // 主張以它的配題所屬議題歸類，有任一配題屬於這個議題就列入，主張卡標示這筆配題
  const claims = (context.model.claimsByEntity.get(entityId) ?? []).map((claim) => ({ claim, mapping: (context.model.mappingsByClaim.get(claim.id) ?? []).find((mapping) => issueOf(taxonomy, mapping.facet) === issue) })).filter((item) => item.mapping);
  return {
    title: t("issue.title", { issue: taxonomy.get(issue).name, label: context.label(entityId) }),
    blocks: [
      // 逐題的立場與契合度看得出作答者每一題的答案，檢視他人分享的結果時只列主張
      ...(context.state.shared
        ? []
        : [
            { type: "heading", text: t("issue.questions", { count: rows.length }), level: 3 },
            {
              type: "list",
              // 沒有立場的題目標示未表態，其餘顯示立場與一致度
              items: rows.map((row) => ({ title: context.mask(context.model.questions.get(row.question).stem), meta: stanceCell(context.model, row), action: `openQuestion:${row.question}` })),
              empty: t("issue.noQuestions"),
            },
          ]),
      { type: "heading", text: t("issue.claims", { count: claims.length }), level: 3 },
      ...claims.map((item) => claimBlock(context, item.claim, item.mapping)),
    ],
  };
}

/**
 * 分享視窗。
 * @param {object} context 卡片情境。
 * @param {{ url: string|null, bytes: number }} share 產生的連結。
 * @returns {{ title: string, blocks: (object|null)[] }}
 */
function shareModal(context, share) {
  // 太長時改請使用者匯出檔案
  if (!share.url) return { title: t("share.title"), blocks: noticeWithAction(t("share.tooLong", { bytes: share.bytes }), { label: t("share.toExport"), icon: "download", action: "route:dataset" }) };
  return {
    title: t("share.title"),
    blocks: [
      { type: "text", text: t("share.intro") },
      { type: "copy", value: share.url, label: t("share.copy"), action: `copy:${share.url}` },
      // 主題測驗沒有受控詞表，不列詞表雜湊。資料版本原樣顯示，其餘雜湊只顯示前綴
      { type: "keyValue", items: Object.entries(stamps(context.set, context.data.build)).filter(([, value]) => value !== null).map(([key, value]) => ({ label: t(`share.stamps.${key}`), value: key === "data" ? value : shortHash(value) })) },
      // 對方一律以觀看模式開啟，提醒會看到姓名與黨名、結果只到議題層級
      { type: "notice", tone: "warning", text: t("share.revealed") },
    ],
  };
}

/**
 * 卡片的說明視窗：回答的問題、讀法、代入步驟、資料來源與設定值。沒有內容的段落連標題一併省略。
 * @param {object} context 卡片情境。
 * @param {{ title: string, question: string, read: string, info: { steps: object[], sources: string[], constants: { path: string, value: string, changed: boolean }[] } }} card buildCard 組成的卡片描述。
 * @returns {{ title: string, blocks: object[] }}
 */
function infoModal(context, card) {
  const { steps, sources, constants } = card.info;
  // 每一段只在卡片有內容時列出
  const sections = [
    [t("info.question"), [{ type: "text", text: card.question }]],
    [t("info.read"), [{ type: "text", text: card.read }]],
    [t("info.steps"), steps.length ? [{ type: "steps", items: stepItems(steps) }] : []],
    [t("info.sources"), sources.length ? [{ type: "steps", items: sources.map((source) => ({ title: source })) }] : []],
    [t("info.constants"), constants.length ? [{ type: "table", columns: ["path", "value", "changed"].map((key) => ({ key, label: t(`info.${key}`) })), rows: constants.map((item) => ({ id: item.path, cells: { path: item.path, value: item.value, changed: item.changed ? t("common.yes") : "" } })), dense: true }] : []],
  ];
  // 沒有內容的段落不放標題
  return { title: card.title, blocks: sections.filter(([, blocks]) => blocks.length).flatMap(([heading, blocks]) => [{ type: "heading", text: heading, level: 3 }, ...blocks]) };
}

/**
 * 確認視窗：確定時執行接續的動作，取消時關閉。
 * @param {object} context 卡片情境。
 * @param {{ message: string, then: string }} effect 動作回傳的確認效果，then 是確定後的動作。
 * @returns {{ title: string, blocks: object[] }}
 */
function confirmModal(context, effect) {
  return { title: t("confirm.title"), blocks: [{ type: "text", text: effect.message }, { type: "buttons", items: [{ label: t("confirm.yes"), icon: "check", action: `confirmed:${effect.then}`, tone: "accent" }, { label: t("confirm.no"), action: "closeModal", tone: "neutral" }] }] };
}

/**
 * 公報影像視窗。影像會顯示候選人身分，視窗先提示。
 * @param {object} context 卡片情境。
 * @param {string} path 影像路徑。
 * @returns {{ title: string, blocks: object[] }}
 */
function imageModal(context, path) {
  return { title: t("dataset.imageTitle"), blocks: [{ type: "notice", tone: "warning", text: t("dataset.imageNote") }, { type: "image", src: path, alt: t("dataset.imageAlt") }] };
}

/**
 * 分享圖片的預覽視窗：先看圖，再決定存檔或複製。
 * @param {object} context 卡片情境。
 * @param {string} src 圖片的暫時網址。
 * @returns {{ title: string, blocks: object[] }}
 */
function shareImageModal(context, src) {
  // 預覽就是圖片本身，看得出有沒有顯示姓名
  return {
    title: t("shareImage.title"),
    blocks: [
      { type: "image", src, alt: t("shareImage.alt") },
      { type: "buttons", items: [{ label: t("shareImage.save"), icon: "download", action: "saveShareImage", tone: "accent" }, { label: t("shareImage.copy"), icon: "copy", action: "copyShareImage", tone: "neutral" }] },
    ],
  };
}

/**
 * 「更多」視窗：底部分頁列放不下的頁面入口，例如常見問題與更新紀錄，以及手機上取代頁尾的說明。
 * @param {object} context 卡片情境。
 * @returns {{ title: string, blocks: object[] }}
 */
function moreModal(context) {
  const pages = morePages();
  // 每頁一列，所在頁面標示。手機沒有頁尾，資料儲存、授權與資料版本寫在這裡
  return {
    title: t("nav.more"),
    blocks: [
      { type: "list", items: pages.map((page) => ({ title: t(`pages.${page}`), text: t(`nav.descriptions.${page}`), action: `route:${page}`, selected: page === context.page })) },
      // 資料儲存、授權與資料版本與頁尾同一份
      ...aboutLines(context).map((line) => ({ type: "text", text: line, tone: "muted" })),
    ],
  };
}

/**
 * 匯入問題視窗：逐項列出問題，有列號時寫出第幾列。
 * @param {object} context 卡片情境。
 * @param {{ code: string, row?: number, detail?: string }[]} issues 解析器回報的問題。
 * @returns {{ title: string, blocks: object[] }}
 */
function importModal(context, issues) {
  // 有列號的問題寫成「第幾列」，其餘只寫細節。沒有問題卻開了視窗時表示檔案沒有任何題目
  const items = issues.map((issue) => ({ title: t(`import.issues.${issue.code}`), meta: issue.row ? t("import.row", { row: issue.row, detail: issue.detail ?? "" }) : (issue.detail ?? "") }));
  return { title: t("import.title"), blocks: [{ type: "list", items, empty: t("import.noQuestions") }] };
}

/**
 * 視窗登錄表：種類對應組成內容的函式。新增一種視窗時在這裡登錄，locale 寫標題與文字。
 */
const MODALS = { candidate: candidateModal, question: questionModal, issue: issueModal, share: shareModal, info: infoModal, confirm: confirmModal, image: imageModal, shareImage: shareImageModal, import: importModal, more: moreModal };

/**
 * 依視窗種類組成內容。
 * @param {object} context 卡片情境。
 * @param {string} kind 視窗種類，MODALS 的鍵。
 * @param {unknown} arg 各種類的參數，見對應的函式。
 * @returns {{ title: string, blocks: object[] }}
 */
function buildModal(context, kind, arg) {
  const builder = MODALS[kind];
  // 種類沒有登錄是程式錯誤，直接拋出並寫出種類
  if (!builder) throw new Error(`沒有登錄視窗 ${kind}`);
  return builder(context, arg);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { buildModal };
