(function (root) {
  "use strict";

  const SELECTORS = [
    "#prompt-textarea",
    'textarea[data-testid="prompt-textarea"]',
    '[contenteditable="true"][data-testid="prompt-textarea"]',
    'main [contenteditable="true"][role="textbox"]',
    "main textarea[placeholder]"
  ];

  function read(editor) {
    return editor.tagName === "TEXTAREA"
      ? editor.value
      : (editor.innerText || editor.textContent || "").replace(/\u00a0/g, " ");
  }

  function isUsable(editor) {
    if (!editor.isConnected || editor.disabled || editor.getAttribute("aria-disabled") === "true") return false;
    const rect = editor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findEditors(documentObject) {
    const found = new Set();
    for (const selector of SELECTORS) {
      for (const editor of documentObject.querySelectorAll(selector)) {
        if ((editor.isContentEditable || editor.tagName === "TEXTAREA") && isUsable(editor)) found.add(editor);
      }
    }
    return [...found];
  }

  function apply(editor, value, documentObject) {
    editor.focus();
    if (editor.tagName === "TEXTAREA") {
      editor.setRangeText(value, 0, editor.value.length, "end");
      const view = editor.ownerDocument.defaultView;
      editor.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      editor.dispatchEvent(new view.Event("change", { bubbles: true }));
      return editor.value === value;
    }

    if (typeof documentObject.execCommand !== "function") return false;
    const previous = read(editor);
    const selection = documentObject.defaultView.getSelection();
    const range = documentObject.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    const changed = documentObject.execCommand("insertText", false, value);
    const actual = read(editor).replace(/\r\n/g, "\n").trim();
    if (changed && actual === value.replace(/\r\n/g, "\n").trim()) return true;

    const restore = documentObject.createRange();
    restore.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(restore);
    documentObject.execCommand("insertText", false, previous);
    return false;
  }

  const api = { SELECTORS, read, isUsable, findEditors, apply };
  root.PromptLensEditor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);