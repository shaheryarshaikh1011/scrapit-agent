const BaseScraper = require('./baseScraper');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { cleanText, parsePrice, sleepWithJitter, extractDomain } = require('../utils/helpers');

/**
 * Specialized e-commerce scraper for sites like JioMart, Amazon, Flipkart
 */
class EcommerceScraper extends BaseScraper {
  constructor(options = {}) {
    super(options);
    this.siteConfig = null;
  }

  /**
   * Site-specific configurations
   */
  static SITE_CONFIGS = {
    'jiomart.com': {
      name: 'JioMart',
      waitSelector: '[class*="product"], [class*="plp-card"]',
      product: {
        title: '.prod-name, .product-name, h1.pdp-title, [class*="product-title"]',
        price: '.price, .final-price, .pdp-price, [class*="selling-price"]',
        originalPrice: '.striked-price, .mrp-price, [class*="disc-price"]',
        image: '.prod-img img, .product-image img, [class*="pdp-image"] img',
        description: '.prod-desc, .product-description, [class*="pdp-desc"]',
        rating: '.star-rating, [class*="rating"]',
        availability: '.prod-availability, [class*="stock"]'
      },
      listing: {
        container: '.plp-card, .product-card, [data-product]',
        title: '.plp-card-details-name, [class*="title"], h3',
        price: '.jm-body-xs, .price, [class*="price"]',
        image: '.plp-card-image img, img',
        link: 'a'
      },
      pagination: '.pagination a, [class*="page-number"]',
      lazyLoad: true,
      infiniteScroll: false
    },

    'amazon.in': {
      name: 'Amazon India',
      waitSelector: '#search, #dp',
      product: {
        title: '#productTitle, .product-title-word-break',
        price: '.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice',
        originalPrice: '.a-text-price .a-offscreen, #priceblock_ourprice',
        image: '#landingImage, #imgTagWrapperId img',
        description: '#productDescription, #feature-bullets',
        rating: '#acrPopover, .a-icon-star-small',
        availability: '#availability'
      },
      listing: {
        container: '[data-component-type="s-search-result"]',
        title: 'h2 a span',
        price: '.a-price .a-offscreen',
        image: '.s-image',
        link: 'h2 a'
      },
      pagination: '.s-pagination-item',
      lazyLoad: true,
      infiniteScroll: false
    },

    'flipkart.com': {
      name: 'Flipkart',
      waitSelector: '._1AtVbE, ._1YokD2',
      product: {
        title: '.B_NuCI, ._35KyD6',
        price: '._30jeq3, ._16Jk6d',
        originalPrice: '._3I9_wc',
        image: '._396cs4, ._2r_T1I img',
        description: '._1mXcCf',
        rating: '._3LWZlK',
        availability: '._16FRp0'
      },
      listing: {
        container: '._1AtVbE, ._2kHMtA',
        title: '._4rR01T, .IRpwTa',
        price: '._30jeq3',
        image: '._396cs4',
        link: 'a._1fQZEK, a._2rpwqI'
      },
      pagination: '._1LKTO3',
      lazyLoad: true,
      infiniteScroll: false
    },

    // Default config for unknown sites
    'default': {
      name: 'Generic',
      waitSelector: 'body',
      product: {
        title: 'h1, [itemprop="name"], [class*="product-title"], [class*="product-name"]',
        price: '[itemprop="price"], [class*="price"]:not([class*="old"]):not([class*="was"])',
        originalPrice: '[class*="original"], [class*="was"], [class*="mrp"], del, s',
        image: '[itemprop="image"], [class*="product-image"] img, [class*="gallery"] img',
        description: '[itemprop="description"], [class*="description"]',
        rating: '[itemprop="ratingValue"], [class*="rating"], [class*="star"]',
        availability: '[itemprop="availability"], [class*="stock"], [class*="availability"]'
      },
      listing: {
        container: '[class*="product-card"], [class*="product-item"], [data-product]',
        title: 'h2, h3, [class*="title"], [class*="name"]',
        price: '[class*="price"]',
        image: 'img',
        link: 'a'
      },
      pagination: '[class*="pagination"] a',
      lazyLoad: true,
      infiniteScroll: false
    }
  };

  /**
   * Get site config based on URL
   */
  getSiteConfig(url) {
    const domain = extractDomain(url);
    
    for (const [key, config] of Object.entries(EcommerceScraper.SITE_CONFIGS)) {
      if (domain.includes(key.replace('.com', ''))) {
        return config;
      }
    }
    
    return EcommerceScraper.SITE_CONFIGS.default;
  }

