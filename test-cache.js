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
assert.strictEqual(count, 1, 'clear() should return exactly 1 entry from Oct');

// Test 6: corrupt JSON returns null
const corruptDir = path.join(process.env.CACHE_DIR_OVERRIDE, '2026-11');
fs.mkdirSync(corruptDir, { recursive: true });
fs.writeFileSync(path.join(corruptDir, 'corrupt_key.json'), '{not valid json}', 'utf8');
assert.strictEqual(cache.get('corrupt_key', 2026, 11), null, 'corrupt JSON should return null');

cleanup();
console.log('✅ All cache tests passed!');
