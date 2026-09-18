# Offline clipboard browser regressions

These optional tests run the production popup HTML, CSS, `core.js`, and `app.js`
in Chromium. They do not add extension/runtime dependencies or change `npm run verify`.

## Run

Use Python 3.9+ in an isolated environment from the repository root:

```sh
python -m venv .venv-browser
# Activate the environment using your platform's venv activation command.
python -m pip install -r tests/browser/requirements.txt
python -m playwright install chromium
npm run test:browser
# Equivalent without npm:
python -m unittest discover -s tests/browser -v
```

An already-installed Chromium may be selected with the environment variable
`PROMPTVAULT_TEST_BROWSER_EXECUTABLE` (absolute executable path). Missing Playwright
or a missing/unlaunchable browser fails the run; no skipped tests count as success.
Keep virtual environments, tests, and test logs out of extension store packages.

## Coverage and boundaries

The 18 scenarios cover pending-copy serialization, editing during/after copying,
old success/failure callbacks after closing or reopening a dialog (including the
same prompt), stale timer isolation, retry after failure, integer validation after
failure, Unicode text, and fallback selection/focus/cleanup inside a modal dialog.

Each test gets a fresh browser context. The page is populated offline with the
production DOM/CSS/scripts; `fetch` returns four synthetic prompts instead of the
real bundled library. Every actual network request is blocked and fails an
assertion. JavaScript page errors also fail the test. Playwright's clock controls
the 1.4-second feedback timer; deferred promises control clipboard completion.

`navigator.clipboard.writeText` and `document.execCommand('copy')` are test doubles.
Chromium's actual dialog, focus, text selection, input, and keyboard behavior run,
but these tests **do not validate native clipboard permissions or OS writes**.
They also do not load an unpacked extension, check extension-local fetch/CSP,
validate the real prompt corpus or store package, or prove Chrome/Edge/Firefox
compatibility. Browser Gate issue #2 remains open for those checks.

### Unpacked extension (`test_extension_popup.py`)

These 4 tests side-load the repository into Playwright's Chromium and open the
popup from its `chrome-extension://` origin, so the manifest CSP, extension-local
`fetch` of the bundled library, the real `execCommand('copy')` fallback, and the
browser clipboard are all real. They check that every bundled prompt renders, that
the Clipboard API and the fallback both leave the rendered prompt on the clipboard
(the fallback must not report success while the old text is still there), and that
a copy finishing after the dialog was reopened does not mark the new dialog.

Headless Chromium with extensions uses the **OS clipboard**. The tests read the text
that was there first and write it back afterwards; non-text contents are lost.
Branded Chrome and Edge ignore `--load-extension`, so this needs the bundled Chromium
or a Chromium build in `PROMPTVAULT_TEST_BROWSER_EXECUTABLE`. It is not a Chrome,
Edge, or Firefox store/permission check.

An already-issued native clipboard write cannot be cancelled by this fix. Session
identity prevents obsolete UI updates and prevents a rejected obsolete request
from starting a fallback write; it does not promise to cancel or reorder native
clipboard writes that the browser has already accepted.

## Executed evidence (2026-09-13)

Base: `10955b3d4d94c6614c9dc7017c4d4aa6584a0c50`.
Only the necessary source/test files were materialized for local verification;
unchanged source files were checked against their Git blob hashes.

Environment: Debian 13, Python 3.13.5, Playwright 1.57.0,
Chromium 144.0.7559.96, Node 22.16.0.

| Run | Result |
| --- | --- |
| New browser regressions against original `app.js` | 18 tests: 15 failures, 3 passes |
| New browser regressions after the fix | 18 passed, 0 skipped |
| Repeat via `npm run test:browser` | 18 passed, 0 skipped |
| Existing `npm test` core tests | 6 passed, 0 skipped |
| `node --check src/app.js` and `src/core.js` | Passed |
| `python -m py_compile tests/browser/test_clipboard.py` | Passed |

The complete `npm run verify` gate was not run locally: the real corpus, icons,
and manifest verifier were not materialized. Check its existing CI run separately;
these local results are not a claim that CI or the release gates passed.

## Executed evidence (2026-09-18, Windows full checkout)

GitHub Actions is disabled for this repository, so there is no CI run to check;
these are the local runs. Environment: Windows 11, Python 3.12.10, Playwright
1.58.0, Chromium 145.0.7632.6, Node 24.15.0.

| Run | Result |
| --- | --- |
| `npm run verify` (lint, manifest/bundle verifier, core tests) | 6 passed, verifier passed |
| `python -m unittest discover -s tests/browser` | 22 passed (18 + 4) |
| `test_clipboard.py` against the original `app.js` | 18 tests: 15 failures |
| `test_extension_popup.py` against the original `app.js` | 4 tests: 2 failures (fallback reported "Copied" with the old text still on the clipboard; stale copy marked the reopened dialog) |
| Clipboard text placed before the run | Unchanged after the run |