  /**
   * Scrape product or listing page
   */
  async scrape(url, options = {}) {
    const {
      type = 'auto',  // auto, product, listing
      maxPages = 1,
      maxProducts = 100,
      location = null,  // Default location for sites that require it
      pincode = null    // Specific pincode to set
    } = options;

    try {
      await this.init();
      this.siteConfig = this.getSiteConfig(url);
      
      logger.info(`Using config: ${this.siteConfig.name}`);

      await this.goto(url, { 
        waitUntil: 'domcontentloaded',
        waitForSelector: this.siteConfig.waitSelector 
      });

      // Handle site-specific popups (like location modals)
      // If pincode is provided, use pincode-based location setting
      if (pincode) {
        await this.handleJioMartPincodeLocation(pincode);
      } else {
        await this.handleSitePopups(url, location);
      }

      // Re-fetch HTML after popups (page might have changed)
      await this.page.waitForTimeout(1000);
      
      // Wait for dynamic content and handle lazy loading
      await this.handleDynamicContent();

      const html = await this.browser.getHtml();
      const currentUrl = this.page.url();
      const pageType = type === 'auto' ? this.detectPageType(html) : type;

      let data;
      if (pageType === 'listing') {
        data = await this.scrapeListingWithPagination(currentUrl, maxPages, maxProducts);
      } else if (pageType === 'homepage') {
        data = await this.scrapeHomepage(html);
      } else {
        data = await this.scrapeProductPage(html);
      }

      // Add pincode/location info to result
      const locationInfo = await this.getCurrentLocation();

      return {
        url: currentUrl,
        site: this.siteConfig.name,
        pageType,
        scrapedAt: new Date().toISOString(),
        location: locationInfo,
        pincode: pincode || location,
        ...data
      };

    } catch (error) {
      await this.handleError(error, 'E-commerce scrape failed');
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * Compare product prices across multiple pincodes
   * Returns consolidated SKU data with prices for each pincode
   * 
   * IMPORTANT: JioMart renders prices server-side in APP_DATA.
   * We must set location FIRST (on homepage), then navigate to product page.
   */
  async comparePrices(url, pincodes = [], options = {}) {
    const skuData = {
      url,
      sku: null,
      title: null,
      brand: null,
      images: [],
      pincodeData: [],
      scrapedAt: new Date().toISOString()
    };

    for (let i = 0; i < pincodes.length; i++) {
      const pincode = pincodes[i];
      logger.info(`[${i + 1}/${pincodes.length}] Checking pincode: ${pincode}`);

      try {
        await this.init();
        this.siteConfig = this.getSiteConfig(url);

        // Step 1: Go to JioMart homepage first to set location
        logger.info('Setting location on homepage first...');
        await this.goto('https://www.jiomart.com/', {
          waitUntil: 'domcontentloaded'
        });
        await this.page.waitForTimeout(1500);

        // Step 2: Set location using pincode
        const locationSet = await this.handleJioMartPincodeLocation(pincode);
        
        // Wait for location to be saved
        await this.page.waitForTimeout(1500);

        // Step 3: Now navigate to product page - prices will load with correct location
        logger.info('Navigating to product page...');
        try {
          await this.goto(url, {
            waitUntil: 'domcontentloaded',
            waitForSelector: this.siteConfig.waitSelector
          });
        } catch (navError) {
          // Sometimes JioMart aborts navigation, try again
          if (navError.message.includes('ERR_ABORTED')) {
            logger.warn('Navigation aborted, retrying...');
            await this.page.waitForTimeout(1000);
            await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          } else {
            throw navError;
          }
        }

        // Wait for React to render product data
        await this.page.waitForTimeout(2000);

        // Get current location display
        const locationInfo = await this.getCurrentLocation();

        // Scrape product data - should now have correct prices
        const productData = await this.scrapeJioMartProductPage();

        // Set base product info from first successful scrape
        if (!skuData.sku && productData.sku) {
          skuData.sku = productData.sku;
          skuData.title = productData.title;
          skuData.brand = productData.brand;
          skuData.images = productData.images;
          skuData.description = productData.description;
          skuData.rating = productData.rating;
          skuData.reviewCount = productData.reviewCount;
          skuData.weight = productData.weight;
        }

        // Add pincode-specific data
        skuData.pincodeData.push({
          pincode,
          location: locationInfo?.display || null,
          price: productData.price,
          priceText: productData.priceText,
          originalPrice: productData.originalPrice,
          originalPriceText: productData.originalPriceText,
          discount: productData.discount,
          inStock: productData.inStock,
          availability: productData.availability,
          variants: productData.variants || [],
          deliveryInfo: null
        });

        logger.success(`Pincode ${pincode}: ${productData.priceText || 'N/A'} - ${productData.availability}`);

      } catch (error) {
        logger.error(`Failed for pincode ${pincode}: ${error.message}`);
        skuData.pincodeData.push({
          pincode,
          error: error.message,
          price: null,
          inStock: false,
          availability: 'Error'
        });
      } finally {
        await this.close();
      }

      // Small delay between requests
      if (i < pincodes.length - 1) {
        await sleepWithJitter(1500, 500);
      }
    }

    // Calculate price statistics
    const validPrices = skuData.pincodeData.filter(p => p.price && !p.error);
    if (validPrices.length > 0) {
      const prices = validPrices.map(p => p.price);
      skuData.priceRange = {
        min: Math.min(...prices),
        max: Math.max(...prices),
        avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      };
      skuData.cheapestPincode = validPrices.find(p => p.price === skuData.priceRange.min)?.pincode;
      skuData.availableAt = validPrices.filter(p => p.inStock).map(p => p.pincode);
      skuData.unavailableAt = skuData.pincodeData.filter(p => !p.inStock || p.error).map(p => p.pincode);
    }

    return skuData;
  }

  /**
   * Handle JioMart location setting via pincode search
   * Optimized for speed - reduced wait times
   */
  async handleJioMartPincodeLocation(pincode) {
    try {
      logger.info(`Setting location to pincode: ${pincode}`);

      // Store pincode for use in suggestion click
      this.currentPincode = pincode;

      // Wait briefly for page to stabilize
      await this.page.waitForTimeout(1000);

      // Check if location modal is already open
      const enableLocationModal = this.page.locator('text=Enable Location Services').first();

      if (await enableLocationModal.isVisible({ timeout: 1000 })) {
        // Click "Select Location Manually" to get to pincode search
        const manualBtn = this.page.locator('text=Select Location Manually').first();
        if (await manualBtn.isVisible({ timeout: 800 })) {
          await manualBtn.click();
          logger.info('Clicked "Select Location Manually"');
          await this.page.waitForTimeout(1000);
        }
      }

      // Look for the search input
      const searchInputSelectors = [
        'input[placeholder*="Search for area"]',
        'input[placeholder*="area, street"]',
        'input[placeholder*="landmark"]',
        'input[placeholder*="Search"]'
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        const input = this.page.locator(selector).first();
        if (await input.isVisible({ timeout: 1000 })) {
          searchInput = input;
          logger.info(`Found search input: ${selector}`);
          break;
        }
      }

      if (searchInput) {
        // Clear and type pincode
        await searchInput.click();
        await this.page.waitForTimeout(200);
        await searchInput.fill('');
        await this.page.waitForTimeout(150);

        // Type pincode - faster typing
        await searchInput.type(pincode, { delay: 80 });
        logger.info(`Typed pincode: ${pincode}`);

        // Wait for Google Places autocomplete dropdown
        await this.page.waitForTimeout(1500);

        // Click on first suggestion in dropdown
        const suggestionClicked = await this.clickLocationSuggestion();

        if (suggestionClicked) {
          // Wait for map to load
          await this.page.waitForTimeout(1500);

          // Click "Confirm Location" button
          const confirmed = await this.clickConfirmLocation();

          if (confirmed) {
            logger.success(`Location set to pincode: ${pincode}`);
            return true;
          }
        } else {
          // No suggestion found, try pressing Enter
          logger.info('No suggestion dropdown, trying Enter key');
          await searchInput.press('Enter');
          await this.page.waitForTimeout(1500);
          await this.clickConfirmLocation();
        }
      } else {
        logger.warn('Could not find search input for pincode');
        // Try to dismiss any modal and use geolocation fallback
        await this.dismissJioMartPopups();
        await this.handleJioMartEnableLocationModal();
      }

      return false;
    } catch (error) {
      logger.warn(`Pincode location setting failed: ${error.message}`);
      await this.dismissJioMartPopups();
      return false;
    }
  }

  /**
   * Click on location suggestion from dropdown
   */
  async clickLocationSuggestion() {
    const suggestionSelectors = [
      // JioMart specific dropdown items
      '[class*="pac-item"]', // Google Places autocomplete
      '[class*="suggestion"]',
      '[class*="dropdown-item"]',
      '[class*="autocomplete"] li',
      '[class*="search-result"]',
      '[class*="result-item"]',
      '[class*="location-item"]',
      'li[class*="option"]',
      // Generic clickable list items that might contain address
      '[class*="list"] div[class*="item"]'
    ];

    for (const selector of suggestionSelectors) {
      try {
        // Wait a bit for suggestions to render
        await this.page.waitForTimeout(500);
        const suggestions = this.page.locator(selector);
        const count = await suggestions.count();

        if (count > 0) {
          // Click the first visible suggestion
          const firstSuggestion = suggestions.first();
          if (await firstSuggestion.isVisible({ timeout: 1000 })) {
            await firstSuggestion.click();
            logger.info(`Clicked location suggestion using: ${selector}`);
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    // Try clicking any element that contains the pincode text
    try {
      const pincodeText = this.page.locator(`text=${this.currentPincode || ''}`).first();
      if (await pincodeText.isVisible({ timeout: 500 })) {
        await pincodeText.click();
        return true;
      }
    } catch {
      // Ignore
    }

    return false;
  }

  /**
   * Click "Confirm Location" button after map selection
   */
  async clickConfirmLocation() {
    const confirmSelectors = [
      'button:has-text("Confirm Location")',
      'button:has-text("Confirm")',
      '[class*="confirm"] button',
      'button[class*="confirm"]',
      'button:has-text("Done")',
      'button:has-text("Save")',
      'button:has-text("Set Location")',
      'button:has-text("Deliver Here")'
    ];

    for (const selector of confirmSelectors) {
      try {
        const btn = this.page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          logger.success('Clicked "Confirm Location"');
          await this.page.waitForTimeout(1500);
          return true;
        }
      } catch {
        continue;
      }
    }

    // Try to dismiss any remaining modal
    await this.dismissJioMartPopups();
    return false;
  }

  /**
   * Get current location from page
   */
  async getCurrentLocation() {
    try {
      const locationInfo = await this.page.evaluate(() => {
        // Try to find location display in header
        const locationSelectors = [
          '[class*="location"] [class*="text"]',
          '[class*="deliver"] span',
          '[class*="pincode"]',
          '[class*="address"]'
        ];

        for (const selector of locationSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent.trim()) {
            const text = el.textContent.trim();
            // Extract pincode if present
            const pincodeMatch = text.match(/\d{6}/);
            return {
              display: text.substring(0, 100),
              pincode: pincodeMatch ? pincodeMatch[0] : null
            };
          }
        }

        return null;
      });

      return locationInfo;
    } catch {
      return null;
    }
  }

  /**
   * Handle site-specific popups like location modals
   */
  async handleSitePopups(url, location) {
    const domain = extractDomain(url);
    
    // Handle JioMart location modal
    if (domain.includes('jiomart')) {
      await this.handleJioMartLocation(location);
    }
    
    // Handle Amazon location (if needed)
    if (domain.includes('amazon')) {
      await this.handleAmazonLocation(location);
    }
  }

  /**
   * Handle JioMart location modal - click "Use current location" or dismiss
   */
  async handleJioMartLocation(location) {
    try {
      // Wait a bit for modals to appear
      await this.page.waitForTimeout(2000);
      
      // First try to handle the "Enable Location Services" modal
      const locationSet = await this.handleJioMartEnableLocationModal();
      
      // If location was enabled, wait for page to potentially reload/navigate
      if (locationSet) {
        try {
          // Wait for any navigation to complete
          await this.page.waitForLoadState('networkidle', { timeout: 15000 });
        } catch {
          // Timeout is fine, page might already be stable
        }
        await this.page.waitForTimeout(3000);
      }
      
      // Then try to handle any remaining "Choose your delivery address" modal
      await this.handleJioMartChooseAddressModal();
      
    } catch (error) {
      logger.warn(`Could not handle JioMart location modal: ${error.message}`);
    }
  }

  /**
   * Handle JioMart's "Enable Location Services" modal
   */
  async handleJioMartEnableLocationModal() {
    try {
      const enableLocationText = this.page.locator('text=Enable Location Services').first();
      if (await enableLocationText.isVisible({ timeout: 3000 })) {
        logger.info('Found "Enable Location Services" modal');
        
        // Try clicking "Enable Location" button (the teal button)
        const enableBtnSelectors = [
          'button:has-text("Enable Location")',
          'text=Enable Location >> nth=0',
          '[class*="enable"] button',
          'button[class*="primary"]',
          'button[class*="btn"]:has-text("Enable")',
          'div:has-text("Enable Location") >> button',
          'a:has-text("Enable Location")',
          // Try by color/style - teal button
          'button[style*="background"]',
          '.jm-btn-primary',
          '[class*="location-btn"]'
        ];
        
        for (const selector of enableBtnSelectors) {
          try {
            const enableBtn = this.page.locator(selector).first();
            if (await enableBtn.isVisible({ timeout: 1500 })) {
              logger.info(`Found enable button with selector: ${selector}`);
              await enableBtn.click({ force: true });
              logger.success('Clicked "Enable Location" button');
              await this.page.waitForTimeout(3000);
              return true;
            }
          } catch (e) {
            continue;
          }
        }
        
        // Fallback: click "Select Location Manually"
        const manualBtn = this.page.locator('text=Select Location Manually').first();
        if (await manualBtn.isVisible({ timeout: 1000 })) {
          await manualBtn.click({ force: true });
          logger.info('Clicked "Select Location Manually"');
          await this.page.waitForTimeout(1500);
          return true;
        }
      }
    } catch (e) {
      logger.warn(`Enable location modal error: ${e.message}`);
    }
    return false;
  }

  /**
   * Handle JioMart's "Choose your delivery address" modal
   */
  async handleJioMartChooseAddressModal() {
    try {
      const chooseAddressText = this.page.locator('text=Choose your delivery address').first();
      if (await chooseAddressText.isVisible({ timeout: 2000 })) {
        logger.info('Found "Choose your delivery address" modal');
        
        // Try clicking "Use current location" option
        const useCurrentLocationSelectors = [
          'text=Use current location',
          'text=use current location',
          '[class*="current-location"]',
          '[class*="currentLocation"]',
          'div:has-text("Use current location")',
          'button:has-text("Use current location")'
        ];
        
        for (const selector of useCurrentLocationSelectors) {
          try {
            const locationBtn = this.page.locator(selector).first();
            if (await locationBtn.isVisible({ timeout: 1500 })) {
              await locationBtn.click();
              logger.success('Clicked "Use current location"');
              await this.page.waitForTimeout(3000);
              return;
            }
          } catch {
            continue;
          }
        }
        
        // If "Use current location" not found, try to dismiss the modal
        logger.info('"Use current location" not found, attempting to dismiss modal');
        await this.dismissJioMartPopups();
      }
    } catch {
      // Modal not present
    }
  }

  /**
   * Dismiss JioMart popups by clicking X/close/back buttons
   */
  async dismissJioMartPopups() {
    // Try multiple times as there can be multiple popups
    for (let attempt = 0; attempt < 3; attempt++) {
      let dismissed = false;
      
      // Common close button selectors
      const closeSelectors = [
        // X buttons
        'button[aria-label="close"]',
        'button[aria-label="Close"]',
        '[class*="close-btn"]',
        '[class*="close-icon"]',
        '[class*="closeBtn"]',
        '[class*="modal-close"]',
        'button:has(svg[class*="close"])',
        '[class*="cross"]',
        // Back buttons
        '[aria-label*="back"]',
        '[aria-label*="Back"]',
        '[class*="back-btn"]',
        '[class*="back-arrow"]',
        // Generic X buttons
        'button:has-text("×")',
        'button:has-text("✕")'
      ];
      
      for (const selector of closeSelectors) {
        try {
          const closeBtn = this.page.locator(selector).first();
          if (await closeBtn.isVisible({ timeout: 800 })) {
            await closeBtn.click();
            logger.info(`Dismissed popup using: ${selector}`);
            dismissed = true;
            await this.page.waitForTimeout(1000);
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Try Escape key if no button found
      if (!dismissed) {
        try {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(500);
        } catch {
          // Ignore
        }
        break;
      }
    }
    
    await this.page.waitForTimeout(1000);
  }

  /**
   * Handle Amazon location popup
   */
  async handleAmazonLocation(location) {
    const defaultPincode = location || '400001'; // Mumbai default
    
    try {
      // Check for location popup
      const deliverTo = this.page.locator('#nav-global-location-popover-link, #glow-ingress-block');
      if (await deliverTo.isVisible({ timeout: 2000 })) {
        await deliverTo.click();
        await this.page.waitForTimeout(1000);
        
        const pincodeInput = this.page.locator('input[data-action="GLUXPostalInputAction"]');
        if (await pincodeInput.isVisible({ timeout: 2000 })) {
          await pincodeInput.fill(defaultPincode);
          
          const applyBtn = this.page.locator('span[data-action="GLUXPostalUpdateAction"] input, button:has-text("Apply")');
          if (await applyBtn.isVisible({ timeout: 1000 })) {
            await applyBtn.click();
            await this.page.waitForTimeout(2000);
          }
        }
      }
    } catch {
      // Ignore - location might already be set
    }
  }

  /**
   * Handle dynamic content loading
   */
  async handleDynamicContent() {
    const startUrl = this.page.url();
    
    // Wait for JavaScript to render content (JioMart is React-based)
    await this.page.waitForTimeout(5000);
    
    // Scroll extensively to trigger lazy loading
    if (this.siteConfig.lazyLoad) {
      for (let i = 0; i < 10; i++) {
        // Check if we navigated away
        if (this.page.url() !== startUrl) {
          logger.warn('Page navigated during scroll, going back');
          await this.page.goBack();
          await this.page.waitForTimeout(2000);
          break;
        }
        
        await this.page.evaluate(() => {
          window.scrollBy(0, window.innerHeight * 0.8);
        });
        await this.page.waitForTimeout(1000);
      }
      
      // Scroll back to top
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await this.page.waitForTimeout(1000);
    }

    // Wait for content to fully load
    await this.page.waitForTimeout(3000);
  }

  /**
   * Detect page type - homepage, listing, or product
   */
  detectPageType(html) {
    const $ = cheerio.load(html);
    const url = this.page.url();
    
    // Check if it's the homepage
    const isHomepage = url === 'https://www.jiomart.com/' || 
                       url === 'https://www.jiomart.com' ||
                       url.match(/^https?:\/\/[^\/]+\/?$/);
    
    if (isHomepage) {
      return 'homepage';
    }
    
    // Check for product page indicators
    const productIndicators = [
      $('[class*="pdp"]').length > 0,
      $('[class*="product-detail"]').length > 0,
      $('h1[class*="product"]').length > 0,
      url.includes('/p/') || url.includes('/product/')
    ];
    
    if (productIndicators.some(Boolean)) {
      return 'product';
    }
    
    // Check for listing page
    const listingSelector = this.siteConfig.listing.container;
    const productCards = $(listingSelector).length;
    
    if (productCards > 2) {
      return 'listing';
    }
    
    // Default to homepage if we can't determine
    return 'homepage';
  }

  /**
   * Scrape single product page
   */
  async scrapeProductPage(html) {
    const $ = cheerio.load(html);
    const config = this.siteConfig.product;
    const url = this.page.url();
    const domain = extractDomain(url);

    // For JioMart, use browser-based extraction (React content)
    if (domain.includes('jiomart')) {
      return await this.scrapeJioMartProductPage();
    }

    const title = this.extractText($, config.title);
    const priceText = this.extractText($, config.price);
    const originalPriceText = this.extractText($, config.originalPrice);
    const price = parsePrice(priceText);
    const originalPrice = parsePrice(originalPriceText);

    return {
      type: 'product',
      title,
      price,
      priceText: cleanText(priceText),
      originalPrice,
      discount: originalPrice && price ? Math.round((1 - price / originalPrice) * 100) + '%' : null,
      image: this.extractImage($, config.image),
      images: this.extractAllImages($, config.image),
      description: this.extractText($, config.description),
      rating: this.extractText($, config.rating),
      availability: this.extractText($, config.availability),
      inStock: this.checkInStock($)
    };
  }

  /**
   * Scrape JioMart product page using browser context
   */
  async scrapeJioMartProductPage() {
    // Wait for product content to fully load
    await this.page.waitForTimeout(3000);

    const productData = await this.page.evaluate(() => {
      const data = {
        type: 'product',
        title: null,
        price: null,
        priceText: null,
        originalPrice: null,
        originalPriceText: null,
        discount: null,
        image: null,
        images: [],
        description: null,
        brand: null,
        rating: null,
        reviewCount: null,
        availability: null,
        inStock: true,
        weight: null,
        sku: null,
        articleId: null,
        variants: [],
        selectedVariant: null,
        specifications: {}
      };

      // Try to extract from window.APP_DATA first (most reliable)
      try {
        if (window.APP_DATA && window.APP_DATA.reduxData && window.APP_DATA.reduxData.catalog) {
          const catalog = window.APP_DATA.reduxData.catalog;
          const productDetails = catalog.product_details;

          if (productDetails) {
            // Get title
            data.title = productDetails.name || productDetails.title;

            // Get brand
            data.brand = productDetails.brand?.name || productDetails.brand;

            // Get price info - handle different price structures
            if (productDetails.price) {
              const effectivePrice = productDetails.price.effective;
              const markedPrice = productDetails.price.marked;
              
              // Handle nested min/max structure
              if (effectivePrice && typeof effectivePrice === 'object') {
                data.price = effectivePrice.min || effectivePrice.max || null;
              } else {
                data.price = effectivePrice;
              }
              
              if (markedPrice && typeof markedPrice === 'object') {
                data.originalPrice = markedPrice.min || markedPrice.max || null;
              } else {
                data.originalPrice = markedPrice;
              }
              
              // If price is 0 or null, it might be in a different structure
              if (!data.price || data.price === 0) {
                data.price = productDetails.price.selling || productDetails.price.current || null;
              }
              if (!data.originalPrice || data.originalPrice === 0) {
                data.originalPrice = productDetails.price.mrp || productDetails.price.original || null;
              }
              
              data.priceText = data.price ? `₹${data.price}` : null;
              data.originalPriceText = data.originalPrice ? `₹${data.originalPrice}` : null;
            }

            // Get discount
            if (productDetails.discount) {
              data.discount = productDetails.discount;
            } else if (data.originalPrice && data.price && data.originalPrice > data.price) {
              data.discount = `${Math.round((1 - data.price / data.originalPrice) * 100)}% off`;
            }

            // Get images
            if (productDetails.medias) {
              data.images = productDetails.medias
                .filter(m => m.type === 'image' && m.url)
                .map(m => m.url.replace(/t\.resize\(w:\d+\)/, 't.resize(w:800)'));
              data.image = data.images[0] || null;
            }

            // Get rating
            if (productDetails.rating) {
              data.rating = productDetails.rating.average?.toString() || productDetails.rating.toString();
              data.reviewCount = productDetails.rating.count;
            }

            // Get availability - check sellable flag
            data.inStock = productDetails.sellable !== false;
            data.availability = data.inStock ? 'In Stock' : 'Currently Unavailable';
            
            // If product is unavailable, clear the price (it's stale data)
            if (!data.inStock) {
              data.price = null;
              data.priceText = null;
              data.originalPrice = null;
              data.originalPriceText = null;
              data.discount = null;
            }

            // Get SKU/article info
            data.sku = productDetails.uid || productDetails.sku;
            data.articleId = productDetails.article_id;

            // Get weight - prefer from title or specific field
            if (productDetails.item_code && productDetails.item_code.match(/\d+\s*[gkml]/i)) {
              data.weight = productDetails.item_code;
            } else if (productDetails.size && productDetails.size.display) {
              data.weight = productDetails.size.display;
            } else if (data.title) {
              const weightFromTitle = data.title.match(/(\d+\s*(?:g|kg|ml|l|pack|pcs?))/i);
              if (weightFromTitle) {
                data.weight = weightFromTitle[1];
              }
            }
            
            // Store article ID separately
            data.articleId = productDetails.article_id || productDetails.uid;

            // Get variants/sizes
            if (productDetails.sizes && Array.isArray(productDetails.sizes)) {
              data.variants = productDetails.sizes.map(size => ({
                size: size.display || size.value,
                price: size.price?.effective?.min || size.price?.effective,
                priceText: size.price ? `₹${size.price.effective?.min || size.price.effective}` : null,
                originalPrice: size.price?.marked?.min || size.price?.marked,
                selected: size.is_selected || false,
                inStock: size.sellable !== false,
                quantity: size.quantity
              }));

              // Get selected variant
              const selected = data.variants.find(v => v.selected);
              if (selected) {
                data.selectedVariant = selected;
                // Update price from selected variant if main price is missing
                if ((!data.price || data.price === 0) && selected.price) {
                  data.price = selected.price;
                  data.priceText = `₹${selected.price}`;
                }
                if ((!data.originalPrice || data.originalPrice === 0) && selected.originalPrice) {
                  data.originalPrice = selected.originalPrice;
                  data.originalPriceText = `₹${selected.originalPrice}`;
                }
                data.inStock = selected.inStock;
                data.availability = selected.inStock ? 'In Stock' : 'Currently Unavailable';
                data.weight = selected.size || data.weight;
              }
            }

            // Get description
            if (productDetails.description) {
              data.description = productDetails.description;
            } else if (productDetails.short_description) {
              data.description = productDetails.short_description;
            }

            // Get specifications from grouped_attributes
            if (productDetails.grouped_attributes) {
              productDetails.grouped_attributes.forEach(group => {
                if (group.details) {
                  group.details.forEach(attr => {
                    if (attr.key && attr.value) {
                      data.specifications[attr.key] = attr.value;
                    }
                  });
                }
              });
            }
          }
        }
      } catch (e) {
        console.log('APP_DATA extraction error:', e.message);
      }

      // Fallback to DOM extraction if APP_DATA didn't work
      if (!data.title) {
        // Get title from image alt
        const mainImg = document.querySelector('img[alt][src*="catalog"]');
        if (mainImg && mainImg.alt) {
          data.title = mainImg.alt;
        }
      }

      // Clean up title - remove duplicate brand name at start
      if (data.title) {
        const words = data.title.split(' ');
        if (words.length >= 2 && words[0] === words[1]) {
          data.title = words.slice(1).join(' ');
        }
      }

      // DOM fallback for price - only if needed and use targeted extraction
      if (!data.price || data.price === 0) {
        // Look for specific price elements first (more reliable)
        const priceSelectors = [
          // JioMart specific
          '[class*="selling"] [class*="price"]',
          '[class*="offer-price"]',
          '[class*="finalPrice"]',
          '[class*="discounted"]',
          // Price near "Add to Cart" button
          '[class*="addToCart"]',
          '[class*="product-price"]'
        ];
        
        for (const selector of priceSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent;
            const match = text.match(/₹\s*([\d,]+)/);
            if (match) {
              const price = parseInt(match[1].replace(/,/g, ''));
              if (price >= 10) {  // Reasonable product price
                data.price = price;
                data.priceText = `₹${price}`;
                break;
              }
            }
          }
        }
        
        // If still no price, look in price container with better context
        if (!data.price || data.price === 0) {
          // Look for "₹XX" followed by MRP indicator
          const pricePattern = /₹\s*(\d{2,5})\s*(?:₹|MRP|was|\/)/i;
          const bodyText = document.body.textContent;
          const match = bodyText.match(pricePattern);
          if (match) {
            data.price = parseInt(match[1]);
            data.priceText = `₹${data.price}`;
          }
        }

        // Final fallback - look near "Add to Cart"
        if (!data.price || data.price === 0) {
          const addToCartBtns = document.querySelectorAll('button, [class*="addToCart"]');
          let addToCart = null;
          addToCartBtns.forEach(btn => {
            if (btn.textContent && btn.textContent.toLowerCase().includes('add to cart')) {
              addToCart = btn;
            }
          });
          if (addToCart) {
            const parent = addToCart.closest('[class*="product"], [class*="pdp"], section');
            if (parent) {
              const priceMatches = parent.textContent.match(/₹\s*(\d{2,5})/g);
              if (priceMatches && priceMatches.length > 0) {
                const prices = priceMatches
                  .map(p => parseInt(p.replace(/[₹,\s]/g, '')))
                  .filter(p => p >= 20 && p < 50000);
                if (prices.length > 0) {
                  const sortedPrices = [...new Set(prices)].sort((a, b) => a - b);
                  data.price = sortedPrices[0];
                  data.priceText = `₹${data.price}`;
                  if (sortedPrices.length > 1) {
                    data.originalPrice = sortedPrices[1];
                    data.originalPriceText = `₹${data.originalPrice}`;
                  }
                }
              }
            }
          }
        }
      }
      
      // Calculate discount if we have both prices
      if (data.originalPrice && data.price && data.originalPrice > data.price && !data.discount) {
        data.discount = `${Math.round((1 - data.price / data.originalPrice) * 100)}% off`;
      }

      // DOM fallback for images
      if (data.images.length === 0) {
        const imgSet = new Set();
        document.querySelectorAll('img[src*="catalog"]').forEach(img => {
          let src = img.src || img.dataset?.src;
          if (src && !src.includes('data:image')) {
            src = src.replace(/t\.resize\(w:\d+\)/, 't.resize(w:800)');
            imgSet.add(src);
          }
        });
        data.images = [...imgSet];
        data.image = data.images[0] || null;
      }

      // DOM fallback for rating
      if (!data.rating) {
        const bodyText = document.body.textContent;
        const ratingPattern = /([\d.]+)\s*\((\d+)\s*(?:Ratings?|Reviews?)?\)/i;
        const match = bodyText.match(ratingPattern);
        if (match) {
          data.rating = match[1];
          data.reviewCount = parseInt(match[2]);
        }
      }

      // Check DOM for "Currently unavailable" text - this overrides APP_DATA
      // JioMart shows this text when product is unavailable at the current location
      const pageText = document.body.textContent;
      const hasUnavailableText = pageText.includes('Currently unavailable') || 
                                  pageText.includes('currently unavailable');
      
      if (hasUnavailableText) {
        // Explicitly unavailable - clear everything
        data.inStock = false;
        data.availability = 'Currently Unavailable';
        data.price = null;
        data.priceText = null;
        data.originalPrice = null;
        data.originalPriceText = null;
        data.discount = null;
      }

      // DOM fallback for brand
      if (!data.brand) {
        const brandMatch = document.body.textContent.match(/Brand\s*[:\-]?\s*([A-Za-z0-9\s]+?)(?:Sold|Country|Article|$)/i);
        if (brandMatch && brandMatch[1]) {
          data.brand = brandMatch[1].trim();
        }
      }

      return data;
    });

    return productData;
  }

  /**
   * Scrape homepage - extract categories, featured products, banners
   */
  async scrapeHomepage(html) {
    const $ = cheerio.load(html);
    
    // Extract categories from navigation and category sections
    const categories = [];
    const categorySelectors = [
      'a[href*="/c/"]',
      'a[href*="/category"]', 
      'a[href*="/sections/"]',
      '[class*="category"] a',
      '[class*="nav"] a',
      '[class*="menu"] a',
      'nav a',
      'header a'
    ];
    
    for (const selector of categorySelectors) {
      $(selector).each((_, el) => {
        const name = cleanText($(el).text());
        const link = $(el).attr('href');
        if (name && name.length > 1 && name.length < 50 && link) {
          categories.push({ name, link: this.absoluteUrl(link) });
        }
      });
    }
    
    // Extract featured/promoted products using browser evaluation for better link extraction
    let featuredProducts = [];
    try {
      // Wait for page to be stable before extracting
      await this.page.waitForTimeout(2000);
      featuredProducts = await this.extractProductsFromPage();
    } catch (e) {
      logger.warn(`Browser extraction failed, falling back to HTML parsing: ${e.message}`);
      featuredProducts = this.extractProductsFromHtml($, categories);
    }
    
    // Extract banners/promotions
    const banners = [];
    $('img[src*="banner"], img[src*="promo"], img[src*="hero"], [class*="banner"] img, [class*="carousel"] img, [class*="slider"] img, [class*="hero"] img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      const alt = $(el).attr('alt') || '';
      if (src && !src.includes('data:image') && src.length > 10) {
        banners.push({ image: src, alt: cleanText(alt) });
      }
    });
    
    // Extract section titles
    const sections = [];
    $('h2, h3, [class*="section-title"], [class*="heading"], [class*="widget-title"]').each((_, el) => {
      const title = cleanText($(el).text());
      if (title && title.length > 2 && title.length < 100) {
        sections.push(title);
      }
    });
    
    // Extract all links for navigation purposes
    const allLinks = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = cleanText($(el).text());
      if (href && href.startsWith('/') && text && text.length > 1 && text.length < 50) {
        allLinks.push({ text, link: this.absoluteUrl(href) });
      }
    });
    
    // Deduplicate
    const uniqueCategories = [...new Map(categories.map(c => [c.name, c])).values()].slice(0, 50);
    const uniqueSections = [...new Set(sections)].slice(0, 30);
    const uniqueLinks = [...new Map(allLinks.map(l => [l.text, l])).values()].slice(0, 100);
    
    return {
      type: 'homepage',
      categories: uniqueCategories,
      products: featuredProducts.slice(0, 100), // Get up to 100 products
      banners: banners.slice(0, 15),
      sections: uniqueSections,
      navigation: uniqueLinks,
      totalCategories: uniqueCategories.length,
      totalProducts: featuredProducts.length,
      totalLinks: uniqueLinks.length
    };
  }

  /**
   * Extract products using browser context (handles JavaScript-rendered content)
   */
  async extractProductsFromPage() {
    const baseUrl = this.page.url();
    
    const products = await this.page.evaluate((baseUrl) => {
      const items = [];
      const seenTitles = new Set();
      
      // JioMart specific selectors based on their actual DOM structure
      const cardSelectors = [
        '[class*="productCard__cardWrapper"]',
        '[class*="cardWrapper"]',
        '[class*="product-card"]',
        '[class*="plp-card"]'
      ];
      
      let allCards = [];
      for (const selector of cardSelectors) {
        try {
          const found = document.querySelectorAll(selector);
          if (found.length > 0) {
            allCards.push(...Array.from(found));
          }
        } catch {
          // Skip invalid selectors
        }
      }
      
      // Remove duplicates
      const uniqueCards = [...new Set(allCards)];
      console.log(`Found ${uniqueCards.length} product cards`);
      
      uniqueCards.forEach(card => {
        // Get title from various possible locations
        const titleEl = card.querySelector('[class*="productName"], [class*="product-name"], [class*="title"], h3, h4');
        let title = titleEl ? titleEl.textContent.trim() : null;
        
        // Fallback: get title from card text (clean up)
        if (!title) {
          const cardText = card.textContent;
          // Extract title before price symbols
          const titleMatch = cardText.match(/^(?:Add)?(?:\d+\s*Pack)?(.+?)(?:₹|$)/);
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
          }
        }
        
        if (!title || title.length < 3 || title.length > 300) return;
        if (seenTitles.has(title)) return;
        seenTitles.add(title);
        
        // Get image
        const imgEl = card.querySelector('img');
        const image = imgEl ? (imgEl.src || imgEl.dataset?.src) : null;
        
        // Get link - JioMart wraps cards in anchors or has product URLs
        let link = null;
        const anchorEl = card.querySelector('a[href*="/product/"]') || card.closest('a[href*="/product/"]');
        if (anchorEl) {
          link = anchorEl.href;
        }
        if (!link) {
          // Try any anchor
          const anyAnchor = card.querySelector('a[href]') || card.closest('a');
          if (anyAnchor && anyAnchor.href && !anyAnchor.href.includes('javascript:')) {
            link = anyAnchor.href;
          }
        }
        
        // Get prices from PriceContainer
        const priceContainer = card.querySelector('[class*="PriceContainer"], [class*="priceContainer"], [class*="price"]');
        let currentPrice = null;
        let originalPrice = null;
        let currentPriceText = null;
        let originalPriceText = null;
        
        if (priceContainer) {
          const priceText = priceContainer.textContent;
          const allPrices = priceText.match(/₹[\d,]+/g);
          
          if (allPrices && allPrices.length >= 2) {
            // First is usually current, second is MRP
            const prices = allPrices.map(p => parseInt(p.replace(/[₹,]/g, '')));
            currentPrice = Math.min(...prices);
            originalPrice = Math.max(...prices);
            currentPriceText = `₹${currentPrice.toLocaleString('en-IN')}`;
            originalPriceText = `₹${originalPrice.toLocaleString('en-IN')}`;
          } else if (allPrices && allPrices.length === 1) {
            currentPrice = parseInt(allPrices[0].replace(/[₹,]/g, ''));
            currentPriceText = allPrices[0];
          }
        }
        
        // Calculate discount
        let discount = null;
        if (originalPrice && currentPrice && originalPrice > currentPrice) {
          discount = `${Math.round((1 - currentPrice / originalPrice) * 100)}% off`;
        }
        
        // Get unit/pack info
        const unitEl = card.querySelector('[class*="pack"], [class*="unit"], [class*="qty"]');
        const unit = unitEl ? unitEl.textContent.trim() : null;
        
        // Get rating if available
        const ratingEl = card.querySelector('[class*="rating"], [class*="star"]');
        const rating = ratingEl ? ratingEl.textContent.trim() : null;
        
        items.push({
          title,
          price: currentPrice,
          priceText: currentPriceText,
          originalPrice,
          originalPriceText,
          discount,
          link,
          image,
          rating,
          unit
        });
      });
      
      return items;
    }, baseUrl);
    
    // Convert relative links to absolute
    return products.map(p => ({
      ...p,
      link: p.link ? this.absoluteUrl(p.link) : null
    }));
  }

  /**
   * Fallback: Extract products from HTML (cheerio)
   */
  extractProductsFromHtml($, categories) {
    const featuredProducts = [];
    const productSelectors = [
      '.plp-card',
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[class*="item-card"]',
      '[data-product]',
      '[class*="carousel-item"]',
      '[class*="slider-item"]',
      '[class*="card"]'
    ];
    
    for (const selector of productSelectors) {
      $(selector).each((_, el) => {
        const card = $(el);
        const title = cleanText(
          card.find('h3, h4, h5, [class*="name"], [class*="title"], [class*="product-name"]').first().text()
        );
        
        const priceData = this.extractPricesFromCard(card);
        
        // Extract product link
        let link = null;
        card.find('a').each((_, a) => {
          const href = $(a).attr('href');
          if (href && href !== '#' && !href.startsWith('javascript:') && href.length > 1) {
            link = href;
            return false;
          }
        });
        
        const image = card.find('img').first().attr('src') || card.find('img').first().attr('data-src');
        const rating = cleanText(card.find('[class*="rating"], [class*="star"]').first().text()) || null;
        const discount = cleanText(card.find('[class*="discount"], [class*="off"]').first().text());
        const unit = cleanText(card.find('[class*="unit"], [class*="qty"], [class*="weight"]').first().text());
        
        if (title && title.length > 2 && !categories.some(c => c.name === title)) {
          featuredProducts.push({
            title,
            price: priceData.price,
            priceText: priceData.priceText,
            originalPrice: priceData.originalPrice,
            originalPriceText: priceData.originalPriceText,
            discount: discount || priceData.discount,
            link: this.absoluteUrl(link),
            image,
            rating,
            unit: unit || null
          });
        }
      });
    }
    
    return featuredProducts;
  }

  /**
   * Extract prices from a product card - separates current price from original/MRP
   */
  extractPricesFromCard(card) {
    // Try to find separate price elements first
    const currentPriceSelectors = [
      '[class*="selling-price"]',
      '[class*="final-price"]',
      '[class*="sale-price"]',
      '[class*="offer-price"]',
      '[class*="sp"]',
      '.price:not([class*="mrp"]):not([class*="original"]):not([class*="strike"])'
    ];
    
    const originalPriceSelectors = [
      '[class*="mrp"]',
      '[class*="original-price"]',
      '[class*="strike"]',
      '[class*="was-price"]',
      '[class*="crossed"]',
      'del',
      's'
    ];
    
    let currentPrice = null;
    let currentPriceText = null;
    let originalPrice = null;
    let originalPriceText = null;
    
    // Try to get current price from specific selectors
    for (const selector of currentPriceSelectors) {
      const el = card.find(selector).first();
      if (el.length > 0) {
        currentPriceText = cleanText(el.text());
        currentPrice = parsePrice(currentPriceText);
        if (currentPrice) break;
      }
    }
    
    // Try to get original/MRP price
    for (const selector of originalPriceSelectors) {
      const el = card.find(selector).first();
      if (el.length > 0) {
        originalPriceText = cleanText(el.text());
        originalPrice = parsePrice(originalPriceText);
        if (originalPrice) break;
      }
    }
    
    // If we couldn't find separate prices, try to parse combined price text
    if (!currentPrice) {
      const allPriceText = cleanText(card.find('[class*="price"]').first().text());
      
      // Try to split combined price like "₹399₹990" or "₹399 ₹990"
      const priceMatches = allPriceText.match(/₹[\d,]+/g) || allPriceText.match(/Rs\.?\s*[\d,]+/gi);
      
      if (priceMatches && priceMatches.length >= 2) {
        // First price is usually current, second is original/MRP
        currentPriceText = priceMatches[0];
        currentPrice = parsePrice(currentPriceText);
        originalPriceText = priceMatches[1];
        originalPrice = parsePrice(originalPriceText);
      } else if (priceMatches && priceMatches.length === 1) {
        currentPriceText = priceMatches[0];
        currentPrice = parsePrice(currentPriceText);
      }
    }
    
    // Calculate discount if we have both prices
    let discount = null;
    if (originalPrice && currentPrice && originalPrice > currentPrice) {
      const discountPercent = Math.round((1 - currentPrice / originalPrice) * 100);
      discount = `${discountPercent}% off`;
    }
    
    return {
      price: currentPrice,
      priceText: currentPriceText,
      originalPrice,
      originalPriceText,
      discount
    };
  }

  /**
   * Scrape listing with pagination
   */
  async scrapeListingWithPagination(startUrl, maxPages, maxProducts) {
    const allProducts = [];
    let currentPage = 1;
    let currentUrl = startUrl;

    while (currentPage <= maxPages && allProducts.length < maxProducts) {
      logger.step(currentPage, maxPages, `Scraping page ${currentPage}`);

      const html = await this.browser.getHtml();
      const products = this.extractProducts(html);
      
      allProducts.push(...products);
      logger.info(`Found ${products.length} products on page ${currentPage}`);

      if (allProducts.length >= maxProducts) break;

      // Try to go to next page
      const nextUrl = await this.getNextPageUrl();
      if (!nextUrl || nextUrl === currentUrl) break;

      currentUrl = nextUrl;
      await this.goto(currentUrl);
      await this.handleDynamicContent();
      currentPage++;
    }

    return {
      type: 'listing',
      totalProducts: allProducts.length,
      pagesScraped: currentPage,
      products: allProducts.slice(0, maxProducts)
    };
  }

  /**
   * Extract products from listing HTML
   */
  extractProducts(html) {
    const $ = cheerio.load(html);
    const config = this.siteConfig.listing;
    const products = [];

    $(config.container).each((i, el) => {
      const card = $(el);
      
      const title = card.find(config.title).first().text();
      const priceText = card.find(config.price).first().text();
      const link = card.find(config.link).first().attr('href');
      let image = card.find(config.image).first().attr('src') ||
                  card.find(config.image).first().attr('data-src');

      if (title) {
        products.push({
          title: cleanText(title),
          price: parsePrice(priceText),
          priceText: cleanText(priceText),
          link: this.absoluteUrl(link),
          image
        });
      }
    });

    return products;
  }

  /**
   * Get next page URL
   */
  async getNextPageUrl() {
    try {
      const nextSelectors = [
        'a:has-text("Next")',
        'a:has-text(">")',
        '[class*="next"] a',
        '.pagination a[aria-label="Next"]',
        'a[rel="next"]'
      ];

      for (const selector of nextSelectors) {
        const link = this.page.locator(selector).first();
        if (await link.isVisible({ timeout: 1000 })) {
          const href = await link.getAttribute('href');
          if (href) return this.absoluteUrl(href);
        }
      }
    } catch {
      // No next page
    }
    return null;
  }

  /**
   * Helper: Extract text from multiple selectors
   */
  extractText($, selectors) {
    const selectorList = selectors.split(',').map(s => s.trim());
    for (const selector of selectorList) {
      const el = $(selector).first();
      if (el.length > 0 && el.text().trim()) {
        return cleanText(el.text());
      }
    }
    return '';
  }

  /**
   * Helper: Extract image
   */
  extractImage($, selectors) {
    const selectorList = selectors.split(',').map(s => s.trim());
    for (const selector of selectorList) {
      const el = $(selector).first();
      const src = el.attr('src') || el.attr('data-src') || el.attr('data-zoom-image');
      if (src && !src.includes('data:image')) {
        return src;
      }
    }
    return null;
  }

  /**
   * Helper: Extract all images
   */
  extractAllImages($, selectors) {
    const images = new Set();
    const selectorList = selectors.split(',').map(s => s.trim());
    
    for (const selector of selectorList) {
      $(selector).each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('data:image')) {
          images.add(src);
        }
      });
    }
    
    return [...images];
  }

  /**
   * Helper: Check if product is in stock
   */
  checkInStock($) {
    const outOfStockIndicators = [
      'out of stock',
      'unavailable',
      'sold out',
      'currently unavailable',
      'not available'
    ];
    
    const pageText = $('body').text().toLowerCase();
    return !outOfStockIndicators.some(indicator => pageText.includes(indicator));
  }

  /**
   * Helper: Convert relative URL to absolute
   */
  absoluteUrl(url) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    try {
      const pageUrl = this.page.url();
      return new URL(url, pageUrl).href;
    } catch {
      return url;
    }
  }
}

module.exports = EcommerceScraper;
