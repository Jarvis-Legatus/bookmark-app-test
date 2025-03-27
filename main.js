// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs'); // Original fs for sync checks
const fsp = require('fs').promises; // fs.promises for async operations
require('dotenv').config(); // ** ADDED: Load .env variables **

const BookmarkManager = require('./utils/csv_manager');
const URLProcessor = require('./utils/url_processor');
const LLMClient = require('./utils/llm_clients');

// --- Configuration ---

// Safely get user data path
let userDataPath;
try {
  userDataPath = app.getPath('userData');
} catch (error) {
  console.warn('Error getting Electron userData path, falling back to local data directory:', error);
  userDataPath = path.resolve(__dirname, 'data'); // Use path.resolve for absolute path
}
console.log(`User data path: ${userDataPath}`);

// Setup paths (ensure they are absolute)
const csvPath = path.join(userDataPath, 'bookmarks.csv');
const screenshotDir = path.join(userDataPath, 'screenshots');

// Get API Key from environment variable
const deepSeekApiKey = process.env.DEEPSEEK_API_KEY; // ** CHANGED **

// Check if API Key is set
if (!deepSeekApiKey) {
  console.error("*****************************************************");
  console.error("FATAL ERROR: DEEPSEEK_API_KEY is not set in the .env file.");
  console.error("Please create a .env file in the project root with:");
  console.error("DEEPSEEK_API_KEY=your_actual_api_key");
  console.error("*****************************************************");
  // Optionally, prevent the app from fully starting or disable LLM features
  // For now, we'll let it run but LLM calls will likely fail.
}

// Create LLM client (configure in one place only)
// Make sure the key is passed correctly
const llmClient = new LLMClient(
    'https://api.deepseek.com/v1/chat/completions',
    'deepseek-chat', // Use a compatible chat model like 'deepseek-chat'
    deepSeekApiKey // ** CHANGED: Use variable **
);

// Create managers with shared LLM client
// Ensure paths passed to managers are absolute
const bookmarkManager = new BookmarkManager(csvPath);
const urlProcessor = new URLProcessor(screenshotDir, llmClient);


// --- Global Handlers ---

// Global error handler (Use with caution - can hide bugs)
process.on('uncaughtException', (error, origin) => {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('!!!!!!!! UNCAUGHT EXCEPTION !!!!!!!');
  console.error('Origin:', origin);
  console.error('Error:', error);
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  // Avoid exiting in production, but maybe show a dialog?
  // dialog.showErrorBox('Unhandled Error', `An unexpected error occurred: ${error.message}\n\nPlease report this:\n${error.stack}`);
  // app.quit(); // Consider quitting in dev mode
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

// Make sure directories exist (use async)
async function initializeDirectories() {
  try {
    await fsp.mkdir(userDataPath, { recursive: true });
    await fsp.mkdir(screenshotDir, { recursive: true });
    console.log(`Ensured directories exist: ${userDataPath}, ${screenshotDir}`);
  } catch (error) {
    console.error('FATAL: Error creating essential directories:', error);
    // This might be a reason to quit
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
        nodeIntegration: false, // Keep false for security
        contextIsolation: true, // Keep true for security
        preload: path.join(__dirname, 'preload.js') // Correct path
      },
      // icon: path.join(__dirname, 'assets/icon.png') // Make sure this path is correct if you have an icon
    });

    // Load the index.html file
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Open DevTools - uncomment for debugging
    // mainWindow.webContents.openDevTools();

    // Handle external links securely
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Ensure only http/https protocols are opened externally
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
        } else {
            console.warn(`Blocked opening non-http(s) URL: ${url}`);
        }
      return { action: 'deny' }; // Prevent Electron from opening new windows for links
    });

     mainWindow.on('closed', () => {
        mainWindow = null; // Dereference window object
    });

  } catch (error) {
    console.error('Error creating main window:', error);
    dialog.showErrorBox('Window Creation Error', `Failed to create the main window: ${error.message}`);
  }
}

// --- App Lifecycle Events ---

// Ensure directories are ready before creating window
app.whenReady().then(async () => {
  await initializeDirectories(); // Wait for dirs to be ready
  createWindow();

  app.on('activate', function () {
    // On macOS, re-create window when dock icon is clicked and no other windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

}).catch(error => {
  console.error('Error during app initialization:', error);
  dialog.showErrorBox('Application Start Error', `Failed to initialize the application: ${error.message}`);
  app.quit();
});

// Quit app when all windows are closed (except on macOS)
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
      console.log('All windows closed, quitting app.');
      app.quit();
    }
});

// --- IPC Handlers ---

// Standard error handler for IPC operations
function handleIPCError(error, operation) {
  console.error(`Error in IPC operation '${operation}':`, error);
  // Return a structured error object that preload/renderer can understand
  return { success: false, error: error.message || 'An unknown error occurred', details: error.stack };
}

