importScripts("providers.js");

const ALLOWED_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PROMPTLENS_OPTIMIZE") return false;
  if (!sender.url || !ALLOWED_ORIGINS.has(new URL(sender.url).origin)) {
    sendResponse({ error: "PromptLens only accepts requests from a supported ChatGPT page." });
    return false;
  }
  optimize(message).then(sendResponse).catch(() => {
    sendResponse({ error: "PromptLens could not complete the request. Check settings and try again." });
  });
  return true;
});

async function optimize(message) {
  if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 12000) {
    return { error: "Enter a prompt under 12,000 characters before optimizing." };
  }
  const stored = await chrome.storage.local.get([
    "provider", "geminiModel", "openaiModel", "mode", "customInstructions", "openaiApiKey", "geminiApiKey"
  ]);
  const provider = stored.provider === "openai" ? "openai" : "gemini";
  const apiKey = provider === "openai" ? stored.openaiApiKey : stored.geminiApiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { error: `No ${provider === "gemini" ? "Gemini" : "OpenAI"} API key is configured. Open PromptLens settings to add one.` };
  }
  const result = await PromptLensProviders.optimize({
    provider,
    model: typeof stored[provider === "openai" ? "openaiModel" : "geminiModel"] === "string"
      ? stored[provider === "openai" ? "openaiModel" : "geminiModel"]
      : "",
    apiKey,
    prompt: message.prompt,
    mode: stored.mode,
    customInstructions: stored.customInstructions
  });
  const finalPrompt = result.keepOriginal ? message.prompt : result.rewritten;
  return {
    ...result,
    originalEstimate: PromptLensProviders.estimateTokens(message.prompt),
    finalPromptEstimate: PromptLensProviders.estimateTokens(finalPrompt)
  };
}
