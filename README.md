# ✈️ 台北 → 釜山 機票價格追蹤器

使用 Puppeteer 爬取 Google Flights 資料，查詢 2026 年 9 月台北 (TPE) 到釜山 (PUS) 的來回機票價格。

## 功能特色

- 📊 圖表顯示每日價格走勢（區分 5/6/7 天停留）
- 📋 詳細價格表格，自動標記最低價
- 💰 摘要卡片：最低價、平均價、價格範圍
- 📥 匯出 CSV 檔案
- 🗃️ 自動快取，避免重複爬取

## 系統需求

- [Node.js](https://nodejs.org/) v18 以上
- 網路連線（爬取 Google Flights）

## 安裝步驟

```bash
# 1. 下載專案
cd flight-search

# 2. 安裝依賴（會自動下載 Chromium）
npm install
```

> ⚠️ `npm install` 會自動下載 Chromium (~150MB)，這是 Puppeteer 運行所需。

## 使用方式

### 方式一：啟動網頁伺服器（推薦）

```bash
npm start
```

1. 開啟瀏覽器前往 `http://localhost:3000`
2. 點擊「🔍 開始查詢全部」
3. 等待查詢完成（90 次查詢，約 5~10 分鐘）
4. 查看圖表與表格

### 方式二：命令列批次爬取

```bash
npm run scrape-all
```

爬取完成後，啟動伺服器即可查看結果：

```bash
npm start
```

## 查詢範圍

| 項目 | 內容 |
|------|------|
| 路線 | 台北 (TPE) → 釜山 (PUS) |
| 月份 | 2026 年 9 月（1 日 ~ 30 日） |
| 類型 | 來回機票 |
| 停留天數 | 5 天 / 6 天 / 7 天 |
| 幣別 | NTD（新台幣） |
| 總查詢數 | 30 天 × 3 種停留 = 90 次 |

## API 端點

| 端點 | 說明 |
|------|------|
| `GET /api/results` | 取得所有快取的機票價格 |
| `GET /api/stats` | 取得統計摘要（最低價、總數等） |
| `POST /api/search` | 開始批次查詢（背景執行） |
| `GET /api/clear-cache` | 清除快取 |

## 專案結構

```
flight-search/
├── server.js          # Express 伺服器 + API
├── scraper.js         # Puppeteer 爬蟲
├── cache.js           # 檔案快取系統
├── package.json
├── cache/             # 快取資料（自動建立）
├── debug/             # 除錯截圖（自動建立）
└── public/
    ├── index.html     # 前端頁面
    ├── style.css      # 樣式
    └── app.js         # 前端邏輯
```

## 注意事項

- ⏱️ 90 次查詢約需 **5~10 分鐘**（每次查詢間隔 2~4 秒避免被擋）
- 🗃️ 已查過的資料會快取在 `cache/` 資料夾，下次直接讀取
- 🐞 如果價格擷取失敗，會在 `debug/` 資料夾產生截圖供除錯
- 🌐 需要穩定的網路連線
