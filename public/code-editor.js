const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

function htmlContext(text) {
  let mode = 'text';
  let quote = null;
  let tagStart = -1;
  let rawName = '';
  let lastOpen = null;
  for (let i = 0; i < text.length; i += 1) {
    if (mode === 'comment') {
      if (text.startsWith('-->', i)) { mode = 'text'; i += 2; }
      continue;
    }
    if (mode === 'raw') {
      if (text[i] === '<' && new RegExp(`^</${rawName}(?:\\s|>)`, 'i').test(text.slice(i))) {
        mode = 'tag'; tagStart = i;
      }
      continue;
    }
    if (mode === 'text') {
      if (text.startsWith('<!--', i)) { mode = 'comment'; i += 3; }
      else if (text[i] === '<') { mode = 'tag'; tagStart = i; }
      continue;
    }
    if (quote) { if (text[i] === quote) quote = null; continue; }
    if (text[i] === '"' || text[i] === "'") { quote = text[i]; continue; }
    if (text[i] === '>') {
      const tag = text.slice(tagStart, i + 1);
      const match = tag.match(/^<([a-z][\w:-]*)(?:\s[\s\S]*)?>$/i);
      mode = 'text';
      if (match && !/\/\s*>$/.test(tag) && !VOID_TAGS.has(match[1].toLowerCase())) {
        lastOpen = { name: match[1], end: i + 1 };
        if (RAW_TAGS.has(match[1].toLowerCase())) { mode = 'raw'; rawName = match[1].toLowerCase(); }
      }
    }
  }
  return { mode, quote, tag: tagStart < 0 ? '' : text.slice(tagStart), lastOpen };
}

// A small lexical guard, not a language server. Avoid pairing in strings,
// comments and regex literals; leave paste and composition to the browser.
function jsContext(text) {
  let mode = 'code';
  let quote = null;
  let escaped = false;
  let regexClass = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue; }
    if (mode === 'comment') { if (text.startsWith('*/', i)) { mode = 'code'; i += 1; } continue; }
    if (mode === 'string' || mode === 'regex') {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (mode === 'regex') {
        if (char === '[') regexClass = true;
        if (char === ']') regexClass = false;
        if (char === '/' && !regexClass) mode = 'code';
      } else if (char === quote) { mode = 'code'; quote = null; }
      continue;
    }
    if (text.startsWith('//', i)) { mode = 'line'; i += 1; }
    else if (text.startsWith('/*', i)) { mode = 'comment'; i += 1; }
    else if ('"\'`'.includes(char)) { mode = 'string'; quote = char; }
    else if (char === '/' && /(?:^|[=(:,[!&|?{};]|\breturn|\bcase|=>)\s*$/.test(text.slice(0, i))) mode = 'regex';
  }
  return { mode, quote, escaped };
}

