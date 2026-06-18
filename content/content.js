// content/content.js
// Step 1 goal: reliably detect the prompt textarea on ChatGPT and log it.
// No UI injection yet — that's step 2.

(function () {
  const selector = PROMPTLENS_SITES[location.hostname];

  if (!selector) {
    console.warn("[PromptLens] No selector configured for", location.hostname);
    return;
  }

  function tryDetect() {
    const el = document.querySelector(selector);
    if (el) {
      console.log("[PromptLens] Prompt input detected:", el);
      return true;
    }
    return false;
  }

  // ChatGPT renders the input via React after initial load, so a single
  // querySelector at document_idle may run too early. Try immediately,
  // then fall back to watching the DOM until it shows up.
  if (!tryDetect()) {
    const observer = new MutationObserver(() => {
      if (tryDetect()) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
