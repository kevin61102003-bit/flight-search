# Flight Search — 專案指南

Google Flights 價格追蹤器。用 Puppeteer 爬取指定月份的來回機票價格，在本地 web UI 顯示與匯出。

## 啟動

```
start-server.bat   # 啟動 server(port 3000) + ngrok + 開瀏覽器
node test-cache.js # 執行測試
```

## 核心檔案

| 檔案 | 職責 |
|---|---|
| `cache.js` | 檔案型 JSON 快取，資料存在 `cache/YYYY-MM/` 子目錄 |
| `scraper.js` | Puppeteer 爬蟲，爬單筆或整月的 Google Flights |
| `server.js` | Express API server，提供資料給前端 |
| `public/index.html` | 設定面板 HTML |
| `public/style.css` | 樣式（含 chip、雙軌滑桿） |
| `public/app.js` | 前端邏輯，連接 UI 與 API |
| `test-cache.js` | cache.js 的 assert-based 測試 |

## 資料流

```
UI (app.js)
  → POST /api/search (server.js)
    → scrapeAll(dates, stays, opts) (scraper.js)
      → scrapeSingle(date, returnDate, browser, opts)
        → cache.set(key, data, year, month) (cache.js)
              ↓
           cache/YYYY-MM/*.json

UI loadData()
  → GET /api/results?year=&month= (server.js)
    → cache.getAll(year, month) → { flights, lastUpdated }
```

## Cache API

```js
cache.get(key, year, month)              // 讀單筆，不存在回 null
cache.set(key, data, year, month)        // 寫單筆
cache.getAll(year, month)                // 回傳 { [date]: [flight...] }
cache.getLastUpdated(year, month)        // 回傳 ISO string 或 null
cache.clearMonth(year, month)            // 刪整個月的子目錄
cache.clear()                            // 刪全部，回傳刪除筆數
```

測試隔離：`process.env.CACHE_DIR_OVERRIDE` 可指定測試用目錄。

## Scraper API

```js
scrapeAll(dates, stays, opts)
// stays: number[]，例如 [5, 6, 7]
// opts: { origin, destination, originQuery, destinationQuery,
//         outboundTimeRange: { start, end },
//         returnTimeRange:   { start, end },
//         year, month }

generateDates(year, month)  // 回傳該月每天的 'YYYY-MM-DD' 陣列
```

時間範圍格式：`"HH:MM"`，例如 `"06:00"` / `"23:00"`。`"00:00"–"24:00"` 表示不篩選（含紅眼）。

## Server API

| Endpoint | 用途 |
|---|---|
| `GET /api/results?year=&month=` | 取快取資料 |
| `GET /api/stats?year=&month=` | 取統計摘要（含 lastUpdated） |
| `POST /api/search` | 觸發爬蟲（背景執行） |
| `POST /api/clear-cache` | 帶 `{year,month}` 清單月；不帶清全部 |
| `GET /api/clear-cache` | 清全部 |

POST /api/search body：
```json
{
  "year": 2026, "month": 9,
  "stays": [5, 6, 7],
  "originQuery": "臺北", "destinationQuery": "釜山",
  "outboundTimeRange": { "start": "06:00", "end": "23:00" },
  "returnTimeRange":   { "start": "06:00", "end": "23:00" }
}
```

CLI 爬蟲：`node server.js --scrape-all --year=2026 --month=9 --stays=5,6,7`

## 前端關鍵 ID

| 元素 ID | 用途 |
|---|---|
| `inputYear` / `inputMonth` | 年份輸入 / 月份下拉 |
| `stayChips` | 停留天數 chip 容器（由 app.js 動態產生） |
| `queryCount` | 顯示查詢筆數 |
| `outboundMin/Max/Fill/TimeLabel` | 去程雙軌滑桿 |
| `returnMin/Max/Fill/TimeLabel` | 回程雙軌滑桿 |
| `lastUpdated` | 顯示最後爬取時間 |

## 新增功能時的改動模式

**新增篩選條件（例如新增艙等選擇）：**
1. `scraper.js` — `scrapeSingle` opts 加新參數，傳給 Puppeteer 邏輯
2. `server.js` — `/api/search` handler 讀新欄位，傳給 `scrapeAll`
3. `index.html` — 在 `.search-settings` 加新的 settings-row
4. `style.css` — 視需要補樣式
5. `app.js` — `getSearchParams()` 加新欄位，`saveSettings()` 會自動包含，`DOMContentLoaded` 補初始化與還原邏輯

**新增顯示欄位（例如顯示航班時刻）：**
1. `scraper.js` — `result` 物件加欄位
2. `cache.js` — 不需改（存什麼就還什麼）
3. `server.js` — 通常不需改
4. `app.js` — `renderTable()` 或 `updateChart()` 加欄位

## 前端設定持久化

`app.js` 用 `localStorage` 記住使用者的設定，key 為 `flightSearchSettings`：

```js
// 存的內容
{ year, month, stays: [3,8,10], customStays: [21], outboundTimeRange, returnTimeRange }

// 相關函式
saveSettings()   // 任何設定改變時呼叫（chip 切換、滑桿移動、年月變更）
loadSettings()   // DOMContentLoaded 時呼叫，回傳物件或 null
```

新增可持久化的設定欄位時：在 `saveSettings()` 加欄位，在 `DOMContentLoaded` 的還原區塊加對應讀回邏輯。

## 注意事項

- Node.js 路徑：`E:\dev\node\node.exe`（系統 PATH 可能沒有 node）
- 快取舊資料（`cache/` 根目錄的 .json）不會被讀取，已改為子目錄結構
- `CONCURRENCY` 常數在 scraper.js 控制並行爬取數
- debug 截圖存在 `debug/` 目錄
