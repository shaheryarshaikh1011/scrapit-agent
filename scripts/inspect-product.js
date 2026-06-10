const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    geolocation: { latitude: 19.0760, longitude: 72.8777 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();
  
  await page.goto('https://www.jiomart.com/product/gokul-curd-500-g-pouch-mffmsx-7505607', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // Click Enable Location if present
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
  
  // Wait for content
  await page.waitForTimeout(5000);
  
  // Save HTML
  const html = await page.content();
  fs.writeFileSync('output/jiomart-product-source.html', html);
  console.log('Saved HTML');
  
  // Analyze product page structure
  const analysis = await page.evaluate(() => {
    const results = {
      h1Elements: [],
      priceElements: [],
      imageElements: [],
      ratingElements: [],
      descriptionElements: []
    };
    
    // Find h1 and potential title elements
    document.querySelectorAll('h1, [class*="title"], [class*="name"], [class*="product-name"]').forEach((el, i) => {
      if (i < 10) {
        results.h1Elements.push({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 100),
          className: el.className?.substring?.(0, 100) || ''
        });
      }
    });
    
    // Find price elements
    document.querySelectorAll('[class*="price"], [class*="amount"], [class*="mrp"]').forEach((el, i) => {
      if (i < 15) {
        results.priceElements.push({
          text: el.textContent.trim().substring(0, 50),
          className: el.className?.substring?.(0, 100) || '',
          tag: el.tagName
        });
      }
    });
    
    // Find images
    document.querySelectorAll('img[src*="product"], img[src*="catalog"], img[class*="product"], [class*="gallery"] img, [class*="pdp"] img').forEach((el, i) => {
      if (i < 10) {
        results.imageElements.push({
          src: el.src?.substring(0, 150),
          alt: el.alt,
          className: el.className?.substring?.(0, 50) || ''
        });
      }
    });
    
    // Find rating elements
    document.querySelectorAll('[class*="rating"], [class*="star"], [class*="review"]').forEach((el, i) => {
      if (i < 10) {
        results.ratingElements.push({
          text: el.textContent.trim().substring(0, 50),
          className: el.className?.substring?.(0, 100) || ''
        });
      }
    });
    
    // Find description
    document.querySelectorAll('[class*="desc"], [class*="detail"], [class*="specification"]').forEach((el, i) => {
      if (i < 10) {
        results.descriptionElements.push({
          text: el.textContent.trim().substring(0, 200),
          className: el.className?.substring?.(0, 100) || ''
        });
      }
    });
    
    return results;
  });
  
  console.log('\n=== H1 / Title Elements ===');
  console.log(JSON.stringify(analysis.h1Elements, null, 2));
  
  console.log('\n=== Price Elements ===');
  console.log(JSON.stringify(analysis.priceElements, null, 2));
  
  console.log('\n=== Image Elements ===');
  console.log(JSON.stringify(analysis.imageElements, null, 2));
  
  console.log('\n=== Rating Elements ===');
  console.log(JSON.stringify(analysis.ratingElements, null, 2));
  
  console.log('\n=== Description Elements ===');
  console.log(JSON.stringify(analysis.descriptionElements.slice(0, 5), null, 2));
  
  await browser.close();
})();
