# 輸出模板

以下為 Skill Studio 各模式報告的建議 Markdown 骨架。程式碼區塊內的章節標題為定稿名稱，直接沿用；`{...}` 佔位符號於執行時替換為實際內容。

## Eval 報告

```markdown
# {report_title}: {scope}

## 摘要
- **日期**: {目前日期}
- **評估數量**: {total} | **通過數量**: {count} | **失敗數量**: {count}
- **整體通過率**: {passed expectations / total expectations，取兩位小數}

## 各 Eval 結果

| Eval ID | Prompt（截斷） | 通過 | 失敗 | 總數 | 通過率 | 狀態 |
|---------|-------------------|--------|--------|-------|-----------|--------|
| {id} | {prompt 的前 50 個字元} | {n} | {n} | {n} | {rate} | {Pass/Fail} |

## 退化
{列出每個失敗的評估及其具體細節}
- **Eval {id}**: {哪些 expectations 失敗以及為什麼}

## 基準線比較
{僅於本輪之前已存在 baseline.json 時輸出}
- **基準線日期**: {日期}
- **退化**: {評估列表或 "None"}
- **改善**: {評估列表或 "None"}
- **新評估**（不在基準線中）: {評估列表或 "None"}

## 建議
{修復偵測到的退化的可行建議}
```

## 改善報告

```markdown
# {improvement_report}: {scope}

## 使用者回饋摘要
{使用者回饋的摘要，或「未提供使用者回饋，依 expectations 繼續分析」}

## 失敗分析
{對每個失敗的評估：哪些 expectations 失敗、預期什麼、發生了什麼、可能的原因}

## 模式分析
{跨評估的模式識別}

## 重複工作偵測
{在逐字稿中找到的模式。例如所有測試各自寫了相似的腳本，表示 skill 應內建該功能}

## 建議修改
{對 Skill / Agent 定義的具體、可行修改}

## 防過擬合檢查
{對每個建議：是否泛化？會不會破壞目前通過的評估？是否加入僵硬限制，而解釋理由會更好？}

## 後續步驟
重新執行 `/skill-studio scope={scope}` 以驗證改善
```

## Benchmark 報告

```markdown
# {benchmark_report}: {scope}

## 結果
| 配置 | 通過率 | 平均 tokens | 平均耗時 |
|--------------|-----------|------------|----------|
| 載入 skill | {mean} +/- {stddev} | {tokens} | {time} |
| 未載入 skill | {mean} +/- {stddev} | {tokens} | {time} |

## 無鑑別度 Eval
{兩個配置皆通過的評估，可能表示評估太容易}

## 高變異 Eval
{不同執行間結果不一致的評估，可能表示評估不穩定或行為非確定性}

## 分析觀察
{分析子代理的自由格式筆記，聚合指標隱藏的模式}

## 判定
{High Value / Moderate Value / Inconclusive / Outgrowth}

## 建議
{保留 skill / 淘汰 skill / 需要更多測試案例}
```

## A/B Test 報告

```markdown
# {ab_report}: {scope}

## 逐 Eval 結果
| Eval ID | 勝者 | 理由 |
|---------|--------|--------|

## 彙總
- **Version A 勝**: {count}
- **Version B 勝**: {count}
- **平手**: {count}

## 揭盲分析
{分析子代理的洞察：勝者為何勝出、對敗方的具體 skill 改進}

## 判定
{Version A 較佳 / Version B 較佳 / 無顯著差異}
```

## Trigger Tuning 報告

```markdown
# {trigger_report}: {scope}

## 原始 description
{原始描述}

## 優化後 description
{優化描述}

## 準確度比較
| 指標 | 原始 | 優化後 |
|--------|----------|-----------|
| True Positive Rate | {rate} | {rate} |
| True Negative Rate | {rate} | {rate} |

## 迭代紀錄
{每次迭代的改善摘要}

## 限制
{觸發測試若為啟發式（無 `claude -p` CLI 可用），在此註明}
```
