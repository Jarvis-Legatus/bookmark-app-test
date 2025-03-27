// utils/url_processor.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class URLProcessor {
  constructor(screenshotDir, llmClient = null) {
    // Convert relative paths to absolute
    this.screenshotDir = path.resolve(screenshotDir || path.join(__dirname, '../data/screenshots'));
    this.llmClient = llmClient;
    
    // Create screenshots directory if it doesn't exist
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

  async processURL(url) {
    let browser = null;
    
    try {
      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      // Launch browser with error handling
      browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      });
      
      const page = await browser.newPage();
      
      // Set timeout and handle navigation errors
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      }).catch(error => {
        console.warn(`Navigation warning for ${url}: ${error.message}`);
        // Continue anyway to try to extract whatever content is available
      });
      
      // Extract title and content
      const title = await page.title();
      const bodyText = await page.evaluate(() => {
        return document.body.innerText.substring(0, 3000); // First 3000 chars
      }).catch(error => {
        console.error(`Error extracting text from ${url}: ${error.message}`);
        return "Failed to extract page content";
      });
      
      // Generate unique filename with timestamp and sanitized URL
      const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 10);
      const filename = `${Date.now()}_${urlHash}.png`;
      const screenshotPath = path.join(this.screenshotDir, filename);
      
      // Take screenshot with error handling
      await page.screenshot({ 
        path: screenshotPath, 
        fullPage: false,
        clip: { x: 0, y: 0, width: 1280, height: 800 }
      }).catch(error => {
        console.error(`Screenshot error for ${url}: ${error.message}`);
        // Continue without screenshot
      });
      
      // Close browser
      await browser.close();
      browser = null;
      
      // Get content for AI processing
      const content = `Title: ${title}\n\nContent: ${bodyText}`;
      
      // Verify LLM client exists
      if (!this.llmClient) {
        throw new Error("LLM client not initialized");
      }
      
      // Generate tags and description
      const tags = await this.llmClient.generateTags(url, content);
      const description = await this.llmClient.generateDescription(url, content);
      
      return {
        URL: url,
        Title: title || "Untitled",
        Description: description || "",
        Tags: tags || "",
        Date: new Date().toISOString(),
        Favorite: 'false',
        Screenshot: fs.existsSync(screenshotPath) ? screenshotPath : ""
      };
    } catch (error) {
      console.error('Error processing URL:', error);
      throw error;
    } finally {
      // Ensure browser is closed even if an error occurred
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
    }
  }

  async takeScreenshot(url) {
    let browser = null;
    
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      
      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      }).catch(error => {
        console.warn(`Navigation warning for ${url}: ${error.message}`);
      });
      
      // Generate unique filename
      const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 10);
      const filename = `${Date.now()}_${urlHash}.png`;
      const screenshotPath = path.join(this.screenshotDir, filename);
      
      await page.screenshot({ 
        path: screenshotPath, 
        fullPage: false,
        clip: { x: 0, y: 0, width: 1280, height: 800 }
      });
      
      await browser.close();
      browser = null;
      
      return screenshotPath;
    } catch (error) {
      console.error('Error taking screenshot:', error);
      throw error;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
      }
    }
  }
}

module.exports = URLProcessor;
