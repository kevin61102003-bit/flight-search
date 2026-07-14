# Flight Search Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add year/month selection, configurable departure time filters (outbound + return dual-range sliders), and multi-select stay duration chips to the flight price tracker.

**Architecture:** Cache restructured to per-month subdirectories (`cache/YYYY-MM/`). Scraper receives time range params instead of module-level constants. UI settings panel gains year/month pickers, dual-range sliders, and stay chips that replace the old min/max inputs.

**Tech Stack:** Node.js 18+, Express 4, Puppeteer 22, Vanilla JS/CSS (no new dependencies)

---

## File Map

| File | Change |
|---|---|
| `cache.js` | Full rewrite — per-month subdirs, `getLastUpdated`, `clearMonth` |
| `scraper.js` | Remove hardcoded time constants; `scrapeSingle` accepts `outboundTimeRange`/`returnTimeRange`; `scrapeAll` accepts `stays` array |
| `server.js` | All endpoints accept `year`/`month`; `stays` array replaces `minStay`/`maxStay`; `--scrape-all` parses CLI args |
| `public/index.html` | Replace min/max stay inputs with chip row; add year/month pickers; add dual-range slider rows; add last-updated |
| `public/style.css` | Append chip, dual-range slider, and last-updated styles |
| `public/app.js` | Add slider + chip utilities; update `getSearchParams`, `loadData`, `startSearch`, `clearAndRescrape`, `pollResults`, `exportCSV`, `updateChart` |

---

### Task 1: cache.js — Per-month subdirectory

**Files:**
- Modify: `cache.js`
- Create: `test-cache.js`

- [ ] **Step 1: Write failing test**

Create `E:\dev\flight-search\test-cache.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.CACHE_DIR_OVERRIDE = path.join(__dirname, 'cache-test-tmp');
// Require AFTER setting env var
delete require.cache[require.resolve('./cache')];
const cache = require('./cache');

function cleanup() {
  fs.rmSync(process.env.CACHE_DIR_OVERRIDE, { recursive: true, force: true });
}
cleanup();

// Test 1: set/get with year/month
cache.set('test_key', { price: 1234 }, 2026, 9);
const got = cache.get('test_key', 2026, 9);
assert.strictEqual(got.price, 1234, 'should retrieve cached value');
assert.strictEqual(cache.get('test_key', 2026, 10), null, 'wrong month should miss');

// Test 2: getAll returns only matching month
cache.set('key_sep', { date: '2026-09-01', returnDate: '2026-09-06', price: 5000 }, 2026, 9);
cache.set('key_oct', { date: '2026-10-01', returnDate: '2026-10-06', price: 6000 }, 2026, 10);
const sep = cache.getAll(2026, 9);
const sepFlights = Object.values(sep).flat();
assert.ok(sepFlights.some(f => f.price === 5000), 'getAll(9) should include Sept entry');
assert.ok(!sepFlights.some(f => f.price === 6000), 'getAll(9) should not include Oct entry');

// Test 3: getLastUpdated returns non-null after set
const lu = cache.getLastUpdated(2026, 9);
assert.ok(lu !== null, 'getLastUpdated should return timestamp after writes');
assert.ok(typeof lu === 'string', 'getLastUpdated should return ISO string');

// Test 4: clearMonth removes only that month
cache.clearMonth(2026, 9);
assert.strictEqual(cache.get('key_sep', 2026, 9), null, 'after clearMonth, get should return null');
const oct = cache.getAll(2026, 10);
assert.ok(Object.values(oct).flat().some(f => f.price === 6000), 'Oct entries survive clearMonth(9)');

// Test 5: clear() removes all
const count = cache.clear();
assert.ok(count >= 1, 'clear() should return count of removed entries');

cleanup();
console.log('✅ All cache tests passed!');
```

- [ ] **Step 2: Run test — confirm failure**

```
cd E:\dev\flight-search
node test-cache.js
```

Expected: `TypeError: cache.set is not a function` or wrong argument count error.

- [ ] **Step 3: Rewrite cache.js**

Replace entire `cache.js`:

```js
const fs = require('fs');
const path = require('path');

const BASE_CACHE_DIR = process.env.CACHE_DIR_OVERRIDE || path.join(__dirname, 'cache');

function monthDir(year, month) {
  const dir = path.join(BASE_CACHE_DIR, `${year}-${String(month).padStart(2, '0')}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function get(key, year, month) {
  const filePath = path.join(monthDir(year, month), `${sanitize(key)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')).data;
  } catch {
    return null;
  }
}

function set(key, data, year, month) {
  const filePath = path.join(monthDir(year, month), `${sanitize(key)}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), data }, null, 2), 'utf-8');
}

