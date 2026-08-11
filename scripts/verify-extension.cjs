const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const html = read('src/popup.html');
const app = read('src/app.js');
const coreSource = read('src/core.js');
const legacyBundle = read('src/popup.js');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '1.1.0');
assert.deepEqual(manifest.permissions, ['clipboardWrite']);
assert.ok(!('host_permissions' in manifest), 'Extension must not request host permissions.');
assert.ok(!manifest.permissions.includes('storage'), 'Unused storage permission must not return.');
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
assert.ok(!/\b113\b/.test(manifest.description), 'Manifest copy must not hard-code the prompt count.');

assert.match(html, /<script src="core\.js"><\/script>\s*<script src="app\.js"><\/script>/);
assert.ok(!html.includes('<script src="popup.js"></script>'), 'Legacy popup implementation must never execute.');
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'Inline scripts are forbidden by MV3 CSP.');
for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) {
  assert.match(match[0], /rel="[^"]*noopener[^"]*"/i, 'External links must use rel=noopener.');
}

for (const [name, source] of [['src/core.js', coreSource], ['src/app.js', app]]) {
  assert.ok(!/\beval\s*\(|new Function\s*\(|document\.write\s*\(|\.innerHTML\s*=|insertAdjacentHTML\s*\(/.test(source), `${name} uses an unsafe DOM/code primitive.`);
  assert.ok(!/https?:\/\//.test(source), `${name} must not make remote requests.`);
}

const prompts = core.extractBundledPrompts(legacyBundle);
assert.ok(prompts.length >= 20, 'Bundled library unexpectedly small.');
assert.equal(new Set(prompts.map((prompt) => `${prompt.title}\u0000${prompt.body}`)).size, prompts.length, 'Bundled library contains exact duplicate prompts.');

for (const requiredID of ['search', 'resultStatus', 'list', 'loading', 'retry', 'promptDialog', 'dialogTitle', 'dialogBody', 'dialogStatus', 'dialogClose', 'dialogBack', 'dialogCopy']) {
  assert.ok(html.includes(`id="${requiredID}"`), `Missing required DOM id: ${requiredID}`);
}

console.log(`✅ Extension contract passed with ${prompts.length} bundled prompts and minimal permissions.`);
