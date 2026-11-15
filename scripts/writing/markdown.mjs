/* ==================================================
 * markdown.mjs - 寫作檢查：Markdown 的行與版面
 * --------------------------------------------------
 * - 角色：把一份 Markdown 拆成帶種類的行，並檢查標題的層級與分隔、程式碼區塊的語言、產物與段落的邊界、相對連結的檔案與章節。只處理參數收到的文字，檔案是否存在由呼叫端傳入的函式回答
 * - 指令：由 lint.mjs 匯入 parseMarkdown、maskLine、checkStructure、checkLinks、anchorsOf
 * - 慣例：
 *   - 行的種類是 heading、table、list、code、fence、break、rule、blank、paragraph，front matter 與程式碼區塊內的行是 code
 *   - 縮排接在清單項目之後的行屬於那個清單項目，項目內的說明與程式碼區塊不另外判斷邊界
 *   - 遮罩把行內的程式碼與角括號的網址換成 \x01、連結只留文字、HTML 標籤拿掉、「」裡的內容拿掉，文字的規則只比對遮罩後的行。「」裡是引用的原文與被討論的寫法，照原樣保留
 *   - 規則的寫法見 docs/writing/rules.md
 * ================================================== */

/* ==================================================
 * 集中設定
 * ================================================== */

/**
 * 標題最深的層級。
 */
const MAX_HEADING_LEVEL = 3;

/**
 * 章與章之間 `---` 之前要有的 `<br>` 行數。
 */
const CHAPTER_BREAKS = 3;

/**
 * 產物的行種類：表格、清單與程式碼區塊。
 */
const PRODUCT_KINDS = new Set(["table", "list", "code", "fence"]);

/**
 * 各種行的比對式。
 */
const HEADING_RE = /^(#{1,6}) +(.+?)\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
// 表格的列、`<br>` 與分隔線
const TABLE_RE = /^\s*\|/;
const BREAK_RE = /^<br\s*\/?>$/;
const RULE_RE = /^-{3,}$/;

/**
 * 行內的程式碼、連結、圖片與 HTML 標籤，遮罩時處理。
 */
const INLINE_CODE_RE = /`[^`]*`/g;
const LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;
const AUTOLINK_RE = /<https?:\/\/[^>]+>/g;
// HTML 標籤與「」裡的引用
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const QUOTED_RE = /「[^「」]*」/g;

/**
 * 段落結尾引出下一個產物的冒號。
 */
const LEAD_IN_RE = /[：:]\s*$/;

/**
 * 錨點保留的字元：文字、數字、連字號與空白，其餘的標點拿掉。
 */
const ANCHOR_DROP_RE = /[^\p{L}\p{N}\- _]/gu;

/* ==================================================
 * 主體
 * ================================================== */

/**
 * 把 Markdown 拆成帶種類的行。
 * @param {string} text 檔案內容。
 * @returns {{ number: number, text: string, kind: string, level?: number, title?: string, language?: string }[]} number 從 1 起算。
 */
function parseMarkdown(text) {
  const lines = text.split("\n");
  const records = [];
  // fence 記目前程式碼區塊的開頭符號，inList 記上一個非空行是否屬於清單
  let fence = null;
  let inList = false;
  // front matter 只在檔案的第一行開始
  let frontMatter = lines[0] === "---";
  // 逐行判斷種類
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const record = { number: index + 1, text: line, kind: "paragraph" };
    // 先收進清單，之後原地改寫種類
    records.push(record);
    // front matter 到第二個 --- 為止，裡面的行不檢查
    if (frontMatter) {
      record.kind = "code";
      // 第一行之後遇到 --- 就結束
      if (index > 0 && line === "---") frontMatter = false;
      continue;
    }
    const fenceMatch = FENCE_RE.exec(line);
    // 程式碼區塊內只認得結尾的符號
    if (fence) {
      record.kind = "code";
      // 同一種符號、長度足夠的行結束這個區塊
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
      continue;
    }
    // 程式碼區塊的開頭記下語言
    if (fenceMatch) {
      fence = fenceMatch[1];
      record.kind = "fence";
      // 語言寫在開頭的符號之後
      record.language = fenceMatch[2].trim();
      continue;
    }
    // 空行不改變是否在清單內
    if (!line.trim()) {
      record.kind = "blank";
      continue;
    }
    // 其餘的行依序比對標題、分隔、清單與表格
    const heading = HEADING_RE.exec(line);
    // 標題、分隔線與 <br> 結束清單
    if (heading) {
      Object.assign(record, { kind: "heading", level: heading[1].length, title: heading[2] });
      inList = false;
    } else if (BREAK_RE.test(line.trim())) {
      // <br> 是章節之間的分隔
      record.kind = "break";
      inList = false;
    } else if (RULE_RE.test(line.trim())) {
      // --- 是章之間的分隔線
      record.kind = "rule";
      inList = false;
    } else if (LIST_RE.test(line) || (inList && /^\s{2,}\S/.test(line))) {
      // 清單項目，以及縮排接在項目之後的行
      record.kind = "list";
      inList = true;
    } else if (TABLE_RE.test(line)) {
      // 以格線開頭的行是表格的列
      record.kind = "table";
      inList = false;
    } else {
      // 其餘是段落
      inList = false;
    }
  }
  return records;
}

/**
 * 遮罩一行：行內的程式碼與角括號的網址換成 \x01，連結只留文字，HTML 標籤拿掉，「」裡的內容拿掉。
 * @param {string} line 原文的一行。
 * @returns {string}
 */
function maskLine(line) {
  const coded = line.replace(INLINE_CODE_RE, "\x01");
  // 圖片整個拿掉，連結留下文字
  const linked = coded.replace(LINK_RE, (_match, bang, label) => (bang ? "" : label));
  // 角括號的網址當成一個行內的程式碼，HTML 標籤與「」裡的內容拿掉
  return linked.replace(AUTOLINK_RE, "\x01").replace(HTML_TAG_RE, "").replace(QUOTED_RE, "「」");
}

/**
 * 算出一個標題的錨點，與 GitHub 的寫法相同。
 * @param {string} title 標題文字。
 * @returns {string}
 */
function anchorOf(title) {
  return maskLine(title).replace(/\x01/g, "").trim().toLowerCase().replace(ANCHOR_DROP_RE, "").replace(/ /g, "-");
}

/**
 * 列出一份 Markdown 全部標題的錨點。
 * @param {string} text 檔案內容。
 * @returns {Set<string>}
 */
function anchorsOf(text) {
  const titles = parseMarkdown(text).filter((record) => record.kind === "heading");
  return new Set(titles.map((record) => anchorOf(record.title.replace(/`/g, ""))));
}