function getAll(year, month) {
  const dir = path.join(BASE_CACHE_DIR, `${year}-${String(month).padStart(2, '0')}`);
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const best = {};
  for (const file of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      if (entry.data?.date && entry.data?.returnDate) {
        const k = `${entry.data.date}|${entry.data.returnDate}`;
        if (!best[k] || entry.timestamp > best[k].ts) {
          best[k] = { ts: entry.timestamp, data: entry.data };
        }
      }
    } catch {}
  }
  const results = {};
  for (const { data } of Object.values(best)) {
    if (!results[data.date]) results[data.date] = [];
    results[data.date].push(data);
  }
  return results;
}

function getLastUpdated(year, month) {
  const dir = path.join(BASE_CACHE_DIR, `${year}-${String(month).padStart(2, '0')}`);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;
  const mtimes = files.map(f => fs.statSync(path.join(dir, f)).mtimeMs);
  return new Date(Math.max(...mtimes)).toISOString();
}

function clearMonth(year, month) {
  const dir = path.join(BASE_CACHE_DIR, `${year}-${String(month).padStart(2, '0')}`);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

function clear() {
  if (!fs.existsSync(BASE_CACHE_DIR)) return 0;
  const entries = fs.readdirSync(BASE_CACHE_DIR, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dir = path.join(BASE_CACHE_DIR, entry.name);
      count += fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
      fs.rmSync(dir, { recursive: true });
    }
  }
  return count;
}

