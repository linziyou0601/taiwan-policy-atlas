---
name: skill-studio
description: 統一管理 Skill 與 Agent 的生命週期：建立定義、執行評估、分析失敗、基準測試、A/B 測試版本與優化觸發準確性。使用於建立、評估或改善任何 Skill 或 Agent。
disable-model-invocation: true
---

<!-- Anthropic reference: https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md -->
<!-- Anthropic blog: https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills -->

# Skill 與 Agent Studio

## 用途

統一管理 Skill 與 Agent 的生命週期，涵蓋 Create、Eval、Improve、Benchmark、A/B Test 與 Trigger Tuning 模式。

## 輸入

工作區結構、評分格式、計時資料擷取與 benchmark 彙整的 schema 定義，見 [schemas](references/schemas.md)。

| 輸入 | 必要性 | 說明 | 預設 |
|---|---|---|---|
| `mode` | 選填 | `create`、`eval`、`improve`、`benchmark`、`ab`、`trigger` | 若提供 `scope` 則為 `eval`，否則為 `create` |
| `scope` | 選填 | 目標 Skill 或 Agent 名稱 | 詢問使用者 |
| `target` | 選填 | `skill` 或 `agent` | `skill` |
| `cases` | 選填 | 指定要執行的 eval ID（逗號分隔），適用 eval/benchmark/ab 模式 | scope 內所有 eval |
| `type` | 選填 | create 模式專用：`rule`、`command`、`harness` 或 `other` | 詢問使用者 |

**子代理**：負責評分、盲測比較與 benchmark 分析的特化子代理位於 `agents/` 目錄，產生這類子代理前先讀取對應檔案。

## 執行指引

### 路由到模式

依 `mode` 參數或從 context 推斷模式：
- 使用者說「建立 skill/agent」或未提供 `scope` -> 「Create」
- 使用者提供 `scope` 但未指定模式 -> 「Eval」
- 使用者說「improve」或「fix」且已有 eval 結果 -> 「Improve」
- 使用者說「benchmark」或「compare with baseline」-> 「Benchmark」
- 使用者說「A/B test」或「compare versions」-> 「A/B Test」
- 使用者說「trigger tuning」或「optimize description」-> 「Trigger Tuning」
- 若使用者意圖無法明確對應到任何模式，詢問要用哪種模式
- 若使用者明確說「skip eval」或「just look at it」，直接分析 Skill 定義，不要求 baseline，視為不帶正式 eval 前提的輕量 Improve

---

## 模式：Create

### 擷取需求

撰寫任何內容之前，先釐清使用者需求。若對話中已出現工作流程或修正意見，先從 context 擷取答案，僅就缺漏處提問。

**For Skills (`target=skill`):**
- **Skill name**：使用 kebab-case，命名慣例依下方類型表
- **Skill type**：rule / command / harness / other
- **Purpose**：一句話說明（做什麼與何時使用）
- **Reference sources**：要引用的既有 skill 型錄，或本 skill 自己 `references/` 下的型錄檔
- **Trigger context**：此 skill 何時應啟動？

**For Agents (`target=agent`):**
- **Agent name**：kebab-case，業界慣例（planner、implementer、reviewer）
- **Role description**：一句話責任描述
- **Preloaded skills**：開工時要預載哪些 Skill
- **Model tier**：`light` / `standard` / `frontier`
- **Read-only**：是否唯讀

### 訪談與研究

主動詢問邊界案例、輸入 / 輸出格式、範例檔、成功標準與依賴關係。需求尚未穩固前，勿進入撰寫階段。

確認可用工具。若有助於研究（搜尋文件、尋找類似 skill、查閱最佳實踐），在可動用子代理時改以並行研究，否則改在 inline 執行。事先備妥 context，減輕使用者負擔。

### 撰寫 Skill

