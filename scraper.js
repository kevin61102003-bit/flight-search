const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const cache = require('./cache');

const DEBUG_DIR = path.join(__dirname, 'debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// opts: { origin, destination, originQuery, destinationQuery, outboundTimeRange, returnTimeRange, year, month }
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

  const routeKey = `${origin}_${destination}`;
  const cacheKey = `${routeKey}_${date}_${returnDate}`;
  const cached = cache.get(cacheKey, year, month);
  if (cached && cached.price) {
    console.log(`  [CACHE]  ${date} → ${returnDate}: NT$${cached.price}`);
    return cached;
  }

  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(USER_AGENT);
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    console.log(`  [SCRAPE] ${date} → ${returnDate} [${origin}→${destination}] (出發 ${outboundTimeRange.start}–${outboundTimeRange.end})...`);

    await page.goto('https://www.google.com/travel/flights?hl=zh-TW&curr=TWD', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sleep(2000);

    // Cookie consent
    try {
      await page.evaluate(() => {
        const btn = document.querySelector('form[action*="consent"] button:last-child');
        if (btn) btn.click();
      });
      await sleep(500);
    } catch (_) {}

    // === Fill origin (clear existing and type new) ===
    const ORIGIN_SEL = '[aria-label*="出發地"], [placeholder*="出發地"], [aria-label*="Where from"], [placeholder*="Where from"]';
    const origEl = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null;
    }, ORIGIN_SEL);
    if (origEl) {
      await page.mouse.click(origEl.x, origEl.y, { clickCount: 3 }); // triple-click to select all
      await sleep(300);
      await page.keyboard.type(originQuery, { delay: 80 });
      try {
        await page.waitForFunction(
          () => document.querySelectorAll('[role="option"]').length > 0,
          { timeout: 6000 }
        );
        const firstOptCoords = await page.evaluate(() => {
          const opt = document.querySelector('[role="option"]');
          if (!opt) return null;
          const r = opt.getBoundingClientRect();
          return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        });
        if (firstOptCoords) {
          await page.mouse.click(firstOptCoords.x, firstOptCoords.y);
          await sleep(500);
        }
      } catch (_) {}
    }

    // === Fill destination ===
    await page.waitForSelector(
      '[data-placeholder*="要去哪裡"], [aria-label*="要去哪裡"], [placeholder*="要去哪裡"]',
      { timeout: 15000 }
    );
    const destEl = await page.evaluate(() => {
      const el = document.querySelector('[data-placeholder*="要去哪裡"], [aria-label*="要去哪裡"], [placeholder*="要去哪裡"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null;
    });
    if (!destEl) throw new Error('Destination field not found');
    await page.mouse.click(destEl.x, destEl.y);
    await sleep(500);

    await page.keyboard.type(destinationQuery, { delay: 100 });
    await page.waitForFunction(
      (q) => Array.from(document.querySelectorAll('[role="option"]')).some(el => el.textContent.includes(q)),
      { timeout: 8000 },
      destinationQuery
    );

    const optCoords = await page.evaluate((q) => {
      const opt = Array.from(document.querySelectorAll('[role="option"]')).find(el => el.textContent.includes(q));
      if (!opt) return null;
      const r = opt.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    }, destinationQuery);
    if (!optCoords) throw new Error(`Autocomplete option not found for: ${destinationQuery}`);
    await page.mouse.click(optCoords.x, optCoords.y);
    await sleep(800);

    // === Open calendar ===
    // Always click departure input explicitly — don't rely on auto-open after destination selection
    const depCoords = await page.evaluate(() => {
      for (const el of document.querySelectorAll('input')) {
        const lbl = el.getAttribute('aria-label') || '';
        const ph = el.getAttribute('placeholder') || '';
        if (lbl === '去程' || ph === '去程' || lbl === 'Departure' || ph === 'Departure') {
          const r = el.getBoundingClientRect();
          if (r.width > 0) return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        }
      }
      return null;
    });
    if (!depCoords) throw new Error('Departure date field not found');

    await page.mouse.click(depCoords.x, depCoords.y);
    await sleep(700);

    // Check calendar opened (date cells have year+month in aria-label)
    const calOpen = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')].some(el => {
        const lbl = el.getAttribute('aria-label') || '';
        return lbl.includes('年') && lbl.includes('月') && (el.tagName === 'DIV' || el.tagName === 'TD');
      })
    );
    if (!calOpen) {
      await page.mouse.click(depCoords.x, depCoords.y);
      await sleep(800);
    }

    const calConfirmed = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')].some(el => {
        const lbl = el.getAttribute('aria-label') || '';
        return lbl.includes('年') && lbl.includes('月') && (el.tagName === 'DIV' || el.tagName === 'TD');
      })
    );
    if (!calConfirmed) throw new Error('Calendar failed to open');

    // === Select dates ===
    await selectCalendarDate(page, date);
    await sleep(1000);
    await selectCalendarDate(page, returnDate);
    await sleep(800);

    // === Close calendar ===
    // Find "完成" button using charCode comparison (avoids file encoding issues with CJK strings)
    const DONE_STR = String.fromCharCode(0x5B8C, 0x6210); // 完成
    const doneCoords = await page.evaluate((done) => {
      const btn = [...document.querySelectorAll('button')].find(b => {
        const txt = b.textContent.trim();
        const lbl = b.getAttribute('aria-label') || '';
        return txt.startsWith(done) || lbl.startsWith(done);
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    }, DONE_STR);

    if (doneCoords) {
      await page.mouse.click(doneCoords.x, doneCoords.y);
      await sleep(800);
    } else {
      // Fallback: calendar nav buttons ("下一頁") only exist when calendar is open
      const calStillOpen = await page.evaluate(() =>
        [...document.querySelectorAll('button')].some(b => {
          const lbl = b.getAttribute('aria-label') || '';
          const r = b.getBoundingClientRect();
          return (lbl === '下一頁' || lbl === 'Next page') && r.top > 0 && r.top < 700;
        })
      );
      if (calStillOpen) {
        await page.keyboard.press('Escape');
        await sleep(800);
      }
    }

    // === Search ===
    const searchCoords = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => {
        const lbl = b.getAttribute('aria-label') || '';
        const txt = b.textContent.trim();
        return lbl === '搜尋' || lbl === 'Search' || txt === '搜尋' || txt === 'Search';
      });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return r.width > 0 ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null;
    });
    if (!searchCoords) throw new Error('Search button not found');
    await page.mouse.click(searchCoords.x, searchCoords.y);

    // === Wait for results ===
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes('NT$') ||
               text.includes('最低價格') ||
               text.includes('最低票價') ||
               (text.includes('$') && (text.includes('航班') || text.includes('直達') || text.includes('班機')));
      },
      { timeout: 45000, polling: 1500 }
    );
    await sleep(1500);

    // === Click cheapest qualifying outbound → navigate to return selection ===
    const CHOOSE_STR = String.fromCharCode(0x9078, 0x64C7); // 選擇
    const outboundClicked = await clickCheapestOutbound(page, outMinHour, outMaxHour);
    if (outboundClicked) {
      await sleep(1500);

      // Some views show an expanded panel with a "選擇" button before showing return flights
      const chooseCoords = await page.evaluate((choose) => {
        const btn = [...document.querySelectorAll('button')].find(b => {
          const t = b.textContent.trim();
          return t === choose || t === 'Select';
        });
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return r.width > 0 ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null;
      }, CHOOSE_STR);

      if (chooseCoords) {
        await page.mouse.click(chooseCoords.x, chooseCoords.y);
        await sleep(1500);
      }

      // Wait for return flights page
      try {
        await page.waitForFunction(
          () => {
            const t = document.body.innerText;
            return t.includes('熱門回程') || t.includes('回程航班') || t.includes('選擇回程');
          },
          { timeout: 20000, polling: 1000 }
        );
        await sleep(1000);
        console.log(`  [NAV]    回程頁面已載入`);
      } catch (_) {
        console.log(`  [WARN]   回程頁面未偵測到，使用去程頁面價格`);
      }
    }

    const priceMinHour = outboundClicked ? retMinHour : outMinHour;
    const priceMaxHour = outboundClicked ? retMaxHour : outMaxHour;
    const price = await extractPrice(page, priceMinHour, priceMaxHour);

    if (!price) {
      await page.screenshot({ path: path.join(DEBUG_DIR, `debug_${date}_${returnDate}.png`) });
      console.log(`  [FAIL]   ${date} → ${returnDate}: No price found`);
    } else {
      console.log(`  [OK]     ${date} → ${returnDate}: NT$${price}`);
    }

    const result = { date, returnDate, price: price || null, currency: 'TWD', route: `${origin} → ${destination}`, url: page.url() };
    cache.set(cacheKey, result, year, month);
    return result;

  } catch (err) {
    console.error(`  [ERROR]  ${date} → ${returnDate}: ${err.message}`);
    if (page) {
      try { await page.screenshot({ path: path.join(DEBUG_DIR, `error_${date}_${returnDate}.png`) }); } catch (_) {}
    }
    const result = { date, returnDate, price: null, currency: 'TWD', route: `${origin} → ${destination}`, error: err.message, url: '' };
    cache.set(cacheKey, result, year, month);
    return result;
  } finally {
    if (page) await page.close();
  }
}

