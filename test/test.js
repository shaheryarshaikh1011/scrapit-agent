/**
 * Basic tests for ScrapIt
 */

const ScrapIt = require('../src');
const GenericScraper = require('../src/scrapers/genericScraper');
const EcommerceScraper = require('../src/scrapers/ecommerceScraper');
const { cleanText, parsePrice, extractDomain } = require('../src/utils/helpers');

console.log('🧪 Running ScrapIt Tests\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`${message} Expected truthy value, got ${value}`);
  }
}

// Helper tests
console.log('--- Helper Functions ---');

test('cleanText removes extra whitespace', () => {
  assertEqual(cleanText('  hello   world  '), 'hello world');
});

test('cleanText handles null', () => {
  assertEqual(cleanText(null), '');
});

test('parsePrice extracts number from string', () => {
  assertEqual(parsePrice('₹1,299'), 1299);
});

test('parsePrice handles different formats', () => {
  assertEqual(parsePrice('$99.99'), 99.99);
  assertEqual(parsePrice('Rs. 500'), 500);
});

test('parsePrice returns null for invalid', () => {
  assertEqual(parsePrice('free'), null);
});

test('extractDomain works correctly', () => {
  assertEqual(extractDomain('https://www.jiomart.com/path'), 'jiomart.com');
  assertEqual(extractDomain('https://amazon.in/dp/123'), 'amazon.in');
});

// E-commerce site detection
console.log('\n--- E-commerce Detection ---');

test('detects JioMart domain', () => {
  const agent = new ScrapIt();
  assertTrue(agent.isEcommerceSite('jiomart.com'));
});

test('detects Amazon domain', () => {
  const agent = new ScrapIt();
  assertTrue(agent.isEcommerceSite('amazon.in'));
});

test('detects Flipkart domain', () => {
  const agent = new ScrapIt();
  assertTrue(agent.isEcommerceSite('flipkart.com'));
});

test('returns false for non-ecommerce', () => {
  const agent = new ScrapIt();
  assertEqual(agent.isEcommerceSite('wikipedia.org'), false);
});

// Site config tests
console.log('\n--- Site Configurations ---');

test('has JioMart config', () => {
  assertTrue(EcommerceScraper.SITE_CONFIGS['jiomart.com']);
});

test('has Amazon config', () => {
  assertTrue(EcommerceScraper.SITE_CONFIGS['amazon.in']);
});

test('has Flipkart config', () => {
  assertTrue(EcommerceScraper.SITE_CONFIGS['flipkart.com']);
});

test('has default config', () => {
  assertTrue(EcommerceScraper.SITE_CONFIGS['default']);
});

test('JioMart config has required selectors', () => {
  const config = EcommerceScraper.SITE_CONFIGS['jiomart.com'];
  assertTrue(config.product.title);
  assertTrue(config.product.price);
  assertTrue(config.listing.container);
});

// ScrapIt initialization
console.log('\n--- ScrapIt Initialization ---');

test('creates instance with defaults', () => {
  const agent = new ScrapIt();
  assertTrue(agent.options.headless);
  assertEqual(agent.options.mode, 'auto');
});

test('accepts custom options', () => {
  const agent = new ScrapIt({ 
    headless: false, 
    mode: 'ecommerce',
    maxPages: 5 
  });
  assertEqual(agent.options.headless, false);
  assertEqual(agent.options.mode, 'ecommerce');
  assertEqual(agent.options.maxPages, 5);
});

// Summary
console.log('\n' + '='.repeat(40));
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('='.repeat(40));

process.exit(failed > 0 ? 1 : 0);
