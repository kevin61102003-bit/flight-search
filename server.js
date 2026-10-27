const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const { exec } = require('child_process');
const cache = require('./cache');
const { scrapeAll, generateDates } = require('./scraper');

const execP = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// ── 外網密碼閘 ──────────────────────────────────────────────
// 本機（localhost）免密碼；從 ngrok 等外部 Host 進來的請求要求 HTTP Basic Auth。
// 密碼沿用靜態站的 .viewer-password（或 FLIGHT_PW 環境變數）。
// 沒設密碼時不改變原行為（本機開發照舊）。
function getViewerPassword() {
  if (process.env.FLIGHT_PW) return process.env.FLIGHT_PW.trim();
  try {
    const pw = fs.readFileSync(path.join(__dirname, '.viewer-password'), 'utf8').trim();
    if (pw) return pw;
  } catch { /* 沒有檔案就當作沒設密碼 */ }
  return null;
}
function isLocalRequest(req) {
  // 經過 ngrok 等反向代理進來的請求一定帶 X-Forwarded-For/Proto，
  // 即使 Host 被改寫成 localhost 也不能當成本機請求，否則密碼閘會被繞過。
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-forwarded-host']) {
    return false;
  }
  // TCP 連線來源也必須是 loopback，避免同網段直接連進來時偽造 Host 過關。
  const addr = (req.socket && req.socket.remoteAddress) || '';
  if (!(addr === '::1' || addr === '127.0.0.1' || addr.startsWith('::ffff:127.'))) {
    return false;
  }
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
// 失敗次數節流：密碼是明文直接比對，PBKDF2 不擋線上暴力破解，只能靠這裡限速。
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_FAILS = 10;
const authFails = new Map(); // ip -> { count, resetAt }
function authBlocked(ip) {
  const rec = authFails.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { authFails.delete(ip); return false; }
  return rec.count >= AUTH_MAX_FAILS;
}
function noteAuthFail(ip) {
  const now = Date.now();
  const rec = authFails.get(ip);
  if (!rec || now > rec.resetAt) authFails.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  else rec.count++;
}

app.use((req, res, next) => {
  if (isLocalRequest(req)) return next();          // 本機直接放行
  const pw = getViewerPassword();
  if (!pw) return next();                           // 沒設密碼 → 不擋（維持原行為）
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
  if (authBlocked(ip)) {
    return res.status(429).send('嘗試次數過多，請稍後再試 / Too many attempts');
  }
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const supplied = decoded.slice(decoded.indexOf(':') + 1); // 使用者名稱不限，只比對密碼
    if (safeEqual(supplied, pw)) { authFails.delete(ip); return next(); }
  }
  noteAuthFail(ip);
  res.set('WWW-Authenticate', 'Basic realm="Flight Search", charset="UTF-8"');
  return res.status(401).send('需要密碼 / Password required');
});

app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// API Endpoints
// ============================================

/**
 * GET /api/results
 * Get all cached flight search results
 */
app.get('/api/results', (req, res) => {
  const year = parseInt(req.query.year) || 2026;
  const month = parseInt(req.query.month) || 9;
  const slug = cache.routeSlug(req.query.origin || '臺北', req.query.dest || '釜山');
  res.json({
    flights: cache.getAll(slug, year, month),
    lastUpdated: cache.getLastUpdated(slug, year, month),
  });
});

/**
 * GET /api/routes
 * List every route that has cached data, with the months each covers.
 */
app.get('/api/routes', (req, res) => {
  res.json({ routes: cache.listRoutes() });
});

/**
 * GET /api/stats
 * Get statistics about cached data
 */
app.get('/api/stats', (req, res) => {
  const year = parseInt(req.query.year) || 2026;
  const month = parseInt(req.query.month) || 9;
  const slug = cache.routeSlug(req.query.origin || '臺北', req.query.dest || '釜山');
  const allData = cache.getAll(slug, year, month);
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
    lastUpdated: cache.getLastUpdated(slug, year, month),
  });
});

/**
 * POST /api/search
 * Trigger full month search (runs in background)
 * Body: { month: 9, year: 2026, stays: [5,6,7], outboundTimeRange: {start,end}, returnTimeRange: {start,end} }
 */
app.post('/api/search', async (req, res) => {
  res.json({ message: 'Search started', status: 'running' });

  const month = req.body?.month || 9;
  const year = req.body?.year || 2026;
  const stays = Array.isArray(req.body?.stays)
    ? req.body.stays.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : [5, 6, 7];
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

/**
 * GET /api/clear-cache  — clear all
 * POST /api/clear-cache — clear selectively by { year, month } or all if omitted
 */
app.get('/api/clear-cache', (req, res) => {
  const count = cache.clear();
  res.json({ message: `Cache cleared (${count} entries)`, count });
});

app.post('/api/clear-cache', (req, res) => {
  const { year, month, origin, dest } = req.body || {};
  if (year && month) {
    const slug = cache.routeSlug(origin || '臺北', dest || '釜山');
    cache.clearMonth(slug, Number(year), Number(month));
    res.json({ message: `Cache cleared for ${year}-${String(month).padStart(2,'0')}`, count: 0 });
  } else {
    const count = cache.clear();
    res.json({ message: `Cleared ${count} cache entries`, count });
  }
});

/**
 * POST /api/publish
 * Encrypt cache → docs/ (build-static.js) then commit & push to GitHub Pages.
 * Relies on git credentials already cached (first push done interactively once).
 */
app.post('/api/publish', async (req, res) => {
  const steps = [];
  try {
    const build = await execP(`"${process.execPath}" build-static.js`, { cwd: __dirname });
    steps.push('🔒 已加密產生 docs/');
    if (build.stdout) console.log(build.stdout);

    await execP('git add -A', { cwd: __dirname });
    try {
      await execP('git commit -m "data: update flight prices"', { cwd: __dirname });
      steps.push('📝 已提交變更');
    } catch {
      steps.push('（無新變更，沿用現有 commit）');
    }

    const push = await execP('git push', { cwd: __dirname });
    steps.push('🚀 已推送到 GitHub Pages（約 1 分鐘後更新）');
    if (push.stdout) console.log(push.stdout);

    res.json({ ok: true, steps });
  } catch (err) {
    console.error('publish 失敗:', err.message);
    res.json({ ok: false, steps, error: err.message, stderr: (err.stderr || '').slice(0, 500) });
  }
});

// ============================================
// Startup
// ============================================

// If --scrape-all flag is passed, run full scrape on startup then exit
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
  // 只聽 loopback：外網一律走 ngrok，避免同網段直接連進來繞過密碼閘。
  app.listen(PORT, '127.0.0.1', () => {
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
}
