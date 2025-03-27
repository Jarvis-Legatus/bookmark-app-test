// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Wrapper function to handle the { success, data/error } structure for invokes
const invokeWrapper = (channel, ...args) => {
    console.log(`Preload: Invoking ${channel}`, args);
    return ipcRenderer.invoke(channel, ...args)
        .then(result => {
            console.log(`Preload: Result for ${channel}`, result);
             // Check if the result is structured as expected
            if (typeof result === 'object' && result !== null && typeof result.success === 'boolean') {
                 if (result.success) {
                     return result; // Pass the whole { success: true, data/bookmark: ... } object
                 } else {
                     // Throw an error that includes the message from the main process
                     throw new Error(result.error || `An unknown error occurred in the main process during ${channel}.`);
                 }
            } else {
                 // If the main process didn't return the expected structure, treat as error
                 console.warn(`Preload: Unexpected response format from ${channel}:`, result);
                 throw new Error(`Unexpected response format from main process for ${channel}.`);
            }
        })
        .catch(error => {
            // Catch errors from invoke itself or from the structured error thrown above
            console.error(`Preload: Error invoking ${channel}:`, error);
            // Rethrow the error so the renderer's catch block receives it
            throw error;
        });
};


// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Bookmark management
  getBookmarks: () => invokeWrapper('get-bookmarks'),
  addBookmark: (url) => invokeWrapper('add-bookmark', url),
  searchBookmarks: (query) => invokeWrapper('search-bookmarks', query),
  filterByTags: (tags) => invokeWrapper('filter-by-tags', tags),
  // filterByDate: (days) => invokeWrapper('filter-by-date', days), // Renderer handles dates
  getFavorites: () => invokeWrapper('get-favorites'),
  toggleFavorite: (bookmark) => invokeWrapper('toggle-favorite', bookmark),
  deleteBookmark: (bookmark) => invokeWrapper('delete-bookmark', bookmark),

  // Screenshot functionality
  updateScreenshot: (bookmark) => invokeWrapper('update-screenshot', bookmark),

  // Tag management
  getAllTags: () => invokeWrapper('get-all-tags'),

  // Import/Export
  exportCSV: () => invokeWrapper('export-csv'),
  importCSV: () => invokeWrapper('import-csv'),

  // URL handling
  openURL: (url) => invokeWrapper('open-url', url),

  // System / LLM
  checkLLMService: () => invokeWrapper('check-llm-service'),

  // --- Settings ---
  getSettings: () => invokeWrapper('get-settings'),
  setSettings: (settingsObject) => invokeWrapper('set-settings', settingsObject),
  openSettingsWindow: () => invokeWrapper('open-settings-window'),

  // --- Listeners / Notifications ---
  // For main window to react to theme changes from settings
  onApplyTheme: (callback) => ipcRenderer.on('apply-theme', (event, isDarkMode) => callback(isDarkMode)),
  removeApplyThemeListener: (callback) => ipcRenderer.removeListener('apply-theme', callback),

  // For settings window to notify main process about theme change
  notifyThemeChange: (isDarkMode) => ipcRenderer.send('theme-changed', isDarkMode),

  // For main window to react to general bookmark updates (like after import)
  onBookmarksUpdated: (callback) => ipcRenderer.on('bookmarks-updated', (event) => callback()),
  removeBookmarksUpdatedListener: (callback) => ipcRenderer.removeListener('bookmarks-updated', callback),

});

console.log('Preload script executed and API exposed.');