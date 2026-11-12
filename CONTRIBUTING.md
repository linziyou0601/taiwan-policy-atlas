# Contributing

本文件說明台灣政策圖譜的架構、檢查與流程，開發前先閱讀 [AGENTS.md](AGENTS.md) 與 [DESIGN.md](DESIGN.md)。

<br>

## 開發環境

網站、管線與文字辨識各有環境需求，安裝指令接在表後：

| 項目 | 版本 |
|---|---|
| Node.js | 22 以上，內建的 `node --test` 執行前端測試 |
| Python | 3.10 以上，套件依 `requirements.txt` |
| macOS | 公報影像的文字辨識使用 Apple Vision，管線第一次執行時以 `swiftc` 編譯 `pipeline/ocr_vision.swift` |

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

<br>

## 建置與啟動

前端以 npm 建置與啟動：

```bash
npm run build      # 只建置前端，輸出到 web/
npm start          # 建置後啟動本機伺服器 http://localhost:8080/
npm run serve      # 只啟動本機伺服器，沿用已建置的 web/
```

管線另以 Python 執行，產物寫在 `data/` 並提交。重建全部產物依序執行下列指令，各指令的參數見 [docs/pipeline.md](docs/pipeline.md)：

```bash
.venv/bin/python -m pipeline run             # 依序執行全部選舉的各層
.venv/bin/python -m pipeline geo --offline   # 轉出選區地圖並核對各場名冊
.venv/bin/python -m pipeline topic --offline # 核對並發布全部主題測驗
```

### 網站字型

`scripts/build.mjs` 依固定在 google/fonts 一個 commit 的網址與 sha256 下載網站字型 Chiron GoRound TC，原始檔快取在 `.cache/sources/fonts/`。字型依網站用到的字以 subset-font 抽字，結果依字集的雜湊快取在 `.cache/fonts/`，授權全文寫入 `web/licenses/chiron-goround-tc.txt`。第一次建置需要網路，之後快取的雜湊相符時直接使用。

<br>

## 技術棧

前端、打包、樣式與管線使用的技術如下：

| 類別 | 技術 | 責任 |
|---|---|---|
| 前端 | Preact 11.0.1 與 JSX | 元件寫在 blocks 與 app，其餘各層是純 JavaScript 模組 |
| 打包 | esbuild 0.28.2 | JSX 以 esbuild 的 automatic 模式轉換，`jsxImportSource` 是 preact |
| 樣式 | Tailwind CSS 4.3.3 | 色彩 tokens 定義在 `src/styles.css` |
| 字型 | Chiron GoRound TC、subset-font 2.9.0 | 網站字型，建置時抽出用到的字，輸出 woff2 |
| 圖表與圖示 | 自寫的 SVG 與 HTML 元件 | 圖表登錄在 `src/blocks/block.jsx` 的 `BLOCKS`，圖示在 `src/blocks/icons.js` |
| 壓縮與雜湊 | 瀏覽器內建的 CompressionStream 與 Web Crypto | 分享連結的壓縮、資料與設定的雜湊 |
| 管線 | Python 3：pypdf、Pillow、fontTools、PyYAML | 名冊與公報的抓取、抽取、核對與發布，主題測驗手寫表的核對、全國對照的取出與發布 |
| 文字辨識 | Apple Vision | 公報政見欄影像的 OCR |

<br>

## 架構

前端依賴只能往下，每層可以引用的層見 `scripts/check-imports.mjs` 的 `LAYER_RULES`。

各層的目錄與職責：

