# Command Skill 骨架

Command 型 skill 之 SKILL.md 章節骨架。Command 型由使用者顯式呼叫，單回合完成一項明確任務。建立或改寫 Command 型 skill 時，先依本骨架起稿再填入領域內容。

## 章節骨架

```markdown
---
name: {verb}-{object}
description: {做什麼 + 適用於何時使用}
disable-model-invocation: true
---

# {顯示名}

## 用途

{一段：做什麼、何時使用、產出去向}

## 輸入

| 輸入 | 必要性 | 說明 | 預設 |
|---|---|---|---|

## 執行指引

{執行步驟，祈使語氣，階段化子段}

## 輸出格式

{輸出結構模板}

## 防幻覺

{領域防幻覺規則}

## 完整性檢查

{可逐列打勾的產出檢查，至少 3 項}
```

## 章節約定

| 章節 | 約定 |
|---|---|
| 用途 | 一段完整敘述。相鄰工作以正向歸屬句指明所屬 skill |
| 輸入 | 標準 4 欄表 |
| 執行指引 | 依執行順序分子段，每子段祈使語氣 |
| 輸出格式 | 固定模板以 code fence 呈現，佔位符號以大括號標示 |
| 防幻覺 | 涉及 reference 檔或事實陳述時必填 |
| 完整性檢查 | 可逐列打勾，至少 3 項 |

## 骨架外事項

- 章節標題譯名依 [section-dictionary](section-dictionary.md)。
- 需要 References 章節時置於完整性檢查之後，命名為「參考文件」。
- 領域需要的選用章節（例如「技術參考」）可插在必要章節之間，章名先登記到 [section-dictionary](section-dictionary.md)。
- 內容一律描述 skill 的現在樣貌，遷移殘影詞與空話詞由 `scripts/quick_validate.py --structure` 的文風檢查攔截。