async function selectCalendarDate(page, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const zhLabel = `${year}年${month}月${day}日`;

  for (let attempt = 0; attempt < 12; attempt++) {
    // Find the calendar date cell — aria-label format: "2026年9月5日 星期六"
    // Include "星期" filter to avoid matching flight suggestion cards at bottom of page
    const info = await page.evaluate(({ label, iso }) => {
      const calCell = Array.from(document.querySelectorAll('[aria-label]')).find(el => {
        const lbl = el.getAttribute('aria-label') || '';
        return lbl.startsWith(label) && lbl.includes('星期'); // 星期
      });
      const el = calCell || document.querySelector(`[data-date="${iso}"]`) || document.querySelector(`[data-iso="${iso}"]`);
      if (!el) return { found: false, reason: 'cell not in DOM' };
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return { found: false, reason: 'cell zero-size' };

      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      if (cx < 1 || cx >= 1440 || cy < 1 || cy >= 900) {
        return { found: false, reason: `out of viewport (${cx},${cy})` };
      }

      // Verify the click would land on this cell (or its near ancestor), not a covering element.
      // Google Flights renders future months off-screen but with valid bounding rects — clicking
      // at those coordinates hits whatever is visually on top (e.g., C-WIZ), not the calendar cell.
      const hitEl = document.elementFromPoint(cx, cy);
      let isCalCell = false;
      let p = el;
      for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
        if (p === hitEl) { isCalCell = true; break; }
      }
      if (!isCalCell) {
        return { found: false, reason: `obscured by ${hitEl ? hitEl.tagName : 'null'}` };
      }

      return { found: true, x: cx, y: cy };
    }, { label: zhLabel, iso: dateStr });

    if (info.found && info.x > 0 && info.x < 1380 && info.y > 50) {
      await page.mouse.click(info.x, info.y);
      await sleep(400);
      return;
    }

    if (info.reason) console.log(`  [CAL]    ${dateStr} attempt ${attempt}: ${info.reason} — navigating`);

    // Navigate forward — calendar "下一頁" button is in upper area (y < 700); bottom carousels also use this label
    const navCoords = await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        const lbl = btn.getAttribute('aria-label') || '';
        if (lbl === '下一頁' || lbl === 'Next page') { // 下一頁
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.top > 0 && r.top < 700) {
            return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
          }
        }
      }
      return null;
    });

    if (navCoords) {
      await page.mouse.click(navCoords.x, navCoords.y);
      await sleep(600);
    } else {
      console.log(`  [CAL]    ${dateStr}: no nav button — calendar may be closed`);
      break;
    }
  }
  console.warn(`  [WARN]   Could not select date ${dateStr}`);
}

