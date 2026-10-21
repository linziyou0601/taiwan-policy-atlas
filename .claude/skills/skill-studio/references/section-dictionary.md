# 章節標題字典

全體 skill 之 SKILL.md 與 references 檔案的命名基準，涵蓋章節標題、表格欄名與 reference 檔名。標題以正體中文為預設，僅「保留英文清單」列出的技術識別詞維持英文。同一脈絡的同一章節，跨 skill 使用同一中文名；不同脈絡的同名英文詞可依脈絡採不同譯名（例如 Harness 的 Output 譯「產出」、Command 的 Output Format 譯「輸出格式」）。

## SKILL.md 章節對照

SKILL.md 的 H1 顯示名稱同樣以中文為預設（skill 身分在 frontmatter `name`，H1 只是顯示標題），含專有識別詞者保留該詞。

| 原文 | 中文 | 適用脈絡 |
|---|---|---|
| Usage | 用途 | Command / Harness / Other |
| Inputs | 輸入 | Command / Harness / Other |
| Execution Steps | 執行步驟 | Harness |
| Orient | 前置確認 | Harness 首步 |
| Close-out | 結案 | Harness 末步 |
| Instructions | 執行指引 | Command / Other |
| Stop Conditions | 停止條件 | Harness |
| Delegation | 委派 | Harness |
| Output | 產出 | Harness（產物落點表） |
| Export | 匯出 | Harness 選用章節，置於執行步驟之後 |
| Output Format | 輸出格式 | Command（輸出結構模板） |
| Technical Reference | 技術參考 | Command 選用章節，置於執行指引之後 |
| Anti-hallucination | 防幻覺 | Command / Other，涉及 reference 檔或事實陳述時 |
| Completeness Check | 完整性檢查 | Command / Harness / Other |
| Completion Contract | 完成契約 | 模式或步驟內的子段 |
| References | 參考文件 | Command / Rule / Other，Rule 置於審查掛鉤之前 |
| Reference Catalog | 參考型錄 | Harness |
| Reviewability Hooks | 審查掛鉤 | Rule 與供審查消費之 skill |
| Anti-pattern 列舉 | 反例列舉 | 審查掛鉤之子節 |
| Scope | 適用範圍 | Rule / reference 檔 |
| Purpose | 目的 | Rule |
| Boundary | 邊界 | Rule / reference 檔 |
| General Principles | 通用原則 | Rule 的領域規範章節 |
| Technology Stack | 技術堆疊 | Rule 的領域規範章節 |
| Examples | 範例 | 選用子段 |

**領域章節**：Rule 型 skill 的領域章節（如後端的 API 契約、命名與風格、測試）依內容譯為自然中文；審查掛鉤內「條目編號 / 段落名對照」表之段落欄必須同步改用新中文名，兩者不得脫節。

## Reference 檔章節對照

未列於本表的標題依內容譯為自然中文，並在同 skill 內保持一致。

| 原文 | 中文 | 適用脈絡 |
|---|---|---|
| Component: {name} | 元件：{name} | 型錄卡 H1（元件名本身保留英文識別名） |
| Outcome | 產出效果 | 型錄卡 |
| Allowed | 適用 | 型錄卡 |
| Boundary | 邊界 | 型錄卡 |
| Why | 理由 | 型錄卡 |
| Micro-template | 微型模板 | 型錄卡 |
| Variants | 變體 | 型錄卡 |
| Compose with | 搭配 | 型錄卡 |
| Violation handling | 違規處理 | 型錄卡 |
| Compliant：{描述} | 合規範例：{描述} | 型錄卡範例子節 |
| Non-compliant：{描述} | 違規範例：{描述} | 型錄卡範例子節 |
| Filename | 檔名 | 契約檔 |
| Required Structure | 必要結構 | 契約檔 |
| Required Checklist | 必要檢查清單 | 契約檔 |
| Severity Levels | 嚴重度分級 | 契約檔 |
| Iron Rules | 鐵律 | 規則檔 |
| Hard Boundaries | 硬性邊界 | 規則檔 |
| {Topic} Discipline | {主題}紀律 | 結尾條款段 |
| Source To Sub-mode Mapping | 來源到 sub-mode 對照 | source-to-submode 檔 H1 |
| Mapping Table | 對照表 | source-to-submode 檔 |
| Decision Algorithm | 決策演算法 | policy 檔 |
| Priority Rules | 優先順序規則 | source-to-submode 檔 |
| Mode Selection Discipline | 模式選擇紀律 | source-to-submode 檔 |
| Trigger Conditions / Trigger Signals | 觸發條件 / 觸發訊號 | policy 檔 |
| {X} Algorithm | {X}演算法 | policy 檔 |
| Completeness Contract | 完整性契約 | 模板檔（與「完成契約」不同概念） |
| Self-Review Loop | 自審迴圈 | protocol 檔 |
| {Name} Policy（檔案 H1） | {Name} 政策（Name 為技術詞時保留原形） | policy 檔 |
| 介面 / 參數用途 / 常見變體 / 可放置內容 | （中文既定，跨型錄卡沿用） | 元件型錄卡擴充 slot |

## 表格欄名對照

跨檔案重複出現的表格欄名，統一譯法，避免同一概念在不同 skill 家族各自判斷造成不一致。

