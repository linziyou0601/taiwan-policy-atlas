# Schemas 參考

## 工作區結構

Eval 模式不使用此工作區結構。改為直接從 `evals/` 讀取 eval、執行與評分後寫入 baseline.json。

```text
{scope}-workspace/
├── iteration-1/
│   ├── eval-{id}/
│   │   ├── with_skill/
│   │   │   └── outputs/
│   │   │       └── metrics.json  ← Executor output metrics
│   │   ├── without_skill/        ← Baseline outputs (Benchmark mode only)
│   │   │   └── outputs/
│   │   │       └── metrics.json
│   │   ├── grading.json          ← Grader output
│   │   ├── timing.json           ← Timing captured from task notification
│   │   └── comparison-*.json     ← Comparator blind test results (A/B Test mode only)
│   ├── benchmark.json            ← Aggregated benchmark data
│   ├── analysis.json             ← Analyzer observation notes
│   └── feedback.json             ← User feedback
├── iteration-2/                  ← Same structure as iteration-1
├── history.json                  ← Version progression tracker (Improve mode)
└── skill-snapshot/               ← Previous version snapshot (Improve mode)
```

## evals.json

eval 案例的權威定義來源。位於 `evals/skills/{scope}/evals.json` 或 `evals/agents/{scope}/evals.json`。

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "Review the following service module for code quality issues.",
      "expected_output": "Should identify the missing null check in processOrder() and flag the unsafe cast",
      "files": [],
      "expectations": [
        "The output identifies the missing null check in processOrder()",
        "The output flags the unsafe cast from Object to String",
        "The output does NOT flag the retry decorator as incorrect",
        "Output contains a ## Findings section with severity labels (Critical/Major/Minor)"
      ]
    }
  ]
}
```

**欄位說明：**
- `skill_name`：對應 Skill 或 Agent frontmatter 的 name
- `evals[].id`：唯一整數識別碼
- `evals[].prompt`：要執行的任務
- `evals[].expected_output`：預期中成功輸出的人類可讀說明
- `evals[].files`：選填。相對於 repo 根目錄的輸入檔案路徑
- `evals[].expectations`：可逐條驗證的陳述列表

**expectation 類別**：同一列表中的 expectations 可涵蓋三類：正面（必須符合）、負面（不得誤判）、格式（結構要求）。Grader 對每條 expectation 獨立判定通過或失敗。

## metrics.json

executor agent 的產物。位於 `<run-dir>/outputs/metrics.json`。

```json
{
  "tool_calls": {
    "Read": 5,
    "Write": 2,
    "Bash": 8,
    "Edit": 1,
    "Glob": 2,
    "Grep": 0
  },
  "total_tool_calls": 18,
  "total_steps": 6,
  "files_created": ["review_report.md", "findings.json"],
  "errors_encountered": 0,
  "output_chars": 12450,
  "transcript_chars": 3200
}
```

**欄位說明：**
- `tool_calls`：各工具類型的呼叫次數
- `total_tool_calls`：所有工具呼叫的總和
- `total_steps`：主要執行步驟數
- `files_created`：已建立的產物檔案列表
- `errors_encountered`：執行期間發生的錯誤數
- `output_chars`：產物檔案的總字元數
- `transcript_chars`：執行對話紀錄的字元數

## grading.json

Grader Agent 的產物。位於 `<run-dir>/grading.json`。

```json
{
  "expectations": [
    {
      "text": "The output identifies the missing null check in processOrder()",
      "passed": true,
      "evidence": "Found in Findings section: 'processOrder() lacks null validation for deliveryId parameter'"
    },
    {
      "text": "The output does NOT flag the retry decorator as incorrect",
      "passed": true,
      "evidence": "No mention of the retry decorator in any finding"
    },
    {
      "text": "Output contains a ## Findings section with severity labels",
      "passed": false,
      "evidence": "Output has a Findings section but severity labels are missing"
    }
  ],
  "summary": {
    "passed": 2,
    "failed": 1,
    "total": 3,
    "pass_rate": 0.67
  },
  "execution_metrics": {
    "tool_calls": {
      "Read": 5,
      "Write": 2,
      "Bash": 8
    },
    "total_tool_calls": 15,
    "total_steps": 6,
    "files_created": ["review_report.md"],
    "errors_encountered": 0,
    "output_chars": 12450,
    "transcript_chars": 3200
  },
  "timing": {
    "executor_duration_seconds": 165.0,
    "grader_duration_seconds": 26.0,
    "total_duration_seconds": 191.0
  },
  "claims": [
    {
      "claim": "The review found 3 Critical issues",
      "type": "factual",
      "verified": true,
      "evidence": "Counted 3 items with [Critical] label in output"
    }
  ],
  "user_notes_summary": {
    "uncertainties": ["Used 2023 data, may be stale"],
    "needs_review": [],
    "workarounds": ["Fell back to text overlay for non-fillable fields"]
  },
  "eval_feedback": {
    "suggestions": [
      {
        "assertion": "The output identifies the missing null check",
        "reason": "A generic 'add null checks' suggestion would also pass - consider requiring the specific parameter name"
      }
    ],
    "overall": "Expectations check presence but could be more specific about content correctness."
  }
}
```

**欄位說明：**
- `expectations[]`：每條 expectation 的通過/失敗判定與佐證
  - `text`：原始 expectation 文字
  - `passed`：布林值
  - `evidence`：佐證判定結果的具體引用或說明
- `summary`：彙總統計
  - `passed`：passed=true 的 expectation 數量
  - `failed`：passed=false 的 expectation 數量
  - `total`：已評估的 expectation 總數
  - `pass_rate`：通過率（0.0 至 1.0），計算方式為 passed/total
- `execution_metrics`：從 executor 的 metrics.json 複製而來（如有）
  - `tool_calls`：各工具類型的呼叫次數
  - `total_tool_calls`：所有工具呼叫的總和
  - `total_steps`：主要執行步驟數
  - `files_created`：已建立的產物檔案列表
  - `errors_encountered`：錯誤數量
  - `output_chars`：產物檔案的總字元數（token 用量的相對指標）
  - `transcript_chars`：執行對話紀錄的字元數
- `timing`：來自 timing.json 的牆鐘計時（如有）
  - `executor_duration_seconds`：executor 子代理的耗時
  - `grader_duration_seconds`：grader 子代理的耗時
  - `total_duration_seconds`：該次執行的總經過時間
- `claims`：從產出內容擷取並驗證的陳述
  - `claim`：受驗證的陳述內容
  - `type`：`"factual"`、`"process"` 或 `"quality"` 其中之一
  - `verified`：布林值
  - `evidence`：支持或反駁該陳述的依據
- `user_notes_summary`：executor 標註的備註分類
  - `uncertainties`：executor 不確定的事項
  - `needs_review`：需要人工判斷的項目
  - `workarounds`：採用的替代做法
- `eval_feedback`：選填，Grader 對 expectations 本身的改善建議
  - `suggestions[]`：具體建議列表，每條附有 `reason`，並可選填關聯的 `assertion`
  - `overall`：對 expectation 品質的簡短評估

**關鍵欄位名稱**：expectations 陣列中的每個物件必須使用 `text`、`passed`、`evidence` 欄位。不得使用 `name`/`met`/`details` 或其他變體。

## baseline.json

Eval 模式的快照。位於 `evals/skills/{scope}/baseline.json` 或 `evals/agents/{scope}/baseline.json`。整體分數的標準 key 是頂層的 `pass_rate`，`overall_pass_rate`、`skill_name`、`total_expectations`、`passed_expectations` 這類變體都不符合。

```json
{
  "date": "{run `date -u +%Y-%m-%dT%H:%M:%SZ` via Bash - do NOT hardcode}",
  "model": "{model name or 'unknown'}",
  "pass_rate": 0.83,
  "cases": {
    "1": {
      "passed": 5,
      "failed": 1,
      "total": 6,
      "pass_rate": 0.83,
      "status": "Fail"
    }
  },
  "summary": "..."
}
```

**判定規則：**

整體 pass_rate 是所有 eval 中通過的 expectations 總數除以所有 eval 的 expectations 總數。

| Case pass_rate | Status |
|---------------|--------|
| 1.00 | Pass |
| < 1.00 | Fail |

**基準線比較：**
- Case pass_rate 下降 > 0.10：標記為退步
- Case pass_rate 上升 > 0.10：標記為進步
- 基準線中不存在的新 eval：標記為「New」

## history.json

在 Improve 模式中追蹤版本演進。位於工作區根目錄，供後續 session 自上次中斷處接續。

```json
{
  "started_at": "2026-03-22T10:30:00Z",
  "skill_name": "example-skill",
  "current_best": "v2",
  "iterations": [
    {
      "version": "v0",
      "parent": null,
      "expectation_pass_rate": 0.65,
      "grading_result": "baseline",
      "is_current_best": false
    },
    {
      "version": "v1",
      "parent": "v0",
      "expectation_pass_rate": 0.75,
      "grading_result": "won",
      "is_current_best": false
    },
    {
      "version": "v2",
      "parent": "v1",
      "expectation_pass_rate": 0.85,
      "grading_result": "won",
      "is_current_best": true
    }
  ]
}
```

**欄位說明：**
- `started_at`：改善開始的 ISO 時間戳記
- `skill_name`：正在改善的 skill 名稱
- `current_best`：表現最佳版本的識別碼
- `iterations[].version`：版本識別碼（例如 v0、v1）
- `iterations[].parent`：衍生來源之父版本識別碼
- `iterations[].expectation_pass_rate`：評分後的通過率
- `iterations[].grading_result`：`"baseline"`、`"won"`、`"lost"` 或 `"tie"` 其中之一
- `iterations[].is_current_best`：是否為目前最佳版本

## timing.json

某次執行之牆鐘計時。位於 `<run-dir>/timing.json`。

**擷取方式：** 子代理任務完成時，任務通知會帶有 `total_tokens` 與 `duration_ms`。須當下儲存。此資料不會另存他處，事後無法補救。

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3,
  "executor_start": "2026-03-22T10:30:00Z",
  "executor_end": "2026-03-22T10:32:45Z",
  "executor_duration_seconds": 165.0,
  "grader_start": "2026-03-22T10:32:46Z",
  "grader_end": "2026-03-22T10:33:12Z",
  "grader_duration_seconds": 26.0
}
```

