// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs'); // Original fs for sync checks
const fsp = require('fs').promises; // fs.promises for async operations
require('dotenv').config(); // ** ADDED: Load .env variables **

// --- Configuration ---

// *** CHANGE 1: Define the desired data directory within the app's root ***
// path.resolve(__dirname) gives the application's root directory (e.g., C:\Users\julia\Desktop\bookmark-manager)
const portableDataPath = path.resolve(__dirname, 'app_data'); // Using 'app_data' subfolder for neatness

// *** CHANGE 2: Tell Electron to use this path for ALL its user data ***
// This MUST be called before the app 'ready' event.
try {
    app.setPath('userData', portableDataPath);
    console.log(`Electron user data path set to: ${portableDataPath}`);
} catch (error) {
    // This might happen if called too late, though unlikely here.
    console.error('FATAL: Could not set Electron user data path:', error);
    // If this fails, the app might still write to AppData, which is undesirable.
    // Consider quitting or showing a fatal error dialog.
    dialog.showErrorBox('Configuration Error', `Failed to set portable data path. App may not work correctly. Error: ${error.message}`);
    app.quit();
}

// --- Now use the same path for our application's specific data ---
const userDataPath = portableDataPath; // Use the path we just set for Electron
console.log(`Application data path configured to: ${userDataPath}`); // Verify it's the same

// Setup paths (ensure they are absolute - they will be due to path.resolve above)
const csvPath = path.join(userDataPath, 'bookmarks.csv');
const screenshotDir = path.join(userDataPath, 'screenshots');

// --- Managers and Clients (No changes needed here as paths are injected) ---
const BookmarkManager = require('./utils/csv_manager');
const URLProcessor = require('./utils/url_processor');
const LLMClient = require('./utils/llm_clients');

// Get API Key from environment variable
const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;

// Check if API Key is set
if (!deepSeekApiKey) {
  console.error("*****************************************************");
  console.error("FATAL ERROR: DEEPSEEK_API_KEY is not set in the .env file.");
  console.error("Please create a .env file in the project root with:");
  console.error("DEEPSEEK_API_KEY=your_actual_api_key");
  console.error("*****************************************************");
}

// Create LLM client
const llmClient = new LLMClient(
    'https://api.deepseek.com/v1/chat/completions',
    'deepseek-chat',
    deepSeekApiKey
);

// Create managers with shared LLM client and absolute paths
const bookmarkManager = new BookmarkManager(csvPath);
const urlProcessor = new URLProcessor(screenshotDir, llmClient);


// --- Global Handlers (No changes) ---
process.on('uncaughtException', (error, origin) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('!!!!!!!! UNCAUGHT EXCEPTION !!!!!!!');
  console.error('Origin:', origin);
  console.error('Error:', error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!!!!!! UNHANDLED REJECTION !!!!!!!');
    console.error('Reason:', reason);
    console.error('Promise:', promise);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
});

// --- Initialization (No changes to logic, but paths used are now different) ---
let mainWindow;

// Make sure directories exist (use async)
async function initializeDirectories() {
  try {
    // Ensure the main data directory and the screenshot subdirectory exist
    await fsp.mkdir(userDataPath, { recursive: true }); // Creates 'app_data'
    await fsp.mkdir(screenshotDir, { recursive: true }); // Creates 'app_data/screenshots'
    console.log(`Ensured directories exist: ${userDataPath}, ${screenshotDir}`);
  } catch (error) {
    console.error('FATAL: Error creating essential directories:', error);
    dialog.showErrorBox('Initialization Error', `Failed to create application directories: ${error.message}`);
    app.quit();
  }
}

// Create main application window (No changes)
function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
    // mainWindow.webContents.openDevTools();

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
        } else {
            console.warn(`Blocked opening non-http(s) URL: ${url}`);
        }
      return { action: 'deny' };
    });

     mainWindow.on('closed', () => {
        mainWindow = null;
    });

  } catch (error) {
    console.error('Error creating main window:', error);
    dialog.showErrorBox('Window Creation Error', `Failed to create the main window: ${error.message}`);
  }
}

// --- App Lifecycle Events (No changes) ---
app.whenReady().then(async () => {
  await initializeDirectories();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

}).catch(error => {
  console.error('Error during app initialization:', error);
  dialog.showErrorBox('Application Start Error', `Failed to initialize the application: ${error.message}`);
  app.quit();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
      console.log('All windows closed, quitting app.');
      app.quit();
    }
});

// --- IPC Handlers (No changes needed in handlers themselves) ---

// Standard error handler
function handleIPCError(error, operation) {
  console.error(`Error in IPC operation '${operation}':`, error);
  return { success: false, error: error.message || 'An unknown error occurred', details: error.stack };
}