/** Return a range edit and absolute selection, or null for native editing. */
export function completionEdit({ value, start, end = start, key, language = 'html' }) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);
  const edit = (text, from = start, to = end, cursor = from + text.length, selectionEnd = cursor) => ({ from, to, text, start: cursor, end: selectionEnd });
  const html = language === 'html' ? htmlContext(before) : null;
  const js = language === 'javascript' ? jsContext(before) : null;

  if (key === '>' && !selected && html?.mode === 'tag' && !html.quote) {
    const tag = html.tag.match(/^<([a-z][\w:-]*)(?:\s[\s\S]*)?$/i);
    if (tag && !/\/\s*$/.test(html.tag) && !VOID_TAGS.has(tag[1].toLowerCase())
      && !new RegExp(`^\\s*</${tag[1]}\\s*>`, 'i').test(after)) {
      return edit(`></${tag[1]}>`, start, end, start + 1);
    }
  }

  if (key === 'Enter') {
    const indent = before.slice(before.lastIndexOf('\n') + 1).match(/^[\t ]*/)[0];
    const pairedTag = html?.lastOpen?.end === start
      && new RegExp(`^</${html.lastOpen.name}\\s*>`, 'i').test(after);
    const pairedBrackets = js?.mode === 'code' && /[([{]$/.test(before) && after.startsWith(PAIRS[before.at(-1)]);
    if (pairedTag || pairedBrackets) return edit(`\n${indent}  \n${indent}`, start, end, start + indent.length + 3);
    if (js?.mode === 'code' && /[([{]$/.test(before)) return edit(`\n${indent}  `);
    if (indent) return edit(`\n${indent}`);
    return null;
  }

  if (key === 'Backspace' && !selected && before.length && after.length && PAIRS[before.at(-1)] === after[0]) {
    const left = before.at(-1);
    const previous = language === 'javascript' ? jsContext(before.slice(0, -1)) : null;
    const inAttribute = html?.mode === 'tag' && html.quote === left;
    if (previous?.mode === 'code' || inAttribute) return edit('', start - 1, end + 1);
  }

  const quote = '"\'`'.includes(key) && key.length === 1;
  if (!selected && after.startsWith(key)) {
    const closingQuote = quote && ((js?.mode === 'string' && js.quote === key && !js.escaped) || (html?.mode === 'tag' && html.quote === key));
    if (closingQuote || (js?.mode === 'code' && ')]}'.includes(key) && key.length === 1)) return edit('', start, start, start + 1);
  }

  if (Object.hasOwn(PAIRS, key)) {
    const inCode = js?.mode === 'code';
    const attributeQuote = html?.mode === 'tag' && !html.quote && quote && key !== '`' && /=\s*$/.test(before);
    if (!inCode && !attributeQuote) return null;
    if (quote && !selected && /[\w$]/.test(after[0] || '')) return null;
    return edit(key + selected + PAIRS[key], start, end, start + 1, start + 1 + selected.length);
  }
  return null;
}

export function installCodeEditor(editor, { language = 'html' } = {}) {
  const doc = editor.ownerDocument;
  const emitInput = () => editor.dispatchEvent(new Event('input', { bubbles: true }));
  let fallbackHistory = null;
  const nativeSelections = [];
  let replaying = false;
  let previous = snapshot();
  function snapshot() { return { value: editor.value, start: editor.selectionStart, end: editor.selectionEnd }; }
  function remember() {
    const next = snapshot();
    if (!replaying && fallbackHistory && next.value !== previous.value) {
      fallbackHistory.undo.push(previous);
      if (fallbackHistory.undo.length > 100) fallbackHistory.undo.shift();
      fallbackHistory.redo = [];
    }
    previous = next;
  }
  function replace(change) {
    if (change.text.length + editor.value.length - (change.to - change.from) > editor.maxLength && editor.maxLength >= 0) return false;
    previous = snapshot();
    if (change.text === '' && change.from === change.to) {
      editor.setSelectionRange(change.start, change.end);
      return true;
    }
    editor.setSelectionRange(change.from, change.to);
    const oldValue = editor.value;
    // insertText participates in native undo in Chromium. A bounded fallback
    // history keeps Ctrl/Cmd+Z working on browsers without that capability.
    let inserted = false;
    if (!fallbackHistory) {
      try { inserted = doc.execCommand?.('insertText', false, change.text) === true; } catch { /* fallback below */ }
    }
    if (!inserted && editor.value === oldValue) {
      fallbackHistory ||= { undo: [], redo: [] };
      editor.setRangeText(change.text, change.from, change.to, 'end');
      emitInput();
    }
    editor.setSelectionRange(change.start, change.end);
    if (!fallbackHistory) {
      nativeSelections.push(snapshot());
      if (nativeSelections.length > 20) nativeSelections.shift();
    }
    return true;
  }
  editor.addEventListener('input', event => {
    if (!fallbackHistory && ['historyUndo', 'historyRedo'].includes(event.inputType)) {
      const completed = nativeSelections.findLast(state => state.value === editor.value);
      if (completed) editor.setSelectionRange(completed.start, completed.end);
    }
    remember();
  });
  // Capture the pre-edit selection for fallback undo, including paste/cut.
  editor.addEventListener('beforeinput', () => { previous = snapshot(); });
  editor.addEventListener('keydown', event => {
    if (editor.disabled || editor.readOnly || event.isComposing || event.keyCode === 229 || event.altKey) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && fallbackHistory && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      const redo = event.key.toLowerCase() === 'y' || event.shiftKey;
      const from = redo ? fallbackHistory.redo : fallbackHistory.undo;
      const to = redo ? fallbackHistory.undo : fallbackHistory.redo;
      const state = from.pop();
      event.preventDefault();
      if (state) {
        to.push(snapshot()); replaying = true;
        editor.value = state.value; editor.setSelectionRange(state.start, state.end);
        emitInput(); replaying = false;
      }
      return;
    }
    if (modifier && event.key === ']') {
      if (replace({ from: editor.selectionStart, to: editor.selectionEnd, text: '  ', start: editor.selectionStart + 2, end: editor.selectionStart + 2 })) event.preventDefault();
      return;
    }
    if (modifier) return;
    const change = completionEdit({ value: editor.value, start: editor.selectionStart, end: editor.selectionEnd, key: event.key, language });
    if (change && replace(change)) event.preventDefault();
    // Tab intentionally keeps normal focus navigation; never trap the learner.
  });
}
