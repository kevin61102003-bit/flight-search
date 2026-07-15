const fs = require('fs');
const path = require('path');

const BASE_CACHE_DIR = process.env.CACHE_DIR_OVERRIDE || path.join(__dirname, 'cache');
// Each route lives in its own folder so different destinations never collide:
//   cache/routes/<slug>/<year>-<month>/<date>_<returnDate>.json
const ROUTES_DIR = path.join(BASE_CACHE_DIR, 'routes');

// --- route identity ---------------------------------------------------------
// A route is "出發地→目的地" (e.g. 臺北→首爾). We encode it to a filesystem-safe,
// reversible slug with base64url so 首爾/釜山 stay distinct (sanitize() alone would
// turn every Chinese route into the same string of underscores).
function routeSlug(origin, destination) {
  return Buffer.from(`${origin}→${destination}`, 'utf8').toString('base64url');
}
function routeLabel(slug) {
  try {
    return Buffer.from(slug, 'base64url').toString('utf8'); // "臺北→首爾"
  } catch {
    return slug;
  }
}

function monthDirName(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthDir(slug, year, month) {
  const dir = path.join(ROUTES_DIR, slug, monthDirName(year, month));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function monthDirRead(slug, year, month) {
  return path.join(ROUTES_DIR, slug, monthDirName(year, month));
}

function get(key, slug, year, month) {
  const file = path.join(monthDirRead(slug, year, month), sanitize(key) + '.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).data;
  } catch {
    return null;
  }
}

function set(key, data, slug, year, month) {
  const filePath = path.join(monthDir(slug, year, month), `${sanitize(key)}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), data }, null, 2), 'utf-8');
}

function getAll(slug, year, month) {
  const dir = monthDirRead(slug, year, month);
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

function getLastUpdated(slug, year, month) {
  const dir = monthDirRead(slug, year, month);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;
  const mtimes = files.map(f => fs.statSync(path.join(dir, f)).mtimeMs);
  return new Date(mtimes.reduce((a, b) => (a > b ? a : b))).toISOString();
}

// List every route that has data, with the months it covers.
// → [{ slug, label, months: [{ year, month }] }]
function listRoutes() {
  if (!fs.existsSync(ROUTES_DIR)) return [];
  const routes = [];
  for (const slug of fs.readdirSync(ROUTES_DIR)) {
    const rdir = path.join(ROUTES_DIR, slug);
    if (!fs.statSync(rdir).isDirectory()) continue;
    const months = fs.readdirSync(rdir)
      .filter(d => /^\d{4}-\d{2}$/.test(d) && fs.statSync(path.join(rdir, d)).isDirectory())
      .map(d => { const [y, m] = d.split('-').map(Number); return { year: y, month: m }; })
      .filter(({ year, month }) => Object.keys(getAll(slug, year, month)).length > 0)
      .sort((a, b) => a.year - b.year || a.month - b.month);
    if (months.length) routes.push({ slug, label: routeLabel(slug), months });
  }
  return routes;
}

function clearMonth(slug, year, month) {
  const dir = monthDirRead(slug, year, month);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

// Clear everything under cache/routes (all routes, all months).
function clear() {
  if (!fs.existsSync(ROUTES_DIR)) return 0;
  let count = 0;
  for (const slug of fs.readdirSync(ROUTES_DIR)) {
    const rdir = path.join(ROUTES_DIR, slug);
    if (!fs.statSync(rdir).isDirectory()) continue;
    for (const md of fs.readdirSync(rdir)) {
      const mdir = path.join(rdir, md);
      if (!fs.statSync(mdir).isDirectory()) continue;
      count += fs.readdirSync(mdir).filter(f => f.endsWith('.json')).length;
    }
    fs.rmSync(rdir, { recursive: true });
  }
  return count;
}

function sanitize(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = {
  get, set, getAll, getLastUpdated, clearMonth, clear,
  routeSlug, routeLabel, listRoutes,
};
