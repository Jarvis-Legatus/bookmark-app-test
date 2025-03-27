// renderer/settings.js
document.addEventListener('DOMContentLoaded', () => {
    const settings = {
        darkModeToggle: document.getElementById('darkModeToggle'),
        headlessTrue: document.getElementById('headlessTrue'),
        headlessFalse: document.getElementById('headlessFalse'),
        llmApiUrl: document.getElementById('llmApiUrl'),
        llmModel: document.getElementById('llmModel'),
        llmApiKey: document.getElementById('llmApiKey'),
        toggleApiKeyVisibility: document.getElementById('toggleApiKeyVisibility'),
        statusMessage: document.getElementById('status-message'),
    };

    let statusTimeout;

    function showStatus(message, isError = false, duration = 3000) {
        clearTimeout(statusTimeout);
        settings.statusMessage.textContent = message;
        settings.statusMessage.className = `status-message ${isError ? 'error' : 'success'} show`;
        statusTimeout = setTimeout(() => {
            settings.statusMessage.classList.remove('show');
        }, duration);
    }

    async function loadSettings() {
        try {
            console.log('Requesting settings from main process...');
            const result = await window.api.getSettings();
            console.log('Received settings:', result);
            if (result.success) {
                const currentSettings = result.data;

                // --- Appearance ---
                settings.darkModeToggle.checked = currentSettings.darkMode || false;
                applyTheme(currentSettings.darkMode); // Apply theme on load

                // --- Web Scraping ---
                if (currentSettings.headless === false) { // Check explicitly for false
                    settings.headlessFalse.checked = true;
                } else {
                    settings.headlessTrue.checked = true; // Default to true if undefined or true
                }

                // --- LLM Config ---
                settings.llmApiUrl.value = currentSettings.llmApiUrl || '';
                settings.llmModel.value = currentSettings.llmModel || '';
                settings.llmApiKey.value = currentSettings.llmApiKey || '';

            } else {
                console.error('Failed to load settings:', result.error);
                showStatus(`Error loading settings: ${result.error}`, true);
            }
        } catch (error) {
            console.error('Critical error loading settings:', error);
            showStatus(`Critical error loading settings: ${error.message}`, true);
        }
    }

    async function saveSetting(key, value) {
        try {
            console.log(`Saving setting: ${key} = ${value}`);
            const result = await window.api.setSettings({ [key]: value });
            if (result.success) {
                showStatus('Settings saved automatically');
                // Special handling for dark mode change
                if (key === 'darkMode') {
                    applyTheme(value);
                    // Notify main process to update other windows
                    window.api.notifyThemeChange(value);
                }
            } else {
                console.error(`Failed to save setting ${key}:`, result.error);
                showStatus(`Error saving ${key}: ${result.error}`, true);
                // Revert UI? Maybe not necessary if loadSettings is called on error elsewhere
            }
        } catch (error) {
            console.error(`Critical error saving setting ${key}:`, error);
            showStatus(`Critical error saving ${key}: ${error.message}`, true);
        }
    }

    function applyTheme(isDarkMode) {
         document.body.classList.toggle('dark-mode', isDarkMode);
    }

    // --- Event Listeners ---

    settings.darkModeToggle.addEventListener('change', (e) => {
        saveSetting('darkMode', e.target.checked);
    });

    settings.headlessTrue.addEventListener('change', (e) => {
        if (e.target.checked) {
            saveSetting('headless', true);
        }
    });

    settings.headlessFalse.addEventListener('change', (e) => {
        if (e.target.checked) {
            saveSetting('headless', false);
        }
    });

    // Save LLM settings on input blur (when user clicks away)
    settings.llmApiUrl.addEventListener('blur', (e) => {
        saveSetting('llmApiUrl', e.target.value.trim());
    });

    settings.llmModel.addEventListener('blur', (e) => {
        saveSetting('llmModel', e.target.value.trim());
    });

    settings.llmApiKey.addEventListener('blur', (e) => {
        saveSetting('llmApiKey', e.target.value); // Don't trim API keys
    });

    settings.toggleApiKeyVisibility.addEventListener('click', () => {
        const isPassword = settings.llmApiKey.type === 'password';
        settings.llmApiKey.type = isPassword ? 'text' : 'password';
        settings.toggleApiKeyVisibility.textContent = isPassword ? '🔒' : '👁️';
    });

    // --- Initialization ---
    loadSettings();
});