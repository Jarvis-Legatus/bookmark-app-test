// renderer/app.js
document.addEventListener('DOMContentLoaded', () => {
  const app = {
    bookmarks: [], // Local cache of bookmark objects
    allTags: [], // Local cache of unique tags
    activeFilter: 'all',
    activeTags: [],
    searchQuery: '',
    isLoading: false, // Flag to prevent multiple simultaneous loads
    isDarkMode: false, // Track theme state
    searchTimeout: null, // Added to track search debounce
    toastTimeout: null, // Added to track toast timeout

    init() {
      console.log("App initializing...");
      this.cacheElements();
      this.loadInitialTheme(); // Load theme preference first
      this.bindEvents();
      this.loadInitialData(); // Load bookmarks and tags
      this.checkLLMStatus(); // Check LLM status on startup
    },

    cacheElements() {
      this.urlInput = document.getElementById('url-input');
      this.addButton = document.getElementById('add-button');
      this.searchInput = document.getElementById('search-input');
      this.filtersEl = document.getElementById('filters');
      this.tagsListEl = document.getElementById('tags-list');
      this.bookmarksGridEl = document.getElementById('bookmarks-grid');
      this.exportButton = document.getElementById('export-button');
      this.importButton = document.getElementById('import-button');
      this.settingsButton = document.getElementById('settings-button'); // ** NEW **
      this.toastEl = document.getElementById('toast');
      this.sidebarEl = document.querySelector('.sidebar');
    },

    bindEvents() {
      if(!this.addButton) { console.error("Add button not found!"); return; } // Add checks
      this.addButton.addEventListener('click', () => this.addBookmark());
      if(!this.urlInput) { console.error("URL input not found!"); return; }
      this.urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.addBookmark();
      });

      if(!this.searchInput) { console.error("Search input not found!"); return; }
      this.searchInput.addEventListener('input', () => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.searchQuery = this.searchInput.value.trim();
            this.filterAndRenderBookmarks();
        }, 250);
      });

      if(!this.filtersEl) { console.error("Filters element not found!"); return; }
      this.filtersEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI' && e.target.dataset.filter) {
          this.setActiveFilter(e.target.dataset.filter);
        }
      });

      if(!this.tagsListEl) { console.error("Tags list element not found!"); return; }
      this.tagsListEl.addEventListener('click', (e) => {
          if (e.target.classList.contains('tag')) {
              const tag = e.target.textContent;
              this.toggleTagFilter(tag);
          }
      });

      if(!this.exportButton) { console.error("Export button not found!"); return; }
      this.exportButton.addEventListener('click', () => this.exportCSV());
      if(!this.importButton) { console.error("Import button not found!"); return; }
      this.importButton.addEventListener('click', () => this.importCSV());

      if(!this.settingsButton) { console.error("Settings button not found!"); return; }
      this.settingsButton.addEventListener('click', () => this.openSettings());

      if(!this.bookmarksGridEl) { console.error("Bookmarks grid not found!"); return; }
      this.bookmarksGridEl.addEventListener('click', (e) => {
          const target = e.target;
          const card = target.closest('.bookmark-card');
          if (!card) return;

          const url = card.dataset.url;
          if (!url) return;

          const bookmark = this.bookmarks.find(b => b.URL === url);
          if (!bookmark) {
              console.warn("Clicked card but bookmark not found in local cache:", url);
              return;
          }

          if (target.classList.contains('favorite-toggle')) {
              this.toggleFavorite(bookmark);
          }
          else if (target.closest('.screenshot-action-update')) {
               e.preventDefault();
              this.updateScreenshot(bookmark, target.closest('.screenshot-action-update'));
          }
          else if (target.classList.contains('delete-button')) {
              this.deleteBookmark(bookmark);
          }
          else if (target.classList.contains('tag') && target.closest('.bookmark-tags')) {
              const tag = target.textContent;
               if (!this.activeTags.includes(tag)) {
                this.toggleTagFilter(tag);
              }
          }
      });

       // Check if window.api exists before adding listeners
      if (window.api) {
           window.api.onApplyTheme((isDarkMode) => {
               console.log('Renderer received apply-theme:', isDarkMode);
               this.applyTheme(isDarkMode);
           });

           window.api.onBookmarksUpdated(() => {
               console.log('Renderer received bookmarks-updated notification.');
               this.showToast('Bookmark list updated.', 'info');
               this.loadInitialData(); // Reload bookmarks and tags
           });
      } else {
          console.error("FATAL: window.api not found! Preload script likely failed.");
          // Display a persistent error message to the user
          document.body.innerHTML = `<div style="padding: 20px; color: red; font-size: 16px;">
              <h2>Application Error</h2>
              <p>Failed to initialize communication with the main process (window.api is missing).</p>
              <p>Please check the console for errors (You might need to enable DevTools in main.js) and restart the application.</p>
            </div>`;
      }
    },

     async loadInitialTheme() {
         if (!window.api) return; // Guard against api missing
         try {
             const result = await window.api.getSettings();
             if (result.success) {
                 this.applyTheme(result.data.darkMode || false);
             } else {
                 console.warn("Failed to load initial theme setting:", result.error);
             }
         } catch (error) {
             console.error("Error loading initial theme setting:", error);
         }
     },

     applyTheme(isDarkMode) {
         this.isDarkMode = isDarkMode;
         document.body.classList.toggle('dark-mode', this.isDarkMode);
         console.log(`Theme applied: ${isDarkMode ? 'Dark' : 'Light'}`);
     },

    async loadInitialData() {
        if (!window.api) return; // Guard
        if (this.isLoading) return;
        this.isLoading = true;
        if (this.sidebarEl) this.sidebarEl.classList.add('loading');

        console.log("Starting initial data load...");
        try {
            // Run sequentially to ensure bookmarks are loaded before filtering happens
            await this.loadBookmarks();
            await this.loadTags();
            console.log("Initial data load completed.");
        } catch (error) {
            console.error("Error during initial data load sequence:", error);
            this.showToast("Error loading initial data. Check console.", "error");
        } finally {
             this.isLoading = false;
              if (this.sidebarEl) this.sidebarEl.classList.remove('loading');
        }
    },

    async loadBookmarks() {
      if (!window.api) throw new Error("window.api not available"); // Throw error if api is missing
      console.log("Loading bookmarks...");
      try {
        const result = await window.api.getBookmarks();
        if (result.success) {
          this.bookmarks = Array.isArray(result.data) ? result.data : [];
          console.log(`Loaded ${this.bookmarks.length} bookmarks.`);
          this.filterAndRenderBookmarks(); // Apply current filters/search
        } else {
          console.error('Error loading bookmarks:', result.error);
          this.showToast('Error loading bookmarks: ' + (result.error || 'Unknown error'), 'error');
          this.bookmarks = [];
          this.renderBookmarks([]); // Clear grid on error
        }
      } catch (error) {
        console.error('Critical error loading bookmarks:', error);
        this.showToast('Critical error loading bookmarks: ' + error.message, 'error');
        this.bookmarks = [];
        this.renderBookmarks([]);
        throw error; // Re-throw to be caught by loadInitialData
      }
    },

     async loadTags() {
        if (!window.api) throw new Error("window.api not available");
        console.log("Loading tags...");
        try {
            const result = await window.api.getAllTags();
            if (result.success) {
                this.allTags = Array.isArray(result.data) ? result.data : [];
                console.log(`Loaded ${this.allTags.length} unique tags.`);
                this.renderTagsList();
            } else {
                console.error('Error loading tags:', result.error);
                this.showToast('Error loading tags: ' + (result.error || 'Unknown error'), 'error');
                this.allTags = [];
                this.renderTagsList(); // Clear tags list on error
            }
        } catch (error) {
            console.error('Critical error loading tags:', error);
            this.showToast('Critical error loading tags: ' + error.message, 'error');
            this.allTags = [];
            this.renderTagsList();
            throw error; // Re-throw
        }
    },

    async addBookmark() {
      if (!window.api) return;
      const url = this.urlInput.value.trim();
      if (!url) {
          this.showToast('Please enter a URL', 'warning');
          return;
      }
      let processedUrl = url;
      if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
           processedUrl = 'https://' + processedUrl;
           this.urlInput.value = processedUrl;
      }

      this.addButton.innerHTML = '<span class="spinner"></span>';
      this.addButton.disabled = true;
      this.urlInput.disabled = true;

      try {
        console.log(`Attempting to add bookmark via API: ${processedUrl}`);
        const result = await window.api.addBookmark(processedUrl);
        console.log('Add bookmark result:', result);
        if (result.success && result.bookmark) {
          this.urlInput.value = '';
          this.showToast('Bookmark added successfully');
          this.bookmarks.unshift(result.bookmark);
          this.filterAndRenderBookmarks();
          this.loadTags().catch(err => console.warn("Non-critical: Failed to reload tags after add:", err));
        } else {
          console.error('Add bookmark failed:', result.error);
          this.showToast('Error adding bookmark: ' + (result.error || 'Unknown error'), 'error');
        }
      } catch (error) {
        console.error('Critical error adding bookmark:', error);
        this.showToast('Critical error adding bookmark: ' + error.message, 'error');
      } finally {
        this.addButton.innerHTML = 'Add';
        this.addButton.disabled = false;
        this.urlInput.disabled = false;
      }
    },

    async updateScreenshot(bookmark, buttonElement) {
        if (!window.api) return;
        if (!bookmark || !bookmark.URL) return;

        console.log(`Updating screenshot for: ${bookmark.URL}`);
        const card = buttonElement.closest('.bookmark-card');
        if (card) card.classList.add('card-loading');

        const originalContent = buttonElement.innerHTML;
        buttonElement.innerHTML = '<span class="spinner"></span>';
        buttonElement.disabled = true;

         try {
              const result = await window.api.updateScreenshot(bookmark);
              if (result.success && result.bookmark) {
                  this.showToast('Screenshot updated successfully');
                  const index = this.bookmarks.findIndex(b => b.URL === bookmark.URL);
                  if (index !== -1) {
                      this.bookmarks[index] = result.bookmark; // Update with latest data
                       console.log("Local bookmark cache updated with new screenshot info.");
                  } else {
                      console.warn("Screenshot updated, but bookmark not found in local cache:", bookmark.URL);
                      this.bookmarks.unshift(result.bookmark); // Add if missing? Or just log?
                  }
                  this.filterAndRenderBookmarks(); // Re-render grid
              } else {
                  console.error('Error updating screenshot:', result.error);
                  this.showToast('Error updating screenshot: ' + (result.error || 'Unknown error'), 'error');
                  buttonElement.innerHTML = originalContent; // Restore button
                  buttonElement.disabled = false;
                  if (card) card.classList.remove('card-loading');
              }
          } catch (error) {
              console.error(`Critical error updating screenshot for ${bookmark.URL}:`, error);
              this.showToast('Critical error updating screenshot: ' + error.message, 'error');
               buttonElement.innerHTML = originalContent; // Restore button
               buttonElement.disabled = false;
               if (card) card.classList.remove('card-loading');
          }
        // Success case implicitly removes loading state via filterAndRenderBookmarks
    },

    async toggleFavorite(bookmark) {
        if (!window.api) return;
        if (!bookmark || !bookmark.URL) return;
        console.log(`Toggling favorite for: ${bookmark.URL}`);
        const originalBookmarkStateForAPI = { ...bookmark }; // Use current state for API call

        const index = this.bookmarks.findIndex(b => b.URL === bookmark.URL);
        if (index === -1) {
            console.error("Bookmark not found in local cache for toggling:", bookmark.URL);
            return;
        }

        // --- Optimistic UI Update ---
        const currentIsFavorite = String(this.bookmarks[index].Favorite).toLowerCase() === 'true';
        const newState = !currentIsFavorite;
        this.bookmarks[index].Favorite = String(newState); // Update local cache immediately
        console.log(`Optimistic update: Set favorite to ${newState} for ${bookmark.URL}`);
        this.filterAndRenderBookmarks(); // Re-render to show change instantly
        // --- End Optimistic Update ---

        try {
            console.log(`Calling API toggleFavorite for ${bookmark.URL}`);
            const result = await window.api.toggleFavorite(originalBookmarkStateForAPI);
            console.log(`API toggleFavorite result for ${bookmark.URL}:`, result);

            if (result.success && result.bookmark) {
                // --- Confirmation Update ---
                const confirmedState = String(result.bookmark.Favorite).toLowerCase() === 'true';
                if (String(this.bookmarks[index].Favorite).toLowerCase() !== String(confirmedState)) {
                     console.warn(`Favorite state mismatch for ${bookmark.URL}. UI was ${this.bookmarks[index].Favorite}, backend confirmed ${confirmedState}. Correcting cache.`);
                     this.bookmarks[index].Favorite = String(confirmedState); // Correct local cache based on definitive source
                } else {
                     console.log(`Favorite status for ${bookmark.URL} confirmed as ${confirmedState}`);
                }
                // Update local cache with full bookmark data from backend for consistency
                this.bookmarks[index] = result.bookmark;
                // --- End Confirmation Update ---
            } else {
                // --- Revert on API Failure ---
                console.error('Toggle favorite failed via API:', result.error);
                this.showToast('Error toggling favorite: ' + (result.error || 'Unknown error'), 'error');
                this.bookmarks[index].Favorite = String(currentIsFavorite); // Revert local cache to state *before* optimistic update
                console.log(`Reverted favorite state to ${currentIsFavorite} for ${bookmark.URL} due to API error.`);
                // --- End Revert ---
            }
        } catch (error) {
            // --- Revert on Critical Error ---
            console.error(`Critical error toggling favorite for ${bookmark.URL}:`, error);
            this.showToast('Critical error toggling favorite: ' + error.message, 'error');
            this.bookmarks[index].Favorite = String(currentIsFavorite); // Revert local cache
            console.log(`Reverted favorite state to ${currentIsFavorite} for ${bookmark.URL} due to critical error.`);
            // --- End Revert ---
        } finally {
            // Re-render regardless to ensure UI reflects the final state in the cache.
            this.filterAndRenderBookmarks();
        }
    },


     async deleteBookmark(bookmark) {
         if (!window.api) return;
         if (!bookmark || !bookmark.URL) return;

         const confirmation = confirm(`Are you sure you want to delete this bookmark?\n\n${bookmark.Title || bookmark.URL}`);
         if (!confirmation) return;

         console.log(`Attempting to delete bookmark: ${bookmark.URL}`);
         const card = this.bookmarksGridEl.querySelector(`.bookmark-card[data-url="${CSS.escape(bookmark.URL)}"]`);
         if (card) card.classList.add('card-deleting');

         try {
             const result = await window.api.deleteBookmark(bookmark);
             if (result.success) {
                 this.showToast('Bookmark deleted successfully');
                 this.bookmarks = this.bookmarks.filter(b => b.URL !== bookmark.URL);
                 this.filterAndRenderBookmarks();
                 this.loadTags().catch(err => console.warn("Non-critical: Failed to reload tags after delete:", err));
             } else {
                 console.error('Error deleting bookmark:', result.error);
                 this.showToast('Error deleting bookmark: ' + (result.error || 'Unknown error'), 'error');
                 if (card) card.classList.remove('card-deleting');
             }
         } catch (error) {
             console.error(`Critical error deleting bookmark ${bookmark.URL}:`, error);
             this.showToast('Critical error deleting bookmark: ' + error.message, 'error');
             if (card) card.classList.remove('card-deleting');
         }
     },

    async exportCSV() {
      if (!window.api) return;
      console.log("Exporting CSV...");
      this.exportButton.textContent = 'Exporting...';
      this.exportButton.disabled = true;
      try {
        const result = await window.api.exportCSV();
        if (result.success) {
          this.showToast(result.message || `Exported ${result.count} bookmarks successfully`);
        } else {
            if (result.message === 'Export cancelled') {
                 this.showToast('Export cancelled', 'info');
            } else {
                 console.error("Export failed:", result.error);
                 this.showToast('Export failed: ' + (result.message || result.error || 'Unknown error'), 'error');
            }
        }
      } catch (error) {
         console.error('Critical error exporting CSV:', error);
        this.showToast('Critical error exporting: ' + error.message, 'error');
      } finally {
          this.exportButton.textContent = 'Export CSV';
          this.exportButton.disabled = false;
      }
    },

    async importCSV() {
      if (!window.api) return;
      console.log("Importing CSV...");
      this.importButton.textContent = 'Importing...';
      this.importButton.disabled = true;
      try {
        const result = await window.api.importCSV();
        // Success/failure notification is handled by main process dialogs + 'bookmarks-updated' event
         if (!result.success && result.message === 'Import cancelled') {
             this.showToast('Import cancelled', 'info');
         } else if (!result.success) {
             console.error("Import failed:", result.error);
             this.showToast('Import failed. See error dialog/console.', 'error');
         }
         // Successful import triggers 'bookmarks-updated' which calls loadInitialData
      } catch (error) {
        console.error('Critical error during import process:', error);
        this.showToast('Critical error importing: ' + error.message, 'error');
      } finally {
          this.importButton.textContent = 'Import CSV';
          this.importButton.disabled = false;
      }
    },

     async openSettings() {
         if (!window.api) return;
         console.log("Requesting to open settings window...");
         try {
             const result = await window.api.openSettingsWindow();
              if (!result.success) {
                 console.error("Failed to open settings window:", result.error);
                 this.showToast("Could not open settings: " + (result.error || 'Unknown error'), "error");
             }
         } catch (error) {
             console.error("Critical error trying to open settings window:", error);
             this.showToast("Could not open settings: " + error.message, "error");
         }
     },

    setActiveFilter(filter) {
      if (this.activeFilter === filter) return;
      console.log(`Setting active filter to: ${filter}`);
      this.activeFilter = filter;

      if(this.filtersEl) {
          this.filtersEl.querySelectorAll('li').forEach(item => {
            item.classList.toggle('active', item.dataset.filter === filter);
          });
      }
      this.filterAndRenderBookmarks();
    },

    toggleTagFilter(tag) {
      if (!tag) return;
      console.log(`Toggling tag filter: ${tag}`);
      const index = this.activeTags.indexOf(tag);
      if (index >= 0) {
        this.activeTags.splice(index, 1); // Remove tag
      } else {
        this.activeTags.push(tag); // Add tag
      }
      this.renderTagsList(); // Update tag list UI
      this.filterAndRenderBookmarks(); // Update bookmark grid
    },

     renderTagsList() {
      if (!this.tagsListEl) return;
      this.tagsListEl.innerHTML = ''; // Clear existing tags
      if (this.allTags.length === 0) {
           this.tagsListEl.innerHTML = '<span>No tags yet.</span>';
           return;
      }
      const fragment = document.createDocumentFragment();
      this.allTags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = `tag ${this.activeTags.includes(tag) ? 'active' : ''}`;
        tagEl.textContent = tag;
        fragment.appendChild(tagEl);
      });
       this.tagsListEl.appendChild(fragment);
    },

    // Central function to apply all filters and search, then render
    filterAndRenderBookmarks() {
      console.log(`Filtering bookmarks. Search: "${this.searchQuery}", Filter: ${this.activeFilter}, Tags: [${this.activeTags.join(', ')}]`);
      let filtered = [...this.bookmarks];

      // Apply search filter
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        filtered = filtered.filter(bookmark =>
          (bookmark.URL && bookmark.URL.toLowerCase().includes(query)) ||
          (bookmark.Title && bookmark.Title.toLowerCase().includes(query)) ||
          (bookmark.Description && bookmark.Description.toLowerCase().includes(query)) ||
          (bookmark.Tags && bookmark.Tags.toLowerCase().includes(query))
        );
      }

      // Apply main filter
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 7);

      if (this.activeFilter === 'favorites') {
        filtered = filtered.filter(bookmark => String(bookmark.Favorite).toLowerCase() === 'true');
      } else if (this.activeFilter === 'today') {
        filtered = filtered.filter(bookmark => {
           try { return new Date(bookmark.Date) >= today; } catch { return false; }
        });
      } else if (this.activeFilter === 'week') {
        filtered = filtered.filter(bookmark => {
          try { return new Date(bookmark.Date) >= weekAgo; } catch { return false; }
        });
      }
      // 'all' needs no filtering here

      // Apply tag filter
      if (this.activeTags.length > 0) {
          const activeTagsLower = this.activeTags.map(t => t.toLowerCase());
          filtered = filtered.filter(bookmark => {
              if (!bookmark.Tags) return false;
              const bookmarkTags = String(bookmark.Tags).split(',')
                                        .map(t => t.trim().toLowerCase())
                                        .filter(t => t);
              // Check if *any* of the bookmark's tags are present in the active filter tags
              return bookmarkTags.some(bt => activeTagsLower.includes(bt));
        });
      }

      // Sort results by date descending
      try {
          filtered.sort((a, b) => new Date(b.Date) - new Date(a.Date));
      } catch (sortError) {
          console.warn("Could not sort bookmarks by date due to invalid date format:", sortError);
      }

      console.log(`Rendering ${filtered.length} filtered bookmarks.`);
      this.renderBookmarks(filtered);
    },

    renderBookmarks(bookmarksToRender) {
      if (!this.bookmarksGridEl) return;
      this.bookmarksGridEl.innerHTML = ''; // Clear previous content

      if (!Array.isArray(bookmarksToRender)) {
           console.error("RenderBookmarks called with invalid data:", bookmarksToRender);
           bookmarksToRender = [];
      }

      if (bookmarksToRender.length === 0) {
        this.bookmarksGridEl.innerHTML = `<div class="empty-state">
          ${this.searchQuery || this.activeTags.length > 0 || this.activeFilter !== 'all' ? 'No bookmarks match your filters.' : 'No bookmarks yet. Add one!'}
        </div>`;
        return;
      }

      const fragment = document.createDocumentFragment();

      bookmarksToRender.forEach(bookmark => {
          if (!bookmark || !bookmark.URL) {
              console.warn("Skipping rendering invalid bookmark data:", bookmark);
              return;
          }

          const card = document.createElement('div');
          card.className = 'bookmark-card';
          card.dataset.url = bookmark.URL;

          // --- Screenshot Section ---
          const screenshotContainer = document.createElement('div');
          screenshotContainer.className = 'screenshot-container';
          const screenshotEl = document.createElement('div');
          screenshotEl.className = 'screenshot';
          let actionButton; // Define outside if/else

          if (bookmark.Screenshot && typeof bookmark.Screenshot === 'string') {
               const img = document.createElement('img');
               // Main process guarantees absolute path. Replace backslashes, encode URI components.
               const filePath = bookmark.Screenshot.replace(/\\/g, '/');
               const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');
               img.src = `file:///${encodedFilePath}`; // Triple slash for absolute file path

               img.alt = `Screenshot of ${bookmark.Title || bookmark.URL}`;
               img.loading = 'lazy';
               img.onerror = (e) => {
                   console.warn(`Failed to load screenshot: ${img.src}`, e);
                   const container = e.target.closest('.screenshot');
                   if (container) {
                       container.innerHTML = '<span class="screenshot-error">Screenshot missing</span>';
                       // Add 'Take Screenshot' button dynamically on error
                       const actionContainer = e.target.closest('.screenshot-container');
                       const takeButton = document.createElement('button');
                       takeButton.className = 'screenshot-action-update button-overlay visible-on-error';
                       takeButton.title = 'Take Screenshot';
                       takeButton.innerHTML = '📸';
                       actionContainer?.appendChild(takeButton);
                   }
                   e.target.remove(); // Remove broken img
               };
               screenshotEl.appendChild(img);

               actionButton = document.createElement('button');
               actionButton.className = 'screenshot-action-update button-overlay';
               actionButton.title = 'Update Screenshot';
               actionButton.innerHTML = '🔄';

          } else {
              // No screenshot path exists
              screenshotEl.innerHTML = `<span class="screenshot-placeholder">No Screenshot</span>`;
              actionButton = document.createElement('button');
              actionButton.className = 'screenshot-action-update button-overlay'; // Give it same class
              actionButton.title = 'Take Screenshot';
              actionButton.innerHTML = '📸';
          }
          screenshotContainer.appendChild(screenshotEl);
          // Ensure actionButton is always appended if defined
          if (actionButton) screenshotContainer.appendChild(actionButton);


          // --- Content Section ---
          const contentEl = document.createElement('div');
          contentEl.className = 'bookmark-content';
          const headerEl = document.createElement('div');
          headerEl.className = 'bookmark-header';
          const titleEl = document.createElement('h3');
          titleEl.className = 'bookmark-title';
          const linkEl = document.createElement('a');
          linkEl.href = bookmark.URL;
          linkEl.textContent = bookmark.Title || bookmark.URL;
          linkEl.title = bookmark.URL;
          linkEl.target = '_blank';
          linkEl.rel = 'noopener noreferrer';
          titleEl.appendChild(linkEl);

          const controlsEl = document.createElement('div');
          controlsEl.className = 'bookmark-controls';
          const favEl = document.createElement('button');
          const isFavorite = String(bookmark.Favorite).toLowerCase() === 'true';
          favEl.className = `favorite-toggle icon-button ${isFavorite ? 'is-favorite' : ''}`;
          favEl.innerHTML = isFavorite ? '★' : '☆';
          favEl.title = isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
          const deleteEl = document.createElement('button');
          deleteEl.className = 'delete-button icon-button';
          deleteEl.innerHTML = '🗑️';
          deleteEl.title = 'Delete Bookmark';
          controlsEl.appendChild(favEl);
          controlsEl.appendChild(deleteEl);
          headerEl.appendChild(titleEl);
          headerEl.appendChild(controlsEl);

          let descEl = null;
          if (bookmark.Description) {
              descEl = document.createElement('p');
              descEl.className = 'bookmark-description';
              descEl.textContent = bookmark.Description;
              descEl.title = bookmark.Description;
          }

          let tagsEl = null;
          if (bookmark.Tags) {
              tagsEl = document.createElement('div');
              tagsEl.className = 'bookmark-tags';
              String(bookmark.Tags).split(',')
                  .map(tag => tag.trim()).filter(tag => tag)
                  .forEach(tag => {
                      const tagSpan = document.createElement('span');
                      tagSpan.className = 'tag';
                      tagSpan.textContent = tag;
                      tagSpan.title = `Filter by tag: ${tag}`;
                      tagsEl.appendChild(tagSpan);
              });
          }

          const footerEl = document.createElement('div');
          footerEl.className = 'bookmark-footer';
          const dateEl = document.createElement('span');
          dateEl.className = 'bookmark-date';
          try {
              const d = new Date(bookmark.Date);
              // Check if date is valid before formatting
              if (!isNaN(d.getTime())) {
                  dateEl.textContent = d.toLocaleDateString();
                  dateEl.title = d.toLocaleString();
              } else {
                  dateEl.textContent = 'Invalid Date';
              }
          } catch { dateEl.textContent = 'Invalid Date'; }
          footerEl.appendChild(dateEl);

          // Assemble Content
          contentEl.appendChild(headerEl);
          if (descEl) contentEl.appendChild(descEl);
          if (tagsEl) contentEl.appendChild(tagsEl);
          contentEl.appendChild(footerEl);

          // Assemble Card
          card.appendChild(screenshotContainer);
          card.appendChild(contentEl);

          fragment.appendChild(card);
      });

      this.bookmarksGridEl.appendChild(fragment); // Append fragment to DOM once
    },

    showToast(message, type = 'info') {
      if (!this.toastEl) return;
      this.toastEl.textContent = message;
      this.toastEl.className = `toast show ${type}`; // Reset classes and add type
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => {
        if (this.toastEl) this.toastEl.classList.remove('show');
      }, 3000); // 3 seconds
    },

     async checkLLMStatus() {
         if (!window.api) return;
         try {
             const result = await window.api.checkLLMService();
             if (result.success && result.data.available) {
                 console.info('LLM service check: Available', result.data);
             } else {
                 console.warn('LLM service check: Not Available or Error', result);
                 this.showToast(`LLM service unavailable: ${result.error || 'Check Settings & Console'}`, 'warning');
             }
         } catch (error) {
             console.error('Critical error checking LLM service:', error);
             this.showToast(`Error checking LLM service: ${error.message}`, 'error');
         }
     }

  }; // End of app object

  // *** REMOVED: const path = require('path'); ***

  app.init(); // Start the application
});