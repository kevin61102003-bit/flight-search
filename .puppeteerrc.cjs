/**
 * Redirect Puppeteer cache to E:\ (keep C:\ clean)
 */
const { join } = require('path');

/** @type {import("puppeteer").Configuration} */
module.exports = {
  cacheDirectory: join('E:\\', '.cache', 'puppeteer'),
};
