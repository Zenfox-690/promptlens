# PromptLens

PromptLens is a Manifest V3 Chrome extension for reviewing prompt improvements before submitting them. It currently supports ChatGPT on `chatgpt.com` and `chat.openai.com` only.

## What it does

- Detects the ChatGPT prompt editor and keeps one Optimize control available through editor replacement and single-page navigation.
- Sends the current prompt only to the provider selected in settings: Google Gemini or OpenAI.
- Shows the original and suggested rewrite side by side, with an explanation and explicitly approximate final-prompt size estimates.
- Returns a keep-original outcome when a clear, concise prompt has no meaningful improvement. Longer suggestions are allowed only when added clarity or specificity justifies their length.
- Lets you accept, copy, or discard the rewrite. It does not submit prompts or replace editor text automatically.
- Provides Concise, Technical, Creative, and Custom instruction modes.

If ChatGPT changes its editor in a way PromptLens cannot update safely, the extension leaves the prompt as-is and offers copying the rewrite. Claude, Gemini web, Perplexity, and other sites are not supported.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this repository folder (the one containing `manifest.json`).
3. Open the extension's toolbar popup, select a provider and model, enter your own API key, and save. The key is not tested when saved.
4. Open or reload a ChatGPT tab. Type a prompt, select **Optimize**, review the result, then Accept, Copy, or Discard.

After source changes, use **Reload** on the extension card and reload existing ChatGPT tabs. Do not package or publish a copy containing a personal API key.

## Providers and models

Gemini is selected by default to prioritize the available free tier where the account, model, region, and usage remain eligible. Default model: `gemini-3.5-flash-lite` (listed as a stable model and free-tier eligible in Google's documentation checked 2026-10-11). Google changes models, availability, and quotas; check your own AI Studio project before relying on it. The Free tier does not promise unlimited or permanent access.

**Important Gemini terms and privacy:** Google's current Gemini API Additional Terms describe the API as intended for professional or business use, not consumer use. Confirm that your own use is permitted before using this provider. Google's unpaid-services terms say submitted content and responses may be used to improve Google products and may be reviewed by human reviewers. Do not submit sensitive, confidential, or personal information on the unpaid tier. In the EEA, Switzerland, and UK, the terms specify paid services for API clients. The settings popup repeats the data warning.

Google AI Studio now creates authorization keys by default (per its October 2026 key guide). Older unrestricted standard keys are rejected; older standard keys need Gemini API restrictions. Check the key type and restrictions in AI Studio. PromptLens never tests a key until you click Optimize.

OpenAI remains supported using Chat Completions, default model `gpt-4o-mini`. It is an API-billed model; no free API quota is assumed. Add a newly issued OpenAI key if choosing this provider. The revoked key formerly in this working tree has been removed from current source, but this does not rewrite history or remove any copies you may have made.

Both model names can be edited in settings. Use a model identifier supported by the selected provider's API. A saved key is not evidence of validity. PromptLens does not silently switch providers, retry requests, enable billing, or send prompts anywhere except the selected provider's fixed HTTPS endpoint.

## Credentials and privacy

- Keys are stored in this Chrome profile with `chrome.storage.local`; they are not synchronized by PromptLens and are not included in source.
- Extension storage is not a secure vault. Someone who can inspect or compromise this browser profile or extension can recover a stored key. Restrict provider keys to the minimum services/usage possible and rotate a key if exposed.
- On each explicit Optimize action, the prompt and a short mode-specific instruction are sent to the selected provider. The generated rewrite and explanation return to the extension. No prompt history, analytics, or telemetry is kept by PromptLens.
- OpenAI requests set `store: false`. Provider-side handling, retention, training use, and billing are still governed by the provider and account settings.
- API keys travel in HTTPS request headers, not URLs. PromptLens does not log prompts, responses, keys, or provider payloads.

## Limits and troubleshooting

- Original and final prompt sizes use a lightweight character-based estimate (roughly one token per four UTF-16 characters). They are approximate, not provider tokenizer counts or billing records; languages and token distributions differ. No separate token-count request is made.
- Where returned by the provider, the review also shows API-reported input/output token usage. For Gemini this comes from `usageMetadata`; input includes the prompt and PromptLens instructions, and output includes the structured response. These API counts are not the estimated size of the final prompt.
- Requests are limited to 12,000 prompt characters, with a 45-second timeout and a bounded output. Errors do not replace the original prompt.
- **Missing key:** open the toolbar popup and add a key for the currently selected provider.
- **Authentication error:** re-enter a current key and check its provider, key type, and restrictions. PromptLens does not validate keys in advance.
- **Quota or rate limit:** check the provider's current project/model limits and wait or select another configured provider yourself. PromptLens does not switch providers automatically.
- **Model not found:** check the provider's current model catalog and enter an available model name.
- **Network or timeout:** check connectivity, extension permissions, and provider status; retry manually.
- **No Optimize button:** reload the extension and ChatGPT tab, then confirm the site is one of the supported ChatGPT domains and that a visible prompt editor is present.
- **Rewrite not inserted:** the target editor rejected the update; use Copy and paste manually. The extension does not force a DOM text replacement.

## Testing

No dependencies or install step are required. With Node.js 20 or newer:

```powershell
node --test tests/extension.test.js
```

The tests mock both providers and cover request shapes, parsing, keep-original and rewrite outcomes, usage metadata, error classes, message origin/config checks, editor helper behavior, settings storage, manifest references, and credential patterns. They do not contact provider APIs or prove live key/model access.

### Manual Chrome smoke test

1. Load the unpacked extension and open its popup. Check Gemini/OpenAI selection, model defaults, four modes, key save/remove status, and that reopening never displays a saved key.
2. Configure a key privately in the popup. Verify saving does not claim the key is valid. For Gemini, first confirm the project/key type, model access, region, current quota, terms, and unpaid-tier data use.
3. On ChatGPT, enter a multiline prompt containing a constraint and select Optimize. Confirm only the review panel updates while the editor retains the original.
4. Review the proposed text, reason, explicitly approximate original/final prompt sizes, and separate API-reported usage when available. Test Copy, Discard, and then Accept separately; acceptance should update the editor and remain unsent. For an already-concise prompt, confirm PromptLens reports that the original should be kept and disables Accept/Copy.
5. Repeat with a missing key, then with provider quota/network failure. Confirm the original remains unchanged and the error is actionable.
6. Navigate to another conversation, let ChatGPT rerender the composer, and confirm there is still only one Optimize control. Reload the extension and ChatGPT tab and repeat the detection check.

## Maintenance

Recheck provider model names, Gemini terms/data handling/free-tier status, region rules, and quotas before relying on a model or each time the provider changes them. To add a provider, implement its request/response mapping in `background/providers.js`, constrain its HTTPS host in `manifest.json`, add explicit UI configuration, and add mocked tests. To add a website, verify its actual editor and host behavior, add a restrictive match pattern, and test editor replacement and safe write-back before documenting support.

## Official provider references

- [Gemini text generation](https://ai.google.dev/gemini-api/docs/text-generation)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API key guidance](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Gemini available regions](https://ai.google.dev/gemini-api/docs/available-regions)
- [OpenAI GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