**類型與骨架**：先依下表決定類型，各類型的章節集合、順序與章節約定以骨架檔為準，同類型 skill 跨全工作區同骨架。章節標題語言、譯名一致性、輸入表欄名與 reference 檔名慣例依 [section-dictionary](references/section-dictionary.md)，標題以正體中文為預設，僅該字典「保留英文清單」列出的技術識別詞維持英文。類型決定章節骨架，觸發類別決定 frontmatter 與 description 後綴。

| 類型 | 判準 | 命名慣例 | 判定訊號 | 骨架 |
|---|---|---|---|---|
| Rule | 編輯對應檔案時自動套用的撰寫規範，描述產物應有的樣貌 | `rule-{domain}` | 名稱前綴 `rule-` | [rule-skill-skeleton](references/rule-skill-skeleton.md) |
| Command | 單回合完成一項明確任務，產出有固定格式 | `{verb}-{object}` | 章節含「執行指引」「輸出格式」與「完整性檢查」 | [command-skill-skeleton](references/command-skill-skeleton.md) |
| Harness | 多步驟編排，產出 report、handoff 或 task | `{domain}` | 章節含「執行步驟」 | [harness-skill-skeleton](references/harness-skill-skeleton.md) |
| Other | meta、工具、coach 類 | 依用途命名 | 不符上列訊號 | [other-skill-skeleton](references/other-skill-skeleton.md) |

**觸發類別**：frontmatter 依觸發方式分三類，description 結尾用對應的中文後綴：

| 類別 | `disable-model-invocation` | description 中文後綴 | 適用情境 |
|---|---|---|---|
| 自動注入 | 不設 | 「規則（適用於 X）」 | 編輯對應檔案 glob 時自動注入撰寫規範 |
| 主動建議 | 不設 | 「於 X 時應主動建議使用」 | Harness 型或高成本 skill。使用者沒有指名 skill、但描述的需求與 skill 相符時，AI 主動建議啟動，使用者確認 scope / gate 後才執行 |
| 顯式呼叫 | `: true` | 「適用於 X 時使用」 | 只由 `/slash-command` 呼叫。單一明確任務或唯讀分析 |

**description**：寫得略為「積極」，說明 skill 做什麼，也寫清在哪些情境應主動啟動。觸發不足（該用沒用）比觸發過度（建議了使用者可拒絕的 skill）更糟。例如主動建議類 skill 寫成「審查程式碼的品質問題。」只交代做什麼，改寫為「審查程式碼的品質問題，包含命名、錯誤處理、分層與測試涵蓋。於使用者提及 review、檢查、看一下這段 code 等意圖時應主動建議使用。」才寫出觸發情境。frontmatter 範本如下：

```yaml
---
name: {skill-name}
description: {what it does + when to use it + 對應類別之中文後綴}
# disable-model-invocation: true   # 顯式呼叫類設定；自動注入與主動建議類不設
---
```

**撰寫原則**：本文結構因類型而異，下列原則一體適用。先寫草稿，再以新鮮眼光審閱，想清楚使用者需要什麼，並把這份理解寫入指令。每個 generate 類型的 skill 都包含防幻覺區段與至少 3 項的完整性檢查，產出 Markdown 者引用工作區的 markdown 撰寫 rule。

