import { mountLab, attachExecution, executionMarkup, isLocalCode } from './lab.js';
import { mountReviews } from './reviews.js';
import { formatMessage } from './message-format.js';
import { installCodeEditor } from './code-editor.js';
import { installStudyResize } from './study-layout.js';
const $ = (selector, parent = document) => parent.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stages = { predict: 'Prever', practice: 'Praticar', explain: 'Explicar', transfer: 'Aplicar de novo' };
const progressStatuses = { ready_for_activity: 'Pronto para a próxima atividade', awaiting_attempt: 'Aguardando sua tentativa', awaiting_review: 'Aguardando a avaliação do tutor', ready_for_transition: 'Objetivo demonstrado · tutor decide o próximo passo', completed: 'Sessão concluída' };
const languageLabels = { html: 'HTML/CSS', python: 'Python', java: 'Java', javascript: 'JavaScript', c: 'C', cpp: 'C++' };
const filenames = { html: 'index.html', python: 'main.py', java: 'Main.java', javascript: 'main.js', c: 'main.c', cpp: 'main.cpp' };
const types = { lesson: ['UMA IDEIA PARA ENTENDER', '▤'], code: ['EXERCÍCIO DE CÓDIGO', '&lt;/&gt;'], quiz: ['PARE & PENSE', '◇'], reflection: ['COM SUAS PALAVRAS', '↳'], diagram: ['EXPLORE A IDEIA', '⌘'], chart: ['OBSERVE OS DADOS', '▥'] };
const agentPhases = {
  starting: ['Abrindo o tutor…', 'Enviando sua mensagem ao painel.'],
  connecting: ['Conectando ao agente…', 'Mensagem recebida. Preparando a conversa desta aula.'],
  thinking: ['Pensando no próximo passo…', 'Relacionando sua mensagem ao plano e ao desafio atual.'],
  reading_session: ['Lendo sua aula…', 'Consultando plano, tentativas e progresso.'],
  updating_plan: ['Atualizando seu plano…', 'Organizando objetivos e checkpoints.'],
  creating_activity: ['Criando o próximo desafio…', 'Preparando uma tarefa pequena para você praticar.'],
  reviewing_attempt: ['Revisando sua tentativa…', 'Comparando sua resposta com a evidência esperada.'],
  advancing_stage: ['Avançando a aula…', 'Registrando a etapa concluída e preparando a próxima.'],
  using_tools: ['Atualizando sua aula…', 'Registrando mudanças no painel.'],
  finishing: ['Escrevendo a resposta…', 'Finalizando a orientação que aparecerá na conversa.'],
  idle: ['Tutor disponível', 'Pronto para continuar a conversa.'],
};
let session;
let currentView = 'home';
let cancelLab;
const exerciseCancels = new Set();
function cancelExecutions() { for (const cancel of exerciseCancels) cancel(); exerciseCancels.clear(); }
let eventSource;
let toastTimer;
let loadingGeneration = 0;
let syncing = false;
let syncAgain = false;
let agentInfo;
let chatPending = false;
let chatPendingSessionId;
let chatAgentState;
let chatStatusTimer;
let chatStartedAt = 0;
let renderedMessageCount = 0;
let openingSessionId;
let selectedBlockId;
let panelOnline = false;
let statusFetching = false;
let lastFailedMessage = '';
let forceChatScroll = false;
const requestSessions = new Set();
const narrowLayout = matchMedia('(max-width:1190px)');
const studyResize = installStudyResize(document, window);

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}
async function api(path, data, options = {}) {
  const response = await fetch(path, data === undefined ? options : { ...options, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tutor-Client': 'browser' }, body: JSON.stringify(data) });
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) {
    const error = new Error(result.error || 'Não foi possível concluir a ação.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function connection(online) {
  panelOnline = online;
  $('#connection-dot').classList.toggle('offline', !online);
  $('#connection-label').textContent = online ? 'Painel local conectado' : 'Reconectando ao painel';
  renderAgentStatus();
}
function sessionHash() { return new URLSearchParams(location.hash.slice(1)).get('session'); }
async function refreshList() {
  const { sessions } = await api('/api/sessions');
  const due = sessions.reduce((sum, item) => sum + (item.summary?.reviewsDue || 0), 0);
  $('#review-badge').textContent = due;
  $('#review-badge').hidden = due === 0;
  $('#home-sessions').innerHTML = sessions.length ? `<h2>Continue de onde parou</h2>${sessions.slice(0, 5).map(item => `<a href="#session=${item.id}" class="home-session"><span><strong>${escape(item.title)}</strong><small>${escape(item.goal)}</small></span><b>${item.summary?.attempted || 0} atividades tentadas ↗</b></a>`).join('')}` : '';
  $('#session-list').replaceChildren();
  if (!sessions.length) $('#session-list').innerHTML = '<p class="muted sidebar-empty">Suas aulas aparecerão aqui.</p>';
  for (const item of sessions) {
    const button = document.createElement('button');
    button.className = `session-item${item.id === session?.id ? ' active' : ''}`;
    button.innerHTML = `<span>${escape(item.title)}</span><small>${item.mode === 'demo' ? 'Aula de exemplo' : 'Conversa com seu tutor'}</small>`;
    if (item.id === session?.id) button.setAttribute('aria-current', 'page');
    button.onclick = () => { closeDrawers(); location.hash = `session=${item.id}`; };
    $('#session-list').append(button);
  }
  return sessions;
}
function latestAttempt(blockId) { return session.attempts.filter(attempt => attempt.blockId === blockId).at(-1); }
function draftKey(blockId) { return `mcp-tutor:draft:${session.id}:${blockId}`; }
function readDraft(blockId) {
  try { return JSON.parse(localStorage.getItem(draftKey(blockId))) || latestAttempt(blockId) || {}; } catch { return latestAttempt(blockId) || {}; }
}
function saveDraft(blockId, form) {
  const data = new FormData(form);
  try { localStorage.setItem(draftKey(blockId), JSON.stringify(Object.fromEntries(data))); } catch { /* Drafts are optional; submitted work remains persisted by the service. */ }
}
function renderAgentStatus() {
  const element = $('#agent-status');
  const pendingHere = chatPending && chatPendingSessionId === session?.id;
  let label = 'Conexão disponível ao enviar';
  let style = 'agent-status';
  if (!panelOnline) { label = 'Reconectando ao painel…'; style += ' error'; }
  else if (session?.mode === 'demo') { label = 'Aula de exemplo · sem IA'; style += ' manual'; }
  else if (pendingHere) { label = 'Luna está respondendo'; style += ' busy'; }
  else if (!agentInfo?.enabled) { label = 'Chat desativado · ver conexão e ajuda'; style += ' manual'; }
  else if (chatAgentState?.phase === 'failed') { label = 'Resposta interrompida · tente novamente'; style += ' error'; }
  else if (chatAgentState?.phase === 'cancelled') label = 'Resposta interrompida por você';
  else if (chatAgentState?.phase === 'completed') { label = 'Luna respondeu · continue quando quiser'; style += ' connected'; }
  element.textContent = label;
  element.className = style;
}
function renderConversationOnboarding() {
  $('#conversation-onboarding').hidden = !session || session.blocks.some(block => ['message', 'lesson'].includes(block.type)) || (chatPending && chatPendingSessionId === session.id);
}
function chatElapsedSeconds() {
  const startedAt = Number(chatAgentState?.startedAt) || chatStartedAt;
  return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
}
function renderChatPending() {
  const pendingHere = chatPending && chatPendingSessionId === session?.id;
  $('#chat-pending').hidden = !pendingHere;
  if (pendingHere) {
    const elapsed = chatElapsedSeconds();
    const phase = agentPhases[chatAgentState?.phase] || agentPhases.starting;
    const detail = elapsed >= 45
      ? `${phase[1]} Limite desta resposta: ${agentInfo?.timeoutSeconds || 180}s. Você pode parar e tentar novamente.`
      : phase[1];
    // Only announce phase changes; the timer is decorative for screen readers.
    if ($('#chat-pending-title').textContent !== phase[0]) $('#chat-pending-title').textContent = phase[0];
    if ($('#chat-pending-detail').textContent !== detail) $('#chat-pending-detail').textContent = detail;
    $('#chat-pending-time').textContent = `${elapsed}s`;
  }
  $('#message-form').classList.toggle('is-pending', pendingHere);
  $('.send-button').disabled = pendingHere || !panelOnline;
  $('#cancel-chat').disabled = !chatAgentState?.active;
  $('#retry-chat').disabled = pendingHere;
  renderConversationOnboarding();
}
function startChatTracking(sessionId) {
  requestSessions.add(sessionId);
  chatPending = true;
  chatPendingSessionId = sessionId;
  chatStartedAt = Date.now();
  chatAgentState = { phase: 'starting', startedAt: chatStartedAt, active: false };
  renderChatPending();
  renderAgentStatus();
}
function stopChatTracking(sessionId) {
  requestSessions.delete(sessionId);
  if (session?.id !== sessionId) return;
  chatPending = false;
  chatPendingSessionId = undefined;
  renderChatPending();
  renderAgentStatus();
}
function showSessionLoading(id) {
  openingSessionId = id;
  $('#welcome').hidden = true;
  $('#lesson').hidden = false;
  $('#session-loading').hidden = false;
  $('#session-error').hidden = true;
  $('#lesson-heading')?.setAttribute('aria-busy', 'true');
}
function showSessionError(error, id) {
  openingSessionId = id;
  $('#session-loading').hidden = true;
  $('#session-error').hidden = false;
  $('#session-error-message').textContent = error.message || 'Tente novamente em alguns instantes.';
  $('#lesson-heading')?.setAttribute('aria-busy', 'false');
  $('#retry-session')?.focus({ preventScroll: true });
}
function activeChallenge() {
  if (!session) return null;
  const progress = session.progress || { stage: 'predict' };
  const active = session.blocks.find(block => block.id === progress.activeBlockId);
  const latest = session.blocks.filter(block => ['quiz', 'code', 'reflection'].includes(block.type) && block.stage === progress.stage).at(-1)
    || session.blocks.filter(block => block.type !== 'message' && block.stage === progress.stage).at(-1);
  return active || latest || null;
}
function currentChallenge() {
  return session?.blocks.find(block => block.id === selectedBlockId) || activeChallenge();
}
function renderStudyTools() {
  const current = currentChallenge();
  const active = activeChallenge();
  const materials = session.blocks.filter(block => block.type !== 'message');
  const select = $('#activity-select');
  select.replaceChildren();
  if (!materials.length) select.innerHTML = '<option>Nenhuma atividade ainda</option>';
  for (const block of materials.toReversed()) {
    const option = document.createElement('option');
    option.value = block.id;
    option.textContent = `${block.id === active?.id ? 'Atual · ' : ''}${block.title}`;
    option.selected = block.id === current?.id;
    select.append(option);
  }
  select.disabled = !materials.length;
  $('#study-indicator').hidden = !session.progress?.activeBlockId;
  $('#ask-about-activity').hidden = !current;
  $('#study-hints').innerHTML = current?.hints?.length
    ? current.hints.map((hint, index) => `<div class="hint"><strong>Dica ${index + 1}</strong><br>${escape(hint)}</div>`).join('')
    : '<p class="muted">Nenhuma dica aberta ainda. Você pode revelar uma dica preparada ou conversar com o tutor.</p>';
  $('#next-hint').hidden = !current?.hintsRemaining;
  $('#next-hint').disabled = current?.id !== session.progress?.activeBlockId;
}
function chooseStudyTab(name, focus = false) {
  for (const button of document.querySelectorAll('[data-study-tab]')) {
    const selected = button.dataset.studyTab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#pane-${button.dataset.studyTab}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
}
function updateDrawerState() {
  const studyOpen = narrowLayout.matches ? document.body.classList.contains('study-open') : !document.body.classList.contains('study-hidden');
  const sessionsOpen = document.body.classList.contains('sessions-open');
  $('#toggle-study').setAttribute('aria-expanded', String(studyOpen));
  $('#toggle-sessions').setAttribute('aria-expanded', String(sessionsOpen));
  $('#panel-backdrop').hidden = !(narrowLayout.matches && studyOpen || sessionsOpen);
  $('.conversation-panel').inert = !$('#panel-backdrop').hidden;
  $('.topbar').inert = !$('#panel-backdrop').hidden;
  $('#sessions-sidebar').inert = narrowLayout.matches && studyOpen;
  studyResize.refresh();
}
function closeDrawers() {
  document.body.classList.remove('study-open', 'sessions-open');
  updateDrawerState();
}
function openStudy(name = 'activity') {
  document.body.classList.remove('study-hidden', 'sessions-open');
  document.body.classList.add('study-open');
  chooseStudyTab(name);
  updateDrawerState();
  if (narrowLayout.matches) $('#close-study').focus();
}
function prepareQuestion(message) {
  closeDrawers();
  const input = $('#message');
  // Preserve any question the learner was already composing.
  if (!input.value.trim()) input.value = message;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function scrollToLatest() {
  const scroll = $('#conversation-scroll');
  scroll.scrollTop = scroll.scrollHeight;
  $('#latest-message').hidden = true;
}
function renderChallengeRail() {
  if (!session) return;
  const progress = session.progress || { stage: 'predict', status: 'ready_for_activity', completedStages: [] };
  const challenge = currentChallenge();
  const statusText = progressStatuses[progress.status] || 'Estado da aula atualizado';
  $('#rail-stage').textContent = stages[challenge?.stage || progress.stage] || progress.stage;
  $('#rail-status').textContent = statusText;
  $('#rail-meter-fill').style.width = `${Math.min(100, Math.max(0, ((progress.completedStages?.length || 0) + (progress.status === 'completed' ? 1 : 0)) / Object.keys(stages).length * 100))}%`;
  $('#challenge-focus').hidden = !selectedBlockId || selectedBlockId === activeChallenge()?.id;
  $('#challenge-focus').onclick = () => { selectedBlockId = undefined; renderSession(); };
  if (!challenge) {
    $('#challenge-badge').textContent = progress.status === 'ready_for_activity' ? 'Aguardando' : 'Em revisão';
    $('#challenge-title').textContent = session.attempts.length ? 'Sua próxima prática' : 'Primeiro, vamos entender a ideia';
    $('#challenge-prompt').textContent = session.plan
      ? 'Leia a explicação e o exemplo no chat. Tire suas dúvidas ou diga que quer praticar; o exercício aparecerá aqui depois da mini-lição.'
      : 'Converse com o tutor para definir o ponto de partida. Ele vai explicar a primeira ideia com um exemplo antes de colocar uma atividade aqui.';
    $('#challenge-requirements').replaceChildren();
    return;
  }
  const attempt = latestAttempt(challenge.id);
  const kind = challenge.type === 'code'
    ? languageLabels[challenge.language]
    : ({ quiz: 'Pergunta', reflection: 'Reflexão', diagram: 'Diagrama', chart: 'Dados' })[challenge.type] || 'Atividade';
  $('#challenge-badge').textContent = kind;
  $('#challenge-title').textContent = challenge.title;
  $('#challenge-prompt').innerHTML = formatMessage(challenge.prompt || challenge.caption || challenge.body);
  const checks = challenge.type === 'code' && challenge.language !== 'html' ? challenge.tests : challenge.checks;
  const labels = checks?.length ? checks.map(check => check.label || check.name) : challenge.type === 'quiz' ? [`${challenge.options?.length || 0} opções para escolher`] : [];
  $('#challenge-requirements').innerHTML = labels.length
    ? `<span>O QUE OBSERVAR</span><ul>${labels.map(label => `<li>${escape(label)}</li>`).join('')}</ul>`
    : challenge.type === 'reflection'
      ? '<span>O tutor avaliará sua explicação; o campo de raciocínio complementar é opcional.</span>'
      : '<span>Explore esta atividade e use a conversa para compartilhar o que percebeu.</span>';
  if (attempt) $('#challenge-badge').textContent = attempt.review
    ? (attempt.review.passed ? 'Revisado' : 'Ajustar')
    : attempt.result.status === 'pending_review' || attempt.result.source === 'browser' ? 'Em revisão'
      : attempt.result.status === 'passed' ? 'Verificado' : kind;
  document.querySelectorAll('.rail-stages span').forEach((element, index) => element.classList.toggle('done', index < (progress.completedStages?.length || 0)));
}
async function refreshAgentStatus(sessionId = session?.id) {
  if (statusFetching) return;
  statusFetching = true;
  try {
    const info = await api(`/api/agent${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    if (sessionId && session?.id !== sessionId) return;
    const wasPending = chatPending;
    agentInfo = info;
    connection(true);
    const state = info.session;
    const inFlight = requestSessions.has(sessionId);
    if (state?.active || !inFlight) chatAgentState = state;
    chatPending = !!state?.active || inFlight;
    chatPendingSessionId = chatPending ? sessionId : undefined;
    if (state?.active) chatStartedAt = state.startedAt;
    if (['failed', 'cancelled'].includes(state?.phase) && !inFlight) {
      const cancelled = state.phase === 'cancelled';
      $('#chat-error strong').textContent = cancelled ? 'Você interrompeu esta resposta.' : 'Não foi possível concluir a resposta.';
      $('#chat-error-message').textContent = cancelled ? 'Resposta interrompida. Sua mensagem está salva; você pode retomá-la.' : state.lastError || 'Tente novamente em alguns instantes.';
      $('#chat-error').classList.toggle('cancelled', cancelled);
      $('#retry-chat').textContent = cancelled ? 'Retomar resposta' : 'Tentar novamente';
      $('#chat-error').hidden = false;
      lastFailedMessage = session?.blocks.filter(block => block.role === 'learner').at(-1)?.body || '';
    }
    if (wasPending && !chatPending) void syncSession();
  } catch { connection(false); }
  finally { statusFetching = false; renderAgentStatus(); renderChatPending(); }
}
function planValue(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(item => planValue(item)).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return String(value.label || value.title || value.objective || value.summary || value.text || '').trim();
  return value == null ? '' : String(value).trim();
}
function renderPlanRail() {
  if (!session) return;
  const card = $('#rail-plan');
  if (!card) return;
  const plan = session.plan;
  const hasPlan = !!plan && typeof plan === 'object';
  card.classList.toggle('plan-empty', !hasPlan);
  $('#plan-state').textContent = hasPlan ? 'Plano ativo' : 'Em construção';
  $('#rail-plan-title').textContent = hasPlan ? 'Seu caminho de aprendizagem' : 'Seu plano vai nascer da conversa';
  $('#rail-plan-summary').textContent = hasPlan
    ? planValue(plan.summary) || 'O tutor vai ajustar este caminho conforme suas tentativas.'
    : 'Conte o que você quer aprender para o tutor montar um caminho com resultados observáveis.';

  const outcomes = Array.isArray(plan?.outcomes) ? plan.outcomes.map(planValue).filter(Boolean) : session.objectives || [];
  const outcomeContainer = $('#plan-outcomes');
  outcomeContainer.replaceChildren();
  outcomeContainer.hidden = !outcomes.length;
  if (outcomes.length) {
    const label = document.createElement('span');
    label.className = 'checkpoint-label';
    label.textContent = 'RESULTADOS ESPERADOS';
    const list = document.createElement('ul');
    outcomes.slice(0, 4).forEach(outcome => {
      const item = document.createElement('li');
      item.textContent = outcome;
      list.append(item);
    });
    outcomeContainer.append(label, list);
  }

  const progress = session.progress || { stage: 'predict' };
  const checkpoint = Array.isArray(plan?.checkpoints)
    ? plan.checkpoints.find(item => item && item.stage === progress.stage)
    : null;
  const checkpointCard = $('#current-checkpoint');
  checkpointCard.hidden = !checkpoint;
  if (checkpoint) {
    $('#checkpoint-objective').textContent = planValue(checkpoint.objective) || `Avançar em ${stages[progress.stage] || progress.stage}`;
    $('#checkpoint-evidence').textContent = planValue(checkpoint.evidence) || 'Uma tentativa registrada nesta etapa.';
  }
}
function renderSession() {
  if (currentView !== 'lesson') return;
  $('#welcome').hidden = true;
  $('#lesson').hidden = false;
  studyResize.refresh();
  $('#session-loading').hidden = true;
  $('#session-error').hidden = true;
  $('#lesson-heading')?.setAttribute('aria-busy', 'false');
  document.title = `${session.title} · Ateliê`;
  $('#breadcrumb').textContent = session.title;
  $('#lesson-title').textContent = session.title;
  $('#lesson-goal').textContent = session.goal;
  $('#lesson-mode').textContent = session.mode === 'demo' ? `EXEMPLO · ${(session.demoLanguage || 'html').toUpperCase()} · ${session.timeBudgetMinutes || 25} MIN SUGERIDOS` : 'SUA CONVERSA DE APRENDIZAGEM';
  $('.model-badge').textContent = session.mode === 'demo' ? 'Roteiro guiado' : '✦ Luna';
  $('#attempt-count').textContent = `${session.attempts.length} tentativa${session.attempts.length === 1 ? '' : 's'} registrada${session.attempts.length === 1 ? '' : 's'}`;
  $('#composer-note').textContent = session.mode === 'demo' ? 'Modo exemplo: mensagens salvas, sem resposta de IA.' : 'Enter envia · Shift + Enter quebra linha';
  const progress = session.progress || { stage: session.blocks.at(-1)?.stage || 'predict', status: 'ready_for_activity', completedStages: [] };
  const currentStage = progress.stage;
  const challenge = currentChallenge();
  const messageBlocks = session.blocks.filter(block => ['message', 'lesson'].includes(block.type));
  $('#lesson-progress').textContent = `${stages[currentStage]} · ${progressStatuses[progress.status] || 'Estado da aula atualizado'}`;
  $('#learning-path').replaceChildren();
  Object.entries(stages).forEach(([key, label], index) => {
    const complete = progress.completedStages?.includes(key) || (progress.status === 'completed' && key === 'transfer');
    const button = document.createElement('button');
    const available = key === currentStage && !!challenge;
    button.className = `path-step ${available ? 'available' : ''} ${key === currentStage ? 'current' : ''} ${complete ? 'complete' : ''}`;
    button.innerHTML = `<b>${complete ? '✓' : String(index + 1).padStart(2, '0')}</b><span>${escape(label)}</span>`;
    button.disabled = !available;
    if (key === currentStage) button.setAttribute('aria-current', 'step');
    button.onclick = () => { selectedBlockId = undefined; chooseStudyTab('activity'); renderSession(); };
    $('#learning-path').append(button);
  });
  $('#empty-lesson').hidden = true;
  const scroll = $('#conversation-scroll');
  const nearEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
  for (const block of messageBlocks) {
    let element = $(`#block-${block.id}`, $('#blocks'));
    if (!element) {
      element = createBlock(block);
      $('#blocks').append(element);
    }
    updateBlock(block, element);
  }
  const activityPanel = $('#activity-panel');
  if (!challenge) activityPanel.replaceChildren();
  else {
    let activity = $(`#block-${challenge.id}`, activityPanel);
    if (!activity) {
      activityPanel.replaceChildren();
      activity = createBlock(challenge);
      activityPanel.append(activity);
    }
    updateBlock(challenge, activity);
  }
  if (messageBlocks.length > renderedMessageCount) {
    if (!renderedMessageCount && messageBlocks[0]?.type === 'lesson') requestAnimationFrame(() => { scroll.scrollTop = 0; });
    else if (nearEnd || forceChatScroll || !renderedMessageCount) requestAnimationFrame(scrollToLatest);
    else $('#latest-message').hidden = false;
    forceChatScroll = false;
  }
  renderedMessageCount = messageBlocks.length;
  renderConversationOnboarding();
  renderPlanRail();
  renderChallengeRail();
  renderStudyTools();
  renderAgentStatus();
  renderChatPending();
}
function createBlock(block) {
  const element = document.createElement('article');
  element.id = `block-${block.id}`;
  element.className = 'block';
  if (block.type === 'message') {
    const learner = block.role === 'learner';
    element.classList.add('message-block');
    if (learner) element.classList.add('learner');
    element.setAttribute('aria-label', learner ? 'Mensagem sua' : 'Mensagem do tutor');
    const showTitle = !learner && !['Seu tutor', 'Sua mensagem'].includes(block.title);
    element.innerHTML = `<div class="avatar" aria-hidden="true">a</div><div class="message-body"><div class="message-name">${learner ? 'Você' : session.mode === 'demo' ? 'Ateliê · exemplo' : 'Seu tutor'}</div>${showTitle ? `<h3>${escape(block.title)}</h3>` : ''}<div class="message-text">${formatMessage(block.body)}</div></div>`;
    return element;
  }
  const [label, icon] = types[block.type];
  element.classList.add('activity');
  element.innerHTML = `<div class="activity-header"><span class="activity-type"><span class="type-icon" aria-hidden="true">${icon}</span>${label}</span><span class="activity-status"></span></div><div class="activity-content"><h3>${escape(block.title)}</h3><p class="prompt">${escape(block.prompt || block.caption)}</p><div class="activity-work"></div><div class="hints" aria-live="polite"></div><div class="feedback" aria-live="polite"></div><div class="history"></div></div>`;
  if (block.type === 'diagram') renderDiagram(block, $('.activity-work', element));
  else if (block.type === 'chart') renderChart(block, $('.activity-work', element));
  else if (block.type === 'lesson') {
    $('.prompt', element).textContent = block.body;
    $('.activity-work', element).innerHTML = `${block.example ? `<div class="worked-example"><div class="field-label">EXEMPLO RESOLVIDO · ${escape(block.example.language.toUpperCase())}</div><pre><code>${escape(block.example.code)}</code></pre><p>${escape(block.example.explanation)}</p></div>` : ''}${block.takeaways?.length ? `<ul class="takeaways">${block.takeaways.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}`;
  }
  else createForm(block, $('.activity-work', element));
  return element;
}
function runJavaScript(block, code) {
  const token = crypto.randomUUID();
  const tests = (block.tests || []).map(test => ({ label: test.label, expression: test.expression }));
  return new Promise(resolve => {
    let finished = false;
    let timer;
    const worker = new Worker('/exercise-worker.js');
    const finish = evidence => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(evidence);
    };
    worker.onmessage = event => {
      if (event.data?.token !== token || event.data?.type !== 'mcp-tutor-js-result') return;
      finish({ status: event.data.status, checks: event.data.checks || [], output: event.data.output || '', error: event.data.error, durationMs: event.data.durationMs });
    };
    worker.onerror = event => finish({ status: 'error', checks: tests.map(test => ({ label: test.label, passed: false })), output: '', error: event.message || 'Falha ao iniciar o executor JavaScript.', durationMs: 0 });
    timer = setTimeout(() => finish({ status: 'timeout', checks: tests.map(test => ({ label: test.label, passed: false })), output: '', error: 'A execução excedeu o limite de 1,5 segundo.', durationMs: 1500 }), 1500);
    worker.postMessage({ token, code, tests });
  });
}
function createForm(block, container) {
  const form = document.createElement('form');
  const draft = readDraft(block.id);
  form.className = 'activity-form';
  let fields = '';
  if (block.type === 'quiz') fields = `<fieldset class="options"><legend class="field-label">Escolha uma opção</legend>${block.options.map((option, index) => `<label class="option"><input type="radio" name="choice" value="${index}" required ${String(draft.choice) === String(index) ? 'checked' : ''}><span>${escape(option)}</span></label>`).join('')}</fieldset>`;
  if (block.type === 'code') {
    const local = isLocalCode(block);
    const javascript = block.language === 'javascript' && !local;
    const fileName = filenames[block.language];
    const requirements = local
      ? `<details class="requirements"><summary>Casos de teste desta atividade</summary><ul>${block.tests?.length ? block.tests.map(test => `<li>${escape(test.name)}: entrada ${escape(JSON.stringify(test.stdin))}, saída ${escape(JSON.stringify(test.expectedStdout))}</li>`).join('') : '<li>O tutor avaliará sua solução.</li>'}</ul></details>`
      : javascript
      ? `<details class="requirements"><summary>O que seu código precisa demonstrar</summary><ul>${block.tests?.length ? block.tests.map(test => `<li>${escape(test.label)}</li>`).join('') : '<li>O tutor avaliará sua solução.</li>'}</ul></details>`
      : `<details class="requirements"><summary>O que sua página precisa ter</summary><ul>${block.checks.length ? block.checks.map(check => `<li>${escape(check.label)}</li>`).join('') : '<li>O tutor avaliará sua solução.</li>'}</ul></details>`;
    const action = local ? '<div><button type="button" class="stop-execution" hidden>Parar</button><button type="button" class="run-local">▷ Executar</button></div>' : javascript ? '<button type="button" class="run-code">▷ &nbsp; Executar testes</button>' : '<button type="button" class="run-preview">▷ &nbsp; Visualizar</button>';
    const result = local ? `<label class="field-label" for="stdin-${block.id}">Entrada do programa (stdin)</label><textarea class="stdin-input" name="stdin" id="stdin-${block.id}" maxlength="8000" rows="2">${escape(draft.stdin ?? block.stdin ?? '')}</textarea><p class="field-help">Ao enviar a tentativa, os casos de teste são executados novamente.</p><div class="execution-output" hidden aria-live="polite"></div>` : javascript ? '<div class="runtime-output" hidden><div class="runtime-output-heading"><span>RESULTADO DOS TESTES</span><span class="runtime-status"></span></div><div class="runtime-checks"></div><pre class="runtime-result"></pre></div>' : '<div class="preview" hidden><div class="preview-bar"><span>SUA PÁGINA</span><span>HTML + CSS · sem JavaScript ou rede</span></div><iframe title="Prévia da sua página HTML" sandbox="" referrerpolicy="no-referrer"></iframe></div>';
    fields = `${requirements}<div class="editor-shell"><div class="editor-bar"><span class="editor-file"><span aria-hidden="true">◇</span> ${fileName}</span>${action}</div><div class="editor-body"><pre class="line-numbers" aria-hidden="true"></pre><textarea class="code-editor" name="answer" aria-label="Código ${languageLabels[block.language]} da atividade ${escape(block.title)}" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="50000" required>${escape(draft.answer ?? block.starterCode)}</textarea></div></div>${result}`;
  }
  if (block.type === 'reflection') fields = `<label class="field-label" for="answer-${block.id}">Sua explicação</label><textarea class="answer" id="answer-${block.id}" name="answer" rows="4" maxlength="5000" placeholder="Escreva do seu jeito. Seu raciocínio importa." required>${escape(draft.answer || '')}</textarea>`;
  const reasoningTitle = block.type === 'reflection' ? 'Complementar sua explicação' : 'Contar como você pensou';
  const reasoningPlaceholder = block.type === 'reflection'
    ? 'Se sua explicação já está completa, deixe este campo em branco.'
    : 'Se quiser, conte sua estratégia ou onde teve dúvida.';
  fields += `<details class="optional-reasoning" ${draft.reasoning ? 'open' : ''}><summary>${reasoningTitle} <span>(opcional)</span></summary><label class="sr-only" for="reason-${block.id}">${reasoningTitle}, opcional</label><textarea class="reasoning" id="reason-${block.id}" name="reasoning" rows="2" maxlength="5000" placeholder="${reasoningPlaceholder}">${escape(draft.reasoning || '')}</textarea></details><div class="response-bottom"><label class="confidence">Sua confiança <select name="confidence" aria-label="Sua confiança nesta resposta"><option value="1" ${String(draft.confidence) === '1' ? 'selected' : ''}>Ainda tenho dúvidas</option><option value="2" ${!draft.confidence || String(draft.confidence) === '2' ? 'selected' : ''}>Estou entendendo</option><option value="3" ${String(draft.confidence) === '3' ? 'selected' : ''}>Consigo explicar</option></select></label><div class="actions"><button class="hint-button" type="button">◉ &nbsp; Uma dica</button><button class="primary submit-attempt" type="submit">Enviar tentativa <span aria-hidden="true">↗</span></button></div></div>`;
  form.innerHTML = fields;
  form.runtimeEvidence = null;
  container.append(form);
  form.addEventListener('input', event => {
    form.runtimeEvidence = null;
    saveDraft(block.id, form);
    const output = $('.runtime-output', form);
    if (event.target.matches('.code-editor') && output && !output.hidden) {
      output.className = 'runtime-output';
      $('.runtime-status', output).textContent = 'Código alterado — execute novamente';
      $('.runtime-checks', output).replaceChildren();
      $('.runtime-result', output).textContent = '';
    }
  });
  if (block.type === 'code') {
    const editor = $('.code-editor', form);
    const lineNumbers = $('.line-numbers', form);
    const lines = () => { lineNumbers.textContent = Array.from({ length: Math.max(7, editor.value.split('\n').length) }, (_, index) => index + 1).join('\n'); };
    lines();
    editor.addEventListener('input', lines);
    editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; });
    if (['html', 'javascript'].includes(block.language)) installCodeEditor(editor, { language: block.language });
    const help = document.createElement('p');
    help.className = 'editor-help';
    help.id = `editor-help-${block.id}`;
    help.textContent = !['html', 'javascript'].includes(block.language) ? 'Um arquivo por execução. Informe a entrada antes de executar. Tab muda o foco.' : block.language === 'javascript'
      ? 'Aspas e parênteses, colchetes e chaves fecham automaticamente. Enter recua; Ctrl/Cmd + ] insere 2 espaços. Tab muda o foco.'
      : 'Tags e aspas de atributos fecham automaticamente. Enter entre tags recua; Ctrl/Cmd + ] insere 2 espaços. Tab muda o foco.';
    editor.setAttribute('aria-describedby', help.id);
    editor.closest('.editor-shell').after(help);
    if (isLocalCode(block)) {
      const cancel = attachExecution({ runButton: $('.run-local', form), stopButton: $('.stop-execution', form), output: $('.execution-output', form), getInput: () => ({ language: block.language, code: editor.value, stdin: form.elements.stdin.value }), api, notify, onBusy: busy => { if (busy) form.dataset.executing = 'true'; else delete form.dataset.executing; updateBlock(block, form.closest('.activity')); } });
      exerciseCancels.add(cancel);
    } else if (block.language === 'javascript') {
      $('.run-code', form).onclick = async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          form.runtimeEvidence = await runJavaScript(block, editor.value);
          const evidence = form.runtimeEvidence;
          const output = $('.runtime-output', form);
          output.hidden = false;
          output.className = `runtime-output ${evidence.status}`;
          $('.runtime-status', output).textContent = evidence.status === 'passed' ? 'Todos os testes passaram' : evidence.status === 'timeout' ? 'Tempo esgotado' : evidence.status === 'error' ? 'Erro na execução' : `${evidence.checks.filter(check => check.passed).length}/${evidence.checks.length} testes`;
          $('.runtime-checks', output).innerHTML = evidence.checks.map(check => `<div class="runtime-check ${check.passed ? 'pass' : 'fail'}"><span aria-hidden="true">${check.passed ? '✓' : '○'}</span>${escape(check.label)}</div>`).join('');
          $('.runtime-result', output).textContent = [evidence.error, evidence.output].filter(Boolean).join('\n');
        } finally { button.disabled = false; }
      };
    } else {
      $('.run-preview', form).onclick = () => {
        $('.preview', form).hidden = false;
        // This is the only intentional HTML insertion: an opaque-origin sandbox.
        // Scripts, forms, popups, navigation capabilities and network loads are disabled.
        $('iframe', form).srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>body{font:15px/1.5 system-ui;padding:18px;color:#2a3040;margin:0}h1{font-size:26px}button{padding:8px 12px}</style></head><body>${editor.value}</body></html>`;
      };
    }
  }
  $('.hint-button', form).onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await api(`/api/sessions/${session.id}/hints`, { blockId: block.id }); await syncSession(); chooseStudyTab('hints'); }
    catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (form.dataset.submitting || session.progress?.activeBlockId !== block.id || session.progress.status !== 'awaiting_attempt') return;
    const sessionId = session.id;
    const demoMode = session.mode === 'demo';
    const button = $('.submit-attempt', form);
    form.dataset.submitting = 'true';
    button.disabled = true;
    const values = Object.fromEntries(new FormData(form));
    const payload = { blockId: block.id, reasoning: values.reasoning || '', confidence: Number(values.confidence) };
    if (values.choice !== undefined) payload.choice = Number(values.choice);
    if (values.answer !== undefined) payload.answer = values.answer;
    if (values.stdin !== undefined) payload.stdin = values.stdin;
    const originalText = button.innerHTML;
    button.textContent = isLocalCode(block) ? 'Executando os testes…' : 'Enviando…';
    if (form.runtimeEvidence) payload.runtimeEvidence = form.runtimeEvidence;
    try {
      await api(`/api/sessions/${sessionId}/attempts`, payload);
      await syncSession();
      if (!demoMode && session?.id === sessionId && agentInfo?.enabled && !chatPending) {
        void sendChat('Enviei minha tentativa na atividade atual. Revise o que fiz, me dê um retorno curto e me ajude com o próximo passo.');
      } else notify(demoMode ? 'Tentativa salva. Veja a próxima atividade no painel.' : 'Tentativa salva. Peça uma revisão na conversa quando o tutor terminar.');
    } catch (error) { notify(error.message); }
    finally { button.innerHTML = originalText; delete form.dataset.submitting; if (form.isConnected) updateBlock(block, form.closest('.activity')); }
  };
}
function updateBlock(block, element) {
  if (block.type === 'message') return;
  const attempts = session.attempts.filter(attempt => attempt.blockId === block.id);
  const attempt = attempts.at(-1);
  const progress = session.progress;
  const status = $('.activity-status', element);
  status.textContent = attempt ? attempt.review ? (attempt.review.passed ? '✓ Avaliada pelo tutor' : '↻ Revise com o tutor') : ({ passed: '✓ Verificação concluída', needs_work: '↻ Mais uma tentativa?', pending_review: 'Aguardando o tutor' })[attempt.result.status] : ['chart', 'diagram', 'lesson'].includes(block.type) ? 'Explore' : 'Sua vez';
  status.classList.toggle('success', !!attempt && (attempt.review ? attempt.review.passed : attempt.result.status === 'passed'));
  const hintButton = $('.hint-button', element);
  const active = progress?.activeBlockId === block.id && progress.status === 'awaiting_attempt';
  if (hintButton) { hintButton.hidden = !block.hintsRemaining; hintButton.disabled = !active; }
  const form = $('.activity-form', element);
  if (form) form.querySelectorAll('input, textarea, select, button').forEach(control => { control.disabled = !active || !!form.dataset.submitting || (!!form.dataset.executing && !control.classList.contains('stop-execution')); });
  $('.hints', element).innerHTML = (block.hints || []).map((hint, index) => `<div class="hint"><strong>Dica ${index + 1}</strong> · ${escape(hint)}</div>`).join('');
  const feedback = $('.feedback', element);
  if (!attempt) return;
  feedback.className = `feedback ${attempt.result.status}`;
  const evidenceLabel = attempt.result.source === 'browser' ? 'EVIDÊNCIA DO EXECUTOR' : 'VERIFICAÇÃO AUTOMÁTICA';
  const runtimeDetails = attempt.result.source === 'browser' && (attempt.result.error || attempt.result.output)
    ? `<details class="runtime-details"><summary>Saída da execução</summary><pre>${escape([attempt.result.error, attempt.result.output].filter(Boolean).join('\n'))}</pre></details>`
    : '';
  feedback.innerHTML = `<span class="feedback-label">${evidenceLabel} · TENTATIVA ${attempts.length}</span><p>${escape(attempt.result.feedback)}</p>${attempt.result.checks ? `<ul class="checklist">${attempt.result.checks.map(check => `<li class="${check.passed ? 'pass' : 'fail'}"><span aria-hidden="true">${check.passed ? '✓' : '○'}</span><span>${escape(check.label)}${check.passed ? '' : ' — ajustar'}</span></li>`).join('')}</ul>` : ''}${runtimeDetails}${attempt.review ? `<div class="review-feedback"><span class="feedback-label">AVALIAÇÃO DO TUTOR · ${attempt.review.passed ? 'OBJETIVO DEMONSTRADO' : 'CONTINUE PRATICANDO'}</span><p>${escape(attempt.review.feedback)}</p></div>` : ''}`;
  if (attempt.result.executions) feedback.innerHTML += `<details class="execution-details"><summary>Ver entradas, saídas e diagnósticos</summary>${attempt.result.executions.map(execution => `<div class="execution-output">${executionMarkup(execution)}</div>`).join('')}</details>`;
  if (attempts.length > 1) $('.history', element).innerHTML = `<details><summary>Ver ${attempts.length} tentativas</summary><ol>${attempts.map(item => `<li>${escape(new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))} · ${item.hintsUsed} dica(s) usadas · ${escape(({ passed: 'Verificação passou', needs_work: 'Ajustes necessários', pending_review: 'Explicação registrada' })[item.result.status])}<details><summary>${item.reasoning ? 'Resposta e raciocínio' : 'Ver resposta'}</summary><pre>${escape(item.answer ?? block.options?.[item.choice] ?? '')}</pre>${item.reasoning ? `<p>${escape(item.reasoning)}</p>` : ''}${item.review ? `<p>Avaliação do tutor: ${escape(item.review.feedback)}</p>` : ''}</details></li>`).join('')}</ol></details>`;
}
function svgElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
function renderDiagram(block, container) {
  const wrap = document.createElement('div');
  wrap.className = 'diagram-wrap';
  const svg = svgElement('svg', { viewBox: '0 0 660 250', class: 'diagram', role: 'group', 'aria-label': block.title });
  const positions = new Map();
  const hasParent = new Set(block.edges.map(edge => edge.to));
  const roots = block.nodes.filter(node => !hasParent.has(node.id));
  const rows = roots.length && roots.length < block.nodes.length ? [roots, block.nodes.filter(node => hasParent.has(node.id))] : [block.nodes.slice(0, Math.ceil(block.nodes.length / 2)), block.nodes.slice(Math.ceil(block.nodes.length / 2))];
  rows.forEach((row, rowIndex) => row.forEach((node, index) => positions.set(node.id, { x: 660 * (index + 1) / (row.length + 1), y: rowIndex ? 177 : 66 })));
  for (const edge of block.edges) {
    const start = positions.get(edge.from), end = positions.get(edge.to);
    svg.append(svgElement('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y }));
    const direction = Math.atan2(end.y - start.y, end.x - start.x);
    const tip = { x: end.x - Math.cos(direction) * 29, y: end.y - Math.sin(direction) * 29 };
    svg.append(svgElement('path', { d: `M ${tip.x - 7 * Math.cos(direction - .5)} ${tip.y - 7 * Math.sin(direction - .5)} L ${tip.x} ${tip.y} L ${tip.x - 7 * Math.cos(direction + .5)} ${tip.y - 7 * Math.sin(direction + .5)}`, fill: 'none', stroke: '#b6acd8', 'stroke-width': 1.5 }));
  }
  const detail = document.createElement('p');
  detail.className = 'diagram-detail';
  detail.setAttribute('aria-live', 'polite');
  detail.textContent = 'Selecione um elemento para entender seu papel.';
  for (const node of block.nodes) {
    const { x, y } = positions.get(node.id);
    const width = Math.min(124, 530 / Math.max(...rows.map(row => row.length)));
    const group = svgElement('g', { class: 'node', tabindex: '0', role: 'button', 'aria-label': node.label });
    const title = svgElement('title'); title.textContent = node.label;
    const label = svgElement('text', { x, y: y + 4, 'text-anchor': 'middle' });
    label.textContent = node.label.length > 14 ? `${node.label.slice(0, 12)}…` : node.label;
    group.append(title, svgElement('rect', { x: x - width / 2, y: y - 24, width, height: 48, rx: 9 }), label);
    const select = () => { svg.querySelectorAll('.node').forEach(n => n.classList.remove('selected')); group.classList.add('selected'); detail.textContent = `${node.label} · ${node.detail || 'Observe suas conexões no diagrama.'}`; };
    group.onclick = select;
    group.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } };
    svg.append(group);
  }
  wrap.append(svg);
  container.append(wrap, detail);
}
function renderChart(block, container) {
  const max = Math.max(...block.points.map(point => point.value), 1);
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `${block.title}. ${block.points.map(point => `${point.label}: ${point.value} ${block.unit}`).join('; ')}`);
  container.innerHTML = block.points.map(point => `<div class="chart-row"><span>${escape(point.label)}</span><div class="chart-track"><div class="chart-fill" style="width:${point.value / max * 100}%"></div></div><span class="chart-value">${escape(point.value.toLocaleString('pt-BR'))} ${escape(block.unit)}</span></div>`).join('');
}
async function syncSession() {
  if (!session) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  const id = session.id;
  try {
    const updated = await api(`/api/sessions/${id}`);
    if (session?.id === id && updated.revision >= session.revision) { session = updated; renderSession(); await refreshList(); }
  } catch (error) { notify(error.message); }
  finally { syncing = false; if (syncAgain) { syncAgain = false; await syncSession(); } }
}
async function openSession(id) {
  currentView = 'lesson';
  $('#lab').hidden = true; $('#reviews').hidden = true; $('#toggle-study').hidden = false;
  document.body.dataset.view = 'lesson';
  cancelExecutions();
  if (session) {
    try { localStorage.setItem(`mcp-tutor:chat-draft:${session.id}`, $('#message').value); } catch { /* Best effort. */ }
  }
  const generation = ++loadingGeneration;
  eventSource?.close();
  showSessionLoading(id);
  try {
    const next = await api(`/api/sessions/${id}`);
    if (generation !== loadingGeneration) return;
    session = next;
    selectedBlockId = undefined;
    chatAgentState = undefined;
    chatPending = requestSessions.has(id);
    chatPendingSessionId = chatPending ? id : undefined;
    $('#blocks').replaceChildren();
    $('#activity-panel').replaceChildren();
    renderedMessageCount = 0;
    $('#message').value = '';
    $('#chat-error').hidden = true;
    lastFailedMessage = '';
    try {
      $('#message').value = localStorage.getItem(`mcp-tutor:chat-draft:${id}`) || '';
      $('#study-notes').value = localStorage.getItem(`mcp-tutor:notes:${id}`) || '';
      $('#notes-status').textContent = 'Notas privadas, salvas neste navegador.';
    } catch { $('#study-notes').value = ''; $('#notes-status').textContent = 'O navegador não permitiu recuperar notas locais.'; }
    renderSession();
    await refreshAgentStatus(id);
    await refreshList();
    if (generation !== loadingGeneration || currentView !== 'lesson') return;
    if (!session.blocks.length) $('#message').focus({ preventScroll: true });
    eventSource = new EventSource(`/api/sessions/${id}/events`);
    eventSource.onopen = () => { connection(true); void syncSession(); };
    eventSource.onerror = () => connection(false);
    eventSource.onmessage = event => {
      const { revision } = JSON.parse(event.data);
      if (session?.id === id && revision > session.revision) void syncSession();
    };
  } catch (error) {
    if (generation !== loadingGeneration) return;
    showSessionError(error, id);
    connection(false);
  }
}
async function newDemo(button, language) {
  button.disabled = true;
  try { const created = await api('/api/demo', { language }); $('#demo-dialog').close(); location.hash = `session=${created.id}`; }
  catch (error) { notify(error.message); }
  finally { button.disabled = false; }
}
async function chooseDemo() {
  closeDrawers(); $('#demo-dialog').showModal();
  $('#demo-options').innerHTML = '<p role="status">Verificando linguagens…</p>';
  try {
    const { demos } = await api('/api/demos');
    $('#demo-options').innerHTML = demos.map(demo => `<button class="demo-option" data-language="${demo.language}" ${demo.available ? '' : 'disabled'}><span class="demo-language">${demo.language.toUpperCase()}</span><strong>${escape(demo.title)}</strong><span>${escape(demo.description)}</span><small>${demo.available ? 'Teoria + prática + revisão ↗' : 'Executor indisponível — veja o Laboratório'}</small></button>`).join('');
    for (const button of $('#demo-options').querySelectorAll('button')) button.onclick = () => newDemo(button, button.dataset.language);
  } catch (error) { notify(error.message); }
}
$('#start-demo').onclick = chooseDemo;
$('#close-demo').onclick = () => $('#demo-dialog').close();
const newSessionDialog = $('#new-session-dialog');
$('#new-chat').onclick = $('#welcome-new').onclick = () => { closeDrawers(); newSessionDialog.showModal(); $('#new-session-name').focus(); };
$('#close-new-session').onclick = () => newSessionDialog.close();
$('#new-session-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('button[type="submit"]', event.currentTarget);
  const values = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  try {
    const created = await api('/api/sessions', { title: values.title, goal: values.goal, level: values.level, startTutor: true });
    newSessionDialog.close();
    location.hash = `session=${created.id}`;
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
};
const dialog = $('#connect-dialog');
$('#open-connect').onclick = $('#welcome-connect').onclick = () => dialog.showModal();
$('#close-connect').onclick = () => dialog.close();
$('#copy-prompt').onclick = async () => {
  try { await navigator.clipboard.writeText($('#starter-prompt').textContent); notify('Mensagem copiada. Cole na conversa com seu tutor.'); }
  catch { notify('Selecione a mensagem acima e copie com Ctrl+C.'); }
};
$('#retry-session').onclick = () => { if (openingSessionId) void openSession(openingSessionId); };
document.querySelectorAll('.prompt-suggestion').forEach(button => {
  button.onclick = () => {
    const message = $('#message');
    message.value = button.dataset.prompt || '';
    message.focus();
    message.dispatchEvent(new Event('input', { bubbles: true }));
  };
});
$('#message').addEventListener('input', () => {
  const input = $('#message');
  input.style.height = 'auto';
  input.style.height = `${Math.min(150, input.scrollHeight)}px`;
  if (session) try { localStorage.setItem(`mcp-tutor:chat-draft:${session.id}`, input.value); } catch { /* Optional browser draft. */ }
});
$('#message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(pointer:coarse)').matches) {
    event.preventDefault();
    $('#message-form').requestSubmit();
  }
});
async function sendChat(message, retry = false) {
  if (!session || chatPending || !panelOnline) return;
  const id = session.id;
  const demoMode = session.mode === 'demo';
  if (!message.trim() && !retry) return;
  $('#chat-error').hidden = true;
  forceChatScroll = true;
  $('#chat-error').classList.remove('cancelled');
  $('#chat-error strong').textContent = 'Não foi possível concluir a resposta.';
  $('#retry-chat').textContent = 'Tentar novamente';
  startChatTracking(id);
  try {
    const path = demoMode ? `/api/sessions/${id}/messages` : `/api/sessions/${id}/chat`;
    const result = await api(path, retry ? { retry: true } : { body: message });
    if (session?.id === id) {
      chatAgentState = result.agent?.session;
      await syncSession();
      if (demoMode) notify('Anotação salva nesta aula de exemplo.');
    }
  } catch (error) {
    if (session?.id === id) {
      await syncSession();
      if (error.status !== 499) {
        lastFailedMessage = message || session.blocks.filter(block => block.role === 'learner').at(-1)?.body || '';
        $('#chat-error-message').textContent = error.message;
        $('#chat-error').hidden = false;
        chatAgentState = { phase: 'failed' };
      } else {
        chatAgentState = { phase: 'cancelled' };
      }
    }
  } finally {
    stopChatTracking(id);
    if (session?.id === id) await refreshAgentStatus(id);
  }
}
$('#message-form').onsubmit = event => {
  event.preventDefault();
  if (!session || chatPending || !panelOnline) return;
  const input = $('#message');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  void sendChat(message);
};
$('#retry-chat').onclick = () => {
  const last = session?.blocks.filter(block => block.role === 'learner').at(-1);
  void sendChat(lastFailedMessage || last?.body || '', !!last && (!lastFailedMessage || last.body === lastFailedMessage));
};
$('#cancel-chat').onclick = async event => {
  const button = event.currentTarget;
  const id = session?.id;
  button.disabled = true;
  try {
    const result = await api(`/api/sessions/${id}/chat/cancel`, {});
    if (session?.id === id) {
      chatAgentState = result.agent.session;
      chatPending = false;
      chatPendingSessionId = undefined;
      renderChatPending();
      renderAgentStatus();
    }
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
};
$('#study-notes').addEventListener('input', event => {
  if (!session) return;
  try {
    localStorage.setItem(`mcp-tutor:notes:${session.id}`, event.target.value);
    $('#notes-status').textContent = 'Salvo neste navegador · somente você vê estas notas.';
  } catch { $('#notes-status').textContent = 'Não foi possível salvar. Copie suas notas antes de fechar a página.'; }
});
$('#activity-select').onchange = event => { selectedBlockId = event.target.value; renderSession(); };
$('#next-hint').onclick = async event => {
  const block = currentChallenge();
  const id = session.id;
  event.currentTarget.disabled = true;
  try { await api(`/api/sessions/${id}/hints`, { blockId: block.id }); await syncSession(); }
  catch (error) { notify(error.message); }
  finally { renderStudyTools(); }
};
$('#ask-about-activity').onclick = () => prepareQuestion(`Estou tentando resolver “${currentChallenge()?.title}”, mas não entendi por onde começar. Pode me ajudar com uma dica pequena?`);
$('#ask-hint').onclick = () => prepareQuestion('Estou com uma dúvida na atividade atual. Pode me ajudar a pensar sem entregar a solução?');
$('#latest-message').onclick = scrollToLatest;
$('#conversation-scroll').addEventListener('scroll', () => {
  const scroll = $('#conversation-scroll');
  if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100) $('#latest-message').hidden = true;
});
document.querySelectorAll('[data-study-tab]').forEach(button => {
  button.onclick = () => chooseStudyTab(button.dataset.studyTab);
  button.onkeydown = event => {
    const names = ['activity', 'hints', 'notes', 'plan'];
    let index = names.indexOf(button.dataset.studyTab);
    if (event.key === 'ArrowRight') index = (index + 1) % names.length;
    else if (event.key === 'ArrowLeft') index = (index + names.length - 1) % names.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = names.length - 1;
    else return;
    event.preventDefault();
    chooseStudyTab(names[index], true);
  };
});
$('#toggle-study').onclick = () => {
  if (narrowLayout.matches) {
    if (document.body.classList.contains('study-open')) closeDrawers();
    else openStudy($('[data-study-tab][aria-selected=true]').dataset.studyTab);
  } else { document.body.classList.toggle('study-hidden'); updateDrawerState(); }
};
$('#close-study').onclick = () => {
  if (narrowLayout.matches) closeDrawers();
  else { document.body.classList.add('study-hidden'); updateDrawerState(); }
  $('#toggle-study').focus();
};
$('#toggle-sessions').onclick = () => {
  document.body.classList.remove('study-open');
  document.body.classList.toggle('sessions-open');
  updateDrawerState();
  if (document.body.classList.contains('sessions-open')) $('#new-chat').focus();
};
$('#panel-backdrop').onclick = () => { closeDrawers(); $('#toggle-study').focus(); };
document.addEventListener('keydown', event => {
  const drawer = narrowLayout.matches && document.body.classList.contains('study-open') ? $('#study-panel')
    : document.body.classList.contains('sessions-open') ? $('#sessions-sidebar') : null;
  if (!drawer) return;
  if (event.key === 'Escape') { closeDrawers(); $('#toggle-study').focus(); }
  if (event.key === 'Tab') {
    const controls = [...drawer.querySelectorAll('button, input, select, textarea, a, [tabindex]')].filter(item => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
narrowLayout.addEventListener('change', closeDrawers);
updateDrawerState();
chatStatusTimer = setInterval(() => {
  renderChatPending();
  if (session && !document.hidden) void refreshAgentStatus();
}, 2000);
async function navigate() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('view') && !params.has('session') && location.hash) return;
  const generation = ++loadingGeneration;
  cancelLab?.(); cancelLab = undefined; cancelExecutions(); eventSource?.close(); closeDrawers();
  const id = params.get('session');
  currentView = id ? 'lesson' : ['lab', 'reviews'].includes(params.get('view')) ? params.get('view') : 'home';
  document.body.dataset.view = currentView;
  for (const view of ['welcome','lesson','lab','reviews']) $(`#${view}`).hidden = view !== (currentView === 'home' ? 'welcome' : currentView);
  $('#toggle-study').hidden = currentView !== 'lesson';
  for (const link of document.querySelectorAll('.workspace-nav a')) {
    const active = link.hash === `#view=${currentView === 'lesson' ? 'home' : currentView}`;
    if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  }
  if (id) return openSession(id);
  const label = {home:'Minhas aulas',lab:'Laboratório',reviews:'Revisões'}[currentView];
  $('#breadcrumb').textContent = label; document.title = `${label} · Ateliê`;
  try {
    await refreshList(); if (generation !== loadingGeneration) return;
    if (currentView === 'lab') cancelLab = await mountLab($('#lab'), api, notify);
    if (currentView === 'reviews') await mountReviews($('#reviews'), api, notify, refreshList);
  } catch (error) { notify(error.message); }
}
window.addEventListener('hashchange', () => void navigate());
try {
  await refreshAgentStatus();
  connection(true);
  await navigate();
} catch (error) { connection(false); $('#welcome').hidden = false; notify(`Não foi possível conectar. Execute npm start e recarregue a página. ${error.message}`); }
