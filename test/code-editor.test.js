import test from 'node:test';
import assert from 'node:assert/strict';
import { completionEdit, installCodeEditor } from '../public/code-editor.js';

function type(marked, key, language = 'html') {
  const start = marked.indexOf('|');
  const value = marked.replace('|', '');
  const change = completionEdit({ value, start, key, language });
  if (!change) return null;
  const result = value.slice(0, change.from) + change.text + value.slice(change.to);
  return result.slice(0, change.start) + '|' + result.slice(change.start);
}

test('fecha tags HTML e mantém cursor dentro do elemento, inclusive atributos e custom elements', () => {
  for (const [source, result] of [
    ['<div|', '<div>|</div>'],
    ['<div><span|</div>', '<div><span>|</span></div>'],
    ['<DIV class="card"|', '<DIV class="card">|</DIV>'],
    ['<my-card data-id="1"|', '<my-card data-id="1">|</my-card>'],
    ['<div title="a > b"|', '<div title="a > b">|</div>'],
  ]) assert.equal(type(source, '>'), result);
});

test('não inventa fechamentos para void, comentários, atributos incompletos ou tag já fechada', () => {
  for (const source of ['<img|', '<BR|', '<input type="text"|', '<div /|', '</div|', '<!DOCTYPE html|', '<!-- <div|', '<div title="a|', '<div|</div>', '<div|\n</DIV>', '<script>const x = "<div|', '<textarea><div|']) {
    assert.equal(type(source, '>'), null, source);
  }
});

test('HTML completa e atravessa aspas de atributos sem alterar texto comum', () => {
  assert.equal(type('<div class=|', '"'), '<div class="|"');
  assert.equal(type('<div class="card|"', '"'), '<div class="card"|');
  assert.equal(type('<div class="|"', 'Backspace'), '<div class=|');
  for (const source of ['Texto|', '<p>Texto|', '<!-- class=|', '<div class="valor|']) assert.equal(type(source, '"'), null);
});

test('JavaScript completa pares, atravessa fechamentos e apaga um par vazio', () => {
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"], ['`', '`']]) {
    assert.equal(type('const x = |', open, 'javascript'), `const x = ${open}|${close}`);
    assert.equal(type(`const x = ${open}|${close}`, close, 'javascript'), `const x = ${open}${close}|`);
    assert.equal(type(`const x = ${open}|${close}`, 'Backspace', 'javascript'), 'const x = |');
  }
  assert.equal(type('|', 'Backspace', 'javascript'), null);
  assert.equal(type('x|', 'Backspace', 'javascript'), null);
});

test('não completa pares JS dentro de strings, comentários e regex nem aspas escapadas', () => {
  for (const source of ['// comentário |', '/* comentário |', 'const s = "texto|', 'const s = `texto|', 'const r = /[a-z|']) {
    assert.equal(type(source, '(', 'javascript'), null, source);
  }
  assert.equal(type('const s = "texto\\|"', '"', 'javascript'), null);
  assert.equal(type('// exemplo\nconst x = |', '(', 'javascript'), '// exemplo\nconst x = (|)');
});

test('Enter recua dentro de tags e pares sem perder o fechamento', () => {
  assert.equal(type('  <div>|</div>', 'Enter'), '  <div>\n    |\n  </div>');
  assert.equal(type('function f() {|}', 'Enter', 'javascript'), 'function f() {\n  |\n}');
  assert.equal(type('  const x = 1;|', 'Enter', 'javascript'), '  const x = 1;\n  |');
  assert.equal(type('<br>|', 'Enter'), null);
});

test('envolve seleção sem apagar o conteúdo; Tab continua nativo', () => {
  assert.deepEqual(completionEdit({ value: 'const x = nome;', start: 10, end: 14, key: '"', language: 'javascript' }), { from: 10, to: 14, text: '"nome"', start: 11, end: 15 });
  assert.equal(completionEdit({ value: '<div></div>', start: 5, key: 'Tab' }), null);
});

class Editor extends EventTarget {
  constructor(value = '') {
    super(); this.value = value; this.selectionStart = value.length; this.selectionEnd = value.length;
    this.maxLength = 50000; this.ownerDocument = {}; this.disabled = false; this.readOnly = false;
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.setSelectionRange(start + text.length, start + text.length);
  }
  key(key, properties = {}) {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, ...properties }); this.dispatchEvent(event); return event;
  }
}

test('adapter emite input para rascunho/testes e suporta undo/redo quando não há edição nativa', () => {
  const editor = new Editor('<div');
  let inputs = 0;
  editor.addEventListener('input', () => inputs++);
  installCodeEditor(editor);
  assert.equal(editor.key('>').defaultPrevented, true);
  assert.equal(editor.value, '<div></div>');
  assert.equal(editor.selectionStart, 5);
  assert.equal(inputs, 1);
  editor.key('z', { ctrlKey: true });
  assert.equal(editor.value, '<div');
  editor.key('z', { metaKey: true, shiftKey: true });
  assert.equal(editor.value, '<div></div>');
  assert.equal(inputs, 3);
});

test('adapter preserva Tab, composição, somente leitura e limite de caracteres', () => {
  const editor = new Editor('<div');
  installCodeEditor(editor);
  for (const properties of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { ctrlKey: true }]) assert.equal(editor.key('>', properties).defaultPrevented, false);
  editor.disabled = true;
  assert.equal(editor.key('>').defaultPrevented, false);
  editor.disabled = false; editor.readOnly = true;
  assert.equal(editor.key('>').defaultPrevented, false);
  editor.readOnly = false; editor.maxLength = 6;
  assert.equal(editor.key('>').defaultPrevented, false);
  assert.equal(editor.key('Tab').defaultPrevented, false);
  assert.equal(editor.value, '<div');
});

test('adapter usa undo nativo quando disponível e inclui input de colagem no fallback', () => {
  const native = new Editor('<div');
  native.ownerDocument.execCommand = (command, ui, text) => {
    assert.equal(command, 'insertText');
    native.setRangeText(text, native.selectionStart, native.selectionEnd);
    native.dispatchEvent(new Event('input')); return true;
  };
  installCodeEditor(native);
  native.key('>');
  assert.equal(native.value, '<div></div>');
  assert.equal(native.key('z', { ctrlKey: true }).defaultPrevented, false);
  native.setSelectionRange(11, 11);
  const redoEvent = new Event('input');
  Object.assign(redoEvent, { inputType: 'historyRedo' });
  native.dispatchEvent(redoEvent);
  assert.equal(native.selectionStart, 5);
  const fallback = new Editor('<div');
  installCodeEditor(fallback); fallback.key('>');
  fallback.dispatchEvent(new Event('beforeinput'));
  fallback.setRangeText('Olá', 5, 5); fallback.dispatchEvent(new Event('input'));
  fallback.key('z', { ctrlKey: true });
  assert.equal(fallback.value, '<div></div>');
  fallback.key('z', { ctrlKey: true });
  assert.equal(fallback.value, '<div');
});
