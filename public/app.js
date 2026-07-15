// ============================================
// Flight Price Tracker - Frontend App
// ============================================

let allData = {};
let chartInstance = null;

// Static-mode (GitHub Pages) route state
let staticManifest = null;
let staticSlug = null;

// 'dynamic' = served by local Express; 'static' = GitHub Pages (read-only, encrypted)
const APP_MODE = (typeof window !== 'undefined' && window.APP_MODE) || 'dynamic';
const IS_STATIC = APP_MODE === 'static';
const PW_STORAGE_KEY = 'flightViewerPw';

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
    lo = Math.max(0, lo);
    hi = Math.min(SLIDER_MAX, hi);
    const pctLo = (lo / SLIDER_MAX) * 100;
    const pctHi = (hi / SLIDER_MAX) * 100;
    fillEl.style.left = `${pctLo}%`;
    fillEl.style.width = `${pctHi - pctLo}%`;
    labelEl.textContent = `${sliderValueToTime(lo)} – ${sliderValueToTime(hi)}`;
    saveSettings();
  }

  minEl.addEventListener('input', update);
  maxEl.addEventListener('input', update);
  update();
}

function getTimeRange(minId, maxId) {
  const minEl = document.getElementById(minId);
  const maxEl = document.getElementById(maxId);
  if (!minEl || !maxEl) return { start: '00:00', end: '24:00' }; // sliders removed in static mode
  return {
    start: sliderValueToTime(parseInt(minEl.value)),
    end:   sliderValueToTime(parseInt(maxEl.value)),
  };
}

// ============================================
// Stay Duration Chips
// ============================================

const PRESET_STAYS = [2,3,4,5,6,7,8,9,10,11,12,13,14];
const DEFAULT_STAYS = new Set([5, 6, 7]);
const customStays = new Set();

function initStayChips(initialActive = null) {
  const container = document.getElementById('stayChips');
  const existing = container?.querySelectorAll('.chip.active[data-stay]');
  let activeNow;
  if (existing && existing.length > 0) {
    activeNow = new Set([...existing].map(c => parseInt(c.dataset.stay)));
  } else if (initialActive) {
    activeNow = new Set(initialActive);
  } else {
    activeNow = new Set(DEFAULT_STAYS);
  }
  container.innerHTML = '';
  for (const n of PRESET_STAYS) container.appendChild(createStayChip(n, false, activeNow));
  for (const n of [...customStays].sort((a, b) => a - b)) container.appendChild(createStayChip(n, true, activeNow));
  container.appendChild(createCustomButton());
  updateQueryCount();
}

