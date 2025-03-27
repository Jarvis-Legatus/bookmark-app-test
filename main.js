// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs'); // Original fs for sync checks
const fsp = require('fs').promises; // fs.promises for async operations
const Store = require('electron-store'); // ** ADDED: For settings persistence **
require('dotenv').config(); // Load .env variables (mostly for initial API key if needed)

// --- Configuration ---
const portableDataPath = path.resolve(__dirname, 'app_data');

try {
    app.setPath('userData', portableDataPath);
    console.log(`Electron user data path set to: ${portableDataPath}`);
} catch (error) {
    console.error('FATAL: Could not set Electron user data path:', error);
    dialog.showErrorBox('Configuration Error', `Failed to set portable data path. App may not work correctly. Error: ${error.message}`);
    app.quit();
}

const userDataPath = portableDataPath;
console.log(`Application data path configured to: ${userDataPath}`);

// Setup paths
const csvPath = path.join(userDataPath, 'bookmarks.csv');
const screenshotDir = path.join(userDataPath, 'screenshots');

// --- Settings Management ---
const store = new Store({
    // Defaults ensure settings exist on first launch
    defaults: {
        darkMode: false,
        headless: true, // Default to headless
        llmApiUrl: 'https://api.deepseek.com/v1/chat/completions',
        llmModel: 'deepseek-chat',
        llmApiKey: process.env.DEEPSEEK_API_KEY || '', // Use .env as initial default only
    },
    // Ensure it uses the portable path we set
    cwd: userDataPath,
    // Optional: name the settings file
    name: 'app-settings'
});
console.log(`Settings file path: ${store.path}`);

// --- Managers and Clients (Initialize dynamically based on settings) ---
const BookmarkManager = require('./utils/csv_manager');
const URLProcessor = require('./utils/url_processor');
const LLMClient = require('./utils/llm_clients');

let llmClient; // To be initialized
let urlProcessor; // To be initialized
const bookmarkManager = new BookmarkManager(csvPath); // CSV path is fixed

function initializeServices() {
    const settings = store.get();
    console.log("Initializing services with settings:", settings);

    // Get LLM config from stored settings
    const currentApiKey = settings.llmApiKey || ''; // Use stored key
    const currentApiUrl = settings.llmApiUrl || 'https://api.deepseek.com/v1/chat/completions'; // Fallback default
    const currentModel = settings.llmModel || 'deepseek-chat'; // Fallback default

    // Warn if API Key is missing for known cloud providers (adjust as needed)
    if (!currentApiKey && (currentApiUrl.includes('deepseek.com') || currentApiUrl.includes('mistral.ai') /* add others */)) {
        console.warn("*****************************************************");
        console.warn(`WARNING: API Key might be required for ${currentApiUrl} but is not set in settings.`);
        console.warn("Please configure it via the Settings page.");
        console.warn("*****************************************************");
        // Show non-fatal warning dialog ONCE? Or rely on console/toast? Let's stick to console for now.
    }

    llmClient = new LLMClient(
        currentApiUrl,
        currentModel,
        currentApiKey
    );

    // URLProcessor needs the screenshot directory and the LLM client
    urlProcessor = new URLProcessor(screenshotDir, llmClient);

    console.log("LLM and URL Processor services initialized/updated.");
}

// Initialize services on startup
initializeServices();


// --- Global Handlers ---
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

// --- Initialization ---
let mainWindow;
let settingsWindow = null; // Keep track of the settings window

// Make sure directories exist (use async)
async function initializeDirectories() {
  try {
    await fsp.mkdir(userDataPath, { recursive: true });
    await fsp.mkdir(screenshotDir, { recursive: true });
    console.log(`Ensured directories exist: ${userDataPath}, ${screenshotDir}`);
  } catch (error) {
    console.error('FATAL: Error creating essential directories:', error);
    dialog.showErrorBox('Initialization Error', `Failed to create application directories: ${error.message}`);
    app.quit();
  }
}

// Create main application window
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
      show: false // Don't show immediately
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
    // mainWindow.webContents.openDevTools(); // Uncomment for debugging main window

    // Apply theme when content is ready
    mainWindow.webContents.on('did-finish-load', () => {
        const isDarkMode = store.get('darkMode', false);
        mainWindow.webContents.send('apply-theme', isDarkMode);
        mainWindow.show(); // Show after theme is ready
    });


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
        // If main window closes, also close settings window if open
        if (settingsWindow) {
            settingsWindow.close();
        }
    });

  } catch (error) {
    console.error('Error creating main window:', error);
    dialog.showErrorBox('Window Creation Error', `Failed to create the main window: ${error.message}`);
  }
}

