// utils/llm_clients.js
const axios = require('axios');

class LLMClient {
  constructor(apiUrl = 'http://localhost:11434/api/chat', model = 'llama3.1:latest', apiKey = null) {
    this.rawApiUrl = apiUrl.trim(); // Store the raw input URL
    this.model = model.trim();
    this.apiKey = apiKey; // Can be null or empty string
    this.provider = 'generic'; // Default provider

    // --- Improved Provider Detection ---
    const lowerApiUrl = this.rawApiUrl.toLowerCase();
    if (lowerApiUrl.includes(':11434') || lowerApiUrl.includes('ollama')) {
        this.provider = 'ollama';
        // Standardize Ollama URL to use /api/chat for consistency
        if (!this.rawApiUrl.endsWith('/api/chat')) {
            // Remove potential trailing slash before appending
            const baseUrl = this.rawApiUrl.replace(/\/$/, '');
            // If it already has /api/generate or similar, replace it, otherwise append
             if (baseUrl.includes('/api/')) {
                this.apiUrl = baseUrl.replace(/\/api\/.*$/, '/api/chat');
             } else {
                this.apiUrl = `${baseUrl}/api/chat`;
             }
             console.log(`Standardized Ollama API URL to: ${this.apiUrl}`);
        } else {
             this.apiUrl = this.rawApiUrl; // Already correct
        }

    } else if (lowerApiUrl.includes('deepseek.com')) {
        this.provider = 'deepseek';
        this.apiUrl = this.rawApiUrl; // Use as is
    } else if (lowerApiUrl.includes('mistral.ai')) {
        this.provider = 'mistral';
        this.apiUrl = this.rawApiUrl; // Use as is
    } else if (lowerApiUrl.includes('openai.com')) {
        this.provider = 'openai';
        this.apiUrl = this.rawApiUrl; // Use as is
    } else {
        // Keep as generic, assume it's compatible with OpenAI/Deepseek format
        this.provider = 'generic';
        this.apiUrl = this.rawApiUrl;
        console.warn(`LLM URL "${this.rawApiUrl}" detected as 'generic'. Assuming OpenAI-compatible API structure.`);
    }

    console.log(`LLM Client Initialized - Provider: ${this.provider}, Model: ${this.model}, API URL: ${this.apiUrl}`);
  }