function createStayChip(n, isCustom = false, activeSet = DEFAULT_STAYS) {
  const chip = document.createElement('span');
  chip.className = 'chip' + (activeSet.has(n) ? ' active' : '');
  chip.dataset.stay = n;
  chip.textContent = `${n}天`;
  if (isCustom) chip.dataset.custom = '1';
  chip.addEventListener('click', () => {
    if (getSelectedStays().length === 1 && chip.classList.contains('active')) return;
    chip.classList.toggle('active');
    updateQueryCount();
    saveSettings();
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

function saveSettings() {
  try {
    const p = getSearchParams();
    const settings = {
      year:  p.year,
      month: p.month,
      slug:  IS_STATIC ? staticSlug : undefined,
      stays: getSelectedStays(),
      customStays: [...customStays],
      outboundTimeRange: getTimeRange('outboundMin', 'outboundMax'),
      returnTimeRange:   getTimeRange('returnMin',   'returnMax'),
    };
    localStorage.setItem('flightSearchSettings', JSON.stringify(settings));
  } catch {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('flightSearchSettings');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ============================================
// Data Loading
// ============================================

async function loadData() {
  if (IS_STATIC) return loadDataStatic();
  try {
    const params = getSearchParams();
    const qs = dataQuery(params);
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

async function refreshData() {
  document.getElementById('btnSearch').textContent = '🔄 重新整理中...';
  document.getElementById('btnSearch').disabled = true;
  await loadData();
  document.getElementById('btnSearch').textContent = '🔍 開始查詢全部';
  document.getElementById('btnSearch').disabled = false;
}

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

async function publishToSite() {
  const btn = document.getElementById('btnPublish');
  const orig = btn.textContent;
  btn.textContent = '📤 發布中...';
  btn.disabled = true;

  document.getElementById('progressSection').classList.remove('hidden');
  document.getElementById('progressLog').innerHTML = '';
  addLog('ok', '📤 開始發布到網站（加密 → 上傳 GitHub）…');

  try {
    const res = await fetch('/api/publish', { method: 'POST' });
    const data = await res.json();
    (data.steps || []).forEach(s => addLog('ok', '  ' + s));
    if (data.ok) {
      addLog('ok', '✅ 發布完成！GitHub Pages 約 1 分鐘後更新，親友重新整理即可看到新價格。');
    } else {
      addLog('error', `❌ 發布失敗: ${data.error || '未知錯誤'}`);
      if (data.stderr) addLog('error', data.stderr);
      addLog('error', '若是登入問題，請在 PowerShell 手動跑一次 git push 重新登入。');
    }
  } catch (err) {
    addLog('error', `❌ 發布失敗: ${err.message}`);
  }

  btn.textContent = orig;
  btn.disabled = false;
}

// ============================================
// Summary Cards
// ============================================

function updateSummaryCards(stats) {
  // Cheapest
  if (stats.cheapest) {
    document.getElementById('cheapestPrice').textContent = `NT$${stats.cheapest.price.toLocaleString()}`;
    document.getElementById('cheapestDetail').textContent =
      `${stats.cheapest.date} → ${stats.cheapest.returnDate}`;
  } else {
    document.getElementById('cheapestPrice').textContent = '—';
    document.getElementById('cheapestDetail').textContent = '尚無資料';
  }

  // Average
  if (stats.withPrices > 0) {
    const { allFlights } = computeAverages();
    const avg = allFlights.length > 0
      ? Math.round(allFlights.reduce((s, f) => s + f.price, 0) / allFlights.length)
      : 0;
    document.getElementById('avgPrice').textContent = `NT$${avg.toLocaleString()}`;
  } else {
    document.getElementById('avgPrice').textContent = '—';
  }

  // Count
  document.getElementById('searchCount').textContent = stats.totalSearches;
  document.getElementById('searchDetail').textContent =
    `${stats.withPrices} 筆有價格 · ${stats.noPrices} 筆無資料`;

  // Range
  if (stats.withPrices > 1) {
    const { allFlights } = computeAverages();
    const prices = allFlights.map(f => f.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    document.getElementById('priceRange').textContent =
      `NT$${min.toLocaleString()} ~ NT$${max.toLocaleString()}`;
  } else {
    document.getElementById('priceRange').textContent = '—';
  }
}

function computeAverages() {
  const allFlights = Object.values(allData).flat().filter(f => f.price !== null);
  return { allFlights };
}

// ============================================
// Search / Scraping
// ============================================

function getSearchParams() {
  const monthRaw = document.getElementById('inputMonth')?.value || '';
  let year, month;
  if (String(monthRaw).includes('-')) {
    // static mode: month <select> holds "year-month" (e.g. "2026-9")
    [year, month] = String(monthRaw).split('-').map(Number);
  } else {
    year  = parseInt(document.getElementById('inputYear')?.value) || 2026;
    month = parseInt(monthRaw) || 9;
  }
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

// Query string shared by /api/stats and /api/results — carries the route so the
// server reads the right per-route cache folder.
function dataQuery(params) {
  return `year=${params.year}&month=${params.month}`
    + `&origin=${encodeURIComponent(params.originQuery)}`
    + `&dest=${encodeURIComponent(params.destinationQuery)}`;
}

// Dynamic mode: fill the "已存航線" dropdown from cached routes so you can
// jump between destinations without retyping. Selecting one fills origin/dest.
async function populateRoutes() {
  const sel = document.getElementById('routeSwitcher');
  if (!sel || IS_STATIC) return;
  try {
    const { routes } = await (await fetch('/api/routes')).json();
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 已存航線 —</option>';
    (routes || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.label;                       // "臺北→首爾"
      opt.textContent = r.label.replace('→', ' → ');
      sel.appendChild(opt);
    });
    sel.value = cur;
  } catch {}
}

function onRouteSwitch() {
  const label = document.getElementById('routeSwitcher').value;
  if (!label) return;
  const [o, d] = label.split('→');
  const oEl = document.getElementById('inputOrigin');
  const dEl = document.getElementById('inputDest');
  if (oEl) oEl.value = (o || '').trim();
  if (dEl) dEl.value = (d || '').trim();
  updateSubtitle();
  updateQueryCount();
  saveSettings();
  loadData();
}

function updateSubtitle() {
  if (IS_STATIC) { updateSubtitleStatic(); return; }
  const p = getSearchParams();
  const stayStr = p.stays.length <= 3
    ? p.stays.join('、') + '天'
    : `${p.stays[0]}–${p.stays[p.stays.length - 1]}天`;
  const sub = document.getElementById('subtitle');
  if (sub) sub.textContent = `${p.year} 年 ${p.month} 月 · 來回 · ${p.originQuery} → ${p.destinationQuery} · 停留 ${stayStr}`;
}

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
    const qs = dataQuery(params);
    const baselineRes = await fetch(`/api/stats?${qs}`);
    const baseline = (await baselineRes.json()).totalSearches;

    await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    await pollResults(total, baseline, params);
  } catch (err) {
    addLog('error', `❌ 查詢失敗: ${err.message}`);
  }

  btn.textContent = '🔍 開始查詢全部';
  btn.disabled = false;
}

async function pollResults(total, baseline = 0, params = {}) {
  const maxAttempts = 180;
  let lastCount = 0;
  let stagnant = 0;
  const year = params.year || 2026;
  const month = params.month || 9;
  const qs = dataQuery(params);

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
  populateRoutes();
  updateProgress(total, total);
}

function updateProgress(current, total) {
  const pct = Math.min(100, Math.round((current / total) * 100));
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressCount').textContent = `${current} / ${total}`;
  if (current < total) {
    document.getElementById('progressLabel').textContent = `📡 查詢中... (${pct}%)`;
  } else {
    document.getElementById('progressLabel').textContent = `✅ 完成！ (${pct}%)`;
  }
}

function addLog(type, message) {
  const log = document.getElementById('progressLog');
  const line = document.createElement('div');
  line.className = `log-${type}`;
  line.textContent = message;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ============================================
// Table
// ============================================

function renderTable() {
  const tbody = document.getElementById('tableBody');
  const filterDate = document.getElementById('filterDate').value.trim().toLowerCase();
  const allFlights = Object.values(allData).flat();

  if (allFlights.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">尚未查詢資料，點擊「開始查詢」按鈕</td></tr>`;
    return;
  }

  // Find cheapest
  const withPrices = allFlights.filter(f => f.price !== null);
  const cheapest = withPrices.length > 0
    ? withPrices.reduce((a, b) => a.price < b.price ? a : b)
    : null;

  // Sort
  const sorted = [...allFlights].sort((a, b) => a.date.localeCompare(b.date) || a.returnDate.localeCompare(b.returnDate));

  let html = '';
  for (const flight of sorted) {
    // Apply filter
    if (filterDate && !flight.date.includes(filterDate) && !flight.returnDate.includes(filterDate)) {
      continue;
    }

    const stayDays = calcStayDays(flight.date, flight.returnDate);
    const isCheapest = cheapest && flight.price === cheapest.price && flight.price !== null;
    const rowClass = isCheapest ? 'cheapest-row' : '';

    let priceHtml, badgeHtml;
    if (flight.price) {
      priceHtml = `NT$${flight.price.toLocaleString()}`;
      badgeHtml = `<span class="badge badge-found">✅ 有價格</span>`;
    } else if (flight.error) {
      priceHtml = '—';
      badgeHtml = `<span class="badge badge-error">❌ 錯誤</span>`;
    } else {
      priceHtml = '—';
      badgeHtml = `<span class="badge badge-nodata">⏳ 無資料</span>`;
    }

    const srcHtml = flight.url
      ? `<a href="${flight.url}" target="_blank" rel="noopener" title="${flight.url}">🔗 查看</a>`
      : '—';

    html += `<tr class="${rowClass}">
      <td>${flight.date}</td>
      <td>${flight.returnDate}</td>
      <td>${stayDays} 天</td>
      <td>${priceHtml}</td>
      <td>${badgeHtml}</td>
      <td>${srcHtml}</td>
    </tr>`;
  }

  tbody.innerHTML = html || `<tr><td colspan="6" class="empty-state">沒有符合的資料</td></tr>`;
}

function calcStayDays(dep, ret) {
  const d1 = new Date(dep);
  const d2 = new Date(ret);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// ============================================
// Chart
// ============================================

const CHART_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

function updateChartFilter() {
  const allFlights = Object.values(allData).flat().filter(f => f.price !== null);
  const stayDays = [...new Set(allFlights.map(f => calcStayDays(f.date, f.returnDate)))].sort((a, b) => a - b);
  const sel = document.getElementById('filterStay');
  const current = sel.value;
  sel.innerHTML = '<option value="all">全部</option>' +
    stayDays.map(d => `<option value="${d}">${d} 天</option>`).join('');
  // Restore selection if still valid
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function updateChart() {
  const stayFilter = document.getElementById('filterStay').value;
  const canvas = document.getElementById('priceChart');
  const ctx = canvas.getContext('2d');

  // Destroy existing chart
  if (chartInstance) {
    chartInstance.destroy();
  }

  const allFlights = Object.values(allData).flat().filter(f => f.price !== null);

  if (allFlights.length === 0) {
    chartInstance = new Chart(ctx, {
      type: 'scatter',
      data: { datasets: [] },
      options: {
        plugins: {
          title: {
            display: true,
            text: '尚無價格資料，請先執行查詢',
            font: { size: 16 },
          },
        },
      },
    });
    return;
  }

  // Build shared x-axis labels: all departure dates in Sep
  const allDates = [...new Set(allFlights.map(f => f.date))].sort();
  const dateLabels = allDates.map(d => {
    const parts = d.split('-');
    return `${parts[1]}/${parts[2]}`;
  });

  // Detect stay durations present in the data
  const allStays = [...new Set(allFlights.map(f => calcStayDays(f.date, f.returnDate)))].sort((a, b) => a - b);
  const stays = stayFilter === 'all' ? allStays : [parseInt(stayFilter)];
  const datasets = [];

  for (let i = 0; i < stays.length; i++) {
    const stayNum = stays[i];
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    const dateMap = {};
    allFlights
      .filter(f => calcStayDays(f.date, f.returnDate) === stayNum)
      .forEach(f => { dateMap[f.date] = f; });

    // Build data aligned with allDates
    const dataPoints = allDates.map(date => dateMap[date] ? dateMap[date].price : null);

    datasets.push({
      label: `${stayNum} 天停留`,
      data: dataPoints,
      borderColor: color,
      backgroundColor: color,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      fill: false,
      spanGaps: false,
    });
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dateLabels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            title: (items) => `出發: ${allDates[items[0].dataIndex]}`,
            label: (item) => {
              const date = allDates[item.dataIndex];
              const flight = allFlights.find(f =>
                f.date === date && f.price === item.raw
              );
              const val = item.raw;
              if (val === null) return '無價格資料';
              return [
                `價格: NT$${Number(val).toLocaleString()}`,
                flight ? `回程: ${flight.returnDate}` : '',
                flight ? `停留: ${calcStayDays(flight.date, flight.returnDate)} 天` : '',
              ].filter(Boolean);
            },
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          title: {
            display: true,
            text: (() => { const p = getSearchParams(); return `出發日期 (${p.year}年${p.month}月)`; })(),
          },
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 15,
          },
        },
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: '價格 (NTD)',
          },
          ticks: {
            callback: (val) => `NT$${Number(val).toLocaleString()}`,
          },
        },
      },
    },
  });
}

// ============================================
// CSV Export
// ============================================

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

// ============================================
// Init
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  if (IS_STATIC) { initStaticMode(); return; }

  const saved = loadSettings();

  if (saved) {
    const yearEl  = document.getElementById('inputYear');
    const monthEl = document.getElementById('inputMonth');
    if (yearEl)  yearEl.value  = saved.year;
    if (monthEl) monthEl.value = saved.month;
    if (saved.customStays) saved.customStays.forEach(n => customStays.add(n));
  }

  const ob = saved?.outboundTimeRange;
  const rt = saved?.returnTimeRange;
  initDualRangeSlider('outboundMin', 'outboundMax', 'outboundFill', 'outboundTimeLabel',
    ob?.start || '06:00', ob?.end || '23:00');
  initDualRangeSlider('returnMin', 'returnMax', 'returnFill', 'returnTimeLabel',
    rt?.start || '06:00', rt?.end || '23:00');

  initStayChips(saved?.stays || null);
  loadData();
  populateRoutes();
  updateSubtitle();

  ['inputOrigin', 'inputDest', 'inputYear', 'inputMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { updateSubtitle(); updateQueryCount(); saveSettings(); });
  });

  ['inputYear', 'inputMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadData);
  });

  document.getElementById('routeSwitcher')?.addEventListener('change', onRouteSwitch);

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auto') === '1') startSearch();
});

