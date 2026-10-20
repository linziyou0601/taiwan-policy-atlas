# AGENTS.md

本檔是台灣政策圖譜給 agent 與維護者的入口頁，定義文件權威順序、主題權威來源、鐵律與各類工作的入口。

產品與使用方式見 [README.md](README.md)，開發、檢查與發行流程見 [CONTRIBUTING.md](CONTRIBUTING.md)，視覺與互動規格見 [DESIGN.md](DESIGN.md)。

<br>

## 文件權威順序

規則互相衝突時，依下表取順序在前者。文件與程式不一致時，視覺與互動以 [DESIGN.md](DESIGN.md) 為準修正程式，計分、管線、分享與其餘行為以設定與程式為準更新文件：

| 優先順序 | 來源 | 職責 |
|---:|---|---|
| 1 | `config/app/`、`config/tables/`、`config/pipeline/` | 設定與定義表 |
| 2 | [AGENTS.md](AGENTS.md) | 鐵律 |
| 3 | [CONTRIBUTING.md](CONTRIBUTING.md) | 架構、檢查與流程 |
| 4 | [DESIGN.md](DESIGN.md) | 視覺與互動 |
| 5 | `docs/`、[README.md](README.md) | 方法文件與產品說明 |

<br>

## 主題權威來源

| 主題 | 權威來源 |
|---|---|
| 計分公式、參數、可調範圍 | `config/app/settings.json`，策略實作在 `src/registry/` |
| 頁面、版型、卡片、入口、鎖定條件與適用的題組種類 | `config/app/layout.json` |
| 介面文案 | `config/app/locale.zh-TW.json` |
| 議題分類、判準、量尺、來源類型、意識形態軸、政黨標記 | `config/tables/*.tsv` |
| 設定表的檔名與表頭 | `config/app/settings.json` 的 `tables`，網站與管線共用 |
| 受控詞表與待審詞 | `config/tables/vocab-terms.tsv`、`config/tables/vocab-pending.tsv` |
| 來源登錄與選舉設定 | `config/pipeline/sources.yaml`、`config/pipeline/elections/*.yaml` |
| 主題測驗的設定、原始檔、全國對照與用到的卡片 | `config/pipeline/topics/*.yaml` |
| 主題測驗的題目、選項、軸對應與參照點 | `data/topics/{代碼}/` 的 `questions.tsv`、`options.tsv`、`question-axes.tsv`、`references.tsv` |
| 政見編碼的步驟與判讀規則 | `.claude/skills/policy-coding/` |
| 色彩、字級、版面規格 | [DESIGN.md](DESIGN.md)，由 `src/styles.css` 實作 |
| 第 1 層議題圖示、按鈕圖示與品牌標誌的圖形 | `src/blocks/icons.js` |
| 計分方法 | `docs/methodology.md` |
| 資料管線 | `docs/pipeline.md` |
| 狀態、分享與自訂資料 | `docs/sharing.md` |
| 受控欄位與詞表版本 | `docs/vocabulary.md` |

<br>

## 鐵律

| 領域 | 規則 |
|---|---|
| 分層 | 前端依賴只能往下，每層可引用的層寫在 `scripts/check-imports.mjs` 的 `LAYER_RULES`，違反時檢查失敗。app 引用 cards 與 blocks，blocks 只引用 config 與 lib。Preact 與 JSX 只用在 blocks 與 app |
| 顯示層 | blocks 依 cards 傳入的描述繪製畫面，cards 經由 metrics 取得資料 |
| 管線雜湊 | 管線每層只讀上一層的產物，前面的層改過而後面沒有重新執行時，雜湊核對失敗 |
| 詞表 | 主張的受控欄位只能寫詞表已登錄的名稱，未登錄的概念先寫進待審表 `vocab-pending.tsv`，裁定前主張層失敗 |
| 未表態 | 未表態記為未知，不記為 0 也不記為中立 |
| 遮蔽 | 翻牌前不顯示姓名、搭檔、黨名、暱稱與口號，遮蔽詞來自名冊與 `aliases.tsv`，程式不寫死任何人名或黨名 |
| 證據 | 新聞只當線索，立場證據一律引用本人原文。現任者已完成的政績不收錄 |
| 文案 | 介面文案寫在 locale，程式不寫文案，也不以字串拼接 HTML |
| 隱私 | 不接任何追蹤或分析服務，狀態只寫 localStorage |
| 註解 | 程式每個分支點上方要有註解，連續的程式每三個邏輯行至少一則註解，以 `scripts/check-comments.mjs` 檢查。註解的行文依 rule-writing，以 `scripts/lint-comments.mjs` 檢查 |

