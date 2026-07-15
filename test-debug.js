const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEBUG_DIR = require('path').join(__dirname, 'debug');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  await page.goto('https://www.google.com/travel/flights?hl=zh-TW&curr=TWD', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  // Fill destination
  const destEl = await page.evaluate(() => {
    const el = document.querySelector('[data-placeholder*="要去哪裡"], [aria-label*="要去哪裡"], [placeholder*="要去哪裡"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  });
  await page.mouse.click(destEl.x, destEl.y);
  await sleep(500);
  await page.keyboard.type('釜山', { delay: 100 });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('[role="option"]')).some(el => el.textContent.includes('PUS') || el.textContent.includes('釜山')),
    { timeout: 8000 }
  );
  const optCoords = await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find(el => el.textContent.includes('PUS') || el.textContent.includes('釜山'));
    const r = opt.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  });
  await page.mouse.click(optCoords.x, optCoords.y);
  await sleep(800);

  // Check current trip type
  const tripType = await page.evaluate(() => {
    const btn = document.querySelector('[data-value="1"], [aria-label*="來回"], [aria-label*="Round trip"]');
    if (btn) return btn.textContent.trim().substring(0, 10);
    // Look for trip type in a different way
    const allBtns = Array.from(document.querySelectorAll('button, [role="radio"], [role="option"]'));
    const found = allBtns.find(b => b.textContent.includes('來回') || b.textContent.includes('Round trip'));
    return found ? found.textContent.trim().substring(0, 20) : 'not found';
  });
  console.log('Current trip type selector text:', tripType);

  // Open departure calendar
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
  console.log('Departure field coords:', depCoords);
  await page.mouse.click(depCoords.x, depCoords.y);
  await sleep(700);

  await page.screenshot({ path: `${DEBUG_DIR}/step1_cal_opened.png` });
  console.log('Screenshot: step1_cal_opened.png');

  // What months are visible?
  const months = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('h2, [role="heading"]'))
      .filter(h => h.textContent.includes('年') && h.textContent.includes('月'));
    return headers.map(h => h.textContent.trim());
  });
  console.log('Visible months:', months);

  // Click Aug 31
  const aug31 = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[aria-label]')).find(el => {
      const lbl = el.getAttribute('aria-label') || '';
      return lbl.startsWith('2026年8月31日') && lbl.includes('星期');
    });
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), label: el.getAttribute('aria-label') };
  });
  console.log('August 31 cell:', aug31);

  if (!aug31.found) { console.log('August 31 NOT FOUND'); await browser.close(); return; }
  await page.mouse.click(aug31.x, aug31.y);
  await sleep(300);
  await page.screenshot({ path: `${DEBUG_DIR}/step2_after_aug31.png` });
  console.log('Screenshot: step2_after_aug31.png (immediately after click)');

  await sleep(1000);
  await page.screenshot({ path: `${DEBUG_DIR}/step3_after_aug31_1s.png` });
  console.log('Screenshot: step3_after_aug31_1s.png (1s after click)');

  // What months visible now?
  const months2 = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('h2, [role="heading"]'))
      .filter(h => h.textContent.includes('年') && h.textContent.includes('月'));
    return headers.map(h => h.textContent.trim());
  });
  console.log('Visible months after Aug 31 click:', months2);

  // Is September 6 visible?
  const sep6 = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[aria-label]')).find(el => {
      const lbl = el.getAttribute('aria-label') || '';
      return lbl.startsWith('2026年9月6日') && lbl.includes('星期');
    });
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), label: el.getAttribute('aria-label'), w: r.width, h: r.height };
  });
  console.log('September 6 cell:', sep6);

  // Is the calendar still open?
  const calStillOpen = await page.evaluate(() => {
    const navBtns = Array.from(document.querySelectorAll('button')).filter(b => {
      const lbl = b.getAttribute('aria-label') || '';
      const r = b.getBoundingClientRect();
      return (lbl === '下一頁' || lbl === 'Next page') && r.top > 0 && r.top < 700;
    });
    return navBtns.length > 0;
  });
  console.log('Calendar still open (nav button present):', calStillOpen);

  if (sep6.found && sep6.x < 1380) {
    console.log('Clicking September 6 at', sep6.x, sep6.y);
    // What's actually AT this position?
    const elementAtPos = await page.evaluate((x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return 'null';
      return {
        tag: el.tagName,
        aria: el.getAttribute('aria-label') || '',
        role: el.getAttribute('role') || '',
        text: el.textContent.trim().substring(0, 30),
      };
    }, sep6.x, sep6.y);
    console.log('Element ACTUALLY at click position:', elementAtPos);

    await page.mouse.click(sep6.x, sep6.y);
    await sleep(500);
    await page.screenshot({ path: `${DEBUG_DIR}/step4_after_sep6.png` });
    console.log('Screenshot: step4_after_sep6.png');
  }

  // Done button
  const DONE_STR = String.fromCharCode(0x5B8C, 0x6210);
  const doneCoords = await page.evaluate((done) => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(done));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return r.width > 0 ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null;
  }, DONE_STR);
  console.log('Done button coords:', doneCoords);

  if (doneCoords) {
    await page.mouse.click(doneCoords.x, doneCoords.y);
    await sleep(800);
  }

  // Check return date field value
  const retDateVal = await page.evaluate(() => {
    for (const el of document.querySelectorAll('input')) {
      const lbl = el.getAttribute('aria-label') || '';
      const ph = el.getAttribute('placeholder') || '';
      if (lbl === '回程' || ph === '回程' || lbl === 'Return' || ph === 'Return') {
        return { label: lbl, value: el.value, ariaValueText: el.getAttribute('aria-valuetext') };
      }
    }
    return null;
  });
  console.log('Return date field value:', retDateVal);

  await page.screenshot({ path: `${DEBUG_DIR}/step5_final_form.png` });
  console.log('Screenshot: step5_final_form.png');

  await browser.close();
  console.log('\nDone. Check debug/ screenshots.');
})();
