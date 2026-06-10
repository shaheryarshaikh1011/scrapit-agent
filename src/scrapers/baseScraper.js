const BrowserManager = require('../browser/manager');
const { cleanText, parsePrice, timestamp, saveJson, ensureDir } = require('../utils/helpers');
const logger = require('../utils/logger');
const config = require('../config/defaults');
const path = require('path');

/**
 * Base scraper class with common functionality
 */
class BaseScraper {
  constructor(options = {}) {
    this.browser = null;
    this.options = {
      headless: options.headless ?? true,
      proxy: options.proxy || null,
      output: options.output || config.OUTPUT_DIR,
      screenshotOnError: options.screenshotOnError ?? config.SCREENSHOT_ON_ERROR
    };
    this.results = [];
  }

  /**
   * Initialize browser
   */
  async init() {
    this.browser = new BrowserManager({
      headless: this.options.headless,
      proxy: this.options.proxy
    });
    await this.browser.launch();
  }

  /**
   * Navigate to URL
   */
  async goto(url, options = {}) {
    return await this.browser.goto(url, options);
  }

  /**
   * Get page reference
   */
  get page() {
    return this.browser.page;
  }

  /**
   * Extract text from selector
   */
  async getText(selector, defaultValue = '') {
    try {
      const element = this.page.locator(selector).first();
      const text = await element.textContent({ timeout: 5000 });
      return cleanText(text);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Extract multiple texts from selector
   */
  async getAllTexts(selector) {
    try {
      const elements = this.page.locator(selector);
      const count = await elements.count();
      const texts = [];
      
      for (let i = 0; i < count; i++) {
        const text = await elements.nth(i).textContent();
        texts.push(cleanText(text));
      }
      
      return texts;
    } catch {
      return [];
    }
  }

  /**
   * Extract attribute from selector
   */
  async getAttribute(selector, attribute, defaultValue = '') {
    try {
      const element = this.page.locator(selector).first();
      return await element.getAttribute(attribute, { timeout: 5000 }) || defaultValue;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Extract href from link
   */
  async getHref(selector) {
    return await this.getAttribute(selector, 'href');
  }

  /**
   * Extract image src
   */
  async getImageSrc(selector) {
    const src = await this.getAttribute(selector, 'src');
    if (!src) {
      return await this.getAttribute(selector, 'data-src');
    }
    return src;
  }

  /**
   * Extract price from selector
   */
  async getPrice(selector) {
    const text = await this.getText(selector);
    return parsePrice(text);
  }

  /**
   * Check if element exists
   */
  async exists(selector) {
    try {
      const count = await this.page.locator(selector).count();
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Wait for selector
   */
  async waitFor(selector, timeout = config.ELEMENT_TIMEOUT) {
    try {
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click element
   */
  async click(selector) {
    try {
      await this.page.locator(selector).first().click();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Type into input
   */
  async type(selector, text, options = {}) {
    try {
      const element = this.page.locator(selector).first();
      await element.fill(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate(fn, ...args) {
    return await this.page.evaluate(fn, ...args);
  }

  /**
   * Add result to collection
   */
  addResult(data) {
    this.results.push({
      ...data,
      scrapedAt: new Date().toISOString()
    });
  }

  /**
   * Save results to JSON
   */
  saveResults(filename) {
    const filePath = path.join(this.options.output, filename || `scrape-${timestamp()}.json`);
    saveJson(filePath, this.results);
    logger.success(`Results saved: ${filePath}`);
    return filePath;
  }

  /**
   * Handle errors with optional screenshot
   */
  async handleError(error, context = '') {
    logger.error(`${context}: ${error.message}`);
    
    if (this.options.screenshotOnError && this.browser?.page) {
      try {
        ensureDir(this.options.output);
        const screenshotPath = path.join(
          this.options.output, 
          `error-${timestamp()}.png`
        );
        await this.browser.screenshot(screenshotPath);
      } catch {
        // Ignore screenshot errors
      }
    }
  }

  /**
   * Cleanup
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Abstract method - implement in subclass
   */
  async scrape(url) {
    throw new Error('scrape() must be implemented in subclass');
  }
}

module.exports = BaseScraper;