function sanitize(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = { get, set, getAll, getLastUpdated, clearMonth, clear };
```

- [ ] **Step 4: Run test — confirm pass**

```
cd E:\dev\flight-search
node test-cache.js
```

Expected: `✅ All cache tests passed!`

- [ ] **Step 5: Commit**

```
git add cache.js test-cache.js
git commit -m "feat: cache per-month subdirectory with getLastUpdated and clearMonth"
```

---

### Task 2: scraper.js — Parametric time ranges

**Files:**
- Modify: `scraper.js`

No test framework available for Puppeteer automation; manual smoke-test at end.

- [ ] **Step 1: Remove module-level constants**

Delete lines 6–8 in `scraper.js`:
```js
// Only include flights departing within this hour range (red-eye filter)
const DEP_MIN_HOUR = 9;   // 09:00
const DEP_MAX_HOUR = 23;  // 23:00
```

- [ ] **Step 2: Update scrapeSingle — destructure new opts and derive year/month**

Replace the existing opts destructuring block in `scrapeSingle` (currently lines 17–24):

```js
async function scrapeSingle(date, returnDate, browser, opts = {}) {
  const {
    origin = '臺北',
    destination = '釜山',
    originQuery = '臺北',
    destinationQuery = '釜山',
    outboundTimeRange = { start: '06:00', end: '23:00' },
    returnTimeRange = { start: '06:00', end: '23:00' },
  } = opts;

  const year = opts.year || parseInt(date.split('-')[0]);
  const month = opts.month || parseInt(date.split('-')[1]);
  const outMinHour = parseInt(outboundTimeRange.start.split(':')[0]);
  const outMaxHour = parseInt(outboundTimeRange.end.split(':')[0]);
  const retMinHour = parseInt(returnTimeRange.start.split(':')[0]);
  const retMaxHour = parseInt(returnTimeRange.end.split(':')[0]);
```

- [ ] **Step 3: Update cache calls and log in scrapeSingle**

Replace the three references to the old constants/cache calls:

Line with `cache.get(cacheKey)` → `cache.get(cacheKey, year, month)`

Line with `console.log(\`  [SCRAPE] ... (出發 ${DEP_MIN_HOUR}:00–${DEP_MAX_HOUR}:00)...\`)` →
```js
console.log(`  [SCRAPE] ${date} → ${returnDate} [${origin}→${destination}] (出發 ${outboundTimeRange.start}–${outboundTimeRange.end})...`);
```

Line with `const outboundClicked = await clickCheapestOutbound(page);` →
```js
const outboundClicked = await clickCheapestOutbound(page, outMinHour, outMaxHour);
```

The two lines after the `outboundClicked` check (where `extractPrice` is called):
```js
const priceMinHour = outboundClicked ? retMinHour : outMinHour;
const priceMaxHour = outboundClicked ? retMaxHour : outMaxHour;
const price = await extractPrice(page, priceMinHour, priceMaxHour);
```

Both `cache.set(cacheKey, result)` calls at the end of `scrapeSingle` (success and error paths):
```js
cache.set(cacheKey, result, year, month);
```

- [ ] **Step 4: Update clickCheapestOutbound signature**

Change function signature from:
```js
async function clickCheapestOutbound(page) {
  const coords = await page.evaluate((minH, maxH) => {
```
to:
```js
async function clickCheapestOutbound(page, minHour, maxHour) {
  const coords = await page.evaluate((minH, maxH) => {
```

And change the closing line of the evaluate call from:
```js
  }, DEP_MIN_HOUR, DEP_MAX_HOUR);
```
to:
```js
  }, minHour, maxHour);
```

(The body of the `page.evaluate` callback is unchanged — it already uses `minH`/`maxH` as local params.)

- [ ] **Step 5: Update extractPrice signature and Strategy 0**

Change function signature from:
```js
async function extractPrice(page) {
  const strategies = [
    // Strategy 0: time-filtered — parse each flight card, keep only departures in DEP_MIN_HOUR–DEP_MAX_HOUR
    async () => page.evaluate((minH, maxH) => {
```
to:
```js
async function extractPrice(page, minHour = 6, maxHour = 23) {
  const strategies = [
    async () => page.evaluate((minH, maxH) => {
```

And change the closing line of Strategy 0's evaluate from:
```js
    }, DEP_MIN_HOUR, DEP_MAX_HOUR),
```
to:
```js
    }, minHour, maxHour),
```

(Strategies 1–4 are unchanged — they have no time filter.)

- [ ] **Step 6: Update scrapeAll to accept stays array**

Replace the `scrapeAll` function signature and its internals:

```js
async function scrapeAll(dates, stays, opts = {}) {
  const {
    origin = '臺北',
    destination = '釜山',
    originQuery = '臺北',
    destinationQuery = '釜山',
    outboundTimeRange = { start: '06:00', end: '23:00' },
    returnTimeRange = { start: '06:00', end: '23:00' },
  } = opts;

  const totalQueries = dates.length * stays.length;
  console.log(`\n========================================`);
  console.log(`   Google Flights Scraper`);
  console.log(`   ${origin} → ${destination}`);
  console.log(`   ${dates.length} 出發日 × ${stays.length} 停留天數 [${stays.join(', ')}天]`);
  console.log(`   去程: ${outboundTimeRange.start}–${outboundTimeRange.end} | 回程: ${returnTimeRange.start}–${returnTimeRange.end}`);
  console.log(`   共 ${totalQueries} 次查詢 (${CONCURRENCY} workers 並行)`);
  console.log(`========================================\n`);

  const queue = [];
  for (const date of dates) {
    for (const stay of stays) {
      const retDate = new Date(date);
      retDate.setDate(retDate.getDate() + stay);
      queue.push({ date, returnDate: retDate.toISOString().split('T')[0] });
    }
  }
```

In the worker loop, the `scrapeSingle` call already passes `opts`, so it gets time ranges automatically.

- [ ] **Step 7: Smoke-test with node (no browser)**

```
cd E:\dev\flight-search
node -e "const {generateDates} = require('./scraper'); console.log(generateDates(2026,9).length)"
```

Expected output: `30`

- [ ] **Step 8: Commit**

```
git add scraper.js
git commit -m "feat: scraper accepts outboundTimeRange, returnTimeRange, stays array"
```

---

### Task 3: server.js — API updates

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update /api/results**

Replace the `GET /api/results` handler:

```js
app.get('/api/results', (req, res) => {
  const year = parseInt(req.query.year) || 2026;
  const month = parseInt(req.query.month) || 9;
  res.json({
    flights: cache.getAll(year, month),
    lastUpdated: cache.getLastUpdated(year, month),
  });
});
```

- [ ] **Step 2: Update /api/stats**

Replace the `GET /api/stats` handler:

```js
app.get('/api/stats', (req, res) => {
  const year = parseInt(req.query.year) || 2026;
  const month = parseInt(req.query.month) || 9;
  const allData = cache.getAll(year, month);
  const allFlights = Object.values(allData).flat();
  const total = allFlights.length;
  const withPrices = allFlights.filter(f => f.price !== null);
  const cheapest = withPrices.length > 0
    ? withPrices.reduce((a, b) => a.price < b.price ? a : b)
    : null;
  res.json({
    totalSearches: total,
    withPrices: withPrices.length,
    noPrices: total - withPrices.length,
    cheapest: cheapest
      ? { date: cheapest.date, returnDate: cheapest.returnDate, price: cheapest.price }
      : null,
    dates: Object.keys(allData).sort(),
    lastUpdated: cache.getLastUpdated(year, month),
  });
});
```

- [ ] **Step 3: Update /api/search**

Replace the `POST /api/search` handler:

```js
app.post('/api/search', async (req, res) => {
  res.json({ message: 'Search started', status: 'running' });

  const month = req.body?.month || 9;
  const year = req.body?.year || 2026;
  const stays = Array.isArray(req.body?.stays) ? req.body.stays.map(Number) : [5, 6, 7];
  const originQuery = req.body?.originQuery || '臺北';
  const destinationQuery = req.body?.destinationQuery || '釜山';
  const origin = req.body?.origin || originQuery;
  const destination = req.body?.destination || destinationQuery;
  const outboundTimeRange = req.body?.outboundTimeRange || { start: '06:00', end: '23:00' };
  const returnTimeRange  = req.body?.returnTimeRange  || { start: '06:00', end: '23:00' };

  const dates = generateDates(year, month);
  console.log(`\n🚀 Starting batch search: ${dates.length} dates × [${stays.join(',')}] days`);
  console.log(`   Route: ${origin} → ${destination}`);
  console.log(`   Outbound: ${outboundTimeRange.start}–${outboundTimeRange.end} | Return: ${returnTimeRange.start}–${returnTimeRange.end}\n`);

  try {
    const results = await scrapeAll(dates, stays, {
      origin, destination, originQuery, destinationQuery,
      outboundTimeRange, returnTimeRange, year, month,
    });
    const withPrices = results.filter(r => r.price !== null);
    console.log(`\n✅ Done! ${results.length} total | ${withPrices.length} with prices`);
    if (withPrices.length > 0) {
      const cheapest = withPrices.reduce((a, b) => a.price < b.price ? a : b);
      console.log(`   Cheapest: NT$${cheapest.price} (${cheapest.date} → ${cheapest.returnDate})`);
    }
  } catch (err) {
    console.error(`❌ Batch search error: ${err.message}`);
  }
});
```

- [ ] **Step 4: Update /api/clear-cache**

Replace both clear-cache handlers:

```js
app.get('/api/clear-cache', (req, res) => {
  const count = cache.clear();
  res.json({ message: `Cache cleared (${count} entries)`, count });
});

app.post('/api/clear-cache', (req, res) => {
  const { year, month } = req.body || {};
  if (year && month) {
    cache.clearMonth(Number(year), Number(month));
    res.json({ message: `Cache cleared for ${year}-${String(month).padStart(2,'0')}`, count: 0 });
  } else {
    const count = cache.clear();
    res.json({ message: `Cleared ${count} cache entries`, count });
  }
});
```

- [ ] **Step 5: Update --scrape-all CLI**

Replace the `if (process.argv.includes('--scrape-all'))` block:

```js
if (process.argv.includes('--scrape-all')) {
  const getArg = name => {
    const flag = process.argv.find(a => a.startsWith(`--${name}=`));
    return flag ? flag.split('=')[1] : null;
  };
  const year  = parseInt(getArg('year'))  || 2026;
  const month = parseInt(getArg('month')) || 9;
  const staysArg = getArg('stays');
  const stays = staysArg ? staysArg.split(',').map(Number) : [5, 6, 7];

  scrapeAll(generateDates(year, month), stays, { year, month })
    .then(() => { console.log('\n✨ All scraping complete!'); process.exit(0); })
    .catch(err => { console.error('❌ Scrape failed:', err); process.exit(1); });
} else {
```

- [ ] **Step 6: Update startup banner**

Replace the banner string inside `app.listen`:

```js
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║          ✈️  Flight Price Tracker                 ║
║                                                  ║
║  Server: http://localhost:${PORT}                    ║
║  API:    http://localhost:${PORT}/api/results        ║
║                                                  ║
║  scrape-all: node server.js --scrape-all         ║
║              --year=2026 --month=9 --stays=5,6,7 ║
╚══════════════════════════════════════════════════╝
  `);
});
```

- [ ] **Step 7: Verify server starts**

```
cd E:\dev\flight-search
node server.js
```

Expected: starts on port 3000, no errors.  
Test GET: open `http://localhost:3000/api/results?year=2026&month=9` — should return `{"flights":{},"lastUpdated":null}` (empty because old cache is in root, not subdirs).  
`Ctrl+C` to stop.

