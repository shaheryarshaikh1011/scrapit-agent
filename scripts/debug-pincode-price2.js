const { chromium } = require('playwright');

(async () => {
  const pincode = process.argv[2] || '400058'; // Andheri West
  console.log(`Testing pincode: ${pincode}`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    geolocation: { latitude: 19.0760, longitude: 72.8777 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();
  
  const productUrl = 'https://www.jiomart.com/product/gokul-curd-500-g-pouch-mffmsx-7505607';
  
  // First visit homepage to set location
  console.log('Step 1: Visit homepage to set location');
  await page.goto('https://www.jiomart.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // Handle location modal - click "Select Location Manually"
  try {
    const enableModal = page.locator('text=Enable Location Services').first();
    if (await enableModal.isVisible({ timeout: 3000 })) {
      console.log('Found Enable Location modal');
      const manualBtn = page.locator('text=Select Location Manually').first();
      if (await manualBtn.isVisible({ timeout: 2000 })) {
        await manualBtn.click();
        console.log('Clicked "Select Location Manually"');
        await page.waitForTimeout(2000);
      }
    }
  } catch (e) {
    console.log('No enable location modal');
  }
  
  // Find and use the search input for pincode
  try {
    const searchInput = page.locator('input[placeholder*="Search for area"]').first();
    if (await searchInput.isVisible({ timeout: 3000 })) {
      await searchInput.click();
      await searchInput.fill('');
      await searchInput.type(pincode, { delay: 150 });
      console.log(`Typed pincode: ${pincode}`);
      await page.waitForTimeout(3000);
      
      // Click first suggestion (Google Places autocomplete)
      const pacItem = page.locator('[class*="pac-item"]').first();
      if (await pacItem.isVisible({ timeout: 3000 })) {
        await pacItem.click();
        console.log('Clicked location suggestion');
        await page.waitForTimeout(3000);
      }
      
      // Click Confirm Location
      const confirmBtn = page.locator('button:has-text("Confirm Location")').first();
      if (await confirmBtn.isVisible({ timeout: 3000 })) {
        await confirmBtn.click();
        console.log('Clicked Confirm Location');
        await page.waitForTimeout(3000);
      }
    }
  } catch (e) {
    console.log('Pincode input error:', e.message);
  }
  
  // Now navigate to product page
  console.log('Step 2: Navigate to product page');
  await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  // Extract price data
  const priceData = await page.evaluate(() => {
    const result = {
      appData: null,
      domPrices: [],
      allPriceText: []
    };
    
    // Check APP_DATA
    try {
      if (window.APP_DATA?.reduxData?.catalog?.product_details) {
        const pd = window.APP_DATA.reduxData.catalog.product_details;
        result.appData = {
          name: pd.name,
          price: pd.price,
          sellable: pd.sellable,
          sizes: pd.sizes?.map(s => ({
            display: s.display,
            price: s.price,
            sellable: s.sellable,
            is_selected: s.is_selected
          }))
        };
      }
    } catch (e) {
      result.appData = { error: e.message };
    }
    
    // Find all price-like text on page
    const priceRegex = /₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)/g;
    const bodyText = document.body.textContent;
    let match;
    while ((match = priceRegex.exec(bodyText)) !== null) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price >= 20 && price < 10000) {
        result.allPriceText.push({ price, raw: match[0] });
      }
    }
    // Dedupe
    result.allPriceText = [...new Map(result.allPriceText.map(p => [p.price, p])).values()];
    
    return result;
  });
  
  console.log('\n=== APP_DATA Price Info ===');
  console.log(JSON.stringify(priceData.appData, null, 2));
  
  console.log('\n=== All Prices on Page ===');
  console.log(JSON.stringify(priceData.allPriceText, null, 2));
  
  // Keep browser open to inspect
  console.log('\nBrowser kept open for inspection. Press Ctrl+C to close.');
  await new Promise(() => {});
})();
