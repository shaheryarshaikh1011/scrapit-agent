const BaseScraper = require('./baseScraper');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { cleanText, parsePrice } = require('../utils/helpers');

/**
 * Generic scraper that auto-detects page content
 */
class GenericScraper extends BaseScraper {
  constructor(options = {}) {
    super(options);
    this.extractionMode = options.mode || 'auto'; // auto, product, listing, article
  }

  /**
   * Main scrape method
   */
  async scrape(url) {
    try {
      await this.init();
      await this.goto(url, { waitUntil: 'networkidle' });
      
      // Wait for dynamic content
      await this.page.waitForTimeout(2000);
      
      // Scroll to load lazy content
      await this.browser.scrollToBottom(5);
      
      const html = await this.browser.getHtml();
      const pageType = this.detectPageType(html);
      
      logger.info(`Detected page type: ${pageType}`);
      
      let data;
      switch (pageType) {
        case 'product':
          data = await this.scrapeProduct(html);
          break;
        case 'listing':
          data = await this.scrapeProductListing(html);
          break;
        case 'article':
          data = await this.scrapeArticle(html);
          break;
        default:
          data = await this.scrapeGeneric(html);
      }

      return {
        url,
        pageType,
        scrapedAt: new Date().toISOString(),
        ...data
      };

    } catch (error) {
      await this.handleError(error, 'Scrape failed');
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * Detect page type based on content
   */
  detectPageType(html) {
    if (this.extractionMode !== 'auto') {
      return this.extractionMode;
    }

    const $ = cheerio.load(html);
    const text = $('body').text().toLowerCase();
    
    // Product page indicators
    const productIndicators = [
      $('[data-product-id]').length > 0,
      $('[itemprop="price"]').length > 0,
      $('button:contains("Add to Cart")').length > 0,
      $('button:contains("Buy Now")').length > 0,
      $('.add-to-cart, .addtocart, #add-to-cart').length > 0,
      text.includes('add to cart') || text.includes('buy now'),
      $('[class*="product-price"], [class*="price"]').length > 0
    ];
    
    if (productIndicators.filter(Boolean).length >= 2) {
      // Check if single product or listing
      const productCards = $(
        '[class*="product-card"], [class*="product-item"], ' +
        '[data-product], .product, [class*="grid-item"]'
      ).length;
      
      return productCards > 3 ? 'listing' : 'product';
    }

    // Article indicators
    const articleIndicators = [
      $('article').length > 0,
      $('[itemprop="articleBody"]').length > 0,
      $('time[datetime]').length > 0,
      $('[class*="author"]').length > 0,
      $('h1').length === 1 && $('p').length > 5
    ];
    
    if (articleIndicators.filter(Boolean).length >= 2) {
      return 'article';
    }

    return 'generic';
  }

  /**
   * Scrape single product page
   */
  async scrapeProduct(html) {
    const $ = cheerio.load(html);
    
    // Try multiple selectors for each field
    const title = this.extractFirst($, [
      '[itemprop="name"]',
      'h1',
      '[class*="product-title"]',
      '[class*="product-name"]',
      '[data-testid*="title"]',
      '.pdp-title',
      '.product-title'
    ]);

    const price = this.extractPrice($, [
      '[itemprop="price"]',
      '[class*="price"]:not([class*="original"]):not([class*="was"])',
      '[data-price]',
      '.pdp-price',
      '.product-price',
      '.selling-price',
      '#priceblock_ourprice',
      '.a-price .a-offscreen'
    ]);

    const originalPrice = this.extractPrice($, [
      '[class*="original-price"]',
      '[class*="was-price"]',
      '[class*="mrp"]',
      '.price-old',
      'del',
      's'
    ]);

    const description = this.extractFirst($, [
      '[itemprop="description"]',
      '[class*="product-description"]',
      '[class*="description"]',
      '#productDescription',
      '.pdp-description'
    ]);

    const images = this.extractImages($, [
      '[itemprop="image"]',
      '[class*="product-image"] img',
      '[class*="gallery"] img',
      '.pdp-image img',
      '[data-zoom-image]'
    ]);

    const rating = this.extractFirst($, [
      '[itemprop="ratingValue"]',
      '[class*="rating"]',
      '[class*="star"]',
      '.review-rating'
    ]);

    const availability = this.extractFirst($, [
      '[itemprop="availability"]',
      '[class*="availability"]',
      '[class*="stock"]',
      '.in-stock, .out-of-stock'
    ]);

    const brand = this.extractFirst($, [
      '[itemprop="brand"]',
      '[class*="brand"]',
      '.product-brand'
    ]);

    const sku = this.extractFirst($, [
      '[itemprop="sku"]',
      '[class*="sku"]',
      '[data-sku]'
    ]);

    // Extract specifications/features
    const specs = this.extractSpecs($);

    return {
      type: 'product',
      title: cleanText(title),
      price,
      originalPrice,
      discount: originalPrice && price ? Math.round((1 - price / originalPrice) * 100) : null,
      description: cleanText(description),
      images,
      rating: cleanText(rating),
      availability: cleanText(availability),
      brand: cleanText(brand),
      sku: cleanText(sku),
      specifications: specs
    };
  }

  /**
   * Scrape product listing page
   */
  async scrapeProductListing(html) {
    const $ = cheerio.load(html);
    const products = [];

    // Common product card selectors
    const cardSelectors = [
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[data-product]',
      '.product',
      '[class*="grid-item"]',
      '[class*="plp-card"]',
      'li[class*="product"]',
      '[data-testid*="product"]'
    ];

    let cards = $();
    for (const selector of cardSelectors) {
      cards = $(selector);
      if (cards.length > 0) break;
    }

    cards.each((i, el) => {
      const card = $(el);
      
      const title = card.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text();
      const priceText = card.find('[class*="price"]').first().text();
      const link = card.find('a').first().attr('href');
      const image = card.find('img').first().attr('src') || 
                    card.find('img').first().attr('data-src');
      const rating = card.find('[class*="rating"], [class*="star"]').first().text();

      if (title || priceText) {
        products.push({
          title: cleanText(title),
          price: parsePrice(priceText),
          priceText: cleanText(priceText),
          link,
          image,
          rating: cleanText(rating)
        });
      }
    });

    // Extract pagination info
    const totalPages = this.extractPagination($);

    return {
      type: 'listing',
      totalProducts: products.length,
      pagination: totalPages,
      products
    };
  }

  /**
   * Scrape article page
   */
  async scrapeArticle(html) {
    const $ = cheerio.load(html);

    const title = this.extractFirst($, ['h1', '[itemprop="headline"]', '.article-title']);
    const author = this.extractFirst($, ['[itemprop="author"]', '[class*="author"]', '.byline']);
    const date = this.extractFirst($, ['time[datetime]', '[itemprop="datePublished"]', '[class*="date"]']);
    const content = this.extractFirst($, ['article', '[itemprop="articleBody"]', '.article-content', '.post-content']);
    const images = this.extractImages($, ['article img', '.article-content img']);

    return {
      type: 'article',
      title: cleanText(title),
      author: cleanText(author),
      date: cleanText(date),
      content: cleanText(content),
      images,
      wordCount: cleanText(content).split(/\s+/).length
    };
  }

  /**
   * Generic page scrape
   */
  async scrapeGeneric(html) {
    const $ = cheerio.load(html);

    const title = $('title').text() || $('h1').first().text();
    const metaDescription = $('meta[name="description"]').attr('content');
    const headings = [];
    
    $('h1, h2, h3').each((i, el) => {
      headings.push({
        level: el.name,
        text: cleanText($(el).text())
      });
    });

    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const text = cleanText($(el).text());
      if (href && text && !href.startsWith('#')) {
        links.push({ href, text });
      }
    });

    const images = this.extractImages($, ['img']);

    return {
      type: 'generic',
      title: cleanText(title),
      metaDescription: cleanText(metaDescription),
      headings,
      links: links.slice(0, 100), // Limit links
      images,
      html: html.substring(0, 50000) // First 50KB of HTML
    };
  }

