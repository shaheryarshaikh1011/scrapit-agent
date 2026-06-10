const fs = require('fs');
const path = require('path');

/**
 * Random delay to mimic human behavior
 */
function randomDelay(min = 1000, max = 3000) {
  return new Promise(resolve => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, delay);
  });
}

/**
 * Get random item from array
 */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Save JSON data to file
 */
function saveJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Generate timestamp string
 */
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Clean text - remove extra whitespace
 */
function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parse price string to number
 */
function parsePrice(priceStr) {
  if (!priceStr) return null;
  // Extract all digit sequences and dots
  const matches = priceStr.match(/[\d,]+\.?\d*/g);
  if (!matches) return null;
  // Take the first valid number found
  for (const match of matches) {
    const cleaned = match.replace(/,/g, '');
    const price = parseFloat(cleaned);
    if (!isNaN(price) && price > 0) return price;
  }
  return null;
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

/**
 * Sleep with jitter
 */
async function sleepWithJitter(baseMs, jitterPercent = 0.3) {
  const jitter = baseMs * jitterPercent * (Math.random() - 0.5) * 2;
  await new Promise(r => setTimeout(r, baseMs + jitter));
}

module.exports = {
  randomDelay,
  randomChoice,
  ensureDir,
  saveJson,
  timestamp,
  cleanText,
  parsePrice,
  extractDomain,
  sleepWithJitter
};