- **解釋原因**：要求 model 執行某件事時，說明它能預防哪些失敗，略過會有什麼後果。現今的模型理解緣由後，能在沒見過的輸入上做出正確判斷；全大寫的 ALWAYS、NEVER 或過度僵硬的結構，反而讓它在灰色地帶過度套用。發現自己在寫強硬措辭時，改為說明理由。
- **正向陳述**：規則寫成「做什麼」。禁令只用於目前實際會發生、或有業務與安全理由的失敗，並附上理由；正面規則後面追加的括號禁令會稀釋重點，直接刪除。
- **範例乾淨**：範例是 model 最強的訊號，它會照著範例的長度、語氣與句型寫。範例本身要符合 skill 自己的每一條規則；範例與規則不一致時，model 會沿用範例的寫法。
- **保持精簡**：移除不影響輸出品質的指令。只為「以防萬一」而寫、從未對應真實失敗的指令，會稀釋重要的指令。判斷時閱讀執行逐字稿，最終輸出只是其中一部分證據。
- **維持通用**：指令寫給所有適用的 repo 與情境。路徑以 repo 入口文件（例如根目錄的 `AGENTS.md`）定義的名稱引用，實際路徑只寫在入口文件；專案特有的名稱只出現在綁定該專案的 skill。
- **依賴方向**：引用關係由上層指向下層。B 沒有引用 A 時，修改 A 可以決定是否引用 B，B 維持不引用 A。改寫既有 skill 時，不新增原本沒有的跨 skill 引用。
- **漸進揭露**：SKILL.md 在 500 行以內。偶爾才需要的細節放 `references/`，腳本放 `scripts/`。
- **祈使語氣**：直接命令，例如「讀取檔案」。
- **防幻覺 pattern**：reference 檔先確認存在，讀取後再使用。

### 撰寫 Agent

每個 Agent 有兩份定義，職責內文相同：`.claude/agents/{agent-name}.md` 供 Claude Code，`.codex/agents/{agent-name}.toml` 供 Codex。內文只放核心職責與回傳內容，具體指令留在 Skill；Agent 是組合 Skill 的角色外殼，界定角色、模型等級與預載 Skill。

**Claude Code 版**：限制寫在 frontmatter，由執行環境強制套用。`model` 依建議模型等級對應 `haiku`（light）、`sonnet`（standard）、`opus`（frontier），沿用主 session 的模型時寫 `inherit`。審查與預檢這類唯讀的 Agent 以 `disallowedTools` 移除寫入工具。`skills` 列出啟動時預載的 Skill，`disable-model-invocation: true` 的 Skill 無法預載。`maxTurns` 是回合上限，達上限時 Agent 回傳部分結果，主 agent 可接續。

```markdown
---
name: {agent-name}
description: {role description + when to delegate}
model: {haiku / sonnet / opus / inherit}
disallowedTools: Write, Edit, NotebookEdit
skills:
  - {skill-1}
maxTurns: {N}
---

你是 {agent-name}，負責 {一句話責任描述}。

## Responsibilities

1. {職責與回傳內容}
```

**Codex 版**：沒有預載與回合上限欄位，預載改在 `developer_instructions` 開頭寫明開工前先讀取哪些 Skill，唯讀以 `sandbox_mode` 表示，省略 `model` 時沿用 session 的模型。

```toml
name = "{agent-name}"
description = "{與 md 版相同}"
sandbox_mode = "read-only"
developer_instructions = """
你是 {agent-name}，負責 {一句話責任描述}。

開工前先讀取下列 Skill 的 `SKILL.md`，依任務需要再讀取其 references：`{skill-1}`。

## Responsibilities

1. {職責與回傳內容}
"""
```

### 自我檢查

呈現前確認：
- Frontmatter 含所有必要欄位
- Description 是完整句子（what + when）
- 以解釋後果取代粗體大寫強調標記
- 指令使用祈使語氣
- 涉及 reference 檔時有防幻覺 pattern
- 總長度在 500 行以內（或已使用 `references/`）
- Skill 執行 `python -m scripts.quick_validate --structure <skill_dir>` 後通過。此檢查依判定訊號自動判定類型，涵蓋必要章節、references 檔名與文風攔截
- Agent 的 md 與 TOML 兩份定義，description 與職責內文一致

### 測試案例

此步驟為選用。eval 是退化防護，維護它有成本：團隊近期未在維護 evals 時，先詢問使用者是否要建立，跳過即不產生 eval 檔（之後隨時可用 Eval 模式補建）。使用者要建時才執行以下步驟。

使用者核准定義後，提出 2-3 個真實測試 prompt（貼近實際使用者會說的話），與使用者確認後儲存至 `evals/skills/{skill-name}/evals.json` 或 `evals/agents/{agent-name}/evals.json`。先寫 prompt，待使用者確認 prompt、並掌握測試案例樣貌後，再起草 expectations 會順手得多。