- [ ] **Step 8: Commit**

```
git add server.js
git commit -m "feat: server API accepts year/month, stays array, and time ranges"
```

---

### Task 4: index.html — Settings panel

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace the search-settings block**

Replace the entire `<div class="search-settings">` block (the one containing `.settings-row` with `inputOrigin`, `inputDest`, `inputMinStay`, `inputMaxStay`) with:

```html
<div class="search-settings">
  <!-- Row 1: Route + Year/Month -->
  <div class="settings-row">
    <div class="settings-field">
      <label>出發地</label>
      <input type="text" id="inputOrigin" value="臺北" placeholder="出發城市">
    </div>
    <span class="arrow">→</span>
    <div class="settings-field">
      <label>目的地</label>
      <input type="text" id="inputDest" value="釜山" placeholder="目的地城市">
    </div>
    <div class="settings-field">
      <label>年份</label>
      <input type="number" id="inputYear" value="2026" min="2026" style="width:70px">
    </div>
    <div class="settings-field">
      <label>月份</label>
      <select id="inputMonth" class="settings-select">
        <option value="1">1月</option><option value="2">2月</option>
        <option value="3">3月</option><option value="4">4月</option>
        <option value="5">5月</option><option value="6">6月</option>
        <option value="7">7月</option><option value="8">8月</option>
        <option value="9" selected>9月</option><option value="10">10月</option>
        <option value="11">11月</option><option value="12">12月</option>
      </select>
    </div>
  </div>

  <!-- Row 2: Stay duration chips -->
  <div class="settings-row settings-row--chips">
    <label class="settings-label-block">停留天數</label>
    <div id="stayChips" class="stay-chips"></div>
    <span id="queryCount" class="query-count"></span>
  </div>

  <!-- Row 3: Time range sliders -->
  <div class="settings-row settings-row--sliders">
    <div class="time-range-field">
      <label>去程時間 <span id="outboundTimeLabel" class="time-label">06:00 – 23:00</span></label>
      <div class="range-slider-wrap">
        <input type="range" id="outboundMin" min="0" max="48" value="12" step="1">
        <input type="range" id="outboundMax" min="0" max="48" value="46" step="1">
        <div class="range-track"><div class="range-fill" id="outboundFill"></div></div>
      </div>
      <div class="range-endpoints"><span>00:00</span><span>24:00</span></div>
    </div>
    <div class="time-range-field">
      <label>回程時間 <span id="returnTimeLabel" class="time-label">06:00 – 23:00</span></label>
      <div class="range-slider-wrap">
        <input type="range" id="returnMin" min="0" max="48" value="12" step="1">
        <input type="range" id="returnMax" min="0" max="48" value="46" step="1">
        <div class="range-track"><div class="range-fill" id="returnFill"></div></div>
      </div>
      <div class="range-endpoints"><span>00:00</span><span>24:00</span></div>
    </div>
  </div>

  <!-- Row 4: Last updated -->
  <div class="settings-row settings-row--meta">
    <span id="lastUpdated" class="last-updated">最後更新：讀取中…</span>
  </div>
</div>
```

