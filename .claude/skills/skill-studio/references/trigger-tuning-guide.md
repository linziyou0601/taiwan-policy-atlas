# Trigger Tuning 查詢設計指南

## 目的

觸發調校（trigger tuning）用於優化 Skill 的 `description` 欄位，讓 AI 能正確判斷何時應自動觸發該 Skill。本指南協助設計高品質的觸發評估（eval）查詢。

## 查詢設計原則

查詢應貼近真實（使用者實際可能輸入的內容）、具體且含足夠細節（檔案路徑、個人背景、欄位名稱、機構名稱、既有脈絡），並在長度與風格上有所變化（小寫、縮寫、拼字錯誤、口語表達）。聚焦在邊界案例。

## 應觸發查詢（10 則）

設計會觸發 Skill 的查詢：
- 相同意圖的不同表達方式（正式與口語並陳）
- 使用者未明確指定 skill 名稱或檔案類型，但明確需要該功能
- 仍屬範圍（scope）內的非常見使用案例
- 此 skill 與其他 skill 競爭時仍應勝出的情況

**反例**（過於籠統，缺乏鑑別力）：
- "Review this code"
- "Check my file"

**正例**（真實且具體）：
- "ok so I just finished refactoring the checkout handler to retry failed payments, can you take a look at the error handling? especially the part where we call the payment client - I'm not sure the timeout path rolls back the order"

## 不應觸發查詢（10 則）

設計不應觸發 Skill 的查詢：
- 近似案例：共用關鍵字或概念，但需求不同
- 相鄰領域：看似相關但已超出範圍（scope）
- 若僅做關鍵字比對會誤觸發、實際上不應觸發的模糊表述
- 雖在 Skill 能力範圍內，但在此情境下以另一工具較為合適

**反例**（明顯無關，缺乏鑑別力）：
- "What's the weather today?"
- "Write a Fibonacci function"

**正例**（測試鑑別力的近似案例）：
- "Can you explain how the retry logic works in our codebase? I want to understand the design before I start coding"（應觸發 `explain`，不應觸發 `review`）