**自動產生的案例**：Skill 依類型、Agent 依案例類型產生初始案例，規則見 [schemas](references/schemas.md) 的「Skill 初始 Eval 案例規則」與「Agent 初始 Eval 案例規則」。

**素材落點**：eval 的素材與評分都留在 `evals/` 內。引用工作區檔案的 case 會在那些檔案被歸檔或改寫時失分，表面上像 skill 退化，實際上是素材已遺失，而每次歸檔都會讓 baseline 假性退化。

- 評分不依賴 `evals/` 以外的檔案內容。
- 素材小且單一 case 使用時內嵌 prompt。素材大、跨 case 共用，或 skill 本身要讀取檔案，放 `evals/skills/_fixtures/` 並以 `files` 欄位指定，prompt 只寫任務。
- 路徑可當作情境中的識別字出現，前提是沒有任何 expectation 需要讀取它，且該路徑在工作區內不存在。測試「來源不存在」「範圍外」的 case 依此保留。
- 多數 case 不需要素材。expectation 驗證的是路由、sub-mode 判定、阻塞判定或邊界拒絕時，prompt 本身即是完整輸入。
- prompt 承諾會提供的內容要實際出現在 case 內。寫「依我後面說的方向」卻沒有附上方向時，skill 只能回頭索取輸入，依賴該輸入的 expectation 全部落空，表面上像 skill 無法執行。

### 呈現並寫入

向使用者呈現完整定義。取得調整意見後再寫入。核准後，寫入定義檔與 eval 案例。

---

## 模式：Eval

Eval 要回答的是：「skill 失效了嗎？」這屬於退化防護：通過 eval 表示已知行為沒有退化，輸出品質另由 Benchmark 與 A/B Test 比較。

### 確定 Eval 案例

- 讀取 `evals/skills/{scope}/evals.json`（或 `evals/agents/{scope}/evals.json`）
- 若提供 `cases` 參數，僅保留對應的 eval ID
- 若找不到檔案或沒有定義 eval，通知使用者並停止

### 解析每個 Eval

從 `evals.json` 每個項目提取欄位，欄位定義見 [schemas](references/schemas.md) 的 `evals.json`。eval 引用檔案時從指定路徑讀取。

### 執行目標並擷取輸出

對 eval 的 prompt 執行目標並將完整輸出擷取為字串。此輸出是評分步驟的原始材料。

- **可呼叫的目標**：使用 Skill tool 呼叫目標，擷取回傳輸出
- **`disable-model-invocation: true` 的目標**：讀取目標的定義檔（SKILL.md 或 agent .md），如同自己是目標一樣將其指令套用至 prompt，擷取產出的輸出
- **Agents**：以 prompt 當作任務描述呼叫目標 Agent，擷取回傳輸出

**隔離執行**：每個 eval 由一個作答者子代理在自己的工作目錄執行，作答不受本 session 的 context 與其他 eval 的輸出影響：
- 工作目錄放 skill 副本、repo 根目錄的 `AGENTS.md` 與 eval 的 `files`，作答者只讀取這個目錄。
- 作答者的任務檔只寫要載入的目標與 eval 的 `prompt`，不附提示或 expectations。
- 作答者的產物寫在工作目錄：請求要求修改的檔案就地修改，其餘產物寫在 `work/`，只供當次指令使用的暫存檔可以寫在工作目錄外。作答者不建立子代理，完成後把回覆寫入 `answer.md`，依序把讀取過的檔案、執行的指令與寫入過的檔案記錄到 `transcript.md`。
- 指定多個作答模型時，每個模型各執行一輪，baseline 的 `model` 記錄作答模型。
- 隔離由主 agent 負責：作答後比對素材原版，確認內容與作答前相同。expectation 驗目標本身的規定，隔離的規定由這一步檢查。

