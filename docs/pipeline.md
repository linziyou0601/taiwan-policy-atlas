# 資料管線

管線把中選會的名冊與選舉公報轉成網站讀取的資料集，並把主題測驗的手寫表發布成題組。每層只讀取上一層的產物，判讀由政見收錄 skill 記錄在各層的 TSV，程式只核對與轉換。

<br>

## 層與產物

下表列出管線每層的指令、讀取的輸入與寫出的產物，各層讀取的設定表見 [資料表的讀取](tables.md#讀取)。「寫」欄標為手寫的檔案由編碼者寫入，該層讀取並核對。選區地圖與主題測驗不屬於這些層，分別由 `geo` 與 `topic` 產生，見 [地圖](#地圖) 與 [主題測驗](#主題測驗)：

| 層 | 指令 | 讀 | 寫 |
|---|---|---|---|
| 抓取 | `fetch` | `config/pipeline/sources.yaml`、選舉設定 | `data/10-fetch/{選舉代碼}/manifest.json` |
| 抽取 | `extract` | 抓取層 manifest、`.cache/sources/` | `data/20-extract/{選舉代碼}/`：`roster.json`、`extract.json`、`images/`，手寫的 `transcripts/`、`transcripts.tsv`、`aliases.tsv` |
| 主張 | `claims` | 抽取層產物 | `data/30-claims/{選舉代碼}/claims.json`，手寫的 `claims.tsv` |
| 配題 | `match` | 主張層產物 | `data/40-match/{選舉代碼}/match.json`，手寫的 `questions.tsv`、`mappings.tsv`、`question-axes.tsv` |
| 評分 | `score` | 配題層產物 | `data/50-score/{選舉代碼}/score.json`，手寫的 `specificity.tsv`、`neutrality.tsv` |
| 發布 | `publish` | 評分層產物 | `data/60-publish/{選舉代碼}/dataset.json`、`data/60-publish/{選舉代碼}/scopes/{選區碼}.json`、`data/60-publish/index.json` |

管線以下列指令執行，結束代碼 0 為成功，1 為輸入或產物不符規格，2 為參數錯誤：

```bash
.venv/bin/python -m pipeline run [--election {選舉代碼}] [--offline]
.venv/bin/python -m pipeline {fetch|extract|claims|match|score|publish} --election {選舉代碼}
.venv/bin/python -m pipeline geo [--offline]
.venv/bin/python -m pipeline topic [--topic {代碼}] [--offline]
.venv/bin/python -m pipeline index
.venv/bin/python -m pipeline tables [--sort {路徑}]
```

<br>

## 轉交與雜湊

每層的產物只寫本層新增的內容，前面各層的檔案以 `carried` 清單轉交，每筆記路徑與 sha256。下一層讀取時逐筆核對雜湊，前面的層修改過而後面沒有重新執行時讀取失敗，訊息指出從哪一層重新執行。產物以鍵排序的緊湊 JSON 寫出，不寫時間，同樣的輸入得到同樣的位元組。

選舉的資料集分成總檔與選區檔。段落、OCR、主張、配題與具體度依所屬選區寫入選區檔，網站選定選區後才讀取那個選區的檔案，總檔的 manifest 以 `scope_files` 列出各選區檔。沒有段落引用的影像，OCR 留在總檔。

發布層的資料版本是總檔與選區檔合起來的完整內容的 sha256 前 12 碼，兩種檔都記這個版本，分享連結以它判斷能否精確重播。

發布層與 `topic` 都重寫索引 `data/60-publish/index.json`，移除題組後以 `index` 單獨重寫。索引的 `elections` 與 `topics` 分列選舉與主題測驗，每筆帶 `kind`（`election` 或 `topic`）、資料集路徑與 manifest，網站依 `kind` 選用模型、計分與卡片。主題測驗的每筆另帶 `cards`，列出這套測驗用到的卡片。

<br>

## 來源 adapter

每個來源由 adapter 處理。選舉與地圖的來源登錄在 `sources.yaml`，主題測驗的來源登錄在題組設定的 `sources`，adapter 登錄在 `pipeline/adapters/__init__.py` 的 `ADAPTERS`。抽取層、`geo` 與 `topic` 依來源登錄的 adapter 名稱查表取得處理函式：

| adapter | 能力 | 來源 |
|---|---|---|
| `cec-roster` | 名冊 | 中選會選舉資料庫 `votedata.zip` 的 elbase、elcand、elpaty，封存檔內的 cp950 檔名另行解碼 |
| `cec-bulletin` | 文件 | 選舉公報 PDF 的文字層，以及選舉設定列出的政見欄嵌入影像 |
| `web-snapshot` | 文件 | 本人官網或粉專的 HTML 快照 |
| `custom` | 文件 | 維護者登錄的本人原文 |
| `topojson-map` | 地圖 | 預先投影的 TopoJSON，轉成 SVG 路徑 |
| `eightvalues` | 主題測驗 | 8values 原始碼的 `questions.js`、`ideologies.js` 與 `LICENSE`，取出等號後的陣列解析，不執行原始檔 |
| `mac-polls` | 全國對照 | 陸委會「本會民意調查」例行民調的 CSV，取題目欄以設定的 `match` 開頭的列中起始日期最晚的一期 |

### 下載

下載時照常驗證憑證鏈與主機名稱。部分政府網站的憑證缺 Subject Key Identifier，Python 3.13 起預設的 X.509 嚴格檢查（`VERIFY_X509_STRICT`）會拒絕連線，`pipeline/fetch.py` 的 `TLS_CONTEXT` 因此關掉這項檢查，檔案內容另以 sha256 核對。

沒有 `file` 的來源是網站目錄，每份文件的路徑與 sha256 寫在選舉設定 `documents` 的 `member` 與 `sha256`。抓取層以來源網址加上路徑逐份下載與核對，manifest 的 `members` 逐份記錄。

<br>

## 抽取與轉錄

公報的政見有的在 PDF 文字層，有的是嵌入影像。選舉設定 `documents` 的 `images` 列出政見欄的影像，由編碼者依政見收錄 skill 選出。抽取層寫出這些影像，並以 Apple Vision 辨識文字。轉錄稿由編碼者對照影像或文字層撰寫。`extract.json` 為影像段落記錄轉錄稿與 OCR 的字元重合度（F1，與行序無關）以及轉錄稿中找不到的 OCR 行，編碼者逐行對照影像判斷是 OCR 誤讀還是轉錄漏字。轉錄的規則見 [政見收錄 skill](../.claude/skills/policy-curation/SKILL.md)。

<br>

## 核對規則

下列任何一項成立時，管線印出錯誤訊息並以結束代碼 1 停止：

| 核對範圍 | 失敗條件 |
|---|---|
| 設定表 | 表頭與 `config/app/settings.json` 的 `tables` 登錄不符、空白儲存格、代碼重複、未依碼位排序、未登錄的表，分類樹的父節點不存在或層級跳號 |
| 主張 | 段落不存在、原文起訖與段落不符、引用未登錄或待審的詞、非現任者標註現任政府計畫 |
| 配題 | 面向不在分類樹、證據不在主張原文、題目版本過期、立場值與判準代碼不在 `rubric-stance.tsv` 的同一列、一則主張的分配合計不是 1、題目沒有任何配題證據、母題關係成環 |
| 評分 | 具體度缺少某條判準的評分、明示的級距沒有原文證據、中立性有判準不通過 |
| 地圖 | 名冊的縣市代碼或鄉鎮名稱找不到圖形 |
| 主題測驗 | 來源代碼重複或與 `sources.yaml` 相同、軸代碼重複、次方不大於 0、標籤數與門檻數不同、選項指向未登錄的題目或一題只有一個選項、軸對應指向單選題或未登錄的軸、方向不是 1 或 -1、權重不大於 0、量尺題沒有軸對應、參照點缺軸或位置超出 0 到 100、原文、權重、參照點位置或筆數與原始檔不同，以及對照的題目不是單選題、選項與 `options.tsv` 不同、來源沒有以 `match` 開頭的題目或原文不是以來源的題目開頭 |

<br>

## 地圖

`geo` 在抽取層之後單獨執行，讀 `config/pipeline/geography.yaml` 與全部選舉的名冊，寫出 `data/geo/map.json`。圖形來源是 taiwan-atlas 2021.9.20 的 `towns-mercator-10t.json`，座標已投影成 450 × 600 的螢幕座標，金門、連江、烏坵以插圖方式移到本島左上。圖形寫成相對座標的 SVG 路徑，網站直接畫出。

名冊的「臺」與地圖的「台」依 `name_equivalents` 視為相同，名冊的縣市代碼與鄉鎮名稱逐一對到圖形。選區與鄉鎮的對應方式見 [README 的功能限制](../README.md#功能限制)。

<br>

## 主題測驗

主題測驗引用已發表的測驗或長期民調的題目，題目與計分都由手寫表與設定決定，原始檔用來核對手寫表與取出全國對照，計分方式見 [計分方法的主題測驗](methodology.md#主題測驗)。`topic` 讀下列檔案，寫出 `data/60-publish/topics/{代碼}/dataset.json` 並更新索引，格式是 `config/app/settings.json` 的 `formats.topic`，資料版本與選舉相同，取內容 sha256 的前 12 碼。省略 `--topic` 時發布全部主題測驗：

| 檔案 | 內容 |
|---|---|
| `config/pipeline/topics/{代碼}.yaml` | 代碼 `id`、名稱與說明、方法說明 `note`、來源與授權 `origin`（`name`、`url`、`version`、`license`）、軸（代碼、名稱、兩極、距離次方、各級標籤）、各級門檻、距離策略 `distance`、用到的卡片 `cards`，以及選填的原始檔 `sources`、`check` 與 `comparisons` |
| `data/topics/{代碼}/` 的手寫表 | 題目、單選題的選項、軸對應與參照點，各表的欄位見 [資料表的主題測驗手寫表](tables.md#主題測驗的手寫表) |

### 題組的原始檔

原始檔登錄在題組設定的 `sources`，欄位與 `sources.yaml` 相同，快取在 `.cache/sources/{來源代碼}/`。來源代碼與 `sources.yaml` 重複時兩者會共用快取目錄，`topic` 回報錯誤並停止。刪掉一套主題測驗的設定與手寫表時，它的來源與全國對照一併移除。題組用到的來源連同 sha256 與授權寫入題組，資料集頁的來源分頁列出。

### 原始檔核對

設定寫了 `check` 時，`topic` 下載或沿用快取並核對 sha256，再由題目來源登錄的 adapter 讀出原始的題目、權重、參照點與授權全文。比對的項目列在 [核對規則](#核對規則)，翻譯不核對。題目、說明或單選題的選項名稱改動時題意雜湊跟著改，使用者的舊答案移到封存。授權全文寫入題組，建置時另存為 `web/licenses/topic-{代碼}.txt`。

### 全國對照

設定的 `comparisons` 每筆對應一題單選題，依來源的授權選用下表的寫法。授權允許轉載時取出比例，授權限制轉載時只附連結：

| 寫法 | 鍵 | 產物 |
|---|---|---|
| 取出比例 | `question`、`source`、`match`、`options`、`none`、`url` | 由來源 adapter 的 `comparison` 能力取出最新一期各選項的比例、無反應的比例、調查名稱、日期、樣本數與執行單位。`options` 把每個選項代碼對到來源的欄名，要涵蓋 `options.tsv` 中這題的全部選項。題目的原文要以來源記錄的題目開頭，比例才是同一題的結果 |
| 只附連結 | `question`、`label`、`url` | 只記來源名稱與網址，結果頁附上連結，沒有比例 |
