(function startPromptVault() {
  'use strict';

  const core = globalThis.PromptVaultCore;
  if (!core) throw new Error('PromptVaultCore failed to load.');

  const elements = {
    search: document.getElementById('search'),
    resultStatus: document.getElementById('resultStatus'),
    list: document.getElementById('list'),
    loading: document.getElementById('loading'),
    retry: document.getElementById('retry'),
    countLabels: document.querySelectorAll('[data-prompt-count]'),
    dialog: document.getElementById('promptDialog'),
    dialogTitle: document.getElementById('dialogTitle'),
    dialogBody: document.getElementById('dialogBody'),
    dialogStatus: document.getElementById('dialogStatus'),
    dialogClose: document.getElementById('dialogClose'),
    dialogBack: document.getElementById('dialogBack'),
    dialogCopy: document.getElementById('dialogCopy'),
  };

  const state = {
    prompts: [],
    visiblePrompts: [],
    activePrompt: null,
    activeTrigger: null,
    copyResetTimer: null,
    loading: false,
  };

  function runtimeURL(path) {
    const runtime = globalThis.chrome?.runtime ?? globalThis.browser?.runtime;
    return runtime?.getURL ? runtime.getURL(path) : path.replace(/^src\//, '');
  }

  async function loadPromptLibrary() {
    if (state.loading) return;
    state.loading = true;
    setLoadingState('loading');
    try {
      const response = await fetch(runtimeURL('src/popup.js'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Library request failed (${response.status}).`);
      const source = await response.text();
      state.prompts = core.extractBundledPrompts(source);
      state.visiblePrompts = [...state.prompts];
      elements.countLabels.forEach((label) => {
        label.textContent = String(state.prompts.length);
      });
      renderList();
      setLoadingState('ready');
      elements.search.disabled = false;
      elements.search.focus();
    } catch (error) {
      console.error(error);
      setLoadingState('error', error instanceof Error ? error.message : String(error));
    } finally {
      state.loading = false;
    }
  }

  function setLoadingState(mode, detail = '') {
    elements.loading.hidden = mode === 'ready';
    elements.list.hidden = mode !== 'ready';
    elements.retry.hidden = mode !== 'error';
    if (mode === 'loading') {
      elements.loading.textContent = 'Loading bundled prompt library…';
      elements.resultStatus.textContent = 'Loading prompts';
    } else if (mode === 'error') {
      elements.loading.textContent = `Could not open the bundled library. ${detail}`;
      elements.resultStatus.textContent = 'Prompt library unavailable';
    }
  }

  function renderList() {
    const fragment = document.createDocumentFragment();
    elements.list.replaceChildren();

    if (state.visiblePrompts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No prompts match this search.';
      fragment.append(empty);
    } else {
      state.visiblePrompts.forEach((prompt, index) => {
        fragment.append(createPromptButton(prompt, index));
      });
    }

    elements.list.append(fragment);
    const query = elements.search.value.trim();
    elements.resultStatus.textContent = query
      ? `${state.visiblePrompts.length} match${state.visiblePrompts.length === 1 ? '' : 'es'}`
      : `${state.prompts.length} prompts`;
  }

  function createPromptButton(prompt, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prompt';
    button.dataset.promptIndex = String(index);

    const title = document.createElement('span');
    title.className = 'prompt-title';
    title.textContent = prompt.title;

    const preview = document.createElement('span');
    preview.className = 'prompt-preview';
    preview.textContent = prompt.body.replace(/\s+/g, ' ').trim();

    const tags = document.createElement('span');
    tags.className = 'prompt-tags';
    prompt.tags.slice(0, 3).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      tags.append(chip);
    });

    button.append(title, preview, tags);
    button.addEventListener('click', () => openPrompt(prompt, button));
    button.addEventListener('keydown', handlePromptNavigation);
    return button;
  }

  function handlePromptNavigation(event) {
    const buttons = [...elements.list.querySelectorAll('.prompt')];
    const current = buttons.indexOf(event.currentTarget);
    if (current < 0) return;
    let next = null;
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
    if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  function openPrompt(prompt, trigger) {
    clearCopyTimer();
    state.activePrompt = prompt;
    state.activeTrigger = trigger;
    elements.dialogTitle.textContent = prompt.title;
    elements.dialogBody.replaceChildren();
    elements.dialogStatus.textContent = '';
    resetCopyButton();

    const variables = core.parseVariables(prompt.body);
    if (variables.length > 0) {
      const fields = document.createElement('div');
      fields.className = 'variable-fields';
      variables.forEach((variable) => fields.append(createVariableField(variable)));
      elements.dialogBody.append(fields, createPreview());
    } else {
      const preview = createPreview();
      preview.querySelector('pre').textContent = prompt.body;
      elements.dialogBody.append(preview);
    }

    updatePreview();
    elements.dialog.showModal();
    const firstInput = elements.dialogBody.querySelector('input, textarea');
    (firstInput ?? elements.dialogCopy).focus();
  }

  function createVariableField(variable) {
    const wrapper = document.createElement('div');
    wrapper.className = 'variable-field';

    const inputID = `variable-${variable.index}`;
    const label = document.createElement('label');
    label.htmlFor = inputID;
    label.textContent = variable.name;

    const meta = document.createElement('span');
    meta.className = 'variable-meta';
    meta.textContent = variable.defaultValue === null
      ? variable.type
      : `${variable.type} · default: ${variable.defaultValue || 'empty'}`;
    label.append(meta);

    const input = variable.type === 'multiline'
      ? document.createElement('textarea')
      : document.createElement('input');
    input.id = inputID;
    input.dataset.variableName = variable.name;
    input.dataset.variableType = variable.type;
    input.autocomplete = 'off';
    input.spellcheck = variable.type !== 'int';
    input.placeholder = variable.defaultValue ?? `Enter ${variable.name}…`;
    if (variable.defaultValue !== null) input.value = variable.defaultValue;
    if (input instanceof HTMLInputElement) {
      input.type = variable.type === 'int' ? 'number' : 'text';
      if (variable.type === 'int') {
        input.inputMode = 'numeric';
        input.step = '1';
      }
    }
    input.addEventListener('input', updatePreview);
    wrapper.append(label, input);
    return wrapper;
  }

  function createPreview() {
    const section = document.createElement('section');
    section.className = 'preview-section';
    const heading = document.createElement('h3');
    heading.textContent = 'Preview';
    const preview = document.createElement('pre');
    preview.id = 'renderedPreview';
    preview.className = 'preview-box';
    preview.tabIndex = 0;
    section.append(heading, preview);
    return section;
  }

  function currentValues() {
    const values = {};
    elements.dialogBody.querySelectorAll('[data-variable-name]').forEach((input) => {
      values[input.dataset.variableName] = input.value;
    });
    return values;
  }

  function currentRenderedText() {
    if (!state.activePrompt) return '';
    return core.renderPrompt(state.activePrompt.body, currentValues());
  }

  function updatePreview() {
    if (!state.activePrompt) return;
    const values = currentValues();
    const preview = elements.dialogBody.querySelector('#renderedPreview');
    if (preview) preview.textContent = core.renderPrompt(state.activePrompt.body, values);
    const invalidIntegers = [...elements.dialogBody.querySelectorAll('[data-variable-type="int"]')]
      .filter((input) => input.value.length > 0 && !/^-?\d+$/.test(input.value));
    const unresolved = core.unresolvedVariables(state.activePrompt.body, values);
    elements.dialogCopy.disabled = invalidIntegers.length > 0;
    if (invalidIntegers.length > 0) {
      elements.dialogStatus.textContent = 'Integer fields must contain whole numbers.';
    } else if (unresolved.length > 0) {
      elements.dialogStatus.textContent = `${unresolved.length} required variable${unresolved.length === 1 ? '' : 's'} still empty; placeholders will be preserved.`;
    } else {
      elements.dialogStatus.textContent = 'Ready to copy';
    }
  }

  async function copyCurrentPrompt() {
    if (!state.activePrompt || elements.dialogCopy.disabled) return;
    const text = currentRenderedText();
    elements.dialogCopy.disabled = true;
    try {
      await writeClipboard(text);
      elements.dialogCopy.classList.add('copied');
      elements.dialogCopy.textContent = 'Copied';
      elements.dialogStatus.textContent = 'Copied to clipboard.';
      clearCopyTimer();
      state.copyResetTimer = window.setTimeout(() => {
        resetCopyButton();
        updatePreview();
      }, 1400);
    } catch (error) {
      elements.dialogStatus.textContent = `Copy failed: ${error instanceof Error ? error.message : String(error)}`;
      elements.dialogCopy.disabled = false;
    }
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn('Clipboard API failed; using selection fallback.', error);
      }
    }

    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.className = 'clipboard-fallback';
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) throw new Error('The browser denied clipboard access.');
  }

  function resetCopyButton() {
    elements.dialogCopy.disabled = false;
    elements.dialogCopy.classList.remove('copied');
    elements.dialogCopy.textContent = 'Copy to clipboard';
  }

  function closeDialog() {
    if (!elements.dialog.open) return;
    clearCopyTimer();
    elements.dialog.close();
    const trigger = state.activeTrigger;
    state.activePrompt = null;
    state.activeTrigger = null;
    elements.dialogBody.replaceChildren();
    trigger?.focus();
  }

  function clearCopyTimer() {
    if (state.copyResetTimer !== null) {
      window.clearTimeout(state.copyResetTimer);
      state.copyResetTimer = null;
    }
  }

  function handleSearch() {
    state.visiblePrompts = core.searchPrompts(state.prompts, elements.search.value);
    renderList();
    elements.list.scrollTop = 0;
  }

  elements.search.addEventListener('input', handleSearch);
  elements.retry.addEventListener('click', loadPromptLibrary);
  elements.dialogCopy.addEventListener('click', copyCurrentPrompt);
  elements.dialogClose.addEventListener('click', closeDialog);
  elements.dialogBack.addEventListener('click', closeDialog);
  elements.dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  elements.dialog.addEventListener('click', (event) => {
    if (event.target === elements.dialog) closeDialog();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && elements.dialog.open) {
      event.preventDefault();
      void copyCurrentPrompt();
      return;
    }
    if (event.key === '/' && !elements.dialog.open) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        elements.search.focus();
      }
    }
  });

  elements.search.disabled = true;
  void loadPromptLibrary();
})();