- [ ] **Step 2: Fix footer**

Replace the footer `<p>` text:
```html
<p>資料來源：Google Flights · Puppeteer 自動化爬取</p>
```

- [ ] **Step 3: Commit**

```
git add public/index.html
git commit -m "feat: settings panel with year/month, stay chips, time range sliders"
```

---

### Task 5: style.css — New UI styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Append new styles to the end of style.css**

```css
/* ============================================
   Settings select (month dropdown)
   ============================================ */

.settings-select {
  background: rgba(255,255,255,0.9);
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  color: #1e293b;
  width: 72px;
  cursor: pointer;
}

/* ============================================
   Settings chip row
   ============================================ */

.settings-row--chips {
  align-items: flex-start;
  gap: 8px;
  margin-top: 6px;
}

.settings-label-block {
  font-size: 11px;
  opacity: 0.8;
  padding-top: 5px;
  white-space: nowrap;
  min-width: 52px;
}

.stay-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  flex: 1;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
  background: rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.7);
  border: 1px solid rgba(255,255,255,0.3);
  transition: background 0.15s, color 0.15s;
  user-select: none;
}

.chip.active {
  background: rgba(255,255,255,0.9);
  color: #1e40af;
  border-color: transparent;
  font-weight: 600;
}

.chip:hover:not(.active) {
  background: rgba(255,255,255,0.35);
  color: #fff;
}

.chip-custom-btn {
  background: transparent;
  border: 1px dashed rgba(255,255,255,0.5);
  color: rgba(255,255,255,0.6);
}

.chip-custom-btn:hover {
  border-color: #fff;
  color: #fff;
}

.chip-custom-input {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 14px;
  background: rgba(255,255,255,0.95);
  border: 1px solid transparent;
}

.chip-custom-input input {
  width: 36px;
  background: transparent;
  border: none;
  color: #1e293b;
  font-size: 12px;
  outline: none;
  text-align: center;
}

.chip-custom-input button {
  background: #1e40af;
  border: none;
  color: #fff;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 8px;
  cursor: pointer;
}

.query-count {
  font-size: 11px;
  opacity: 0.7;
  padding-top: 5px;
  white-space: nowrap;
}

/* ============================================
   Dual-range time sliders
   ============================================ */

.settings-row--sliders {
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.time-range-field {
  flex: 1;
  min-width: 190px;
}

.time-range-field label {
  display: block;
  font-size: 11px;
  opacity: 0.8;
  margin-bottom: 6px;
}

.time-label {
  background: rgba(255,255,255,0.25);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-left: 4px;
  font-weight: 600;
  color: #fff;
}

.range-slider-wrap {
  position: relative;
  height: 20px;
  margin-bottom: 2px;
}

.range-slider-wrap input[type="range"] {
  position: absolute;
  top: 2px;
  left: 0;
  width: 100%;
  height: 16px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  pointer-events: none;
}

.range-slider-wrap input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  pointer-events: all;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: 2px solid #1e40af;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.range-slider-wrap input[type="range"]::-moz-range-thumb {
  pointer-events: all;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: 2px solid #1e40af;
}

.range-track {
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255,255,255,0.25);
  border-radius: 2px;
  pointer-events: none;
}

.range-fill {
  position: absolute;
  top: 0;
  height: 100%;
  background: rgba(255,255,255,0.8);
  border-radius: 2px;
}

.range-endpoints {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  opacity: 0.5;
}

/* ============================================
   Last updated
   ============================================ */

.settings-row--meta {
  margin-top: 4px;
}

.last-updated {
  font-size: 11px;
  opacity: 0.7;
}
```

