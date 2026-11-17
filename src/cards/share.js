/* ==================================================
 * cards/share.js - 分享連結與狀態匯出與匯入
 * --------------------------------------------------
 * - 角色：把作答與偏好壓縮成分享網址，讀回時核對資料版本、引擎、設定與詞表雜湊。狀態依分類匯出成 JSON 並依方式匯入。組成分享圖片的內容
 * - 指令：import { encodeShare, decodeShare, exportState, importState, shareImageSpec } from "../cards/share.js"
 * - 慣例：
 *   - 分享只帶 settings.share.groups 列的分類，不帶顯示偏好與自訂資料，自訂資料只存在使用者自己的瀏覽器
 *   - 雜湊不符時仍可開啟，但標示無法精確重播，並說明哪一項不同
 *   - 壓縮後超過 settings.share.maxBytes 時不產生連結，改請使用者匯出檔案
 * ================================================== */

import { SETTINGS } from "../config/index.js";
import { packText, unpackText } from "../lib/codec.js";
import { formatStamp, hasFormat } from "../lib/stamp.js";
import { STATE_GROUPS, normalizeState, mergeGroup } from "./state.js";
import { t, pct, youLabel, listText, poleShare, poleTexts, partItems } from "./kit.js";
import { colorOf } from "./series.js";

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 分享時題意雜湊只保留的前幾碼，讀回時以前綴比對，網址因此短得多。
 */
const SHARE_HASH_LENGTH = 8;

/**
 * 分享時不帶的狀態鍵：封存的舊答案只對自己有用。
 */
const SHARE_EXCLUDED = new Set(["archive"]);

/**
 * 主題測驗的雷達卡代碼。題組的 cards 列了這張卡，分享圖片才畫雷達。
 */
const RADAR_CARD = "topic.radar";

/* ==================================================
 * 共用片段
 * ================================================== */

/**
 * 取出指定分類的狀態鍵。
 * @param {object} state 狀態。
 * @param {string[]} groups 分類名稱。
 * @returns {object} 只含這些分類的狀態鍵。
 */
function pickGroups(state, groups) {
  const keys = groups.flatMap((group) => STATE_GROUPS[group].keys);
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}

/**
 * 一個題組在一份建置下的版本雜湊。
 * @param {object|null} set 題組在索引中的一筆，沒有題組時為 null。
 * @param {{ engine: string, config: string }} build 建置清單。
 * @returns {{ data: string|null, engine: string, config: string, vocab: string|null }}
 */
function stamps(set, build) {
  return {
    data: set?.manifest.data_version ?? null,
    engine: build.engine,
    config: build.config,
    // 主題測驗沒有受控詞表
    vocab: set?.manifest.vocab?.hash ?? null,
  };
}

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 產生分享網址的參數。
 * @param {object} context 卡片情境。
 * @returns {Promise<{ packed: string|null, bytes: number }>} 超過上限時 packed 為 null。
 */
async function encodeShare(context) {
  const picked = pickGroups(context.state, SETTINGS.share.groups);
  const state = Object.fromEntries(Object.entries(picked).filter(([key]) => !SHARE_EXCLUDED.has(key)));
  // 答案寫成 `[作答代碼, 題意雜湊前綴]`
  state.answers = Object.fromEntries(Object.entries(picked.answers ?? {}).map(([id, entry]) => [id, [entry.answer, entry.hash.slice(0, SHARE_HASH_LENGTH)]]));
  const payload = { ...formatStamp(SETTINGS.formats.share), stamps: stamps(context.set, context.data.build), state };
  const packed = await packText(JSON.stringify(payload));
  // 部分平台會截斷過長的網址，超過上限時 packed 為 null，視窗請使用者改用匯出檔案
  return { packed: packed.length > SETTINGS.share.maxBytes ? null : packed, bytes: packed.length };
}

/**
 * 讀回分享網址的參數。
 * @param {string} packed 網址參數。
 * @param {object} context 卡片情境，用來比對雜湊。
 * @returns {Promise<{ state: object, mismatches: string[] }>} mismatches 列出不同的雜湊名稱。
 */
