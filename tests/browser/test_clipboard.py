"""Clipboard regressions against the real popup DOM, without network or OS writes.

Run from the repository root:
    python -m unittest discover -s tests/browser -v

Requires the optional Playwright dependency and Chromium (see README.md here).
Missing dependencies/browser fail the run rather than silently skipping tests.
"""

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
PROMPTS = [
    {"title": "First", "body": "Hello {{name:string=Alice}}", "tags": []},
    {"title": "Second", "body": "Second {{name:string=Bob}}", "tags": []},
    {"title": "Count", "body": "Give {{count:int=2}} ideas", "tags": []},
    {"title": "Notes", "body": "Notes: {{notes:multiline=Hello\nworld}}", "tags": []},
]

CLIPBOARD_HARNESS = """(() => {
  const harness = window.clipboardHarness = {
    requests: [], fallbackCalls: [], immediateWrites: [], fallbackMode: 'allow',
    useImmediateAPI: () => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async text => {
        harness.immediateWrites.push(text);
      } },
    }),
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text) => new Promise((resolve, reject) => {
      harness.requests.push({ text, resolve, reject });
    }) },
  });
  document.execCommand = (command) => {
    if (command !== 'copy') throw new Error('Unexpected command: ' + command);
    const field = document.querySelector('.clipboard-fallback');
    harness.fallbackCalls.push({
      insideDialog: document.querySelector('#promptDialog').contains(field),
      focused: document.activeElement === field,
      selected: field ? field.value.slice(field.selectionStart, field.selectionEnd) : null,
    });
    if (harness.fallbackMode === 'throw') throw new Error('test copy exception');
    if (harness.fallbackMode === 'deny') return false;
    return true;
  };
})();"""


class ClipboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch(
            headless=True,
            executable_path=os.environ.get("PROMPTVAULT_TEST_BROWSER_EXECUTABLE") or None,
        )
        cls.addClassCleanup(cls.browser.close)

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 400, "height": 600},
            service_workers="block",
        )
        self.addCleanup(self.context.close)
        self.unexpected_requests = []

        def reject_request(route):
            self.unexpected_requests.append(route.request.url)
            route.abort()

        self.context.route("**/*", reject_request)
        self.page = self.context.new_page()
        self.page.set_default_timeout(3000)
        self.page_errors = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        now = datetime(2026, 9, 13, tzinfo=timezone.utc)
        self.page.clock.install(time=now)
        self.page.clock.pause_at(now + timedelta(seconds=1))
        # Preserve the production DOM/CSS; inject the exact scripts offline instead
        # of navigating or granting extension/clipboard permissions.
        html = (ROOT / "src/popup.html").read_text(encoding="utf-8")
        html = html.replace('<link rel="stylesheet" href="popup.css">', '')
        for name in ("core.js", "app.js"):
            html = html.replace(f'<script src="{name}"></script>', '')
        self.page.set_content(html)
        self.page.add_style_tag(content=(ROOT / "src/popup.css").read_text(encoding="utf-8"))
        self.page.evaluate(CLIPBOARD_HARNESS)
        self.page.evaluate("""source => {
          window.libraryRequests = [];
          window.fetch = async url => {
            window.libraryRequests.push(String(url));
            if (url !== 'popup.js') throw new Error('Unexpected library URL: ' + url);
            return { ok: true, text: async () => source };
          };
        }""", "const PROMPTS = " + json.dumps(PROMPTS) + ";\n\nconst els = {};")
        for name in ("core.js", "app.js"):
            self.page.add_script_tag(content=(ROOT / "src" / name).read_text(encoding="utf-8"))
        self.page.wait_for_function("document.querySelectorAll('.prompt').length === 4")
        self.button = self.page.locator("#dialogCopy")
        self.status = self.page.locator("#dialogStatus")

    def tearDown(self):
        self.assertEqual(self.page_errors, [], "Unexpected JavaScript errors")
        self.assertEqual(self.unexpected_requests, [], "Unexpected page network requests")
        self.assertEqual(self.page.evaluate("libraryRequests"), ["popup.js"])

    def open_prompt(self, index=0):
        self.page.locator(".prompt").nth(index).click()

    def close_prompt(self):
        self.page.locator("#dialogClose").click()

    def field(self):
        return self.page.locator("[data-variable-name]")

    def request_texts(self):
        return self.page.evaluate("clipboardHarness.requests.map(request => request.text)")

    def settle(self, index=0, reject=False):
        # Drain the promise chain deterministically; no timing sleeps or real permissions UI.
        self.page.evaluate("""async ({index, reject}) => {
          const request = clipboardHarness.requests[index];
          if (reject) request.reject(new Error('test clipboard rejection'));
          else request.resolve();
          for (let i = 0; i < 6; i++) await Promise.resolve();
        }""", {"index": index, "reject": reject})

    def assert_ready(self):
        self.assertEqual(self.button.text_content(), "Copy to clipboard")
        self.assertFalse(self.button.is_disabled())
        self.assertEqual(self.status.text_content(), "Ready to copy")

    def test_success_copies_snapshot_and_resets_after_delay(self):
        self.open_prompt()
        self.button.click()
        self.assertEqual(self.request_texts(), ["Hello Alice"])
        self.settle()
        self.assertEqual(self.button.text_content(), "Copied")
        self.page.clock.run_for(1401)
        self.assert_ready()

    def test_pending_copy_stays_disabled_after_edit(self):
        self.open_prompt()
        self.button.click()
        self.field().fill("Carol")
        self.assertTrue(self.button.is_disabled())
        self.assertEqual(self.button.text_content(), "Copying…")

    def test_keyboard_cannot_submit_second_copy_while_pending(self):
        self.open_prompt()
        self.button.click()
        self.field().fill("Carol")
        self.page.keyboard.press("Control+Enter")
        self.assertEqual(self.request_texts(), ["Hello Alice"])

    def test_edited_preview_is_not_marked_copied_by_old_snapshot(self):
        self.open_prompt()
        self.button.click()
        self.field().fill("Carol")
        self.settle()
        self.assert_ready()
        self.assertEqual(self.page.locator("#renderedPreview").text_content(), "Hello Carol")
        self.button.click()
        self.assertEqual(self.request_texts(), ["Hello Alice", "Hello Carol"])

    def test_edit_after_success_clears_copied_label_immediately(self):
        self.open_prompt()
        self.button.click()
        self.settle()
        self.field().fill("Carol")
        self.assert_ready()
        self.assertNotIn("copied", self.button.get_attribute("class").split())

    def test_stale_success_does_not_touch_new_dialog(self):
        self.open_prompt()
        self.button.click()
        self.close_prompt()
        self.open_prompt(1)
        self.settle()
        self.assert_ready()
        self.assertEqual(self.page.locator("#dialogTitle").text_content(), "Second")

    def test_reopening_same_prompt_invalidates_previous_copy(self):
        self.open_prompt()
        self.button.click()
        self.close_prompt()
        self.open_prompt()
        self.settle()
        self.assert_ready()

    def test_stale_rejection_does_not_run_fallback(self):
        self.open_prompt()
        self.button.click()
        self.close_prompt()
        self.open_prompt(1)
        self.settle(reject=True)
        self.assertEqual(self.page.evaluate("clipboardHarness.fallbackCalls"), [])
        self.assert_ready()

    def test_closing_dialog_suppresses_late_failure(self):
        self.open_prompt()
        self.button.click()
        self.close_prompt()
        self.settle(reject=True)
        self.assertEqual(self.page.evaluate("clipboardHarness.fallbackCalls"), [])
        self.assertEqual(self.page.locator(".clipboard-fallback").count(), 0)
        self.assertFalse(self.page.locator("#promptDialog").is_visible())

    def test_stale_success_preserves_new_pending_operation(self):
        self.open_prompt()
        self.button.click()
        self.close_prompt()
        self.open_prompt(1)
        self.button.click()
        self.settle()
        self.assertEqual(self.button.text_content(), "Copying…")
        self.assertTrue(self.button.is_disabled())
        self.settle(index=1)
        self.assertEqual(self.button.text_content(), "Copied")

    def test_stale_rejection_preserves_new_pending_operation(self):
        self.open_prompt()
        self.button.click()
        self.close_prompt()
        self.open_prompt(1)
        self.button.click()
        self.settle(reject=True)
        self.assertEqual(self.page.evaluate("clipboardHarness.fallbackCalls"), [])
        self.assertTrue(self.button.is_disabled())
        self.settle(index=1)
        self.assertEqual(self.button.text_content(), "Copied")

    def test_old_success_timer_cannot_unlock_new_copy(self):
        self.open_prompt()
        self.button.click()
        self.settle()
        self.field().fill("Carol")
        self.button.click()
        self.page.clock.run_for(1401)
        self.assertTrue(self.button.is_disabled())
        self.assertEqual(self.button.text_content(), "Copying…")

    def test_failed_copy_preserves_invalid_integer_guard(self):
        self.open_prompt(2)
        self.button.click()
        self.field().fill("1.5")
        self.page.evaluate("clipboardHarness.fallbackMode = 'deny'")
        self.settle(reject=True)
        self.assertTrue(self.button.is_disabled())
        self.assertIn("Copy failed:", self.status.text_content())
        self.field().fill("3")
        self.assert_ready()

    def test_denied_fallback_can_be_retried(self):
        self.open_prompt()
        self.button.click()
        self.page.evaluate("clipboardHarness.fallbackMode = 'deny'")
        self.settle(reject=True)
        self.assertIn("Copy failed:", self.status.text_content())
        self.assertFalse(self.button.is_disabled())
        self.assertEqual(self.page.locator(".clipboard-fallback").count(), 0)
        self.button.click()
        self.settle(index=1)
        self.assertEqual(self.button.text_content(), "Copied")

    def test_throwing_fallback_removes_temporary_field(self):
        self.open_prompt()
        self.button.click()
        self.page.evaluate("clipboardHarness.fallbackMode = 'throw'")
        self.settle(reject=True)
        self.assertEqual(self.page.locator(".clipboard-fallback").count(), 0)
        self.assertIn("test copy exception", self.status.text_content())
        self.assertFalse(self.button.is_disabled())

    def test_fallback_uses_modal_selection_and_restores_input_selection(self):
        self.open_prompt()
        self.field().evaluate("el => { el.focus(); el.setSelectionRange(1, 4, 'backward'); }")
        self.page.keyboard.press("Control+Enter")
        self.settle(reject=True)
        self.assertEqual(self.page.evaluate("clipboardHarness.fallbackCalls"), [{
            "insideDialog": True, "focused": True, "selected": "Hello Alice",
        }])
        self.assertEqual(self.field().evaluate("""el => [
          document.activeElement === el, el.selectionStart, el.selectionEnd, el.selectionDirection
        ]"""), [True, 1, 4, "backward"])
        self.assertEqual(self.page.locator(".clipboard-fallback").count(), 0)

    def test_absent_clipboard_api_uses_modal_fallback(self):
        self.open_prompt(3)
        self.page.evaluate("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
        self.button.click()
        self.assertEqual(self.page.evaluate("clipboardHarness.fallbackCalls"), [{
            "insideDialog": True, "focused": True, "selected": "Notes: Hello\nworld",
        }])
        self.assertEqual(self.button.text_content(), "Copied")
        self.assertEqual(self.request_texts(), [])

    def test_successful_api_receives_unicode_rendered_text(self):
        self.open_prompt()
        self.field().fill("日本語 🐈")
        self.page.evaluate("clipboardHarness.useImmediateAPI()")
        self.button.click()
        self.page.wait_for_function("document.querySelector('#dialogCopy').textContent === 'Copied'")
        self.assertEqual(self.page.evaluate("clipboardHarness.immediateWrites"), ["Hello 日本語 🐈"])
        self.assertEqual(self.page.evaluate("clipboardHarness.fallbackCalls"), [])


if __name__ == "__main__":
    unittest.main()