// Get all bookmarks
ipcMain.handle('get-bookmarks', async () => {
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    return { success: true, data: bookmarks };
  } catch (error) {
    return handleIPCError(error, 'get-bookmarks');
  }
});

// Add a new bookmark by URL
ipcMain.handle('add-bookmark', async (_, url) => {
  console.log(`IPC: Received add-bookmark request for URL: ${url}`);
  if (!url || typeof url !== 'string' || !url.trim()) {
      return { success: false, error: "Invalid URL provided." };
  }
  const trimmedUrl = url.trim();

  try {
    const newBookmarkData = await urlProcessor.processURL(trimmedUrl);
    console.log(`IPC: URL processed, data received:`, newBookmarkData);
    await bookmarkManager.saveBookmark(newBookmarkData);
    console.log(`IPC: Bookmark saved to CSV: ${newBookmarkData.URL}`);
    return { success: true, bookmark: newBookmarkData };
  } catch (error) {
      console.error(`IPC: Failed to add bookmark for ${trimmedUrl}:`, error);
      let errorMessage = error.message || 'Failed to process or save bookmark.';
      if (error.cause) {
        errorMessage += ` Cause: ${error.cause}`;
      }
      return { success: false, error: errorMessage };
  }
});

// Search bookmarks
ipcMain.handle('search-bookmarks', async (_, query) => {
  try {
    const results = await bookmarkManager.searchBookmarks(query);
    return { success: true, data: results };
  } catch (error) {
    return handleIPCError(error, 'search-bookmarks');
  }
});

// Filter by tags
ipcMain.handle('filter-by-tags', async (_, tags) => {
  const tagArray = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  try {
    const results = await bookmarkManager.filterByTags(tagArray);
    return { success: true, data: results };
  } catch (error) {
    return handleIPCError(error, 'filter-by-tags');
  }
});

// Filter by date (logic remains, uses data from potentially different CSV location)
ipcMain.handle('filter-by-date', async (_, days) => {
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    if (days === 0 || days === undefined || days === null) {
        return { success: true, data: bookmarks };
    }
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0);
    const filtered = bookmarks.filter(bookmark => {
      try {
          const bookmarkDate = new Date(bookmark.Date);
          return !isNaN(bookmarkDate) && bookmarkDate >= cutoffDate;
      } catch (dateError) {
          console.warn(`Invalid date format for bookmark ${bookmark.URL}: ${bookmark.Date}`);
          return false;
      }
    });
    return { success: true, data: filtered };
  } catch (error) {
    return handleIPCError(error, 'filter-by-date');
  }
});

// Get favorites
ipcMain.handle('get-favorites', async () => {
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    const favorites = bookmarks.filter(bookmark => String(bookmark.Favorite).toLowerCase() === 'true');
    return { success: true, data: favorites };
  } catch (error) {
    return handleIPCError(error, 'get-favorites');
  }
});

// Toggle favorite status
ipcMain.handle('toggle-favorite', async (_, bookmark) => {
  if (!bookmark || !bookmark.URL) {
      return { success: false, error: "Invalid bookmark data provided for toggle favorite." };
  }
  try {
    const currentIsFavorite = String(bookmark.Favorite).toLowerCase() === 'true';
    const updatedBookmarkData = {
      ...bookmark,
      Favorite: !currentIsFavorite
    };
    await bookmarkManager.saveBookmark(updatedBookmarkData);
    return { success: true, bookmark: { ...updatedBookmarkData, Favorite: String(!currentIsFavorite) } };
  } catch (error) {
    return handleIPCError(error, 'toggle-favorite');
  }
});

// Take a screenshot (Standalone - less common)
ipcMain.handle('take-screenshot', async (_, url) => {
   console.warn("IPC: 'take-screenshot' called directly. Prefer 'update-screenshot' for existing bookmarks.");
   if (!url || typeof url !== 'string' || !url.trim()) {
      return { success: false, error: "Invalid URL provided for screenshot." };
   }
  try {
    // urlProcessor uses the correctly configured screenshotDir
    const screenshotPath = await urlProcessor.takeScreenshot(url.trim());
    return { success: true, screenshotPath };
  } catch (error) {
    return handleIPCError(error, 'take-screenshot');
  }
});

