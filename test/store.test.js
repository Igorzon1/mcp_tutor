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
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
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
  await assert.rejects(store.submit(session.id, response(quiz, { choice: 1 })), /atividade respondível atual/);
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
  const secondSession = await store.create({ title: 'Seletores', goal: 'Validar seletores' });
  await assert.rejects(store.addBlock(secondSession.id, { type: 'code', title: 'Inválido', prompt: 'Teste', checks: [{ label: 'Inválido', selector: '[', kind: 'exists' }] }), /Seletor inválido/);
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
  assert.equal(events.events.filter(event => event.attemptId === attempt.id || event.blockId === block.id).length, 2);
  assert.equal(events.cursor, cursor + 2);
  await store.review(session.id, { attemptId: attempt.id, passed: true, feedback: 'Você distinguiu significado de aparência.' });
  const stored = store.get(session.id).attempts[0];
  assert.equal(stored.result.status, 'pending_review');
  assert.equal(stored.review.passed, true);
  assert.equal((await store.getEvents(session.id, store.get(session.id).revision, 0)).events.length, 0);
});

test('máquina de estados mantém uma atividade aberta e exige avanço explícito', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'Fluxo', goal: 'Praticar uma ideia por vez' });
  const quiz = await store.addBlock(session.id, { type: 'quiz', stage: 'predict', title: 'Prever', prompt: 'Qual opção?', options: ['A', 'B'], correctIndex: 1, explanation: 'B é a opção correta.' });
  assert.equal(store.get(session.id).progress.status, 'awaiting_attempt');
  await assert.rejects(store.addBlock(session.id, { type: 'reflection', stage: 'predict', title: 'Outra atividade', prompt: 'Explique.' }), /Já existe uma atividade respondível aberta/);

  const wrong = await store.submit(session.id, response(quiz, { choice: 0 }));
  assert.equal(wrong.result.status, 'needs_work');
  assert.equal(store.get(session.id).progress.status, 'awaiting_attempt');
  await assert.rejects(store.advanceStage(session.id, { attemptId: wrong.id, reason: 'Ainda não demonstrou o objetivo.' }), /ainda não está pronta/);

  const correct = await store.submit(session.id, response(quiz, { choice: 1 }));
  assert.equal(store.get(session.id).progress.status, 'ready_for_transition');
  await store.review(session.id, { attemptId: correct.id, passed: false, feedback: 'A escolha passou, mas explique melhor o motivo.' });
  assert.equal(store.get(session.id).progress.status, 'awaiting_attempt');
  const corrected = await store.submit(session.id, response(quiz, { choice: 1, reasoning: 'Agora explico que B representa o título principal.' }));
  assert.equal(store.get(session.id).progress.status, 'ready_for_transition');
  await assert.rejects(store.advanceStage(session.id, { attemptId: wrong.id, reason: 'Tentativa antiga.' }), /tentativa mais recente/);
  const progress = await store.advanceStage(session.id, { attemptId: corrected.id, reason: 'A escolha e o raciocínio identificam o papel correto.' });
  assert.equal(progress.stage, 'practice');
  assert.equal(progress.status, 'ready_for_activity');
  await assert.rejects(store.addBlock(session.id, { type: 'code', stage: 'predict', title: 'Etapa errada', prompt: 'Crie algo.' }), /A etapa atual é practice/);
});

test('reflexão bloqueia o avanço até a revisão do tutor', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'Reflexão', goal: 'Explicar uma decisão' });
  const block = await store.addBlock(session.id, { type: 'reflection', stage: 'predict', title: 'Explique', prompt: 'Por que essa escolha?' });
  const attempt = await store.submit(session.id, response(block, { answer: 'Porque essa escolha comunica o papel do conteúdo.' }));
  assert.equal(store.get(session.id).progress.status, 'awaiting_review');
  await assert.rejects(store.advanceStage(session.id, { attemptId: attempt.id, reason: 'A explicação parece suficiente.' }), /ainda não está pronta/);
  await store.review(session.id, { attemptId: attempt.id, passed: true, feedback: 'A explicação apresenta uma justificativa coerente.' });
  assert.equal(store.get(session.id).progress.status, 'ready_for_transition');
  const progress = await store.advanceStage(session.id, { attemptId: attempt.id, reason: 'A revisão confirmou evidência suficiente.' });
  assert.equal(progress.stage, 'practice');
});

test('JavaScript usa evidência do navegador e exige revisão do tutor', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'JavaScript', goal: 'Praticar funções' });
  const block = await store.addBlock(session.id, {
    type: 'code', stage: 'predict', title: 'Uma função', prompt: 'Crie uma função que transforme texto.', language: 'javascript',
    starterCode: 'function upperCase(text) {}',
    tests: [
      { label: 'A função existe', expression: "typeof upperCase === 'function'" },
      { label: 'Transforma o texto', expression: "upperCase('oi') === 'OI'" },
    ],
  });
  const attempt = await store.submit(session.id, response(block, {
    answer: "function upperCase(text) { return text.toUpperCase(); }",
    runtimeEvidence: { status: 'passed', checks: [{ label: 'A função existe', passed: true }, { label: 'Transforma o texto', passed: true }], output: '', durationMs: 4 },
  }));
  assert.equal(attempt.result.status, 'pending_review');
  assert.equal(attempt.result.source, 'browser');
  assert.equal(store.get(session.id).progress.status, 'awaiting_review');
  await store.review(session.id, { attemptId: attempt.id, passed: true, feedback: 'A função e o raciocínio demonstram a transformação.' });
  assert.equal(store.get(session.id).progress.status, 'ready_for_transition');
  const progress = await store.advanceStage(session.id, { attemptId: attempt.id, reason: 'Os testes passaram e a solução foi explicada.' });
  assert.equal(progress.stage, 'practice');
});