- [ ] **Step 2: Commit**

```
git add public/style.css
git commit -m "feat: chip, dual-range slider, and last-updated styles"
```

---

### Task 6: app.js — Frontend logic

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add time slider utilities at the top (after `let chartInstance = null;`)**

```js
// ============================================
// Time Range Slider
// ============================================

const SLIDER_MAX = 48; // 48 × 30min steps = 00:00–24:00

function sliderValueToTime(v) {
  const h = Math.floor(v / 2);
  const m = v % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
}

function timeToSliderValue(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
}

function initDualRangeSlider(minId, maxId, fillId, labelId, defaultStart, defaultEnd) {
  const minEl = document.getElementById(minId);
  const maxEl = document.getElementById(maxId);
  const fillEl = document.getElementById(fillId);
  const labelEl = document.getElementById(labelId);
  minEl.value = timeToSliderValue(defaultStart);
  maxEl.value = timeToSliderValue(defaultEnd);

  function update() {
    let lo = parseInt(minEl.value);
    let hi = parseInt(maxEl.value);
    if (lo >= hi) {
      if (document.activeElement === minEl) { minEl.value = hi - 1; lo = hi - 1; }
      else { maxEl.value = lo + 1; hi = lo + 1; }
    }
    const pctLo = (lo / SLIDER_MAX) * 100;
    const pctHi = (hi / SLIDER_MAX) * 100;
    fillEl.style.left = `${pctLo}%`;
    fillEl.style.width = `${pctHi - pctLo}%`;
    labelEl.textContent = `${sliderValueToTime(lo)} – ${sliderValueToTime(hi)}`;
  }

  minEl.addEventListener('input', update);
  maxEl.addEventListener('input', update);
  update();
}

function getTimeRange(minId, maxId) {
  return {
    start: sliderValueToTime(parseInt(document.getElementById(minId).value)),
    end:   sliderValueToTime(parseInt(document.getElementById(maxId).value)),
  };
}
```

- [ ] **Step 2: Add stay chip utilities (after the time slider section)**

```js
// ============================================
// Stay Duration Chips
// ============================================

const PRESET_STAYS = [2,3,4,5,6,7,8,9,10,11,12,13,14];
const DEFAULT_STAYS = new Set([5, 6, 7]);
const customStays = new Set();

function initStayChips() {
  const container = document.getElementById('stayChips');
  container.innerHTML = '';
  for (const n of PRESET_STAYS) container.appendChild(createStayChip(n));
  for (const n of [...customStays].sort((a, b) => a - b)) container.appendChild(createStayChip(n, true));
  container.appendChild(createCustomButton());
  updateQueryCount();
}

function createStayChip(n, isCustom = false) {
  const chip = document.createElement('span');
  chip.className = 'chip' + (DEFAULT_STAYS.has(n) ? ' active' : '');
  chip.dataset.stay = n;
  chip.textContent = `${n}天`;
  if (isCustom) chip.dataset.custom = '1';
  chip.addEventListener('click', () => {
    if (getSelectedStays().length === 1 && chip.classList.contains('active')) return;
    chip.classList.toggle('active');
    updateQueryCount();
  });
  return chip;
}

function createCustomButton() {
  const btn = document.createElement('span');
  btn.className = 'chip chip-custom-btn';
  btn.textContent = '＋ 自訂';
  btn.addEventListener('click', () => btn.replaceWith(createCustomInputWidget()));
  return btn;
}

function createCustomInputWidget() {
  const wrap = document.createElement('span');
  wrap.className = 'chip-custom-input';
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = 1;
  inp.placeholder = '天';
  const ok = document.createElement('button');
  ok.textContent = '✓';
  ok.addEventListener('click', () => {
    const val = parseInt(inp.value);
    if (val >= 1 && !isNaN(val)) addCustomStay(val);
    else initStayChips();
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') initStayChips(); });
  wrap.appendChild(inp);
  wrap.appendChild(ok);
  setTimeout(() => inp.focus(), 0);
  return wrap;
}

function addCustomStay(n) {
  const container = document.getElementById('stayChips');
  const exists = [...container.querySelectorAll('.chip[data-stay]')].some(c => parseInt(c.dataset.stay) === n);
  if (!exists) customStays.add(n);
  initStayChips();
  const chip = [...container.querySelectorAll('.chip[data-stay]')].find(c => parseInt(c.dataset.stay) === n);
  if (chip && !chip.classList.contains('active')) { chip.classList.add('active'); updateQueryCount(); }
}

function getSelectedStays() {
  const container = document.getElementById('stayChips');
  if (!container) return [5, 6, 7];
  return [...container.querySelectorAll('.chip.active[data-stay]')]
    .map(c => parseInt(c.dataset.stay))
    .sort((a, b) => a - b);
}

function updateQueryCount() {
  const year  = parseInt(document.getElementById('inputYear')?.value)  || 2026;
  const month = parseInt(document.getElementById('inputMonth')?.value) || 9;
  const stays = getSelectedStays();
  const daysInMonth = new Date(year, month, 0).getDate();
  const el = document.getElementById('queryCount');
  if (el) el.textContent = `共 ${daysInMonth}×${stays.length} = ${daysInMonth * stays.length} 筆查詢`;
}
```

