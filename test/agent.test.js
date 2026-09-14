import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AgentError, AgentRunner, extractText, needsIntroduction, openingMessage } from '../src/agent.js';
import { TEACHING_GUIDE } from '../src/pedagogy.js';
import { TUTOR_INSTRUCTIONS } from '../src/schema.js';

const session = {
  id: 'sessao-de-teste',
  title: 'JavaScript',
  goal: 'Aprender funções pequenas',
  level: 'beginner',
  progress: { stage: 'practice', status: 'ready_for_activity', activeBlockId: null },
  learnerProfile: { priorKnowledge: 'Conheço variáveis.', timeAvailableMinutes: 30, preferences: 'Exemplos práticos.' },
  plan: {
    summary: 'Aprender funções com prática curta.',
    outcomes: ['Declarar funções', 'Usar parâmetros'],
    checkpoints: [
      { stage: 'predict', objective: 'Prever o comportamento', evidence: 'Explica antes de executar' },
      { stage: 'practice', objective: 'Escrever uma função', evidence: 'Código executa' },
      { stage: 'explain', objective: 'Explicar a escolha', evidence: 'Justifica com suas palavras' },
      { stage: 'transfer', objective: 'Adaptar a função', evidence: 'Resolve uma variação' },
    ],
  },
  blocks: [],
  attempts: [],
};

