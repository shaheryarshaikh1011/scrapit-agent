const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const FingerprintGenerator = require('./fingerprint');
const { applyStealthToPage, configureStealthContext } = require('./stealth');
const { randomDelay, sleepWithJitter } = require('../utils/helpers');
const logger = require('../utils/logger');
const config = require('../config/defaults');

// Apply stealth plugin
chromium.use(stealth());

/**
 * Browser manager with anti-detection capabilities
 */
class BrowserManager {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.fingerprint = new FingerprintGenerator();
    this.options = {
      headless: options.headless ?? config.HEADLESS,
      proxy: options.proxy || null,
      timeout: options.timeout || config.NAVIGATION_TIMEOUT
    };
  }

  /**
   * Launch browser with stealth settings
   */
  async launch() {
    logger.info('Launching stealth browser...');
    
    const launchOptions = {
      headless: this.options.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
        '--start-maximized',
        '--disable-web-security',
        '--disable-features=CrossSiteDocumentBlockingIfIsolating',
        '--disable-site-isolation-trials',
        '--ignore-certificate-errors'
      ]
    };

    if (this.options.proxy) {
      launchOptions.proxy = { server: this.options.proxy };
    }

    this.browser = await chromium.launch(launchOptions);
    
    // Create context with fingerprint
    const contextOptions = this.fingerprint.getContextOptions();
    
    // Set default geolocation to Mumbai for sites that need location
    contextOptions.geolocation = { latitude: 19.0760, longitude: 72.8777 }; // Mumbai
    contextOptions.permissions = ['geolocation'];
    
    this.context = await this.browser.newContext(contextOptions);
    
    // Apply stealth to context
    await configureStealthContext(this.context);
    
    // Create page
    this.page = await this.context.newPage();
    
    // Apply stealth scripts
    await applyStealthToPage(this.page);
    
    // Set timeouts
    this.page.setDefaultTimeout(this.options.timeout);
    this.page.setDefaultNavigationTimeout(this.options.timeout);
    
    logger.success('Browser launched with stealth mode');
    return this.page;
  }

  /**
   * Navigate to URL with human-like behavior
   */
  async goto(url, options = {}) {
    const {
      waitUntil = 'domcontentloaded',
      waitForSelector = null,
      humanize = true
    } = options;

    logger.info(`Navigating to: ${url}`);
    
    try {
      // Add random delay before navigation
      if (humanize) {
        await randomDelay(500, 1500);
      }

      const response = await this.page.goto(url, {
        waitUntil,
        timeout: this.options.timeout
      });

      // Wait for page to settle
      await sleepWithJitter(2000);

      // Wait for additional selector if specified (with fallback)
      if (waitForSelector) {
        try {
          await this.page.waitForSelector(waitForSelector, {
            timeout: 10000
          });
        } catch {
          logger.warn(`Selector ${waitForSelector} not found, continuing anyway`);
        }
      }

      // Human-like scroll after page load
      if (humanize) {
        await this.humanScroll();
      }

      // Check for bot detection pages
      await this.handleBotDetection();

      return response;
    } catch (error) {
      logger.error(`Navigation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle common bot detection challenges
   */
  async handleBotDetection() {
    const pageContent = await this.page.content();
    const title = await this.page.title();
    
    // Common bot detection indicators
    const botIndicators = [
      'captcha',
      'robot',
      'blocked',
      'access denied',
      'unusual traffic',
      'verify you are human',
      'please wait',
      'checking your browser',
      'ddos protection'
    ];

    const detected = botIndicators.some(indicator => 
      pageContent.toLowerCase().includes(indicator) ||
      title.toLowerCase().includes(indicator)
    );

    if (detected) {
      logger.warn('Possible bot detection page detected');
      
      // Wait and let any JavaScript challenges complete
      await sleepWithJitter(5000);
      
      // Try clicking any "I'm not a robot" buttons
      const buttonSelectors = [
        'button:has-text("continue")',
        'button:has-text("verify")',
        'input[type="submit"]',
        '#challenge-running'
      ];

      for (const selector of buttonSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 })) {
            await button.click();
            await sleepWithJitter(3000);
            break;
          }
        } catch {
          // Button not found, continue
        }
      }
    }
  }

  /**
   * Human-like scrolling behavior
   */
  async humanScroll() {
    const scrolls = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < scrolls; i++) {
      const scrollAmount = Math.floor(Math.random() * 300) + 100;
      await this.page.mouse.wheel(0, scrollAmount);
      await sleepWithJitter(config.SCROLL_DELAY);
    }
  }

  /**
   * Scroll to bottom of page (for infinite scroll)
   */
  async scrollToBottom(maxScrolls = 10) {
    let previousHeight = 0;
    let scrollCount = 0;

    while (scrollCount < maxScrolls) {
      const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
      
      if (currentHeight === previousHeight) {
        break;
      }

      previousHeight = currentHeight;
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleepWithJitter(1500);
      scrollCount++;
    }

    logger.debug(`Scrolled ${scrollCount} times`);
  }

  /**
   * Take screenshot
   */
  async screenshot(path) {
    await this.page.screenshot({ path, fullPage: true });
    logger.info(`Screenshot saved: ${path}`);
  }

  /**
   * Get page HTML
   */
  async getHtml() {
    return await this.page.content();
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }
}

module.exports = BrowserManager;
