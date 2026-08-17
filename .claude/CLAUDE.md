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
| `public/app.js` | 前端邏輯，連接 UI 與 API；含靜態模式（加密解密、密碼閘門）、機場自動完成 |
| `public/airports.js` | 機場/城市清單 `window.AIRPORTS`（iata/city/country/alt），供出發地・目的地自動完成 |
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

## 目前狀態（2026-08-14）

- ✅ 航線分開保存：`cache/routes/<base64url(出發→目的)>/YYYY-MM/`，首爾/釜山不再互蓋（舊資料已用 `migrate-cache.js` 遷移）。
- ✅ UI：「已存航線」下拉切換；按鈕拆成「🔍開始查詢(增量)」「🗑️清除快取(只清當前航線+月,含確認視窗)」「📤發布到網站」；全部加了 hover 說明(tooltip)。
- ✅ 新增 ngrok 動態外網路（`start-online.bat` + `server.js` 外網密碼閘 + `.ngrok-domain` 固定網域）。密碼閘已測試通過（本機放行 / 外網無密碼或錯密碼擋 401 / 對密碼放行 / 危險端點也擋）。桌面捷徑「機票查詢-外網.lnk」已建。固定網域 `elixir-stuck-hamburger.ngrok-free.dev` 已填入 `.ngrok-domain`，端對端通道測試通過。
- ✅ 查詢即時更新：`pollResults` 輪詢迴圈每 5 秒也呼叫 `loadData()`，票價一筆筆進表格＋圖表，不用重刷網頁（僅動態 server 有效，靜態站不現場爬）。
- ✅ 記住當前航線：`saveSettings()` 存 `originQuery/destinationQuery`，`DOMContentLoaded` 還原到輸入框，`populateRoutes` 下拉預選當前航線 → 重刷後停在同一頁，不用再去「已存航線」重選。
- ✅ 出發地／目的地機場自動完成：輸入中文/英文/IATA 皆可比對（`臺`↔`台` 已正規化），下拉顯示 IATA+城市+國家，點選填入中文城市名（不動航線快取 key）。清單在 `public/airports.js`，要加機場就編這個檔。
- ✅ 修好「多機場地區」目的地選不到的 bug（如峇里島）：舊 code 要求 `[role="option"]` 文字 `.includes(查詢字)` 才點，但 Google 對峇里島給的是「印尼峇里省／伍拉·賴國際機場(DPS)」皆不含「峇里島」→ 全錯誤 0 筆。改法在 `scraper.js` 目的地選取：改用 aria-label 比對、排除「任何地方/Anywhere」、優先選城市列，並先等「距離目的地」標記出現確定建議已載入。另加 Google「系統發生錯誤」頁的 reload 重試(最多3次)。已用臺北→峇里島兩個日期實測成功（10/05→10/11 NT$10955、10/12→10/18 NT$16137）。此修正同時解掉先前暫緩的「兩筆爬蟲失敗」。
  - ⚠️ 出發地選取(scraper.js 出發那段)仍是取第一個 option，臺北 OK；未來若出發地也用多機場地區(如東京/大阪多機場)可能要套同樣邏輯。

## 部署方式（兩條並行的路）

**A. 靜態站（GitHub Pages，唯讀、永遠在）**
- 每日流程：雙擊桌面「機票查詢」(=`start-server.bat`) → localhost:3000 爬 → 按「📤 發布到網站」→ 關機。
- 網站與本機脫鉤，電腦關了網站仍在。
- 靜態站密碼放 `.viewer-password`（已 gitignore，切勿上傳）。

**B. ngrok 動態外網（本機掛著時，外網能用完整查詢介面：能爬、能篩）**
- 啟動：`start-online.bat` → 開 server(3000) + ngrok，並開 `localhost:4040`(ngrok 控制台) 與 `localhost:3000`。
- **固定網域**：把網域字串寫進 `E:\dev\flight-search\.ngrok-domain` 第一行（例：`my-flight.ngrok-free.app`），`start-online.bat` 會 `ngrok http 3000 --url=<domain>`。此檔已 gitignore。免費版的固定網域要先到 https://dashboard.ngrok.com/domains 領一個（免費送 1 個）。沒設此檔就退回隨機網址。
- **外網密碼閘**（`server.js` 中介層）：本機(Host=localhost)免密碼；從 ngrok 進來的 Host 需 HTTP Basic Auth，密碼沿用 `.viewer-password`（帳號欄可空/任填，只比對密碼）。此閘擋住所有路由，含危險端點 `/api/clear-cache`、`/api/publish`。
- ⚠️ 動態 server 的 API 本身無防護，**只靠這道 Host-based 密碼閘保護外網**。不要另外把 3000 埠直接對外開放（那樣繞過閘門）。ngrok 通道是唯一對外入口才安全。
- 兩條路互不影響：ngrok 掛著時仍可照常按「📤 發布到網站」更新靜態站。

## 改 Code 守則

- 改 code 只留本機、回報使用者。
- **要上線由使用者按發布按鈕觸發，我不主動 push**（此流程使用者已確認 OK）。
- 發布按鈕跑 `build-static.js`→`git add -A`→commit→push（憑證已快取，免登入）。
- 功能完成後更新 CLAUDE.md（見下方相關記憶的指引）。
