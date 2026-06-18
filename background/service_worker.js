// background/service_worker.js
// Step 3 will add the OpenAI API call here.
// Content scripts can't call external APIs directly under MV3,
// so all rewrite requests route through this worker.

console.log("[PromptLens] Service worker loaded.");
