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
  
  // Analyze size/variant structure
  const analysis = await page.evaluate(() => {
    const results = {
      sizeButtons: [],
      allButtons: [],
      sizeDivs: []
    };
    
    // Find all elements with "Size" text nearby
    document.querySelectorAll('*').forEach(el => {
      if (el.textContent.includes('Size') && el.children.length < 5) {
        const parent = el.parentElement;
        if (parent) {
          results.sizeDivs.push({
            text: el.textContent.trim().substring(0, 100),
            className: el.className?.substring?.(0, 80) || '',
            parentClass: parent.className?.substring?.(0, 80) || '',
            parentHTML: parent.innerHTML?.substring?.(0, 300)
          });
        }
      }
    });
    
    // Find buttons containing price or size info
    document.querySelectorAll('button, [role="button"]').forEach((btn, i) => {
      const text = btn.textContent.trim();
      if (text.includes('₹') || text.match(/\d+\s*[gkml]/i)) {
        results.sizeButtons.push({
          text: text.substring(0, 100),
          className: btn.className?.substring?.(0, 100) || '',
          tagName: btn.tagName,
          parentClass: btn.parentElement?.className?.substring?.(0, 80) || ''
        });
      }
      // Also capture all buttons for reference
      if (i < 20) {
        results.allButtons.push({
          text: text.substring(0, 50),
          className: btn.className?.substring?.(0, 50) || ''
        });
      }
    });
    
    return results;
  });
  
  console.log('\n=== Size Buttons ===');
  console.log(JSON.stringify(analysis.sizeButtons, null, 2));
  
  console.log('\n=== Size Divs ===');
  console.log(JSON.stringify(analysis.sizeDivs.slice(0, 5), null, 2));
  
  console.log('\n=== All Buttons (first 20) ===');
  console.log(JSON.stringify(analysis.allButtons, null, 2));
  
  await browser.close();
})();
