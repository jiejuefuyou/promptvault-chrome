(function attachPromptVaultCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PromptVaultCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptVaultCore() {
  'use strict';

  const VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;
  const ALLOWED_TYPES = new Set(['string', 'int', 'multiline']);
  const MAX_PROMPTS = 5000;

  function parseVariableToken(rawToken) {
    const raw = String(rawToken ?? '').trim();
    const colon = raw.indexOf(':');
    const name = (colon >= 0 ? raw.slice(0, colon) : raw).trim();
    if (!name) return null;

    let type = 'string';
    let defaultValue = null;
    if (colon >= 0) {
      const descriptor = raw.slice(colon + 1).trim();
      const equals = descriptor.indexOf('=');
      const requestedType = (equals >= 0 ? descriptor.slice(0, equals) : descriptor).trim();
      type = ALLOWED_TYPES.has(requestedType) ? requestedType : 'string';
      if (equals >= 0) defaultValue = descriptor.slice(equals + 1);
    }

    return { name, type, defaultValue, raw };
  }

  function parseVariables(body) {
    const text = String(body ?? '');
    const seen = new Set();
    const variables = [];
    VARIABLE_PATTERN.lastIndex = 0;
    let match;
    while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
      const variable = parseVariableToken(match[1]);
      if (!variable || seen.has(variable.name)) continue;
      seen.add(variable.name);
      variables.push({
        ...variable,
        placeholder: match[0],
        index: variables.length,
      });
    }
    return variables;
  }

  function renderPrompt(body, values = {}) {
    const source = String(body ?? '');
    VARIABLE_PATTERN.lastIndex = 0;
    return source.replace(VARIABLE_PATTERN, (placeholder, rawToken) => {
      const variable = parseVariableToken(rawToken);
      if (!variable) return placeholder;
      const supplied = Object.prototype.hasOwnProperty.call(values, variable.name)
        ? String(values[variable.name] ?? '')
        : '';
      if (supplied.length > 0) return supplied;
      if (variable.defaultValue !== null) return variable.defaultValue;
      return placeholder;
    });
  }

  function unresolvedVariables(body, values = {}) {
    return parseVariables(body).filter((variable) => {
      const supplied = Object.prototype.hasOwnProperty.call(values, variable.name)
        ? String(values[variable.name] ?? '')
        : '';
      return supplied.length === 0 && variable.defaultValue === null;
    });
  }

  function normalizeForSearch(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizePrompt(raw, index = 0) {
    if (!raw || typeof raw !== 'object') {
      throw new TypeError(`Prompt ${index + 1} is not an object.`);
    }
    const title = String(raw.title ?? '').trim();
    const body = String(raw.body ?? '').trim();
    if (!title || !body) {
      throw new TypeError(`Prompt ${index + 1} must contain a title and body.`);
    }
    const tags = Array.isArray(raw.tags)
      ? [...new Set(raw.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [];
    return Object.freeze({ title, body, tags });
  }

  function normalizePromptLibrary(rawPrompts) {
    if (!Array.isArray(rawPrompts)) throw new TypeError('Prompt library must be an array.');
    if (rawPrompts.length === 0 || rawPrompts.length > MAX_PROMPTS) {
      throw new RangeError(`Prompt library size must be between 1 and ${MAX_PROMPTS}.`);
    }
    return Object.freeze(rawPrompts.map(normalizePrompt));
  }

  function extractBundledPrompts(source) {
    const text = String(source ?? '');
    const prefix = 'const PROMPTS = ';
    const start = text.indexOf(prefix);
    if (start < 0) throw new Error('Bundled prompt marker was not found.');

    const jsonStart = start + prefix.length;
    const appMarker = text.indexOf('\n\nconst els =', jsonStart);
    const fallbackEnd = text.indexOf(';\n', jsonStart);
    const end = appMarker >= 0 ? appMarker : fallbackEnd;
    if (end < 0) throw new Error('Bundled prompt payload terminator was not found.');

    const json = text.slice(jsonStart, end).trim().replace(/;$/, '');
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(`Bundled prompt payload is not valid JSON: ${error.message}`);
    }
    return normalizePromptLibrary(parsed);
  }

  function promptSearchDocument(prompt) {
    return normalizeForSearch([
      prompt.title,
      prompt.tags.join(' '),
      prompt.body,
    ].join(' '));
  }

  function scorePrompt(prompt, terms) {
    const title = normalizeForSearch(prompt.title);
    const tags = normalizeForSearch(prompt.tags.join(' '));
    const body = normalizeForSearch(prompt.body);
    let score = 0;
    for (const term of terms) {
      if (title === term) score += 100;
      else if (title.startsWith(term)) score += 50;
      else if (title.includes(term)) score += 30;
      if (tags.includes(term)) score += 15;
      if (body.includes(term)) score += 5;
    }
    return score;
  }

  function searchPrompts(prompts, query) {
    const normalized = normalizeForSearch(query);
    if (!normalized) return [...prompts];
    const terms = normalized.split(' ').filter(Boolean);
    return prompts
      .map((prompt, index) => ({
        prompt,
        index,
        document: promptSearchDocument(prompt),
      }))
      .filter((item) => terms.every((term) => item.document.includes(term)))
      .map((item) => ({ ...item, score: scorePrompt(item.prompt, terms) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.prompt);
  }

  return Object.freeze({
    extractBundledPrompts,
    normalizeForSearch,
    normalizePromptLibrary,
    parseVariableToken,
    parseVariables,
    renderPrompt,
    searchPrompts,
    unresolvedVariables,
  });
});
