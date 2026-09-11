import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { blockSchema, sessionSchema, submissionSchema, reviewSchema, advanceStageSchema, progressSchema, learnerProfileSchema, learningPlanSchema, planUpdateSchema, STAGES } from './schema.js';
import * as demo from './demo.js';

const now = () => new Date().toISOString();
const copy = value => structuredClone(value);
const answerableTypes = new Set(['quiz', 'code', 'reflection']);
const isAnswerable = block => answerableTypes.has(block.type);
const isStage = value => STAGES.includes(value);
const initialProgress = () => ({ stage: STAGES[0], status: 'ready_for_activity', activeBlockId: null, lastAttemptId: null, completedStages: [] });
const initialProfile = () => learnerProfileSchema.parse({});
const DATA_VERSION = 3;
const MAX_CONTENT_BLOCKS = 120;
const MAX_MESSAGES = 500;

function latestAttemptFor(session, blockId) {
  return session.attempts.filter(attempt => attempt.blockId === blockId).at(-1);
}

function inferredProgress(session) {
  const blocks = Array.isArray(session.blocks) ? session.blocks : [];
  const attempts = Array.isArray(session.attempts) ? session.attempts : [];
  const stage = [...blocks].reverse().find(block => isStage(block.stage))?.stage || STAGES[0];
  const activeBlock = [...blocks].reverse().find(block => isAnswerable(block));
  const latest = activeBlock && latestAttemptFor({ attempts }, activeBlock.id);
  const completedStages = STAGES.slice(0, Math.max(0, STAGES.indexOf(stage)));
  if (!activeBlock) return { ...initialProgress(), stage, completedStages };
  if (!latest) return { ...initialProgress(), stage, status: 'awaiting_attempt', activeBlockId: activeBlock.id, completedStages };
  if (latest.review?.passed || latest.result?.status === 'passed') return { stage, status: 'ready_for_transition', activeBlockId: null, lastAttemptId: latest.id, completedStages };
  if (latest.result?.status === 'pending_review') return { stage, status: 'awaiting_review', activeBlockId: activeBlock.id, lastAttemptId: latest.id, completedStages };
  return { stage, status: 'awaiting_attempt', activeBlockId: activeBlock.id, lastAttemptId: latest.id, completedStages };
}

function validProgress(value) {
  return progressSchema.safeParse(value).success;
}

function migrateSession(session) {
  if (!session || typeof session !== 'object') throw new Error('Sessão persistida inválida.');
  const parsed = sessionSchema.safeParse({ title: session.title, goal: session.goal, level: session.level, ...(session.learnerProfile ? { learnerProfile: session.learnerProfile } : {}) });
  if (!parsed.success || !zUuid(session.id) || !Number.isInteger(session.revision) || session.revision < 0) throw new Error(`Sessão persistida inválida: ${session.id || 'sem ID'}.`);
  for (const field of ['blocks', 'attempts', 'events', 'advanced']) if (!Array.isArray(session[field])) throw new Error(`Sessão ${session.id} não possui ${field} válido.`);
  if (session.plan != null && !learningPlanSchema.safeParse(session.plan).success) throw new Error(`Sessão ${session.id} possui um plano inválido.`);
  const normalized = { ...session, ...parsed.data, learnerProfile: parsed.data.learnerProfile || initialProfile(), plan: session.plan || null };
  normalized.progress = validProgress(session.progress) ? session.progress : inferredProgress(normalized);
  return normalized;
}

function zUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = join(directory, 'sessions.json');
    this.data = { version: DATA_VERSION, sessions: [] };
    this.queue = Promise.resolve();
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (![1, 2, DATA_VERSION].includes(data.version) || !Array.isArray(data.sessions)) throw new Error('Formato de dados incompatível.');
      const migrationNeeded = data.version !== DATA_VERSION || data.sessions.some(session => !session.learnerProfile || !Object.hasOwn(session, 'plan') || !validProgress(session.progress));
      this.data = { ...data, version: DATA_VERSION, sessions: data.sessions.map(migrateSession) };
      if (migrationNeeded) await this.persist(this.data);
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Não foi possível ler ${this.file}; o arquivo foi preservado. ${error.message}`); }
    return this;
  }
  async persist(data) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  async mutate(fn) {
    const operation = this.queue.then(async () => {
      const draft = copy(this.data);
      const changed = new Set();
      const result = fn(draft, changed);
      await this.persist(draft);
      this.data = draft;
      for (const id of changed) this.events.emit('change', id);
      return copy(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  session(id, data = this.data) {
    const session = data.sessions.find(s => s.id === id);
    if (!session) throw new AppError('Sessão não encontrada.', 404);
    if (!validProgress(session.progress)) session.progress = inferredProgress(session);
    return session;
  }
  event(session, type, payload, changed) {
    session.updatedAt = now();
    session.revision += 1;
    session.events.push({ cursor: session.revision, type, at: now(), ...payload });
    changed.add(session.id);
  }
  append(session, rawBlock, changed, extra = {}) {
    const messageCount = session.blocks.filter(block => block.type === 'message').length;
    const contentCount = session.blocks.length - messageCount;
    if (rawBlock?.type === 'message' && messageCount >= MAX_MESSAGES) throw new AppError('Limite de 500 mensagens por sessão atingido. Inicie outra sessão para continuar.');
    if (rawBlock?.type !== 'message' && contentCount >= MAX_CONTENT_BLOCKS) throw new AppError('Limite de 120 conteúdos e atividades por sessão atingido. Inicie outra sessão.');
    const block = blockSchema.parse(rawBlock);
    if (!validProgress(session.progress)) session.progress = inferredProgress(session);
    const progress = session.progress;
    if (block.stage !== progress.stage) throw new AppError(`A etapa atual é ${progress.stage}. Crie o conteúdo com stage igual à etapa atual.`);
    if (isAnswerable(block) && progress.status !== 'ready_for_activity') throw new AppError('Já existe uma atividade respondível aberta. Aguarde a tentativa, revise-a ou avance a etapa antes de criar outra.');
    if (block.type === 'code' && block.language === 'html') {
      const { document } = parseHTML('<html><body></body></html>');
      for (const check of block.checks) {
        try { document.querySelector(check.selector); } catch { throw new AppError(`Seletor inválido: ${check.selector}`); }
      }
    }
    const entry = { ...block, id: randomUUID(), createdAt: now(), revealedHints: 0, ...extra };
    session.blocks.push(entry);
    this.event(session, 'block_added', { blockId: entry.id }, changed);
    if (isAnswerable(entry)) {
      session.progress = { ...session.progress, status: 'awaiting_attempt', activeBlockId: entry.id, lastAttemptId: null };
      this.event(session, 'progress_changed', { stage: session.progress.stage, status: session.progress.status, activeBlockId: entry.id }, changed);
    }
    return entry;
  }
  async create(raw, isDemo = false) {
    const input = sessionSchema.parse(raw);
    return this.mutate((data, changed) => {
      if (data.sessions.length >= 250) throw new AppError('Limite de sessões atingido.');
      const session = { ...input, learnerProfile: input.learnerProfile || initialProfile(), plan: null, id: randomUUID(), mode: isDemo ? 'demo' : 'tutor', createdAt: now(), updatedAt: now(), revision: 0, progress: initialProgress(), blocks: [], attempts: [], events: [], advanced: [] };
      data.sessions.push(session);
      this.event(session, 'session_created', {}, changed);
      if (isDemo) {
        this.append(session, demo.intro, changed);
        this.append(session, demo.prediction, changed, { demoStep: 'prediction' });
      }
      return session;
    });
  }
  list() {
    return this.data.sessions.map(session => {
      const progress = this.session(session.id).progress;
      return { id: session.id, title: session.title, goal: session.goal, level: session.level, mode: session.mode, updatedAt: session.updatedAt, revision: session.revision, progress: copy(progress), hasPlan: !!session.plan, activityCount: session.blocks.filter(block => block.type !== 'message').length, messageCount: session.blocks.filter(block => block.type === 'message').length, attemptCount: session.attempts.length };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id, publicView = false) {
    const session = copy(this.session(id));
    if (publicView) {
      delete session.events;
      delete session.advanced;
      session.blocks = session.blocks.map(block => {
        const { hints = [], correctIndex, explanation, ...rest } = block;
        return { ...rest, hints: hints.slice(0, block.revealedHints), hintsRemaining: Math.max(0, hints.length - block.revealedHints) };
      });
    }
    return session;
  }
  progressChanged(session, changed, extra = {}) {
    this.event(session, 'progress_changed', { stage: session.progress.stage, status: session.progress.status, activeBlockId: session.progress.activeBlockId, lastAttemptId: session.progress.lastAttemptId, ...extra }, changed);
  }
  updateProgressAfterAttempt(session, block, attempt, changed) {
    session.progress.lastAttemptId = attempt.id;
    if (attempt.result.status === 'passed') {
      session.progress.status = 'ready_for_transition';
      session.progress.activeBlockId = null;
    } else if (attempt.result.status === 'pending_review') {
      session.progress.status = 'awaiting_review';
      session.progress.activeBlockId = block.id;
    } else {
      session.progress.status = 'awaiting_attempt';
      session.progress.activeBlockId = block.id;
    }
    this.progressChanged(session, changed, { blockId: block.id, attemptId: attempt.id });
  }
  transitionStage(session, changed, attemptId, reason) {
    const currentIndex = STAGES.indexOf(session.progress.stage);
    const fromStage = session.progress.stage;
    const completedStages = session.progress.completedStages.includes(fromStage)
      ? session.progress.completedStages
      : [...session.progress.completedStages, fromStage];
    if (currentIndex === STAGES.length - 1) {
      session.progress = { ...session.progress, status: 'completed', activeBlockId: null, lastAttemptId: attemptId, completedStages };
      this.event(session, 'stage_completed', { fromStage, toStage: null, attemptId, reason, status: 'completed' }, changed);
      return session.progress;
    }
    const toStage = STAGES[currentIndex + 1];
    session.progress = { ...session.progress, stage: toStage, status: 'ready_for_activity', activeBlockId: null, lastAttemptId: attemptId, completedStages };
    this.event(session, 'stage_completed', { fromStage, toStage, attemptId, reason, status: 'ready_for_activity' }, changed);
    return session.progress;
  }
  async addBlock(id, input) { return this.mutate((data, changed) => this.append(this.session(id, data), input, changed)); }
  async setLearningPlan(id, raw) {
    const input = planUpdateSchema.parse({ sessionId: id, ...raw });
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      session.learnerProfile = input.learnerProfile;
      session.plan = input.plan;
      this.event(session, 'learning_plan_updated', { outcomeCount: input.plan.outcomes.length }, changed);
      return { learnerProfile: session.learnerProfile, plan: session.plan, progress: session.progress };
    });
  }
  async advanceStage(id, raw) {
    const input = advanceStageSchema.parse({ sessionId: id, ...raw });
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      if (session.progress.status !== 'ready_for_transition') throw new AppError('A sessão ainda não está pronta para avançar. Conclua a atividade atual e registre uma evidência suficiente.');
      if (session.progress.lastAttemptId !== input.attemptId) throw new AppError('Use a tentativa mais recente como evidência para avançar.');
      const attempt = session.attempts.find(item => item.id === input.attemptId);
      if (!attempt || (attempt.result.status !== 'passed' && !attempt.review?.passed)) throw new AppError('A tentativa indicada ainda não demonstra o objetivo da etapa.');
      return this.transitionStage(session, changed, input.attemptId, input.reason);
    });
  }
  evaluate(block, input) {
    if (block.type === 'quiz') {
      if (input.choice === undefined || input.choice >= block.options.length) throw new AppError('Escolha uma das opções.');
      const passed = input.choice === block.correctIndex;
      return { status: passed ? 'passed' : 'needs_work', source: 'automatic', feedback: passed ? block.explanation : 'Ainda não. Pense no papel de cada elemento e tente novamente. Você também pode pedir uma dica.' };
    }
    if (!input.answer?.trim()) throw new AppError('Escreva sua resposta antes de enviar.');
    if (block.type === 'code' && block.language === 'javascript') {
      const evidence = input.runtimeEvidence;
      const checks = evidence?.checks || [];
      const passedChecks = checks.filter(check => check.passed).length;
      const feedback = evidence
        ? `O executor do navegador registrou ${passedChecks}/${checks.length} testes como aprovados. O tutor deve revisar o código e, quando informado, o raciocínio complementar antes de considerar o objetivo demonstrado.`
        : 'Código JavaScript registrado sem uma execução de testes. Execute a atividade no painel ou peça ao tutor uma revisão orientada.';
      return { status: 'pending_review', source: 'browser', runtimeStatus: evidence?.status || 'not_run', checks, output: evidence?.output || '', error: evidence?.error, feedback };
    }
    if (block.type === 'reflection' || !block.checks.length) return { status: 'pending_review', source: 'automatic', feedback: 'Resposta registrada. O tutor poderá avaliar sua explicação quando retomar a conversa.' };
    const { document } = parseHTML(`<html><body>${input.answer}</body></html>`);
    const checks = block.checks.map(check => {
      const elements = [...document.querySelectorAll(check.selector)];
      const normalize = value => value.trim().replace(/\s+/g, ' ');
      const passed = elements.some(element => {
        if (check.kind === 'exists') return true;
        if (check.kind === 'text_nonempty') return normalize(element.textContent).length > 0;
        if (check.kind === 'text_includes') return normalize(element.textContent).includes(normalize(check.value));
        if (check.kind === 'text_equals') return normalize(element.textContent) === normalize(check.value);
        return element.getAttribute(check.attribute) === check.value;
      });
      return { label: check.label, passed };
    });
    const passed = checks.every(check => check.passed);
    return { status: passed ? 'passed' : 'needs_work', source: 'automatic', checks, feedback: passed ? 'Seu HTML passou nas verificações de estrutura. Sua explicação e a aparência da página ainda podem ser discutidas com o tutor.' : 'Alguns requisitos ainda precisam de ajuste. Use a lista abaixo para escolher o próximo passo.' };
  }
  advanceDemo(session, block, result, changed) {
    if (session.mode !== 'demo' || session.advanced.includes(block.id)) return;
    if (result.status !== 'passed' && block.type !== 'reflection') return;
    session.advanced.push(block.id);
    if (block.demoStep === 'prediction') {
      this.transitionStage(session, changed, session.progress.lastAttemptId, 'A previsão foi respondida corretamente.');
      this.append(session, demo.practice, changed, { demoStep: 'practice' });
    }
    if (block.demoStep === 'practice') {
      this.transitionStage(session, changed, session.progress.lastAttemptId, 'A estrutura da página passou nas verificações.');
      this.append(session, demo.structure, changed);
      this.append(session, demo.reflection, changed, { demoStep: 'reflection' });
    }
    if (block.demoStep === 'reflection') {
      this.transitionStage(session, changed, session.progress.lastAttemptId, 'A explicação foi registrada na aula de exemplo.');
      this.append(session, demo.transfer, changed, { demoStep: 'transfer' });
    }
    if (block.demoStep === 'transfer') {
      this.transitionStage(session, changed, session.progress.lastAttemptId, 'A estrutura recriada passou nas verificações.');
      this.append(session, { type: 'message', title: 'Você chegou ao fim da experiência', stage: 'transfer', body: 'Sua nova página passou nas verificações de estrutura. Repare no que você conseguiu lembrar e no que precisou consultar. Isso é um ponto de partida para a próxima prática. Para uma aula que se adapta às suas respostas, conecte o MCP ao seu tutor e peça uma nova sessão.' }, changed);
    }
  }
  async submit(id, raw) {
    const input = submissionSchema.parse(raw);
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      if (session.attempts.length >= 1000) throw new AppError('Limite de tentativas desta sessão atingido.');
      const block = session.blocks.find(b => b.id === input.blockId);
      if (!block || !['quiz', 'code', 'reflection'].includes(block.type)) throw new AppError('Atividade não aceita respostas.');
      if (session.progress.activeBlockId !== block.id) throw new AppError('Esta não é a atividade respondível atual. Continue pela atividade aberta no painel.');
      if (session.progress.status === 'awaiting_review') throw new AppError('Esta tentativa está aguardando avaliação do tutor.');
      if (session.progress.status !== 'awaiting_attempt') throw new AppError('A sessão não está aguardando uma tentativa.');
      const result = this.evaluate(block, input);
      const attempt = { ...input, id: randomUUID(), createdAt: now(), hintsUsed: block.revealedHints, result };
      session.attempts.push(attempt);
      this.event(session, 'attempt_submitted', { attemptId: attempt.id, blockId: block.id }, changed);
      this.updateProgressAfterAttempt(session, block, attempt, changed);
      this.advanceDemo(session, block, result, changed);
      return attempt;
    });
  }
  async hint(id, blockId) {
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      const block = session.blocks.find(b => b.id === blockId);
      if (!block?.hints?.length || block.revealedHints >= block.hints.length) throw new AppError('Não há mais dicas preparadas. Peça ajuda ao tutor.');
      const hint = block.hints[block.revealedHints++];
      this.event(session, 'hint_revealed', { blockId, hintNumber: block.revealedHints }, changed);
      return { hint };
    });
  }
  async message(id, body) {
    if (typeof body !== 'string' || !body.trim() || body.length > 5000) throw new AppError('Escreva uma mensagem de até 5.000 caracteres.');
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      const message = this.append(session, { type: 'message', title: 'Sua mensagem', body, stage: session.progress.stage }, changed, { role: 'learner' });
      this.event(session, 'learner_message', { blockId: message.id, body }, changed);
      return message;
    });
  }
  async tutorMessage(id, body, title = 'Seu tutor') {
    if (typeof body !== 'string' || !body.trim() || body.length > 12000) throw new AppError('A resposta do tutor está vazia ou excede 12.000 caracteres.');
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      const message = this.append(session, { type: 'message', title, body, stage: session.progress.stage }, changed, { role: 'tutor' });
      this.event(session, 'tutor_message', { blockId: message.id }, changed);
      return message;
    });
  }
  async review(id, raw) {
    const input = reviewSchema.parse(raw);
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      const attempt = session.attempts.find(a => a.id === input.attemptId);
      if (!attempt) throw new AppError('Tentativa não encontrada.', 404);
      attempt.review = { ...input, source: 'tutor', at: now() };
      this.event(session, 'attempt_reviewed', { attemptId: attempt.id }, changed);
      const isCurrentAttempt = session.progress.lastAttemptId === attempt.id && session.progress.stage === session.blocks.find(block => block.id === attempt.blockId)?.stage && session.progress.status !== 'completed';
      if (isCurrentAttempt) {
        session.progress.status = input.passed ? 'ready_for_transition' : 'awaiting_attempt';
        session.progress.activeBlockId = input.passed ? null : attempt.blockId;
        this.progressChanged(session, changed, { blockId: attempt.blockId, attemptId: attempt.id });
      }
      return attempt;
    });
  }
  async getEvents(id, after = 0, waitSeconds = 0) {
    const read = () => {
      const session = this.session(id);
      return { cursor: session.revision, events: copy(session.events.filter(e => e.cursor > after)) };
    };
    const current = read();
    if (current.events.length || !waitSeconds) return current;
    await new Promise(resolve => {
      const listener = changed => { if (changed === id) finish(); };
      const finish = () => { clearTimeout(timer); this.events.off('change', listener); resolve(); };
      const timer = setTimeout(finish, waitSeconds * 1000);
      this.events.on('change', listener);
      if (read().events.length) finish();
    });
    return read();
  }
}
