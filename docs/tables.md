# 資料表

本頁說明 repo 中每張 TSV 回答的問題、哪一層讀它、共用的寫法與各欄寫什麼。設定表的檔名與表頭以 `config/app/settings.json` 的 `tables` 為準，手寫表的表頭寫在讀取它的管線模組。

<br>

## 分組

設定表在 `config/tables/`，檔名是「類別-對象.tsv」，類別是表的用途：

| 類別 | 回答的問題 | 表 |
|---|---|---|
| `taxonomy-`、`vocab-` | 主張分到哪個議題、受控欄位寫哪個詞 | `taxonomy-issues`、`vocab-terms` |
| `rubric-` | 判讀與評分依什麼判準 | `rubric-stance`、`rubric-specificity`、`rubric-levels`、`rubric-neutrality` |
| `scale-` | 使用者用什麼量尺作答 | `scale-answers` |
| `axis-` | 結果放在哪幾條意識形態軸上 | `axis-ideology` |
| `source-` | 證據來自哪類來源、份量多少 | `source-types` |
| `mask-`、`party-` | 翻牌前怎麼遮蔽、翻牌後怎麼標示 | `mask-categories`、`party-marks` |
| `review-` | 由誰判讀、有沒有獨立複評 | `review-methods`、`review-statuses` |

手寫表放在讀取它的那一層的資料夾，一列是一段原文或一筆判讀。選舉的手寫表依政見收錄 skill 填寫，各欄的寫法在下表列出的位置：

