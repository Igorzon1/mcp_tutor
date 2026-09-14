import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { DAY, nextReview } from '../src/learning.js';
import { programmingDemo } from '../src/programming-demos.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'atelie-learning-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: await new Store(directory).init() };
}
test('revisão esconde referência até a tentativa e agenda nova prática apenas após autoavaliação', async t => {
  const { store, directory } = await fixture(t);
  const session = await store.create({ title: 'Python', goal: 'Entender números' });
  const card = await store.scheduleReview(session.id, { concept: 'Conversão', prompt: 'Por que int(input())?', referenceAnswer: 'Converte o texto recebido em inteiro.', dueAt: new Date(Date.now() - DAY).toISOString() });
  assert.equal(store.getReviews(session.id, true)[0].referenceAnswer, undefined);
  assert.equal(store.get(session.id, true).summary.reviewsDue, 1);
  await assert.rejects(store.rateRecall(session.id, card.id, { rating: 'remembered' }), /Envie uma nova resposta/);
  const retrieved = await store.recall(session.id, card.id, { answer: 'Para fazer contas com o número.' });
  assert.equal(retrieved.referenceAnswer, 'Converte o texto recebido em inteiro.');
  await assert.rejects(store.recall(session.id, card.id, { answer: 'Outra resposta.' }), /autoavaliação primeiro/);
  const rated = await store.rateRecall(session.id, card.id, { rating: 'remembered' });
  assert.equal(rated.intervalDays, 3);
  assert.equal(rated.referenceAnswer, undefined);
  assert.equal(store.get(session.id).summary.reviewsDue, 0);
  await assert.rejects(store.rateRecall(session.id, card.id, { rating: 'remembered' }), /Envie uma nova resposta/);
  const reloaded = await new Store(directory).init();
  assert.equal(reloaded.getReviews(session.id)[0].attempts[0].rating, 'remembered');
});
test('intervalos têm limites determinísticos e voltam ao começo quando a pessoa precisa retomar', () => {
  const date = Date.UTC(2026, 8, 14, 15);
  assert.deepEqual(nextReview({ step: 4 }, 'again', date), { step: 0, intervalDays: 1, dueAt: new Date(date + DAY).toISOString() });
  assert.equal(nextReview({ step: 4 }, 'remembered', date).intervalDays, 30);
  assert.equal(nextReview({ step: 2 }, 'partial', date).intervalDays, 3);
});
test('aulas da versão anterior são retomadas sem perder blocos ou respostas', async t => {
  const { directory } = await fixture(t);
  const old = { id: '71f17e6b-df9a-41e1-9c63-c8d55e5b85f1', title: 'Aula existente', goal: 'Preservar', mode: 'demo', revision: 0, blocks: [], attempts: [], events: [], advanced: [] };
  await writeFile(join(directory, 'sessions.json'), JSON.stringify({ version: 1, sessions: [old] }));
  const reloaded = await new Store(directory).init();
  assert.equal(reloaded.get('71f17e6b-df9a-41e1-9c63-c8d55e5b85f1').title, 'Aula existente');
  assert.deepEqual(reloaded.get('71f17e6b-df9a-41e1-9c63-c8d55e5b85f1').reviews, []);
  assert.deepEqual(reloaded.get('71f17e6b-df9a-41e1-9c63-c8d55e5b85f1').attempts, []);
});
test('exercício Python é avaliado com entradas novas, preserva saída e não aceita um print fixo', async t => {
  const { store } = await fixture(t);
  const capabilities = await store.runner.capabilities();
  if (!capabilities.languages.find(runtime => runtime.id === 'python').available) { t.skip(capabilities.sandbox.reason || 'Python indisponível'); return; }
  const session = await store.create({ title: 'Dobro', goal: 'Transformar entradas' });
  const block = await store.addBlock(session.id, { ...programmingDemo('python').practice, stage: 'predict' });
  const input = { blockId: block.id, reasoning: 'Multiplicar a entrada por dois.', confidence: 2 };
  const hardcoded = await store.submit(session.id, { ...input, answer: 'print(6)' });
  assert.equal(hardcoded.result.status, 'needs_work');
  assert.equal(hardcoded.result.executions.length, 3);
  const correct = await store.submit(session.id, { ...input, answer: 'numero = int(input())\nprint(numero * 2)' });
  assert.equal(correct.result.status, 'passed');
  assert.equal(correct.result.executions[2].stdout.trim(), '-8');
});
test('aula Python completa teoria, previsão, prática, explicação, transferência e revisão', async t => {
  const { store } = await fixture(t);
  const capabilities = await store.runner.capabilities();
  if (!capabilities.languages.find(runtime => runtime.id === 'python').available) { t.skip(capabilities.sandbox.reason || 'Python indisponível'); return; }
  const pack = programmingDemo('python');
  const session = await store.create(pack.session, true, 'python');
  assert.equal(session.blocks[0].type, 'lesson');
  const answer = async values => store.submit(session.id, { blockId: store.get(session.id).blocks.at(-1).id, reasoning: 'Explicação do teste do percurso.', confidence: 2, ...values });
  await answer({ choice: 1 });
  await answer({ answer: 'print(int(input()) * 2)' });
  assert.equal(store.get(session.id).blocks.at(-1).type, 'reflection');
  await answer({ answer: 'A entrada e o resultado mudam; a regra permanece multiplicar por dois.' });
  await answer({ answer: 'preco = int(input())\nquantidade = int(input())\nprint(preco * quantidade)' });
  const completed = store.get(session.id);
  assert.equal(completed.blocks.at(-1).stage, 'review');
  assert.equal(completed.reviews.length, 1);
  assert.equal(completed.summary.reviewedByTutor, 0, 'não simula avaliação do tutor');
});