async function clickCheapestOutbound(page, minHour, maxHour) {
  const coords = await page.evaluate((minH, maxH) => {
    function parseHour(str) {
      const m = str.match(/(\d{1,2}):(\d{2})/);
      if (!m) return -1;
      let h = parseInt(m[1]);
      if (h < 12 && (str.includes('下午') || str.includes('晚上') || /\bpm\b/i.test(str))) h += 12;
      if (h === 12 && (str.includes('凌晨') || str.includes('清晨') || str.includes('上午') || /\bam\b/i.test(str))) h = 0;
      return h;
    }
    const timeLineRe = /^(?:凌晨|清晨|上午|中午|下午|晚上)?\d{1,2}:\d{2}/;
    const seen = new Set();
    const candidates = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!timeLineRe.test(text)) continue;
      const h = parseHour(text);
      if (h < minH || h > maxH) continue;

      // Walk up to find the flight card container (~50-250px tall, contains 來回票價)
      let el = node.parentElement;
      for (let d = 0; d < 12 && el; d++, el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (r.height < 50 || r.height > 250) continue;
        const inner = el.innerText || '';
        if (!inner.includes('來回票價')) continue;
        const pm = inner.match(/\$\s*([\d,]{4,})/);
        if (!pm) continue;
        const val = parseInt(pm[1].replace(/,/g, ''), 10);
        if (val < 3000 || val > 200000) continue;
        const cy = Math.round(r.top + r.height / 2);
        if (seen.has(cy)) break;
        seen.add(cy);
        if (r.top > 50 && r.top < 850) {
          candidates.push({ price: val, x: Math.round(r.left + r.width / 2), y: cy });
        }
        break;
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.price - b.price);
    return { x: candidates[0].x, y: candidates[0].y };
  }, minHour, maxHour);

  if (!coords) return false;
  await page.mouse.click(coords.x, coords.y);
  return true;
}