async function decodeShare(packed, context) {
  const payload = JSON.parse(await unpackText(packed));
  // 格式不同時無法解讀
  if (!hasFormat(payload, SETTINGS.formats.share)) throw new Error("share-format");
  // 資料版本與詞表雜湊以分享時的題組為準
  const current = stamps(context.findSet(payload.state.setId), context.data.build);
  const mismatches = Object.keys(payload.stamps).filter((key) => payload.stamps[key] !== (current[key] ?? null));
  // 答案還原成狀態的形狀，雜湊先放前綴，載入資料集後由 archiveStale 比對並補成完整雜湊
  const answers = Object.fromEntries(Object.entries(payload.state.answers ?? {}).map(([id, [answer, hash]]) => [id, { answer, hash }]));
  return { state: { ...payload.state, answers }, mismatches };
}

/**
 * 分享連結的版本與目前不同時的提示文字，列出哪幾項不同。
 * @param {string[]} mismatches decodeShare 回傳的不同項目。
 * @returns {string}
 */
function mismatchMessage(mismatches) {
  return t("share.mismatch", { items: listText(mismatches.map((key) => t(`share.stamps.${key}`))) });
}

/**
 * 匯出狀態成 JSON 文字。
 * @param {object} context 卡片情境。
 * @param {string[]} groups 匯出的分類。
 * @returns {string}
 */