  /**
   * Helper: Extract first matching content
   */
  extractFirst($, selectors) {
    for (const selector of selectors) {
      const el = $(selector).first();
      if (el.length > 0) {
        return el.text() || el.attr('content') || '';
      }
    }
    return '';
  }

  /**
   * Helper: Extract price from multiple selectors
   */
  extractPrice($, selectors) {
    for (const selector of selectors) {
      const el = $(selector).first();
      if (el.length > 0) {
        const text = el.text() || el.attr('content') || '';
        const price = parsePrice(text);
        if (price) return price;
      }
    }
    return null;
  }

  /**
   * Helper: Extract images
   */
  extractImages($, selectors) {
    const images = new Set();
    
    for (const selector of selectors) {
      $(selector).each((i, el) => {
        const src = $(el).attr('src') || 
                   $(el).attr('data-src') || 
                   $(el).attr('data-lazy-src');
        if (src && !src.includes('data:image')) {
          images.add(src);
        }
      });
    }
    
    return [...images].slice(0, 20);
  }

  /**
   * Helper: Extract specifications
   */
  extractSpecs($) {
    const specs = {};
    
    // Table format
    $('table tr, [class*="spec"] tr').each((i, row) => {
      const cells = $(row).find('td, th');
      if (cells.length >= 2) {
        const key = cleanText(cells.eq(0).text());
        const value = cleanText(cells.eq(1).text());
        if (key && value) {
          specs[key] = value;
        }
      }
    });

    // Definition list format
    $('dl').each((i, dl) => {
      $(dl).find('dt').each((j, dt) => {
        const key = cleanText($(dt).text());
        const value = cleanText($(dt).next('dd').text());
        if (key && value) {
          specs[key] = value;
        }
      });
    });

    return specs;
  }

  /**
   * Helper: Extract pagination info
   */
  extractPagination($) {
    const pageNumbers = [];
    
    $('[class*="pagination"] a, [class*="pager"] a, .page-number').each((i, el) => {
      const text = $(el).text();
      const num = parseInt(text);
      if (!isNaN(num)) {
        pageNumbers.push(num);
      }
    });

    return pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
  }
}

module.exports = GenericScraper;
