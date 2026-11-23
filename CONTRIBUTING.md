# 貢獻指南

修改這個 repo 時要改哪個檔案、照什麼步驟、怎麼驗證與提交，都寫在這裡。環境的準備、指令與目錄見 [README.md](README.md)，鐵律與各主題的權威來源見 [AGENTS.md](AGENTS.md)。工作分成兩種：開發網站，以及收集資料並建立題組，題組是一場選舉或一套主題測驗。

<br>

## 目錄

- [貢獻指南](#貢獻指南)
  - [目錄](#目錄)
  - [內容分類](#內容分類)
  - [開發網站](#開發網站)
  - [收錄一場選舉](#收錄一場選舉)
  - [新增一套主題測驗](#新增一套主題測驗)
  - [修改設定表](#修改設定表)
  - [修改管線](#修改管線)
  - [程式寫法](#程式寫法)
  - [本機驗證](#本機驗證)
  - [分支規範](#分支規範)
  - [Commit 與 PR](#commit-與-pr)
  - [版本與發行](#版本與發行)
  - [疑難排解](#疑難排解)

<br>

## 內容分類

repo 的每個檔案只有一種維護方式，類別決定要修改的是檔案本身還是它的來源：

| 類別 | 路徑 | 維護方式 |
|---|---|---|
| 程式 | `src/`、`scripts/`、`tests/` | 手寫，依 [程式寫法](#程式寫法)，修改後執行 [本機驗證](#本機驗證) |
| 網站設定 | `config/app/` | 手寫。計分參數在 `settings.json`，頁面與卡片在 `layout.json`，介面文案在 `locale.zh-TW.json` |
| 設定表 | `config/tables/`、`scripts/pipeline/tables/` | 手寫，依 [修改設定表](#修改設定表) |
| 管線的手寫輸入 | `data/sources.yaml`、各階段目錄的 `.yaml`、`.tsv` 與 `transcripts/` | 手寫，依那個階段的文件，修改後執行那個階段的 `run` |
| 管線的產物 | 各階段目錄的 `.json`、`data/20-extract/*/images/`、`data/60-publish/` | 由 `npm run pipeline` 從手寫輸入與原始下載產生，連同手寫輸入一起提交。要修改內容時修改輸入，再重新執行 |
| 建置產物 | `web/` | 由 `npm run build` 產生，列入 `.gitignore` |
| 快取 | `.cache/` | 原始下載、字型與工具的中間檔，列入 `.gitignore`，刪除後依登錄的 sha256 重新下載或重新產生 |
| 文件 | 根目錄的四份文件與 `docs/` | 手寫，依 [寫作規則](docs/writing/rules.md)，修改後執行 `npm run lint` |

<br>

## 開發網站

網站的行為由三處決定：`config/app/` 的設定、`src/` 各層的登錄表，以及 [DESIGN.md](DESIGN.md) 的外觀。調整計分參數時修改 `config/app/settings.json`，公式的意思見 [計分方法](docs/site/methodology.md)。變更畫面時依 [本機驗證的瀏覽器檢查](#瀏覽器檢查) 走過一次。新增一種東西時，在下表的位置實作並登錄，分層見 [README 的前端分層](README.md#前端分層)：

| 要新增 | 位置 | 登錄 |
|---|---|---|
| 公式與策略 | `src/registry/` | `REGISTRIES` 中該類的登錄表，設定以名稱選用，locale 的 `registry` 寫名稱與說明 |
| 結果卡 | `src/cards/` | 模組的卡片表。`layout.json` 的卡片寫 `span`、`frame`，結果頁另寫 `section`，含逐題作答的卡片加 `private`，只用於部分題組種類的卡片加 `kinds`。locale 的 `cards` 寫標題、問題與讀法 |
| 區塊或圖表 | `src/blocks/` 的元件 | `src/blocks/block.jsx` 的 `BLOCKS` |
| 視窗 | `src/cards/modals.js` 的內容函式 | `buildModal` 的種類表，locale 寫標題與文字 |
| 頁面版型 | `src/blocks/shell.jsx` 的 `Page` | `layout.json` 每頁的 `template` 與版型參數 |
| 導覽入口 | `src/cards/index.js` 的 `buildPage` | `layout.json` 的 `nav`、`mobileNav`、`flow`，locale 的 `nav.tabs` 寫手機分頁列的短名稱 |
| 圖示 | `src/blocks/icons.js` | 按鈕圖示在 `UI_ICONS`，第 1 層議題的圖示在 `ISSUE_ICONS`，鍵是 `taxonomy-issues.tsv` 第 1 層的代碼 |
| 使用者動作 | `src/cards/actions.js` | `ACTIONS`，畫面以 `data-action="名稱:參數"` 觸發。觀看模式也能執行的動作另列在 `SHARED_ACTIONS` |
| 頁面的前提條件 | `src/cards/session.js` 的 `NEED_CHECKS` | 頁面的 `needs` 列出條件，locale 的 `needs` 寫提示卡與鎖定說明 |
| 題組種類 | 各層的種類表 | `layout.json` 的 `kinds`、`src/data/model.js` 的 `MODEL_BUILDERS`、`src/data/load.js` 的 `DATASET_FORMATS`、`src/metrics/kinds.js` 的 `ENGINES`、`src/cards/` 各模組的種類表 |

<br>

## 收錄一場選舉

一場選舉依管線的階段由前往後收錄，每個階段的輸入、步驟、判讀規則與完成判準寫在同名的文件。判讀由編碼者寫進各階段的手寫表，程式負責下載、抽取、核對與發布。步驟如下：

1. 在 `data/10-fetch/{選舉代碼}/election.yaml` 登錄名冊的取得方式與公報文件，下載並核對，見 [fetch](docs/pipeline/fetch.md)。
2. 匯入名冊，轉錄每位參選者的公報政見，登錄遮蔽詞，見 [extract](docs/pipeline/extract.md)。
3. 把政見拆成主張並填寫受控欄位，見 [claims](docs/pipeline/claims.md)。用到詞表沒有的概念時依 [詞表與分類樹](docs/pipeline/vocabulary-policy.md) 增修。
4. 把主張分配到面向、出題並判讀立場，見 [match](docs/pipeline/match.md)。
5. 評主張的具體度，審查題目的中立性，見 [score](docs/pipeline/score.md)。
6. 發布資料集，依 [複評與抽查](docs/pipeline/review-protocol.md) 抽查，寫出區辨力報告，見 [publish](docs/pipeline/publish.md)。
7. 執行 [本機驗證](#本機驗證)，手寫輸入與產物一起提交。

### 移除一場選舉

刪掉 `data/` 各階段目錄中這場選舉的同名目錄，再執行 `npm run pipeline -- publish index` 重寫題組索引。沒有任何選舉或地圖引用的來源從 `data/sources.yaml` 移除，`npm test` 會列出這些來源。

<br>

## 新增一套主題測驗

主題測驗的定義與手寫表都在 `data/topics/{代碼}/`，由 `topics` 階段核對後發布，步驟與手寫表的寫法見 [topics](docs/pipeline/topics.md)。新增的卡片依 [開發網站](#開發網站) 實作，並列進這套測驗 `topic.yaml` 的 `cards`。

### 移除一套主題測驗

刪掉 `data/topics/{代碼}/`，再執行 `npm run pipeline -- publish index` 重寫題組索引。

<br>

## 修改設定表

設定表是 TSV，網站與管線都讀的放在 `config/tables/`，只有管線讀的放在 `scripts/pipeline/tables/`。每張表的用途、欄與共用寫法見 [表與產物的格式](docs/pipeline/table-contract.md)，詞表與分類樹的新增、刪除、合併、拆分與改名依 [詞表與分類樹](docs/pipeline/vocabulary-policy.md) 的判準。步驟如下：

1. 修改表的列。新增一張表時，`config/tables/` 的表在 `config/app/settings.json` 的 `tables` 登錄檔名與表頭，`scripts/pipeline/tables/` 的表在 `scripts/pipeline/tables.py` 登錄。
2. 執行 `npm run pipeline -- tables` 檢查寫法。
3. 判準、詞表或分類樹的修改會影響已收錄的選舉，從受影響的階段重新執行 `npm run pipeline -- run`。
4. 新增第 1 層議題時，在 `src/blocks/icons.js` 的 `ISSUE_ICONS` 補圖示。

<br>

## 修改管線

管線的程式在 `scripts/pipeline/`，每個階段一個目錄，目錄裡每個檔案是一支工具，檔名就是子指令。修改會改變產物的程式之後，重新執行受影響的選舉並提交產物。產物的內容不含時間，同樣的輸入得到同樣的位元組，重新執行後沒有差異的產物表示這次修改不影響它。新增一種東西時，在下表的位置實作並登錄，同名的文件與測試一起修改：

| 要新增 | 位置 | 登錄 | 文件與測試 |
|---|---|---|---|
| 階段的工具 | `scripts/pipeline/{階段}/{工具}.py` | `scripts/pipeline/__main__.py` 的指令表 | `docs/pipeline/{階段}.md` 的步驟、`tests/pipeline/test_{階段}.py` |
| 來源的格式 | `scripts/pipeline/adapters/` | `scripts/pipeline/adapters/__init__.py` 的 `ADAPTERS` | `docs/pipeline/table-contract.md` 的來源的 adapter、`tests/pipeline/test_adapters.py` |
| 核對 | 那個階段的 `run.py` | 不必登錄 | `docs/pipeline/{階段}.md` 的核對表、`tests/pipeline/test_{階段}.py` |

<br>

## 程式寫法

同一種檔案用同一副骨架，讀者換一個檔案時在同樣的位置找到同樣的資訊：

| 檔案 | 寫法 |
|---|---|
| JavaScript | 檔頭以框線寫角色、指令與慣例。區段依集中設定、共用片段、主體、匯出排列，被呼叫的函式寫在呼叫它的函式之前。常數用 UPPER_SNAKE，每個函式與常數寫中文 JSDoc |
| JSX | 只寫在 `src/blocks/` 與 `src/app/`。元件名稱用 PascalCase，會改變網站狀態的互動寫 `data-action`，由 app 層委派，只影響元件自己畫面的互動用 Preact 的事件屬性與 hooks |
| Python | 模組 docstring 第一行寫摘要，再依內容分成「指令：」「手寫輸入：」「產物：」「慣例：」段，段名和階段文件的章節對應。區段依集中設定、共用片段、主體、進入點排列，以 black 排版 |
| 測試 | 一個受測的檔案或階段一份測試。名稱分兩層，第一層是功能，第二層是情境，寫行為。預期值依文件的規則先寫，測試只寫入自己建立的暫存目錄 |
| TSV | 依 [表的共用寫法](docs/pipeline/table-contract.md#表的共用寫法) |
| JSON | 網站設定的鍵用 camelCase，管線產物的鍵用 snake_case |
| YAML | 檔頭寫用途，每個鍵上方寫中文註解 |
| 註解 | 每個分支點上方寫註解，連續的程式每三個邏輯行至少一則註解。註解寫規則與理由，行文依 [寫作規則](docs/writing/rules.md) |

命令列的腳本都接受 `--help`，結束代碼的意思相同：

| 代碼 | 意思 |
|---|---|
| 0 | 通過 |
| 1 | 有待處理的項目：輸入或產物不符規格、失敗的測試、錯誤層級的發現項目 |
| 2 | 參數有誤，腳本沒有執行 |

<br>

## 本機驗證

提交之前依變更的範圍執行下表的驗證，全部通過才提交：

| 變更範圍 | 最低驗證 |
|---|---|
| `src/`、`config/app/` | `npm test`、`npm run check`、`npm run lint`，變更畫面時另做 [瀏覽器檢查](#瀏覽器檢查) |
| `scripts/`、`tests/` | `npm test`、`npm run check`、`npm run lint` |
| 設定表 | `npm run pipeline -- tables`、`npm test`，受影響的選舉重新執行後通過 |
| 管線的手寫輸入 | 那個階段的 `run` 與之後各階段的 `run` 通過，`npm test`、`npm run build` |
| 文件 | `npm run lint` |

### 瀏覽器檢查

變更畫面時先執行 `npm run build` 與 `npm run test:browser`，它以一個無頭的 Chrome 走過選舉比對與主題測驗的流程，抓得到元素消失、執行錯誤、橫向捲動與分享連結無法重播。版面的細節由人檢查：以 `npm start` 開啟網站，依 [DESIGN 的 New Page Checklist](DESIGN.md#new-page-checklist) 逐項確認，並與 [各頁的版面](docs/site/pages.md) 逐塊對照，作答頁另外以鍵盤走過一次量尺、略過與導覽。

<br>

## 分支規範

| 分支 | 用途 |
|---|---|
| `main` | 可部署的版本 |
| `feature/{主題}` | 程式功能 |
| `data/{題組代碼}` | 一場選舉的政見收錄或名冊更新，或一套主題測驗的題目與翻譯 |
| `fix/{主題}` | 錯誤修正 |

<br>

## Commit 與 PR

commit message 的摘要寫正體中文，一句話寫這次提交讓 repo 多了什麼或改了什麼，內文寫原因。

PR 的描述寫改了什麼、為什麼、怎麼驗證，審查者可以依描述重現。修改計分的 PR 附上已收錄選舉的固定作答檢驗前後對照，修改資料的 PR 附上管線的摘要與資料版本。

<br>

## 版本與發行

推送 `v*` 標籤時，`.github/workflows/pages.yml` 安裝套件、執行測試與檢查、建置並把 `web/` 部署到 GitHub Pages。部署讀取提交的 `data/`，管線在本機執行。網站版本取自 git 標籤，建置時寫入 `web/build.json`，本機建置時是 `dev`。發行一個版本的步驟如下：

1. 在 locale 的 `changelog.items` 加一筆使用者看得到的變更。
2. 確認每個題組的管線產物都已提交。
3. 執行 [本機驗證](#本機驗證) 的全部指令，通過後提交。
4. 以 `v{版本}` 標記並推送標籤。

<br>

## 疑難排解

| 訊息 | 原因與處理 |
|---|---|
| 建置印出「找不到 data/60-publish/index.json」或「找不到 data/geo/map.json」 | 管線的產物不在 `data/`。執行 `npm run pipeline -- run --offline` 與 `npm run pipeline -- geo run --offline` |
| 建置印出「下載失敗」或「雜湊不符」 | 第一次建置要從 google/fonts 下載字型，確認網路可用。雜湊不符表示下載的內容與 `scripts/site/build.mjs` 登錄的 sha256 不同 |
| 管線印出「{檔案} 在 {產物} 產生後修改過」 | 前面的階段修改過，後面的階段還沒有重新執行。從訊息指出的階段起重新執行，通常是 `npm run pipeline -- run --election {選舉代碼}` |
| `topics run` 印出手寫表與原始檔不同 | 手寫表的原文、權重、參照點的位置或筆數與登錄的原始檔不同。對照 `.cache/sources/` 的原始檔修正手寫表 |
| 管線印出「{檔案} 的 sha256 是 {值}，登錄的是 {值}」 | 原始檔與登錄的 sha256 不同。來源定期更新時核對新的一期，再更新登錄的 sha256 |
| `extract run` 印出「OCR 需要 macOS 與 swiftc」 | 影像或 OCR 工具修改過，已提交的辨識結果無法沿用。在安裝 Xcode Command Line Tools 的 macOS 重新執行 |
| 網站顯示「程式與資料版本不一致」 | 瀏覽器快取了舊版的程式或資料。重新建置後重新載入頁面，仍出現時清除這個網站的快取 |
