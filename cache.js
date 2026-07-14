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
