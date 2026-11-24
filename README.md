# 台灣政策圖譜

從你關心的議題，了解候選人的政策。先設定議題重視度，再回答由候選人政見寫成的題目。作答時看不到候選人的身分，結果頁的每個分數都能追溯到選舉公報的原文，翻牌後才顯示身分。網站也收錄主題測驗，以已發表的測驗與長期民調的原題看自己的立場。

這個 repo 有兩部分：`src/` 的靜態網站，以及把中選會名冊與選舉公報變成題組的資料管線 `scripts/pipeline/`。管線的產物提交在 `data/`，網站建置時直接讀取。修改網站、收錄一場選舉或新增一套主題測驗的步驟見 [CONTRIBUTING.md](CONTRIBUTING.md)。

<br>

## 目錄

- [台灣政策圖譜](#台灣政策圖譜)
  - [目錄](#目錄)
  - [功能特色](#功能特色)
  - [資料範圍](#資料範圍)
  - [技術棧](#技術棧)
  - [安裝與啟動](#安裝與啟動)
  - [常用指令](#常用指令)
  - [產生與校驗腳本](#產生與校驗腳本)
  - [專案結構](#專案結構)
  - [架構](#架構)
  - [使用方式](#使用方式)
  - [功能限制](#功能限制)
  - [資料來源](#資料來源)
  - [隱私權](#隱私權)
  - [版本與發行](#版本與發行)
  - [文件入口](#文件入口)
  - [致謝](#致謝)
  - [授權](#授權)

<br>

## 功能特色

作答前先選一個題組：一場選舉的選舉比對，或一套主題測驗。選舉比對依序是選擇、選區、議題重視度、作答與結果，主題測驗選好後直接作答。各頁的功能如下：

- 選舉取自中選會的名冊與選舉公報，先選年度再選職位，選區從地圖或清單選取。
- 議題重視度沿議題分類樹分配權重，可以細分到第 2 層，也可以略過使用均等權重。
- 作答一題一頁，量尺題是五級量尺，單選題列出選項，每題都可以略過。候選人做法不同的地方以子題追問，題號與導覽跟著作答路徑調整。
- 作答時與翻牌前遮蔽候選人的身分，候選人以甲、乙、丙代稱，翻牌後圖表改用政黨色。
- 選舉比對的結果非零和，立場契合、具體度與議題重疊分開呈現，未表態記為未知並另算涵蓋率。
- 結果頁有總分長條、意識形態雷達、議題 × 候選人熱力圖、分數歸屬桑基圖與議題分布 treemap，每張卡的說明列出回答的問題、讀法、公式與代入值、資料來源與用到的設定值。
- 計分參數可以即時調整，附 Kendall τ-b 敏感度，以及全部非常同意、全部中立、全部非常不同意的固定作答檢驗。
- 主題測驗與選舉比對分開計算，結果是自己在各軸上的位置與最接近的參照點，單選題並列全國對照。
- 資料集頁以表格瀏覽每個題組用到的資料，匯出 JSON、TSV、CSV，也可以匯入自訂題庫 CSV 與設定 JSON。
- 分享連結帶資料版本、引擎、設定與詞表的雜湊，對方開啟時以唯讀的觀看模式重播同一組答案。
- 主題可選跟隨系統、淺色或深色，縮放可選縮小、預設或放大，手機版以底部分頁列切換頁面。

<br>

## 資料範圍

名冊、政見收錄、主題測驗與地圖的範圍如下：

| 項目 | 範圍 |
|---|---|
| 名冊 | 2022 地方選舉與 2024 中央選舉，取自中選會選舉資料庫；2026 直轄市長與縣市長，選前依選舉公報抄錄 |
| 政見收錄 | 2022 地方選舉、2024 中央選舉與 2026 直轄市長、縣市長的選舉公報政見，逐場收錄。尚未收錄的選舉可以瀏覽名冊，選擇頁標示「尚無政見資料」 |
| 主題測驗 | 8values 政治光譜、兩岸立場、台灣地位詮釋（探索性） |
| 地圖 | 22 縣市與 368 鄉鎮市區 |
| 介面語言 | 正體中文 |

<br>

## 技術棧

| 類別 | 技術 | 責任 |
|---|---|---|
| 前端 | Preact 11.0.1 與 JSX | 元件寫在 `src/blocks/` 與 `src/app/`，其餘各層是純 JavaScript 模組 |
| 打包 | esbuild 0.28.2 | 把 `src/` 打包成 `web/app.js` |
| 樣式 | Tailwind CSS 4.3.3 | 色彩 tokens 定義在 `src/styles.css` |
| 字型 | Chiron GoRound TC、subset-font 2.9.0 | 建置時抽出網站用到的字，依碼位分成數份 woff2 |
| 圖表與圖示 | 自寫的 SVG 與 HTML 元件 | 圖表登錄在 `src/blocks/block.jsx`，圖示在 `src/blocks/icons.js` |
| 資料管線 | Python 3.10 以上：pypdf、Pillow、fontTools、pypdfium2、PyYAML | 名冊與公報的下載、抽取、核對與發布，主題測驗手寫表的核對與發布 |
| 文字辨識 | Apple Vision | 公報政見影像的 OCR，只在 macOS 執行 |
| 寫作檢查 | Node.js 22 以上 | 文件與程式註解的版面與行文 |
| 發布 | Netlify、Netlify CLI 27.20.1 | 推送 `v*` 標籤時建置並部署 `web/` |

<br>

## 安裝與啟動

網站需要 Node.js 22 以上。`npm start` 先建置再啟動本機伺服器，瀏覽器開啟 <http://localhost:8080/>。第一次建置從 google/fonts 下載網站字型，需要網路：

```bash
npm install
npm start
```

資料管線另外需要 Python 3.10 以上，只有收錄資料與執行管線的測試時才要安裝。公報影像的文字辨識使用 Apple Vision，抽取階段要在安裝 Xcode Command Line Tools 的 macOS 執行：

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/pipeline/requirements.txt
```

<br>

## 常用指令

指令都從 repo 根目錄執行，每支腳本的參數以 `--help` 列出：

| 指令 | 說明 |
|---|---|
| `npm start` | 建置網站後啟動本機伺服器 |
| `npm run build` | 只建置網站，輸出到 `web/` |
| `npm run serve` | 只啟動本機伺服器，沿用已建置的 `web/` |
| `npm run pipeline -- <階段> <工具>` | 執行管線一個階段的一支工具，階段與工具見 [架構的資料管線](#資料管線) |
| `npm run pipeline -- run` | 依序執行每場選舉從抓取到發布的各階段，`--election` 指定一場，`--offline` 只用已下載的原始檔 |
| `npm run pipeline -- tables` | 檢查全部設定表的寫法與分類樹的父子關係 |
| `npm test` | 執行 `tests/` 的全部測試 |
| `npm run check` | 檢查 `src/` 的分層與 Python 的排版 |
| `npm run lint` | 檢查文件與程式註解的版面與行文 |
| `npm run test:browser` | 以一個無頭的 Chrome 走過選舉比對與主題測驗的流程，需要本機的 Chrome 與已建置的 `web/` |

<br>

## 產生與校驗腳本

`scripts/` 依領域分目錄，`tests/` 與 `docs/` 用同一組領域名稱。每個領域的進入點如下，管線各階段的工具列在 [架構的資料管線](#資料管線)：

| 腳本 | 讀取 | 產生 | 執行的時機 |
|---|---|---|---|
| `scripts/site/build.mjs` | `src/`、`config/`、`assets/`、`data/60-publish/`、`data/geo/map.json`、`data/geo/villages/` 與資料集引用的政見影像 | `web/` | `npm run build`、`npm start` |
| `scripts/site/serve.mjs` | `web/` | 不產生檔案，在 8080 埠提供 `web/` | `npm run serve`、`npm start` |
| `scripts/site/imports.mjs` | `src/` 每個模組的 import | 不產生檔案，列出違反分層的 import | `npm run check` |
| `scripts/pipeline/__main__.py` | `data/` 各階段的手寫輸入、`config/tables/`、`.cache/sources/` 的原始下載 | `data/` 各階段的產物 | `npm run pipeline`，收錄資料時 |
| `scripts/writing/lint.mjs` | 根目錄的文件、`docs/` 與程式的註解 | 不產生檔案，列出發現項目 | `npm run lint`，提交之前 |
| `tests/site/browser.mjs` | `web/` 與 `data/60-publish/index.json` | 不產生檔案，每項檢查印出一行 | `npm run test:browser`，變更畫面之後 |

<br>

## 專案結構

`src/` 是手寫的網站原始碼，`web/` 是 `npm run build` 由 `src/`、`config/`、`assets/` 與 `data/` 產生的網站，部署的是 `web/`，它列在 `.gitignore`。各目錄的內容如下：

```text
taiwan-policy-atlas/
├── src/                  # 網站原始碼，分層見「架構」
├── web/                  # 建置產物：打包的程式、樣式、字型、設定表、資料集與政見影像
├── config/               # 網站執行時讀取的設定
│   ├── app/              # 計分參數、頁面與卡片的版面、介面文案
│   └── tables/           # 設定表，管線也讀取
├── data/                 # 管線每個階段的手寫輸入與產物
│   ├── sources.yaml      # 選舉與地圖的來源登錄
│   ├── 10-fetch/         # 每場選舉的定義與下載清單
│   ├── 20-extract/       # 名冊、轉錄稿、遮蔽詞與政見影像
│   ├── 30-claims/        # 主張
│   ├── 40-match/         # 題目、配題與軸對應
│   ├── 50-score/         # 具體度與中立性
│   ├── 60-publish/       # 網站讀取的資料集與題組索引
│   ├── topics/           # 每套主題測驗的定義與手寫表
│   └── geo/              # 地圖的設定、縣市地圖與村里地圖
├── assets/               # 品牌標誌
├── docs/                 # 依領域分目錄的主題文件
│   ├── site/             # 計分方法、分享與狀態、各頁的版面、元件的規格
│   ├── pipeline/         # 每個階段的步驟與判讀規則
│   └── writing/          # 文件與註解的寫法
├── scripts/              # 依領域分目錄的程式
│   ├── site/             # 建置、本機伺服器、分層檢查
│   ├── pipeline/         # 資料管線，每個階段一個目錄
│   └── writing/          # 寫作檢查
└── tests/                # 與 scripts/ 同名的測試目錄
    ├── site/
    ├── pipeline/
    └── writing/
```

<br>

## 架構

### 前端分層

`src/` 分成八層，依賴只能往下，每層可以引用的層寫在 `scripts/site/imports.mjs`：

| 層 | 目錄 | 職責 |
|---|---|---|
| lib | `src/lib/` | 與專案無關的通用工具 |
| config | `src/config/` | 載入 `config/app/` 的設定、版面與文案 |
| registry | `src/registry/` | 具名策略：總分公式、契合度、立場彙總、共識判定、參照點距離、匯入解析 |
| data | `src/data/` | 載入索引、設定表、地圖與資料集，依題組種類建立資料模型 |
| metrics | `src/metrics/` | 作答路徑、權重、立場、具體度、重疊度、總分、意識形態軸、敏感度與遮蔽 |
| cards | `src/cards/` | 狀態、動作、分享、視窗內容與每張卡片的描述 |
| blocks | `src/blocks/` | Preact 元件，依卡片的描述畫出區塊、圖表與頁面外框 |
| app | `src/app/` | 開機、路由、事件委派與效果 |

### 資料管線

管線分階段執行，每個階段讀取上一個階段的產物與這個階段的手寫輸入。`data/`、`scripts/pipeline/`、`tests/pipeline/` 與 `docs/pipeline/` 用同一組階段名稱，階段的工具是 `scripts/pipeline/{階段}/` 的一個檔案，以 `npm run pipeline -- <階段> <工具>` 執行。一場選舉依下表由上而下進行，發布階段另外讀取地圖的產物。主題測驗與地圖不讀選舉：

| 階段 | 資料 | 這個階段的工作 | 步驟與判讀規則 |
|---|---|---|---|
| `fetch` | `data/10-fetch/` | 登錄來源，下載並核對原始檔 | [fetch](docs/pipeline/fetch.md) |
| `extract` | `data/20-extract/` | 匯入名冊，轉錄公報政見，登錄遮蔽詞 | [extract](docs/pipeline/extract.md) |
| `claims` | `data/30-claims/` | 把政見拆成主張，填寫受控欄位 | [claims](docs/pipeline/claims.md) |
| `match` | `data/40-match/` | 把主張分配到面向，出題，判讀立場 | [match](docs/pipeline/match.md) |
| `score` | `data/50-score/` | 評主張的具體度，審查題目的中立性 | [score](docs/pipeline/score.md) |
| `publish` | `data/60-publish/` | 寫出資料集與索引，檢視題組的區辨力 | [publish](docs/pipeline/publish.md) |
| `topics` | `data/topics/` | 核對主題測驗的手寫表，發布題組 | [topics](docs/pipeline/topics.md) |
| `geo` | `data/geo/` | 把村里界線轉成縣市地圖與各縣市的村里地圖，登錄村里異動 | [geo](docs/pipeline/geo.md) |

<br>

## 使用方式

### 作答

首頁按「開始作答」進入選擇頁，頁面分成選舉比對與主題測驗。選舉比對選擇年度與職位，有選區的選舉再到地圖或清單選定選區，全國性選舉直接進入議題重視度。主題測驗不分選區，也沒有議題重視度，選好一套測驗就進入作答頁。

量尺可以用滑鼠點選，也可以按數字鍵 1 到 5，單選題的選項依序對應數字鍵。作答後停在這一題，可以先改選答案再按「下一題」。「看看候選人怎麼說（姓名已遮蔽）」開啟遮蔽後的原文與判讀理由，主題測驗在同一個位置放「原題與出處」。

作答要一次做完。作答到一半按「放棄作答」或回到其他頁時會先確認，確定後這次的作答放棄，下次從第一題重新開始，作答中關閉分頁也一樣。重新整理頁面時接著作答。

### 結果

每一題都作答或略過後，頁首導覽與步驟列的「結果」才開放。結果頁上方的勾選列點選要比較的候選人，「翻牌」顯示姓名與黨名，圖表同時換成政黨色，再按一次蓋牌。每張卡右上角的「說明」與右鍵（觸控長按）開啟公式與代入值。主題測驗的結果頁沒有候選人與翻牌，卡片依題組的設定列出，計分方式見 [計分方法的主題測驗](docs/site/methodology.md#主題測驗)。

### 分享與保存

「分享連結」產生帶作答、議題重視度與參數的網址，對方開啟時進入觀看模式，看到分享者的結果，對方自己的作答保持原樣。觀看模式的完整規則見 [分享與狀態](docs/site/sharing.md)。作答只存在瀏覽器的 localStorage，換裝置或清除瀏覽資料前，到資料集頁的本機資料區匯出檔案。

<br>

## 功能限制

| 項目 | 限制與處理 |
|---|---|
| 涵蓋率 | 每位候選人的公報政見只涵蓋部分題目，涵蓋率隨作答變動，結果頁把涵蓋率與上下界一併呈現 |
| 判讀方式 | 主張、配題與評分由模型依判準判讀，審核狀態標為「未經獨立複評」 |
| 主題測驗 | 8values 的題目由英文原題譯成正體中文，各軸權重、參照點的位置與計分方式照原測驗。兩岸立場照原句引用題目，全國比例只有統獨題。台灣地位詮釋的題目與軸由本站編寫，沒有經過驗證的量表。各題組的設定見 [計分方法](docs/site/methodology.md#各題組的設定) |
| 現任政府計畫 | 現任者以政府名義宣布的計畫與挑戰者的政見性質不同。已完成的政績不收錄，公報寫成時尚未完成的計畫標為現任政府計畫 |
| 選區界線 | 地圖是最新一版的村里界，選區由涵蓋的村里合併。選舉之後才分割或改名的村里以調整後的全部村里畫出，界線與當年可能略有出入 |
| 自訂資料 | 分享連結不帶自訂資料，自訂題庫與設定只影響匯入的瀏覽器 |

<br>

## 資料來源

原始下載存在 `.cache/sources/`，由 `.gitignore` 排除，重新下載後以登錄的 sha256 核對。選舉與地圖的來源登錄在 `data/sources.yaml`，公報網站的每份文件登錄在 `data/10-fetch/{選舉代碼}/election.yaml`，主題測驗的來源登錄在 `data/topics/{代碼}/topic.yaml`。各來源的用途與授權如下：

| 來源 | 用途 | 授權 |
|---|---|---|
| [中選會選舉資料庫](https://data.cec.gov.tw/) | 各場選舉的名冊 | 政府資料開放授權條款第 1 版 |
| 中選會 113 年選舉公報 | 政見原文與影像 | 政府資料開放授權條款第 1 版 |
| [中選會選舉公報網站](https://bulletin.cec.gov.tw/) | 政見原文與影像 | 政府資料開放授權條款第 1 版 |
| [中選會地方選舉公報網站](https://eebulletin.cec.gov.tw/) | 政見原文與影像 | 政府資料開放授權條款第 1 版 |
| [內政部國土測繪中心村(里)界](https://data.gov.tw/dataset/7438) 1150817 | 縣市、鄉鎮市區與選區界線 | 政府資料開放授權條款第 1 版 |
| [8values](https://8values.github.io/) commit `3971ed8` | 8values 政治光譜的題目、各軸權重與參照意識形態 | MIT |
| [陸委會「本會民意調查」例行民調](https://data.gov.tw/dataset/9078) | 兩岸立場統獨題的原題與最新一期的全國比例，民調由國立政治大學選舉研究中心執行 | 政府資料開放授權條款第 1 版 |
| [臺灣選舉與民主化調查（TEDS）](https://teds.nccu.edu.tw/) TEDS2003 問卷 K2、K3 題 | 兩岸立場條件式統獨題的原題 | 引用原題並註明出處，著作權屬原機構 |
| [國立政治大學選舉研究中心](https://esc.nccu.edu.tw/PageDoc/Detail?fid=7804&id=6960) 研究方法說明與認同趨勢 | 兩岸立場身分認同題的原題與趨勢頁連結 | 引用原題並註明出處，著作權屬原機構 |
| 台灣地位詮釋各題節錄的文件：開羅宣言、波茨坦公告、日本降伏文書、舊金山和約、中日和約、聯大 2758 號決議、上海公報、台灣關係法、憲法增修條文、兩岸人民關係條例、反分裂國家法、2021 年國慶演說 | 題目說明的節錄，每題的出處與網址寫在題目表的出處欄 | 法規、條約與政府文書依著作權法第 9 條不受著作權保護，其餘為合理引用並註明出處 |
| [smartvote smartspider](https://backend.smartvote.ch/en/smartspider)、[TEDS 統獨立場趨勢](https://esc.nccu.edu.tw/PageDoc/Detail?fid=7805&id=6962) | 意識形態軸的定義參考 | 只參考定義，沒有取用資料 |

<br>

## 隱私權

網站沒有後端，也沒有接追蹤或分析服務。作答、議題重視度、參數與自訂資料只寫在瀏覽器的 localStorage，分享連結由使用者自行決定是否傳出。

<br>

## 版本與發行

推送 `v*` 標籤時，GitHub Actions 執行測試與檢查、建置網站並把 `web/` 部署到 Netlify，流程寫在 `.github/workflows/deploy.yml`。部署讀取提交的 `data/`，管線只在本機執行。每個題組的資料版本是資料集內容的雜湊，列在網站的更新紀錄頁。發行的步驟見 [CONTRIBUTING 的版本與發行](CONTRIBUTING.md#版本與發行)。

<br>

## 文件入口

| 主題 | 位置 |
|---|---|
| 鐵律、各主題的權威來源、每種任務的入口 | [AGENTS.md](AGENTS.md) |
| 內容的分類、修改網站與收錄資料的步驟、驗證、分支與發行 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 視覺的原則、色彩、字型、元件、版面、層次與響應式的規則 | [DESIGN.md](DESIGN.md) |
| 字級的角色與每一頁各個位置的字級、間距與對齊 | [docs/site/pages.md](docs/site/pages.md) |
| 每個元件與圖表的規格、系列色與政黨色、鍵盤與焦點 | [docs/site/components.md](docs/site/components.md) |
| 計分方法、權重分配、敏感度分析與主題測驗的計分 | [docs/site/methodology.md](docs/site/methodology.md) |
| 狀態、分享連結與觀看模式、匯出與匯入、自訂資料 | [docs/site/sharing.md](docs/site/sharing.md) |
| 管線每個階段的輸入、步驟、判讀規則、核對與產物 | `docs/pipeline/` 與階段同名的文件，見 [資料管線](#資料管線) |
| 轉交與雜湊、表的共用寫法、設定表 | [docs/pipeline/table-contract.md](docs/pipeline/table-contract.md) |
| 詞表與分類樹的增修判準、詞表版本 | [docs/pipeline/vocabulary-policy.md](docs/pipeline/vocabulary-policy.md) |
| 判讀的複評、抽查與分工 | [docs/pipeline/review-protocol.md](docs/pipeline/review-protocol.md) |
| 文件與程式註解的寫法、寫作檢查的判讀 | [docs/writing/rules.md](docs/writing/rules.md) |
| 程式的授權 | [LICENSE](LICENSE) |
| 自產資料的授權與涵蓋的檔案 | [LICENSE-DATA](LICENSE-DATA) |

<br>

## 致謝

地圖、意識形態軸與主題測驗使用的來源列在 [資料來源](#資料來源)，感謝各來源的作者與維護者。文字辨識與網站字型使用下列工具：

- [Apple Vision](https://developer.apple.com/documentation/vision)：公報影像的文字辨識。
- [Chiron GoRound TC](https://github.com/google/fonts/tree/main/ofl/chirongoroundtc)：網站字型，由 Google Fonts 收錄。

<br>

## 授權

程式採 [MIT License](LICENSE)。網站打包的 [Preact](https://preactjs.com/) 同為 MIT License，網站字型 Chiron GoRound TC 採 SIL Open Font License 1.1，建置時抽出網站用到的字隨網站發布，兩者的授權全文隨建置寫入 `web/licenses/`。

原始資料依各來源的授權標示。本專案自產的轉錄稿、遮蔽詞表、主張編碼、配題、意識形態軸對應、具體度評分、中立性審查、題目、受控詞表，以及主題測驗的正體中文翻譯與表格整理採 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，涵蓋的檔案與各主題測驗原題的權利歸屬列在 [LICENSE-DATA](LICENSE-DATA)。轉錄稿中的公報原文依原發布機關的政府資料開放授權條款，本專案只就轉錄、校對與結構化的部分授權。