**計時資料**：擷取後立即從任務通知將計時資料（`total_tokens`、`duration_ms`）寫入 `timing.json`。這筆資料只出現在任務通知裡，錯過就無法取回。

接著為輸出評分。在完成下方「完成契約」列出的事項之前，eval 不算結束。

### 依 Expectations 評分輸出

對每個 eval，比對擷取的輸出與 eval 的 expectations，產出「評分 checklist」，並為每個 expectation 標明通過或失敗與對應證據。

**比對方式**：以關鍵概念比對，措辭可以不同。僅當輸出明確將項目標成問題時才算「標示」。順帶一提不構成 false positive。

**評分 checklist**（對每個 eval 產出此內容）：

```text
=== Grading: eval {id} ===
Expectations:
  #1 [{expectation text}] -> PASS/FAIL | Evidence: "{matching text or N/A}"
  #2 [{expectation text}] -> PASS/FAIL | Evidence: "..."
  #3 [{expectation text}] -> PASS/FAIL | Evidence: "..."
```

**評分者**：由 [grader](agents/grader.md) 的 grader 子代理獨立評分，不修改作答者的檔案、skill 與 `evals.json`。需要重新執行腳本的條目，在作答者的工作目錄重新執行，輸出寫在工作目錄之外。

### 判定結果

依 [schemas](references/schemas.md) 的 `baseline.json` 判定規則，計算整體 pass_rate 與每個案例的 Pass 或 Fail。

### 儲存 Baseline 快照

寫入 `evals/skills/{scope}/baseline.json`（或 `evals/agents/{scope}/`）。若 `baseline.json` 已存在，讀取後再覆蓋，依同一節的基準線比較標出退化、改善與新 eval。key 與結構依 [schemas](references/schemas.md) 的 `baseline.json`。

### 完成契約

回報結果前，須先列出所有 eval 的完成狀態。每個 eval 都要標成 Done 或 Skipped，並附理由。這很關鍵：一次執行多個 eval 時，很容易無法確認哪些已評分。若悄悄遺漏評分，退化可能被忽略。若有 TodoList，應把每個 eval 列成項目，避免遺漏。

---

## 模式：Improve

這是循環的核心：測試案例已執行完成，使用者也可能（選擇性）檢視過結果，接下來要讓 skill 變得更好。

### 收集使用者回饋

分析資料前，向使用者呈現 Fail 案例的輸出。對每個 Fail eval，顯示：
- eval prompt
- 實際產出的輸出
- 哪些 expectations 失敗

**收集回饋**：請使用者提供回饋。若回饋留白，代表使用者認為輸出雖未滿足 expectation 仍可接受。此時改進應聚焦在有具體抱怨的 eval。逐案回饋先於 AI 自行修正：先讓使用者檢視輸出，再進入分析。

若使用者明確說「skip feedback」或「just analyze」，直接分析。

### 分析失敗案例

讀取最近的 `baseline.json` 與收集到的使用者回饋。對每個 Fail eval：
- 從 `evals.json` 讀取 eval 定義與評分結果
- 找出具體差距：哪些 expectations 失敗，為什麼？
- 與使用者回饋交叉比對：若有具體抱怨，優先於單純的 expectation 未過
- 讀取目標的定義檔，理解差距的成因

### 找出型態

跨失敗案例分析：
- 同類型的 expectation 在多個 eval 中持續失敗？（例如格式 expectation 持續失敗 -> 缺少輸出格式指令）
- 同類型的 finding 持續遺漏？（例如防幻覺陷阱持續失敗 -> 防幻覺區段薄弱）
- 結構性問題？（例如錯誤的骨架類型、缺少 reference 檔）

### 找出重複工作

讀取測試執行的逐字稿，留意各子代理是否各自寫了類似的輔助腳本，或重複採用同一套多步驟流程。若三個測試案例都讓子代理寫出 `create_docx.py` 或 `build_chart.py`，這是強烈訊號，表示 skill 應把該腳本納入維護：撰寫一份，存放到 `scripts/`，並在 skill 中指示使用它，往後每次呼叫就不必重造輪子。

