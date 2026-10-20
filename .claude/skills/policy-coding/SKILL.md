---
name: policy-coding
description: 把一場選舉的政見原文編碼成台灣政策圖譜的資料：讀公報影像逐字轉錄、拆成單一政策的主張、填受控欄位、提出待審詞、配題、具體度評分、出題與中立性審查，最後跑管線驗證。新增或重編一場選舉的政見、補一位候選人的來源、或核對既有編碼時使用。
disable-model-invocation: true
---

# 政見編碼

這個 skill 定義管線中由 Claude Code 判讀並寫入 TSV 的步驟。程式只核對與轉換，判讀寫在各層的 TSV，每筆判讀附判準、理由、證據、方法與審核狀態，網站上的每個數字都能追溯到這些列。

## 輸入與產物

各步驟讀寫的檔案與核對的層：

| 步驟 | 讀 | 寫 | 核對的層 |
|---|---|---|---|
| 1 讀取原文 | `data/20-extract/{選舉代碼}/images/`、`extract.json` 的 OCR | `data/20-extract/{選舉代碼}/` 的 `transcripts/`、`transcripts.tsv`、`aliases.tsv` | 抽取層 |
| 2 拆分主張 | 段落 | `data/30-claims/{選舉代碼}/claims.tsv` | 主張層 |
| 3 填寫欄位 | `config/tables/vocab-terms.tsv` | `claims.tsv` 的受控欄位 | 主張層 |
| 4 提出待審詞 | 詞表 | `config/tables/vocab-pending.tsv`、裁定後的 `vocab-terms.tsv` | 主張層 |
| 5 配題 | 主張、分類樹 | `data/40-match/{選舉代碼}/mappings.tsv` | 配題層 |
| 6 評分 | 主張、`rubric-specificity.tsv` | `data/50-score/{選舉代碼}/specificity.tsv` | 評分層 |
| 7 出題 | 配題結果 | `data/40-match/{選舉代碼}/questions.tsv`、`data/40-match/{選舉代碼}/question-axes.tsv`、`data/50-score/{選舉代碼}/neutrality.tsv` | 配題層、評分層 |
| 8 驗證 | 全部 | 無 | 全部 |

<br>

## 來源規則

- 只收能取得本人原文、可保存快照的來源：選舉公報、立法院的提案、質詢與表決紀錄（限該屆在任者）、本人官網與粉專快照、政見發表會與辯論逐字稿。
- 新聞只當線索，引用一律回到本人來源，新聞本身不寫進主張。
- 現任者已完成的政績不收錄。現任者以政府名義宣布、尚未完成的計畫收錄，`現任政府計畫` 寫「是」，判斷方式見 [field-guide](references/field-guide.md) 的其他欄位。
- 公報裡無法辨識的字寫〔?〕，不推測補字，待核字數會顯示在資料集。
- 候選人沒有提到的議題不建立主張，網站把候選人在這些議題的題目記為未表態。

<br>

## 1 讀取原文

1. 執行 `.venv/bin/python -m pipeline fetch --election {選舉代碼}` 與 `extract`，確認 `images/` 有每位候選人的政見欄。
2. 以 Read 工具逐張讀影像。影像寬於 1000 像素時，先在 session 的暫存目錄依欄位裁成多張再讀，裁切的邊界要與下一張重疊至少一行，避免切斷跨欄的句子。
3. 逐字轉錄到 `data/20-extract/{選舉代碼}/transcripts/{選區代碼}-{號次}.txt`：保留原文的標題、編號、項目符號與換行，標點照原文，簡繁照原文，不改寫、不加註。
4. 在 `transcripts.tsv` 登錄每段，欄位依表頭是代碼、參選者、文件、影像、頁、轉錄檔、方法、審核狀態、說明。代碼寫 `{選區代碼}-{號次}-p{序號}`，影像寫抽取層的影像代碼，方法寫「模型判讀」，審核狀態寫「模型審閱、未經獨立複評」，說明寫本節第 6 點的比對判斷。
5. 把名冊以外會洩漏身分的用語寫進 `aliases.tsv`：暱稱、競選口號、標誌文字、政見標題中的人名或黨名。姓名、搭檔與黨名由網站依名冊遮蔽，不重複登錄。
6. 重新執行 `extract`，`extract.json` 每段記有 `ocr_check`：`agreement` 是轉錄稿與 OCR 的字元重合度，`unmatched` 是轉錄稿中找不到的 OCR 行。逐行把 `unmatched` 放大影像對照，OCR 誤讀時保留轉錄稿，轉錄漏字時補上，判斷寫進 `transcripts.tsv` 的說明欄。`agreement` 低於 0.95 時整段重新比對。

<br>

## 2 拆分主張

一則主張只含一個可以單獨支持或反對的政策。同一句原文含多項政策時拆成多則，各自截取對應的一段原文，數字與條件留在它所屬的那一則，不借給其他主張。

