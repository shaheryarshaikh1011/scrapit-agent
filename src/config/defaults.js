module.exports = {
  // Timeouts
  NAVIGATION_TIMEOUT: 60000,
  ELEMENT_TIMEOUT: 30000,
  
  // Delays (anti-detection)
  MIN_DELAY: 1000,
  MAX_DELAY: 3000,
  SCROLL_DELAY: 500,
  
  // Viewports (randomized)
  VIEWPORTS: [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 }
  ],
  
  // Retry config
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000,
  
  // Browser settings
  HEADLESS: true,
  
  // Output
  OUTPUT_DIR: './output',
  SCREENSHOT_ON_ERROR: true
};
