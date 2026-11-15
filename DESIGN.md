---
version: alpha
name: 台灣政策圖譜 Frontend Design System
description: 台灣政策圖譜前端視覺設計的權威參照，供 AI agent 修改介面時引用
colors:
  primary: "oklch(51% 0.13 40)"
  primary-hex: "#A24725"
  danger: "oklch(52% 0.17 28)"
  danger-hex: "#B6322B"
  success: "oklch(52% 0.12 150)"
  success-hex: "#287C42"
  info: "oklch(51% 0.13 40)"
  info-hex: "#A24725"
  warning: "oklch(58% 0.13 75)"
  warning-hex: "#A66D00"
typography:
  h1:
    fontSize: 3rem
    fontWeight: 700
  h2:
    fontSize: 1.125rem
    fontWeight: 600
  rootFontSize: 16px
rounded:
  xs: 0.125rem
  sm: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  2xl: 1rem
  3xl: 1.5rem
  4xl: 2rem
  full: 9999px
spacing:
  touchTarget: 2.5rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.full}"
  button-neutral:
    rounded: "{rounded.full}"
  status-panel-info:
    textColor: "{colors.info}"
    rounded: "{rounded.lg}"
  status-panel-warning:
    textColor: "{colors.warning}"
    rounded: "{rounded.lg}"
  status-panel-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.lg}"
  card-content:
    rounded: "{rounded.2xl}"
    elevation: none
  card-flow:
    rounded: "{rounded.3xl}"
    elevation: shadow-sm
---

# Frontend Design System

台灣政策圖譜前端視覺設計的權威參照。AI agent 修改 `src/blocks/`、`src/styles.css` 或 `config/app/layout.json` 時引用本文件，確保畫面遵循同一套視覺與互動規則。每一頁各個位置的量測見 [各頁的版面](docs/site/pages.md)，每個元件與圖表的規格見 [元件的規格](docs/site/components.md)。

<br>
<br>
<br>


---
# Visual Theme and Atmosphere

讀者要在看不到姓名與黨名的情況下作答，再逐一追溯分數的來源。設計語言是暖米色的紙面加上浮在內容上的玻璃外框，裝飾都服務於題目、原文與分數的判讀。

## Design Principles

### 紙面般的安靜底色

頁面是暖米色的紙面，淺色與深色的 tokens 同色相，切換主題時版面維持原樣。資料、表格、圖表與原文放在不透明的紙面上，玻璃只用在浮在內容上的外框。

### 一個強調色

`accent` 標出主要動作、選取與熱力圖，全站只有這一個強調色。作答量尺另以 `oppose` 與 `support` 區分兩端，判斷結果用 `good`、`warning` 與 `critical`。

### 固定的版型

每一頁屬於引導頁、流程頁、儀表板或文件頁其中一種，同一種版型共用頁首與底部的結構。流程頁專注在一個步驟：選擇、選區、議題重視度與作答頁收起導覽與頁尾，頁首換成步驟列。

### 每個數字都能追溯

每張圖回答一個寫在標題下方的問題，卡片的說明列出讀法、公式、代入值、資料來源與用到的設定值。

### 身分在翻牌後才出現

翻牌前的畫面只有遮蔽後的代稱與系列色，`mask-categories.tsv` 各類別的用語與政黨色在翻牌後才出現。作答頁一律遮蔽，在結果頁翻牌後回到作答頁也一樣，由 `layout.json` 的 `masked` 指定。

### 未知與零分開

未表態以虛線框與文字標示，和低分的格子分得開。每種狀態同時以顏色與文字、數值或圖示表達。

<br>
<br>
<br>


---
# Color Palette and Roles

## Brand Colors

`src/styles.css` 是色彩唯一可執行的來源，每個 token 有淺色與深色兩個同色相的值，程式只寫 token 的 Tailwind 類別。本文件列出品牌色、語意色與系列色的值，中性色與文字色只列角色。

### Terracotta (Primary)

