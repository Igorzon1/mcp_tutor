import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { blockSchema } from '../src/schema.js';
import { demoSession } from '../src/demo.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-tutor-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await new Store(directory).init();
  return { store, directory };
}
const response = (block, extra) => ({ blockId: block.id, reasoning: 'Usei uma tag para cada papel do conteúdo.', confidence: 2, ...extra });

test('aula de exemplo completa: previsão, código, reflexão e transferência, com tentativas preservadas', async t => {
  const { store, directory } = await fixture(t);
  const session = await store.create(demoSession, true);
  const quiz = session.blocks[1];
  const wrong = await store.submit(session.id, response(quiz, { choice: 0 }));
  assert.equal(wrong.result.status, 'needs_work');
  assert.equal(store.get(session.id).blocks.length, 2);
  await store.hint(session.id, quiz.id);
  const correct = await store.submit(session.id, response(quiz, { choice: 1 }));
  assert.equal(correct.hintsUsed, 1);
  const exercise = store.get(session.id).blocks.at(-1);
  assert.equal(exercise.type, 'code');
  const empty = await store.submit(session.id, response(exercise, { answer: '<main><h1></h1><p></p><button>Vamos aprender</button></main>' }));
  assert.equal(empty.result.status, 'needs_work');
  const valid = await store.submit(session.id, response(exercise, { answer: '<main><h1>Igor</h1><p>Quero aprender HTML</p><button>Vamos aprender</button></main>' }));
  assert.equal(valid.result.status, 'passed');
  assert.equal(store.get(session.id).blocks.at(-2).type, 'diagram');
  const reflection = store.get(session.id).blocks.at(-1);
  const explanation = await store.submit(session.id, response(reflection, { answer: 'O CSS muda a aparência, não o papel semântico.' }));
  assert.equal(explanation.result.status, 'pending_review');
  const transfer = store.get(session.id).blocks.at(-1);
  assert.equal(transfer.stage, 'transfer');
  assert.equal(transfer.starterCode, '');
  await store.submit(session.id, response(transfer, { answer: '<main><h1>Estante aberta</h1><p>Livros para explorar</p><button>Explorar livros</button></main>' }));
  const count = store.get(session.id).blocks.length;
  await store.submit(session.id, response(quiz, { choice: 1 }));
  assert.equal(store.get(session.id).blocks.length, count, 'reenviar não duplica a próxima etapa');
  const reloaded = await new Store(directory).init();
  assert.deepEqual(reloaded.get(session.id), store.get(session.id));
});

test('dados do aluno não executam código e comentários HTML não satisfazem seletores', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'HTML', goal: 'Entender a estrutura' });
  const block = await store.addBlock(session.id, { type: 'code', title: 'Um título', prompt: 'Crie um título', checks: [{ label: 'Título em main', selector: 'main h1', kind: 'text_nonempty' }] });
  const attempt = await store.submit(session.id, response(block, { answer: '<!-- <main><h1>Falso</h1></main> --><script>throw new Error("Não executar")</script>' }));
  assert.equal(attempt.result.status, 'needs_work');
  await assert.rejects(store.addBlock(session.id, { type: 'code', title: 'Inválido', prompt: 'Teste', checks: [{ label: 'Inválido', selector: '[', kind: 'exists' }] }), /Seletor inválido/);
  assert.equal(store.get(session.id).blocks.length, 1);
});

test('respostas de quiz e dicas futuras ficam ocultas no painel', async t => {
  const { store } = await fixture(t);
  const session = await store.create(demoSession, true);
  const quiz = session.blocks[1];
  let publicQuiz = store.get(session.id, true).blocks[1];
  assert.equal(publicQuiz.correctIndex, undefined);
  assert.equal(publicQuiz.explanation, undefined);
  assert.equal(publicQuiz.hints.length, 0);
  await store.hint(session.id, quiz.id);
  publicQuiz = store.get(session.id, true).blocks[1];
  assert.equal(publicQuiz.hints.length, 1);
  assert.equal(publicQuiz.hintsRemaining, 0);
});

test('eventos aguardam respostas reais e avaliações preservam verificação automática', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'Conceitos', goal: 'Explicar uma decisão' });
  const block = await store.addBlock(session.id, { type: 'reflection', title: 'Explique', prompt: 'Por que essa solução?' });
  const cursor = store.get(session.id).revision;
  const waiting = store.getEvents(session.id, cursor, 2);
  const attempt = await store.submit(session.id, response(block, { answer: 'Pelo papel semântico do conteúdo.' }));
  const events = await waiting;
  assert.ok(events.events.some(event => event.attemptId === attempt.id));
  assert.equal(events.cursor, cursor + 1);
  await store.review(session.id, { attemptId: attempt.id, passed: true, feedback: 'Você distinguiu significado de aparência.' });
  const stored = store.get(session.id).attempts[0];
  assert.equal(stored.result.status, 'pending_review');
  assert.equal(stored.review.passed, true);
  assert.equal((await store.getEvents(session.id, store.get(session.id).revision, 0)).events.length, 0);
});

test('escritas concorrentes não perdem atividades, e dados corrompidos são preservados', async t => {
  const { store, directory } = await fixture(t);
  const session = await store.create({ title: 'Concorrência', goal: 'Preservar mensagens' });
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.message(session.id, `Mensagem ${index}`)));
  assert.equal(store.get(session.id).blocks.length, 12);
  const persisted = JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'));
  assert.equal(persisted.sessions[0].blocks.length, 12);
  await writeFile(join(directory, 'sessions.json'), 'arquivo interrompido');
  await assert.rejects(new Store(directory).init(), /arquivo foi preservado/);
  assert.equal(await readFile(join(directory, 'sessions.json'), 'utf8'), 'arquivo interrompido');
});

test('contratos rejeitam quiz inconsistente, conexões inexistentes e gráficos inválidos', () => {
  assert.equal(blockSchema.safeParse({ type: 'quiz', title: 'Q', prompt: 'Q', options: ['A', 'B'], correctIndex: 5, explanation: 'E' }).success, false);
  assert.equal(blockSchema.safeParse({ type: 'diagram', title: 'D', caption: 'D', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'b' }] }).success, false);
  assert.equal(blockSchema.safeParse({ type: 'chart', title: 'C', caption: 'C', points: [{ label: 'A', value: -1 }] }).success, false);
});