// Update bookmark screenshot
ipcMain.handle('update-screenshot', async (_, bookmark) => {
  if (!bookmark || !bookmark.URL) {
      return { success: false, error: "Invalid bookmark data provided for update screenshot." };
  }
  console.log(`IPC: Received update-screenshot request for URL: ${bookmark.URL}`);
  try {
    const newScreenshotPath = await urlProcessor.takeScreenshot(bookmark.URL);
    console.log(`IPC: New screenshot taken: ${newScreenshotPath}`);
    const oldScreenshotPath = bookmark.Screenshot;
    const updatedBookmarkData = { ...bookmark, Screenshot: newScreenshotPath };
    await bookmarkManager.saveBookmark(updatedBookmarkData);
    console.log(`IPC: Bookmark ${bookmark.URL} updated with new screenshot path.`);

    if (oldScreenshotPath && oldScreenshotPath !== newScreenshotPath && fs.existsSync(oldScreenshotPath)) {
        try {
            await fsp.unlink(oldScreenshotPath);
            console.log(`IPC: Deleted old screenshot: ${oldScreenshotPath}`);
        } catch (unlinkError) {
            console.warn(`IPC: Failed to delete old screenshot file ${oldScreenshotPath}:`, unlinkError);
        }
    }
    return { success: true, bookmark: updatedBookmarkData };
  } catch (error) {
    return handleIPCError(error, 'update-screenshot');
  }
});

// Get all unique tags
ipcMain.handle('get-all-tags', async () => {
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    const tagsSet = new Set();
    bookmarks.forEach(bookmark => {
      if (bookmark.Tags && typeof bookmark.Tags === 'string') {
        bookmark.Tags.split(',')
          .map(tag => tag.trim())
          .filter(tag => tag)
          .forEach(tag => tagsSet.add(tag));
      }
    });
    const sortedTags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b));
    return { success: true, data: sortedTags };
  } catch (error) {
    return handleIPCError(error, 'get-all-tags');
  }
});

// Export bookmarks to CSV
ipcMain.handle('export-csv', async () => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Bookmarks',
      defaultPath: `bookmarks_${Date.now()}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });
    if (canceled || !filePath) {
      console.log('CSV export cancelled by user.');
      return { success: false, message: 'Export cancelled' };
    }
    const count = await bookmarkManager.exportToCSV(filePath);
    return {
      success: true,
      count,
      message: `Successfully exported ${count} bookmarks to ${filePath}`
    };
  } catch (error) {
    dialog.showErrorBox('Export Error', `Failed to export bookmarks: ${error.message}`);
    return handleIPCError(error, 'export-csv');
  }
});

// Import bookmarks from CSV
ipcMain.handle('import-csv', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import Bookmarks from CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      console.log('CSV import cancelled by user.');
      return { success: false, message: 'Import cancelled' };
    }
    const sourcePath = filePaths[0];
    // bookmarkManager will merge into the CSV at the new portable location
    const count = await bookmarkManager.importFromCSV(sourcePath);
    if (mainWindow) {
        mainWindow.webContents.send('bookmarks-updated');
    }
    return {
      success: true,
      count,
      message: `Successfully processed ${count} bookmarks from ${path.basename(sourcePath)}`
    };
  } catch (error) {
      dialog.showErrorBox('Import Error', `Failed to import bookmarks: ${error.message}`);
    return handleIPCError(error, 'import-csv');
  }
});

// Open bookmark URL
ipcMain.handle('open-url', async (_, url) => {
   if (!url || typeof url !== 'string' || !(url.startsWith('http:') || url.startsWith('https:'))) {
       console.warn(`Attempted to open invalid or non-http(s) URL: ${url}`);
       return { success: false, error: 'Invalid or non-web URL provided.' };
   }
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return handleIPCError(error, 'open-url');
  }
});

// Delete a bookmark
ipcMain.handle('delete-bookmark', async (_, bookmark) => {
  if (!bookmark || !bookmark.URL) {
      return { success: false, error: "Invalid bookmark data provided for deletion." };
  }
  console.log(`IPC: Received delete-bookmark request for URL: ${bookmark.URL}`);
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    const filteredBookmarks = bookmarks.filter(b => b.URL !== bookmark.URL);
    if (filteredBookmarks.length === bookmarks.length) {
        console.warn(`IPC: Bookmark to delete not found in CSV: ${bookmark.URL}`);
    }
    await bookmarkManager.saveBookmarks(filteredBookmarks);
    console.log(`IPC: Saved CSV after removing ${bookmark.URL}.`);

    const screenshotToDelete = bookmark.Screenshot;
    // fs.existsSync will check the path which is now relative to the portable location
    if (screenshotToDelete && typeof screenshotToDelete === 'string' && fs.existsSync(screenshotToDelete)) {
      try {
        await fsp.unlink(screenshotToDelete);
        console.log(`IPC: Deleted associated screenshot: ${screenshotToDelete}`);
      } catch (fileError) {
        console.error(`IPC: Error deleting screenshot file ${screenshotToDelete}:`, fileError);
      }
    }
    return { success: true };
  } catch (error) {
    return handleIPCError(error, 'delete-bookmark');
  }
});

// Check LLM service availability
ipcMain.handle('check-llm-service', async () => {
  try {
    const result = await llmClient.checkService();
    return { success: true, data: result };
  } catch (error) {
    return handleIPCError(error, 'check-llm-service');
  }
});