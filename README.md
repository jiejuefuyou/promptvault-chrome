# PromptVault browser extension

A local-first prompt library in the browser toolbar. Search the bundled collection, fill `{{variables}}`, preview the rendered prompt, and copy it without sending prompt content or variable values to a developer server.

## What changed in 1.1

- Prompt count is read from the bundled library instead of being hard-coded in the UI or manifest.
- Placeholder parsing matches the iOS syntax: `{{name}}`, `{{count:int=5}}`, and `{{notes:multiline=}}`.
- Search is multi-term, diacritic-insensitive, CJK-safe, and ranks title matches first.
- Prompt rows are real keyboard-accessible buttons; Arrow keys, Home, End, `/`, Escape, and Ctrl/⌘+Enter are supported.
- The editor uses a native modal dialog with focus restoration and live status announcements.
- Prompt data is inserted with DOM `textContent`; shipping UI code does not use HTML-string injection, `eval`, or remote scripts.
- The unused `storage` permission was removed. The only requested permission is `clipboardWrite`.
- Clipboard copy has a selection fallback for browsers that reject the modern Clipboard API.

## Install locally

### Chrome / Edge / Brave / Arc / Vivaldi

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `manifest.json`.

The Manifest V3 file includes a stable Gecko extension ID and Firefox 109 minimum version.

## Privacy and permissions

The extension has no host permissions, analytics, ads, tracking SDKs, background service, or developer sync server. It reads the packaged prompt bundle through an extension-local URL. External pages open only after the user clicks a visible link.

Requested permission:

- `clipboardWrite` — copy the rendered prompt after an explicit button press.

Variable values exist only in the popup DOM and disappear when the popup closes.

## Architecture

```text
manifest.json
src/
  popup.html       semantic popup shell
  popup.css        responsive dark/light presentation
  core.js          pure parsing, rendering, validation and search
  app.js           DOM, dialog, keyboard and clipboard controller
  popup.js         legacy generated bundle retained as packaged prompt data
scripts/
  verify-extension.cjs
tests/
  core.test.cjs
```

`popup.js` is no longer executed. `app.js` reads its first JSON payload as data and validates every record before rendering it. This keeps the existing generated library intact while separating trusted data from the new UI controller.

## Verify

No third-party packages are required:

```bash
npm run verify
```

The contract checks:

- minimal permissions and no host permissions
- Manifest V3 CSP
- no inline scripts or unsafe DOM/code primitives in shipping UI code
- bundled prompt payload validity and duplicate detection
- typed variables, defaults, unresolved placeholders, search normalization and ranking

## Source and license

Code is MIT. Bundled prompt content is available for personal use; commercial redistribution requires permission.