// --- Settings Window ---
function createSettingsWindow() {
    // If window already exists, focus it
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    try {
        settingsWindow = new BrowserWindow({
            width: 800,
            height: 650,
            title: 'Settings',
            parent: mainWindow, // Optional: make it a child window
            modal: false, // Allow interaction with main window
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js') // Reuse the same preload
            },
             show: false // Don't show immediately
        });

        settingsWindow.loadFile(path.join(__dirname, 'renderer/settings.html'));
        // settingsWindow.webContents.openDevTools(); // Uncomment for debugging settings window

        // Apply theme when content is ready
        settingsWindow.webContents.on('did-finish-load', () => {
            const isDarkMode = store.get('darkMode', false);
             // Send theme state to settings window JS via preload
            settingsWindow.webContents.send('apply-theme', isDarkMode);
             settingsWindow.show(); // Show after theme is ready
        });


        settingsWindow.on('closed', () => {
            settingsWindow = null; // Allow reopening
        });

    } catch (error) {
        console.error('Error creating settings window:', error);
        dialog.showErrorBox('Window Creation Error', `Failed to create the settings window: ${error.message}`);
    }
}


// --- App Lifecycle Events ---
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

// --- IPC Handlers ---

// Standard error handler
function handleIPCError(error, operation) {
  console.error(`Error in IPC operation '${operation}':`, error);
  return { success: false, error: error.message || 'An unknown error occurred', details: error.stack };
}

// --- Settings IPC ---
ipcMain.handle('get-settings', async () => {
    try {
        const settings = store.get();
        // Ensure sensitive keys aren't accidentally logged extensively
        console.log('IPC: get-settings called. Returning current settings.');
        return { success: true, data: settings };
    } catch (error) {
        return handleIPCError(error, 'get-settings');
    }
});

ipcMain.handle('set-settings', async (_, newSettings) => {
    try {
        console.log('IPC: set-settings called with:', newSettings);
        // Validate or sanitize newSettings if necessary
        for (const key in newSettings) {
            if (Object.hasOwnProperty.call(newSettings, key)) {
                store.set(key, newSettings[key]);
            }
        }
        // If LLM settings changed, re-initialize services
        if ('llmApiKey' in newSettings || 'llmApiUrl' in newSettings || 'llmModel' in newSettings) {
            console.log("LLM settings changed, re-initializing services...");
            initializeServices(); // Recreate LLM client and URL processor
        }
        // If headless setting changed, urlProcessor doesn't need re-init,
        // it reads the setting during processURL/takeScreenshot calls.
        // If dark mode changed, the theme-changed IPC will handle UI updates.

        return { success: true };
    } catch (error) {
        return handleIPCError(error, 'set-settings');
    }
});

// Handle theme change notification from settings window
ipcMain.on('theme-changed', (event, isDarkMode) => {
    console.log('IPC: theme-changed received:', isDarkMode);
    // Notify the main window (if it exists)
    if (mainWindow) {
        mainWindow.webContents.send('apply-theme', isDarkMode);
    }
    // Also notify the settings window itself (though it might have already updated)
    if (settingsWindow && event.sender !== settingsWindow.webContents) {
         settingsWindow.webContents.send('apply-theme', isDarkMode);
    }
});


// Open Settings Window IPC
ipcMain.handle('open-settings-window', () => {
    createSettingsWindow();
    return { success: true };
});


// --- Bookmark IPC Handlers (Mostly Unchanged, but use current settings) ---

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
    // *** Read current headless setting ***
    const isHeadless = store.get('headless', true);
    console.log(`Processing URL with headless mode: ${isHeadless}`);
    const newBookmarkData = await urlProcessor.processURL(trimmedUrl, { headless: isHeadless }); // Pass setting
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

// Filter by date
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
    // Determine the new state based on the provided bookmark data
    const currentIsFavorite = String(bookmark.Favorite).toLowerCase() === 'true';
    const newFavoriteState = !currentIsFavorite;

    // Create the update object with only the fields we absolutely need to change
    // Preserve existing data from the CSV if possible by reading first
    const existingBookmarks = await bookmarkManager.getBookmarks();
    const existingBookmark = existingBookmarks.find(b => b.URL === bookmark.URL);

    if (!existingBookmark) {
        // This case should ideally not happen if the UI is synced, but handle defensively
        console.warn(`Toggle Favorite: Bookmark ${bookmark.URL} not found in CSV. Saving as new.`);
         const updatedBookmarkData = {
            ...bookmark, // Use data from renderer as fallback
            Favorite: newFavoriteState // Set the new state
        };
        await bookmarkManager.saveBookmark(updatedBookmarkData);
        // Return the structure expected by the renderer
         return { success: true, bookmark: {...updatedBookmarkData, Favorite: String(newFavoriteState)} };
    } else {
         // Merge changes onto the existing data from the CSV
         const updatedBookmarkData = {
            ...existingBookmark, // Start with data from CSV
            Favorite: newFavoriteState // Apply the new favorite state
        };
        await bookmarkManager.saveBookmark(updatedBookmarkData);
         // Return the structure expected by the renderer
         return { success: true, bookmark: {...updatedBookmarkData, Favorite: String(newFavoriteState)} };
    }

  } catch (error) {
    return handleIPCError(error, 'toggle-favorite');
  }
});


