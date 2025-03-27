// utils/csv_manager.js
const fs = require('fs');
const fsp = require('fs').promises; // Use promises for async operations
const path = require('path');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify/sync'); // Keep sync for initial write/export? Or change later.

const CSV_HEADERS = ['URL', 'Title', 'Description', 'Tags', 'Date', 'Favorite', 'Screenshot'];

class BookmarkManager {
  constructor(filePath) {
    // Ensure filePath is absolute
    this.filePath = path.resolve(filePath || path.join(__dirname, '../data/bookmarks.csv'));
    this.ensureFileExists(); // Run synchronously during setup
  }

  ensureFileExists() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.filePath)) {
        // Create with headers
        fs.writeFileSync(this.filePath, CSV_HEADERS.join(',') + '\n');
        console.log(`Created bookmarks file at: ${this.filePath}`);
      }
    } catch (error) {
      console.error('Error ensuring bookmarks file exists:', error);
      // Decide if this is fatal. For now, throw.
      throw new Error(`Failed to create or access bookmarks file: ${error.message}`);
    }
  }

  async getBookmarks() {
    return new Promise((resolve, reject) => {
      const results = [];

      // Check again in case file was deleted after startup
      if (!fs.existsSync(this.filePath)) {
        console.warn(`Bookmarks file not found at ${this.filePath}, returning empty list.`);
        this.ensureFileExists(); // Try to recreate it
        return resolve([]);
      }

      fs.createReadStream(this.filePath)
        .on('error', error => {
          console.error(`Error reading bookmarks file stream (${this.filePath}):`, error);
          reject(new Error(`Failed to read bookmarks file: ${error.message}`));
        })
        // *** CRITICAL FIX: Use columns: true to get objects ***
        .pipe(parse({
          columns: true, // Use the first row as headers
          skip_empty_lines: true, // Ignore empty rows
          trim: true // Trim whitespace from values
         }))
        .on('data', (row) => {
          // Basic validation: ensure essential 'URL' exists
          if (row.URL) {
              // Ensure all header fields exist, default to empty string or 'false'
              const bookmark = {};
              CSV_HEADERS.forEach(header => {
                  bookmark[header] = row[header] !== undefined ? row[header] : (header === 'Favorite' ? 'false' : '');
              });
              results.push(bookmark);
          } else {
              console.warn('Skipping row due to missing URL:', row);
          }
        })
        .on('end', () => {
          // console.log(`Loaded ${results.length} bookmarks.`);
          resolve(results);
        })
        .on('error', error => {
          console.error('Error parsing CSV data:', error);
          reject(new Error(`Failed to parse bookmarks CSV: ${error.message}`));
        });
    });
  }

  async saveBookmark(bookmark) {
    if (!bookmark || !bookmark.URL) {
        throw new Error("Cannot save bookmark without a URL.");
    }
    try {
      const bookmarks = await this.getBookmarks();
      const index = bookmarks.findIndex(b => b.URL === bookmark.URL);

      // Ensure standard fields exist before saving
      const newBookmarkData = {
          URL: bookmark.URL,
          Title: bookmark.Title || '',
          Description: bookmark.Description || '',
          Tags: bookmark.Tags || '',
          Date: bookmark.Date || new Date().toISOString(),
          Favorite: String(bookmark.Favorite === 'true' || bookmark.Favorite === true), // Ensure 'true' or 'false' string
          Screenshot: bookmark.Screenshot || ''
      };


      if (index >= 0) {
        // Update existing: merge new data over old, but keep existing URL
        bookmarks[index] = { ...bookmarks[index], ...newBookmarkData };
        console.log(`Updated bookmark: ${bookmark.URL}`);
      } else {
        // Add new
        bookmarks.push(newBookmarkData);
        console.log(`Added new bookmark: ${bookmark.URL}`);
      }

      // Write back to CSV using the saveBookmarks method
      return await this.saveBookmarks(bookmarks); // saveBookmarks now returns the saved array
    } catch (error) {
      console.error(`Error saving bookmark ${bookmark.URL}:`, error);
      throw error; // Re-throw to be handled by caller
    }
  }

  async saveBookmarks(bookmarks) {
    if (!Array.isArray(bookmarks)) {
        throw new Error("Invalid data provided to saveBookmarks: Expected an array.");
    }
    try {
      // Ensure all bookmarks have the standard fields in the correct order
      const processedBookmarks = bookmarks.map(bookmark => {
          const record = {};
          CSV_HEADERS.forEach(header => {
             // Handle boolean 'Favorite' explicitly to ensure 'true'/'false' string
             if (header === 'Favorite') {
                 record[header] = String(bookmark[header] === 'true' || bookmark[header] === true);
             } else {
                 record[header] = bookmark[header] !== undefined ? bookmark[header] : '';
             }
          });
          return record;
      });

      // Write to CSV using async file operation
      // Pass headers explicitly to stringify to ensure order and inclusion
      const csvString = stringify(processedBookmarks, { header: true, columns: CSV_HEADERS });
      await fsp.writeFile(this.filePath, csvString);

      // console.log(`Successfully saved ${processedBookmarks.length} bookmarks.`);
      return processedBookmarks; // Return the data that was actually saved
    } catch (error) {
      console.error('Error saving bookmarks array:', error);
      throw new Error(`Failed to save bookmarks to file: ${error.message}`);
    }
  }

  async searchBookmarks(query) {
    try {
      const bookmarks = await this.getBookmarks();
      if (!query) return bookmarks;

      const searchTerm = query.toLowerCase().trim();
      if (!searchTerm) return bookmarks;

      return bookmarks.filter(b =>
        (b.URL && b.URL.toLowerCase().includes(searchTerm)) ||
        (b.Title && b.Title.toLowerCase().includes(searchTerm)) ||
        (b.Description && b.Description.toLowerCase().includes(searchTerm)) ||
        (b.Tags && b.Tags.toLowerCase().includes(searchTerm))
      );
    } catch (error) {
      console.error('Error searching bookmarks:', error);
      throw error;
    }
  }

  async filterByTags(tags) {
    try {
      const bookmarks = await this.getBookmarks();
      if (!tags || tags.length === 0) return bookmarks;

      // Ensure tags is an array of lowercase strings
      const filterTags = tags.map(t => String(t).toLowerCase().trim());

      return bookmarks.filter(bookmark => {
        if (!bookmark.Tags) return false;
        // Handle tags string safely
        const bookmarkTags = String(bookmark.Tags).split(',')
                                      .map(t => t.trim().toLowerCase())
                                      .filter(t => t); // Remove empty tags resulting from bad data like ",,"
        // Check if any of the bookmark's tags are in the filter list
        return filterTags.some(filterTag => bookmarkTags.includes(filterTag));
      });
    } catch (error) {
      console.error('Error filtering bookmarks by tags:', error);
      throw error;
    }
  }

  async exportToCSV(targetPath) {
    if (!targetPath) {
        throw new Error("Export path must be provided.");
    }
    try {
      const bookmarks = await this.getBookmarks();
      // Ensure consistent headers and order for export
      const csvString = stringify(bookmarks, { header: true, columns: CSV_HEADERS });
      await fsp.writeFile(targetPath, csvString);
      console.log(`Exported ${bookmarks.length} bookmarks to ${targetPath}`);
      return bookmarks.length;
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      throw new Error(`Failed to export CSV: ${error.message}`);
    }
  }

  async importFromCSV(sourcePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(sourcePath)) {
        return reject(new Error(`Import file not found: ${sourcePath}`));
      }

      const importedBookmarks = [];
      fs.createReadStream(sourcePath)
        .on('error', error => {
          console.error('Error reading import file:', error);
          reject(new Error(`Failed to read import file: ${error.message}`));
        })
        // *** CRITICAL FIX: Use columns: true for import too ***
        .pipe(parse({
            columns: true,
            skip_empty_lines: true,
            trim: true
        }))
        .on('data', (row) => {
            // Basic validation for imported row
            if (row.URL) {
                 // Ensure all header fields exist, default to empty string or 'false'
                 const bookmark = {};
                 CSV_HEADERS.forEach(header => {
                     bookmark[header] = row[header] !== undefined ? row[header] : (header === 'Favorite' ? 'false' : '');
                     // Ensure Favorite is strictly 'true' or 'false' string
                     if (header === 'Favorite') {
                         bookmark[header] = String(bookmark[header] === 'true' || bookmark[header] === true);
                     }
                 });
                 importedBookmarks.push(bookmark);
            } else {
                 console.warn('Skipping import row due to missing URL:', row);
            }
        })
        .on('end', async () => {
          try {
            if (importedBookmarks.length === 0) {
                console.log("Import file contained no valid bookmarks.");
                return resolve(0);
            }

            console.log(`Read ${importedBookmarks.length} bookmarks from import file.`);
            const currentBookmarks = await this.getBookmarks();
            const currentUrls = new Map(currentBookmarks.map(b => [b.URL, b]));

            let addedCount = 0;
            let updatedCount = 0;

            importedBookmarks.forEach(imported => {
                const existing = currentUrls.get(imported.URL);
                if (existing) {
                    // Update existing: merge imported data over current
                    Object.assign(existing, imported);
                    updatedCount++;
                } else {
                    // Add new
                    currentUrls.set(imported.URL, imported);
                    addedCount++;
                }
            });

            const mergedBookmarks = Array.from(currentUrls.values());
            await this.saveBookmarks(mergedBookmarks);

            console.log(`Import complete. Added: ${addedCount}, Updated: ${updatedCount}. Total: ${mergedBookmarks.length}`);
            resolve(importedBookmarks.length); // Report number of processed rows from file

          } catch (innerError) {
            console.error('Error merging/saving imported bookmarks:', innerError);
            reject(new Error(`Failed to process imported bookmarks: ${innerError.message}`));
          }
        })
        .on('error', error => {
          console.error('Error parsing import file:', error);
          reject(new Error(`Failed to parse import file: ${error.message}`));
        });
    });
  }
}

module.exports = BookmarkManager;