test('JavaScript com entrada e saída usa Node isolado e rejeita mistura com testes do Worker', async t => {
  const { store } = await fixture(t);
  const { blockSchema } = await import('../src/schema.js');
  const definition = { type: 'code', stage: 'predict', language: 'javascript', runtime: 'local', title: 'Entrada no Node', prompt: 'Leia um número e mostre seu dobro.', tests: [{ name: 'Entrada variável', stdin: '4', expectedStdout: '8' }] };
  assert.equal(blockSchema.safeParse({ ...definition, runtime: 'browser' }).success, false);
  assert.equal(blockSchema.safeParse({ ...definition, tests: [...definition.tests, { label: 'Expressão', expression: 'true' }] }).success, false);
  const capabilities = await store.runner.capabilities();
  if (!capabilities.languages.find(runtime => runtime.id === 'javascript').available) { t.skip('Node isolado indisponível'); return; }
  const session = await store.create({ title: 'Node local', goal: 'Ler stdin' });
  const block = await store.addBlock(session.id, definition);
  const attempt = await store.submit(session.id, { blockId: block.id, answer: 'const fs = require("node:fs"); console.log(Number(fs.readFileSync(0, "utf8")) * 2);', confidence: 2 });
  assert.equal(attempt.result.source, 'automatic');
  assert.equal(attempt.result.status, 'passed');
  assert.equal(attempt.result.executions[0].stdout.trim(), '8');
  assert.equal(store.get(session.id).progress.status, 'ready_for_transition');
});

test('migração preserva conclusão e revisões de uma aula nativa anterior ao controle de etapas', async t => {
  const { directory } = await fixture(t);
  const id = '92807c97-cb77-46b1-9a52-45330a1bde47';
  const blockId = '3f74a73c-0f10-4dd2-8865-4200d21c5aaa';
  const attemptId = '1997f2e0-f826-4d5d-8c37-672c08228225';
  const card = { id: '64b36979-54bd-435f-84f3-9e82912d0a09', concept: 'Entrada', prompt: 'Explique input', referenceAnswer: 'Recebe texto', attempts: [], step: 0, dueAt: new Date().toISOString() };
  const old = { id, title: 'Python concluído', goal: 'Preservar a aula', mode: 'demo', demoLanguage: 'python', revision: 4, blocks: [{ ...programmingDemo('python').transfer, id: blockId, demoStep: 'transfer' }], attempts: [{ id: attemptId, blockId, result: { status: 'passed' } }], events: [], advanced: [blockId], reviews: [card], objectives: ['Ler números'] };
  await writeFile(join(directory, 'sessions.json'), JSON.stringify({ version: 1, sessions: [old] }));
  const reloaded = await new Store(directory).init();
  assert.equal(reloaded.get(id).progress.status, 'completed');
  assert.equal(reloaded.get(id).progress.lastAttemptId, attemptId);
  assert.deepEqual(reloaded.get(id).objectives, ['Ler números']);
  assert.deepEqual(reloaded.get(id).reviews, [card]);
});