test('sessões v1 recebem progresso sem perder o histórico', async t => {
  const { directory } = await fixture(t);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const blockId = '22222222-2222-4222-8222-222222222222';
  await writeFile(join(directory, 'sessions.json'), JSON.stringify({
    version: 1,
    sessions: [{ id: sessionId, title: 'Legada', goal: 'Continuar a aula', level: 'beginner', mode: 'tutor', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', revision: 0, blocks: [{ id: blockId, type: 'quiz', stage: 'predict', title: 'Prever', prompt: 'Qual opção?', options: ['A', 'B'], correctIndex: 1, explanation: 'B', hints: [], revealedHints: 0 }], attempts: [], events: [], advanced: [] }],
  }, null, 2));
  const store = await new Store(directory).init();
  const migrated = store.get(sessionId);
  assert.equal(migrated.progress.stage, 'predict');
  assert.equal(migrated.progress.status, 'awaiting_attempt');
  assert.equal(migrated.progress.activeBlockId, blockId);
  assert.equal(migrated.blocks[0].id, blockId);
  assert.equal(migrated.learnerProfile.timeAvailableMinutes, 45);
  const persisted = JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'));
  assert.equal(persisted.version, 3);
  assert.equal(persisted.sessions[0].plan, null);
});

test('plano de aprendizagem persiste perfil, resultados e evidências por etapa', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'Plano', goal: 'Aprender funções JavaScript' });
  const result = await store.setLearningPlan(session.id, {
    learnerProfile: { priorKnowledge: 'Variáveis e arrays.', timeAvailableMinutes: 40, preferences: 'Aprender construindo.' },
    plan: {
      summary: 'Desenvolver e explicar funções pequenas.',
      outcomes: ['Criar funções puras', 'Explicar entradas e saídas'],
      checkpoints: [
        { stage: 'predict', objective: 'Prever uma saída', evidence: 'Previsão justificada' },
        { stage: 'practice', objective: 'Implementar uma função', evidence: 'Testes e raciocínio registrados' },
        { stage: 'explain', objective: 'Explicar o fluxo', evidence: 'Explicação revisada' },
        { stage: 'transfer', objective: 'Adaptar a solução', evidence: 'Variação resolvida sem copiar' },
      ],
    },
  });
  assert.equal(result.plan.outcomes.length, 2);
  assert.equal(store.get(session.id).learnerProfile.timeAvailableMinutes, 40);
  assert.equal(store.list()[0].hasPlan, true);
  assert.ok(store.get(session.id).events.some(event => event.type === 'learning_plan_updated'));
  await assert.rejects(store.setLearningPlan(session.id, {
    learnerProfile: { priorKnowledge: '', timeAvailableMinutes: 40, preferences: '' },
    plan: { summary: 'Inválido', outcomes: ['Um'], checkpoints: [
      { stage: 'practice', objective: 'Fora de ordem', evidence: 'Nenhuma' },
      { stage: 'predict', objective: 'Fora de ordem', evidence: 'Nenhuma' },
      { stage: 'explain', objective: 'Explicar', evidence: 'Explicação' },
      { stage: 'transfer', objective: 'Transferir', evidence: 'Variação' },
    ] },
  }), /etapa esperada/i);
});

test('raciocínio vazio é aceito em respostas e código', async t => {
  const { store } = await fixture(t);
  const session = await store.create({ title: 'Resposta direta', goal: 'Responder sem repetição obrigatória' });
  const reflection = await store.addBlock(session.id, { type: 'reflection', stage: 'predict', title: 'Explique', prompt: 'O que a função retorna?' });
  const attempt = await store.submit(session.id, { blockId: reflection.id, answer: 'Ela retorna o dobro do número.', reasoning: '', confidence: 2 });
  assert.equal(attempt.reasoning, '');
  assert.equal(attempt.result.status, 'pending_review');
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
  assert.equal(blockSchema.safeParse({ type: 'code', title: 'JS', prompt: 'P', language: 'javascript', tests: [{ label: 'Existe', expression: 'typeof answer === "function"' }] }).success, true);
  assert.equal(blockSchema.safeParse({ type: 'code', title: 'HTML', prompt: 'P', language: 'html', tests: [{ label: 'Inválido', expression: 'true' }] }).success, false);
  assert.equal(blockSchema.safeParse({ type: 'code', title: 'JS', prompt: 'P', language: 'javascript', checks: [{ label: 'Inválido', selector: 'main', kind: 'exists' }] }).success, false);
});
