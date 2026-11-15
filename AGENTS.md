# AGENTS.md

本檔是台灣政策圖譜給 AI 與維護者的入口頁，定義文件的權威順序、各主題的權威來源、鐵律與每種任務的入口。

<br>

產品、指令與目錄見 [README.md](README.md)，修改的步驟與驗證見 [CONTRIBUTING.md](CONTRIBUTING.md)，外觀見 [DESIGN.md](DESIGN.md)，各主題的細節在 `docs/`。

<br>
<br>
<br>


---
# 文件權威順序

文件互相衝突時，依下表取順序在前者。文件與程式不一致時，外觀與互動以 [DESIGN.md](DESIGN.md) 為準修正程式，其餘行為以設定與程式為準更新文件：

| 優先順序 | 文件 | 職責 |
|---:|---|---|
| 1 | [AGENTS.md](AGENTS.md) | 鐵律、各主題的權威來源、任務的入口 |
| 2 | `docs/` | 每個主題的步驟、判讀規則與格式 |
| 3 | [DESIGN.md](DESIGN.md) | 色彩、字級、版面與元件的外觀 |
| 4 | [CONTRIBUTING.md](CONTRIBUTING.md) | 內容的分類、修改的步驟、驗證、分支與發行 |
| 5 | [README.md](README.md) | 定位、技術棧、指令、腳本、目錄與架構 |
| 6 | `config/`、`src/`、`scripts/` | 文件描述的每個行為的依據 |

<br>
<br>
<br>


---
# 主題權威來源