| Token | 淺色 | 深色 | 角色 |
|---|---|---|---|
| `accent` | `oklch(51% 0.13 40)` | `oklch(72% 0.11 48)` | 強調色：主要按鈕、選取、熱力圖、議題圖示、焦點框 |
| `accent-soft` | `oklch(91.5% 0.035 50)` | `oklch(33% 0.045 45)` | 強調色的淺底：所在頁、已作答的題號、追問說明、議題圖示的圓底 |
| `on-accent` | `oklch(98.5% 0.01 80)` | `oklch(20% 0.02 60)` | 強調色上的文字 |

### Red (Danger)

| Token | 淺色 | 深色 | 角色 |
|---|---|---|---|
| `critical` | `oklch(52% 0.17 28)` | `oklch(70% 0.14 28)` | 判斷結果：錯誤 |

### Green (Success)

| Token | 淺色 | 深色 | 角色 |
|---|---|---|---|
| `good` | `oklch(52% 0.12 150)` | `oklch(72% 0.12 150)` | 判斷結果：良好 |

### Amber (Warning)

| Token | 淺色 | 深色 | 角色 |
|---|---|---|---|
| `warning` | `oklch(58% 0.13 75)` | `oklch(78% 0.12 80)` | 判斷結果：需要注意 |

### Purple (Oppose)

作答量尺的兩端各有一個顏色，都避開主要政黨的代表色：

| Token | 淺色 | 深色 | 角色 |
|---|---|---|---|
| `oppose` | `oklch(50% 0.11 300)` | `oklch(74% 0.1 300)` | 作答量尺不同意的一側 |
| `support` | `oklch(51% 0.13 40)` | `oklch(72% 0.11 48)` | 作答量尺同意的一側，與 `accent` 同色相 |

### Series

圖表以系列色區分使用者與候選人，系列色與政黨無關：

| Token | 淺色 | 深色 | 角色 |
|---|---|---|---|
| `series-0` | `oklch(30% 0.02 60)` | `oklch(92% 0.01 80)` | 使用者本人 |
| `series-1` | `oklch(52% 0.09 250)` | `oklch(72% 0.09 250)` | 候選人的類別色：藍 |
| `series-2` | `oklch(58% 0.11 165)` | `oklch(74% 0.10 165)` | 候選人的類別色：綠 |
| `series-3` | `oklch(60% 0.12 75)` | `oklch(78% 0.11 80)` | 候選人的類別色：黃 |
| `series-4` | `oklch(52% 0.12 320)` | `oklch(72% 0.10 320)` | 候選人的類別色：紫 |
| `series-5` | `oklch(55% 0.10 200)` | `oklch(74% 0.09 200)` | 候選人的類別色：青 |
| `series-6` | `oklch(50% 0.06 30)` | `oklch(70% 0.06 35)` | 候選人的類別色：褐 |

<br>

## Semantic Colors

| 語意 | 色系 | 用途 |
|---|---|---|
| primary | `accent` | 主要動作、選取、焦點框與熱力圖 |
| info | `accent`、`accent-soft` | 補充說明的提示區塊與追問說明 |
| success | `good` | 判斷結果良好的標籤與提示 |
| warning | `warning` | 資料不足、自訂資料與前提未滿足的標籤與提示 |
| danger | `critical` | 錯誤與載入失敗的提示 |
| oppose、support | `oppose`、`support` | 作答量尺的兩端 |
| series | `series-0` 到 `series-6` | 圖表的類別色，依遮蔽順序指定給候選人 |
| party | `config/tables/party-marks.tsv` | 翻牌後候選人的配色與政黨標記 |
| highlight | `highlight` | 原文中證據片段的螢光筆底色 |

<br>

## Neutral Colors

