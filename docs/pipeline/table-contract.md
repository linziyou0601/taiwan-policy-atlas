# 表與產物的格式

管線的手寫表、設定表與產物共用的格式：表怎麼寫、判讀的表共用哪些欄、每張設定表回答什麼問題、來源由哪個 adapter 讀取，以及產物之間怎麼轉交。適用於修改設定表、寫任何一個階段的手寫表，或修改讀寫這些檔案的程式。

<br>

## 表的共用寫法

設定表與各階段的手寫表都是 TSV，寫法相同：

- 檔案是 UTF-8，表頭用中文。第一欄是代碼，每個代碼一列，列依代碼的碼位排序。
- 一格有多個值時以頓號分隔，沒有值時寫 -，是非欄寫是或否，每格都要有值。
- 指向另一筆資料的欄寫它的代碼，填一個評定值的欄寫名稱。
- 設定表的說明欄以上位詞寫這一列涵蓋的範圍。要列舉時全部列出，只列一部分時讀者分不出沒列到的是否涵蓋。

<br>

## 判讀的共用欄

記錄判讀的手寫表最後依序是理由、證據、方法與審核狀態，沒有原文證據的表從理由直接接方法。各欄的寫法：

| 欄 | 寫法 |
|---|---|
| 理由 | 這筆判讀的推論，寫到另一位判讀者依同一條判準能重現結論 |
| 證據 | 原文中作為這筆判讀依據的一段，與轉錄稿一字不差，沒有證據時寫 - |
| 方法 | `review-methods.tsv` 的名稱：人工判讀、模型判讀或規則 |
| 審核狀態 | `review-statuses.tsv` 的名稱，什麼時候改為獨立複評通過見 [複評與抽查的審核狀態](review-protocol.md#審核狀態) |

<br>

## 設定表

設定表的檔名是「類別-對象.tsv」。網站與管線都讀的表放在 `config/tables/`，表頭登錄在 `config/app/settings.json` 的 `tables`。只有管線讀的表放在 `scripts/pipeline/tables/`，表頭登錄在 `scripts/pipeline/tables.py`。每張表的用途與欄：

| 表 | 位置 | 回答的問題 | 核對它的階段 | 代碼、名稱、說明以外的欄 |
|---|---|---|---|---|
| `taxonomy-issues` | `config/tables/` | 主張分到哪個議題 | 配題 | 父代碼、層級、區分、參考，寫法見 [詞表與分類樹](vocabulary-policy.md) |
| `vocab-terms` | `config/tables/` | 受控欄位寫哪個詞 | 主張 | 欄位、區分、狀態、加入版本，寫法見 [詞表與分類樹](vocabulary-policy.md) |
| `rubric-stance` | `config/tables/` | 立場依什麼判準判讀 | 配題 | 數值是 -2 到 2，判準寫判讀為這一級的條件 |
| `rubric-specificity` | `config/tables/` | 具體度依什麼判準評分 | 評分 | 權重是這條判準的比重，其餘各欄是各級距的判讀描述，欄名是 `rubric-levels` 的名稱 |
| `rubric-levels` | `config/tables/` | 具體度有哪些級距 | 評分 | 數值是 0 到 1，計入分母寫是或否 |
| `rubric-neutrality` | `config/tables/` | 題目依什麼判準審查中立性 | 評分 | 判準寫題目通過的條件 |
| `scale-answers` | `config/tables/` | 使用者用什麼量尺作答 | 配題 | 數值是 -2 到 2 |
| `axis-ideology` | `config/tables/` | 結果放在哪幾條意識形態軸 | 配題 | 負極、正極是軸兩端的名稱，參考、參考網址是對應的外部量表 |
| `source-types` | `config/tables/` | 證據來自哪類來源、份量多少 | 發布 | 權重是 0 到 1，立場證據寫是或否 |
| `mask-categories` | `config/tables/` | 翻牌前遮蔽哪幾類用語 | 抽取 | 替換是翻牌前取代遮蔽詞的文字 |
| `party-marks` | `config/tables/` | 翻牌後怎麼標示政黨 | 網站 | 簡稱、淺色、深色、圖表色 |
| `review-methods` | `scripts/pipeline/tables/` | 判讀由誰做 | 每個有手寫表的階段 | 只有代碼、名稱與說明 |
| `review-statuses` | `scripts/pipeline/tables/` | 判讀有沒有獨立複評 | 每個有手寫表的階段 | 只有代碼、名稱與說明 |
| `roster-characters` | `scripts/pipeline/tables/` | 名冊的造字換成什麼字 | 抽取 | 字，寫法見 [抽取的造字表](extract.md#造字表) |

`npm run pipeline -- tables` 檢查全部設定表，`--sort` 先把指定的表依代碼排序。檢查的項目：

| 核對範圍 | 失敗條件 |
|---|---|
| 登錄 | 目錄裡有沒有登錄的表，或登錄的表沒有檔案 |
| 寫法 | 表頭與登錄的不同，有空白的儲存格，代碼重複，列沒有依碼位排序 |
| 分類樹 | 父節點不存在，代碼不是以父代碼開頭，層級不是父節點的層級加 1 |

<br>

## 來源的 adapter

每個來源由一個 adapter 讀取，adapter 登錄在 `scripts/pipeline/adapters/__init__.py` 的 `ADAPTERS`。選舉與地圖的來源登錄在 `data/sources.yaml`，主題測驗的來源登錄在測驗定義的 `sources`，各階段依來源登錄的 adapter 名稱取得讀取的函式：

| adapter | 能力 | 來源 |
|---|---|---|
| `cec-roster` | 名冊 | 中選會選舉資料庫 `votedata.zip` 的 elbase、elcand、elpaty，封存檔內的 cp950 檔名另行解碼 |
| `cec-bulletin` | 文件 | 選舉公報 PDF 的文字層，以及選舉定義列出的政見欄嵌入影像 |
| `web-snapshot` | 文件 | 本人官網或粉專的 HTML 快照 |
| `custom` | 文件 | 維護者登錄的本人原文 |
| `topojson-map` | 地圖 | 預先投影的 TopoJSON，轉成 SVG 路徑 |
| `eightvalues` | 主題測驗 | 8values 原始碼的 `questions.js`、`ideologies.js` 與 `LICENSE`，取出等號後的陣列解析，原始檔只當成資料讀取 |
| `mac-polls` | 全國對照 | 陸委會「本會民意調查」例行民調的 CSV，取題目欄以定義的 `match` 開頭的列中起始日期最晚的一期 |

<br>

## 轉交與雜湊

每個階段的產物只寫這個階段增加的內容，前面各階段的檔案以 `carried` 清單轉交，每筆記路徑與 sha256。下一個階段讀取時逐筆核對雜湊，前面的階段修改過而後面的階段還沒有重新執行時讀取失敗，訊息指出要從哪個階段重新執行。

產物以鍵排序的緊湊 JSON 寫出，內容沒有時間，同樣的輸入得到同樣的位元組。資料版本是已發布內容的 sha256 前 12 碼，選舉與主題測驗的計算方式相同。
