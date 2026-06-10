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
      location = null  // Default location for sites that require it
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
      await this.handleSitePopups(url, location);

      // Wait for dynamic content and handle lazy loading
      await this.handleDynamicContent();

      const html = await this.browser.getHtml();
      const pageType = type === 'auto' ? this.detectPageType(html) : type;

      let data;
      if (pageType === 'listing') {
        data = await this.scrapeListingWithPagination(url, maxPages, maxProducts);
      } else {
        data = await this.scrapeProductPage(html);
      }

      return {
        url,
        site: this.siteConfig.name,
        pageType,
        scrapedAt: new Date().toISOString(),
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
   * Handle JioMart location modal - try to dismiss/close location popups
   */
  async handleJioMartLocation(location) {
    try {
      // Wait a bit for modals to appear
      await this.page.waitForTimeout(2000);
      
      // Try to dismiss any location-related popups by closing them
      // This is simpler and more reliable than trying to fill in location
      await this.dismissJioMartPopups();
      
    } catch (error) {
      logger.warn(`Could not handle JioMart location modal: ${error.message}`);
    }
  }

  /**
   * Dismiss JioMart popups by clicking X/close/back buttons
   */
  async dismissJioMartPopups() {
    // Try multiple times as there can be multiple popups
    for (let attempt = 0; attempt < 5; attempt++) {
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
        // Back buttons (the < button in the screenshot)
        'button:has-text("<")',
        '[class*="back-btn"]',
        '[class*="back-arrow"]',
        '[aria-label*="back"]',
        '[aria-label*="Back"]',
        // Generic X or × character buttons
        'button:has-text("×")',
        'button:has-text("✕")',
        'button:has-text("X")',
        // SVG close icons
        'svg[class*="close"]',
        'svg[class*="cross"]',
        // Modal overlay click to dismiss
        '[class*="modal-backdrop"]',
        '[class*="overlay"]'
      ];
      
      for (const selector of closeSelectors) {
        try {
          const closeBtn = this.page.locator(selector).first();
          if (await closeBtn.isVisible({ timeout: 1000 })) {
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
      
      // Also try pressing Escape key to close modals
      if (!dismissed) {
        try {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(500);
          
          // Check if any modal is still visible
          const modalVisible = await this.page.locator('[class*="modal"], [class*="popup"], [class*="dialog"]').first().isVisible({ timeout: 500 }).catch(() => false);
          if (!modalVisible) {
            logger.info('Dismissed popup using Escape key');
            dismissed = true;
          }
        } catch {
          // Ignore
        }
      }
      
      // If nothing was dismissed, we're probably done
      if (!dismissed) {
        break;
      }
    }
    
    // Final wait for page to settle
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
    // Scroll to trigger lazy loading
    if (this.siteConfig.lazyLoad) {
      await this.browser.scrollToBottom(5);
    }

    // Wait for images to load
    await this.page.waitForTimeout(2000);

    // Click "Load More" buttons if present
    try {
      const loadMoreSelectors = [
        'button:has-text("Load More")',
        'button:has-text("View More")',
        '[class*="load-more"]',
        '[class*="view-more"]'
      ];

      for (const selector of loadMoreSelectors) {
        const button = this.page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          await button.click();
          await this.page.waitForTimeout(2000);
        }
      }
    } catch {
      // No load more button
    }
  }

  /**
   * Detect if page is product or listing
   */
  detectPageType(html) {
    const $ = cheerio.load(html);
    const listingSelector = this.siteConfig.listing.container;
    const productCards = $(listingSelector).length;
    
    return productCards > 2 ? 'listing' : 'product';
  }

  /**
   * Scrape single product page
   */
  async scrapeProductPage(html) {
    const $ = cheerio.load(html);
    const config = this.siteConfig.product;

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