| 主題 | 權威來源 |
|---|---|
| 定位、資料範圍、功能限制、資料來源與授權 | [README.md](README.md) |
| 指令，以及每支腳本讀取與產生的內容 | [README 的常用指令](README.md#常用指令)、[產生與校驗腳本](README.md#產生與校驗腳本) |
| 目錄、前端分層、管線的階段 | [README 的專案結構](README.md#專案結構)、[架構](README.md#架構) |
| 每類檔案的維護方式 | [CONTRIBUTING 的內容分類](CONTRIBUTING.md#內容分類) |
| 網站與管線擴充點的位置與登錄處 | [CONTRIBUTING 的開發網站](CONTRIBUTING.md#開發網站)、[修改管線](CONTRIBUTING.md#修改管線) |
| 程式的骨架、註解的密度、結束代碼 | [CONTRIBUTING 的程式寫法](CONTRIBUTING.md#程式寫法) |
| 驗證、分支、commit、發行 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 色彩、字級、版型與元件的外觀 | [DESIGN.md](DESIGN.md)，由 `src/styles.css` 實作 |
| 字級的角色與每一頁各個位置的字級、間距與對齊 | [各頁的版面](docs/site/pages.md) |
| 每個元件與圖表的規格、系列色與政黨色、鍵盤與焦點 | [元件的規格](docs/site/components.md) |
| 計分公式、參數與可調範圍 | `config/app/settings.json`，策略實作在 `src/registry/`，方法的說明在 [計分方法](docs/site/methodology.md) |
| 頁面、版型、卡片、入口與鎖定條件 | `config/app/layout.json` |
| 介面文案 | `config/app/locale.zh-TW.json` |
| 狀態、分享連結、觀看模式、匯出與匯入 | [分享與狀態](docs/site/sharing.md) |
| 管線每個階段的輸入、步驟、判讀規則、核對與產物 | `docs/pipeline/` 與階段同名的文件 |
| 轉交與雜湊、表的共用寫法、每張設定表的用途與欄 | [表與產物的格式](docs/pipeline/table-contract.md) |
| 設定表的內容 | `config/tables/*.tsv`、`scripts/pipeline/tables/*.tsv` |
| 詞表與分類樹的增修判準、詞表版本 | [詞表與分類樹](docs/pipeline/vocabulary-policy.md) |
| 判讀的複評、抽查與分工 | [複評與抽查](docs/pipeline/review-protocol.md) |
| 來源登錄 | `data/sources.yaml` |
| 一場選舉的名冊來源與公報文件 | `data/10-fetch/{選舉代碼}/election.yaml` |
| 一套主題測驗的定義、題目、選項、軸對應與參照點 | `data/topics/{代碼}/` |
| 文件與程式註解的寫法 | [寫作規則](docs/writing/rules.md)，規則表在 `scripts/writing/tables/` |

<br>
<br>
<br>


---
# 鐵律

| 領域 | 規則 |
|---|---|
| 分層 | 前端的依賴只能往下，每層可以引用的層寫在 `scripts/site/imports.mjs`。Preact 與 JSX 只用在 `src/blocks/` 與 `src/app/` |
| 顯示層 | blocks 依 cards 傳入的描述繪製畫面，cards 經由 metrics 取得資料 |
| 文案 | 介面文案寫在 locale，程式以鍵取用 |
| 隱私 | 狀態只寫在瀏覽器的 localStorage，網站只讀取自己的靜態檔 |
| 管線的產物 | 產物由管線從手寫輸入產生。要修改產物的內容時修改輸入，再從那個階段重新執行 |
| 轉交 | 每個階段只讀取上一個階段的產物並核對雜湊，前面的階段修改後，後面的階段都要重新執行 |
| 判讀 | 每筆判讀附上判準、理由、證據、方法與審核狀態，寫在那個階段的手寫表 |
| 來源 | 立場的證據一律引用本人的原文，來源限每位候選人都能發言的管道。新聞只用來找線索，現任者已完成的政績略過 |
| 轉錄 | 公報的原文逐字轉錄，辨識不出的字以〔?〕標示 |
| 詞表 | 主張的受控欄位只寫詞表已採用的名稱。沒有登錄的概念先以待審的狀態登錄，裁定後才能發布 |
| 未表態 | 候選人沒有表態的題目記為未知，另算涵蓋率 |
| 遮蔽 | 翻牌前遮蔽 `mask-categories.tsv` 各類別的用語，遮蔽詞只來自名冊與 `aliases.tsv` |
| 現況 | 文件與註解寫現在的行為，變更的經過寫在 commit message 與 PR 描述 |
| 暫存檔 | 截圖、量測、log 與臨時腳本放在 repo 之外的暫存目錄 |
| 提交 | 維護者明確要求時才 commit 或 push |
| 第 1 層議題 | 要新增第 1 層議題，或詞與節點依 [增修判準](docs/pipeline/vocabulary-policy.md#增修判準) 無法判斷時，停下來交給維護者裁定。第 1 層決定議題重視度頁與每場選舉的比較基準 |
| 來源不對等 | 來源只有部分候選人能發言，或公報的掃描品質不足以逐字轉錄時，停下來交給維護者裁定。收錄之後候選人之間的比較不對等 |
| 判讀中改程式 | 判讀的工作要修改管線或網站的程式才能繼續時，停下來交給維護者裁定。程式的修改影響每一場已收錄的選舉 |

<br>
<br>
<br>


---
# 工作流入口

每種任務從下表的入口開始，指令見 [README 的常用指令](README.md#常用指令)：

| 任務 | 入口 |
|---|---|
| 開發網站的功能、結果卡、區塊、視窗或題組種類 | [CONTRIBUTING 的開發網站](CONTRIBUTING.md#開發網站)、[DESIGN.md](DESIGN.md)、[各頁的版面](docs/site/pages.md)、[元件的規格](docs/site/components.md) |
| 調整計分的參數或公式 | [計分方法](docs/site/methodology.md) |
| 修改分享連結、狀態或匯出匯入 | [分享與狀態](docs/site/sharing.md) |
| 收錄或移除一場選舉 | [CONTRIBUTING 的收錄一場選舉](CONTRIBUTING.md#收錄一場選舉)，再依步驟讀各階段的文件 |
| 新增或移除一套主題測驗 | [topics](docs/pipeline/topics.md) |
| 修改設定表、詞表或分類樹 | [CONTRIBUTING 的修改設定表](CONTRIBUTING.md#修改設定表)、[詞表與分類樹](docs/pipeline/vocabulary-policy.md) |
| 把判讀分給多個工作者，或抽查已完成的判讀 | [複評與抽查](docs/pipeline/review-protocol.md) |
| 檢視題組能不能分出候選人 | [publish 的區辨力報告](docs/pipeline/publish.md#區辨力報告) |
| 修改管線的程式 | [CONTRIBUTING 的修改管線](CONTRIBUTING.md#修改管線) |
| 寫文件、程式註解、commit message 或 PR 描述 | [寫作規則](docs/writing/rules.md) |
| 提交之前的驗證 | [CONTRIBUTING 的本機驗證](CONTRIBUTING.md#本機驗證) |
| 發行一個版本 | [CONTRIBUTING 的版本與發行](CONTRIBUTING.md#版本與發行) |