/**
 * 檢查版面：標題的層級與分隔、程式碼區塊的語言、產物與段落的邊界。
 * @param {ReturnType<typeof parseMarkdown>} records 帶種類的行。
 * @returns {{ rule: string, line: number, hit: string }[]}
 */
function checkStructure(records) {
  const findings = [];
  const solid = records.filter((record) => record.kind !== "blank");
  // 上一個標題的層級、這一章已經出現過 H2，以及是否剛經過產物
  let previousLevel = 0;
  let chapterHasH2 = false;
  let afterProduct = false;
  // 章的數目，第一個 H1 是文件的標題
  let chapters = 0;
  // 依序走過非空行
  for (let index = 0; index < solid.length; index += 1) {
    const record = solid[index];
    const before = solid[index - 1];
    // 程式碼區塊的開頭要標明語言
    if (record.kind === "fence" && !record.language) findings.push({ rule: "程式碼區塊沒有語言", line: record.number, hit: "" });
    // 產物之後的段落要以冒號引出下一個產物，否則列出來判斷是不是補述
    if (record.kind === "paragraph") {
      const last = solid[index + 1] === undefined || solid[index + 1].kind !== "paragraph";
      // 一段有好幾行時以最後一行的結尾判斷
      if (afterProduct && last && !LEAD_IN_RE.test(record.text)) findings.push({ rule: "產物之後的補述", line: record.number, hit: "" });
      // 段落結束後才離開「產物之後」的狀態
      if (last) afterProduct = false;
      continue;
    }
    // 產物記下狀態，分隔線與 <br> 不改變它
    if (PRODUCT_KINDS.has(record.kind)) {
      afterProduct = true;
      continue;
    }
    // 其餘只處理標題
    if (record.kind !== "heading") continue;
    afterProduct = false;
    // 標題最深到 H3，而且逐層往下
    if (record.level > MAX_HEADING_LEVEL) findings.push({ rule: "標題過深", line: record.number, hit: "" });
    else if (previousLevel && record.level > previousLevel + 1) findings.push({ rule: "標題跳級", line: record.number, hit: `H${previousLevel} 到 H${record.level}` });
    // 第二章起，章之前要有三行 <br> 與 ---
    if (record.level === 1) {
      chapters += 1;
      const breaks = solid.slice(Math.max(0, index - 1 - CHAPTER_BREAKS), index - 1);
      // --- 之前的三行都要是 <br>
      const separated = before?.kind === "rule" && breaks.length === CHAPTER_BREAKS && breaks.every((item) => item.kind === "break");
      // 第一個 H1 是文件的標題
      if (chapters > 1 && !separated) findings.push({ rule: "H1 分隔不符", line: record.number, hit: "" });
      chapterHasH2 = false;
    }
    // 同一章的第二個 H2 起，之前要有一行 <br>
    if (record.level === 2) {
      // 第一個 H2 接在章的說明之後
      if (chapterHasH2 && before?.kind !== "break") findings.push({ rule: "H2 分隔不符", line: record.number, hit: "" });
      chapterHasH2 = true;
    }
    previousLevel = record.level;
  }
  return findings;
}

/**
 * 檢查相對連結：檔案存在，連到章節時那個標題也存在。
 * @param {ReturnType<typeof parseMarkdown>} records 帶種類的行。
 * @param {(path: string) => Set<string>|null} anchorsAt 回傳相對路徑那個檔案的錨點，空字串是本檔，檔案不存在時回傳 null，Markdown 以外的檔案回傳空集合。
 * @returns {{ rule: string, line: number, hit: string }[]}
 */
function checkLinks(records, anchorsAt) {
  const findings = [];
  // 程式碼區塊以外的行都檢查
  for (const record of records) {
    // 程式碼裡的方括號不是連結
    if (record.kind === "code" || record.kind === "fence" || record.kind === "blank") continue;
    const visible = record.text.replace(INLINE_CODE_RE, "");
    // 逐一檢查這一行的連結
    for (const match of visible.matchAll(LINK_RE)) {
      const target = match[3];
      // 網址與信箱不在 repo 內
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || !target) continue;
      const [path, fragment] = target.split("#");
      const anchors = anchorsAt(decodeURI(path));
      // 檔案不存在，或章節不在那個檔案的標題中
      const missing = anchors === null || (fragment && anchors.size > 0 && !anchors.has(decodeURIComponent(fragment).toLowerCase()));
      // 連到 Markdown 的章節而那個檔案沒有任何標題時也算失效
      const emptyTarget = fragment && anchors !== null && anchors.size === 0 && (path === "" || path.endsWith(".md"));
      // 兩種情形都列為失效
      if (missing || emptyTarget) findings.push({ rule: "連結失效", line: record.number, hit: target });
    }
  }
  return findings;
}

export { parseMarkdown, maskLine, anchorsOf, checkStructure, checkLinks };