- [ ] **Step 3: Replace getSearchParams()**

Replace the entire `getSearchParams` function:

```js
function getSearchParams() {
  const year  = parseInt(document.getElementById('inputYear')?.value)  || 2026;
  const month = parseInt(document.getElementById('inputMonth')?.value) || 9;
  return {
    year,
    month,
    originQuery:      document.getElementById('inputOrigin')?.value?.trim() || '臺北',
    destinationQuery: document.getElementById('inputDest')?.value?.trim()   || '釜山',
    stays:            getSelectedStays(),
    outboundTimeRange: getTimeRange('outboundMin', 'outboundMax'),
    returnTimeRange:   getTimeRange('returnMin',   'returnMax'),
  };
}
```

- [ ] **Step 4: Replace updateSubtitle()**

```js
function updateSubtitle() {
  const p = getSearchParams();
  const stayStr = p.stays.length <= 3
    ? p.stays.join('、') + '天'
    : `${p.stays[0]}–${p.stays[p.stays.length - 1]}天`;
  const sub = document.getElementById('subtitle');
  if (sub) sub.textContent = `${p.year} 年 ${p.month} 月 · 來回 · ${p.originQuery} → ${p.destinationQuery} · 停留 ${stayStr}`;
}
```

- [ ] **Step 5: Replace loadData()**

```js
async function loadData() {
  try {
    const params = getSearchParams();
    const qs = `year=${params.year}&month=${params.month}`;
    const [statsRes, resultsRes] = await Promise.all([
      fetch(`/api/stats?${qs}`),
      fetch(`/api/results?${qs}`),
    ]);
    const stats = await statsRes.json();
    const payload = await resultsRes.json();
    allData = payload.flights || {};
    updateSummaryCards(stats);
    updateLastUpdated(stats.lastUpdated, params.year, params.month);
    updateChartFilter();
    renderTable();
    updateChart();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}
```

- [ ] **Step 6: Add updateLastUpdated() (place after loadData)**

