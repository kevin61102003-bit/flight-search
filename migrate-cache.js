// ============================================
// migrate-cache.js  (one-time)
//
// Moves legacy cache entries into the new per-route layout so different
// destinations stop colliding:
//
//   OLD  cache/______<date>_<ret>.json            (flat, route lost in filename)
//        cache/<YYYY-MM>/______<date>_<ret>.json  (month folder, route lost)
//   NEW  cache/routes/<slug>/<YYYY-MM>/<date>_<ret>.json
//
// Route is recovered from each entry's data.route field ("臺北 → 首爾").
// Legacy files are COPIED (originals left as a backup); cache/ is gitignored,
// so nothing here is ever uploaded.
//
//   node migrate-cache.js
// ============================================

const fs = require('fs');
const path = require('path');
const cache = require('./cache');

const CACHE_DIR = path.join(__dirname, 'cache');

function parseRoute(routeStr) {
  // "臺北 → 首爾" → { origin: '臺北', destination: '首爾' }
  if (!routeStr || !routeStr.includes('→')) return null;
  const [origin, destination] = routeStr.split('→').map(s => s.trim());
  if (!origin || !destination) return null;
  return { origin, destination };
}

// Collect legacy files as { file, forcedMonth } where forcedMonth (from a
// YYYY-MM subfolder) preserves the original search-month grouping if present.
function collectLegacyFiles() {
  const out = [];
  if (!fs.existsSync(CACHE_DIR)) return out;
  for (const entry of fs.readdirSync(CACHE_DIR, { withFileTypes: true })) {
    if (entry.name === 'routes') continue; // new layout — skip
    const full = path.join(CACHE_DIR, entry.name);
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push({ file: full, forcedMonth: null });
    } else if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
      const [y, m] = entry.name.split('-').map(Number);
      for (const f of fs.readdirSync(full).filter(n => n.endsWith('.json'))) {
        out.push({ file: path.join(full, f), forcedMonth: { year: y, month: m } });
      }
    }
  }
  return out;
}

function main() {
  const files = collectLegacyFiles();
  let migrated = 0, skipped = 0;
  const routeCounts = {};

  for (const { file, forcedMonth } of files) {
    let entry;
    try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { skipped++; continue; }
    const data = entry.data;
    if (!data || !data.date || !data.returnDate) { skipped++; continue; }

    const route = parseRoute(data.route);
    if (!route) { skipped++; continue; }

    const slug = cache.routeSlug(route.origin, route.destination);
    const { year, month } = forcedMonth || {
      year: Number(data.date.slice(0, 4)),
      month: Number(data.date.slice(5, 7)),
    };

    // cache.set writes { timestamp: Date.now(), data } — re-set then restore the
    // original timestamp + mtime so "last updated" stays accurate.
    const key = `${data.date}_${data.returnDate}`;
    cache.set(key, data, slug, year, month);

    if (entry.timestamp) {
      const dir = path.join(CACHE_DIR, 'routes', slug, `${year}-${String(month).padStart(2, '0')}`);
      const dest = path.join(dir, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
      try {
        fs.writeFileSync(dest, JSON.stringify({ timestamp: entry.timestamp, data }, null, 2), 'utf8');
        const t = entry.timestamp / 1000;
        fs.utimesSync(dest, t, t);
      } catch {}
    }

    const label = `${route.origin}→${route.destination}`;
    routeCounts[label] = (routeCounts[label] || 0) + 1;
    migrated++;
  }

  console.log(`✅ 遷移完成：${migrated} 筆，略過 ${skipped} 筆`);
  for (const [label, n] of Object.entries(routeCounts)) {
    console.log(`   ${label.replace('→', ' → ')}: ${n} 筆`);
  }
  console.log('\n（舊檔案保留為備份；cache/ 全程不上傳。確認無誤後可手動刪除 cache 根目錄與 cache/<年-月> 舊資料夾。）');
}

main();