// ============================================
// Static Mode (GitHub Pages, encrypted, read-only)
// ============================================

// --- AES-GCM decryption (mirrors build-static.js; uses browser Web Crypto) ---

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveViewerKey(password, salt) {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function decryptPayload(payload, password) {
  const key = await deriveViewerKey(password, b64ToBytes(payload.salt));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, key, b64ToBytes(payload.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// --- Password gate ---

let _pwResolve = null;

function injectPasswordOverlay() {
  if (document.getElementById('pwOverlay')) return;
  const div = document.createElement('div');
  div.id = 'pwOverlay';
  div.className = 'pw-overlay';
  div.innerHTML = `
    <div class="pw-box">
      <div class="pw-title">🔒 需要密碼</div>
      <div class="pw-desc">此頁面受保護，請輸入分享密碼</div>
      <input type="password" id="pwInput" class="pw-input" placeholder="密碼" autocomplete="current-password">
      <button id="pwSubmit" class="pw-submit">進入</button>
      <div class="pw-error" id="pwError"></div>
    </div>`;
  document.body.appendChild(div);

  const submit = () => {
    const v = document.getElementById('pwInput').value;
    if (!v) return;
    showPasswordError('');
    if (_pwResolve) { const r = _pwResolve; _pwResolve = null; r(v); }
  };
  document.getElementById('pwSubmit').addEventListener('click', submit);
  document.getElementById('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function showPasswordOverlay() {
  const o = document.getElementById('pwOverlay');
  o.classList.add('show');
  const inp = document.getElementById('pwInput');
  inp.value = '';
  setTimeout(() => inp.focus(), 50);
}

function hidePasswordOverlay() {
  document.getElementById('pwOverlay').classList.remove('show');
}

function showPasswordError(msg) {
  const el = document.getElementById('pwError');
  if (el) el.textContent = msg || '';
}

function ensurePassword() {
  const cached = localStorage.getItem(PW_STORAGE_KEY);
  if (cached) return Promise.resolve(cached);
  showPasswordOverlay();
  return new Promise(resolve => { _pwResolve = resolve; });
}

// --- Static data loading ---

function renderStaticEmpty(params) {
  allData = {};
  updateSummaryCards({ totalSearches: 0, withPrices: 0, noPrices: 0, cheapest: null, dates: [], lastUpdated: null });
  updateLastUpdated(null, params.year, params.month);
  updateChartFilter();
  renderTable();
  updateChart();
}

function applyStaticData(data, params) {
  allData = (data.results && data.results.flights) || {};
  updateSummaryCards(data.stats || {});
  updateLastUpdated(data.stats ? data.stats.lastUpdated : null, params.year, params.month);
  updateChartFilter();
  renderTable();
  updateChart();
}

async function loadDataStatic() {
  const params = getSearchParams();
  if (!staticSlug) { renderStaticEmpty(params); return; }
  const fileKey = `${params.year}-${params.month}`;

  let res;
  try {
    res = await fetch(`data/${staticSlug}/${fileKey}.json`, { cache: 'no-store' });
  } catch { res = null; }

  if (!res || !res.ok) { renderStaticEmpty(params); return; } // no data for this month — no password needed

  const encrypted = await res.json();

  // Loop until the password decrypts successfully (or forever, re-prompting on failure)
  for (;;) {
    const password = await ensurePassword();
    try {
      const data = await decryptPayload(encrypted, password);
      localStorage.setItem(PW_STORAGE_KEY, password);
      hidePasswordOverlay();
      applyStaticData(data, params);
      return;
    } catch {
      localStorage.removeItem(PW_STORAGE_KEY);
      showPasswordError('密碼錯誤，請再試一次');
    }
  }
}

// Subtitle for the read-only site — driven by the selected route + month.
function updateSubtitleStatic() {
  const sub = document.getElementById('subtitle');
  if (!sub) return;
  const route = (staticManifest?.routes || []).find(r => r.slug === staticSlug);
  const monthSel = document.getElementById('inputMonth');
  const monthLabel = monthSel?.selectedOptions?.[0]?.textContent || '';
  sub.textContent = route ? `${route.label.replace('→', ' → ')} · ${monthLabel} · 來回` : '';
}

// Rebuild the month <select> for the chosen route and load its newest month.
function selectStaticRoute(slug, saved) {
  staticSlug = slug;
  const route = (staticManifest?.routes || []).find(r => r.slug === slug);
  const monthSel = document.getElementById('inputMonth');
  monthSel.innerHTML = '';
  (route?.months || []).forEach(mo => {
    const opt = document.createElement('option');
    opt.value = `${mo.year}-${mo.month}`;      // getSearchParams parses "year-month"
    opt.textContent = mo.label;
    monthSel.appendChild(opt);
  });

  let chosen = route?.months?.[route.months.length - 1]; // default: newest month
  if (saved?.year && saved?.month) {
    const found = route?.months?.find(mo => mo.year === saved.year && mo.month === saved.month);
    if (found) chosen = found;
  }
  if (chosen) monthSel.value = `${chosen.year}-${chosen.month}`;

  saveSettings();
  updateSubtitle();
  loadData();
}

async function initStaticMode() {
  document.body.classList.add('static-mode');
  injectPasswordOverlay();

  // Remove scraping-only controls (no backend on GitHub Pages)
  document.querySelector('.btn-row')?.remove();
  document.querySelector('.settings-row--chips')?.remove();
  document.querySelector('.settings-row--sliders')?.remove();
  document.getElementById('inputOrigin')?.closest('.settings-field')?.remove();
  document.getElementById('inputDest')?.closest('.settings-field')?.remove();
  document.getElementById('inputYear')?.closest('.settings-field')?.remove();
  document.querySelector('.search-settings .arrow')?.remove();

  // Load the plaintext manifest (routes + months only — no prices)
  try {
    staticManifest = await (await fetch('data/manifest.json', { cache: 'no-store' })).json();
  } catch { staticManifest = { routes: [] }; }

  const routes = staticManifest.routes || [];
  const routeSel = document.getElementById('routeSwitcher');
  routeSel.innerHTML = '';

  if (routes.length === 0) {
    routeSel.innerHTML = '<option value="">（尚無資料）</option>';
    renderStaticEmpty(getSearchParams());
    return;
  }

  routes.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.slug;
    opt.textContent = r.label.replace('→', ' → ');
    routeSel.appendChild(opt);
  });

  routeSel.addEventListener('change', () => selectStaticRoute(routeSel.value));
  document.getElementById('inputMonth').addEventListener('change', () => {
    saveSettings(); updateSubtitle(); loadData();
  });

  const saved = loadSettings();
  const initial = routes.find(r => r.slug === saved?.slug) || routes[0];
  routeSel.value = initial.slug;
  selectStaticRoute(initial.slug, saved);
}
