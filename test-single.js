const puppeteer = require('puppeteer');
const { scrapeSingle } = require('./scraper');

(async () => {
  const tests = [
    ['2026-08-31', '2026-09-05'],
    ['2026-08-31', '2026-09-06'],
    ['2026-08-31', '2026-09-07'],
    ['2026-09-05', '2026-09-10'],
  ];

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  });

  try {
    for (const [dep, ret] of tests) {
      const result = await scrapeSingle(dep, ret, browser);
      const isOneway = result.url && result.url.includes('CBwQAR');
      const isRoundtrip = result.url && result.url.includes('CBwQAh');
      const flag = isRoundtrip ? '✅' : isOneway ? '⚠️ ONEWAY' : '❓';
      console.log(`${flag} ${dep} → ${ret}: NT$${result.price} (${isRoundtrip ? 'round-trip' : isOneway ? 'ONE-WAY!' : 'unknown'})`);
    }
  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