function exportState(context, groups) {
  const payload = { ...formatStamp(SETTINGS.formats.state), stamps: stamps(context.set, context.data.build), groups, state: pickGroups(context.state, groups) };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * 依匯入方式合併匯入的狀態。
 * @param {object} current 目前狀態。
 * @param {string} textContent 匯入檔內容。
 * @param {string} mode 匯入方式。
 * @returns {{ state: object, groups: string[] }}
 */
function importState(current, textContent, mode) {
  const payload = JSON.parse(textContent);
  // 格式不同的檔案不能匯入
  if (!hasFormat(payload, SETTINGS.formats.state)) throw new Error("state-format");
  const groups = (payload.groups ?? []).filter((group) => STATE_GROUPS[group]);
  // 逐類依匯入方式合併
  const state = groups.reduce((acc, group) => mergeGroup(acc, payload.state, group, mode), normalizeState(current));
  return { state, groups };
}

/**
 * 分享圖片的雷達：作答者排第一，使用系列色 0，其餘系列依傳入的順序。
 * @param {object} context 卡片情境。
 * @param {object} ideology 計分結果的 ideology：axes、user 與 entities。
 * @param {string} title 雷達的小標。
 * @param {{ series: number, mark: object|null, values: Map<string, number|null> }[]} entries 作答者之外的系列。
 * @returns {object} drawShareImage 的 radar。
 */
function radarImage(context, ideology, title, entries) {
  const series = [{ series: 0, mark: null, values: ideology.user }, ...entries].map((entry) => ({ ...entry, values: Object.fromEntries(entry.values) }));
  return { title, you: youLabel(context), min: SETTINGS.ideology.min, max: SETTINGS.ideology.max, axes: ideology.axes.map((axis) => ({ code: axis.code, label: axis.name })), series };
}

/**
 * 選舉的分享圖片：候選人總分長條加雷達。
 * @param {object} context 卡片情境。
 * @returns {object} shareImageSpec 的回傳形狀。
 */
function electionImage(context) {
  const results = context.results();
  // 翻牌後長條與雷達圖使用各候選人的配色，與網頁上的圖表一致
  const listed = results.entities.slice(0, SETTINGS.share.imageRows);
  const ideology = results.ideology;
  return {
    title: t("brand.name"),
    subtitle: context.set.label,
    caption: t("shareImage.caption", { answered: results.answeredCount }),
    scores: t("shareImage.scores"),
    // 長條下方先寫可比較題數再寫分項的簡稱，看圖的人不會只看總分
    items: listed.map((entity) => ({ label: context.label(entity.id), value: entity.total, display: pct(entity.total), ...colorOf(context, entity.id), meta: [t("result.comparable", { comparable: entity.stance.stated }), ...partItems(entity, 0, "shareImage.parts").map((part) => t("shareImage.part", part))].join(t("common.separator")) })),
    // 雷達圖畫作答者與長條列出的候選人，顏色與長條相同
    radar: radarImage(context, ideology, t("shareImage.radar"), listed.map((entity) => ({ ...colorOf(context, entity.id), values: ideology.entities.get(entity.id) }))),
    // 圖片放不下的候選人在頁尾說明人數，看圖的人知道名單不完整
    more: results.entities.length > SETTINGS.share.imageRows ? t("shareImage.more", { count: results.entities.length - SETTINGS.share.imageRows }) : null,
    // 含自訂資料時頁尾另外標明，圖片離開本機後仍看得出不是原始資料集的結果
    footer: t(context.model.custom ? "shareImage.footerCustom" : "shareImage.footer", { version: context.set.manifest.data_version }),
    filename: t("shareImage.filename"),
  };
}

/**
 * 主題測驗的分享圖片：單選題的選擇與各軸正極所占的比例，題組用到雷達卡時加上雷達，說明列寫出最接近的參照點。
 * @param {object} context 卡片情境。
 * @returns {object} shareImageSpec 的回傳形狀。
 */
function topicImage(context) {
  // 長條與雷達都只畫作答者自己的位置
  const results = context.results();
  const { ideology, bands } = results;
  // 單選題一列：簡稱在上，選了哪一項寫在下一行，不畫長條
  const choices = results.choices.map(({ question, choice }) => ({ label: question.short ?? question.stem, value: null, display: "", detail: choice?.name ?? t("topic.noChoice"), series: 0, mark: null }));
  // 每條軸一列：軸名與級別在上，下方是兩極光譜與兩端的比例，沒有作答的軸只寫沒有作答
  const axes = ideology.axes.map((axis) => {
    const share = poleShare(ideology.user.get(axis.code));
    const band = bands.get(axis.code)?.label ?? t("topic.noAxis");
    // 沒有比例時不畫光譜
    return share === null ? { label: axis.name, value: null, display: band, series: 0, mark: null } : { label: axis.name, value: null, split: share, ends: poleTexts(axis, share), display: band, series: 0, mark: null };
  });
  // 說明列寫作答題數，有最接近的參照點時一併寫出，並列時全部寫出
  const caption = results.closest ? t("topic.imageCaption", { name: listText(results.tied.map((reference) => reference.name)), answered: results.answeredCount }) : t("topic.imageCaptionPlain", { answered: results.answeredCount });
  return {
    title: t("brand.name"),
    subtitle: context.set.label,
    caption,
    scores: t("topic.imageScores"),
    items: [...choices, ...axes],
    // 題組沒有用雷達卡（例如只有兩條軸）時不畫雷達
    radar: context.set.cards.includes(RADAR_CARD) ? radarImage(context, ideology, t("topic.imageRadar"), []) : null,
    more: null,
    footer: t("topic.imageFooter", { version: context.set.manifest.data_version, name: context.model.set.origin.name }),
    filename: t("shareImage.filename"),
  };
}

/**
 * 分享圖片的內容依題組的種類組成，鍵是模型的 kind。
 */
const SHARE_IMAGES = {
  election: electionImage,
  topic: topicImage,
};

/**
 * 組成分享圖片的內容。
 * @param {object} context 卡片情境。
 * @returns {{ title: string, subtitle: string, caption: string, scores: string, items: object[], radar: object|null, more: string|null, footer: string, filename: string }} 交給 blocks 的 drawShareImage 繪製，radar 為 null 時不畫雷達。
 */
function shareImageSpec(context) {
  return SHARE_IMAGES[context.model.kind](context);
}

/* ==================================================
 * 匯出
 * ================================================== */

export { stamps, encodeShare, decodeShare, mismatchMessage, exportState, importState, shareImageSpec };