| 層 | 目錄 | 職責 |
|---|---|---|
| lib | `src/lib/` | 與專案無關的通用工具 |
| config | `src/config/` | 載入 `config/app/` 的設定、版面與文案 |
| registry | `src/registry/` | 具名策略：總分公式、契合度、立場彙總、共識判定、參照點距離、匯入解析 |
| data | `src/data/` | 載入建置清單、索引、設定表、地圖、資料集與選舉的選區檔，依題組種類建立資料模型，併入使用者匯入的自訂題庫 |
| metrics | `src/metrics/` | 作答路徑、權重、立場、具體度、重疊度、總分彙總、意識形態軸、敏感度、遮蔽、主題測驗的軸位置與參照點距離，以及分數歸屬與圖表用的衍生資料 |
| cards | `src/cards/` | 狀態、動作、分享、視窗內容（`src/cards/modals.js`），以及每張卡片的描述與 info |
| blocks | `src/blocks/` | Preact 元件，依卡片描述畫出區塊、圖表、議題圖示與頁面外框，資料來源留在 cards 層。一串區塊經由 `src/blocks/block.jsx` 的 `Blocks` 繪製 |
| app | `src/app/` | 開機、路由、以 Preact 繪製畫面、事件委派與效果（`src/app/main.jsx` 的 `EFFECTS`） |

### 題組種類

題組是作答的單位，種類有選舉（`election`）與主題測驗（`topic`）。索引的每一筆帶 `kind`，狀態的 `setId` 記目前的題組，各層依 `kind` 查自己的種類表，種類的分派只寫在下列登錄處：

| 層 | 登錄處 | 內容 |
|---|---|---|
| config | `config/app/layout.json` 的 `kinds` | 種類與特性，`scoped` 標出有沒有選區。頁面、卡片與 `sticky` 寫 `kinds` 時只用於列出的種類，沒有寫時每種都用，由 `src/cards/kit.js` 的 `fitsKind` 判斷。寫了 `kinds` 的卡片另依索引中題組的 `cards` 篩選，由 `fitsSet` 判斷 |
| registry | `src/registry/distances.js` | 主題測驗的參照點距離，題組的資料集以 `distance` 選用 |
| data | `src/data/model.js` 的 `MODEL_BUILDERS`、`src/data/load.js` 的 `DATASET_FORMATS` | 每種的資料模型與資料集格式。模型都有 `src/data/model.js` 的 `SharedModel` 定義的欄位，每題帶作答形式 `format`（`scale` 或 `choice`）與可選的答案 `choices`，作答、封存、意識形態軸與遮蔽共用同一套處理 |
| metrics | `src/metrics/kinds.js` 的 `ENGINES` | 每種的作答路徑與計分，卡片層呼叫 `questionsFor` 與 `resultsFor` |
| cards | 各模組的種類表 | 選擇頁的 `CHOOSE_GROUPS`、作答卡的 `QUIZ_PARTS`、題目視窗的 `QUESTION_MODALS`、分享圖片的 `SHARE_IMAGES`、資料版本表的 `SET_STATUS`，資料集檢視在 `DATASET_VIEWS` 寫 `kinds`。主題測驗的卡片在 `src/cards/topic.js` 的 `TOPIC_CARDS` |

### 資料管線

資料管線分層執行，每層只讀取上一層的產物。主題測驗不經過這些層，由 `topic` 指令核對手寫表後發布。各層與 `topic` 的指令、輸入與產物見 [docs/pipeline.md](docs/pipeline.md)。

<br>

## 檢查與測試

提交前執行下列檢查：

```bash
npm test               # node --test 與 Python unittest
npm run check          # import 圖、逐檔清單、註解密度、Python 排版
npm run lint:comments  # 使用本 repo 的 rule-writing 檢查程式註解的行文
```

各項檢查與測試涵蓋的內容：

