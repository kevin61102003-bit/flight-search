# Flight Search — 專案指南

Google Flights 價格追蹤器。用 Puppeteer 爬取指定月份的來回機票價格，在本地 web UI 顯示與匯出。

## 啟動

```
start-server.bat   # 啟動 server(port 3000) + 開瀏覽器（桌面「機票查詢」捷徑指向此）
node test-cache.js # 執行測試
```

## 核心檔案

| 檔案 | 職責 |
|---|---|
| `cache.js` | 檔案型 JSON 快取，**依航線分開**存在 `cache/routes/<slug>/YYYY-MM/` |
| `migrate-cache.js` | 一次性：把舊的扁平/月份快取遷移到 `cache/routes/<slug>/`（依 `data.route` 還原航線） |
| `scraper.js` | Puppeteer 爬蟲，爬單筆或整月的 Google Flights |
| `server.js` | Express API server，提供資料給前端 |
| `public/index.html` | 設定面板 HTML |
| `public/style.css` | 樣式（含 chip、雙軌滑桿） |
| `public/app.js` | 前端邏輯，連接 UI 與 API；含靜態模式（加密解密、密碼閘門） |
| `public/config.js` | 設定 `window.APP_MODE`（本機=`dynamic`；build 產出=`static`） |
| `build-static.js` | 讀 `cache/` → AES 加密 → 產生 `docs/` 給 GitHub Pages |
| `test-cache.js` | cache.js 的 assert-based 測試 |

## 資料流

```
UI (app.js)
  → POST /api/search (server.js)
    → scrapeAll(dates, stays, opts) (scraper.js)
      → scrapeSingle(date, returnDate, browser, opts)
        → slug = cache.routeSlug(origin, destination)   // base64url("出發→目的")
        → cache.set(key, data, slug, year, month) (cache.js)
              ↓
           cache/routes/<slug>/YYYY-MM/*.json   ← 每條航線各自一個資料夾，不再互相覆蓋

UI loadData()
  → GET /api/results?year=&month=&origin=&dest= (server.js)
    → cache.getAll(slug, year, month) → { flights, lastUpdated }

航線切換：GET /api/routes → 前端「已存航線」下拉；靜態站則讀 docs/data/manifest.json 的 routes
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
| `GET /api/results?year=&month=&origin=&dest=` | 取某航線某月快取資料 |
| `GET /api/stats?year=&month=&origin=&dest=` | 取某航線某月統計摘要（含 lastUpdated） |
| `GET /api/routes` | 列出所有有資料的航線與其月份（前端「已存航線」下拉用） |
| `POST /api/search` | 觸發爬蟲（背景執行） |
| `POST /api/clear-cache` | 帶 `{year,month,origin,dest}` 清單一航線的單月；不帶清全部 |
| `GET /api/clear-cache` | 清全部 |
| `POST /api/publish` | 加密 `docs/` → git commit → git push（前端「📤 發布到網站」按鈕）；靠已快取的 git 憑證免登入 |

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

## 部署（GitHub Pages 加密靜態版）

目標：本機關機時，唯讀展示網站仍活著。作法是**兩個角色分離**：

- **本機**：跑爬蟲（puppeteer）產生 `cache/`。只在要更新價格時開。
- **GitHub Pages**：24h 常開的唯讀網站，讀 `docs/data/*.json`（AES 加密）。

```
cache/ ──build-static.js(加密)──► docs/ ──git push──► GitHub Pages
```

- `npm run build:static` 產生 `docs/`（每次會先清空 docs/，避免殘留檔外流）。
- 加密：**AES-256-GCM + PBKDF2(15 萬次)**，Node 與瀏覽器兩端都用內建 `crypto.subtle`，**免安裝套件**。`build-static.js` 的 `encryptObj()` 與 `app.js` 的 `decryptPayload()` 參數必須一致。
- 密碼來源：`FLIGHT_PW` 環境變數 或 `.viewer-password` 檔（已 gitignore）。
- 靜態模式偵測：`config.js` 的 `window.APP_MODE`。`IS_STATIC` 時 `app.js` 改讀 `data/<slug>/<year>-<month>.json` 並跳密碼框（記在 localStorage key `flightViewerPw`），同時移除爬取/清除等只能在本機用的控制項；航線與月份改由 `manifest.json` 的 routes 驅動「已存航線」下拉。
- 加密檔名用**未補零的月份**（`2026-9.json`）以對上 `getSearchParams()` 的 `month`；上層資料夾是 `routeSlug`（base64url）。
- ⚠️ `cache/` 含未加密價格，已 gitignore，**切勿上傳**（公開 repo 會破功）。
- 完整步驟見 `DEPLOY.md`；Windows 一鍵發布用 `publish.bat`。

## 注意事項

- Node.js 路徑：`E:\dev\node\node.exe`（系統 PATH 可能沒有 node）
- 快取依航線分開：`cache/routes/<slug>/YYYY-MM/`。`slug = base64url("出發→目的")`，避免不同中文目的地被 `sanitize()` 壓成同一串底線而互相覆蓋
- 舊格式（`cache/` 根目錄或 `cache/YYYY-MM/` 的扁平檔）已用 `migrate-cache.js` 遷移；舊檔保留為備份、不會被讀取，確認無誤後可手動刪除
- `CONCURRENCY` 常數在 scraper.js 控制並行爬取數
- debug 截圖存在 `debug/` 目錄
