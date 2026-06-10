/**
 * Stealth scripts to inject into page to avoid detection
 */

const STEALTH_SCRIPTS = `
  // Override webdriver property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  });

  // Override plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' }
    ]
  });

  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en']
  });

  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // Override chrome
  window.chrome = {
    runtime: {},
    loadTimes: function() {},
    csi: function() {},
    app: {}
  };

  // Fix iframe detection
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() {
      return window;
    }
  });

  // Override toString for functions
  const originalFunction = window.Function.prototype.toString;
  window.Function.prototype.toString = function() {
    if (this === window.navigator.permissions.query) {
      return 'function query() { [native code] }';
    }
    return originalFunction.call(this);
  };

  // Canvas fingerprint protection
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attributes) {
    const context = originalGetContext.call(this, type, attributes);
    if (type === '2d') {
      const originalGetImageData = context.getImageData;
      context.getImageData = function(sx, sy, sw, sh) {
        const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
        // Add subtle noise
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.99 ? 1 : 0);
        }
        return imageData;
      };
    }
    return context;
  };

  // WebGL fingerprint protection  
  const getParameterProxyHandler = {
    apply: function(target, thisArg, args) {
      const param = args[0];
      const result = Reflect.apply(target, thisArg, args);
      // Spoof some WebGL parameters
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return result;
    }
  };

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      gl.getParameter = new Proxy(gl.getParameter, getParameterProxyHandler);
    }
  } catch(e) {}

  // Notification permission
  if ('Notification' in window) {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default'
    });
  }

  // Connection info
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false
    })
  });

  // Battery API
  if ('getBattery' in navigator) {
    navigator.getBattery = () => Promise.resolve({
      charging: true,
      chargingTime: 0,
      dischargingTime: Infinity,
      level: 1
    });
  }

  console.log('[Stealth] Anti-detection measures applied');
`;

/**
 * Apply stealth to page
 */
async function applyStealthToPage(page) {
  await page.addInitScript(STEALTH_SCRIPTS);
}

/**
 * Additional stealth measures for the context
 */
async function configureStealthContext(context) {
  // Block known fingerprinting scripts
  await context.route('**/*', (route, request) => {
    const url = request.url();
    
    // Block known tracking/fingerprinting domains
    const blockedDomains = [
      'google-analytics.com',
      'googletagmanager.com',
      'facebook.net',
      'doubleclick.net',
      'hotjar.com',
      'clarity.ms',
      'newrelic.com',
      'sentry.io'
    ];
    
    if (blockedDomains.some(domain => url.includes(domain))) {
      return route.abort();
    }
    
    return route.continue();
  });
}

module.exports = {
  STEALTH_SCRIPTS,
  applyStealthToPage,
  configureStealthContext
};
