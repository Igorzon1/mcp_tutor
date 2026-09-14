import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { blockSchema, sessionSchema, submissionSchema, reviewSchema, reviewCardSchema, recallSchema, ratingSchema } from './schema.js';
import { CodeRunner } from './runner.js';
import { DAY, nextReview, publicReview, learningSummary } from './learning.js';
import { programmingDemo } from './programming-demos.js';
import * as demo from './demo.js';

const now = () => new Date().toISOString();
const copy = value => structuredClone(value);
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class Store {
  constructor(directory, { runner = new CodeRunner() } = {}) {
    this.directory = directory;
    this.file = join(directory, 'sessions.json');
    this.data = { version: 1, sessions: [] };
    this.queue = Promise.resolve();
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);
    this.runner = runner;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.sessions)) throw new Error('Formato de dados incompatível.');
      this.data = data;
      for (const session of this.data.sessions) session.reviews ||= [];
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Não foi possível ler ${this.file}; o arquivo foi preservado. ${error.message}`); }
    return this;
  }
  async mutate(fn) {
    const operation = this.queue.then(async () => {
      const draft = copy(this.data);
      const changed = new Set();
      const result = fn(draft, changed);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(draft, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
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
    return session;
  }
  event(session, type, payload, changed) {
    session.updatedAt = now();
    session.revision += 1;
    session.events.push({ cursor: session.revision, type, at: now(), ...payload });
    changed.add(session.id);
  }
  append(session, rawBlock, changed, extra = {}) {
    if (session.blocks.length >= 120) throw new AppError('Limite de 120 atividades por sessão atingido. Inicie outra sessão.');
    const block = blockSchema.parse(rawBlock);
    if (block.type === 'code') {
      const { document } = parseHTML('<html><body></body></html>');
      for (const check of block.checks) {
        try { document.querySelector(check.selector); } catch { throw new AppError(`Seletor inválido: ${check.selector}`); }
      }
    }
    const entry = { ...block, id: randomUUID(), createdAt: now(), revealedHints: 0, ...extra };
    session.blocks.push(entry);
    this.event(session, 'block_added', { blockId: entry.id }, changed);
    return entry;
  }
  async create(raw, isDemo = false, demoLanguage = 'html') {
    const input = sessionSchema.parse(raw);
    return this.mutate((data, changed) => {
      if (data.sessions.length >= 250) throw new AppError('Limite de sessões atingido.');
      const session = { ...input, id: randomUUID(), mode: isDemo ? 'demo' : 'tutor', demoLanguage: isDemo ? demoLanguage : undefined, createdAt: now(), updatedAt: now(), revision: 0, blocks: [], attempts: [], events: [], advanced: [], reviews: [] };
      data.sessions.push(session);
      this.event(session, 'session_created', {}, changed);
      if (isDemo) {
        const pack = demoLanguage === 'html' ? demo : programmingDemo(demoLanguage);
        this.append(session, pack.intro, changed);
        this.append(session, pack.prediction, changed, { demoStep: 'prediction' });
      }
      return session;
    });
  }
  list() { return this.data.sessions.map(session => { const { id, title, goal, level, mode, updatedAt, revision } = session; return { id, title, goal, level, mode, updatedAt, revision, summary: learningSummary(session) }; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id, publicView = false) {
    const session = copy(this.session(id));
    session.summary = learningSummary(session);
    if (publicView) {
      delete session.events;
      delete session.advanced;
      session.reviews = (session.reviews || []).map(publicReview);
      session.blocks = session.blocks.map(block => {
        const { hints = [], correctIndex, explanation, ...rest } = block;
        return { ...rest, hints: hints.slice(0, block.revealedHints), hintsRemaining: Math.max(0, hints.length - block.revealedHints) };
      });
    }
    return session;
  }
  async addBlock(id, input) { return this.mutate((data, changed) => this.append(this.session(id, data), input, changed)); }
  async evaluate(block, input, signal) {
    if (block.type === 'quiz') {
      if (input.choice === undefined || input.choice >= block.options.length) throw new AppError('Escolha uma das opções.');
      const passed = input.choice === block.correctIndex;
      return { status: passed ? 'passed' : 'needs_work', source: 'automatic', feedback: passed ? block.explanation : 'Sua previsão ainda precisa de revisão. Retome a ideia apresentada e procure explicar cada etapa. Você também pode pedir uma dica.' };
    }
    if (!input.answer?.trim()) throw new AppError('Escreva sua resposta antes de enviar.');
    if (block.type === 'code' && block.language !== 'html') {
      const cases = block.tests?.length ? block.tests : [{ name: 'Execução exploratória', stdin: input.stdin ?? block.stdin ?? '' }];
      const executions = [];
      for (const test of cases) {
        const execution = await this.runner.run({ language: block.language, code: input.answer, stdin: test.stdin, timeoutMs: 5000 }, { signal });
        const normalize = value => value.replace(/\r\n/g, '\n').trimEnd();
        executions.push({ ...execution, name: test.name, stdin: test.stdin, expectedStdout: test.expectedStdout, passed: test.expectedStdout === undefined ? null : execution.status === 'completed' && normalize(execution.stdout) === normalize(test.expectedStdout) });
        if (execution.status !== 'completed') break;
      }
      const ran = executions.every(execution => execution.status === 'completed');
      const passed = block.tests?.length && executions.length === cases.length && executions.every(execution => execution.passed);
      return { status: passed ? 'passed' : ran && !block.tests?.length ? 'pending_review' : 'needs_work', source: 'automatic', executions,
        checks: executions.filter(execution => execution.passed !== null).map(execution => ({ label: execution.name, passed: execution.passed })),
        feedback: passed ? 'As saídas passaram nos casos propostos. Compare isso com sua previsão e explique o cálculo; os testes sozinhos não avaliam seu entendimento.' : !ran ? 'A execução não terminou normalmente. Leia a mensagem do console, escolha uma causa provável e tente um ajuste.' : !block.tests?.length ? 'O programa executou. Não há casos de teste definidos: o tutor ainda precisa avaliar a solução.' : 'Uma ou mais saídas diferem do esperado. Compare entrada, saída esperada e saída obtida para localizar a diferença.' };
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
    const pack = !session.demoLanguage || session.demoLanguage === 'html' ? demo : programmingDemo(session.demoLanguage);
    if (block.demoStep === 'prediction') this.append(session, pack.practice, changed, { demoStep: 'practice' });
    if (block.demoStep === 'practice') {
      this.append(session, pack.structure, changed);
      this.append(session, pack.reflection, changed, { demoStep: 'reflection' });
    }
    if (block.demoStep === 'reflection') this.append(session, pack.transfer, changed, { demoStep: 'transfer' });
    if (block.demoStep === 'transfer') {
      this.append(session, { type: 'message', title: 'O próximo passo é lembrar depois', stage: 'review', body: 'Você concluiu os casos de teste desta experiência. Uma revisão curta ficou agendada para amanhã, na aba Revisões. Tente recuperar a ideia antes de consultar a referência. Para receber feedback sobre suas explicações e adaptar a próxima aula, retome com seu tutor.' }, changed);
      this.scheduleInSession(session, pack.review || { concept: 'Semântica do HTML', prompt: 'Sem consultar: qual é a diferença entre usar h1 e deixar um parágrafo grande com CSS?', referenceAnswer: 'h1 comunica o papel de título principal. CSS altera a aparência; um parágrafo maior continua sendo um parágrafo. A escolha semântica ajuda a organizar e interpretar o documento.' }, changed);
    }
  }
  async submit(id, raw, { signal } = {}) {
    const input = submissionSchema.parse(raw);
    const original = this.session(id);
    if (original.attempts.length >= 1000) throw new AppError('Limite de tentativas desta sessão atingido.');
    const originalBlock = original.blocks.find(b => b.id === input.blockId);
    if (!originalBlock || !['quiz', 'code', 'reflection'].includes(originalBlock.type)) throw new AppError('Atividade não aceita respostas.');
    const result = await this.evaluate(originalBlock, input, signal);
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      if (session.attempts.length >= 1000) throw new AppError('Limite de tentativas desta sessão atingido.');
      const block = session.blocks.find(b => b.id === input.blockId);
      if (!block || !['quiz', 'code', 'reflection'].includes(block.type)) throw new AppError('Atividade não aceita respostas.');
      const attempt = { ...input, id: randomUUID(), createdAt: now(), hintsUsed: originalBlock.revealedHints, result };
      session.attempts.push(attempt);
      this.event(session, 'attempt_submitted', { attemptId: attempt.id, blockId: block.id }, changed);
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
      const message = this.append(session, { type: 'message', title: 'Sua mensagem', body, stage: session.blocks.at(-1)?.stage || 'predict' }, changed, { role: 'learner' });
      this.event(session, 'learner_message', { blockId: message.id, body }, changed);
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
      return attempt;
    });
  }
  scheduleInSession(session, raw, changed) {
    const input = reviewCardSchema.parse(raw);
    session.reviews ||= [];
    if (session.reviews.length >= 100) throw new AppError('Limite de revisões da aula atingido.');
    const card = { ...input, id: randomUUID(), dueAt: input.dueAt || new Date(Date.now() + DAY).toISOString(), createdAt: now(), step: 0, intervalDays: 1, attempts: [] };
    session.reviews.push(card);
    this.event(session, 'review_scheduled', { reviewId: card.id }, changed);
    return card;
  }
  async scheduleReview(id, input) { return this.mutate((data, changed) => this.scheduleInSession(this.session(id, data), input, changed)); }
  getReviews(id, publicView = false) {
    const sessions = id ? [this.session(id)] : this.data.sessions;
    return sessions.flatMap(session => (session.reviews || []).map(card => ({ ...(publicView ? publicReview(card) : copy(card)), sessionId: session.id, sessionTitle: session.title }))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
  async recall(id, reviewId, raw) {
    const input = recallSchema.parse(raw);
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      const card = session.reviews?.find(card => card.id === reviewId);
      if (!card) throw new AppError('Revisão não encontrada.', 404);
      if (card.attempts.at(-1) && !card.attempts.at(-1).rating) throw new AppError('Compare sua tentativa com a referência e faça a autoavaliação primeiro.');
      if (card.attempts.length >= 200) throw new AppError('Limite de tentativas desta revisão atingido.');
      card.attempts.push({ ...input, id: randomUUID(), createdAt: now(), rating: null });
      this.event(session, 'recall_submitted', { reviewId }, changed);
      return publicReview(card);
    });
  }
  async rateRecall(id, reviewId, raw) {
    const { rating } = ratingSchema.parse(raw);
    return this.mutate((data, changed) => {
      const session = this.session(id, data);
      const card = session.reviews?.find(card => card.id === reviewId);
      if (!card) throw new AppError('Revisão não encontrada.', 404);
      const attempt = card.attempts.at(-1);
      if (!attempt || attempt.rating) throw new AppError('Envie uma nova resposta antes de avaliar sua lembrança.');
      attempt.rating = rating;
      attempt.ratedAt = now();
      Object.assign(card, nextReview(card, rating));
      this.event(session, 'recall_rated', { reviewId, rating, dueAt: card.dueAt }, changed);
      return publicReview(card);
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
