// utils/sites.js
// Maps hostname -> CSS selector for the prompt input box on each site.
// Loaded before content.js (see manifest.json content_scripts order).

const PROMPTLENS_SITES = {
  "chatgpt.com": "#prompt-textarea",
  "chat.openai.com": "#prompt-textarea"
};
