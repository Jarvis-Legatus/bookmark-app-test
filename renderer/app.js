// renderer/app.js
document.addEventListener('DOMContentLoaded', () => {
  const app = {
    bookmarks: [], // Local cache of bookmark objects
    allTags: [], // Local cache of unique tags
    activeFilter: 'all',
    activeTags: [],
    searchQuery: '',
    isLoading: false, // Flag to prevent multiple simultaneous loads

    init() {
      console.log("App initializing...");
      this.cacheElements();
      this.bindEvents();
      this.loadInitialData(); // Load bookmarks and tags initially
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
      this.toastEl = document.getElementById('toast');
      this.sidebarEl = document.querySelector('.sidebar'); // For loading state
    },

    bindEvents() {
      this.addButton.addEventListener('click', () => this.addBookmark());
      this.urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.addBookmark();
      });

      // Use 'input' for immediate feedback as user types
      this.searchInput.addEventListener('input', () => {
        // Debounce search slightly to avoid filtering on every keystroke
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.searchQuery = this.searchInput.value.trim();
            this.filterAndRenderBookmarks();
        }, 250); // 250ms delay
      });

      this.filtersEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI' && e.target.dataset.filter) {
          this.setActiveFilter(e.target.dataset.filter);
        }
      });

      // Event delegation for tags list (handles dynamically added tags)
      this.tagsListEl.addEventListener('click', (e) => {
          if (e.target.classList.contains('tag')) {
              const tag = e.target.textContent;
              this.toggleTagFilter(tag);
          }
      });

      this.exportButton.addEventListener('click', () => this.exportCSV());
      this.importButton.addEventListener('click', () => this.importCSV());

      // Event delegation for bookmark card actions
      this.bookmarksGridEl.addEventListener('click', (e) => {
          const target = e.target;
          const card = target.closest('.bookmark-card');
          if (!card) return; // Clicked outside a card

          const url = card.dataset.url; // Store URL on the card element
          if (!url) return;

          const bookmark = this.bookmarks.find(b => b.URL === url);
          if (!bookmark) return;

          // Handle Favorite toggle
          if (target.classList.contains('favorite-toggle')) {
              this.toggleFavorite(bookmark);
          }
          // Handle Screenshot update
          else if (target.closest('.screenshot-action-update')) {
               e.preventDefault(); // Prevent link navigation if it's an anchor
              this.updateScreenshot(bookmark, target.closest('.screenshot-action-update'));
          }
           // Handle Delete button
          else if (target.classList.contains('delete-button')) {
              this.deleteBookmark(bookmark);
          }
          // Handle clicking the main title link (handled by browser default)
          // Handle clicking a tag within the card
          else if (target.classList.contains('tag') && target.closest('.bookmark-tags')) {
              const tag = target.textContent;
               if (!this.activeTags.includes(tag)) {
                this.toggleTagFilter(tag); // Add tag to filter if not already active
              }
          }
      });
    },

    async loadInitialData() {
        await this.loadBookmarks();
        await this.loadTags();
    },

    async loadBookmarks() {
      if (this.isLoading) return; // Prevent concurrent loads
      this.isLoading = true;
      this.sidebarEl.classList.add('loading'); // Visual indicator
      console.log("Loading bookmarks...");

      try {
        const result = await window.api.getBookmarks();
        if (result.success) {
          // Ensure data is an array, default to empty if not
          this.bookmarks = Array.isArray(result.data) ? result.data : [];
          console.log(`Loaded ${this.bookmarks.length} bookmarks.`);
          this.filterAndRenderBookmarks(); // Apply current filters/search
        } else {
          this.showToast('Error loading bookmarks: ' + (result.error || 'Unknown error'), 'error');
          this.bookmarks = []; // Reset bookmarks on error
          this.renderBookmarks([]); // Clear the grid
        }
      } catch (error) {
        console.error('Critical error loading bookmarks:', error);
        this.showToast('Critical error loading bookmarks: ' + error.message, 'error');
        this.bookmarks = [];
        this.renderBookmarks([]);
      } finally {
          this.isLoading = false;
          this.sidebarEl.classList.remove('loading');
      }
    },

     async loadTags() {
      console.log("Loading tags...");
      try {
          const result = await window.api.getAllTags();
          if (result.success) {
              this.allTags = Array.isArray(result.data) ? result.data : [];
              console.log(`Loaded ${this.allTags.length} unique tags.`);
              this.renderTagsList();
          } else {
              this.showToast('Error loading tags: ' + (result.error || 'Unknown error'), 'error');
              this.allTags = [];
              this.renderTagsList();
          }
      } catch (error) {
          console.error('Critical error loading tags:', error);
          this.showToast('Critical error loading tags: ' + error.message, 'error');
          this.allTags = [];
          this.renderTagsList();
      }
  },

    async addBookmark() {
      const url = this.urlInput.value.trim();
      if (!url) {
          this.showToast('Please enter a URL', 'warning');
          return;
          }
      // Basic URL validation (very simple)
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
           this.urlInput.value = 'https://' + url; // Prepend https:// if missing
      }

      this.addButton.innerHTML = '<span class="spinner"></span>';
      this.addButton.disabled = true;
      this.urlInput.disabled = true;

      try {
        console.log(`Attempting to add bookmark: ${this.urlInput.value}`);
        const result = await window.api.addBookmark(this.urlInput.value); // Use updated value
        if (result.success && result.bookmark) {
          this.urlInput.value = ''; // Clear input on success
          this.showToast('Bookmark added successfully');
          // Add to local list and refresh UI immediately for responsiveness
          this.bookmarks.unshift(result.bookmark); // Add to beginning
          this.filterAndRenderBookmarks(); // Re-filter and render
          this.loadTags(); // Reload tags as new ones might have been added
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
        if (!bookmark || !bookmark.URL) return;

        console.log(`Updating screenshot for: ${bookmark.URL}`);
        buttonElement.innerHTML = '<span class="spinner"></span> Updating...'; // Feedback
        buttonElement.disabled = true;

         try {
              const result = await window.api.updateScreenshot(bookmark);
              if (result.success && result.bookmark) {
                  this.showToast('Screenshot updated successfully');
                  // Update the local bookmark data
                  const index = this.bookmarks.findIndex(b => b.URL === bookmark.URL);
                  if (index !== -1) {
                      this.bookmarks[index] = result.bookmark; // Update with latest data
                  }
                  this.filterAndRenderBookmarks(); // Re-render the grid
              } else {
                  this.showToast('Error updating screenshot: ' + (result.error || 'Unknown error'), 'error');
                  // Reset button text on failure (might need re-render anyway)
                  this.filterAndRenderBookmarks();
              }
          } catch (error) {
              console.error(`Critical error updating screenshot for ${bookmark.URL}:`, error);
              this.showToast('Critical error updating screenshot: ' + error.message, 'error');
              this.filterAndRenderBookmarks(); // Re-render to reset button state
          }
        // No finally block needed for button state as re-render handles it
    },

    async toggleFavorite(bookmark) {
      if (!bookmark || !bookmark.URL) return;
      console.log(`Toggling favorite for: ${bookmark.URL}`);
      const originalBookmark = { ...bookmark }; // Keep a copy of the original state
  
      // Find the index BEFORE the async call
      const index = this.bookmarks.findIndex(b => b.URL === bookmark.URL);
      if (index === -1) {
          console.error("Bookmark not found in local cache for toggling:", bookmark.URL);
          return; // Should not happen if UI is correct
      }
  
      // --- Optimistic UI Update ---
      // Calculate the new state based on the current state in the local cache
      const currentIsFavorite = String(this.bookmarks[index].Favorite).toLowerCase() === 'true';
      const newState = !currentIsFavorite;
      this.bookmarks[index].Favorite = String(newState); // Update local cache immediately (as string 'true'/'false')
      this.filterAndRenderBookmarks(); // Re-render to show change
      // --- End Optimistic Update ---
  
      try {
        // Send the *original* bookmark data along with the intention to toggle.
        // The main process determines the final state based on this.
        // Alternatively, send the intended new state, but let's stick to the current IPC signature.
        const result = await window.api.toggleFavorite(originalBookmark); // Use original state for the call
  
        if (result.success && result.bookmark) {
           // --- Confirmation Update ---
           // Update local cache with the *confirmed* state from the main process
           this.bookmarks[index] = result.bookmark;
           console.log(`Favorite status for ${bookmark.URL} confirmed as ${result.bookmark.Favorite}`);
           // --- End Confirmation Update ---
        } else {
          // --- Revert on Failure ---
          console.error('Toggle favorite failed via API:', result.error);
          this.showToast('Error toggling favorite: ' + (result.error || 'Unknown error'), 'error');
          this.bookmarks[index].Favorite = originalBookmark.Favorite; // Revert local cache
           // --- End Revert ---
        }
      } catch (error) {
          // --- Revert on Critical Error ---
          console.error(`Critical error toggling favorite for ${bookmark.URL}:`, error);
          this.showToast('Critical error toggling favorite: ' + error.message, 'error');
          this.bookmarks[index].Favorite = originalBookmark.Favorite; // Revert local cache
           // --- End Revert ---
      } finally {
          // Re-render regardless of success/failure to ensure UI consistency
          this.filterAndRenderBookmarks();
      }
    },

     async deleteBookmark(bookmark) {
         if (!bookmark || !bookmark.URL) return;

         // Confirmation dialog
         const confirmation = confirm(`Are you sure you want to delete this bookmark?\n\n${bookmark.Title || bookmark.URL}`);
         if (!confirmation) {
             return;
         }

         console.log(`Attempting to delete bookmark: ${bookmark.URL}`);
         // Optional: Add visual feedback (e.g., dim the card)

         try {
             const result = await window.api.deleteBookmark(bookmark);
             if (result.success) {
                 this.showToast('Bookmark deleted successfully');
                 // Remove from local list and re-render
                 this.bookmarks = this.bookmarks.filter(b => b.URL !== bookmark.URL);
                 this.filterAndRenderBookmarks();
                 this.loadTags(); // Tags might have changed
             } else {
                 this.showToast('Error deleting bookmark: ' + (result.error || 'Unknown error'), 'error');
                 // Optional: Remove visual feedback if added
             }
         } catch (error) {
             console.error(`Critical error deleting bookmark ${bookmark.URL}:`, error);
             this.showToast('Critical error deleting bookmark: ' + error.message, 'error');
             // Optional: Remove visual feedback if added
         }
     },


    async exportCSV() {
      console.log("Exporting CSV...");
      this.exportButton.textContent = 'Exporting...';
      this.exportButton.disabled = true;
      try {
        const result = await window.api.exportCSV();
        if (result.success) {
          this.showToast(result.message || `Exported ${result.count} bookmarks successfully`);
        } else {
          this.showToast('Export failed: ' + (result.message || result.error || 'Unknown error'), 'error');
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
      console.log("Importing CSV...");
      this.importButton.textContent = 'Importing...';
      this.importButton.disabled = true;
      try {
        const result = await window.api.importCSV();
        if (result.success) {
          this.showToast(result.message || `Imported ${result.count} bookmarks successfully`);
          // Reload data after successful import
          await this.loadInitialData();
        } else {
            // Handle cancellation message specifically
            if (result.message === 'Import cancelled') {
                this.showToast('Import cancelled', 'info');
            } else {
                this.showToast('Import failed: ' + (result.message || result.error || 'Unknown error'), 'error');
            }
        }
      } catch (error) {
        console.error('Critical error importing CSV:', error);
        this.showToast('Critical error importing: ' + error.message, 'error');
      } finally {
          this.importButton.textContent = 'Import CSV';
          this.importButton.disabled = false;
      }
    },

    setActiveFilter(filter) {
      if (this.activeFilter === filter) return; // No change

      console.log(`Setting active filter to: ${filter}`);
      this.activeFilter = filter;

      // Update UI for filter buttons
      this.filtersEl.querySelectorAll('li').forEach(item => {
        item.classList.toggle('active', item.dataset.filter === filter);
      });

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

      // Update UI for tags list
      this.renderTagsList(); // Re-render to show active state change
      this.filterAndRenderBookmarks();
    },

     renderTagsList() {
      this.tagsListEl.innerHTML = ''; // Clear existing tags
      if (this.allTags.length === 0) {
           this.tagsListEl.innerHTML = '<span>No tags yet.</span>'; // Placeholder
           return;
      }
      this.allTags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = `tag ${this.activeTags.includes(tag) ? 'active' : ''}`;
        tagEl.textContent = tag;
        // Click event handled by delegation in bindEvents
        this.tagsListEl.appendChild(tagEl);
      });
    },

    // Central function to apply all filters and search, then render
    filterAndRenderBookmarks() {
      let filtered = [...this.bookmarks]; // Start with a copy of all bookmarks

      // Apply search filter (case-insensitive)
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        filtered = filtered.filter(bookmark =>
          (bookmark.URL && bookmark.URL.toLowerCase().includes(query)) ||
          (bookmark.Title && bookmark.Title.toLowerCase().includes(query)) ||
          (bookmark.Description && bookmark.Description.toLowerCase().includes(query)) ||
          (bookmark.Tags && bookmark.Tags.toLowerCase().includes(query))
        );
      }

      // Apply main filter (all, favorites, date ranges)
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 7); // Start of 7 days ago

      if (this.activeFilter === 'favorites') {
        filtered = filtered.filter(bookmark => String(bookmark.Favorite).toLowerCase() === 'true');
      } else if (this.activeFilter === 'today') {
        filtered = filtered.filter(bookmark => {
           try {
              const bookmarkDate = new Date(bookmark.Date);
              return !isNaN(bookmarkDate) && bookmarkDate >= today;
          } catch { return false; }
        });
      } else if (this.activeFilter === 'week') {
        filtered = filtered.filter(bookmark => {
          try {
              const bookmarkDate = new Date(bookmark.Date);
              return !isNaN(bookmarkDate) && bookmarkDate >= weekAgo;
          } catch { return false; }
        });
      }
      // 'all' filter needs no action here

      // Apply tag filter (case-insensitive)
      if (this.activeTags.length > 0) {
          const activeTagsLower = this.activeTags.map(t => t.toLowerCase());
          filtered = filtered.filter(bookmark => {
              if (!bookmark.Tags) return false;
              const bookmarkTags = String(bookmark.Tags).split(',')
                                        .map(t => t.trim().toLowerCase())
                                        .filter(t => t);
              // Bookmark must have at least one of the active tags
              return activeTagsLower.some(activeTag => bookmarkTags.includes(activeTag));
        });
      }

      // Sort results (e.g., by date descending)
      filtered.sort((a, b) => {
          try {
              // Sort descending (newest first)
              return new Date(b.Date) - new Date(a.Date);
          } catch {
              return 0; // Keep original order if dates are invalid
          }
      });


      this.renderBookmarks(filtered);
    },

    renderBookmarks(bookmarksToRender) {
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

      const fragment = document.createDocumentFragment(); // Efficient way to add multiple elements

      bookmarksToRender.forEach(bookmark => {
          if (!bookmark || !bookmark.URL) {
              console.warn("Skipping rendering invalid bookmark data:", bookmark);
              return;
          }

          const card = document.createElement('div');
          card.className = 'bookmark-card';
          card.dataset.url = bookmark.URL; // Store URL for event delegation

          // --- Screenshot Section ---
          const screenshotContainer = document.createElement('div');
          screenshotContainer.className = 'screenshot-container';

          const screenshotEl = document.createElement('div');
          screenshotEl.className = 'screenshot';

          let actionButton; // Button for update/take screenshot

          if (bookmark.Screenshot && typeof bookmark.Screenshot === 'string') {
              // Check if file exists? No, rely on path being correct. Display broken image if not.
               const img = document.createElement('img');
               // IMPORTANT: Use 'file://' protocol for local files
               // Encode potentially problematic characters in file path
               img.src = `file://${encodeURI(bookmark.Screenshot.replace(/\\/g, '/'))}`;
               img.alt = `Screenshot of ${bookmark.Title || bookmark.URL}`;
               img.loading = 'lazy'; // Improve performance
               img.onerror = (e) => { // Handle broken images
                  console.warn(`Failed to load screenshot: ${img.src}`, e);
                  e.target.parentNode.innerHTML = '<span class="screenshot-error">Screenshot not found</span>'; // Replace broken img
               };
               screenshotEl.appendChild(img);

               actionButton = document.createElement('button');
               actionButton.className = 'screenshot-action-update button-overlay';
               actionButton.title = 'Update Screenshot';
               actionButton.innerHTML = '🔄'; // Refresh icon

          } else {
              screenshotEl.innerHTML = `<span class="screenshot-placeholder">No Screenshot</span>`;

              actionButton = document.createElement('button');
              actionButton.className = 'screenshot-action-update button-overlay'; // Same class for consistency
              actionButton.title = 'Take Screenshot';
              actionButton.innerHTML = '📸'; // Camera icon
          }
          screenshotContainer.appendChild(screenshotEl);
          screenshotContainer.appendChild(actionButton); // Add button over screenshot area


          // --- Content Section ---
          const contentEl = document.createElement('div');
          contentEl.className = 'bookmark-content';

          // Header: Title + Favorite + Delete
          const headerEl = document.createElement('div');
          headerEl.className = 'bookmark-header';

              const titleEl = document.createElement('h3');
              titleEl.className = 'bookmark-title';
              const linkEl = document.createElement('a');
              linkEl.href = bookmark.URL; // Let browser handle opening
              linkEl.textContent = bookmark.Title || bookmark.URL;
              linkEl.title = bookmark.URL; // Show full URL on hover
              linkEl.target = '_blank'; // Open in default browser
              linkEl.rel = 'noopener noreferrer'; // Security measure
               linkEl.addEventListener('click', (e) => { // Use API to open for better control if needed
                  // Optional: Intercept click to use shell.openExternal via IPC
                  // e.preventDefault();
                  // window.api.openURL(bookmark.URL).catch(err => console.error("Failed to open URL via API:", err));
               });

              titleEl.appendChild(linkEl);

              const controlsEl = document.createElement('div');
              controlsEl.className = 'bookmark-controls';

              const favEl = document.createElement('button');
              // Add 'is-favorite' class if bookmark.Favorite is 'true'
              const isFavorite = String(bookmark.Favorite).toLowerCase() === 'true';
              favEl.className = `favorite-toggle icon-button ${isFavorite ? 'is-favorite' : ''}`;
              favEl.innerHTML = isFavorite ? '★' : '☆'; // Gold star filled/empty
              favEl.title = isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
              // Click handled by delegation

                  const deleteEl = document.createElement('button');
                  deleteEl.className = 'delete-button icon-button';
                  deleteEl.innerHTML = '🗑️'; // Trash can emoji
                  deleteEl.title = 'Delete Bookmark';
                  // Click handled by delegation

              controlsEl.appendChild(favEl);
              controlsEl.appendChild(deleteEl);

          headerEl.appendChild(titleEl);
          headerEl.appendChild(controlsEl);

          // Description (if exists)
          let descEl = null;
          if (bookmark.Description) {
              descEl = document.createElement('p');
              descEl.className = 'bookmark-description';
              descEl.textContent = bookmark.Description;
              descEl.title = bookmark.Description; // Show full desc on hover
          }

          // Tags (if exists)
          let tagsEl = null;
          if (bookmark.Tags) {
              tagsEl = document.createElement('div');
              tagsEl.className = 'bookmark-tags';
              String(bookmark.Tags).split(',')
                  .map(tag => tag.trim())
                  .filter(tag => tag)
                  .forEach(tag => {
                      const tagSpan = document.createElement('span');
                      tagSpan.className = 'tag';
                      tagSpan.textContent = tag;
                       tagSpan.title = `Filter by tag: ${tag}`;
                      // Click handled by delegation
                      tagsEl.appendChild(tagSpan);
              });
          }

          // Footer: Date
          const footerEl = document.createElement('div');
          footerEl.className = 'bookmark-footer';
              const dateEl = document.createElement('span');
              dateEl.className = 'bookmark-date';
              try {
                  dateEl.textContent = new Date(bookmark.Date).toLocaleDateString();
                  dateEl.title = new Date(bookmark.Date).toLocaleString(); // Show time on hover
              } catch {
                  dateEl.textContent = 'Invalid Date';
              }
          footerEl.appendChild(dateEl);


          // Assemble Content
          contentEl.appendChild(headerEl);
          if (descEl) contentEl.appendChild(descEl);
          if (tagsEl) contentEl.appendChild(tagsEl);
          contentEl.appendChild(footerEl);

          // Assemble Card
          card.appendChild(screenshotContainer);
          card.appendChild(contentEl);

          fragment.appendChild(card); // Add card to fragment
      });

      this.bookmarksGridEl.appendChild(fragment); // Append fragment to DOM once
    },

    showToast(message, type = 'info') { // type can be 'info', 'success', 'warning', 'error'
      this.toastEl.textContent = message;
      this.toastEl.className = `toast show ${type}`; // Reset classes and add type

      // Clear previous timeout if exists
      clearTimeout(this.toastTimeout);

      this.toastTimeout = setTimeout(() => {
        this.toastEl.classList.remove('show');
      }, 3000); // 3 seconds
    },

     async checkLLMStatus() {
         try {
             const result = await window.api.checkLLMService();
             if (result.success && result.data.available) {
                 console.info('LLM service check: Available', result.data);
                 // Optional: Show a small status indicator in the UI
             } else {
                 console.warn('LLM service check: Not Available or Error', result);
                 this.showToast(`LLM service unavailable: ${result.error || 'Check console for details.'}`, 'warning');
                 // Optional: Disable features requiring LLM
             }
         } catch (error) {
             console.error('Critical error checking LLM service:', error);
             this.showToast(`Error checking LLM service: ${error.message}`, 'error');
         }
     }

  }; // End of app object

  app.init(); // Start the application
});