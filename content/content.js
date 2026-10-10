(function () {
  "use strict";

  if (window.__promptLensLoaded || !PROMPTLENS_SITES[location.hostname]) return;
  window.__promptLensLoaded = true;

  let activeEditor = null;
  let requestSequence = 0;
  let resizeObserver = null;
  let framePending = false;

  const optimizeButton = document.createElement("button");
  optimizeButton.id = "promptlens-optimize";
  optimizeButton.type = "button";
  optimizeButton.textContent = "Optimize";
  optimizeButton.setAttribute("aria-label", "Optimize the current prompt with PromptLens");
  optimizeButton.title = "Review a suggested prompt rewrite";
  document.documentElement.appendChild(optimizeButton);

  const panel = document.createElement("section");
  panel.id = "promptlens-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "promptlens-title");
  panel.hidden = true;
  panel.innerHTML = `
    <header class="pl-header"><strong id="promptlens-title">PromptLens review</strong><button type="button" class="pl-close" aria-label="Close review">Close</button></header>
    <p class="pl-status" role="status" aria-live="polite"></p>
    <div class="pl-columns">
      <label>Original <span class="pl-original-count"></span><pre class="pl-original"></pre></label>
      <label>Suggested <span class="pl-new-count"></span><pre class="pl-new"></pre></label>
    </div>
    <p class="pl-reason"></p>
    <p class="pl-usage" hidden></p>
    <div class="pl-actions"><button type="button" class="pl-accept" disabled>Accept</button><button type="button" class="pl-copy" disabled>Copy</button><button type="button" class="pl-discard">Discard</button></div>`;
  document.documentElement.appendChild(panel);

  const status = panel.querySelector(".pl-status");
  const originalView = panel.querySelector(".pl-original");
  const rewrittenView = panel.querySelector(".pl-new");
  const reasonView = panel.querySelector(".pl-reason");
  const usageView = panel.querySelector(".pl-usage");
  const acceptButton = panel.querySelector(".pl-accept");
  const copyButton = panel.querySelector(".pl-copy");
  let currentOriginal = "";
  let currentRewrite = "";
  let requestEditor = null;
  let busy = false;

  function approximateCount(count) {
    return `~${count} tokens (approx.)`;
  }

  function positionButton() {
    if (!activeEditor || !PromptLensEditor.isUsable(activeEditor)) {
      optimizeButton.hidden = true;
      return;
    }
    const rect = activeEditor.getBoundingClientRect();
    optimizeButton.hidden = false;
    optimizeButton.style.top = `${Math.max(8, rect.top - 38)}px`;
    optimizeButton.style.left = `${Math.max(8, Math.min(window.innerWidth - 100, rect.right - 94))}px`;
  }

  function refreshEditors() {
    const editors = PromptLensEditor.findEditors(document);
    if (activeEditor && !editors.includes(activeEditor)) activeEditor = null;
    if (!activeEditor) activeEditor = editors[0] || null;
    if (resizeObserver) resizeObserver.disconnect();
    if (activeEditor && resizeObserver) resizeObserver.observe(activeEditor);
    positionButton();
  }

  function scheduleRefresh() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      refreshEditors();
    });
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("pl-error", Boolean(isError));
  }

  function openPanel(original) {
    currentOriginal = original;
    currentRewrite = "";
    originalView.textContent = original;
    rewrittenView.textContent = "Waiting for provider...";
    reasonView.textContent = "";
    panel.querySelector(".pl-original-count").textContent = approximateCount(Math.ceil(original.length / 4));
    panel.querySelector(".pl-new-count").textContent = "";
    usageView.hidden = true;
    usageView.textContent = "";
    acceptButton.disabled = true;
    copyButton.disabled = true;
    setStatus("Sending this prompt to the provider selected in PromptLens settings...", false);
    panel.hidden = false;
  }

  function closePanel() {
    requestSequence += 1;
    busy = false;
    optimizeButton.disabled = false;
    acceptButton.disabled = true;
    copyButton.disabled = true;
    panel.hidden = true;
    optimizeButton.focus();
  }

  function sendOptimize(original, sequence) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "PROMPTLENS_OPTIMIZE", prompt: original }, (response) => {
        if (chrome.runtime.lastError) reject(new Error("PromptLens could not reach its service worker. Reload the extension and try again."));
        else if (!response) reject(new Error("PromptLens received no response. Reload the extension and try again."));
        else if (response.error) reject(new Error(response.error));
        else if (sequence !== requestSequence) reject(new Error("This result is no longer current."));
        else resolve(response);
      });
    });
  }

  async function optimize() {
    if (busy || !activeEditor) return;
    const editor = activeEditor;
    const original = PromptLensEditor.read(editor);
    if (!original.trim()) {
      openPanel("");
      setStatus("Enter a prompt in the editor first.", true);
      rewrittenView.textContent = "";
      return;
    }
    if (original.length > 12000) {
      openPanel(original);
      setStatus("This prompt exceeds the 12,000-character limit. Shorten it and try again.", true);
      return;
    }

    busy = true;
    optimizeButton.disabled = true;
    requestEditor = editor;
    const sequence = ++requestSequence;
    openPanel(original);
    try {
      const result = await sendOptimize(original, sequence);
      if (sequence !== requestSequence) return;
      if (!editor.isConnected || PromptLensEditor.read(editor) !== original) {
        setStatus("The editor changed while this request was running. This result was discarded; your current text is untouched.", true);
        rewrittenView.textContent = "";
        return;
      }
      const before = Number.isFinite(result.originalEstimate) ? result.originalEstimate : Math.ceil(original.length / 4);
      const after = Number.isFinite(result.finalPromptEstimate) ? result.finalPromptEstimate : Math.ceil((result.keepOriginal ? original : result.rewritten).length / 4);
      panel.querySelector(".pl-original-count").textContent = approximateCount(before);
      panel.querySelector(".pl-new-count").textContent = `${approximateCount(after)}${result.keepOriginal ? " (unchanged)" : ` (${after - before >= 0 ? "+" : ""}${after - before} approx.)`}`;

      if (result.usage && (Number.isInteger(result.usage.inputTokens) || Number.isInteger(result.usage.outputTokens))) {
        const input = Number.isInteger(result.usage.inputTokens) ? result.usage.inputTokens : "not reported";
        const output = Number.isInteger(result.usage.outputTokens) ? result.usage.outputTokens : "not reported";
        usageView.textContent = `API-reported usage (${result.usage.provider}): input ${input}, output ${output} tokens. Input includes PromptLens instructions; these counts are separate from the approximate final-prompt size.`;
        usageView.hidden = false;
      }

      if (result.keepOriginal) {
        currentRewrite = "";
        rewrittenView.textContent = "Keep your original prompt. No meaningful improvement was found.";
        reasonView.textContent = result.reason || "This prompt is already concise and clear.";
        setStatus("No rewrite needed. Your editor is unchanged.", false);
        acceptButton.disabled = true;
        copyButton.disabled = true;
        return;
      }

      currentRewrite = result.rewritten;
      rewrittenView.textContent = currentRewrite;
      reasonView.textContent = result.reason || "Review the proposed changes before using them.";
      setStatus("Review the rewrite. Your editor still contains the original prompt.", false);
      acceptButton.disabled = false;
      copyButton.disabled = false;
    } catch (error) {
      if (sequence === requestSequence) {
        rewrittenView.textContent = "";
        setStatus(error.message || "Optimization failed. Your original prompt is unchanged.", true);
      }
    } finally {
      if (sequence === requestSequence) {
        busy = false;
        optimizeButton.disabled = false;
      }
    }
  }

  async function copyRewrite() {
    try {
      await navigator.clipboard.writeText(currentRewrite);
      setStatus("Rewrite copied. Your editor still contains the original prompt.", false);
    } catch {
      setStatus("Clipboard access was blocked. Select the suggested text and copy it manually.", true);
    }
  }

  optimizeButton.addEventListener("click", optimize);
  panel.querySelector(".pl-close").addEventListener("click", closePanel);
  panel.querySelector(".pl-discard").addEventListener("click", closePanel);
  panel.querySelector(".pl-copy").addEventListener("click", copyRewrite);
  acceptButton.addEventListener("click", () => {
    if (!currentRewrite || !requestEditor?.isConnected) {
      setStatus("The editor is no longer available. Copy the rewrite instead.", true);
      return;
    }
    if (PromptLensEditor.read(requestEditor) !== currentOriginal) {
      setStatus("The editor has changed since optimization. Copy the rewrite or optimize the current text again.", true);
      return;
    }
    if (PromptLensEditor.apply(requestEditor, currentRewrite, document)) {
      closePanel();
    } else {
      setStatus("This editor rejected the update. Your original text was restored; copy the rewrite as a fallback.", true);
    }
  });

  document.addEventListener("focusin", (event) => {
    if (PromptLensEditor.findEditors(document).includes(event.target)) {
      activeEditor = event.target;
      scheduleRefresh();
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });
  window.addEventListener("scroll", positionButton, true);
  window.addEventListener("resize", positionButton);
  resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(positionButton) : null;

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refreshEditors();
})();
