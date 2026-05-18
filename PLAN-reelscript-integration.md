# ReelMaker × ReelScript 整合計畫

## 目標

把 ReelScript 的 AI 能力接進 ReelMaker，新增兩大功能：

### 功能一：字幕產生器

錄完影片後，一鍵產字幕 → 渲染到影片上 → 下載帶字幕的成品。

**流程**：
```
錄影完成 (WebM)
  → 上傳到 ReelScript 轉錄 (Whisper)
  → 拿回逐字時間軸 [{start, end, text}]
  → 前端字幕編輯器（修正錯字、調時間）
  → 用 Canvas 疊字幕 → 輸出帶字幕 WebM
```

### 功能二：對標影片轉化

貼一個外國影片 URL → ReelScript 幫你：下載 → 轉錄 → 翻譯 → 提取重點 → 自動生成 ReelMaker 的中文逐字稿 + 樹狀圖主題。等於一鍵把對標影片變成你的錄影素材。

**流程**：
```
貼 YouTube URL
  → 呼叫 ReelScript process_video
  → 等待 ready（WebSocket 或 polling）
  → 拉回：中文翻譯逐字稿 + appreciation（主題/重點/金句）
  → 自動建立 ReelMaker Topic：
      - markdown = 樹狀圖（主題 → 重點 → 細節）
      - prompter = 中文逐字稿（口播用）
      - storyboards = 金句卡片（自動產圖）
```

---

## 技術設計

### 功能一：字幕產生器

#### 1.1 後端新增 API

```
POST /api/transcribe
  Body: multipart/form-data { file: <webm> }
  → 呼叫 ReelScript API（或直接用 Whisper）
  → 回傳 { segments: [{ start, end, text }] }

POST /api/subtitle/render
  Body: { videoBlob, segments, style }
  → 伺服器端用 FFmpeg 燒字幕（備用方案，前端做不到時）
```

**主要路徑（前端渲染，零伺服器負擔）**：
- 錄影時已有 MediaRecorder 產出 WebM
- 字幕疊加用 Canvas overlay，重新錄製一次（秒級）
- 不需要 FFmpeg — 純瀏覽器完成

**備用路徑（伺服器渲染）**：
- 上傳 WebM + SRT → FFmpeg 燒字幕 → 下載
- 適用於需要精確排版的場景

#### 1.2 前端：字幕編輯器 UI

錄影結束後，新增「加字幕」步驟：

```
┌─────────────────────────────────────┐
│  影片預覽（帶字幕即時預覽）          │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │     [影片播放區]             │    │
│  │                             │    │
│  │  ──── 字幕顯示在這裡 ────    │    │
│  └─────────────────────────────┘    │
│                                     │
│  [時間軸] ═══════●═══════════════   │
│                                     │
│  字幕列表：                         │
│  00:02 - 00:05  大家好今天...  [編輯]│
│  00:05 - 00:08  我們來聊聊...  [編輯]│
│  00:08 - 00:12  第一個重點...  [編輯]│
│                                     │
│  字幕樣式：                         │
│  字體大小: [36px ▼]  顏色: [白 ▼]   │
│  背景: [半透明黑 ▼]  位置: [底部 ▼] │
│                                     │
│  [取消]              [輸出帶字幕影片] │
└─────────────────────────────────────┘
```

**功能清單**：
- 播放影片 + 即時顯示字幕
- 點擊字幕跳到對應時間
- 行內編輯字幕文字
- 拖拽調整時間軸
- 字幕樣式（大小、顏色、底色、位置）
- 「輸出」= Canvas 重播 + 字幕疊加 → 新 WebM

#### 1.3 轉錄整合方式

**方案 A（推薦）：透過 Gateway 呼叫 ReelScript**
```js
const gw = require('../../sdk/gateway')
// 先上傳音訊到 ReelScript
const result = await gw.call('reelscript_process_video', { url: localFileUrl })
// 或直接用 ReelScript 的 Whisper 端點
```

**方案 B：ReelMaker 自己跑 Whisper**
- 需要 Python + faster-whisper
- 增加部署複雜度
- 不推薦，除非需要離線使用

**選定方案 A** — ReelMaker 把錄好的 WebM 送給 ReelScript 處理。

**問題**：ReelScript 的 `process_video` 需要 URL（不是檔案上傳）。
**解法**：
1. ReelMaker 先把 WebM 存到 `data/recordings/` 目錄
2. 透過 CloudPipe router 暴露為 URL：`http://localhost:4027/data/recordings/xxx.webm`
3. 傳這個 URL 給 ReelScript

---

### 功能二：對標影片轉化

#### 2.1 後端新增 API

```
POST /api/benchmark
  Body: { url: "https://youtube.com/watch?v=xxx" }
  → 呼叫 ReelScript process_video（async）
  → 回傳 { jobId, status: "processing" }

GET /api/benchmark/:jobId
  → Polling 狀態
  → 完成時回傳完整資料

POST /api/benchmark/:jobId/generate
  → 從 ReelScript 資料自動建立 Topic + Prompter
  → 回傳 { topicId, prompterText }
```

#### 2.2 資料轉換邏輯

ReelScript 回傳：
```js
{
  title: "How to Build Trust in Relationships",
  segments: [
    { start: 0.5, end: 5.2, text: "Hello everyone...", translation: "大家好..." },
    ...
  ],
  appreciation: {
    theme: "如何透過信任建立深層親密關係",
    keyPoints: ["重點1", "重點2", "重點3"],
    goldenQuotes: [
      { en: "Once you break their trust...", zh: "一旦破壞了信任..." },
      ...
    ]
  }
}
```