中性色是帶暖色相的紙面色階。`page` 是頁面底色，`surface` 是卡片與視窗，`sunken` 是統計格、表頭與輸入底，`border` 是框線，`baseline` 是刻度、沒有資料的圖形、量尺的中立圓圈與捲動條。`scrim` 是視窗背後的遮罩，兩種主題都是半透明的深色。頁面底下另有一層柔光（`glow`），只用陶土、琥珀與玫瑰的暖色相，避開主要政黨的代表色。

<br>

## Text Colors

| 用途 | 說明 |
|---|---|
| 主要文字 | `ink`，標題、項目名與主要數字 |
| 次要文字 | `ink-secondary`，內文、表格內容與圖表的數值 |
| 弱化文字 | `ink-muted`，只用在註記與註腳、卡片的提問與讀法說明 |
| 強調文字 | `accent`，所在的頁面、選中的項目與首頁標語 |
| 狀態文字 | `good`、`warning`、`critical`，判斷結果的標籤與提示 |

<br>
<br>
<br>


---
# Typography Rules

## Font Stack

字型是隨網站發布的 Chiron GoRound TC，建置時只抽出網站用到的字。字型載入前與缺字時依序取用 PingFang TC、Noto Sans TC、Microsoft JhengHei 與系統的無襯線字型。數字是等寬字形，數字欄位另加 `tabular-nums`。

<br>

## Root Font Size

根字級是 `{typography.rootFontSize}`，字級只用 Tailwind 的 `text-*` 級距。縮放模式以 `zoom` 調整整頁，縮小 0.875、預設 1、放大 1.25，根字級維持原值。

<br>

## Heading Scale

