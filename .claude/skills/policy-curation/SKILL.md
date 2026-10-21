---
name: policy-curation
description: 把一場選舉的政見原文收錄成台灣政策圖譜的資料：逐字轉錄公報、拆分為單一政策的主張、填寫受控欄位、提出新詞、配題、具體度評分、出題與中立性審查，最後執行管線驗證。於使用者要新增或重新編碼一場選舉的政見、補充一位候選人的來源，或核對既有編碼時應主動建議使用。
---

# 政見收錄

## 用途

這個 skill 定義管線中由 Claude Code 判讀並寫入 TSV 的步驟。程式只核對與轉換，判讀記錄在各層的 TSV，每筆判讀附上判準、理由、證據、方法與審核狀態。

## 輸入

| 輸入 | 必要性 | 說明 | 預設 |
|---|---|---|---|
| 選舉代碼 | 必要 | `config/pipeline/elections/` 的檔名 | - |
| 範圍 | 選填 | 選區或參選者代碼，只收錄這些對象 | 整場選舉 |

## 執行步驟

### 前置確認

1. 閱讀 [AGENTS.md](../../../AGENTS.md) 的鐵律、[docs/vocabulary.md](../../../docs/vocabulary.md) 與本 skill 的參考型錄。
2. 確認名冊已匯入 `data/20-extract/{選舉代碼}/roster.json`，選舉設定的 `documents` 已登錄公報。
3. 確認來源符合來源規則：
   - 只收錄每位候選人都能發言、能取得本人原文、可保存快照的來源：選舉公報、本人官網與粉專快照、政見發表會與辯論逐字稿。
   - 新聞只用於找出線索，引用一律回溯到本人來源。
4. 盤點範圍內每位參選者已有的段落、主張與配題，標示新建、重新編碼或沿用。

完成判準：範圍內每位參選者都標明新建、重新編碼或沿用，每個來源都符合來源規則。

### 讀取原文

1. 執行 `.venv/bin/python -m pipeline fetch --election {選舉代碼}`，再執行 `.venv/bin/python .claude/skills/policy-curation/scripts/bulletin.py cells --election {選舉代碼}`：每份公報在 `.cache/curation/{選舉代碼}/{文件}/` 產生政見格清單 `cells.tsv`（每格的號次、頁與格內影像代碼）與文字層草稿 `drafts/`。
2. 以 Read 工具檢視頁面確認每一格，把含影像的格子的影像代碼登錄到選舉設定 `documents` 的 `images`，再執行 `extract`。偵測不到政見格的公報改執行 `bulletin.py images`，檢視 `previews/` 的縮圖，選出政見欄影像。
3. 影像型的政見以 Read 工具逐張檢視 `images/` 的影像。影像寬於 1000 像素時，先在 session 的暫存目錄依欄位裁切成多張再檢視，裁切的邊界與下一張至少重疊一行。
4. 文字型的政見以 `drafts/` 的草稿為起點，對照頁面核對每一行。草稿依版面的格子分割，格子範圍有誤時改用 `extract.json` 的頁面文字，依版面的順序整理。
5. 逐字轉錄到 `data/20-extract/{選舉代碼}/transcripts/{選區代碼}-{號次}.txt`：
   - 標題、條目與原文的段落各占一行，因欄寬而折到下一行的句子合併為一行。
   - 編號、項目符號、標點與簡繁依照原文，不改寫、不加註。
   - 文字層中全形字旁與折行處的空白刪除，同一個字重複繪製成粗體時只保留一份。
   - 只轉錄候選人寫在政見欄的內容，公報印製的頁尾宣導、選票樣張與廣告略過。
   - 無法辨識的字以〔?〕標示，不憑推測補齊。
6. 在 `transcripts.tsv` 登錄每段：
   - 代碼寫 `{選區代碼}-{號次}-p{序號}`，影像寫影像代碼，文字型寫 -。
   - 方法寫「模型判讀」，審核狀態寫「未經獨立複評」。
   - 理由寫轉錄的處理與 OCR 的比對判斷。
