# ScrapIt 🕷️

Production-ready web scraper that bypasses anti-bot protection. Handles sites like JioMart, Amazon, Flipkart with ease.

## Features

- **Stealth Mode**: Bypasses common anti-bot detection (Cloudflare, Akamai, etc.)
- **Auto-Detection**: Automatically detects page type (product, listing, article)
- **E-commerce Ready**: Pre-configured selectors for major Indian e-commerce sites
- **Real-time Scraping**: WebSocket interception, API capture, DOM monitoring
- **Human Simulation**: Random delays, realistic scrolling, fingerprint rotation

## Installation

```bash
npm install
npx playwright install chromium
```

## Quick Start

```bash
# Scrape any URL
npm run scrapit https://www.jiomart.com/c/groceries/fruits-vegetables/fresh-vegetables/229

# Scrape a product page
npm run scrapit https://www.amazon.in/dp/B08N5WRWNW

# With browser visible (debugging)
npm run scrapit https://example.com --no-headless

# Scrape multiple pages
npm run scrapit https://jiomart.com/search/milk --pages 3

# Real-time monitoring
npm run scrapit monitor https://example.com/live -d 60000
```

## CLI Commands

### Basic Scrape
```bash
scrapit <url> [options]

Options:
  -m, --mode <mode>      Scraping mode: auto, generic, ecommerce, realtime (default: auto)
  -o, --output <dir>     Output directory (default: ./output)
  --no-headless          Run with browser visible
  -p, --proxy <url>      Proxy server URL
  --pages <num>          Max pages to scrape for listings (default: 1)
  --products <num>       Max products to scrape (default: 100)
  -v, --verbose          Verbose logging
  -q, --quiet            Minimal output
  --json                 Output only JSON
```

### Multi-URL Scrape
```bash
scrapit multi <url1> <url2> ... [options]
```

### Real-time Monitor
```bash
scrapit monitor <url> [options]

Options:
  -d, --duration <ms>    Monitor duration (default: 60000)
  -s, --selectors <list> CSS selectors to watch (comma-separated)
  -o, --output <file>    Save captured data to file
```

### Connection Test
```bash
scrapit test <url>
```

## Programmatic Usage

```javascript
const ScrapIt = require('./src');

// Quick scrape
const result = await ScrapIt.quick('https://jiomart.com/product/123');
console.log(result);

// With options
const agent = new ScrapIt({
  headless: true,
  proxy: 'http://proxy:8080',
  maxPages: 5,
  maxProducts: 200
});

const data = await agent.scrape('https://amazon.in/s?k=laptop');

// Real-time monitoring
await agent.monitor('https://example.com/live', {
  duration: 60000,
  selectors: ['.price', '.stock-count'],
  onData: (event) => console.log(event)
});
```

## Supported Sites

Pre-configured selectors for:
- JioMart
- Amazon India
- Flipkart
- Generic (auto-detects most sites)

## Anti-Bot Techniques

1. **Browser Fingerprinting**: Randomized user agents, viewports, timezones
2. **Stealth Scripts**: Hides automation indicators (webdriver, plugins)
3. **Human Behavior**: Random delays, realistic scrolling, mouse movements
4. **Request Headers**: Proper Accept, Sec-Fetch headers
5. **Canvas/WebGL Spoofing**: Prevents fingerprint tracking
6. **Tracking Blocker**: Blocks analytics and fingerprinting scripts

## Output

Results are saved as JSON in the output directory:

```json
{
  "url": "https://jiomart.com/...",
  "site": "JioMart",
  "pageType": "listing",
  "scrapedAt": "2024-01-15T10:30:00.000Z",
  "totalProducts": 24,
  "products": [
    {
      "title": "Fresh Tomato",
      "price": 40,
      "priceText": "₹40",
      "link": "https://...",
      "image": "https://..."
    }
  ]
}
```

## Troubleshooting

### Bot Detection
If you're getting blocked:
1. Try using a residential proxy: `--proxy http://user:pass@proxy:port`
2. Run with browser visible: `--no-headless`
3. Increase delays in `src/config/defaults.js`

### Timeout Errors
- Increase timeout in `src/config/defaults.js`
- Check if the site requires JavaScript execution

### Missing Data
- The site may need custom selectors
- Add site-specific config in `src/scrapers/ecommerceScraper.js`

## License

MIT
