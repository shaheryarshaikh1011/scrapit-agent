#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const ScrapIt = require('../src');
const logger = require('../src/utils/logger');
const { saveJson, timestamp } = require('../src/utils/helpers');
const path = require('path');
const fs = require('fs');

const program = new Command();

program
  .name('scrapit')
  .description('🕷️  Production-ready web scraper that bypasses anti-bot protection')
  .version('1.0.0');

// Main scrape command
program
  .argument('<url>', 'URL to scrape')
  .option('-m, --mode <mode>', 'Scraping mode: auto, generic, ecommerce, realtime', 'auto')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--headless', 'Run in headless mode (default)', true)
  .option('--no-headless', 'Run with browser visible')
  .option('-p, --proxy <url>', 'Proxy server URL')
  .option('--pages <num>', 'Max pages to scrape (listing)', '1')
  .option('--products <num>', 'Max products to scrape', '100')
  .option('-l, --location <pincode>', 'Default location/pincode for sites like JioMart (default: 400001 Mumbai)')
  .option('-d, --duration <ms>', 'Monitor duration for realtime mode', '30000')
  .option('-s, --selectors <list>', 'CSS selectors to monitor (comma-separated)', '')
  .option('-v, --verbose', 'Verbose logging')
  .option('-q, --quiet', 'Quiet mode - minimal output')
  .option('--json', 'Output only JSON (no formatting)')
  .action(async (url, options) => {
    // Set log level
    if (options.verbose) logger.setLevel('DEBUG');
    if (options.quiet) logger.setLevel('ERROR');

    const spinner = options.quiet ? null : ora('Initializing scraper...').start();

    try {
      const scraperOptions = {
        headless: options.headless,
        proxy: options.proxy,
        output: options.output,
        mode: options.mode,
        maxPages: parseInt(options.pages),
        maxProducts: parseInt(options.products),
        location: options.location || '400001', // Default Mumbai pincode
        realtime: options.mode === 'realtime',
        duration: parseInt(options.duration),
        selectors: options.selectors ? options.selectors.split(',').map(s => s.trim()) : []
      };

      if (spinner) spinner.text = 'Launching stealth browser...';

      const agent = new ScrapIt(scraperOptions);
      const result = await agent.scrape(url);

      if (spinner) spinner.succeed('Scraping complete!');

      // Output results
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printResults(result);
      }

    } catch (error) {
      if (spinner) spinner.fail('Scraping failed');
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Multi-URL command
program
  .command('multi <urls...>')
  .description('Scrape multiple URLs')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--headless', 'Run in headless mode', true)
  .action(async (urls, options) => {
    const spinner = ora(`Scraping ${urls.length} URLs...`).start();

    try {
      const agent = new ScrapIt({
        headless: options.headless,
        output: options.output
      });

      const results = await agent.scrapeMultiple(urls);
      spinner.succeed(`Scraped ${urls.length} URLs`);

      // Save combined results
      const outputFile = path.join(options.output, `multi-${timestamp()}.json`);
      saveJson(outputFile, results);
      console.log(chalk.green(`Results saved: ${outputFile}`));

    } catch (error) {
      spinner.fail('Scraping failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

// Monitor command (realtime)
program
  .command('monitor <url>')
  .description('Monitor URL for real-time data changes')
  .option('-d, --duration <ms>', 'Monitor duration in ms', '60000')
  .option('-s, --selectors <list>', 'CSS selectors to watch (comma-separated)')
  .option('-o, --output <file>', 'Save stream to file')
  .action(async (url, options) => {
    console.log(chalk.cyan('🔴 Starting real-time monitor...'));
    console.log(chalk.gray(`Duration: ${options.duration}ms`));
    
    const outputData = [];
    const outputFile = options.output;

    try {
      const agent = new ScrapIt({ headless: true });
      
      await agent.monitor(url, {
        duration: parseInt(options.duration),
        selectors: options.selectors ? options.selectors.split(',') : [],
        onData: (data) => {
          const line = `[${data.type}] ${JSON.stringify(data).substring(0, 100)}`;
          console.log(chalk.yellow(line));
          outputData.push(data);
        }
      });

      console.log(chalk.green(`\n✓ Monitoring complete. Captured ${outputData.length} events.`));

      if (outputFile) {
        saveJson(outputFile, outputData);
        console.log(chalk.green(`Saved to: ${outputFile}`));
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Test connection command
program
  .command('test <url>')
  .description('Test if URL is accessible and check for bot protection')
  .action(async (url) => {
    const spinner = ora('Testing connection...').start();

    try {
      const BrowserManager = require('../src/browser/manager');
      const browser = new BrowserManager({ headless: true });
      
      await browser.launch();
      spinner.text = 'Navigating...';
      
      const response = await browser.goto(url);
      const status = response.status();
      const html = await browser.getHtml();
      
      await browser.close();

      spinner.succeed('Connection test complete');
      
      console.log('\n' + chalk.bold('Results:'));
      console.log(`  Status: ${status === 200 ? chalk.green(status) : chalk.yellow(status)}`);
      console.log(`  Size: ${(html.length / 1024).toFixed(1)} KB`);
      
      // Check for bot detection
      const botIndicators = ['captcha', 'robot', 'blocked', 'access denied', 'unusual traffic'];
      const detected = botIndicators.some(i => html.toLowerCase().includes(i));
      
      if (detected) {
        console.log(`  Bot Protection: ${chalk.red('Detected')}`);
      } else {
        console.log(`  Bot Protection: ${chalk.green('None detected')}`);
      }

    } catch (error) {
      spinner.fail('Connection test failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

// Price comparison across pincodes command
program
  .command('compare <url>')
  .description('Compare product prices across multiple pincodes/locations')
  .option('-p, --pincodes <list>', 'Comma-separated list of pincodes to compare (e.g., 400001,110001,560001)')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--headless', 'Run in headless mode', true)
  .option('--no-headless', 'Run with browser visible')
  .option('--json', 'Output only JSON (no formatting)')
  .action(async (url, options) => {
    if (!options.pincodes) {
      console.error(chalk.red('Error: Please provide pincodes using -p or --pincodes option'));
      console.log(chalk.gray('Example: scrapit compare <url> -p 400001,110001,560001'));
      process.exit(1);
    }

    const pincodes = options.pincodes.split(',').map(p => p.trim());
    console.log(chalk.cyan(`\n📍 Comparing prices across ${pincodes.length} locations...\n`));

    const spinner = ora('Initializing...').start();

    try {
      const EcommerceScraper = require('../src/scrapers/ecommerceScraper');
      const scraper = new EcommerceScraper({
        headless: options.headless,
        output: options.output
      });

      spinner.text = `Comparing prices for ${pincodes.length} pincodes...`;
      
      const results = await scraper.comparePrices(url, pincodes, {});

      spinner.succeed('Price comparison complete!');

      // Save results
      const outputFile = path.join(options.output, `price-compare-${timestamp()}.json`);
      saveJson(outputFile, results);
      console.log(chalk.green(`Results saved: ${outputFile}`));

      // Output results
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        printComparisonResults(results);
      }

    } catch (error) {
      spinner.fail('Price comparison failed');
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

/**
 * Pretty print price comparison results (consolidated SKU format)
 */
function printComparisonResults(results) {
  console.log('\n' + chalk.bold.cyan('═'.repeat(60)));
  console.log(chalk.bold.cyan('  SKU DATA - MULTI-PINCODE'));
  console.log(chalk.bold.cyan('═'.repeat(60)) + '\n');

  // Product info
  console.log(chalk.bold('Product:'));
  console.log(`  Title: ${chalk.white(results.title || 'N/A')}`);
  if (results.brand) console.log(`  Brand: ${results.brand}`);
  if (results.sku) console.log(`  SKU: ${results.sku}`);
  if (results.weight) console.log(`  Weight: ${results.weight}`);
  if (results.rating) console.log(`  Rating: ${chalk.yellow(results.rating)} (${results.reviewCount || 0} reviews)`);
  console.log('');

  // Price by pincode
  console.log(chalk.bold('Price by Pincode:'));
  console.log(chalk.gray('─'.repeat(60)));

  results.pincodeData.forEach((item) => {
    const statusIcon = item.error ? '❌' : (item.inStock ? '✅' : '⚠️');
    const priceColor = item.inStock ? chalk.green : chalk.gray;

    console.log(`\n  ${statusIcon} ${chalk.bold(item.pincode)} ${item.location ? `(${chalk.gray(item.location.substring(0, 40))})` : ''}`);

    if (item.error) {
      console.log(`     ${chalk.red(`Error: ${item.error}`)}`);
    } else {
      console.log(`     Price: ${priceColor(item.priceText || 'N/A')}${item.originalPriceText ? ` (MRP: ${chalk.gray(item.originalPriceText)})` : ''}`);
      if (item.discount) console.log(`     Discount: ${chalk.yellow(item.discount)}`);
      console.log(`     Status: ${item.inStock ? chalk.green('In Stock') : chalk.red(item.availability || 'Out of Stock')}`);
    }
  });

  // Summary
  if (results.priceRange) {
    console.log('\n' + chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('\n📊 Summary:'));
    console.log(`  Price Range: ${chalk.green(`₹${results.priceRange.min}`)} - ${chalk.red(`₹${results.priceRange.max}`)}`);
    console.log(`  Average: ${chalk.yellow(`₹${results.priceRange.avg}`)}`);
    if (results.cheapestPincode) {
      console.log(`  Cheapest at: ${chalk.bold(results.cheapestPincode)}`);
    }
    if (results.availableAt?.length > 0) {
      console.log(`  Available at: ${chalk.green(results.availableAt.join(', '))}`);
    }
    if (results.unavailableAt?.length > 0) {
      console.log(`  Unavailable at: ${chalk.red(results.unavailableAt.join(', '))}`);
    }
  }

  console.log('\n' + chalk.gray('─'.repeat(60)));
}

/**
 * Pretty print results
 */
function printResults(result) {
  console.log('\n' + chalk.bold.cyan('═'.repeat(50)));
  console.log(chalk.bold.cyan('  SCRAPE RESULTS'));
  console.log(chalk.bold.cyan('═'.repeat(50)) + '\n');

  console.log(chalk.gray(`URL: ${result.url}`));
  console.log(chalk.gray(`Type: ${result.pageType || result.type}`));
  console.log(chalk.gray(`Scraped: ${result.scrapedAt}`));
  console.log('');

  if (result.type === 'product' || result.pageType === 'product') {
    console.log(chalk.bold('Product Details:'));
    console.log(`  Title: ${chalk.white(result.title || 'N/A')}`);
    console.log(`  Price: ${chalk.green(result.priceText || result.price || 'N/A')}`);
    if (result.originalPrice) {
      console.log(`  Original: ${chalk.gray(result.originalPrice)}`);
      console.log(`  Discount: ${chalk.yellow(result.discount)}`);
    }
    if (result.rating) console.log(`  Rating: ${chalk.yellow(result.rating)}`);
    if (result.availability) console.log(`  Stock: ${result.inStock ? chalk.green('In Stock') : chalk.red('Out of Stock')}`);
    if (result.images?.length) console.log(`  Images: ${result.images.length}`);
  }

  if (result.type === 'listing' || result.pageType === 'listing') {
    console.log(chalk.bold(`Products Found: ${result.totalProducts}`));
    if (result.pagesScraped) console.log(chalk.gray(`Pages scraped: ${result.pagesScraped}`));
    console.log('');
    
    // Show first 5 products
    const preview = result.products?.slice(0, 5) || [];
    preview.forEach((p, i) => {
      console.log(`  ${i + 1}. ${chalk.white(p.title?.substring(0, 50) || 'N/A')}`);
      console.log(`     ${chalk.green(p.priceText || p.price || 'N/A')}`);
    });
    
    if (result.products?.length > 5) {
      console.log(chalk.gray(`\n  ... and ${result.products.length - 5} more`));
    }
  }

  if (result.type === 'homepage' || result.pageType === 'homepage') {
    console.log(chalk.bold('Homepage Data:'));
    console.log(`  Categories: ${chalk.cyan(result.totalCategories || result.categories?.length || 0)}`);
    console.log(`  Products: ${chalk.cyan(result.totalProducts || result.products?.length || 0)}`);
    console.log(`  Banners: ${chalk.cyan(result.banners?.length || 0)}`);
    
    if (result.categories?.length > 0) {
      console.log(chalk.bold('\nTop Categories:'));
      result.categories.slice(0, 10).forEach((c, i) => {
        console.log(`  ${i + 1}. ${chalk.white(c.name)}`);
      });
    }
    
    if (result.products?.length > 0) {
      console.log(chalk.bold('\nProducts Found:'));
      result.products.slice(0, 10).forEach((p, i) => {
        console.log(`  ${i + 1}. ${chalk.white(p.title?.substring(0, 50) || 'N/A')}`);
        if (p.priceText) console.log(`     ${chalk.green(p.priceText)}${p.originalPriceText ? ` (was ${chalk.gray(p.originalPriceText)})` : ''}`);
      });
      if (result.products.length > 10) {
        console.log(chalk.gray(`\n  ... and ${result.products.length - 10} more products`));
      }
    }
  }

  if (result.type === 'article') {
    console.log(chalk.bold('Article:'));
    console.log(`  Title: ${chalk.white(result.title)}`);
    if (result.author) console.log(`  Author: ${result.author}`);
    if (result.date) console.log(`  Date: ${result.date}`);
    console.log(`  Words: ${result.wordCount}`);
  }

  // Realtime results
  if (result.websocketMessages || result.apiResponses || result.domChanges) {
    console.log(chalk.bold('Realtime Data:'));
    console.log(`  WebSocket messages: ${result.websocketMessages?.length || 0}`);
    console.log(`  API responses: ${result.apiResponses?.length || 0}`);
    console.log(`  DOM changes: ${result.domChanges?.length || 0}`);
  }

  console.log('\n' + chalk.gray('─'.repeat(50)));
}

program.parse();
