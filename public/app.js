import { mountLab, attachExecution, executionMarkup } from './lab.js';
import { mountReviews } from './reviews.js';
const $ = (selector, parent = document) => parent.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stages = { learn: 'Entender', predict: 'Prever', practice: 'Praticar', explain: 'Explicar', transfer: 'Aplicar', review: 'Revisar' };
const types = { lesson: ['UMA IDEIA PARA ENTENDER', '▤'], code: ['EXERCÍCIO DE CÓDIGO', '&lt;/&gt;'], quiz: ['PARE & PENSE', '◇'], reflection: ['COM SUAS PALAVRAS', '↳'], diagram: ['EXPLORE A IDEIA', '⌘'], chart: ['OBSERVE OS DADOS', '▥'] };
const filenames = { html: 'index.html', python: 'main.py', java: 'Main.java', javascript: 'main.js', c: 'main.c', cpp: 'main.cpp' };
let session;
let eventSource;
let toastTimer;
let loadingGeneration = 0;
let syncing = false;
let syncAgain = false;
let currentView = 'home';
let cancelLab;

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}
async function api(path, data, options = {}) {
  const response = await fetch(path, data === undefined ? options : { ...options, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tutor-Client': 'browser' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a ação.');
  return result;
}
function connection(online) {
  $('#connection-dot').classList.toggle('offline', !online);
  $('#connection-label').textContent = online ? 'Painel local conectado' : 'Reconectando ao painel';
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
    button.innerHTML = `<span>▤ &nbsp;${escape(item.title)}</span><small>${item.mode === 'demo' ? 'Aula de exemplo' : 'Conduzida pelo seu tutor'}</small>`;
    if (item.id === session?.id) button.setAttribute('aria-current', 'page');
    button.onclick = () => { location.hash = `session=${item.id}`; };
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
function renderSession() {
  if (currentView !== 'lesson') return;
  $('#welcome').hidden = true;
  $('#lesson').hidden = false;
  document.title = `${session.title} · Ateliê`;
  $('#breadcrumb').textContent = session.title;
  $('#lesson-title').textContent = session.title;
  $('#lesson-goal').textContent = session.goal;
  $('#lesson-mode').textContent = session.mode === 'demo' ? `AULA GUIADA · ${(session.demoLanguage || 'html').toUpperCase()} · ${session.timeBudgetMinutes || 25} MIN SUGERIDOS` : 'AULA CONDUZIDA PELO SEU TUTOR';
  $('#lesson-objectives').innerHTML = (session.objectives || []).length ? `<span class="field-label">AO PRATICAR, PROCURE CONSEGUIR</span><ul>${session.objectives.map(objective => `<li>${escape(objective)}</li>`).join('')}</ul>` : '';
  $('#lesson-summary').textContent = `${session.summary?.attempted || 0} de ${session.summary?.activities || 0} atividades tentadas · ${session.summary?.reviewedByTutor || 0} avaliadas pelo tutor`;
  $('#attempt-count').textContent = `${session.attempts.length} tentativa${session.attempts.length === 1 ? '' : 's'} registrada${session.attempts.length === 1 ? '' : 's'}`;
  $('#composer-note').textContent = session.mode === 'demo' ? 'Modo exemplo: suas anotações ficam salvas. Conecte um tutor para conversar com uma IA.' : 'A mensagem fica disponível para o tutor. Volte à conversa e diga que enviou.';
  const currentStage = session.blocks.at(-1)?.stage || 'predict';
  $('#learning-path').replaceChildren();
  Object.entries(stages).forEach(([key, label], index) => {
    const first = session.blocks.find(block => block.stage === key);
    const button = document.createElement('button');
    button.className = `path-step ${first ? 'available' : ''} ${key === currentStage ? 'current' : ''}`;
    button.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b><span>${escape(label)}</span>`;
    button.disabled = !first;
    if (key === currentStage) button.setAttribute('aria-current', 'step');
    button.onclick = () => $(`#block-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#learning-path').append(button);
  });
  $('#empty-lesson').hidden = session.blocks.length !== 0;
  for (const block of session.blocks) {
    let element = $(`#block-${block.id}`);
    if (!element) {
      element = createBlock(block);
      $('#blocks').append(element);
    }
    updateBlock(block, element);
  }
}
function createBlock(block) {
  const element = document.createElement('article');
  element.id = `block-${block.id}`;
  element.className = 'block';
  if (block.type === 'message') {
    const learner = block.role === 'learner';
    element.classList.add('message-block');
    if (learner) element.classList.add('learner');
    element.innerHTML = `<div class="avatar" aria-hidden="true">${learner ? 'v' : 'a'}</div><div class="message-body"><div class="message-name">${learner ? 'Você' : session.mode === 'demo' ? 'Ateliê' : 'Seu tutor'}<span>${learner ? 'Anotação' : session.mode === 'demo' ? 'Exemplo guiado' : 'Orientação'}</span></div>${learner ? '' : `<h3>${escape(block.title)}</h3>`}<div>${escape(block.body)}</div></div>`;
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
function createForm(block, container) {
  const form = document.createElement('form');
  const draft = readDraft(block.id);
  form.className = 'activity-form';
  let fields = '';
  if (block.type === 'quiz') fields = `<fieldset class="options"><legend class="field-label">Escolha uma opção</legend>${block.options.map((option, index) => `<label class="option"><input type="radio" name="choice" value="${index}" required ${String(draft.choice) === String(index) ? 'checked' : ''}><span>${escape(option)}</span></label>`).join('')}</fieldset>`;
  if (block.type === 'code') {
    const native = block.language !== 'html';
    const checks = native ? (block.tests || []).map(test => ({ label: `${test.name}: entrada ${JSON.stringify(test.stdin)}, saída ${JSON.stringify(test.expectedStdout)}` })) : block.checks;
    fields = `<details class="requirements"><summary>${native ? 'Casos de teste desta atividade' : 'O que sua página precisa ter'}</summary><ul>${checks.length ? checks.map(check => `<li>${escape(check.label)}</li>`).join('') : '<li>O tutor avaliará sua solução.</li>'}</ul></details><div class="editor-shell"><div class="editor-bar"><span class="editor-file"><span aria-hidden="true">◇</span> ${escape(filenames[block.language])}</span><div><button type="button" class="stop-execution" hidden>Parar</button><button type="button" class="run-preview">▷ &nbsp; ${native ? 'Executar' : 'Visualizar'}</button></div></div><div class="editor-body"><pre class="line-numbers" aria-hidden="true"></pre><textarea class="code-editor" name="answer" aria-label="Código ${escape(block.language)} da atividade ${escape(block.title)}" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="50000" required>${escape(draft.answer ?? block.starterCode)}</textarea></div></div>${native ? `<label class="field-label" for="stdin-${block.id}">Entrada do programa (stdin)</label><textarea class="stdin-input" id="stdin-${block.id}" name="stdin" rows="2" maxlength="8000">${escape(draft.stdin ?? block.stdin ?? '')}</textarea><p class="field-help">Experimente esta entrada. Ao enviar a tentativa, os casos de teste são executados novamente.</p><div class="execution-output" hidden aria-live="polite"></div>` : '<div class="preview" hidden><div class="preview-bar"><span>SUA PÁGINA</span><span>HTML + CSS · sem JavaScript ou rede</span></div><iframe title="Prévia da sua página HTML" sandbox="" referrerpolicy="no-referrer"></iframe></div>'}`;
  }
  if (block.type === 'reflection') fields = `<label class="field-label" for="answer-${block.id}">Sua explicação</label><textarea class="answer" id="answer-${block.id}" name="answer" rows="4" maxlength="5000" placeholder="Escreva do seu jeito. Seu raciocínio importa." required>${escape(draft.answer || '')}</textarea>`;
  if (block.type !== 'reflection') fields += `<label class="field-label" for="reason-${block.id}">Como você chegou a essa resposta?</label><textarea class="reasoning" id="reason-${block.id}" name="reasoning" rows="2" maxlength="5000" placeholder="Compartilhe seu raciocínio antes de enviar…" required>${escape(draft.reasoning || '')}</textarea>`;
  fields += `<div class="response-bottom"><label class="confidence">Sua confiança <select name="confidence" aria-label="Sua confiança nesta resposta"><option value="1" ${String(draft.confidence) === '1' ? 'selected' : ''}>Ainda tenho dúvidas</option><option value="2" ${!draft.confidence || String(draft.confidence) === '2' ? 'selected' : ''}>Estou entendendo</option><option value="3" ${String(draft.confidence) === '3' ? 'selected' : ''}>Consigo explicar</option></select></label><div class="actions"><button class="hint-button" type="button">◉ &nbsp; Uma dica</button><button class="primary submit-attempt" type="submit">Enviar tentativa <span aria-hidden="true">↗</span></button></div></div>`;
  form.innerHTML = fields;
  container.append(form);
  form.addEventListener('input', () => saveDraft(block.id, form));
  if (block.type === 'code') {
    const editor = $('.code-editor', form);
    const lineNumbers = $('.line-numbers', form);
    const lines = () => { lineNumbers.textContent = Array.from({ length: Math.max(7, editor.value.split('\n').length) }, (_, index) => index + 1).join('\n'); };
    lines();
    editor.addEventListener('input', lines);
    editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; });
    editor.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === ']') {
        event.preventDefault();
        editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    if (block.language !== 'html') attachExecution({ runButton: $('.run-preview', form), stopButton: $('.stop-execution', form), output: $('.execution-output', form), getInput: () => ({ language: block.language, code: editor.value, stdin: $('[name="stdin"]', form).value }), api, notify });
    else $('.run-preview', form).onclick = () => {
      $('.preview', form).hidden = false;
      // This is the only intentional HTML insertion: an opaque-origin sandbox.
      // Scripts, forms, popups, navigation capabilities and network loads are disabled.
      $('iframe', form).srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>body{font:15px/1.5 system-ui;padding:18px;color:#2a3040;margin:0}h1{font-size:26px}button{padding:8px 12px}</style></head><body>${editor.value}</body></html>`;
    };
  }
  $('.hint-button', form).onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await api(`/api/sessions/${session.id}/hints`, { blockId: block.id }); await syncSession(); }
    catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const sessionId = session.id;
    const button = $('.submit-attempt', form);
    button.disabled = true;
    const values = Object.fromEntries(new FormData(form));
    const payload = { blockId: block.id, reasoning: values.reasoning || values.answer, confidence: Number(values.confidence) };
    if (values.choice !== undefined) payload.choice = Number(values.choice);
    if (values.answer !== undefined) payload.answer = values.answer;
    if (values.stdin !== undefined) payload.stdin = values.stdin;
    const originalText = button.innerHTML;
    button.textContent = block.type === 'code' && block.language !== 'html' ? 'Executando os testes…' : 'Enviando…';
    try {
      await api(`/api/sessions/${sessionId}/attempts`, payload);
      await syncSession();
      notify(session?.mode === 'demo' ? 'Tentativa salva. Veja o retorno abaixo da atividade.' : 'Tentativa salva. Volte ao tutor e diga: “Enviei minha tentativa”.');
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; button.innerHTML = originalText; }
  };
}
function updateBlock(block, element) {
  if (block.type === 'message') return;
  const attempts = session.attempts.filter(attempt => attempt.blockId === block.id);
  const attempt = attempts.at(-1);
  const status = $('.activity-status', element);
  status.textContent = attempt ? attempt.review ? (attempt.review.passed ? '✓ Avaliada pelo tutor' : '↻ Revise com o tutor') : ({ passed: '✓ Verificação concluída', needs_work: '↻ Mais uma tentativa?', pending_review: 'Aguardando o tutor' })[attempt.result.status] : ['chart', 'diagram', 'lesson'].includes(block.type) ? 'Explore' : 'Sua vez';
  status.classList.toggle('success', !!attempt && (attempt.review ? attempt.review.passed : attempt.result.status === 'passed'));
  const hintButton = $('.hint-button', element);
  if (hintButton) hintButton.hidden = !block.hintsRemaining;
  $('.hints', element).innerHTML = (block.hints || []).map((hint, index) => `<div class="hint"><strong>Dica ${index + 1}</strong> · ${escape(hint)}</div>`).join('');
  const feedback = $('.feedback', element);
  if (!attempt) return;
  feedback.className = `feedback ${attempt.result.status}`;
  feedback.innerHTML = `<span class="feedback-label">VERIFICAÇÃO AUTOMÁTICA · TENTATIVA ${attempts.length}</span><p>${escape(attempt.result.feedback)}</p>${attempt.result.checks ? `<ul class="checklist">${attempt.result.checks.map(check => `<li class="${check.passed ? 'pass' : 'fail'}"><span aria-hidden="true">${check.passed ? '✓' : '○'}</span><span>${escape(check.label)}${check.passed ? '' : ' — ajustar'}</span></li>`).join('')}</ul>` : ''}${attempt.review ? `<div class="review-feedback"><span class="feedback-label">AVALIAÇÃO DO TUTOR · ${attempt.review.passed ? 'OBJETIVO DEMONSTRADO' : 'CONTINUE PRATICANDO'}</span><p>${escape(attempt.review.feedback)}</p></div>` : ''}`;
  if (attempt.result.executions) feedback.innerHTML += `<details class="execution-details"><summary>Ver entradas, saídas e diagnósticos</summary>${attempt.result.executions.map(execution => `<div class="execution-output">${executionMarkup(execution)}</div>`).join('')}</details>`;
  if (attempts.length > 1) $('.history', element).innerHTML = `<details><summary>Ver ${attempts.length} tentativas</summary><ol>${attempts.map(item => `<li>${escape(new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))} · ${item.hintsUsed} dica(s) usadas · ${escape(({ passed: 'Verificação passou', needs_work: 'Ajustes necessários', pending_review: 'Explicação registrada' })[item.result.status])}<details><summary>Resposta e raciocínio</summary><pre>${escape(item.answer ?? block.options?.[item.choice] ?? '')}</pre><p>${escape(item.reasoning)}</p>${item.review ? `<p>Avaliação do tutor: ${escape(item.review.feedback)}</p>` : ''}</details></li>`).join('')}</ol></details>`;
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
  const generation = ++loadingGeneration;
  eventSource?.close();
  try {
    const next = await api(`/api/sessions/${id}`);
    if (generation !== loadingGeneration) return;
    session = next;
    $('#blocks').replaceChildren();
    $('#message').value = '';
    renderSession();
    await refreshList();
    if (generation !== loadingGeneration || currentView !== 'lesson') return;
    eventSource = new EventSource(`/api/sessions/${id}/events`);
    eventSource.onopen = () => connection(true);
    eventSource.onerror = () => connection(false);
    eventSource.onmessage = event => {
      const { revision } = JSON.parse(event.data);
      if (session?.id === id && revision > session.revision) void syncSession();
    };
  } catch (error) { notify(error.message); connection(false); if (!session) $('#welcome').hidden = false; }
}
async function newDemo(button, language) {
  button.disabled = true;
  try { const created = await api('/api/demo', { language }); $('#demo-dialog').close(); location.hash = `session=${created.id}`; }
  catch (error) { notify(error.message); }
  finally { button.disabled = false; }
}
async function chooseDemo() {
  $('#demo-dialog').showModal();
  $('#demo-options').innerHTML = '<p role="status">Verificando as aulas disponíveis…</p>';
  try {
    const { demos } = await api('/api/demos');
    $('#demo-options').innerHTML = demos.map(demo => `<button class="demo-option" data-language="${escape(demo.language)}" ${demo.available ? '' : 'disabled'}><span class="demo-language">${escape(demo.language.toUpperCase())}</span><strong>${escape(demo.title)}</strong><span>${escape(demo.description)}</span><small>${demo.available ? 'Teoria + prática + revisão ↗' : 'Executor indisponível — confira o Laboratório'}</small></button>`).join('');
    for (const button of $('#demo-options').querySelectorAll('button')) button.onclick = () => newDemo(button, button.dataset.language);
  } catch (error) { $('#demo-options').textContent = error.message; }
}
$('#new-demo').onclick = $('#start-demo').onclick = chooseDemo;
$('#close-demo').onclick = () => $('#demo-dialog').close();
$('#next-activity').onclick = () => {
  const next = session.blocks.find(block => ['quiz', 'code', 'reflection'].includes(block.type) && (!latestAttempt(block.id) || latestAttempt(block.id).result.status === 'needs_work'));
  if (next) $(`#block-${next.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (session.reviews?.length) location.hash = 'view=reviews';
  else notify('Você já enviou as atividades disponíveis. Retome com o tutor para discutir suas respostas.');
};
const dialog = $('#connect-dialog');
$('#open-connect').onclick = $('#welcome-connect').onclick = () => dialog.showModal();
$('#close-connect').onclick = () => dialog.close();
$('#copy-prompt').onclick = async () => {
  try { await navigator.clipboard.writeText($('#starter-prompt').textContent); notify('Mensagem copiada. Cole na conversa com seu tutor.'); }
  catch { notify('Selecione a mensagem acima e copie com Ctrl+C.'); }
};
$('#message-form').onsubmit = async event => {
  event.preventDefault();
  if (!session) return;
  const id = session.id;
  const button = $('button', event.currentTarget);
  button.disabled = true;
  try { await api(`/api/sessions/${id}/messages`, { body: $('#message').value }); if (session?.id === id) $('#message').value = ''; await syncSession(); notify(session?.mode === 'demo' ? 'Anotação salva nesta aula de exemplo.' : 'Mensagem salva. Avise seu tutor na conversa para continuar.'); }
  catch (error) { notify(error.message); }
  finally { button.disabled = false; }
};
async function navigate() {
  if (location.hash === '#main') return;
  const params = new URLSearchParams(location.hash.slice(1));
  const requested = params.get('view');
  currentView = params.get('session') ? 'lesson' : ['home', 'lab', 'reviews'].includes(requested) ? requested : 'home';
  ++loadingGeneration;
  eventSource?.close();
  cancelLab?.();
  cancelLab = undefined;
  for (const id of ['welcome', 'lesson', 'lab', 'reviews']) $(`#${id}`).hidden = id !== (currentView === 'home' ? 'welcome' : currentView);
  for (const link of document.querySelectorAll('[data-view]')) { const active = link.dataset.view === (currentView === 'lesson' ? 'home' : currentView); link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  try {
    if (currentView === 'lesson') await openSession(params.get('session'));
    else {
      $('#breadcrumb').textContent = { home: 'Minhas aulas', lab: 'Laboratório', reviews: 'Revisões' }[currentView];
      document.title = `${$('#breadcrumb').textContent} · Ateliê`;
      if (currentView === 'lab') cancelLab = await mountLab($('#lab'), api, notify);
      if (currentView === 'reviews') await mountReviews($('#reviews'), api, notify, refreshList);
      await refreshList();
    }
  } catch (error) { notify(error.message); }
}
window.addEventListener('hashchange', () => { void navigate(); });
try {
  await refreshList();
  connection(true);
  await navigate();
} catch (error) { connection(false); $('#welcome').hidden = false; notify(`Não foi possível conectar. Execute npm start e recarregue a página. ${error.message}`); }
