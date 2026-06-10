const BaseScraper = require('./baseScraper');
const logger = require('../utils/logger');
const { cleanText, sleepWithJitter } = require('../utils/helpers');

/**
 * Real-time scraper for dynamic/live data
 * Handles WebSockets, polling, and MutationObserver
 */
class RealtimeScraper extends BaseScraper {
  constructor(options = {}) {
    super(options);
    this.websocketData = [];
    this.apiResponses = [];
    this.domChanges = [];
    this.isMonitoring = false;
  }

  /**
   * Scrape with all real-time techniques
   */
  async scrape(url, options = {}) {
    const {
      duration = 30000,      // How long to monitor (ms)
      selectors = [],        // DOM elements to watch
      pollInterval = 1000,   // Polling interval
      captureWebsockets = true,
      captureApi = true,
      captureDom = true
    } = options;

    try {
      await this.init();
      
      // Setup interceptors before navigation
      if (captureWebsockets) {
        await this.setupWebsocketInterceptor();
      }
      
      if (captureApi) {
        await this.setupApiInterceptor();
      }

      await this.goto(url, { waitUntil: 'domcontentloaded' });

      // Setup DOM observer
      if (captureDom && selectors.length > 0) {
        await this.setupDomObserver(selectors);
      }

      // Start polling if selectors provided
      if (selectors.length > 0) {
        this.startPolling(selectors, pollInterval);
      }

      logger.info(`Monitoring for ${duration / 1000} seconds...`);
      
      // Monitor for specified duration
      await this.page.waitForTimeout(duration);

      // Stop monitoring
      this.isMonitoring = false;

      return {
        url,
        monitorDuration: duration,
        scrapedAt: new Date().toISOString(),
        websocketMessages: this.websocketData,
        apiResponses: this.apiResponses,
        domChanges: this.domChanges,
        summary: {
          websocketCount: this.websocketData.length,
          apiCount: this.apiResponses.length,
          domChangeCount: this.domChanges.length
        }
      };

    } catch (error) {
      await this.handleError(error, 'Realtime scrape failed');
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * Setup WebSocket message interceptor
   */
  async setupWebsocketInterceptor() {
    this.page.on('websocket', ws => {
      logger.debug(`WebSocket connected: ${ws.url()}`);

      ws.on('framereceived', frame => {
        try {
          const data = {
            timestamp: new Date().toISOString(),
            url: ws.url(),
            type: 'received',
            payload: this.tryParseJson(frame.payload)
          };
          this.websocketData.push(data);
          logger.debug(`WS received: ${JSON.stringify(data.payload).substring(0, 100)}`);
        } catch (e) {
          // Binary or unparseable data
        }
      });

      ws.on('framesent', frame => {
        try {
          const data = {
            timestamp: new Date().toISOString(),
            url: ws.url(),
            type: 'sent',
            payload: this.tryParseJson(frame.payload)
          };
          this.websocketData.push(data);
        } catch (e) {
          // Ignore
        }
      });

      ws.on('close', () => {
        logger.debug(`WebSocket closed: ${ws.url()}`);
      });
    });

    logger.info('WebSocket interceptor active');
  }

  /**
   * Setup API/XHR response interceptor
   */
  async setupApiInterceptor() {
    this.page.on('response', async response => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Only capture JSON/API responses
      if (contentType.includes('json') || url.includes('api') || url.includes('graphql')) {
        try {
          const data = await response.json();
          this.apiResponses.push({
            timestamp: new Date().toISOString(),
            url,
            status: response.status(),
            data
          });
          logger.debug(`API captured: ${url.substring(0, 80)}`);
        } catch {
          // Not JSON, ignore
        }
      }
    });

    logger.info('API interceptor active');
  }

  /**
   * Setup DOM MutationObserver
   */
  async setupDomObserver(selectors) {
    await this.page.exposeFunction('__reportDomChange', (change) => {
      this.domChanges.push({
        timestamp: new Date().toISOString(),
        ...change
      });
      logger.debug(`DOM change: ${change.selector} = ${change.value?.substring(0, 50)}`);
    });

    await this.page.evaluate((selectors) => {
      selectors.forEach(selector => {
        const target = document.querySelector(selector);
        if (!target) return;

        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            window.__reportDomChange({
              selector,
              type: mutation.type,
              value: target.innerText,
              html: target.innerHTML.substring(0, 500)
            });
          });
        });

        observer.observe(target, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true
        });
      });
    }, selectors);

    logger.info(`DOM observer watching: ${selectors.join(', ')}`);
  }

  /**
   * Start polling selectors for changes
   */
  async startPolling(selectors, interval) {
    this.isMonitoring = true;
    const lastValues = new Map();

    const poll = async () => {
      while (this.isMonitoring) {
        for (const selector of selectors) {
          try {
            const value = await this.page.locator(selector).first().textContent({ timeout: 1000 });
            const cleaned = cleanText(value);
            
            if (lastValues.get(selector) !== cleaned) {
              this.domChanges.push({
                timestamp: new Date().toISOString(),
                selector,
                type: 'poll',
                previousValue: lastValues.get(selector),
                value: cleaned
              });
              lastValues.set(selector, cleaned);
              logger.debug(`Poll change: ${selector} = ${cleaned.substring(0, 50)}`);
            }
          } catch {
            // Element not found, continue
          }
        }
        await sleepWithJitter(interval);
      }
    };

    // Start polling in background
    poll().catch(() => {});
    logger.info(`Polling started: ${interval}ms interval`);
  }

  /**
   * Try to parse JSON, return original if fails
   */
  tryParseJson(str) {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Stream data with callback (for continuous monitoring)
   */
  async stream(url, options = {}) {
    const {
      onWebsocket,
      onApi,
      onDomChange,
      selectors = [],
      duration = 60000
    } = options;

    try {
      await this.init();

      // Setup callbacks
      if (onWebsocket) {
        this.page.on('websocket', ws => {
          ws.on('framereceived', frame => {
            onWebsocket({
              timestamp: new Date().toISOString(),
              url: ws.url(),
              payload: this.tryParseJson(frame.payload)
            });
          });
        });
      }

      if (onApi) {
        this.page.on('response', async response => {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            try {
              const data = await response.json();
              onApi({
                timestamp: new Date().toISOString(),
                url: response.url(),
                data
              });
            } catch {}
          }
        });
      }

      if (onDomChange && selectors.length > 0) {
        await this.page.exposeFunction('__streamDomChange', onDomChange);
        await this.page.evaluate((selectors) => {
          selectors.forEach(selector => {
            const target = document.querySelector(selector);
            if (!target) return;
            const observer = new MutationObserver(() => {
              window.__streamDomChange({
                timestamp: new Date().toISOString(),
                selector,
                value: target.innerText
              });
            });
            observer.observe(target, { childList: true, subtree: true, characterData: true });
          });
        }, selectors);
      }

      await this.goto(url);
      await this.page.waitForTimeout(duration);

    } finally {
      await this.close();
    }
  }
}

module.exports = RealtimeScraper;