async function extractPrice(page, minHour = 6, maxHour = 23) {
  const strategies = [
    // Strategy 0: time-filtered — parse each flight card, keep only departures in minHour–maxHour
    // Google Flights zh-TW time prefixes: 凌晨(0-5) 清晨(6-7) 上午(8-11) 中午(12) 下午(12-18) 晚上(19-23)
    async () => page.evaluate((minH, maxH) => {
      function parseHour(str) {
        const m = str.match(/(\d{1,2}):(\d{2})/);
        if (!m) return -1;
        let h = parseInt(m[1]);
        // 下午/晚上/PM → add 12 if not already afternoon
        if (h < 12 && (str.includes('下午') || str.includes('晚上') || /\bpm\b/i.test(str))) h += 12;
        // 凌晨/清晨/上午/AM → 12:xx means 0:xx
        if (h === 12 && (str.includes('凌晨') || str.includes('清晨') || str.includes('上午') || /\bam\b/i.test(str))) h = 0;
        return h;
      }

      // Match lines starting with any Chinese time prefix or bare HH:MM
      const timeLineRe = /^(?:凌晨|清晨|上午|中午|下午|晚上)?\d{1,2}:\d{2}/;
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
      const prices = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!timeLineRe.test(line)) continue;
        const depHour = parseHour(line);
        if (depHour < 0 || depHour < minH || depHour > maxH) continue;

        // Scan up to 12 lines ahead for the price of this flight card
        for (let j = i + 1; j < Math.min(i + 13, lines.length); j++) {
          // Stop if we hit another departure time (next card started)
          if (timeLineRe.test(lines[j])) break;
          const pm = lines[j].match(/\$\s*([\d,]{4,})/);
          if (pm) {
            const val = parseInt(pm[1].replace(/,/g, ''), 10);
            if (val >= 3000 && val <= 200000) { prices.push(val); break; }
          }
        }
      }

      return prices.length > 0 ? Math.min(...prices) : null;
    }, minHour, maxHour),

    // Strategy 1: "最低價格 $X,XXX 起" label — page-level minimum (no time filter, fallback only)
    async () => page.evaluate(() => {
      const text = document.body.innerText;
      // Match "最低價格 $5,322 起" or "最低票價 $5,322"
      const m = text.match(/最低(?:價格|票價)[^$\d]*\$\s*([0-9,]{4,})/);
      if (m) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (val >= 3000 && val <= 200000) return val;
      }
      return null;
    }),

    // Strategy 2: flight rows with "來回票價" label — actual per-itinerary prices
    async () => page.evaluate(() => {
      const prices = [];
      const re = /\$\s*([0-9,]{4,})[^\n]*來回票價/g;
      const text = document.body.innerText;
      let m;
      while ((m = re.exec(text)) !== null) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (val >= 3000 && val <= 200000) prices.push(val);
      }
      return prices.length > 0 ? Math.min(...prices) : null;
    }),

    // Strategy 3: text node walker — standalone price text nodes like "$5,322"
    async () => page.evaluate(() => {
      const prices = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        const m = text.match(/^(?:NT)?\$\s*([0-9,]{4,})$/);
        if (m) {
          const val = parseInt(m[1].replace(/,/g, ''), 10);
          // Minimum 3000 to exclude "savings" amounts like $3,791
          if (val >= 3000 && val <= 200000) prices.push(val);
        }
      }
      return prices.length > 0 ? Math.min(...prices) : null;
    }),

    // Strategy 4: aria-label scan
    async () => page.evaluate(() => {
      const prices = [];
      for (const el of document.querySelectorAll('*')) {
        const label = el.getAttribute('aria-label') || '';
        const m = label.match(/(?:NT)?\$\s*([0-9,]{4,})/);
        if (m) {
          const val = parseInt(m[1].replace(/,/g, ''), 10);
          if (val >= 3000 && val <= 200000) prices.push(val);
        }
      }
      return prices.length > 0 ? Math.min(...prices) : null;
    }),
  ];

  for (const strategy of strategies) {
    try {
      const price = await strategy();
      if (price && price > 0) return price;
    } catch (_) {}
  }
  return null;
}

const CONCURRENCY = 2; // parallel workers (increase carefully — Google may rate-limit)

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

  const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1440,900',
  ];

  let completed = 0;
  const allResults = [];

  // Each worker gets its own isolated browser — prevents Google session state sharing
  const workers = Array.from({ length: CONCURRENCY }, (_, i) =>
    sleep(i * 4000).then(async () => {
      const browser = await puppeteer.launch({ headless: 'new', args: BROWSER_ARGS });
      try {
        while (queue.length > 0) {
          const pair = queue.shift();
          if (!pair) break;
          const result = await scrapeSingle(pair.date, pair.returnDate, browser, opts);
          allResults.push(result);
          completed++;
          const pct = Math.round((completed / totalQueries) * 100);
          console.log(`   進度: ${completed}/${totalQueries} (${pct}%)\n`);
          await sleep(1000);
        }
      } finally {
        await browser.close();
      }
    })
  );

  await Promise.all(workers);
  return allResults;
}

function generateDates(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(new Date(year, month - 1, d).toISOString().split('T')[0]);
  }
  return dates;
}

module.exports = { scrapeAll, scrapeSingle, generateDates };