| 位置 | 表 | 一列是 | 欄位的寫法 |
|---|---|---|---|
| `data/20-extract/{選舉代碼}/` | `transcripts.tsv` | 一段公報政見的轉錄 | [政見收錄 skill](../.claude/skills/policy-curation/SKILL.md) 的讀取原文 |
| `data/20-extract/{選舉代碼}/` | `aliases.tsv` | 一個會洩漏身分的用語 | [政見收錄 skill](../.claude/skills/policy-curation/SKILL.md) 的讀取原文 |
| `data/30-claims/{選舉代碼}/` | `claims.tsv` | 一則主張 | [field-policy](../.claude/skills/policy-curation/references/field-policy.md) |
| `data/40-match/{選舉代碼}/` | `questions.tsv` | 一道題目 | [question-policy](../.claude/skills/policy-curation/references/question-policy.md) 的題目欄位 |
| `data/40-match/{選舉代碼}/` | `mappings.tsv` | 一則主張分配到一個面向 | [政見收錄 skill](../.claude/skills/policy-curation/SKILL.md) 的配題與出題 |
| `data/40-match/{選舉代碼}/` | `question-axes.tsv` | 一道題目對一條軸 | [question-policy](../.claude/skills/policy-curation/references/question-policy.md) 的意識形態軸 |
| `data/50-score/{選舉代碼}/` | `specificity.tsv` | 一則主張對一條具體度判準 | [field-policy](../.claude/skills/policy-curation/references/field-policy.md) 的具體度評分 |
| `data/50-score/{選舉代碼}/` | `neutrality.tsv` | 一道題目對一條中立性判準 | [question-policy](../.claude/skills/policy-curation/references/question-policy.md) 的中立性審查 |
| `data/topics/{代碼}/` | `questions.tsv`、`options.tsv`、`question-axes.tsv`、`references.tsv` | 一道題目、一個選項、一道題目對一條軸、一個參照點 | 本頁的[主題測驗的手寫表](#主題測驗的手寫表) |

<br>

## 讀取

手寫表由同一層的管線指令讀取，產物寫在同一個資料夾，見 [資料管線的層與產物](pipeline.md#層與產物)。設定表的讀取者：

| 表 | 管線 | 網站 |
|---|---|---|
| `taxonomy-issues` | `tables` 核對父節點與層級，`match` 核對面向 | `data` 組成分類樹，卡片取節點的名稱，資料集頁列出 |
| `vocab-terms` | `claims` 核對受控欄位 | 資料集頁列出 |
| `rubric-stance` | `match` 核對立場 | `data` 取立場的數值 |
| `rubric-specificity`、`rubric-levels` | `score` 核對具體度評分 | `metrics` 計算具體度，方法頁列出 |
| `rubric-neutrality` | `score` 核對中立性審查 | - |
| `scale-answers` | `match` 核對顯示條件 | `data` 取作答的數值 |
| `axis-ideology` | `match` 核對軸對應 | `data` 組成意識形態軸 |
| `source-types` | - | `data` 取來源權重，`metrics` 計算各來源類型的涵蓋率 |
| `mask-categories` | `extract` 核對遮蔽詞的類別 | `data` 取替換文字 |
| `party-marks` | - | `data` 取政黨的簡稱與顏色 |
| `review-methods`、`review-statuses` | `tables` 核對各手寫表的方法與審核狀態 | - |

<br>

## 共用寫法

- 檔案是 UTF-8 的 TSV，表頭用中文。第一欄是代碼，每個代碼一列，列依代碼的碼位排序。
- 一格有多個值時以頓號分隔，沒有值時寫 -，是非欄寫是或否，每格都要有值。
- 設定表的名稱欄寫顯示用的名稱，說明欄寫這一列涵蓋的範圍。
- 判讀表最後依序是理由、證據、方法與審核狀態，沒有原文證據的表從理由直接接方法。
- 指向另一筆資料的欄寫它的代碼：參選者、文件、影像、段落、主張、面向、母題、題目、判準、軸、類別與適用範圍，適用範圍涵蓋每個選區時寫「全部」。填一個評定值的欄寫名稱：立場、級距、結果、顯示條件、方法、審核狀態與受控欄位。

<br>

## 設定表的欄位

各表的代碼、名稱與說明依共用寫法，下表列出其餘的欄：

| 表 | 欄 | 寫什麼 |
|---|---|---|
| `taxonomy-issues` | 父代碼、層級 | 上一層節點的代碼與本節點的層級，第 1 層的父代碼寫 - |
| `taxonomy-issues`、`vocab-terms` | 區分 | 與容易混淆的節點或詞怎麼判斷，格式是「與「名稱」：判斷特徵」，多個以「；」分隔，沒有容易混淆的寫 -。分類樹與兄弟節點及說明相近的節點比，詞表與同一欄位的詞比 |
| `taxonomy-issues` | 參考 | 節點對應的外部量表或分類 |
| `vocab-terms` | 欄位 | 詞所屬的受控欄位，欄位的意思見 [受控欄位](vocabulary.md#受控欄位) |
| `vocab-terms` | 狀態 | 採用或待審，見 [裁定](vocabulary.md#裁定) |
| `vocab-terms` | 加入版本 | 見 [版本](vocabulary.md#版本)，待審詞寫 - |
| `rubric-stance` | 數值、判準 | 立場的數值是 -2 到 2，判準寫判讀為這一級的條件 |
| `rubric-specificity` | 權重 | 這條判準在具體度中的比重 |
| `rubric-specificity` | 未明示、部分明示、完整明示 | 各級距的判讀描述，欄名是 `rubric-levels` 的名稱 |
| `rubric-levels` | 數值、計入分母 | 級距的分數是 0 到 1，計入分母寫是或否，不適用的級距不計分 |
| `rubric-neutrality` | 判準 | 題目通過這條判準的條件 |
| `scale-answers` | 數值 | 作答的數值是 -2 到 2 |
| `axis-ideology` | 負極、正極 | 軸兩端的名稱 |
| `axis-ideology` | 參考、參考網址 | 軸對應的外部量表與網址 |
| `source-types` | 權重、立場證據 | 權重是 0 到 1，配題的分配乘上它；立場證據寫是或否，寫否的來源類型不計入立場 |
| `mask-categories` | 替換 | 翻牌前取代遮蔽詞的文字 |
| `party-marks` | 簡稱、淺色、深色、圖表色 | 簡稱用在窄處；淺色與深色是兩種主題的政黨色；圖表色寫是或否，寫是的黨翻牌後在圖表使用政黨色 |

<br>

## 主題測驗的手寫表

`topic` 指令讀 `data/topics/{代碼}/` 的手寫表，題組設定見 [資料管線的主題測驗](pipeline.md#主題測驗)：

| 表 | 欄位 |
|---|---|
| `questions.tsv` | 代碼、題幹、簡稱、說明、原文、出處。題幹寫網站顯示的文字，簡稱寫窄處用的短名，說明寫節錄或補充，原文寫原始問卷或測驗的文字，自寫的題目寫 -，出處寫原文或節錄的來源 |
| `options.tsv` | 選填，單選題的選項：代碼、題目、名稱。列在這張表的題目是單選題，選項依代碼排列，代碼依問卷的順序編號。每題至少兩個選項，不進任何軸 |
| `question-axes.tsv` | 量尺題對軸的方向、權重與理由，表頭與選舉的 `question-axes.tsv` 相同。每一題量尺題至少對應一條軸，單選題不寫 |
| `references.tsv` | 參照點：代碼、名稱、位置、原文。位置以頓號分隔「軸=位置」，每條軸都要有值 |
