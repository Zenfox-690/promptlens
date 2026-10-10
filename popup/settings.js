"use strict";

const DEFAULT_MODELS = { gemini: "gemini-3.5-flash-lite", openai: "gpt-4o-mini" };
const providerSelect = document.querySelector("#provider");
const modelInput = document.querySelector("#model");
const keyInput = document.querySelector("#api-key");
const keyState = document.querySelector("#key-state");
const modeSelect = document.querySelector("#mode");
const customInput = document.querySelector("#custom-instructions");
const customLabel = document.querySelector("#custom-label");
const saveState = document.querySelector("#save-state");
const settingsForm = document.querySelector("#settings-form");

function modelStorageKey(provider) {
  return provider === "openai" ? "openaiModel" : "geminiModel";
}

function apiKeyStorageKey(provider) {
  return provider === "openai" ? "openaiApiKey" : "geminiApiKey";
}

function updateKeyStatus(saved) {
  keyState.textContent = saved
    ? "A key is saved locally and is never shown here. Saving does not validate it."
    : "No key is saved for this provider.";
}

function updateCustomMode() {
  const enabled = modeSelect.value === "custom";
  customLabel.hidden = !enabled;
  customInput.hidden = !enabled;
  customInput.required = enabled;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "provider", "geminiModel", "openaiModel", "mode", "customInstructions", "geminiApiKey", "openaiApiKey"
  ]);
  providerSelect.value = stored.provider === "openai" ? "openai" : "gemini";
  modelInput.value = stored[modelStorageKey(providerSelect.value)] || DEFAULT_MODELS[providerSelect.value];
  modeSelect.value = ["concise", "technical", "creative", "custom"].includes(stored.mode) ? stored.mode : "concise";
  customInput.value = typeof stored.customInstructions === "string" ? stored.customInstructions : "";
  keyInput.value = "";
  updateKeyStatus(Boolean(stored[apiKeyStorageKey(providerSelect.value)]));
  updateCustomMode();
}

providerSelect.addEventListener("change", async () => {
  const provider = providerSelect.value;
  const stored = await chrome.storage.local.get([modelStorageKey(provider), apiKeyStorageKey(provider)]);
  modelInput.value = stored[modelStorageKey(provider)] || DEFAULT_MODELS[provider];
  keyInput.value = "";
  updateKeyStatus(Boolean(stored[apiKeyStorageKey(provider)]));
  saveState.textContent = "";
});

modeSelect.addEventListener("change", updateCustomMode);

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = providerSelect.value;
  const model = modelInput.value.trim();
  const key = keyInput.value.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
    saveState.textContent = "Use a model name containing only letters, numbers, dots, underscores, or hyphens.";
    saveState.classList.add("error");
    return;
  }
  if (key.length > 512) {
    saveState.textContent = "The key is too long.";
    saveState.classList.add("error");
    return;
  }
  if (modeSelect.value === "custom" && !customInput.value.trim()) {
    saveState.textContent = "Add a custom instruction or choose another mode.";
    saveState.classList.add("error");
    return;
  }

  const values = {
    provider,
    [modelStorageKey(provider)]: model,
    mode: modeSelect.value,
    customInstructions: customInput.value.trim().slice(0, 1200)
  };
  if (key) values[apiKeyStorageKey(provider)] = key;
  try {
    await chrome.storage.local.set(values);
    keyInput.value = "";
    updateKeyStatus(Boolean(key) || keyState.textContent.startsWith("A key is saved"));
    saveState.textContent = "Settings saved locally. The API key has not been validated.";
    saveState.classList.remove("error");
  } catch {
    saveState.textContent = "Could not save settings in this browser profile.";
    saveState.classList.add("error");
  }
});

document.querySelector("#remove-key").addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove(apiKeyStorageKey(providerSelect.value));
    keyInput.value = "";
    updateKeyStatus(false);
    saveState.textContent = "Saved key removed from this browser profile.";
    saveState.classList.remove("error");
  } catch {
    saveState.textContent = "Could not remove the saved key.";
    saveState.classList.add("error");
  }
});

loadSettings().catch(() => {
  saveState.textContent = "Could not load settings. Reload the extension and try again.";
  saveState.classList.add("error");
});