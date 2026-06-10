const GenericScraper = require('./scrapers/genericScraper');
const EcommerceScraper = require('./scrapers/ecommerceScraper');
const RealtimeScraper = require('./scrapers/realtimeScraper');
const BrowserManager = require('./browser/manager');
const logger = require('./utils/logger');
const { extractDomain, saveJson, timestamp } = require('./utils/helpers');
const config = require('./config/defaults');
const path = require('path');

/**
 * Main ScrapIt Agent
 * Automatically selects best scraping strategy
 */
class ScrapIt {
  constructor(options = {}) {
    this.options = {
      headless: options.headless ?? true,
      proxy: options.proxy || null,
      output: options.output || config.OUTPUT_DIR,
      mode: options.mode || 'auto', // auto, generic, ecommerce, realtime
      maxPages: options.maxPages || 1,
      maxProducts: options.maxProducts || 100,
      location: options.location || '400001', // Default Mumbai pincode for sites like JioMart
      realtime: options.realtime || false,
      duration: options.duration || 30000,
      selectors: options.selectors || []
    };
  }

  /**
   * Main scrape method
   */
  async scrape(url) {
    logger.banner('SCRAPIT Agent');
    logger.info(`Target: ${url}`);
    logger.info(`Mode: ${this.options.mode}`);

    const domain = extractDomain(url);
    let scraper;
    let result;

    try {
      // Select scraping strategy
      if (this.options.realtime || this.options.mode === 'realtime') {
        logger.info('Using: Realtime Scraper');
        scraper = new RealtimeScraper(this.options);
        result = await scraper.scrape(url, {
          duration: this.options.duration,
          selectors: this.options.selectors
        });
      } else if (this.options.mode === 'ecommerce' || this.isEcommerceSite(domain)) {
        logger.info('Using: E-commerce Scraper');
        scraper = new EcommerceScraper(this.options);
        result = await scraper.scrape(url, {
          maxPages: this.options.maxPages,
          maxProducts: this.options.maxProducts,
          location: this.options.location
        });
      } else {
        logger.info('Using: Generic Scraper');
        scraper = new GenericScraper(this.options);
        result = await scraper.scrape(url);
      }

      // Save results
      const outputFile = path.join(
        this.options.output,
        `${domain}-${timestamp()}.json`
      );
      saveJson(outputFile, result);
      
      logger.success(`Scraping complete!`);
      logger.info(`Results saved: ${outputFile}`);

      return result;

    } catch (error) {
      logger.error(`Scraping failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if domain is known e-commerce site
   */
  isEcommerceSite(domain) {
    const ecommerceDomains = [
      'amazon', 'flipkart', 'jiomart', 'myntra', 'ajio',
      'snapdeal', 'meesho', 'tatacliq', 'nykaa', 'bigbasket',
      'ebay', 'walmart', 'target', 'bestbuy', 'etsy',
      'aliexpress', 'alibaba', 'shopify', 'woocommerce'
    ];
    
    return ecommerceDomains.some(e => domain.includes(e));
  }

  /**
   * Quick scrape - returns just the data
   */
  static async quick(url, options = {}) {
    const agent = new ScrapIt(options);
    return await agent.scrape(url);
  }

  /**
   * Scrape multiple URLs
   */
  async scrapeMultiple(urls) {
    const results = [];
    
    for (let i = 0; i < urls.length; i++) {
      logger.step(i + 1, urls.length, `Scraping ${urls[i]}`);
      try {
        const result = await this.scrape(urls[i]);
        results.push(result);
      } catch (error) {
        results.push({
          url: urls[i],
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Monitor URL for changes (realtime mode)
   */
  async monitor(url, options = {}) {
    const {
      duration = 60000,
      selectors = [],
      onData = console.log
    } = options;

    logger.banner('SCRAPIT Monitor');
    logger.info(`Monitoring: ${url}`);

    const scraper = new RealtimeScraper(this.options);
    
    await scraper.stream(url, {
      duration,
      selectors,
      onWebsocket: (data) => {
        logger.debug('WebSocket:', JSON.stringify(data).substring(0, 100));
        onData({ type: 'websocket', ...data });
      },
      onApi: (data) => {
        logger.debug('API:', data.url);
        onData({ type: 'api', ...data });
      },
      onDomChange: (data) => {
        logger.debug('DOM:', data.selector);
        onData({ type: 'dom', ...data });
      }
    });
  }
}

// Export everything
module.exports = ScrapIt;
module.exports.ScrapIt = ScrapIt;
module.exports.GenericScraper = GenericScraper;
module.exports.EcommerceScraper = EcommerceScraper;
module.exports.RealtimeScraper = RealtimeScraper;
module.exports.BrowserManager = BrowserManager;
