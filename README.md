# PromptVault Chrome Extension

> 113 AI prompts in your browser toolbar. `{{variable}}` substitution + one-click copy.

A Chrome extension version of [PromptVault](https://github.com/jiejuefuyou/autoapp-prompt-vault) — same 113 prompts, same workflow, but accessible from the browser toolbar instead of an iPhone or a tab.

## What it does

1. Click the PromptVault icon in your toolbar
2. Search 113 curated prompts (Claude Code, Midjourney, Coze, ChatGPT writing, marketing, learning…)
3. Click a prompt → fill the `{{variable}}` blanks → see live preview
4. Copy to clipboard
5. Paste into ChatGPT / Claude / Cursor / wherever

## Why a Chrome extension

The same prompts are also available as:
- 🌐 [Web edition](https://jiejuefuyou.github.io/prompts.html) — works in any browser without install
- 📱 iOS app (coming soon, awaiting App Store approval)
- 📄 Markdown pack ([products/prompt-pack](https://github.com/jiejuefuyou/autoapp-prompt-vault))

The Chrome extension wins when:
- You're switching between browser tabs (ChatGPT in one tab, source material in another) — toolbar access is faster than navigating to a URL
- You're not on macOS / iOS and want native-feeling speed
- You're on a Chromebook, Linux, or Windows machine where web is the only option

## Install

### Chrome / Edge / Brave / Arc / Vivaldi (Chromium-based)

1. `git clone https://github.com/jiejuefuyou/promptvault-chrome.git`
2. Open `chrome://extensions/` (or `edge://extensions/`, etc.)
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked"
5. Select the cloned `promptvault-chrome` directory
6. The PromptVault icon appears in your toolbar

### Firefox (also supported)

1. `git clone https://github.com/jiejuefuyou/promptvault-chrome.git`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on…"
4. Select `manifest.json` in the cloned directory
5. The PromptVault icon appears in your toolbar

The manifest declares `browser_specific_settings.gecko` so Firefox accepts it directly. Permissions and behavior are identical to Chromium.

### Chrome Web Store (coming soon)

The extension will be submitted to the Chrome Web Store for one-click install. Listing pending Chrome Web Store developer registration ($5 one-time fee).

Subscribe to [autoappnotes Substack](https://autoappnotes.substack.com) for the launch notice.

## Privacy

Zero networking. Zero analytics. Zero data collection.

The 113 prompts are bundled inline in `src/popup.js` — there's no remote fetching. Your variable inputs never leave your browser. The only browser permissions requested are:

- `clipboardWrite` — to copy prompts to clipboard
- `storage` — for future feature: saving custom prompts (currently unused)

You can verify by reading `manifest.json` — the entire surface area of permissions is two lines.

## Build

The extension is plain HTML/CSS/JS — no build step required. The only generated file is `src/popup.js`, which embeds the 113 prompts from the iOS app's bundled JSON.

To regenerate `popup.js` after the iOS app updates the bundle:

```sh
# from the parent of this repo
cd promptvault-chrome/src
python ../generate_popup_data.py  # see git history; script regenerates on demand
```

## Source for the prompts

The 113 prompts come from [autoapp-prompt-vault](https://github.com/jiejuefuyou/autoapp-prompt-vault), curated based on cross-platform analysis of 597 saved AI-related items on Bilibili and Xiaohongshu. The methodology is in the [research report](https://github.com/jiejuefuyou/autoapp-prompt-vault) at the parent repo.

## License

Code: MIT. Prompt content: personal use unrestricted; commercial redistribution by permission.

## Author

Hao — [@snake_sun on dev.to](https://dev.to/snake_sun) — [autoappnotes Substack](https://autoappnotes.substack.com)