頁面只用 h1 與 h2 兩級標題，其餘的層次由字級的角色表達，每個角色的字級、字重與顏色見 [各頁的版面的字級的角色](docs/site/pages.md#字級的角色)。首頁的 h1 是看得見的主標，手機是 2.25rem，其餘頁的 h1 是視覺隱藏的頁名。h2 是卡片標題，流程頁的卡片標題放大到 1.25rem，作答頁的題幹放大到 1.5rem：

| 標籤 | 字級 | 字重 |
|---|---|---|
| h1 | `{typography.h1.fontSize}` | 700 |
| h2 | `{typography.h2.fontSize}` | 600 |

<br>
<br>
<br>


---
# Component Stylings

## Dark Mode

主題有跟隨系統、淺色與深色三種，由根節點的 `data-theme` 決定。選跟隨系統時，app 層依作業系統的外觀偏好寫入 `data-theme`。

每個 token 都有淺色與深色兩個值，元件只寫 token 的類別，兩種主題共用同一份樣式。翻牌後的政黨色同樣有淺色與深色兩欄。

### Standard Light/Dark Color Pairs

配對規則：兩種主題的色相相同、亮度反轉，透明度由材質決定。系統要求降低透明度（`prefers-reduced-transparency`）或提高對比（`prefers-contrast: more`），或瀏覽器不支援背景模糊時，玻璃換回 `surface` 底與 `border` 框線。

| 用途 | 亮色角色 | 暗色角色 |
|---|---|---|
| 頁面背景 | `page`，暖米色 | 同色相的深褐 |
| 卡片與視窗 | `surface`，比頁面亮 | 比頁面亮一階的深褐 |
| 統計格、表頭、輸入底 | `sunken`，比頁面暗 | 比頁面暗一階 |
| 標準邊框 | `border` | 同色相提高亮度 |
| 強調色 | `accent`，亮度 51% | 亮度 72% |
| 強調色的淺底 | `accent-soft`，亮度 91.5% | 亮度 33% |
| 資訊提示 | `accent-soft` 底與 `accent` 文字 | 同一組 token 的深色值 |
| 警告與錯誤提示 | `sunken` 底與 `warning` 或 `critical` 文字 | 同一組 token 的深色值 |
| 玻璃 | `surface` 加 50% 不透明，白色 70% 的框線 | `surface` 加 55% 不透明，白色 10% 的框線 |
| 視窗背後的遮罩 | 深色 30% 不透明 | 深色 55% 不透明 |
| 柔光 | 陶土、琥珀與玫瑰的淺色 | 同色相的深色 |

<br>

## Buttons

### Single Primary Action Principle

每張卡最多一個主要動作，讀者一眼看得出下一步。按鈕都是全圓角，同一列的按鈕用同一種尺寸。

| 原則 | 描述 |
|---|---|
| 一個主要動作 | 每張卡最多一個 `accent` 實心按鈕，其餘動作用 `neutral` 或 `quiet` |
| 視覺層級 | `accent` 是實心的主要動作，`neutral` 是 `border` 框線的次要動作，`quiet` 是透明框的輕量動作，三種高度一致，停用時 40% 不透明 |
| 確認關卡 | 放棄作答、更換題組或選區、重設本機資料之前先以視窗確認 |
| 觸控目標大小 | 內容區的按鈕高 `{spacing.touchTarget}`，頁首與勾選列的按鈕高 2rem，與分段按鈕同高 |

### Button Layout Options

按鈕依所在的位置採用固定的擺法，同一個動作在每一頁出現在同一個位置。

**Option A：卡片內的按鈕列**

卡片內容之後一列按鈕，平板起依序排列。手機排成兩欄等寬，按鈕數是奇數時第一個按鈕獨占一整列。

**Option B：頁首與勾選列**

頁首的離開與勾選列的翻牌使用高 2rem 的按鈕，手機只顯示圖示，名稱寫在 `aria-label` 與提示。頁首的主題與縮放是分段按鈕，每個選項是 28 px 的圖示鈕。

**Option C：流程頁底部**

步驟導覽貼齊視窗底部，左邊是「上一步：頁名」，右邊是 `accent` 的「下一步：頁名」。下一頁的條件未滿足時下一步停用，旁邊寫出缺什麼。

<br>

## Info Card

`sunken` 底或 `accent-soft` 底搭配 `{rounded.lg}` 圓角與 text-sm 的文字，用於頁面內補充說明的提示區塊，只呈現靜態內容。

<br>

## Warning Panel

`sunken` 底搭配 `warning` 文字與 `{rounded.lg}` 圓角，用於要讀者留意而還沒有出錯的狀態。頁面的前提未滿足時，整頁只放一張前提提示卡：警告提示加一個 `accent` 按鈕，沿用這一頁的版型。

<br>

## Danger Zone

錯誤以 `critical` 的文字表達，提示區塊是 `sunken` 底與 `{rounded.lg}` 圓角。程式與資料版本不一致或載入失敗時，擋板取代整頁並附上重新載入的按鈕。

<br>

## Candidate Bar

結果頁的勾選列列出每位候選人一個高 2rem 的膠囊：系列色塊、名稱與翻牌後的政黨標記，點一下切換是否納入比較，捲動時固定在頁首下方。只影響一張圖的候選人選擇放在那張卡片內、圖的正上方，是一排單選的膠囊。

<br>

## Claim Card

一則主張一張框：原文是 text-base，證據片段以 `highlight` 底色標出，下方是來源類型、對題目的立場與具體度的標籤列，再下方是判讀理由。分配、方法與審核、原文的位置收在收合列。

<br>

## Collapsible Panel

收合面板是整列可以點的標題列，右側的箭頭在展開時轉向。有外框的面板用在常見問題、題目面板與候選人立場，內容中的小型收合列用在判讀細節。

<br>

## Modal and Toast

視窗是不透明的 `raised` 材質與 `{rounded.3xl}` 圓角，平板起置中、最寬 768 px，手機由底部升起。Esc 與點背景關閉，換頁時自動關閉。提示訊息是浮起的玻璃，出現在底部置中，3.2 秒後消失。

<br>

## Charts

每張圖對應一個閱讀問題，寫在卡片標題下方。圖表共用同一套互動：滑過與鍵盤聚焦顯示說明，點擊開啟題目、議題或候選人的明細，卡片的「說明」開啟公式與代入值。結果頁有總分長條、全國對照、兩極光譜、意識形態雷達、議題 × 候選人熱力圖、分數歸屬桑基圖、議題分布 treemap 與 τ-b 直方圖。

<br>

## Icon System

### Priority

1. `src/blocks/icons.js` 的 `UI_ICONS`，16 px 的線條圖示，覆蓋按鈕、導覽與頁首的切換
2. `src/blocks/icons.js` 的 `ISSUE_ICONS`，每個第 1 層議題一個圖示，畫在 24 × 24 的格線上
3. `src/blocks/art.jsx` 的品牌標誌與首頁插圖

### Common Icons

每個角色固定對應一個圖形，以 `currentColor` 上色。圖示放在文字前面，往前的動作放在文字後面，只有圖示的按鈕把名稱寫在 `aria-label` 與提示。

| 圖示角色 | 用途 |
|---|---|
| 開始 | 開始作答 |
| 往前、往後 | 上一步與下一步、上一題與下一題 |
| 略過 | 略過這一題 |
| 離開 | 離開流程、放棄作答、回到自己的作答 |
| 關閉 | 關閉視窗 |
| 確認 | 確認視窗的確定 |
| 說明 | 卡片的說明 |
| 訊息 | 看看候選人怎麼說、原題與出處 |
| 翻牌、蓋牌 | 顯示或遮蔽候選人的身分 |
| 連結、圖片、複製 | 分享連結、分享圖片、複製 |
| 下載、上傳、檔案 | 匯出、匯入、下載範本 |
| 重設、刪除 | 恢復預設值、清除自訂資料 |
| 主題 | 跟隨系統、淺色、深色 |
| 縮放 | 縮小、預設、放大，以及桑基圖的重設檢視 |
| 分頁 | 底部分頁列的作答、結果、方法、資料、更多 |
| 箭頭 | 收合面板的展開與收合 |
| 議題 | 每個第 1 層議題的圖示，`accent-soft` 圓底與 `accent` 線條 |

<br>
<br>
<br>


---
# Layout Principles

## Page Container Classes

頁面版面使用固定的角色，每一頁在 `config/app/layout.json` 以 `template` 選用一種版型，卡片以 `span` 與 `frame` 選用寬度與外框。

| 角色 | 用途 |
|---|---|
| 引導頁 `landing` | 首頁：導覽頁首、1152 px 的內容與頁尾 |
| 流程頁 `flow` | 選擇、選區、議題重視度與作答：流程頁首、768 px 的內容與步驟導覽，選區頁以 `width: "wide"` 放寬到 1152 px |
| 儀表板 `dashboard` | 結果：導覽頁首、常駐的勾選列與 1152 px 的內容 |
| 文件頁 `document` | 方法與公式、資料集、常見問題與更新紀錄：導覽頁首、1152 px 的內容與頁尾 |
| 卡片 | `surface` 底、`border` 框線與 `{rounded.2xl}` 圓角，標題列左側是標題與回答的問題，右側是說明按鈕 |
| 流程頁卡片 | `{rounded.3xl}` 圓角與淡陰影，內距比一般卡片大 |
| 重點卡 | `frame: "glass"` 的浮起玻璃，用在首頁主視覺、結果摘要與測驗結果 |
| 常駐列 | 固定在頁首下方的玻璃列，用在結果頁的勾選列與手機的分區分頁籤 |
| 底部分頁列 | 手機浮在畫面底部的玻璃膠囊，取代導覽與頁尾 |
| 分享說明列 | 觀看模式時出現在頁首下方的 `accent-soft` 列 |

<br>

## Standard Page Structure

標準的頁面骨架依序是頁首、內容與底部。內容是一組卡片，卡片內是一串區塊，區塊由 `src/blocks/block.jsx` 依卡片的描述畫出。頁首與底部由版型決定：

| 版型 | 頁首 | 底部 |
|---|---|---|
| 引導頁 | 導覽頁首 | 頁尾，手機是底部分頁列 |
| 流程頁 | 流程頁首：品牌標誌、步驟列與離開鈕，作答頁多一列作答進度 | 步驟導覽，作答頁由題目卡內的上下題導覽 |
| 儀表板 | 導覽頁首加常駐的勾選列，手機另有分區分頁籤 | 頁尾，手機是底部分頁列 |
| 文件頁 | 導覽頁首 | 頁尾，手機是底部分頁列 |

<br>

## Responsive Grid

卡片放在 12 欄網格，寬度依 `layout.json` 的 `span`，窄於 1024 px 時一律整欄。同一列有卡片因為題組沒有用到而不組時，這一列留下的最後一張補滿整列。左右內距 16 px，卡片內距 20 px，卡片之間與卡片內的區塊之間 16 px，清單的項目之間 8 px。流程頁的卡片內距平板起 28 px，卡片之間 20 px。

<br>

## Corner Radius Scale

角落半徑沿用 Tailwind 的比例尺（`{rounded.xs}` 至 `{rounded.4xl}`，另有 `{rounded.full}` 圓形值）。`{rounded.xs}` 用於原文中以底色標出的關鍵詞。`{rounded.md}` 用於分段按鈕、分頁籤與頁首切換框內的選項，比外框小一級。`{rounded.lg}` 用於輸入框、提示區塊、提示泡泡、單選題的選項，以及卡片內的統計格、清單項目、熱力格、treemap 格與題號格。`{rounded.2xl}` 用於卡片與提示訊息。`{rounded.3xl}` 用於流程頁卡片、題目卡、首頁主視覺與視窗。`{rounded.full}` 用於按鈕、只有圖示的按鈕、頁首的頁面連結、標籤、膠囊、圖例色塊、長條與底部分頁列。手機上延伸到螢幕邊緣的卡片沒有圓角，手機的視窗只有上緣圓角。

<br>
<br>
<br>


---
# Depth and Elevation

內容層是不透明的紙面，浮在內容上的外框用玻璃，玻璃透出的是頁面底下的柔光與捲過的內容。資料密集的卡片、表格、圖表與原文一律不透明，重點卡只放在柔光上方、底下沒有捲動的內容。同一處只用一層模糊：手機的常駐列由外層畫玻璃，裡面的勾選卡是透明的。

## Elevation Levels

| 層級 | 表面 | 做法 |
|---|---|---|
| 0 - Page | `page` 底加柔光 | 柔光固定在視窗後面，捲動時留在原地 |
| 1 - Card | `surface` 底與 `border` 框線 | 一般卡片、表格、圖表與原文，流程頁卡片加淡陰影 |
| 2 - Bar | `glass`：`surface` 加半透明、背景模糊 20 px 並提高飽和度、上緣 1 px 高光 | 導覽頁首、流程頁首、步驟導覽與手機的常駐列 |
| 3 - Float | `glass-float`：`glass` 的材質加一層投影 | 底部分頁列、提示訊息、平板起的常駐列與重點卡 |
| 4 - Dialog | `raised`：不透明的 `surface` 底，框線、高光與投影同 `glass-float` | 視窗，背後是 `scrim` 加 4 px 模糊的遮罩 |

<br>
<br>
<br>


---
# Do's and Don'ts

以下模式在本專案前端程式碼中明確禁止。

| 禁止模式 | 正確替代 | 原因 |
|---|---|---|
| 在程式裡寫色碼 | token 的 Tailwind 類別 | 顏色與淺深色只在 `src/styles.css` 一處定義 |
| 用自訂 CSS 寫 Tailwind 組得出來的樣式 | Tailwind 的工具類別 | 樣式的來源維持一處 |
| 卡片內的光暈、彩色粗左框、裝飾用的漸層與 emoji | 以框線、底色與字級的角色區分層次 | 裝飾和資料搶讀者的注意 |
| 把資料密集的卡片、表格、圖表或原文放在玻璃上，或兩層玻璃疊在一起 | 內容用不透明的 `surface`，玻璃只用在浮在內容上的外框 | 透出的背景降低文字的對比 |
| 依號次指定系列色，或在翻牌前使用政黨色 | 依遮蔽順序指定系列色 | 顏色會洩漏候選人的身分 |
| 翻牌前出現 `mask-categories.tsv` 各類別的用語 | 遮蔽後的代稱 | 讀者要在看不到身分的情況下作答 |
| 在作答量尺以外使用 `oppose` 與 `support` | `accent` 與判斷結果的 `good`、`warning`、`critical` | 這兩個顏色只表示不同意與同意 |
| 一張卡放兩個 `accent` 按鈕 | 一個 `accent`，其餘用 `neutral` 或 `quiet` | 讀者分不出哪一個是下一步 |
| 同一列並排的按鈕混用不同尺寸 | 同一列用同一種尺寸 | 高度不同的按鈕排不齊 |
| 瀏覽器內建的收合三角形 | 收合面板元件 | 每個收合處的外觀與鍵盤操作相同 |
| 只以顏色表達狀態 | 另外寫出文字、數值或圖示 | 辨色有困難的讀者讀不到狀態 |
| 把未表態畫成 0 或中立 | 虛線框加上「此議題未提出政見」 | 未知與零是兩件事 |
| 元件內寫介面文案 | `config/app/locale.zh-TW.json` 的鍵 | 文案只在 locale 一處維護 |
| 修改根字級縮放畫面 | 縮放模式的 `zoom` | 字級的比例以 16 px 為基準 |

<br>
<br>
<br>


---
# Responsive Behavior

網站以手機、平板與寬螢幕三種寬度呈現同一份內容，手機是完整的操作環境。三種寬度共用同一套元件，只調整排列、導覽的位置與卡片的外框。

## Breakpoints

手機窄於 640 px，平板 640 px 起（`sm`），寬螢幕 1024 px 起（`lg`）。首頁主視覺另用 768 px（`md`）切換字級與兩欄。基礎樣式是手機的版面，往上逐級展開。

<br>

## Desktop vs Mobile Behavior

| 面向 | 桌面 | 行動 |
|---|---|---|
| 導覽 | 頁首的導覽列，平板移到品牌名下方的第二行 | 底部分頁列，頁首寫頁名 |
| 頁尾 | 網站版本、資料儲存、授權與資料版本 | 收進「更多」視窗 |
| 卡片 | 12 欄網格中有圓角與框線的卡片 | 延伸到螢幕左右邊緣，去掉圓角、左右框線與投影，卡片之間留 12 px 的頁面底色 |
| 流程頁 | 置中的流程頁卡片 | 整頁滿版，頁面底色就是卡面，卡片之間只有框線 |
| 結果頁 | 全部卡片依網格排列 | 依分區分頁籤一次顯示一區 |
| 勾選列 | 浮起的玻璃卡，膠囊自動換行 | 排成一列左右滑動，翻牌鈕只保留圖示 |
| 按鈕列 | 依序排列 | 兩欄等寬 |
| 視窗 | 置中，最寬 768 px | 由底部升起，最高 90% 視窗高度 |
| 表格與寬圖 | 完整顯示 | 在自己的框內捲動或拖曳，整頁沒有橫向捲動 |
| 主題與縮放 | 頁首的兩組分段按鈕 | 導覽頁首只留主題的切換，流程頁首兩組都收起，縮放用瀏覽器的手勢 |

<br>

## Responsive Patterns

多欄的清單在寬螢幕三欄、平板兩欄、手機一欄。並排的卡片在窄於 1024 px 時各占一整列。常駐列與底部分頁列以安全區域留白，頁面底部讓出分頁列的高度。

<br>

## Pointer and Touch Considerations

- 內容區的按鈕高 `{spacing.touchTarget}`，底部分頁列每格高 56 px，量尺的圓圈在手機至少 32 px
- 量尺、單選題的選項與分段按鈕是 radiogroup，方向鍵在選項之間移動，Enter 或空白鍵選取
- 作答頁的數字鍵依序選量尺或單選題的選項
- 鍵盤焦點畫 2 px 的 `accent` 外框，滑鼠點擊得到的焦點沒有外框
- 卡片的說明以按鈕、右鍵或觸控長按開啟
- 桑基圖以按住拖曳移動，觸控板捏合或 Ctrl 加滾輪縮放
- 系統要求減少動態時取消轉場

<br>
<br>
<br>


---
# Agent Prompt Guide

AI agent 產生前端程式碼時，使用此速查表、元件提示範例與新頁面檢查清單。

## Quick Color Reference

| 情境 | 語意角色 |
|---|---|
| 頁面背景 | `page` |
| 卡片與視窗 | `surface` |
| 統計格、表頭、輸入底 | `sunken` |
| 標準邊框 | `border` |
| 刻度與沒有資料的圖形 | `baseline` |
| 主要文字 | `ink` |
| 次要文字 | `ink-secondary` |
| 弱化文字 | `ink-muted` |
| 主要動作與選取 | `accent`，文字用 `on-accent` |
| 所在頁與選中項目的淺底 | `accent-soft` |
| 資料不足與注意 | `warning` |
| 錯誤 | `critical` |
| 量尺的不同意與同意 | `oppose`、`support` |
| 使用者與候選人 | `series-0`、`series-1` 到 `series-6` |
| 原文的證據片段 | `highlight` |

<br>

## Component Prompt Examples

向 AI 要求畫面或元件時，描述資料來源、版型、卡片的寬度與外框、互動與遮蔽。佔位符號替換為實際值。

### Standard Result Card

在結果頁新增一張卡，標題是「{標題}」，標題下方寫它回答的問題「{問題}」。卡片在 `layout.json` 寫 `span` 與 `section`，內容由 `src/cards/` 的描述組成，資料經由 `src/metrics/` 取得。圖表使用既有的區塊，系列色依遮蔽順序，說明列出讀法、公式與代入值。含逐題作答時加上 `private`。

### Standard Flow Step

流程頁的一步，卡片標題是「{步驟名稱}」，內容是 {欄位清單}。版型用 `flow`，頁首是步驟列，底部的步驟導覽左邊是上一步、右邊是 `accent` 的下一步。下一步的條件寫在 `layout.json` 的 `needs`，未滿足時下一步停用並寫出缺什麼。

### Confirmation Dialog

用於確認 {收不回來的動作}。視窗的標題寫動作，內文寫出會失去什麼，按鈕列是 `accent` 的確定與 `neutral` 的取消。文案寫在 locale 的 `confirm`。

<br>

## New Page Checklist

交付任何新頁面或元件前逐項確認：

- [ ] 這一頁屬於四種版型之一，`layout.json` 寫了 `template`
- [ ] 顏色都用 token 的類別，淺色與深色各看過一次
- [ ] 每個文字元素對得到一個字級的角色
- [ ] 每張卡最多一個 `accent` 主要動作
- [ ] 圖示取自 `UI_ICONS`，同一個角色用同一個圖形
- [ ] 介面文案都寫在 locale
- [ ] 手機、平板與寬螢幕各看過一次，手機沒有橫向捲動
- [ ] 縮小、預設與放大各看過一次
- [ ] 可以點的元素都能以鍵盤聚焦與操作，焦點框看得見
- [ ] 翻牌前的畫面只有遮蔽後的代稱與系列色
- [ ] 狀態除了顏色還有文字、數值或圖示
- [ ] 玻璃只用在浮在內容上的外框，同一處只有一層模糊
- [ ] 這一頁各個位置的量測已寫進 [各頁的版面](docs/site/pages.md)，新元件的規格已寫進 [元件的規格](docs/site/components.md)