// Get all bookmarks
ipcMain.handle('get-bookmarks', async () => {
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    return { success: true, data: bookmarks }; // Wrap in success object
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
    // 1. Process URL (fetch content, generate description/tags, take screenshot)
    const newBookmarkData = await urlProcessor.processURL(trimmedUrl);
    console.log(`IPC: URL processed, data received:`, newBookmarkData);

    // 2. Save the processed data using BookmarkManager
    // saveBookmark now returns the list of all bookmarks including the saved one
    await bookmarkManager.saveBookmark(newBookmarkData);
    console.log(`IPC: Bookmark saved to CSV: ${newBookmarkData.URL}`);

    // Return the single newly added/updated bookmark data
    return { success: true, bookmark: newBookmarkData };

  } catch (error) {
      console.error(`IPC: Failed to add bookmark for ${trimmedUrl}:`, error);
      // Provide more context if possible
      let errorMessage = error.message || 'Failed to process or save bookmark.';
      if (error.cause) { // If underlying error is available
        errorMessage += ` Cause: ${error.cause}`;
      }
      return { success: false, error: errorMessage };
  }
});


// Search bookmarks by query text
ipcMain.handle('search-bookmarks', async (_, query) => {
  try {
    const results = await bookmarkManager.searchBookmarks(query);
    return { success: true, data: results };
  } catch (error) {
    return handleIPCError(error, 'search-bookmarks');
  }
});

// Filter bookmarks by tags
ipcMain.handle('filter-by-tags', async (_, tags) => {
  // Ensure tags is an array
  const tagArray = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  try {
    const results = await bookmarkManager.filterByTags(tagArray);
    return { success: true, data: results };
  } catch (error) {
    return handleIPCError(error, 'filter-by-tags');
  }
});

// Filter bookmarks by date (simplified from original - relies on frontend filtering)
// Kept for potential future use, but renderer/app.js now handles date filtering
ipcMain.handle('filter-by-date', async (_, days) => {
  try {
    const bookmarks = await bookmarkManager.getBookmarks();
    if (days === 0 || days === undefined || days === null) {
        return { success: true, data: bookmarks }; // Return all if days is 0 or invalid
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0); // Start of the day

    const filtered = bookmarks.filter(bookmark => {
      try {
          const bookmarkDate = new Date(bookmark.Date);
          return !isNaN(bookmarkDate) && bookmarkDate >= cutoffDate;
      } catch (dateError) {
          console.warn(`Invalid date format for bookmark ${bookmark.URL}: ${bookmark.Date}`);
          return false; // Exclude bookmarks with invalid dates
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
    // Important: Ensure we are toggling based on the *current* state in the file if possible,
    // but for simplicity, we trust the state sent from the renderer for now.
    // A safer way would be to read the bookmark again before toggling.
    const currentIsFavorite = String(bookmark.Favorite).toLowerCase() === 'true';
    const updatedBookmarkData = {
      ...bookmark, // Spread existing data from renderer
      Favorite: !currentIsFavorite // Toggle the boolean state
      // Let saveBookmark handle converting boolean back to string 'true'/'false'
    };

    // Use saveBookmark which handles both update and string conversion
    await bookmarkManager.saveBookmark(updatedBookmarkData);

    // Return the bookmark with the *confirmed* new state
    return { success: true, bookmark: { ...updatedBookmarkData, Favorite: String(!currentIsFavorite) } };
  } catch (error) {
    return handleIPCError(error, 'toggle-favorite');
  }
});

// Take a screenshot (used standalone? Less common now, update-screenshot is preferred)
ipcMain.handle('take-screenshot', async (_, url) => {
   console.warn("IPC: 'take-screenshot' called directly. Prefer 'update-screenshot' for existing bookmarks.");
   if (!url || typeof url !== 'string' || !url.trim()) {
      return { success: false, error: "Invalid URL provided for screenshot." };
   }
  try {
    const screenshotPath = await urlProcessor.takeScreenshot(url.trim());
    return { success: true, screenshotPath };
  } catch (error) {
    return handleIPCError(error, 'take-screenshot');
  }
});

// Update bookmark screenshot for an existing bookmark
ipcMain.handle('update-screenshot', async (_, bookmark) => {
  if (!bookmark || !bookmark.URL) {
      return { success: false, error: "Invalid bookmark data provided for update screenshot." };
  }
  console.log(`IPC: Received update-screenshot request for URL: ${bookmark.URL}`);
  try {
    // 1. Take a new screenshot
    const newScreenshotPath = await urlProcessor.takeScreenshot(bookmark.URL);
    console.log(`IPC: New screenshot taken: ${newScreenshotPath}`);

    // 2. Get the old path *before* updating
    const oldScreenshotPath = bookmark.Screenshot;

    // 3. Create updated bookmark data object
    const updatedBookmarkData = { ...bookmark, Screenshot: newScreenshotPath };

    // 4. Save the bookmark data with the new path
    await bookmarkManager.saveBookmark(updatedBookmarkData);
    console.log(`IPC: Bookmark ${bookmark.URL} updated with new screenshot path.`);

    // 5. Delete the OLD screenshot file *after* successfully saving the CSV
    if (oldScreenshotPath && oldScreenshotPath !== newScreenshotPath && fs.existsSync(oldScreenshotPath)) {
        try {
            await fsp.unlink(oldScreenshotPath);
            console.log(`IPC: Deleted old screenshot: ${oldScreenshotPath}`);
        } catch (unlinkError) {
            console.warn(`IPC: Failed to delete old screenshot file ${oldScreenshotPath}:`, unlinkError);
            // Don't fail the whole operation, just log a warning.
        }
    }

    // Return the fully updated bookmark object
    return { success: true, bookmark: updatedBookmarkData };
  } catch (error) {
    // If taking screenshot or saving failed, the old screenshot won't be deleted.
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
          .map(tag => tag.trim()) // Trim whitespace
          .filter(tag => tag) // Remove empty tags
          .forEach(tag => tagsSet.add(tag));
      }
    });

    const sortedTags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b)); // Case-sensitive sort
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
      defaultPath: `bookmarks_${Date.now()}.csv`, // More unique default name
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
    const count = await bookmarkManager.importFromCSV(sourcePath); // Returns count of *processed* rows

    // After import, send a signal to renderer to reload bookmarks
    if (mainWindow) {
        mainWindow.webContents.send('bookmarks-updated'); // Define this channel in preload if needed
    }

    return {
      success: true,
      count, // Count of rows processed from the file
      message: `Successfully processed ${count} bookmarks from ${path.basename(sourcePath)}`
    };
  } catch (error) {
      dialog.showErrorBox('Import Error', `Failed to import bookmarks: ${error.message}`);
    return handleIPCError(error, 'import-csv');
  }
});