<br>

## 工作流入口

| 任務 | 入口 |
|---|---|
| 新增一場選舉的名冊 | 依 [新增一場選舉](CONTRIBUTING.md#新增一場選舉) |
| 編碼一場選舉的政見 | 依 [政見編碼 skill](.claude/skills/policy-coding/SKILL.md) |
| 新增一套主題測驗 | 寫 `config/pipeline/topics/{代碼}.yaml` 與 `data/topics/{代碼}/` 的手寫表，執行 `.venv/bin/python -m pipeline topic --topic {代碼}`，步驟依 [新增一套主題測驗](CONTRIBUTING.md#新增一套主題測驗) |
| 調整計分參數或公式 | 改 `config/app/settings.json`。新公式在 `src/registry/formulas.js` 登錄，locale 的 `registry` 寫名稱與說明 |
| 新增一張結果卡 | 在 `src/cards/` 的卡片表登錄 build，`config/app/layout.json` 的頁面加上卡片、`span` 與 `frame`，結果頁另寫 `section`，含逐題作答的卡片加 `private`，locale 的 `cards` 寫標題、問題與讀法 |
| 新增一種區塊或圖表 | `src/blocks/` 寫元件並在 `src/blocks/block.jsx` 的 `BLOCKS` 登錄 |
| 新增一種視窗 | `src/cards/modals.js` 的 `buildModal` 登錄種類，locale 寫標題與文字 |
| 新增一種題組種類 | 資料層的 `MODEL_BUILDERS`、計分層的 `ENGINES` 與 `config/app/layout.json` 的 `kinds` 各登錄一筆，卡片層的種類表各補一筆，layout 的頁面與卡片以 `kinds` 標出適用的種類，登錄處依 [題組種類](CONTRIBUTING.md#題組種類) |
| 修改分類樹或判準 | 改 `config/tables/`，執行 `.venv/bin/python -m pipeline tables` 與 `run`。新增第 1 層議題時在 `src/blocks/icons.js` 補圖示 |

<br>

## 跨 agent 協作

共享的規則與資料都在 repo 裡：設定在 `config/`，各層產物與手寫表在 `data/`，政見編碼的步驟在 `.claude/skills/policy-coding/`。subagent 的數量、派工、草稿位置、核對與審核狀態依 [review-protocol](.claude/skills/policy-coding/references/review-protocol.md)。

<br>

## 其他

- 一次性的工作檔（截圖、量測、log、臨時腳本）放在 session 的暫存目錄，`scripts/check-files.mjs` 列出 repo 中不屬於任何類別的檔案
- 原始下載的位置與核對方式見 [README 的資料來源](README.md#資料來源)
- 文件與註解寫現況，變更經過寫在 commit message 與 PR。發版之後，使用者看得到的變更另寫進 locale 的 `changelog.items`

<br>

## 寫作檢查

專案的版面、翻譯與文件分工見 `config/writing/project-policy.md` 與 `config/writing/docs-entry-policy.md`，執行時使用本 repo 的 skill 與設定。

文件與程式註解依本 repo 的 [rule-writing](.claude/skills/rule-writing/SKILL.md) 規則撰寫，lint 從本 repo 根目錄執行，路徑設定放在 `config/writing/layout-profiles.tsv`。程式註解由 `scripts/lint-comments.mjs` 抽取到 `.cache/comments/` 後檢查，回報的路徑是原始檔加 `.txt`，行號與原始檔相同：

```bash
node .claude/skills/rule-writing/scripts/lint.mjs README.md AGENTS.md CONTRIBUTING.md DESIGN.md docs .claude --root . --project config/writing
npm run lint:comments
node .claude/skills/rule-writing/scripts/lint.mjs --text "待檢查的交付文字"
```