function fakeChild({ output = '', chunks, code = 0, delayMs = 0, killDelayMs = 0, neverClose = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.killSignals = [];
  child.stdin.end = prompt => {
    child.prompt = prompt;
    if (neverClose) return;
    setTimeout(() => {
      for (const chunk of chunks || [output]) child.stdout.emit('data', chunk);
      child.emit('close', code);
    }, delayMs);
  };
  child.kill = signal => {
    child.killSignals.push(signal);
    setTimeout(() => child.emit('close', 143), killDelayMs);
    return true;
  };
  return child;
}

function runnerWith(child, options = {}) {
  const calls = [];
  const runner = new AgentRunner({
    root: 'C:\\mcp-tutor-test',
    command: 'fake-agent',
    spawnImpl: (command, args, spawnOptions) => {
      calls.push({ command, args, spawnOptions });
      return child;
    },
    ...options,
  });
  return { runner, calls };
}

test('abertura aproveita objetivo e nível sem ultrapassar o limite de mensagem', () => {
  assert.match(openingMessage(session), /Aprender funções pequenas/);
  assert.match(openingMessage(session), /Estou começando/);
  assert.ok(openingMessage({ ...session, goal: 'g'.repeat(12000) }).length <= 5000);
  assert.equal(needsIntroduction(session), true);
  assert.equal(needsIntroduction({ ...session, blocks: [{ type: 'message', role: 'tutor', title: 'Conexão do tutor' }] }), true);
  assert.equal(needsIntroduction({ ...session, blocks: [{ type: 'message', role: 'tutor', title: 'Seu tutor', body: 'Mini-lição com exemplo' }] }), false);
  const prompt = runnerWith(fakeChild()).runner.prompt(session, openingMessage(session));
  assert.match(prompt, /ABERTURA DA AULA/);
  assert.match(prompt, /Não crie quiz, code ou reflection neste turno/);
  assert.match(prompt, /exemplo resolvido/);
  assert.match(prompt, /sem pedir que o aluno repita/);
});

test('introdução bloqueia exercícios, mas permite plano e materiais; próximo turno libera prática', async () => {
  const child = fakeChild({ neverClose: true });
  const { runner } = runnerWith(child);
  const pending = runner.reply(session, 'Vamos começar');
  for (const type of ['quiz', 'code', 'reflection']) {
    assert.throws(() => runner.assertCanAddBlock(session.id, { type }), error => error.status === 409 && /Primeiro ensine/.test(error.message));
  }
  assert.doesNotThrow(() => runner.assertCanAddBlock(session.id, { type: 'diagram' }));
  child.stdout.emit('data', '{"type":"agent_message","text":"Uma variável guarda um valor. Exemplo: const nome = 1."}\n');
  child.emit('close', 0);
  await pending;
  const introduced = { ...session, blocks: [{ type: 'message', role: 'tutor', title: 'Seu tutor', body: 'Mini-lição' }] };
  const nextChild = fakeChild({ output: '{"type":"agent_message","text":"Vamos praticar."}' });
  runner.spawnImpl = () => nextChild;
  const next = runner.reply(introduced, 'Quero praticar');
  assert.doesNotThrow(() => runner.assertCanAddBlock(session.id, { type: 'code' }));
  assert.match(runner.prompt(introduced, 'Quero praticar'), /CONTINUAÇÃO DA AULA/);
  await next;
});

test('agente desativado salva o início e expõe falha recuperável', async () => {
  const runner = new AgentRunner({ command: 'none' });
  let saved = false;
  await assert.rejects(runner.reply(session, 'Iniciar aula', { beforeRun: async () => { saved = true; } }), error => error.status === 503);
  assert.equal(saved, true);
  assert.equal(runner.status(session.id).session.phase, 'failed');
  assert.equal(runner.status(session.id).session.active, false);
});

test('esclarecimento sem plano não libera tarefas no turno seguinte', async () => {
  const clarified = { ...session, plan: null, blocks: [{ type: 'message', role: 'tutor', title: 'Seu tutor', body: 'Você quer criar sites, jogos ou automatizar tarefas?' }] };
  assert.equal(needsIntroduction(clarified), true);
  const child = fakeChild({ neverClose: true });
  const { runner } = runnerWith(child);
  const reply = runner.reply(clarified, 'Sites com HTML');
  for (const type of ['quiz', 'code', 'reflection']) assert.throws(() => runner.assertCanAddBlock(session.id, { type }), error => error.status === 409);
  // Even a plan registered during this turn cannot bypass waiting for the lesson.
  clarified.plan = session.plan;
  assert.throws(() => runner.assertCanAddBlock(session.id, { type: 'quiz' }), error => error.status === 409);
  child.stdout.emit('data', '{"type":"agent_message","text":"Uma tag envolve conteúdo. Exemplo: <p>Olá</p>. A página mostra Olá em um parágrafo."}\n');
  child.emit('close', 0);
  await reply;
});

test('chat e instruções MCP carregam integralmente a mesma skill pedagógica', () => {
  assert.ok(TEACHING_GUIDE.length > 1000);
  assert.ok(TUTOR_INSTRUCTIONS.includes(TEACHING_GUIDE));
  assert.ok(runnerWith(fakeChild()).runner.prompt(session, 'Começar').includes(TEACHING_GUIDE));
  assert.equal(TEACHING_GUIDE.startsWith('---'), false);
});

test('plano salvo seguido de falha não confunde esclarecimento anterior com aula entregue', () => {
  const recovering = { ...session, blocks: [
    { id: 'question', type: 'message', role: 'tutor', title: 'Seu tutor' },
    { id: 'failure', type: 'message', role: 'tutor', title: 'Conexão do tutor' },
  ], events: [
    { cursor: 1, type: 'block_added', blockId: 'question' },
    { cursor: 2, type: 'learning_plan_updated' },
    { cursor: 3, type: 'block_added', blockId: 'failure' },
  ] };
  assert.equal(needsIntroduction(recovering), true);
  recovering.blocks.push({ id: 'lesson', type: 'message', role: 'tutor', title: 'Seu tutor' });
  recovering.events.push({ cursor: 4, type: 'block_added', blockId: 'lesson' });
  assert.equal(needsIntroduction(recovering), false);
  recovering.events.push({ cursor: 5, type: 'learning_plan_updated' });
  assert.equal(needsIntroduction(recovering), false);
});

test('extrai a última mensagem de JSONL mesmo com linhas inválidas e conteúdo em chunks', async () => {
  const child = fakeChild({ chunks: [
    'diagnóstico ignorado\n{"type":"item.completed","item":{"type":"reasoning","text":"interno"}}\n',
    '{"type":"agent_message","text":"Primeira resposta"}\r\n',
    '{"type":"item.completed","item":{"type":"agent_message","content":[{"type":"output_text","text":"Resposta final em partes"}]}}\n',
  ] });
  const { runner, calls } = runnerWith(child);

  const answer = await runner.run('pergunta');

  assert.equal(answer, 'Resposta final em partes');
  assert.equal(calls[0].command, 'fake-agent');
  assert.equal(calls[0].args.at(-1), '-');
  assert.ok(calls[0].args.includes('--ignore-user-config'));
  assert.ok(calls[0].args.some(argument => argument.startsWith('mcp_servers.mcp-tutor.command=')));
  assert.ok(calls[0].args.some(argument => argument.includes('mcp.js')));
  assert.equal(calls[0].spawnOptions.shell, false);
  assert.equal(child.prompt, 'pergunta');
});

test('mantém compatibilidade com agentes que respondem texto simples', async () => {
  const child = fakeChild({ output: 'resposta simples do tutor\n' });
  const { runner } = runnerWith(child);

  assert.equal(await runner.run('pergunta'), 'resposta simples do tutor');
  assert.equal(extractText('{"type":"agent_message","text":"uma"}\n{"type":"agent_message","text":"duas"}'), 'duas');
});

test('usa sempre o modelo Luna obrigatório e ignora override de modelo', async () => {
  const child = fakeChild({ output: '{"type":"agent_message","text":"ok"}' });
  const { runner, calls } = runnerWith(child, { model: 'outro-modelo', timeoutMs: 1234 });
  assert.equal(await runner.run('pergunta'), 'ok');
  assert.deepEqual(calls[0].args.slice(-5), ['--model', 'gpt-5.6-luna', '-C', 'C:\\mcp-tutor-test', '-']);
  assert.equal(calls[0].spawnOptions.shell, false);
  assert.equal(runner.status().model, 'gpt-5.6-luna');
  assert.equal(runner.status().timeoutSeconds, 2);
});

test('limita a resposta do agente ao contrato de 12.000 caracteres do Store', async () => {
  const child = fakeChild({ output: `{"type":"agent_message","text":"${'r'.repeat(15000)}"}` });
  const { runner } = runnerWith(child);

  const answer = await runner.run('pergunta');

  assert.equal(answer.length, 12000);
});

test('limita a entrada do aluno antes de iniciar o processo', async () => {
  let spawned = false;
  const runner = new AgentRunner({ command: 'fake-agent', spawnImpl: () => { spawned = true; return fakeChild(); } });

  await assert.rejects(
    runner.reply(session, 'x'.repeat(5001)),
    error => error instanceof AgentError && error.status === 400 && /5\.000/.test(error.message),
  );
  assert.equal(spawned, false);
});

test('impõe limite de stdout e encerra o processo que excede o limite', async () => {
  const child = fakeChild({ output: 'x'.repeat(128 * 1024 + 1) });
  const { runner } = runnerWith(child);

  await assert.rejects(
    runner.run('pergunta'),
    error => error instanceof AgentError && error.status === 502 && /limite permitido/.test(error.message),
  );
  assert.ok(child.killSignals.length >= 1);
});

test('timeout rejeita com mensagem segura e mata o processo filho', async () => {
  const child = fakeChild({ neverClose: true });
  const { runner } = runnerWith(child, { timeoutMs: 20 });

  await assert.rejects(
    runner.run('pergunta'),
    error => error instanceof AgentError && error.status === 504 && /20|1 segundo/.test(error.message),
  );
  assert.deepEqual(child.killSignals, ['SIGTERM']);
});

test('não vaza stderr nem detalhes de erro de inicialização', async () => {
  const child = fakeChild({ output: '{"type":"error","message":"segredo"}\n', code: 1 });
  child.stderr.emit('data', 'token-super-secreto C:\\privado\\config.json');
  const { runner } = runnerWith(child);

  await assert.rejects(
    runner.run('pergunta'),
    error => error instanceof AgentError && error.status === 502 && !error.message.includes('segredo') && !error.message.includes('token-super-secreto'),
  );

  const failingRunner = new AgentRunner({ command: 'fake-agent', spawnImpl: () => { throw new Error('C:\\privado\\segredo.exe'); } });
  await assert.rejects(
    failingRunner.run('pergunta'),
    error => error instanceof AgentError && error.status === 503 && !error.message.includes('segredo.exe'),
  );
});

test('impede duas respostas simultâneas para a mesma sessão e libera o lock ao finalizar', async () => {
  const child = fakeChild({ output: '{"type":"agent_message","text":"ok"}', delayMs: 25 });
  const { runner } = runnerWith(child);
  const first = runner.reply(session, 'primeira');
  await new Promise(resolve => setTimeout(resolve, 1));

  await assert.rejects(
    runner.reply(session, 'segunda'),
    error => error instanceof AgentError && error.status === 409,
  );
  assert.equal(await first, 'ok');
  assert.equal(runner.status().busySessions, 0);
  assert.equal(await runner.reply(session, 'terceira'), 'ok');
});

test('adquire o lock antes do hook que grava a mensagem', async () => {
  const child = fakeChild({ output: '{"type":"agent_message","text":"ok"}', delayMs: 10 });
  const { runner } = runnerWith(child);
  let hookCalls = 0;
  let statusDuringHook;
  const first = runner.reply(session, 'primeira', {
    beforeRun: async () => {
      hookCalls += 1;
      statusDuringHook = runner.status(session.id).session;
      await Promise.resolve();
    },
  });

  await assert.rejects(
    runner.reply(session, 'segunda'),
    error => error instanceof AgentError && error.status === 409,
  );
  assert.equal(hookCalls, 1);
  assert.equal(statusDuringHook.active, true);
  await first;
});

test('persiste estado final seguro de sucesso e falha por sessão', async () => {
  const success = runnerWith(fakeChild({ output: '{"type":"agent_message","text":"ok"}' })).runner;
  await success.reply(session, 'concluir');
  const successStatus = success.status(session.id).session;
  assert.equal(successStatus.phase, 'completed');
  assert.equal(successStatus.active, false);
  assert.equal(successStatus.lastError, null);
  assert.equal(typeof successStatus.startedAt, 'number');
  assert.equal(typeof successStatus.updatedAt, 'number');
  assert.equal(typeof successStatus.elapsedSeconds, 'number');

  const failed = runnerWith(fakeChild({ output: '{"type":"error","message":"segredo"}', code: 1 })).runner;
  await assert.rejects(failed.reply(session, 'falhar'));
  const failedStatus = failed.status(session.id).session;
  assert.equal(failedStatus.phase, 'failed');
  assert.equal(failedStatus.active, false);
  assert.equal(failedStatus.lastError, 'O agente não conseguiu concluir a resposta. Tente novamente ou continue pelo cliente MCP.');
  assert.doesNotMatch(failedStatus.lastError, /segredo|token|config/i);
});

test('cancela o processo exato e libera o lock', async () => {
  const child = fakeChild({ neverClose: true, killDelayMs: 25 });
  const { runner } = runnerWith(child);
  const pending = runner.reply(session, 'cancelar');
  const cancel = runner.cancel(session.id);

  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(runner.status(session.id).session.active, true);
  await assert.rejects(
    runner.reply(session, 'segunda'),
    error => error instanceof AgentError && error.status === 409,
  );
  assert.equal(runner.status().busySessions, 1);
  const result = await cancel;

  assert.equal(result.cancelled, true);
  assert.deepEqual(child.killSignals, ['SIGTERM']);
  await assert.rejects(pending, error => error instanceof AgentError && error.status === 499);
  assert.equal(runner.status().busySessions, 0);
  assert.equal(runner.status(session.id).session.phase, 'cancelled');
  assert.equal(runner.status(session.id).session.active, false);
  assert.equal(runner.status(session.id).session.lastError, null);
});

test('expõe a fase real da resposta por sessão', async () => {
  const child = fakeChild({ neverClose: true });
  const { runner } = runnerWith(child);
  const pending = runner.reply(session, 'crie um desafio');
  assert.equal(runner.status(session.id).session.phase, 'starting');
  child.stdout.emit('data', '{"type":"thread.started"}\n');
  assert.equal(runner.status(session.id).session.phase, 'connecting');
  child.stdout.emit('data', '{"type":"item.started","item":{"type":"mcp_tool_call","tool":"tutor_add_block"}}\n');
  assert.equal(runner.status(session.id).session.phase, 'creating_activity');
  child.stdout.emit('data', '{"type":"item.completed","item":{"type":"agent_message","text":"Desafio criado."}}\n');
  assert.equal(runner.status(session.id).session.phase, 'finishing');
  child.emit('close', 0);
  assert.equal(await pending, 'Desafio criado.');
  assert.equal(runner.status(session.id).session.phase, 'completed');
  assert.equal(runner.status(session.id).session.active, false);
});

test('mantém a fase independente para cada sessão do agente', async () => {
  const firstChild = fakeChild({ neverClose: true });
  const secondChild = fakeChild({ neverClose: true });
  const children = [firstChild, secondChild];
  const { runner } = runnerWith(firstChild, { spawnImpl: () => children.shift() });
  const firstSession = { ...session, id: 'sessao-1' };
  const secondSession = { ...session, id: 'sessao-2' };

  const first = runner.reply(firstSession, 'primeira mensagem');
  const second = runner.reply(secondSession, 'segunda mensagem');

  assert.equal(runner.status().busySessions, 2);
  assert.equal(runner.status(firstSession.id).session.phase, 'starting');
  assert.equal(runner.status(secondSession.id).session.phase, 'starting');

  firstChild.stdout.emit('data', '{"type":"turn.started"}\n');
  secondChild.stdout.emit('data', '{"type":"item.started","item":{"type":"mcp_tool_call","tool":"tutor_add_block"}}\n');
  assert.equal(runner.status(firstSession.id).session.phase, 'thinking');
  assert.equal(runner.status(secondSession.id).session.phase, 'creating_activity');

  firstChild.stdout.emit('data', '{"type":"agent_message","text":"Primeira resposta"}\n');
  secondChild.stdout.emit('data', '{"type":"agent_message","text":"Segunda resposta"}\n');
  firstChild.emit('close', 0);
  secondChild.emit('close', 0);

  assert.deepEqual(await Promise.all([first, second]), ['Primeira resposta', 'Segunda resposta']);
  assert.equal(runner.status(firstSession.id).session.phase, 'completed');
  assert.equal(runner.status(secondSession.id).session.phase, 'completed');
  assert.equal(runner.status().busySessions, 0);
});

test('prompt limita contexto e preserva a mensagem do aluno', () => {
  const runner = new AgentRunner({ command: 'fake-agent' });
  const largeSession = { ...session, goal: 'g'.repeat(20000), learnerProfile: { priorKnowledge: 'p'.repeat(20000), timeAvailableMinutes: 45, preferences: 'f'.repeat(20000) }, plan: { summary: 's'.repeat(20000), outcomes: ['o'.repeat(2000)], checkpoints: session.plan.checkpoints.map(checkpoint => ({ ...checkpoint, objective: 'o'.repeat(2000), evidence: 'e'.repeat(2000) })) }, blocks: Array.from({ length: 20 }, (_, index) => ({ id: index, type: 'code', prompt: 'p'.repeat(10000), starterCode: 's'.repeat(10000) })) };
  const prompt = runner.prompt(largeSession, 'preciso de uma dica');

  assert.ok(prompt.length <= 120000);
  assert.match(prompt, /preciso de uma dica/);
});

test('inclui perfil do aluno e plano de aprendizagem no contexto delimitado', () => {
  const runner = new AgentRunner({ command: 'fake-agent' });
  const prompt = runner.prompt(session, 'vamos continuar');

  assert.match(prompt, /"learnerProfile"/);
  assert.match(prompt, /Conheço variáveis\./);
  assert.match(prompt, /"plan"/);
  assert.match(prompt, /Aprender funções com prática curta\./);
  assert.match(prompt, /Escrever uma função/);
});

test('inclui o histórico recente da conversa com papel e corpo limitados', () => {
  const runner = new AgentRunner({ command: 'fake-agent' });
  const prompt = runner.prompt({ ...session, blocks: [
    { id: 'm1', type: 'message', role: 'learner', stage: 'predict', title: 'Sua mensagem', body: 'Já conheço variáveis e tenho 30 minutos.' },
    { id: 'm2', type: 'message', role: 'tutor', stage: 'predict', title: 'Seu tutor', body: 'Vamos começar por uma previsão.' },
  ] }, 'quero continuar');

  assert.match(prompt, /"role": "learner"/);
  assert.match(prompt, /Já conheço variáveis e tenho 30 minutos\./);
  assert.match(prompt, /"role": "tutor"/);
  assert.match(prompt, /Vamos começar por uma previsão\./);
});

test('instrui o chat integrado a responder dicas diretamente sem duplicar mensagens', () => {
  const runner = new AgentRunner({ command: 'fake-agent' });
  const prompt = runner.prompt(session, 'onde está a dica?');

  assert.match(prompt, /resposta final será salva automaticamente/);
  assert.match(prompt, /nunca use tutor_add_block para registrar/);
  assert.match(prompt, /jamais crie um bloco com type "message"/);
  assert.match(prompt, /pergunta simples de esclarecimento.*contexto atual.*responda diretamente/);
  assert.match(prompt, /consultar estado extra ou alterar uma atividade, o plano, uma revisão ou o avanço da etapa/);
  assert.match(prompt, /tutor_add_block para criar atividades/);
});
