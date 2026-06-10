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

      return {
        url: currentUrl,
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
    // Scroll to trigger lazy loading - do more scrolls for JioMart
    if (this.siteConfig.lazyLoad) {
      await this.browser.scrollToBottom(10);
    }

    // Wait longer for images and products to load
    await this.page.waitForTimeout(3000);

    // Click "Load More" buttons if present
    try {
      const loadMoreSelectors = [
        'button:has-text("Load More")',
        'button:has-text("View More")',
        'button:has-text("Show More")',
        '[class*="load-more"]',
        '[class*="view-more"]',
        '[class*="show-more"]'
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
      featuredProducts: featuredProducts.slice(0, 30),
      banners: banners.slice(0, 15),
      sections: uniqueSections,
      navigation: uniqueLinks,
      totalCategories: uniqueCategories.length,
      totalFeaturedProducts: featuredProducts.length,
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
      
      // Find all product card-like elements
      const cardSelectors = [
        '[class*="product-card"]',
        '[class*="plp-card"]',
        '[class*="item-card"]',
        '[data-product]',
        '[class*="card"]'
      ];
      
      let cards = [];
      for (const selector of cardSelectors) {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          cards = Array.from(found);
          break;
        }
      }
      
      cards.forEach(card => {
        // Get title
        const titleEl = card.querySelector('h3, h4, h5, [class*="name"], [class*="title"]');
        const title = titleEl ? titleEl.textContent.trim() : null;
        
        if (!title || title.length < 3) return;
        
        // Get image
        const imgEl = card.querySelector('img');
        const image = imgEl ? (imgEl.src || imgEl.dataset.src) : null;
        
        // Get link - multiple approaches
        let link = null;
        
        // 1. Check for anchor tags with valid href
        const anchors = card.querySelectorAll('a[href]');
        for (const a of anchors) {
          if (a.href && !a.href.includes('javascript:') && a.href !== '#' && a.href.length > baseUrl.length) {
            link = a.href;
            break;
          }
        }
        
        // 2. Check if card itself or parent is an anchor
        if (!link) {
          const parentAnchor = card.closest('a[href]');
          if (parentAnchor && parentAnchor.href && !parentAnchor.href.includes('javascript:')) {
            link = parentAnchor.href;
          }
        }
        
        // 3. Check for data attributes that might contain product ID or URL
        if (!link) {
          const productId = card.dataset.productId || card.dataset.id || card.dataset.sku || 
                           card.getAttribute('data-product-id') || card.getAttribute('data-item-id');
          if (productId) {
            // Try to construct URL from product ID
            link = `/product/${productId}`;
          }
        }
        
        // 4. Check for onclick handlers that might reveal product URL
        if (!link) {
          const clickableEl = card.querySelector('[onclick]') || (card.hasAttribute('onclick') ? card : null);
          if (clickableEl) {
            const onclick = clickableEl.getAttribute('onclick');
            const urlMatch = onclick?.match(/['"](\/[^'"]+)['"]/);
            if (urlMatch) {
              link = urlMatch[1];
            }
          }
        }
        
        // 5. Try to find hidden links or product URLs in any data attributes
        if (!link) {
          const allElements = card.querySelectorAll('*');
          for (const el of allElements) {
            for (const attr of el.attributes) {
              if (attr.value.includes('/product/') || attr.value.includes('/p/') || attr.value.includes('/dp/')) {
                link = attr.value;
                break;
              }
            }
            if (link) break;
          }
        }
        
        // Get all price-related text
        const priceEls = card.querySelectorAll('[class*="price"], [class*="amount"]');
        let currentPrice = null;
        let originalPrice = null;
        let currentPriceText = null;
        let originalPriceText = null;
        
        priceEls.forEach(priceEl => {
          const text = priceEl.textContent.trim();
          const priceMatch = text.match(/₹[\d,]+/);
          if (priceMatch) {
            const price = parseInt(priceMatch[0].replace(/[₹,]/g, ''));
            const classList = priceEl.className.toLowerCase();
            
            if (classList.includes('mrp') || classList.includes('original') || classList.includes('strike')) {
              if (!originalPrice || price > originalPrice) {
                originalPrice = price;
                originalPriceText = priceMatch[0];
              }
            } else {
              if (!currentPrice || price < currentPrice) {
                currentPrice = price;
                currentPriceText = priceMatch[0];
              }
            }
          }
        });
        
        // If we only found one price, check if there's combined text
        if (currentPrice && !originalPrice) {
          const allText = card.textContent;
          const allPrices = allText.match(/₹[\d,]+/g);
          if (allPrices && allPrices.length >= 2) {
            const prices = allPrices.map(p => parseInt(p.replace(/[₹,]/g, '')));
            currentPrice = Math.min(...prices);
            originalPrice = Math.max(...prices);
            currentPriceText = `₹${currentPrice.toLocaleString('en-IN')}`;
            originalPriceText = `₹${originalPrice.toLocaleString('en-IN')}`;
          }
        }
        
        // Get rating
        const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [data-rating]');
        let rating = null;
        if (ratingEl) {
          rating = ratingEl.dataset.rating || ratingEl.getAttribute('aria-label') || ratingEl.textContent.trim();
          if (rating && rating.length > 50) rating = null;
        }
        
        // Get discount
        const discountEl = card.querySelector('[class*="discount"], [class*="off"], [class*="save"]');
        let discount = discountEl ? discountEl.textContent.trim() : null;
        if (!discount && originalPrice && currentPrice && originalPrice > currentPrice) {
          discount = `${Math.round((1 - currentPrice / originalPrice) * 100)}% off`;
        }
        
        // Get unit/quantity
        const unitEl = card.querySelector('[class*="unit"], [class*="qty"], [class*="weight"], [class*="size"], [class*="pack"]');
        const unit = unitEl ? unitEl.textContent.trim() : null;
        
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