// Update bookmark screenshot
ipcMain.handle('update-screenshot', async (_, bookmark) => {
  if (!bookmark || !bookmark.URL) {
      return { success: false, error: "Invalid bookmark data provided for update screenshot." };
  }
  console.log(`IPC: Received update-screenshot request for URL: ${bookmark.URL}`);
  try {
    // *** Read current headless setting ***
    const isHeadless = store.get('headless', true);
    console.log(`Taking screenshot with headless mode: ${isHeadless}`);
    const newScreenshotPath = await urlProcessor.takeScreenshot(bookmark.URL, { headless: isHeadless }); // Pass setting
    console.log(`IPC: New screenshot taken: ${newScreenshotPath}`);

    const oldScreenshotPath = bookmark.Screenshot;

     // Read the latest full bookmark data before saving just the screenshot path update
    const existingBookmarks = await bookmarkManager.getBookmarks();
    const existingBookmark = existingBookmarks.find(b => b.URL === bookmark.URL);

     if (!existingBookmark) {
         console.warn(`Update Screenshot: Bookmark ${bookmark.URL} not found in CSV. Saving screenshot path with provided data.`);
          const updatedBookmarkData = { ...bookmark, Screenshot: newScreenshotPath };
          await bookmarkManager.saveBookmark(updatedBookmarkData);
          // Delete old screenshot if path differs and exists
           if (oldScreenshotPath && oldScreenshotPath !== newScreenshotPath && fs.existsSync(oldScreenshotPath)) {
               try { await fsp.unlink(oldScreenshotPath); console.log(`IPC: Deleted old screenshot: ${oldScreenshotPath}`); }
               catch (unlinkError) { console.warn(`IPC: Failed to delete old screenshot file ${oldScreenshotPath}:`, unlinkError); }
           }
          return { success: true, bookmark: updatedBookmarkData };
     } else {
         // Merge new screenshot path onto existing data
         const updatedBookmarkData = { ...existingBookmark, Screenshot: newScreenshotPath };
         await bookmarkManager.saveBookmark(updatedBookmarkData);
         // Delete old screenshot if path differs and exists
         if (oldScreenshotPath && oldScreenshotPath !== newScreenshotPath && fs.existsSync(oldScreenshotPath)) {
             try { await fsp.unlink(oldScreenshotPath); console.log(`IPC: Deleted old screenshot: ${oldScreenshotPath}`); }
             catch (unlinkError) { console.warn(`IPC: Failed to delete old screenshot file ${oldScreenshotPath}:`, unlinkError); }
         }
         return { success: true, bookmark: updatedBookmarkData };
     }

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
    const count = await bookmarkManager.importFromCSV(sourcePath);
    // Notify main window to refresh its list
    if (mainWindow) {
        mainWindow.webContents.send('bookmarks-updated'); // Send simple notification
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
        // Still proceed to delete screenshot if it exists, just in case
    }
    // Save the filtered list regardless of whether the item was found (handles cleanup)
    await bookmarkManager.saveBookmarks(filteredBookmarks);
    console.log(`IPC: Saved CSV after potentially removing ${bookmark.URL}.`);

    // Delete associated screenshot
    const screenshotToDelete = bookmark.Screenshot;
    if (screenshotToDelete && typeof screenshotToDelete === 'string' && fs.existsSync(screenshotToDelete)) {
      try {
        await fsp.unlink(screenshotToDelete);
        console.log(`IPC: Deleted associated screenshot: ${screenshotToDelete}`);
      } catch (fileError) {
        // Log error but don't fail the whole operation
        console.error(`IPC: Error deleting screenshot file ${screenshotToDelete}:`, fileError);
      }
    } else if (screenshotToDelete) {
         console.log(`IPC: Screenshot path provided for deletion, but file not found: ${screenshotToDelete}`);
    }

    return { success: true };
  } catch (error) {
    return handleIPCError(error, 'delete-bookmark');
  }
});

// Check LLM service availability
ipcMain.handle('check-llm-service', async () => {
  // Use the currently configured client
  if (!llmClient) {
      return handleIPCError(new Error("LLM Client not initialized"), 'check-llm-service');
  }
  try {
    const result = await llmClient.checkService();
    return { success: true, data: result };
  } catch (error) {
    return handleIPCError(error, 'check-llm-service');
  }
});