const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    geolocation: { latitude: 19.0760, longitude: 72.8777 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();
  
  await page.goto('https://www.jiomart.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // Click Enable Location
  try {
    const enableBtn = page.locator('button:has-text("Enable Location")').first();
    if (await enableBtn.isVisible({ timeout: 3000 })) {
      await enableBtn.click();
      console.log('Clicked Enable Location');
      await page.waitForTimeout(5000);
    }
  } catch (e) {
    console.log('No enable location button');
  }
  
  // Wait for content to load and scroll
  console.log('Waiting for page to fully load...');
  await page.waitForTimeout(8000);
  
  // Scroll to load content
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1000);
  }
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);
  
  // Save HTML
  const html = await page.content();
  fs.writeFileSync('output/jiomart-source.html', html);
  console.log('Saved HTML to output/jiomart-source.html');
  console.log('HTML length:', html.length);
  
  // Analyze product structure
  const analysis = await page.evaluate(() => {
    const results = {
      allAnchors: [],
      productCards: [],
      priceElements: []
    };
    
    // Find all anchor tags with product-like URLs
    document.querySelectorAll('a[href*="/product/"], a[href*="/p/"]').forEach((a, i) => {
      if (i < 20) {
        results.allAnchors.push({
          href: a.href,
          text: a.textContent.trim().substring(0, 50),
          className: a.className
        });
      }
    });
    
    // Find elements with price
    document.querySelectorAll('[class*="price"], [class*="amount"]').forEach((el, i) => {
      if (i < 20) {
        results.priceElements.push({
          text: el.textContent.trim().substring(0, 50),
          className: el.className,
          parentTag: el.parentElement?.tagName,
          parentClass: el.parentElement?.className?.substring(0, 50)
        });
      }
    });
    
    // Find product card structures
    const cardSelectors = ['[class*="card"]', '[class*="product"]', '[class*="item"]'];
    for (const sel of cardSelectors) {
      document.querySelectorAll(sel).forEach((card, i) => {
        const hasPrice = card.textContent.includes('₹');
        const img = card.querySelector('img');
        const anchor = card.querySelector('a[href]');
        
        if (hasPrice && img && results.productCards.length < 10) {
          results.productCards.push({
            selector: sel,
            className: card.className.substring(0, 100),
            hasPrice: hasPrice,
            imgSrc: img?.src?.substring(0, 100),
            anchorHref: anchor?.href,
            textSample: card.textContent.trim().substring(0, 100)
          });
        }
      });
    }
    
    return results;
  });
  
  console.log('\n=== Product Anchors ===');
  console.log(JSON.stringify(analysis.allAnchors, null, 2));
  
  console.log('\n=== Price Elements ===');
  console.log(JSON.stringify(analysis.priceElements.slice(0, 10), null, 2));
  
  console.log('\n=== Product Cards ===');
  console.log(JSON.stringify(analysis.productCards, null, 2));
  
  await browser.close();
})();
