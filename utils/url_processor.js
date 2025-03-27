// utils/url_processor.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Common cookie/consent selectors to hide (add more as needed)
const HIDE_SELECTORS = [
    '#onetrust-consent-sdk',
    '.cookie-banner',
    '.cookie-notice',
    '[id*="cookie"]',
    '[class*="consent"]',
    '[id*="consent"]',
    '[class*="banner"]',
    '[class*="notice"]',
    '#usercentrics-root', // Another common one
    '.cc-banner', // Cookie Consent by Insites
    '.fc-consent-root' // Google Funding Choices
];

class URLProcessor {
  constructor(screenshotDir, llmClient = null) {
    this.screenshotDir = path.resolve(screenshotDir || path.join(__dirname, '../data/screenshots'));
    this.llmClient = llmClient;
    this.ensureDirectoryExists(this.screenshotDir);
  }

  ensureDirectoryExists(directory) {
    try {
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
    } catch (error) {
      console.error(`Error creating directory ${directory}:`, error);
      throw new Error(`Failed to create screenshot directory: ${error.message}`);
    }
  }

  // Helper to attempt hiding cookie banners
  async hideCookieBanners(page) {
      try {
          await page.evaluate((selectors) => {
              selectors.forEach(selector => {
                  const elements = document.querySelectorAll(selector);
                  elements.forEach(el => {
                      if (el && el.style) {
                          el.style.display = 'none';
                          el.style.visibility = 'hidden'; // Extra measure
                      }
                  });
              });
          }, HIDE_SELECTORS);
           console.log("Attempted to hide potential cookie banners.");
           // Add a small delay to allow JS hiding to take effect
           await new Promise(resolve => setTimeout(resolve, 250));
      } catch (error) {
          console.warn("Could not evaluate script to hide cookie banners:", error.message);
      }
  }


  // Main processing function
  async processURL(url, options = {}) {
    let browser = null;
    const { headless = 'new' } = options; // Default to 'new' (recommended headless)
    console.log(`Launching Puppeteer with headless: ${headless} for processing ${url}`);

    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      browser = await puppeteer.launch({
        headless: headless, // Use the setting
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=site-per-process'] // Added disable-features flag for stability
      });

      const page = await browser.newPage();
       // Set a common user agent to avoid some basic bot detection
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36');
       // Set viewport to control screenshot area base size
      await page.setViewport({ width: 1280, height: 800 }); // Base viewport


      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 35000 // Slightly increased timeout
      }).catch(error => {
        console.warn(`Navigation warning for ${url}: ${error.message}. Proceeding...`);
        // Continue processing even if navigation times out or has minor errors
      });

      // --- Extract Data ---
      const title = await page.title().catch(e => {
          console.warn(`Could not get title for ${url}: ${e.message}`);
          return 'Untitled';
      });

      // Attempt to hide cookie banners *before* getting text and screenshot
      await this.hideCookieBanners(page);

      const bodyText = await page.evaluate(() => {
          // Try to remove common noise like nav, footer before getting text
          document.querySelectorAll('nav, footer, script, style, noscript, svg, aside').forEach(el => el.remove());
          // Return first 3000 chars of visible text content
          return document.body.innerText?.substring(0, 3000) || "";
      }).catch(error => {
        console.error(`Error extracting text from ${url}: ${error.message}`);
        return "Failed to extract page content";
      });


      // --- Screenshot ---
      const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 10);
      const filename = `${Date.now()}_${urlHash}.png`;
      const screenshotPath = path.join(this.screenshotDir, filename);

      try {
          await page.screenshot({
              path: screenshotPath,
              fullPage: false,
              // ** UPDATED: Clip for 16:9 ratio based on 1280 width **
              clip: { x: 0, y: 0, width: 1280, height: 720 }
          });
          console.log(`Screenshot saved to: ${screenshotPath}`);
      } catch (screenshotError) {
          console.error(`Screenshot error for ${url}: ${screenshotError.message}`);
          // Invalidate path if screenshot failed
          if (fs.existsSync(screenshotPath)) { // Clean up potentially incomplete file
              try { await fsp.unlink(screenshotPath); } catch (_) {}
          }
          // screenshotPath = ""; // Mark as no screenshot taken (handled later)
      }


      await browser.close();
      browser = null; // Mark as closed

      // --- LLM Processing ---
      const content = `Title: ${title}\n\nContent Snippet:\n${bodyText}`;
      let tags = "";
      let description = "";

      if (this.llmClient) {
          try {
              tags = await this.llmClient.generateTags(url, content);
          } catch (llmError) {
              console.error(`LLM Error (Tags) for ${url}: ${llmError.message}`);
          }
          try {
              description = await this.llmClient.generateDescription(url, content);
          } catch (llmError) {
              console.error(`LLM Error (Description) for ${url}: ${llmError.message}`);
          }
      } else {
          console.warn("LLM client not available during processing.");
      }

      // Check if screenshot file actually exists before returning path
      const finalScreenshotPath = fs.existsSync(screenshotPath) ? screenshotPath : "";

      return {
        URL: url,
        Title: title || "Untitled",
        Description: description || "",
        Tags: tags || "",
        Date: new Date().toISOString(),
        Favorite: 'false',
        Screenshot: finalScreenshotPath // Use verified path
      };

    } catch (error) {
      console.error(`Critical Error processing URL ${url}:`, error);
      // Ensure browser is closed if an error occurred mid-process
      if (browser) {
          try { await browser.close(); }
          catch (closeError) { console.error('Error closing browser during error handling:', closeError); }
      }
      // Re-throw the error to be handled by the caller (e.g., IPC handler)
      throw new Error(`Failed to process URL ${url}. Cause: ${error.message}`);

    }
  }

  // Standalone screenshot function (also needs options)
  async takeScreenshot(url, options = {}) {
    let browser = null;
    const { headless = 'new' } = options; // Default to 'new'
     console.log(`Launching Puppeteer with headless: ${headless} for taking screenshot of ${url}`);

    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      browser = await puppeteer.launch({
        headless: headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=site-per-process']
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36');
      await page.setViewport({ width: 1280, height: 800 }); // Base viewport

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 35000
      }).catch(error => {
        console.warn(`Navigation warning for ${url}: ${error.message}. Proceeding with screenshot attempt...`);
      });

       // Attempt to hide cookie banners *before* screenshot
      await this.hideCookieBanners(page);

      // --- Screenshot ---
      const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 10);
      const filename = `${Date.now()}_${urlHash}.png`;
      const screenshotPath = path.join(this.screenshotDir, filename);

      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
         // ** UPDATED: Clip for 16:9 ratio based on 1280 width **
        clip: { x: 0, y: 0, width: 1280, height: 720 }
      });
      console.log(`Screenshot saved to: ${screenshotPath}`);


      await browser.close();
      browser = null;

      // Verify existence before returning path
      return fs.existsSync(screenshotPath) ? screenshotPath : "";

    } catch (error) {
      console.error(`Error taking screenshot for ${url}:`, error);
       if (browser) {
           try { await browser.close(); }
           catch (closeError) { console.error('Error closing browser during screenshot error handling:', closeError); }
       }
       throw new Error(`Failed to take screenshot for ${url}. Cause: ${error.message}`);
    }
  }
}

module.exports = URLProcessor;