轉換成 ReelMaker Topic：

**Markdown（樹狀圖素材）**：
```markdown
# 如何透過信任建立深層親密關係

## 重點一
- 真正的親密不是技巧的展現
- 而是兩個靈魂的坦誠相見

## 重點二
- 當一方失去信任
- 修復需要長期的耐心和真摯的承諾

## 重點三
- 親密關係的深度來自於
- 彼此的脆弱性和接納

## 金句
- 一旦破壞了信任，就到此為止了
- 他們原諒不是因為軟弱，而是選擇看見你身上的善良
```

**Prompter（逐字稿口播）**：
```
【開頭 — Hook】
今天我看了一個很厲害的影片，講的是信任跟親密關係
我把裡面的精華整理出來，分享給你們

【重點一 — 坦誠相見】
大家好...（中文翻譯逐字稿，自然語序重排）
...

【重點二 — 修復信任】
...

【金句分享】
這個影片裡有幾句話我覺得超讚：
「一旦破壞了信任，就到此為止了」
...

【收尾 — CTA】
如果你也覺得這個內容有幫助
記得按讚分享，我們下次見！
```

#### 2.3 前端：對標影片 UI

在 admin.html 新增一個 tab 或獨立頁面：

```
┌──────────────────────────────────────────┐
│  🎯 對標影片                              │
│                                          │
│  YouTube URL: [________________________] │
│  [開始分析]                               │
│                                          │
│  ┌── 分析進度 ──────────────────────┐    │
│  │ ✅ 下載完成                       │    │
│  │ ✅ 轉錄完成                       │    │
│  │ ✅ 翻譯完成                       │    │
│  │ ⏳ 提取重點中...                   │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌── 結果預覽 ──────────────────────┐    │
│  │ 主題：如何透過信任建立深層親密關係  │    │
│  │                                   │    │
│  │ 重點：                            │    │
│  │ 1. 真正的親密不是技巧...           │    │
│  │ 2. 當一方失去信任...               │    │
│  │ 3. 親密關係的深度...               │    │
│  │                                   │    │
│  │ 金句：                            │    │
│  │ ⭐ "一旦破壞了信任，就到此為止了"   │    │
│  │ ⭐ "原諒不是因為軟弱..."           │    │
│  │                                   │    │
│  │ 逐字稿預覽（可編輯）：             │    │
│  │ ┌──────────────────────────────┐  │    │
│  │ │ 00:05 大家好，今天我們來聊... │  │    │
│  │ │ 00:08 我覺得信任這件事...     │  │    │
│  │ └──────────────────────────────┘  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  [匯入為新主題]  [匯入為逐字稿]  [兩者都要] │
└──────────────────────────────────────────┘
```

---

## 實作順序

### Phase 1：後端整合層（Gateway 串接）

| # | 工作 | 檔案 |
|---|------|------|
| 1 | 新增錄影檔存放 + serve 路徑 | `server.js` |
| 2 | POST /api/transcribe（送 ReelScript 轉錄） | `server.js` |
| 3 | POST /api/benchmark（對標影片分析） | `server.js` |
| 4 | GET /api/benchmark/:id（polling 狀態） | `server.js` |
| 5 | POST /api/benchmark/:id/generate（生成 Topic） | `server.js` |

### Phase 2：字幕產生器前端

| # | 工作 | 檔案 |
|---|------|------|
| 6 | 錄影結束 → 「加字幕」按鈕 + 流程 | `public/index.html` |
| 7 | 字幕編輯器 UI（列表 + 時間軸 + 即時預覽） | `public/index.html` |
| 8 | Canvas 字幕疊加 + 重錄輸出 | `public/index.html` |

### Phase 3：對標影片前端

| # | 工作 | 檔案 |
|---|------|------|
| 9 | admin.html 新增「對標影片」tab | `public/admin.html` |
| 10 | URL 輸入 + 分析進度 + 結果預覽 | `public/admin.html` |
| 11 | ReelScript → Topic markdown 轉換器 | `public/admin.html` |
| 12 | 「匯入為主題 / 逐字稿」一鍵生成 | `public/admin.html` |

### Phase 4：打磨

| # | 工作 |
|---|------|
| 13 | 字幕樣式選項（字體、顏色、位置、動畫） |
| 14 | 對標影片歷史記錄 |
| 15 | 金句自動生成圖片（作為 storyboard） |

---

## 依賴關係

```
ReelScript (port 4005)
  ├── Whisper 轉錄
  ├── LLM 翻譯
  └── Appreciation（主題/重點/金句）

ReelMaker (port 4027)
  ├── 透過 CloudPipe Gateway SDK 呼叫 ReelScript
  │   const gw = require('../../sdk/gateway')
  │   await gw.call('reelscript_process_video', { url })
  │   await gw.call('reelscript_get_video', { video_id })
  │   await gw.call('reelscript_translate_video', { video_id })
  │   await gw.call('reelscript_appreciate_video', { video_id })
  │
  └── 字幕渲染完全在前端（Canvas + MediaRecorder）
```

**不需要新的外部依賴** — 所有 AI 能力都走 ReelScript，字幕渲染走瀏覽器 Canvas。

---

## 預期成果

| 功能 | 使用者操作 | 結果 |
|------|-----------|------|
| 字幕 | 錄完影片 → 點「加字幕」→ 輸出 | 帶字幕的 WebM |
| 對標 | 貼 YouTube URL → 等分析 → 匯入 | 中文主題 + 樹狀圖 + 逐字稿 |
| 合體 | 對標 → 匯入 → 錄影 → 加字幕 → 輸出 | 完整的對標翻拍流程 |