```js
function updateLastUpdated(iso, year, month) {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  if (!iso) {
    el.textContent = `最後更新：尚未抓取（${year}年${month}月）`;
    return;
  }
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  const str = `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  el.textContent = `最後更新：${str}（${year}年${month}月）`;
}
```

- [ ] **Step 7: Replace clearAndRescrape()**

```js
async function clearAndRescrape() {
  const params = getSearchParams();
  const btn = document.getElementById('btnClearRescrape');
  btn.textContent = '🗑️ 清除中...';
  btn.disabled = true;

  document.getElementById('progressSection').classList.remove('hidden');
  document.getElementById('progressLog').innerHTML = '';
  addLog('ok', '⏳ 清除中…');

  try {
    await fetch('/api/clear-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: params.year, month: params.month }),
    });
    addLog('ok', `🗑️ 已清除 ${params.year}年${params.month}月快取`);
  } catch (err) {
    addLog('error', `❌ 清除快取失敗: ${err.message}`);
    btn.textContent = '🗑️ 清除快取重跑';
    btn.disabled = false;
    return;
  }

  btn.textContent = '🗑️ 清除快取重跑';
  btn.disabled = false;
  await startSearch();
}
```

- [ ] **Step 8: Replace startSearch()**

```js
async function startSearch() {
  const btn = document.getElementById('btnSearch');
  btn.textContent = '⏳ 查詢中...';
  btn.disabled = true;

  const params = getSearchParams();
  updateSubtitle();

  document.getElementById('progressSection').classList.remove('hidden');
  document.getElementById('progressLog').innerHTML = '';

  const daysInMonth = new Date(params.year, params.month, 0).getDate();
  const total = daysInMonth * params.stays.length;
  updateProgress(0, total);

  try {
    const qs = `year=${params.year}&month=${params.month}`;
    const baselineRes = await fetch(`/api/stats?${qs}`);
    const baseline = (await baselineRes.json()).totalSearches;

    await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    await pollResults(total, baseline, params.year, params.month);
  } catch (err) {
    addLog('error', `❌ 查詢失敗: ${err.message}`);
  }

  btn.textContent = '🔍 開始查詢全部';
  btn.disabled = false;
}
```

- [ ] **Step 9: Replace pollResults()**

```js
async function pollResults(total, baseline = 0, year = 2026, month = 9) {
  const maxAttempts = 180;
  let lastCount = 0;
  let stagnant = 0;
  const qs = `year=${year}&month=${month}`;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`/api/stats?${qs}`);
    const stats = await res.json();
    const newCount = Math.max(0, stats.totalSearches - baseline);
    updateProgress(newCount, total);
    updateSummaryCards(stats);
    updateLastUpdated(stats.lastUpdated, year, month);

    if (stats.totalSearches === lastCount) { stagnant++; } else { stagnant = 0; lastCount = stats.totalSearches; }
    if (newCount >= total) { addLog('ok', '✅ 全部查詢完成！'); break; }
    if (stagnant > 12) { addLog('error', '⚠️ 查詢停滯，請檢查伺服器日誌'); break; }
  }

  await loadData();
  updateProgress(total, total);
}
```

- [ ] **Step 10: Update exportCSV filename and replace exportCSV()**

```js
function exportCSV() {
  const allFlights = Object.values(allData).flat();
  if (allFlights.length === 0) { alert('尚無資料可匯出'); return; }

  const params = getSearchParams();
  const headers = ['出發日期', '回程日期', '停留天數', '價格 (NTD)', '路線', '狀態', '來源網址'];
  const rows = allFlights.map(f => [
    f.date, f.returnDate, calcStayDays(f.date, f.returnDate),
    f.price || '', f.route || '',
    f.price ? '有價格' : (f.error ? '錯誤' : '無資料'), f.url || '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `flight-prices-${params.year}-${String(params.month).padStart(2,'0')}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
```

- [ ] **Step 11: Update chart x-axis title**

In `updateChart()`, find the x-axis title option:
```js
text: '出發日期 (2026年9月)',
```
Replace with:
```js
text: (() => { const p = getSearchParams(); return `出發日期 (${p.year}年${p.month}月)`; })(),
```

- [ ] **Step 12: Replace DOMContentLoaded handler**

```js
document.addEventListener('DOMContentLoaded', () => {
  initDualRangeSlider('outboundMin', 'outboundMax', 'outboundFill', 'outboundTimeLabel', '06:00', '23:00');
  initDualRangeSlider('returnMin',   'returnMax',   'returnFill',   'returnTimeLabel',   '06:00', '23:00');
  initStayChips();
  loadData();
  updateSubtitle();

  ['inputOrigin', 'inputDest', 'inputYear', 'inputMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { updateSubtitle(); updateQueryCount(); });
  });

  ['inputYear', 'inputMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadData);
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auto') === '1') startSearch();
});
```

- [ ] **Step 13: Manual verification in browser**

```
cd E:\dev\flight-search
node server.js
```

Open `http://localhost:3000`. Verify:
- Stay chips 2–14 render; 5/6/7 highlighted in white
- Click a chip: toggles active state
- Click last selected chip: stays active (min-1 guard)
- Click "＋ 自訂", type `21`, press Enter: "21天" chip appears and is selected
- Query count updates (e.g., "共 30×4 = 120 筆查詢")
- Both time sliders draggable; labels update live
- Year/month inputs change subtitle and trigger loadData
- "最後更新" shows "尚未抓取（2026年9月）" (empty new cache)
- Chart and table still functional

- [ ] **Step 14: Commit**

```
git add public/app.js
git commit -m "feat: chip multi-select, dual-range sliders, year/month API calls"
```

---

## Final smoke test

- [ ] **Run full test suite**

```
cd E:\dev\flight-search
node test-cache.js
```

Expected: `✅ All cache tests passed!`

- [ ] **Verify server with curl (optional)**

```
cd E:\dev\flight-search
node server.js &
curl "http://localhost:3000/api/stats?year=2026&month=9"
```

Expected JSON contains `totalSearches`, `lastUpdated` field.