**欄位說明：**
- `total_tokens`：消耗的 token 總數（來自任務通知）
- `duration_ms`：牆鐘計時（毫秒，來自任務通知）
- `total_duration_seconds`：總經過時間（秒）
- `executor_start`：executor 開始的 ISO 時間戳記
- `executor_end`：executor 結束的 ISO 時間戳記
- `executor_duration_seconds`：executor 的牆鐘耗時
- `grader_start`：grader 開始的 ISO 時間戳記
- `grader_end`：grader 結束的 ISO 時間戳記
- `grader_duration_seconds`：grader 的牆鐘耗時

## trigger-cases.json

Trigger Tuning 模式使用的觸發 eval 查詢集合。

```json
[
  {"query": "user prompt text", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

## benchmark.json

Benchmark 模式的彙總資料。位於 `<workspace>/iteration-N/benchmark.json`。

```json
{
  "metadata": {
    "skill_name": "example-skill",
    "skill_path": "/path/to/skill",
    "executor_model": "claude-opus-4-6",
    "analyzer_model": "claude-opus-4-6",
    "timestamp": "2026-03-22T10:30:00Z",
    "evals_run": [1, 2, 3],
    "runs_per_configuration": 3
  },

  "runs": [
    {
      "eval_id": 1,
      "eval_name": "null-check-detection",
      "configuration": "with_skill",
      "run_number": 1,
      "result": {
        "pass_rate": 0.83,
        "passed": 5,
        "failed": 1,
        "total": 6,
        "time_seconds": 42.5,
        "tokens": 3800,
        "tool_calls": 18,
        "errors": 0
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": [
        "Used 2023 data, may be stale",
        "Fell back to text overlay for non-fillable fields"
      ]
    }
  ],

  "run_summary": {
    "with_skill": {
      "pass_rate": {"mean": 0.85, "stddev": 0.05, "min": 0.80, "max": 0.90},
      "time_seconds": {"mean": 45.0, "stddev": 12.0, "min": 32.0, "max": 58.0},
      "tokens": {"mean": 3800, "stddev": 400, "min": 3200, "max": 4100}
    },
    "without_skill": {
      "pass_rate": {"mean": 0.35, "stddev": 0.08, "min": 0.28, "max": 0.45},
      "time_seconds": {"mean": 32.0, "stddev": 8.0, "min": 24.0, "max": 42.0},
      "tokens": {"mean": 2100, "stddev": 300, "min": 1800, "max": 2500}
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+13.0",
      "tokens": "+1700"
    }
  },

  "notes": [
    "Expectation 'Output is valid JSON' passes 100% in both configurations - may not differentiate skill value",
    "Eval 3 shows high variance (50% +/- 40%) - may be flaky or model-dependent"
  ]
}
```

**欄位說明：**
- `metadata`：benchmark 執行的中繼資料
  - `skill_name`：skill 名稱
  - `skill_path`：skill 目錄路徑
  - `executor_model`：執行 skill 的模型
  - `analyzer_model`：用於分析的模型（最強可用模型）
  - `timestamp`：benchmark 執行的時間
  - `evals_run`：包含的 eval ID 列表
  - `runs_per_configuration`：每個配置的執行次數（例如 3）
- `runs[]`：各次執行的結果
  - `eval_id`：數字型 eval 識別碼
  - `eval_name`：人類可讀的 eval 名稱
  - `configuration`：必須為 `"with_skill"` 或 `"without_skill"`
  - `run_number`：整數執行編號（1、2、3…）
  - `result`：包含 `pass_rate`、`passed`、`total`、`time_seconds`、`tokens`、`tool_calls`、`errors` 的巢狀物件
  - `expectations`：每條 expectation 的通過/失敗判定
  - `notes`：executor 的自由格式觀察（選填）
- `run_summary`：各配置的統計彙總
  - `with_skill` / `without_skill`：各含 `pass_rate`、`time_seconds`、`tokens` 物件，欄位為 `mean`、`stddev`、`min`、`max`
  - `delta`：差異字串，如 `"+0.50"`、`"+13.0"`、`"+1700"`
- `notes`：Analyzer 觀察備註（字串陣列）

**Benchmark 判定**：delta 是 with_skill pass_rate mean 減去 without_skill pass_rate mean，依 [aggregate_benchmark.py](../scripts/aggregate_benchmark.py) 的順序判定：
- **High Value**（delta > 0.20）：Skill 明確提供價值
- **Outgrowth**（delta ≤ 0）：Skill 可能已不再必要，model baseline 已追上
- **Inconclusive**（0 < delta < 0.05）：差異過小，須增加 eval 或執行次數方能判讀
- **Moderate Value**（0.05 ≤ delta ≤ 0.20）：Skill 有價值，幅度有限

## comparison.json

Comparator Agent 盲測產物。位於 `<run-dir>/comparison-N.json`。

```json
{
  "winner": "A",
  "reasoning": "Output A provides a complete solution with all required fields. Output B is missing the severity labels.",
  "rubric": {
    "A": {
      "content": {"correctness": 5, "completeness": 5, "accuracy": 4},
      "structure": {"organization": 4, "formatting": 5, "usability": 4},
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {"correctness": 3, "completeness": 2, "accuracy": 3},
      "structure": {"organization": 3, "formatting": 2, "usability": 3},
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.4
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Complete solution", "Well-formatted", "All fields present"],
      "weaknesses": ["Minor style inconsistency in header"]
    },
    "B": {
      "score": 5,
      "strengths": ["Readable output", "Correct basic structure"],
      "weaknesses": ["Missing severity labels", "Formatting inconsistencies"]
    }
  },
  "expectation_results": {
    "A": {
      "passed": 4,
      "total": 5,
      "pass_rate": 0.80,
      "details": [
        {"text": "Output includes severity labels", "passed": true}
      ]
    },
    "B": {
      "passed": 3,
      "total": 5,
      "pass_rate": 0.60,
      "details": [
        {"text": "Output includes severity labels", "passed": false}
      ]
    }
  }
}
```

## analysis.json

Analyzer Agent 產物。位於 `<run-dir>/analysis.json`。

```json
{
  "comparison_summary": {
    "winner": "A",
    "winner_skill": "path/to/winner/skill",
    "loser_skill": "path/to/loser/skill",
    "comparator_reasoning": "Brief summary of why comparator chose winner"
  },
  "winner_strengths": [
    "Clear step-by-step instructions for handling multi-page documents",
    "Included validation script that caught formatting errors"
  ],
  "loser_weaknesses": [
    "Vague instruction 'process appropriately' led to inconsistent behavior",
    "No script for validation, agent had to improvise"
  ],
  "instruction_following": {
    "winner": {"score": 9, "issues": ["Minor: skipped optional logging step"]},
    "loser": {"score": 6, "issues": ["Did not use the skill's formatting template"]}
  },
  "improvement_suggestions": [
    {
      "priority": "high",
      "category": "instructions",
      "suggestion": "Replace 'process appropriately' with explicit steps",
      "expected_impact": "Would eliminate ambiguity that caused inconsistent behavior"
    }
  ],
  "transcript_insights": {
    "winner_execution_pattern": "Read skill -> Followed 5-step process -> Used validation script",
    "loser_execution_pattern": "Read skill -> Unclear on approach -> Tried 3 different methods"
  }
}
```

## Skill 初始 Eval 案例規則

Create 模式在使用者核准定義後自動產生初始 eval 案例：

| Skill 類型 | 自動產生的案例 |
|-----------|---------------------|
| Rule | 1 個 format-check + 1 個 scope-boundary check |
| Command | 1 個 completeness-check + 1 個 format-check + 1 個 boundary-check |
| Harness | 1 個 routing + 1 個步驟完成判準 + 1 個 delegation sanity + 1 個骨架符合 |
| Other | 1 個 format-check |

## Agent 初始 Eval 案例規則

| 案例類型 | 測試內容 |
|----------|--------------|
| delegation-accuracy | 給定任務，驗證 Agent 是否選擇正確的 Skill |
| output-fidelity | 驗證 Agent 是否忠實保留 Skill 產出，未擅自刪除、改寫或另行詮釋 |