### 以防過度擬合機制提案變更

對每個建議的變更，提案前先回答以下問題。修正只對一個案例有益且有過度擬合風險時，標記出來並建議替代方案，例如不同措辭、更廣泛的原則，或用 reference 檔取代 inline 約束：
- 此修正是否能泛化，還是只對特定失敗案例有幫助？若只有一個案例受益，試著用更廣泛的原則代替狹窄的補丁
- 此變更會導致目前通過的案例失敗嗎？檢查範圍不限於失敗案例，要在腦中檢查所有案例
- 這是否在加入僵硬約束（MUST、NEVER）？解釋原因通常更有效，僵硬約束過度擬合已知案例，遇到沒見過的案例就失效

**修訂草稿**：撰寫 skill 修訂草稿，再以新鮮眼光審閱並改進。理解使用者需要什麼，並把這份理解寫入指令。遇到全大寫的 ALWAYS 或 NEVER，改為說明原因。

向使用者呈現建議。核准後套用變更。

### 重新評估

套用變更後，對所有 eval（不只是之前失敗的）重新執行 Eval，以偵測退化：`/skill-studio scope={scope}`

持續迭代直到：
- 使用者表示滿意
- 所有回饋都是空的（一切看似良好）
- 已無法取得有意義的進展

### 追蹤版本歷史

每次改進迭代後，更新 workspace root 的 `history.json`。此檔用來追蹤歷次嘗試的版本、對應 pass rate 與目前最佳結果，讓後續 session 能從上次中斷處接續，免於重複勞動。Schema 見 [schemas](references/schemas.md)。

---

## 模式：Benchmark

### 同一輪產生所有執行

對每個 eval，在同一輪產生載入 skill 與不載入 skill 的子代理各一個。全部同時啟動，讓完成時間大致相近。

**With-skill run:**
- 以 eval 的 prompt 呼叫目標，將輸出儲存至 `<workspace>/iteration-N/eval-{id}/with_skill/outputs/`

**Without-skill run**（相同 prompt，不載入 skill）：
- 將輸出儲存至 `<workspace>/iteration-N/eval-{id}/without_skill/outputs/`

**執行次數**：每個 eval 各設定執行 3 次，以降低 LLM 變異的干擾。

### 執行期間同步草擬 Expectations

善用等待時間。若尚無 expectations，趁現在起草。若已有 expectations，重新審閱。好的 expectations 應可客觀驗證，且名稱具描述性，讓人在報告中一眼就能理解各自驗證什麼。

### 執行完成時擷取計時資料

每個子代理任務完成時，須立即從通知將 `total_tokens` 與 `duration_ms` 寫入 `timing.json`。這是唯一能可靠擷取此資料的時機。

### 評分、彙整與分析

1. **逐次評分**：產生 grader 子代理（讀取 [grader](agents/grader.md)），就每個 expectation 對輸出評判，並將結果寫入 `grading.json`。executor 須將含工具呼叫次數、建立檔案數與輸出大小的 `metrics.json` 寫入 `outputs/`（見 [schemas](references/schemas.md)）
2. **彙整 benchmark**：執行 `python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>`，計算各設定的 pass_rate mean/stddev，並產出 `benchmark.json`。以腳本執行確定性運算，勿手動計算
3. **分析**：產生 analyzer 子代理（讀取 [analyzer](agents/analyzer.md) 的「Analyzing Benchmark Results」章節），從彙整統計中找出平均數可能掩蓋的模式

### 向使用者呈現結果

向使用者展示：
- Pass rate 比較（with-skill vs without-skill）
- 無區分性案例（兩邊都通過，可能代表 eval 太鬆）
- 高變異案例（多次執行結果不一致，可能不穩定）
- 判決，依 [schemas](references/schemas.md) 的 Benchmark 判定
- Analyst 觀察

