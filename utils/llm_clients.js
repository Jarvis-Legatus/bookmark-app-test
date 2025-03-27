// utils/llm_clients.js
const axios = require('axios');

class LLMClient {
  constructor(apiUrl = 'http://localhost:11434/api/generate', model = 'llama3.1:latest', apiKey = null) {
    this.apiUrl = apiUrl;
    this.model = model;
    this.apiKey = apiKey;
    
    // Automatically detect provider type based on URL
    if (apiUrl.includes('localhost:11434') || apiUrl.includes('ollama')) {
      this.provider = 'ollama';
    } else if (apiUrl.includes('deepseek.com')) {
      this.provider = 'deepseek';
    } else if (apiUrl.includes('mistral.ai')) {
      this.provider = 'mistral';
    } else {
      this.provider = 'generic';
    }
    
    console.log(`LLM Client initialized with provider: ${this.provider}, model: ${this.model}`);
  }

  // Create appropriate headers based on provider
  _getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (this.apiKey && this.provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }

  // Create appropriate request body based on provider
  _createRequestBody(prompt) {
    switch (this.provider) {
      case 'ollama':
        return {
          model: this.model,
          prompt: prompt,
          stream: false
        };
      
      case 'deepseek':
      case 'mistral':
      case 'generic':
        return {
          model: this.model,
          messages: [
            {"role": "user", "content": prompt}
          ],
          max_tokens: 500
        };
    }
  }

  // Extract text from provider response
  _extractResponseText(responseData) {
    switch (this.provider) {
      case 'ollama':
        return responseData.response || '';
        
      case 'deepseek':
      case 'mistral':
      case 'generic':
        return responseData.choices && 
               responseData.choices[0] && 
               responseData.choices[0].message && 
               responseData.choices[0].message.content || '';
    }
    
    return '';
  }

  // Generate tags from content
  async generateTags(url, content) {
    const prompt = `### Instruction ###
Analyze this website content from ${url} and generate exactly 5-8 relevant tags.

### Website Content ###
${content}

### Output Format ###
ONLY return comma-separated tags without any other text, explanation, or formatting.

Examples of correct outputs:
"AI, Content Generation, Marketing, SEO, E-commerce"
"Mind Mapping, Productivity, Note Taking, Knowledge Management, Collaboration"

### Response ###
`;

    try {
      const response = await axios.post(
        this.apiUrl,
        this._createRequestBody(prompt),
        { headers: this._getHeaders() }
      );
      
      if (response.status === 200) {
        let tags = this._extractResponseText(response.data).trim();
        
        // Clean up the response
        tags = tags.replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        tags = tags.replace(/^(Here are .*?:|Tags:|The tags are:)/i, '').trim();
        
        return tags;
      } else {
        console.error(`API error: ${response.statusText}`);
        return '';
      }
    } catch (error) {
      console.error('Error generating tags:', error.message);
      return '';
    }
  }

  // Generate description from content
  async generateDescription(url, content) {
    const prompt = `### Instruction ###
Create a concise but comprehensive description (100-150 words) for the website at ${url}.

### Website Content ###
${content}

### Requirements ###
- Focus on what makes this service/product unique compared to competitors
- Clearly describe key features and functionalities
- Maximize searchability by using relevant technical terms
- Be factual and specific - avoid generic marketing language
- Keep the description between 100-150 words

### Output Format ###
ONLY return the description without any other text, explanation, or formatting.

### Response ###
`;

    try {
      const response = await axios.post(
        this.apiUrl,
        this._createRequestBody(prompt),
        { headers: this._getHeaders() }
      );
      
      if (response.status === 200) {
        let description = this._extractResponseText(response.data).trim();
        
        // Clean up the response
        description = description.replace(/^["']|["']$/g, ''); // Remove surrounding quotes
        description = description.replace(/^(Here is the description:?|Description:?|\*\*Description\*\*:?)/i, '').trim();
        
        return description;
      } else {
        console.error(`API error: ${response.statusText}`);
        return '';
      }
    } catch (error) {
      console.error('Error generating description:', error.message);
      return '';
    }
  }

  // Check if service is available
  async checkService() {
    try {
      let response;
      
      if (this.provider === 'ollama') {
        response = await axios.get(this.apiUrl.replace('/api/generate', '/api/version'));
        return { available: true, version: response.data.version };
      } else {
        // For other providers, just check if the API endpoint is accessible
        response = await axios.get(this.apiUrl.split('/v1')[0] + '/v1/models', {
          headers: this._getHeaders()
        });
        return { available: true, models: response.data.data || 'API available' };
      }
    } catch (error) {
      return { available: false, error: error.message };
    }
  }
}

module.exports = LLMClient;