- 代碼寫 `{選區代碼}-{號次}-{三位序號}`，依原文出現順序編號。
- 原文欄寫段落中連續的一段，字要與轉錄稿一字不差，起訖先寫 -，寫完後執行 `.venv/bin/python -m pipeline fill-offsets --election {選舉代碼}` 自動填入。
- 只表達價值或口號、沒有政策內容的句子不拆成主張，例如「相信美好台灣」。
- 標題與其下的項目一起閱讀，標題提供的對象或領域寫進欄位，原文欄仍截取項目本身。

<br>

## 3 填寫欄位與 4 提出待審詞

受控欄位依 [field-guide](references/field-guide.md) 填寫，每個值都要是 `vocab-terms.tsv` 已登錄的名稱，多值以頓號分隔，原文沒有提到的欄位寫 -。

詞表版本的規則見 [docs/vocabulary.md](../../../docs/vocabulary.md#版本)。

詞表沒有適合的名稱時，改提新詞，判斷方式見 [field-guide](references/field-guide.md) 的待審詞：

1. 在 `vocab-pending.tsv` 新增一列，裁定寫「待審」，提出理由寫這個概念與既有詞的差別，出處寫引用它的主張代碼。
2. 裁定前主張層失敗。
3. 由維護者裁定。裁定為採用時，把詞加入 `vocab-terms.tsv`，加入版本寫下一個版本號，再把待審列的裁定改成「採用」並寫裁定理由。裁定為駁回時，改用裁定理由指定的既有詞。
4. 維護者授權 Claude 代為裁定時，裁定理由開頭寫「維護者授權代為裁定」，再寫採用或駁回的理由。

<br>

## 5 配題

每則主張至少一列配題，把主張分配到分類樹的面向，同一則主張的分配合計為 1。

- 主張只涉及一個面向時分配寫 1。涉及多個面向時依原文的重點分配，例如「國防預算合理，達到GDP的3%」分給國防預算目標與防衛能力兩個面向各 0.5。同一句含兩項政策時，先在第 2 步拆成兩則主張。
- 面向有對應的題目時，填題目、題目版本、立場與判準。立場依 `rubric-stance.tsv`：原文明確提出題目命題或其具體做法為強烈支持，方向相同但附條件、只涵蓋部分或做法不同為支持，反對方向同理。
- 主張與題目方向無關或無法判斷時，題目寫 -，這一列只計入議題分布。
- 證據寫主張原文中支持這個立場判讀的一段，理由寫判讀的推論。

<br>

## 6 評分

每則主張對 `rubric-specificity.tsv` 的每條判準各評一列，級距寫 `rubric-levels.tsv` 的名稱。

- 依判準表的「未明示、部分明示、完整明示」欄描述選級距，不適用的判準寫「不適用」，例如純粹的立法主張沒有財源可言。
- 部分明示與完整明示要附證據，是主張原文中的一段。未明示與不適用的證據寫 -。
- 只評這則主張的原文，同段其他主張的數字、期限不能拿來加分。

<br>

## 7 出題

依 [question-guide](references/question-guide.md) 出題：題目只來自本選舉候選人的主張，每題至少一筆配題證據。全部已表態的候選人同方向的題目，網站標為共識題，計分方式見 [docs/methodology.md](../../../docs/methodology.md)。出題的步驟：

1. 每個有主張的面向寫一道母題，命題取候選人主張的共同方向，讓支持與反對都能作答。
2. 母題下的候選人做法不同時，寫子題追問具體做法：母題寫在母題欄，顯示條件寫母題的作答代碼，預算份額寫子題分到的比例，母題與子題的份額在網站上依實際出現的題目正規化。
3. 每題對 `axis-ideology.tsv` 有關的軸各寫一列 `question-axes.tsv`，方向寫同意時往正極為 1、往負極為 -1。
4. 每題對 `rubric-neutrality.tsv` 的每條判準各審一列 `neutrality.tsv`，不通過的題目改寫後重審，結果全為通過才能發布。

<br>

## 8 驗證

先執行管線與全部測試，全部通過後再抽查：

```bash
.venv/bin/python -m pipeline run --election {選舉代碼} --offline
npm test
npm run check
```

### 抽查

管線全部通過後，依 [review-protocol](references/review-protocol.md) 的抽查範圍抽查。抽查發現系統性問題時修正判準或詞表，重新執行受影響的步驟。

<br>

## 參考文件

| 檔案 | 主題 |
|---|---|
| [field-guide](references/field-guide.md) | 主張各欄的判讀例、現任政府計畫、待審詞與具體度評分 |
| [question-guide](references/question-guide.md) | 題目欄位、母題與子題、意識形態軸與中立性審查 |
| [review-protocol](references/review-protocol.md) | subagent 的派工、抽查範圍與審核狀態 |