**收集回饋**：請使用者提供回饋。若留白，代表輸出可以接受。改進應聚焦在有具體抱怨的 eval。

### 判決

以 [aggregate_benchmark.py](scripts/aggregate_benchmark.py) 輸出的 delta 套用 [schemas](references/schemas.md) 的 Benchmark 判定。

**儲存結果**：將 benchmark 結果儲存至 workspace 的 `benchmark.json`。Schema 見 [schemas](references/schemas.md)。

### 迭代循環

分析 Benchmark 結果後，若使用者想要改進：

1. 對 skill 套用改進（進入 Improve 模式）
2. 將所有測試案例重新執行至新的 `iteration-<N+1>/` 目錄，包含 baseline 執行
3. 呈現結果並與前一次迭代比較
4. 等使用者審視並告知完成
5. 讀取新回饋，再次改進，重複

---

## 模式：A/B Test

### 執行盲測比較

對每個 eval，產出下列輸出：
- **Version A**（current）：以目前定義執行
- **Version B**（previous or alternative）：以前一版本或使用者指定的替代版本執行

產生 comparator 子代理（讀取 [comparator](agents/comparator.md)），將兩份輸出隨機標為「Output X」/「Output Y」，勿揭露對應版本。comparator 依評分量表評估兩份輸出，每個案例附一段說明後選出贏家。

### 事後分析

盲測比較後，產生 analyzer 子代理（讀取 [analyzer](agents/analyzer.md)）為盲測結果揭盲：對照 skill 與執行逐字稿，釐清贏家勝出的原因，並提出改進建議。

### 彙整並回報

回報每個案例的贏家與整體贏家。若出現原先預期較差版本卻勝出的案例，須以 Analyzer 的觀察說明原因。

將 A/B 測試結果儲存至 workspace。`comparison.json` 與 `analysis.json` schema 見 [schemas](references/schemas.md)。

---

## 模式：Trigger Tuning

### 產生 Trigger Eval Query

依 [trigger-tuning-guide](references/trigger-tuning-guide.md) 建立應觸發與不應觸發的 eval query。

### 與使用者確認

呈現 query，請使用者編輯、新增或刪除項目。eval query 品質差會直接拖累 description，此步驟不可跳過。

### 執行優化循環

**腳本行為**：使用目前 session 的 model ID，使觸發測試與使用者實際體驗一致。資料分割、每個 query 的執行次數與迭代上限採 [run_loop.py](scripts/run_loop.py) 的參數預設值。腳本以保留測試集的答對數選出最佳 description，避免過度擬合。

將 eval 集儲存至 workspace，然後在後台執行：

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --verbose
```

**進度回報**：循環執行時，定期查看輸出，向使用者更新目前迭代編號與分數。

**限制**：腳本須能呼叫 `claude -p` CLI。若 `claude -p` 不可用，觸發測試須改採啟發式：由 LLM 依推理推估 description 是否會觸發，但無法驗證實際觸發管線。報告中須誠實揭露此限制。

將 query 儲存至 `evals/skills/{scope}/trigger-cases.json`。

### 套用結果

向使用者呈現優化後的 description，附上準確度比較（原始 vs 優化的 TPR/TNR）。核准後，更新 Skill frontmatter。

## 輸出格式

各模式完整的輸出模板見 [output-templates](references/output-templates.md)。

## 防幻覺

- 僅依據本 session 中產出的輸出對每個 eval 評分，不依據預期或假設的行為評分
- 檢查 expectations 時，以關鍵概念比對，措辭可以不同
- 只有輸出明確標示為問題時才算 false positive，順帶提及不算
- 不捏造退化：若 eval 通過所有 expectations，勿新增退化項目
- 不捏造 skill 名稱、檔案路徑或不在 workspace 中的 reference 文件
- 在 Create 模式產生骨架 code 範例時，清楚標示為模板佔位符號
- 須立即從任務通知擷取計時資料。此資料不會自動持久化到別處
