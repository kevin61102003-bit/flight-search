const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  await page.goto('https://www.google.com/travel/flights?hl=zh-TW&curr=TWD', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await sleep(3000);

  // Click destination
  const destArea = await page.waitForSelector(
    '[data-placeholder*="要去哪裡"], [aria-label*="要去哪裡"], [placeholder*="要去哪裡"]',
    { timeout: 15000 }
  );
  await destArea.click();
  await sleep(800);
  await page.keyboard.type('釜山', { delay: 150 });

  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('[role="option"]')).some(
      el => el.textContent.includes('PUS') || el.textContent.includes('釜山')
    ),
    { timeout: 8000 }
  );

  const options = await page.$$('[role="option"]');
  for (const opt of options) {
    const text = await page.evaluate(el => el.textContent, opt);
    if (text.includes('PUS') || text.includes('金海') || text.includes('釜山')) {
      await opt.click();
      break;
    }
  }
  await sleep(2000);

  // Dump aria-labels containing date info
  const labels = await page.evaluate(() => {
    const result = [];
    for (const el of document.querySelectorAll('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') || '';
      if (lbl.includes('月') || lbl.includes('日') || lbl.includes('2026')) {
        result.push({
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          label: lbl.substring(0, 100),
        });
      }
    }
    return result.slice(0, 50);
  });

  console.log('=== Date-related aria-labels ===');
  console.log(JSON.stringify(labels, null, 2));

  // Also dump buttons to find next-month button
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')].map(b => ({
      label: b.getAttribute('aria-label') || '',
      text: b.textContent.trim().substring(0, 30),
    })).filter(b => b.label || b.text).slice(0, 30);
  });
  console.log('=== Buttons ===');
  console.log(JSON.stringify(btns, null, 2));

  await browser.close();
})();
