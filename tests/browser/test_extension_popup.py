"""The popup loaded as a real unpacked extension, not as an offline page.

Run from the repository root:
    python -m unittest discover -s tests/browser -v

test_clipboard.py replaces both clipboard paths with doubles. This module keeps the
real ones: the extension is side-loaded into Playwright's Chromium, the popup runs
from its chrome-extension:// origin under the manifest CSP with the bundled library,
and the copied text is read back from the browser clipboard.

Headless Chromium with extensions uses the platform clipboard, so these tests do
write the OS clipboard. The text that was there before is read first and written
back afterwards; non-text clipboard contents are not preserved.

Branded Chrome and Edge ignore --load-extension, so this needs Playwright's bundled
Chromium or a Chromium build selected with PROMPTVAULT_TEST_BROWSER_EXECUTABLE.
It does not replace the manual Chrome/Edge/Firefox checks tracked in issue #2.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright


ROOT = Path(__file__).resolve().parents[2]


def bundled_prompt_count() -> int:
    source = (ROOT / "src" / "popup.js").read_text(encoding="utf-8")
    return len(json.loads(source[source.index("["): source.rindex("]") + 1]))


def same_text(actual: str | None, expected: str | None) -> bool:
    # The Windows clipboard stores CRLF; compare the content, not the platform line ending.
    return (actual or "").replace("\r\n", "\n") == (expected or "")


class ExtensionPopupTests(unittest.TestCase):
    playwright: Playwright
    context: BrowserContext
    popup_url: str
    saved_clipboard: str | None

    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        profile = tempfile.mkdtemp(prefix="promptvault-extension-")
        cls.addClassCleanup(shutil.rmtree, profile, ignore_errors=True)
        executable = os.environ.get("PROMPTVAULT_TEST_BROWSER_EXECUTABLE") or None
        cls.context = cls.playwright.chromium.launch_persistent_context(
            profile,
            channel=None if executable else "chromium",
            executable_path=executable,
            headless=True,
            args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"],
        )
        cls.addClassCleanup(cls.context.close)
        cls.context.grant_permissions(["clipboard-read", "clipboard-write"])

        page = cls.context.new_page()
        page.goto("chrome://extensions")
        infos: list[dict[str, Any]] = page.evaluate("chrome.developerPrivate.getExtensionsInfo()")
        page.close()
        ids = [info["id"] for info in infos if info.get("name") == "PromptVault"]
        if not ids:
            raise RuntimeError(
                "The unpacked extension did not load; branded Chrome/Edge ignore --load-extension."
            )
        cls.popup_url = f"chrome-extension://{ids[0]}/src/popup.html"

        cls.saved_clipboard = None
        probe = cls.open_popup_page()
        try:
            cls.saved_clipboard = probe.evaluate("navigator.clipboard.readText()")
        except Exception:
            pass  # Nothing readable as text; there is nothing to put back either.
        finally:
            probe.close()
        cls.addClassCleanup(cls.restore_clipboard)

    @classmethod
    def open_popup_page(cls) -> Page:
        page = cls.context.new_page()
        page.goto(cls.popup_url)
        page.wait_for_selector("#list .prompt", timeout=15000)
        return page

    @classmethod
    def restore_clipboard(cls) -> None:
        if cls.saved_clipboard is None:
            return
        page = cls.open_popup_page()
        try:
            page.evaluate("text => navigator.clipboard.writeText(text)", cls.saved_clipboard)
        finally:
            page.close()

    def setUp(self) -> None:
        self.errors: list[str] = []
        self.page = self.open_popup_page()
        self.page.on("console", lambda message: message.type == "error" and self.errors.append(message.text))
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.addCleanup(self.page.close)

    def tearDown(self) -> None:
        self.assertEqual([], self.errors)

    def open_prompt(self, index: int) -> str:
        self.page.locator("#list .prompt").nth(index).click()
        # Function predicates: the extension CSP forbids the eval behind string predicates.
        self.page.wait_for_function("() => document.getElementById('promptDialog').open")
        return self.page.eval_on_selector("#renderedPreview", "element => element.textContent")

    def wait_for_copy_outcome(self) -> str:
        self.page.wait_for_function(
            "() => document.getElementById('dialogCopy').textContent === 'Copied'"
            " || document.getElementById('dialogStatus').textContent.startsWith('Copy failed')"
        )
        return self.page.text_content("#dialogStatus") or ""

    def test_renders_whole_bundled_library(self) -> None:
        self.assertEqual(bundled_prompt_count(), self.page.locator("#list .prompt").count())

    def test_clipboard_api_copies_rendered_prompt(self) -> None:
        expected = self.open_prompt(0)
        self.page.click("#dialogCopy")
        self.assertEqual("Copied to clipboard.", self.wait_for_copy_outcome())
        self.assertTrue(same_text(self.page.evaluate("navigator.clipboard.readText()"), expected))

    def test_fallback_copies_when_clipboard_api_rejects(self) -> None:
        self.page.evaluate("navigator.clipboard.writeText('stale clipboard text')")
        # Trailing `; 0`: Playwright would otherwise call the function the expression returns.
        self.page.evaluate(
            "navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); 0"
        )
        expected = self.open_prompt(1)
        self.page.click("#dialogCopy")
        self.assertEqual("Copied to clipboard.", self.wait_for_copy_outcome())
        # Reporting success is not enough: the fallback must really have replaced the text.
        self.page.evaluate("delete navigator.clipboard.writeText; 0")
        self.assertTrue(same_text(self.page.evaluate("navigator.clipboard.readText()"), expected))
        self.assertEqual(0, self.page.locator(".clipboard-fallback").count())

    def test_copy_finishing_after_reopen_does_not_mark_new_dialog(self) -> None:
        self.page.evaluate(
            "navigator.clipboard.writeText = () => new Promise(resolve => { window.finishCopy = resolve; }); 0"
        )
        self.open_prompt(2)
        self.page.click("#dialogCopy")
        self.page.wait_for_function("() => typeof window.finishCopy === 'function'")
        self.page.click("#dialogClose")
        self.open_prompt(3)
        self.page.evaluate("window.finishCopy(); 0")
        self.page.wait_for_timeout(200)
        self.assertNotEqual("Copied", (self.page.text_content("#dialogCopy") or "").strip())
        self.assertFalse(self.page.evaluate("document.getElementById('dialogCopy').disabled"))


if __name__ == "__main__":
    unittest.main()