7. 把名冊以外會洩漏身分的用語登錄到 `aliases.tsv`：暱稱、競選口號、標誌文字、政見標題中的人名或黨名。姓名、搭檔與黨名由網站依名冊遮蔽，不重複登錄。
8. 重新執行 `extract`，影像段落在 `extract.json` 含有 `ocr_check`：`agreement` 是轉錄稿與 OCR 的字元重合度，`unmatched` 是轉錄稿中找不到的 OCR 行。逐行放大影像對照 `unmatched`，OCR 誤讀時保留轉錄稿，轉錄漏字時補齊。`agreement` 低於 0.95 時整段重新比對。

完成判準：範圍內每位參選者都有段落，`extract` 通過，每個影像段落的 `unmatched` 都已逐行判斷並記錄在理由欄。

### 拆分主張

一則主張只包含一個可以單獨支持或反對的政策。同一句原文含多項政策時拆分為多則，各自截取對應的一段原文，數字與條件保留在它所屬的那一則。

- 主張表各欄依 [field-policy](references/field-policy.md#其他欄位) 填寫。原文填寫完成後執行 `.venv/bin/python .claude/skills/policy-curation/scripts/offsets.py --election {選舉代碼}` 填入起訖。
- 只有價值、口號、自我介紹、經歷或已完成政績的句子不建立主張，例如「相信美好台灣」。
- 標題與其下的項目一起閱讀，標題提供的對象或領域填入欄位，原文欄截取項目本身。

完成判準：主張層的原文核對通過，每則主張的起訖都已填入。

### 填寫欄位

受控欄位依 [docs/vocabulary.md 的受控欄位](../../../docs/vocabulary.md#受控欄位) 與 [field-policy](references/field-policy.md) 填寫。詞表沒有適合的名稱時，依 [docs/vocabulary.md 的增修判準](../../../docs/vocabulary.md#增修判準) 判斷沿用既有詞、改為填寫其他欄位或新增，新詞以待審狀態登錄到 `vocab-terms.tsv`，依裁定改為採用或刪除。維護者授權 Claude 代為裁定時，commit message 寫明代為裁定的詞與理由。

完成判準：主張層通過，詞表沒有待審的詞。

### 配題

每則主張至少一列配題，把主張分配到分類樹中說明涵蓋它的最深節點，同一則主張的分配合計為 1。分類樹沒有適合的節點時，依增修判準處理。

主張只涉及一個面向時分配寫 1。涉及多個面向時依原文的重點分配，例如「國防預算合理，達到GDP的3%」分配給國防預算目標與防衛能力兩個面向各 0.5。

完成判準：每則主張至少一列配題，分配合計為 1，配題層通過。

### 評分

每則主張對 `rubric-specificity.tsv` 的每條判準各有一列評分，級距、證據與理由依 [field-policy 的具體度評分](references/field-policy.md#具體度評分)。

完成判準：每則主張對每條判準各有一列，評分層通過。

### 出題

依 [question-policy](references/question-policy.md) 寫出：

1. `questions.tsv`：每個有主張的面向一道母題，候選人做法不同時再新增子題。
2. `mappings.tsv` 每一列的題目、題目版本與立場：
   - 立場寫 `rubric-stance.tsv` 的名稱，依該表的判準判斷。
   - 主張與題目方向無關或無法判斷時，題目寫 -，這一列只計入議題分布。
   - 證據寫主張原文中支持這個立場判讀的一段，理由寫判讀的推論。
3. `question-axes.tsv`：每題對 `axis-ideology.tsv` 有關的軸各一列。
4. `neutrality.tsv`：每題對 `rubric-neutrality.tsv` 的每條判準各一列。

完成判準：每個有主張的面向都有題目，或配題列的理由寫明不設題目的原因。每題的中立性全部通過，說明的現況都已查證。

### 結案

1. 執行管線與全部測試：

   ```bash
   .venv/bin/python -m pipeline run --election {選舉代碼} --offline
   npm test
   npm run check
   ```

2. 依 [review-protocol](references/review-protocol.md) 的抽查範圍抽查，逐筆處理不一致。抽查發現系統性問題時修正判準或詞表，重新執行受影響的步驟。
3. 執行 `npm run build` 重新建置網站，在瀏覽器操作一個選區，從作答到結果、分享與重播。

完成判準：管線與測試全部通過，抽查範圍的每一項都已完成，每筆不一致都已判斷並處理。

## 停止條件

下列情況停止並交給維護者裁定：

- 要新增第 1 層議題，或詞與節點依增修判準無法判斷。
- 來源只有部分候選人能發言，或公報掃描品質不足以逐字轉錄。
- 選區只有一位參選人，專案還沒有處理規則。
- 要修改管線或網站的程式。

## 委派

subagent 的數量、草稿位置與結果核對依 [review-protocol](references/review-protocol.md)，依工作的判斷量選擇模型：

| 子任務 | 預設執行者 | 備註 |
|---|---|---|
| 影像逐字轉錄 | opus | 影像多、字形難讀時委派 |
| 原文欄與轉錄稿、影像逐字比對 | haiku | 機械比對，判斷量低 |
| 一位候選人的主張、欄位、配題與評分草稿 | opus | 拆分主張與配題的判斷量最高，重新製作的成本高 |
| 一場選舉的出題、立場、軸對應與中立性草稿 | opus | 同上 |
| 抽查立場、分配與具體度的判讀 | sonnet | 要閱讀判準並說明理由 |

## 產出

| 產物 | 位置 | 核對的層 |
|---|---|---|
| 轉錄稿、段落表、遮蔽詞表 | `data/20-extract/{選舉代碼}/` 的 `transcripts/`、`transcripts.tsv`、`aliases.tsv` | 抽取層 |
| 主張與受控欄位 | `data/30-claims/{選舉代碼}/claims.tsv` | 主張層 |
| 新詞與新節點 | `config/tables/vocab-terms.tsv`、`taxonomy-issues.tsv` | 主張層、配題層 |
| 配題、題目與軸對應 | `data/40-match/{選舉代碼}/` 的 `mappings.tsv`、`questions.tsv`、`question-axes.tsv` | 配題層 |
| 具體度與中立性 | `data/50-score/{選舉代碼}/` 的 `specificity.tsv`、`neutrality.tsv` | 評分層 |

## 完整性檢查

- [ ] 範圍內每位參選者都有段落，每個段落的轉錄處理與 OCR 判斷記錄在理由欄
- [ ] `aliases.tsv` 列出名冊以外會洩漏身分的用語
- [ ] 每則主張的原文一字不差，分配合計為 1
- [ ] 詞表沒有待審的詞
- [ ] 只分配到子題的主張也有母題的配題
- [ ] 每題的中立性全部通過，說明的現況以投票日為準並已查證
- [ ] 管線、`npm test` 與 `npm run check` 全部通過

## 參考型錄

| 檔案 | 用途 |
|---|---|
| [scripts/bulletin.py](scripts/bulletin.py) | 公報的嵌入影像預覽、政見格清單與文字層草稿 |
| [scripts/offsets.py](scripts/offsets.py) | 依原文欄填入主張的起訖 |
| [scripts/test_scripts.py](scripts/test_scripts.py) | 兩支腳本的測試，修改腳本後在 repo 根目錄執行 `.venv/bin/python -m unittest discover -s .claude/skills/policy-curation/scripts` |
| [field-policy](references/field-policy.md) | 主張各欄的判讀例、現任政府計畫與具體度評分 |
| [question-policy](references/question-policy.md) | 題目欄位、母題與子題、意識形態軸與中立性審查 |
| [review-protocol](references/review-protocol.md) | subagent 的派工、抽查範圍與審核狀態 |
| [docs/vocabulary.md](../../../docs/vocabulary.md) | 受控欄位、分類樹與詞表的增修判準 |
| [docs/methodology.md](../../../docs/methodology.md) | 共識題與計分方式 |
