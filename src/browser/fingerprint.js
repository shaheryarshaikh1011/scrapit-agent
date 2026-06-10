const UserAgent = require('user-agents');
const { randomChoice } = require('../utils/helpers');
const config = require('../config/defaults');

/**
 * Generate realistic browser fingerprint
 */
class FingerprintGenerator {
  constructor() {
    this.userAgentGenerator = new UserAgent({ deviceCategory: 'desktop' });
  }

  /**
   * Get random user agent
   */
  getUserAgent() {
    return this.userAgentGenerator.random().toString();
  }

  /**
   * Get random viewport
   */
  getViewport() {
    return randomChoice(config.VIEWPORTS);
  }

  /**
   * Get timezone
   */
  getTimezone() {
    const timezones = [
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Asia/Kolkata',
      'Asia/Tokyo'
    ];
    return randomChoice(timezones);
  }

  /**
   * Get locale
   */
  getLocale() {
    const locales = ['en-US', 'en-GB', 'en-IN'];
    return randomChoice(locales);
  }

  /**
   * Generate complete fingerprint
   */
  generate() {
    const viewport = this.getViewport();
    return {
      userAgent: this.getUserAgent(),
      viewport,
      screen: {
        width: viewport.width,
        height: viewport.height
      },
      timezone: this.getTimezone(),
      locale: this.getLocale(),
      colorDepth: 24,
      deviceMemory: randomChoice([4, 8, 16]),
      hardwareConcurrency: randomChoice([4, 8, 12, 16]),
      platform: 'Win32',
      webdriver: false
    };
  }

  /**
   * Get Playwright context options
   */
  getContextOptions() {
    const fp = this.generate();
    return {
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      screen: fp.screen,
      locale: fp.locale,
      timezoneId: fp.timezone,
      colorScheme: 'light',
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    };
  }
}

module.exports = FingerprintGenerator;