| 原文 | 中文 | 適用脈絡 |
|---|---|---|
| Reality / Action | 實況 / 處置 | 型錄卡「違規處理」表（2 欄版） |
| Reality / Tier / Action | 實況 / 等級 / 處置 | 型錄卡「違規處理」表（3 欄版，含嚴重度欄） |
| Anti-pattern / Why it hurts | 反例 / 為何有害 | 反例型錄表（Severity 欄名可保留英文，因對應 enum 值 Critical/Major/Minor/Nit） |
| Input / Required / Description / Default | 輸入 / 必要性 / 說明 / 預設 | SKILL.md「輸入」章節之參數表 |
| Criterion / Criteria | 判準 | 評分量表欄名（欄值如 Correctness、Completeness 等評分維度識別詞可保留英文） |

**未列欄名**：依內容譯為自然中文，並在同 skill 內保持一致。純技術輸出模板（例如面向 SRE 讀者的監控報表模板，其表頭本身是業界慣用監控術語）經使用者裁決可保留英文，不強制套用本表。

## 條列式欄位標籤清單的完整性判準

段落內以 `- **{Label}**：` 形式並列多個結構化欄位標籤時（例如描述一個 pattern 或 method 的固定欄位集，如 `What` / `Why` / `Also used in`，或 `Purpose` / `Input/Output` / `Side effects` / `Watch out for`），視整組清單為一個單位判斷語言，不逐詞判斷。

判準：清單內任一標籤已跨檔案有明確中文慣例（如 `Purpose` 對應已中文化的 H2「目的」）不構成單獨翻譯該標籤的理由。若同組清單其餘標籤在全 repo 找不到對應中文版本可比對（例如 `Input/Output`、`Side effects`、`Watch out for`），維持整組清單語言一致優先於單詞對齊字典，否則會產生「一半中一半英」的破碎中英混雜，比原本全英文更糟。

這類清單若要中文化，必須整組一次性翻譯（含清單內所有標籤），不得只選取其中已有字典條目的詞單獨處理。

## 保留英文清單

以下屬跨檔貫通的技術識別詞，於標題與內文一律保留原形：

- 步驟之小寫 id 與 reference 檔名：`inventory`、`classify`、`source-to-submode.md` 等（顯示名依「SKILL.md 章節對照」）
- 取值字典之 enum：sub-mode（`maintain` / `verify` / `quick` 等）、gate（`supervised` / `unattended` / `graduated`）、severity（`Critical` / `Major` / `Minor` / `Info` / `Nit`）、status（`active` / `paused` / `completed` 等）、tier（`frontier` / `standard` / `light`）
- 檔名、目錄名、glob、skill 名、frontmatter 欄位
- 中文技術圈慣用原文之詞：API、DTO、schema、markdown、report、handoff、proposal、case、task、spec、concern、layer、owner、scope、context、token、commit、diff、branch、pipeline、glob、anti-pattern（內文概念詞可用「反例」）

## 內文詞彙基準

敘述句中下列詞統一譯法。enum 值、欄位名、agent 名、步驟 id 與檔名中的英文原形不受本表影響。

| 原文 | 中文 |
|---|---|
| Next Steps | 後續步驟 |
| checkpoint | 檢查點 |
| blocker | 阻塞事項 |
| route summary | 路由摘要 |
| artifact | 產物 |
| evidence | 證據 |
| goal-first | 目標先行 |

**未列片語**：敘述句中可譯者譯為中文，技術術語依保留清單。

## 檔名慣例

新增 reference 檔時先對照本表選擇檔名，檔案性質不在本表內時，先補充本表再建立檔案。同性質檔案跨 skill 同名，讓讀者不必開啟檔案即可預期內容。

| 檔案性質 | 命名 | 位置 |
|---|---|---|
| 產物格式契約 | `{name}-contract.md` | 跨 skill 共用者集中於共用規則的 skill，領域專屬者在擁有它的 skill |
| 決策規則 | `{name}-policy.md` | references/ |
| 行為流程 | `{name}-protocol.md` | references/ |
| 判準型錄索引 | `{topic}-catalog.md` | 擁有該判準的 skill |
| 判準型錄條目 | `{topic}/{entry}.md` | 與型錄索引同名之子目錄 |
| 產出骨架 | `{artifact}-template.md` | 擁有該產出的 skill |
| 來源到 sub-mode 路由 | `source-to-submode.md` | 有 sub-mode 的 Harness skill |
| 元件型錄卡 | `component-templates/{name}.md` | 文件類 skill |
| 反例型錄 | `anti-patterns.md` | 文件類 skill |
| 章節 / 文章模板 | `article-templates.md` 或 `page-types.md` | 文件類 skill |
| 機械收集器 | `collectors/{name}.md` | 文件類 skill |
| skill 設計基準 | `section-dictionary.md`、`{type}-skill-skeleton.md`、`schemas.md`、`output-templates.md`、`trigger-tuning-guide.md` | skill-studio |

## 紀律

- 新增或改寫任何 skill 檔案時，章節標題依本字典。字典未涵蓋的新章節，先補充到本字典再使用。
- 同一 PR 內修改標題時，必同步修改其所有內文引用（含跨檔引用該章節名之處）。
- 保留英文清單之增刪屬治理決策，由使用者裁決。
- 改動任一 skill 的章節骨架、references 檔名或本字典後，執行 `python -m scripts.quick_validate --structure <skill_dir>` 確認必要章節、檔名與文風全數通過。