| 檢查 | 內容 |
|---|---|
| `scripts/check-imports.mjs` | 依分層規則檢查每條 import，擋住反向依賴、未登錄的外部套件與不存在的檔案。Preact 與 JSX 只限 blocks 與 app |
| `scripts/check-files.mjs` | 每個檔案都屬於登錄的類別，沒有雜物、重複內容、孤兒模組，也沒有缺少設定的選舉或主題測驗目錄 |
| `scripts/check-comments.mjs` | 分支點上方有註解、連續的程式每三個邏輯行至少一則註解、沒有空白註解 |
| `black --check` | `pipeline/` 與 `tests/python/` 依 black 排版 |
| `scripts/lint-comments.mjs` | 把程式註解抽成行號對齊的純文字，以 rule-writing 的 lint 檢查行文，與文件同一套規則 |
| `tests/js/` | 策略登錄表、工具函式、計分規則、卡片與端對端流程、卡片 info 的代入值、分享重播、狀態的匯出與匯入、遮蔽、議題圖示與分類樹第 1 層一致，主題測驗的流程、計分與卡片 |
| `tests/python/` | 設定表寫法、分類樹、OCR 比對、名冊、地圖、主張與配題與評分的核對、雜湊轉交，主題測驗的手寫表、原始檔與全國對照的核對 |

### 瀏覽器檢查

變更畫面時，以 `npm start` 開啟網站後走過每一頁，淺色、深色、手機寬度與每種縮放各一次，與 [DESIGN.md](DESIGN.md) 的版面規格逐塊對照。作答頁另外以鍵盤走過一次量尺、略過與導覽，再開一次分享連結確認觀看模式。

<br>

## 分支規範

分支依用途命名：

| 分支 | 用途 |
|---|---|
| `main` | 可部署的版本 |
| `feature/{主題}` | 程式功能 |
| `data/{題組代碼}` | 一場選舉的政見收錄或名冊更新，或一套主題測驗的題目與翻譯 |
| `fix/{主題}` | 錯誤修正 |

<br>

## Pull request

PR 交付行為、資料與驗證證據，審查者可以依描述重現：

1. 描述寫改了什麼、為什麼、怎麼驗證。
2. 修改計分的 PR 附上已編碼選舉的固定作答檢驗前後對照。
3. 修改資料的 PR 附上管線摘要與資料版本。
4. `npm test` 與 `npm run check` 全部通過。

<br>

## Commit 格式

格式如下，類別寫 `feat`、`fix`、`data`、`docs`、`refactor`、`test`、`chore` 之一，摘要寫正體中文：

```text
{類別}: {摘要}

{內文：改了什麼、為什麼}
```

<br>

## 資料更新流程

### 新增一場選舉

1. 複製 `config/pipeline/elections/` 的一份設定改寫，名冊來源與目錄依中選會選舉資料庫。
2. 公報不在已登錄的來源時，在 `config/pipeline/sources.yaml` 登錄下載網址與 sha256。來源是網站目錄時，每份文件的路徑與 sha256 寫在選舉設定的 `documents`。
3. 執行 `.venv/bin/python -m pipeline run --election {選舉代碼}` 與 `.venv/bin/python -m pipeline geo`。
4. `npm test` 與 `npm run check` 通過後提交 `data/` 的產物。

### 移除一場選舉

1. 刪掉 `config/pipeline/elections/{選舉代碼}.yaml` 與 `data/` 各層的同名目錄，`npm run check` 會列出沒有對應設定的目錄。
2. 執行 `.venv/bin/python -m pipeline index` 重寫索引。
3. 來源登錄是多場選舉共用的，例如中選會選舉資料庫的封存檔供每場選舉的名冊使用。沒有任何選舉或地圖引用的來源要從 `config/pipeline/sources.yaml` 移除，`npm test` 會列出這些來源。

### 收錄政見

依 [政見收錄 skill](.claude/skills/policy-curation/SKILL.md) 逐步完成轉錄、拆分主張、填寫欄位、配題、評分與出題。

### 新增一套主題測驗