  _getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    // Only add Authorization header if an API key is provided AND it's not Ollama
    if (this.apiKey && this.provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      console.log("Using Authorization header.");
    } else {
        console.log("Not using Authorization header.");
    }
    return headers;
  }

  // Create request body - NOW uses 'messages' format for Ollama too
  _createRequestBody(prompt) {
      console.log(`Creating request body for provider: ${this.provider}`);
       // Common structure for most modern chat APIs
       const body = {
            model: this.model,
            messages: [
                { "role": "user", "content": prompt }
            ],
            // Add stream: false specificially for Ollama if needed, or keep common structure
            // stream: false // Recommended for Ollama non-streaming
        };

       // Ollama specific adjustments if necessary (e.g., ensure stream: false)
        if (this.provider === 'ollama') {
             body.stream = false;
             // Ollama also supports 'options' like temperature, etc. Not adding now.
        } else {
             // Other providers might use different parameters, add max_tokens for safety
             body.max_tokens = 500; // Reasonable default limit
        }

        return body;

     /* // --- OLD Ollama logic REMOVED ---
     switch (this.provider) {
      case 'ollama': // OLD way, using /api/generate
        return {
          model: this.model,
          prompt: prompt, // Older Ollama endpoint used 'prompt'
          stream: false
        };
      // ... rest of cases used 'messages' ...
     */
  }

  // Extract text from provider response (should work for Ollama /api/chat too)
  _extractResponseText(responseData) {
    console.log("Attempting to extract response text from:", responseData);
    // Handle Ollama's /api/chat response structure
    if (this.provider === 'ollama' && responseData.message && responseData.message.content) {
      console.log("Extracted Ollama response via responseData.message.content");
      return responseData.message.content || '';
    }
    // Handle OpenAI/DeepSeek/Mistral/Generic structure
    else if (responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.content) {
      console.log("Extracted response via responseData.choices[0].message.content");
      return responseData.choices[0].message.content || '';
    }
    // Fallback for older Ollama /api/generate structure (less likely now)
    else if (responseData.response) {
        console.log("Extracted response via responseData.response (older Ollama format?)");
        return responseData.response || '';
    }

    console.warn("Could not extract response text using known structures.");
    return ''; // Default empty if structure unknown
  }

  // Shared function to make the API call
  async _makeApiCall(prompt) {
      const requestBody = this._createRequestBody(prompt);
      const headers = this._getHeaders();

      console.log(`Making API call to ${this.apiUrl} with model ${this.model}`);
      // console.log("Request Headers:", headers); // Optional: Log headers (excluding API key ideally)
      console.log("Request Body:", JSON.stringify(requestBody, null, 2)); // Log body

      try {
          const response = await axios.post(this.apiUrl, requestBody, { headers: headers, timeout: 20000 }); // Add timeout
          console.log(`API Response Status: ${response.status}`);
          // console.log("API Response Data:", response.data); // Can be verbose

          if (response.status === 200) {
              const text = this._extractResponseText(response.data).trim();
              console.log("Extracted Text:", text); // Log extracted text
              return text;
          } else {
              console.error(`API Error: Status ${response.status} - ${response.statusText}`, response.data);
              throw new Error(`API request failed with status ${response.status}`);
          }
      } catch (error) {
          // Log detailed Axios error information
          if (error.response) {
              // The request was made and the server responded with a status code
              // that falls out of the range of 2xx
              console.error('API Error Response Status:', error.response.status);
              console.error('API Error Response Headers:', error.response.headers);
              console.error('API Error Response Data:', error.response.data);
               throw new Error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
          } else if (error.request) {
              // The request was made but no response was received
              // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
              // http.ClientRequest in node.js
              console.error('API Error: No response received. Request details:', error.request);
               // Log the specific connection error if available (like ECONNREFUSED)
               if (error.code) {
                  console.error(`Network Error Code: ${error.code}`);
                   throw new Error(`Network Error: ${error.code}. Could not connect to ${this.apiUrl}. Check if the service is running and accessible.`);
               }
               throw new Error(`API Error: No response received from ${this.apiUrl}`);
          } else {
              // Something happened in setting up the request that triggered an Error
              console.error('API Error: Request setup failed.', error.message);
              throw new Error(`API Setup Error: ${error.message}`);
          }
          // console.error('Raw Axios Error Object:', error); // Verbose logging if needed
          // throw error; // Re-throw the original or a more specific error
      }
  }


  async generateTags(url, content) {
    const prompt = `Analyze the following website content from URL ${url} and generate a concise list of 5-8 relevant tags, separated by commas. Focus on specific keywords, technologies, topics, and concepts. Avoid generic terms unless highly relevant.

Website Content Snippet:
---
${content}
---

Output only the comma-separated tags. Example: "AI, Machine Learning, Python, Data Science, API"`;

    try {
        let tags = await this._makeApiCall(prompt);
        // Basic cleanup
        tags = tags.replace(/^["'\s]+|["'\s]+$/g, ''); // Remove surrounding quotes/whitespace
        tags = tags.replace(/^(Tags:|Output:|Response:|Here are the tags:)\s*/i, ''); // Remove common prefixes
        tags = tags.replace(/\.$/, ''); // Remove trailing period
        return tags;
    } catch (error) {
        console.error(`Error generating tags for ${url}:`, error.message);
        // Don't return error message as tags, return empty string
        return '';
    }
  }

  async generateDescription(url, content) {
    const prompt = `Based on the following website content from URL ${url}, write a concise and informative description (around 100-150 words). Highlight key features, purpose, and target audience. Use relevant keywords for searchability. Avoid overly promotional language.

Website Content Snippet:
---
${content}
---

Output only the description text.`;

    try {
        let description = await this._makeApiCall(prompt);
         // Basic cleanup
        description = description.replace(/^["'\s]+|["'\s]+$/g, ''); // Remove surrounding quotes/whitespace
        description = description.replace(/^(Description:|Output:|Response:|Here is the description:)\s*/i, ''); // Remove common prefixes
        return description;
    } catch (error) {
        console.error(`Error generating description for ${url}:`, error.message);
         // Don't return error message as description, return empty string
        return '';
    }
  }

  // Check service availability (Adjust for Ollama /api/chat)
  async checkService() {
    try {
      let checkUrl;
      const headers = this._getHeaders(); // Get headers, might need auth for non-Ollama

      if (this.provider === 'ollama') {
          // Ollama doesn't have a simple version endpoint like /api/version anymore that works reliably everywhere.
          // We can try hitting the base URL or just assume availability if the main calls work.
          // Let's try a HEAD request to the base URL as a simple reachability check.
          const baseUrl = this.apiUrl.replace(/\/api\/chat$/, ''); // Get base (e.g., http://127.0.0.1:11434)
          checkUrl = baseUrl;
          console.log(`Checking Ollama availability via HEAD request to: ${checkUrl}`);
          await axios.head(checkUrl, { timeout: 5000 });
          return { available: true, details: `Ollama base URL reachable at ${checkUrl}` };
      } else {
          // For other providers, check the /v1/models endpoint (common pattern)
          checkUrl = this.apiUrl.split('/v1')[0] + '/v1/models';
          console.log(`Checking service availability via GET request to: ${checkUrl}`);
          const response = await axios.get(checkUrl, { headers: headers, timeout: 10000 });
          // Check if response.data or response.data.data exists and has content
          const modelsData = response.data?.data || response.data; // Handle different structures
          const modelCount = Array.isArray(modelsData) ? modelsData.length : (modelsData ? 'Available' : 'No Data');
          return { available: true, details: `API available, models: ${modelCount}` };
      }
    } catch (error) {
        let errorMessage = error.message;
        if (error.code) { // Network errors
            errorMessage = `${error.code} - Could not connect.`;
        } else if (error.response) { // API errors
             errorMessage = `HTTP ${error.response.status} ${error.response.statusText}`;
        }
        console.error(`Service check failed for ${this.apiUrl}: ${errorMessage}`);
        return { available: false, error: errorMessage, details: error.code || error.response?.status };
    }
  }
}

module.exports = LLMClient;