// Open bookmark URL in default browser
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
    // 1. Get all current bookmarks
    const bookmarks = await bookmarkManager.getBookmarks();

    // 2. Filter out the bookmark to be deleted
    const filteredBookmarks = bookmarks.filter(b => b.URL !== bookmark.URL);

    // Check if actually found and filtered something
    if (filteredBookmarks.length === bookmarks.length) {
        console.warn(`IPC: Bookmark to delete not found in CSV: ${bookmark.URL}`);
        // Still proceed to attempt file deletion, maybe it's an orphan record
    }

    // 3. Save the updated (filtered) list back to the CSV *FIRST*
    await bookmarkManager.saveBookmarks(filteredBookmarks);
    console.log(`IPC: Saved CSV after removing ${bookmark.URL}.`);

    // 4. If saving was successful, delete the associated screenshot file
    const screenshotToDelete = bookmark.Screenshot;
    if (screenshotToDelete && typeof screenshotToDelete === 'string' && fs.existsSync(screenshotToDelete)) {
      try {
        await fsp.unlink(screenshotToDelete);
        console.log(`IPC: Deleted associated screenshot: ${screenshotToDelete}`);
      } catch (fileError) {
        // Log error but don't fail the whole operation, as CSV is updated
        console.error(`IPC: Error deleting screenshot file ${screenshotToDelete} (bookmark already removed from CSV):`, fileError);
      }
    } else {
        // console.log(`IPC: No screenshot file associated or found for ${bookmark.URL}.`)
    }

    return { success: true }; // Indicate success even if screenshot deletion failed

  } catch (error) {
    // This catches errors from getBookmarks or saveBookmarks mostly
    return handleIPCError(error, 'delete-bookmark');
  }
});


// Check LLM service availability
ipcMain.handle('check-llm-service', async () => {
  try {
    // Assuming llmClient.checkService() is implemented and returns { available: boolean, ... }
    const result = await llmClient.checkService();
    return { success: true, data: result }; // Wrap in success object
  } catch (error) {
      // checkService might throw if axios fails completely
    return handleIPCError(error, 'check-llm-service');
  }
});

// Listen for signal from renderer to reload data (e.g., after import)
// Note: This requires changes in preload.js and renderer/app.js to handle the 'bookmarks-updated' signal.
// For simplicity now, we rely on the renderer calling loadBookmarks after import success.
/*
ipcMain.on('request-reload-bookmarks', async (event) => {
    try {
        const bookmarks = await bookmarkManager.getBookmarks();
        event.sender.send('bookmarks-reloaded', { success: true, data: bookmarks });
    } catch (error) {
        event.sender.send('bookmarks-reloaded', handleIPCError(error, 'reload-bookmarks-on-request'));
    }
});
*/