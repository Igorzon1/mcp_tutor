import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { clampStudyWidth, studyBounds, installStudyResize, STUDY_WIDTH_KEY } from '../public/study-layout.js';

function fixture(saved = '420') {
  const { document, Event } = parseHTML('<html><body><div class="lesson-layout"></div><div id="study-resizer"></div></body></html>');
  let layoutWidth = 1284;
  const memory = new Map([[STUDY_WIDTH_KEY, saved]]);
  const window = new EventTarget();
  window.innerWidth = 1500;
  window.localStorage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const layout = document.querySelector('.lesson-layout');
  layout.getBoundingClientRect = () => ({ width: layoutWidth });
  const handle = document.querySelector('#study-resizer');
  let captured;
  handle.setPointerCapture = id => { captured = id; };
  handle.hasPointerCapture = id => captured === id;
  handle.releasePointerCapture = () => { captured = undefined; };
  handle.focus = () => {};
  const emit = (name, values = {}) => {
    const event = new Event(name);
    Object.assign(event, values);
    handle.dispatchEvent(event);
  };
  const installed = installStudyResize(document, window);
  return { handle, emit, memory, document, window, installed, setLayoutWidth: value => { layoutWidth = value; } };
}

test('painel usa limites que preservam espaço para o chat', () => {
  assert.deepEqual(studyBounds(1000), { min: 320, max: 608 });
  assert.equal(clampStudyWidth(1200, 1000), 608);
  assert.equal(clampStudyWidth(20, 1000), 320);
  assert.equal(clampStudyWidth('invalid', 1000), 420);
  assert.equal(clampStudyWidth(1000, 2000), 900);
});

test('arrastar para a esquerda amplia e salva a largura ao soltar', () => {
  const f = fixture();
  f.emit('pointerdown', { button: 0, pointerId: 1, clientX: 900 });
  f.emit('pointermove', { pointerId: 1, clientX: 740 });
  assert.equal(f.handle.getAttribute('aria-valuenow'), '580');
  assert.ok(f.document.body.classList.contains('resizing-study'));
  f.emit('pointerup', { pointerId: 1 });
  assert.equal(f.memory.get(STUDY_WIDTH_KEY), '580');
  assert.ok(!f.document.body.classList.contains('resizing-study'));
});

test('teclado, limites e duplo clique ajustam o divisor', () => {
  const f = fixture();
  f.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(f.handle.getAttribute('aria-valuenow'), '452');
  f.emit('keydown', { key: 'Home' });
  assert.equal(f.handle.getAttribute('aria-valuenow'), '320');
  f.emit('keydown', { key: 'End' });
  assert.equal(f.handle.getAttribute('aria-valuenow'), '892');
  f.emit('dblclick');
  assert.equal(f.handle.getAttribute('aria-valuenow'), '420');
});

test('reduzir a janela não apaga a preferência salva para telas largas', () => {
  const f = fixture('700');
  assert.equal(f.handle.getAttribute('aria-valuenow'), '700');
  f.setLayoutWidth(974);
  f.installed.refresh();
  assert.equal(f.handle.getAttribute('aria-valuenow'), '582');
  f.setLayoutWidth(1284);
  f.installed.refresh();
  assert.equal(f.handle.getAttribute('aria-valuenow'), '700');
});

test('tela pequena não inicia arraste e cancelamento libera captura', () => {
  const f = fixture();
  f.window.innerWidth = 800;
  f.emit('pointerdown', { button: 0, pointerId: 1, clientX: 500 });
  assert.ok(!f.document.body.classList.contains('resizing-study'));
  f.window.innerWidth = 1500;
  f.emit('pointerdown', { button: 0, pointerId: 2, clientX: 900 });
  f.emit('pointercancel', { pointerId: 2 });
  assert.ok(!f.document.body.classList.contains('resizing-study'));
});