1. 複製 `config/pipeline/topics/` 的一份設定改寫：要以原始檔核對手寫表時參考 `8values.yaml`，要附全國對照時參考 `cross-strait.yaml`。
2. 原始檔登錄在設定的 `sources`。處理這些檔案的 adapter 要有 `topic` 或 `comparison` 能力，沒有時在 `pipeline/adapters/` 新增。
3. 在 `data/topics/{代碼}/` 寫 `questions.tsv`、`question-axes.tsv`、`references.tsv`，有單選題時另寫 `options.tsv`。設定的寫法見 [docs/pipeline.md 的主題測驗](docs/pipeline.md#主題測驗)，手寫表的欄位見 [docs/tables.md 的主題測驗手寫表](docs/tables.md#主題測驗的手寫表)。
4. 執行 `.venv/bin/python -m pipeline topic --topic {代碼}`，核對通過後寫出題組並更新索引。
5. `npm test` 與 `npm run check` 通過後提交 `config/pipeline/topics/`、`data/topics/` 與 `data/60-publish/` 的產物。

<br>

## 新增功能模式

每種擴充點的程式位置與登錄處：

| 要新增 | 位置 | 登錄 |
|---|---|---|
| 公式與策略 | `src/registry/` | `REGISTRIES` 中該類的登錄表，設定以名稱選用，locale 的 `registry` 寫名稱與說明 |
| 結果卡 | `src/cards/` | 模組的卡片表。`config/app/layout.json` 的卡片寫 `span`、`frame`，結果頁另寫 `section`，含逐題作答的卡片加 `private`，只用於部分題組種類的卡片加 `kinds`，主題測驗的卡片另列進題組設定的 `cards`。locale 的 `cards` 寫標題、問題與讀法 |
| 區塊或圖表 | `src/blocks/` 的元件 | `src/blocks/block.jsx` 的 `BLOCKS` |
| 視窗 | `src/cards/modals.js` 的內容函式 | `buildModal` 的種類表，locale 寫標題與文字 |
| 頁面版型 | `src/blocks/shell.jsx` 的 `Page` | `config/app/layout.json` 每頁的 `template` 與版型參數，規格見 [DESIGN.md](DESIGN.md) |
| 導覽入口 | `src/cards/index.js` 的 `buildPage` | `config/app/layout.json` 的 `nav`、`mobileNav`、`flow`，locale 的 `nav.tabs` 寫手機分頁列兩個字的短名稱 |
| 按鈕圖示 | `src/blocks/icons.js` 的 `UI_ICONS` | 按鈕描述的 `icon`，往前的動作加 `trailing`，只有圖示時加 `iconOnly` |
| 使用者動作 | `src/cards/actions.js` | `ACTIONS`，畫面以 `data-action="名稱:參數"` 觸發。檢視他人分享的結果時也能執行的動作另列在 `SHARED_ACTIONS` |
| 頁面的前提條件 | `src/cards/session.js` 的 `NEED_CHECKS` 登錄判斷 | 頁面的 `needs` 列出條件，頂層的 `needs` 寫提示卡按鈕的 `action` 與是否鎖住入口的 `lock`，locale 的 `needs` 寫提示卡與鎖定說明 |
| 第 1 層議題圖示 | `src/blocks/icons.js` | `ISSUE_ICONS`，鍵是 `taxonomy-issues.tsv` 第 1 層的代碼，`tests/js/blocks.test.mjs` 核對兩邊一致 |
| 換頁規則 | `src/cards/actions.js` 的 `enterPage` 與 `route` | 作答中的狀態記在 `view.quizOpen`，規則見 [README 的作答](README.md#作答) |
| 題組種類 | 各層的種類表 | `config/app/layout.json` 的 `kinds`，各層的登錄處見 [題組種類](#題組種類) |
| 來源 adapter | `pipeline/adapters/` | `pipeline/adapters/__init__.py` 的 `ADAPTERS` |
| 設定表 | `config/tables/` | `config/app/settings.json` 的 `tables` 登錄檔名與表頭，網站與管線讀同一份 |

<br>

## 版本與發行

推送 `v*` 標籤時，`.github/workflows/pages.yml` 安裝套件、執行測試與檢查、建置並把 `web/` 部署到 GitHub Pages。部署流程讀取提交的 `data/`，管線在本機執行。網站版本取自 git 標籤：`pages.yml` 以 `APP_VERSION` 把標籤帶入建置，`scripts/build.mjs` 寫入 `build.json`，頁尾、「更多」視窗與更新紀錄頁顯示它，本機建置時是 `dev`。

發行一個版本的步驟：

1. 在 locale 的 `changelog.items` 加一筆使用者看得到的變更。
2. 確認每個題組的資料版本與詞表版本，管線產物都已提交。
3. `npm test` 與 `npm run check` 通過後提交。
4. 以 `v{版本}` 標記並推送標籤，由 `pages.yml` 建置與部署。

<br>

## 程式寫法

各語言與檔案格式的寫法：

| 語言 | 寫法 |
|---|---|
| JavaScript | 檔頭以 `/* ===== */` 框線寫角色、指令與慣例，區段依型別定義、集中設定、共用片段、主體、匯出排列，常數用 UPPER_SNAKE，每個函式與常數寫中文 JSDoc |
| JSX | 只寫在 blocks 與 app 層的 `.jsx` 檔，元件名稱用 PascalCase，屬性寫 `class` 與 `data-*`。會改變網站狀態的互動寫 `data-action`，由 app 層委派。只影響元件自己畫面的互動用 Preact 的事件屬性與 hooks。子節點內的註解寫成 `{/* … */}` |
| Python | 模組 docstring 第一行寫摘要，隔一個空行寫用途，再依內容分成「指令：」「手寫輸入：」「產物：」「慣例：」段，標籤單獨一行、內容縮排兩格。函式 docstring 寫用途、參數、回傳與例外，區段以三行 `# ===` 框線分隔，以 black 排版 |
| TSV | 見 [資料表的共用寫法](docs/tables.md#共用寫法) |
| JSON | 前端設定的鍵用 camelCase，管線產物用 snake_case |
| YAML | 檔頭寫用途，每個鍵上方寫中文註解 |
| 註解 | 每個分支點上方寫註解，連續的程式每三個邏輯行至少一則註解。註解寫規則與理由，數值以設定檔為準。行文依 rule-writing，指令、公式與型別寫在反引號內 |

<br>

## 疑難排解

建置、管線與網站開機時常見的錯誤訊息與處理方式：

| 訊息 | 原因與處理 |
|---|---|
| 建置印出「找不到 data/60-publish/index.json」或「找不到 data/geo/map.json」，結束代碼 2 | 管線產物不在 `data/`。執行 `.venv/bin/python -m pipeline run --offline` 與 `.venv/bin/python -m pipeline geo --offline` |
| 建置印出「下載失敗」或「雜湊不符」 | 字型要從 google/fonts 下載，第一次建置時確認網路可用。雜湊不符表示下載內容與 `scripts/build.mjs` 記錄的 sha256 不同，建置中止 |
| 管線印出「{檔案} 在 {產物} 產生後修改過，從那一層起重新執行管線」 | 前面的層修改過，後面的層還沒有重新執行。從訊息指出的那一層起重新執行管線，通常是 `.venv/bin/python -m pipeline run --election {選舉代碼}` |
| `topic` 印出「references.tsv 的 {代碼} 與原始檔不同」這類手寫表與原始檔不符的訊息 | 手寫表的原文、方向乘權重、參照點位置或筆數與 `check` 宣告的原始檔不同。對照 `.cache/sources/` 的原始檔修正手寫表，原始測驗改版時一併更新題組設定 `sources` 的網址、sha256 與 `origin.version` |
| `topic` 印出「{檔案} 的 sha256 是 {值}，來源登錄的是 {值}」 | 原始檔與題組設定 `sources` 登錄的 sha256 不同。陸委會的民調 CSV 隨每期民調更新，核對新的一期後更新 sha256 |
| 抽取層印出「OCR 需要 macOS 與 swiftc」 | 影像或 OCR 工具修改過，`extract.json` 已提交的結果無法沿用。在安裝 Xcode Command Line Tools 的 macOS 上重新執行抽取層 |
| 網站顯示「程式與資料版本不一致」 | 瀏覽器快取了舊版的 `app.js` 或資料，與 `build.json` 的雜湊不同。重新建置後重新載入頁面，仍出現時清除這個網站的快取 |
