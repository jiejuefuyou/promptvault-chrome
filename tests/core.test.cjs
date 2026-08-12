const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

test('extracts and validates the legacy bundled prompt payload without executing it', () => {
  const source = 'const PROMPTS = [{"title":"One","body":"Hello {{name}}","tags":[" Work ","Work"]}];\n\nconst els = {};';
  const prompts = core.extractBundledPrompts(source);
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0], {
    title: 'One',
    body: 'Hello {{name}}',
    tags: ['Work'],
  });
  assert.ok(Object.isFrozen(prompts));
  assert.ok(Object.isFrozen(prompts[0]));
});

test('rejects malformed or empty bundled libraries', () => {
  assert.throws(() => core.extractBundledPrompts('const X = [];'), /marker/);
  assert.throws(() => core.extractBundledPrompts('const PROMPTS = [];\n\nconst els = {};'), /size/);
  assert.throws(() => core.extractBundledPrompts('const PROMPTS = nope;\n\nconst els = {};'), /valid JSON/);
});

test('parses typed variables, defaults, unknown types, and first occurrence wins', () => {
  const vars = core.parseVariables('A {{ count:int=5 }} B {{notes:multiline=}} C {{name:weird=Sam}} D {{count:string=8}}');
  assert.deepEqual(vars.map(({ name, type, defaultValue }) => ({ name, type, defaultValue })), [
    { name: 'count', type: 'int', defaultValue: '5' },
    { name: 'notes', type: 'multiline', defaultValue: '' },
    { name: 'name', type: 'string', defaultValue: 'Sam' },
  ]);
});

test('renders by bare variable name and preserves unresolved placeholders', () => {
  const body = 'Give {{count:int=5}} ideas about {{topic}}. Notes: {{notes:multiline=}}';
  assert.equal(
    core.renderPrompt(body, { count: '3', topic: 'cats' }),
    'Give 3 ideas about cats. Notes: '
  );
  assert.equal(
    core.renderPrompt(body, {}),
    'Give 5 ideas about {{topic}}. Notes: '
  );
  assert.deepEqual(core.unresolvedVariables(body, {}).map((v) => v.name), ['topic']);
});

test('search is diacritic-insensitive, multi-term, CJK-safe, and title-weighted', () => {
  const prompts = core.normalizePromptLibrary([
    { title: 'Résumé review', body: 'Improve a CV', tags: ['Career'] },
    { title: 'Career helper', body: 'Review a resume carefully', tags: ['Writing'] },
    { title: '中文周报', body: '生成工作总结', tags: ['效率'] },
  ]);
  assert.equal(core.searchPrompts(prompts, 'resume review')[0].title, 'Résumé review');
  assert.deepEqual(core.searchPrompts(prompts, '中文 效率').map((p) => p.title), ['中文周报']);
  assert.equal(core.searchPrompts(prompts, 'missing').length, 0);
  assert.equal(core.searchPrompts(prompts, '').length, 3);
});

test('normalization rejects invalid prompt records and removes empty duplicate tags', () => {
  assert.throws(() => core.normalizePromptLibrary([{ title: '', body: 'x' }]), /title and body/);
  const [prompt] = core.normalizePromptLibrary([{ title: ' T ', body: ' B ', tags: ['', 'x', 'x', ' y '] }]);
  assert.deepEqual(prompt, { title: 'T', body: 'B', tags: ['x', 'y'] });
});
