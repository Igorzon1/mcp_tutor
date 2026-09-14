const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { completed: 'Execução concluída', error: 'O programa encontrou um erro', timeout: 'Tempo limite atingido', output_limit: 'Limite de saída atingido', cancelled: 'Execução interrompida', unavailable: 'Executor indisponível' };
export function executionMarkup(result) {
  return `<div class="execution-heading ${result.status === 'completed' ? 'success' : 'issue'}"><strong>${escape(labels[result.status] || result.status)}</strong><span>${escape(result.durationMs)} ms · saída ${escape(result.exitCode ?? '—')}</span></div>${result.name ? `<p class="test-name">${escape(result.name)}</p>` : ''}${result.stdin !== undefined ? `<details class="test-input"><summary>Entrada usada</summary><pre>${escape(result.stdin || '(vazia)')}</pre></details>` : ''}<div class="console-section"><span>SAÍDA</span><pre>${escape(result.stdout || '(sem saída)')}</pre></div>${result.stderr ? `<div class="console-section console-error"><span>DIAGNÓSTICO</span><pre>${escape(result.stderr)}</pre></div>` : ''}${result.expectedStdout !== undefined ? `<div class="console-section"><span>SAÍDA ESPERADA</span><pre>${escape(result.expectedStdout)}</pre></div>` : ''}${result.status === 'timeout' ? '<p class="console-help">Verifique se um laço termina e se a entrada informada é suficiente.</p>' : ''}${result.status === 'output_limit' ? '<p class="console-help">O programa produziu muita saída. Verifique a condição do laço ou reduza as impressões.</p>' : ''}`;
}
export function attachExecution({ runButton, stopButton, output, getInput, api, notify, onResult, onBusy }) {
  let controller;
  runButton.onclick = async () => {
    if (controller) return;
    const input = getInput();
    if (!input.code.trim()) { notify('Escreva um programa antes de executar.'); return; }
    controller = new AbortController();
    runButton.disabled = true;
    onBusy?.(true);
    stopButton.hidden = false;
    output.hidden = false;
    output.innerHTML = '<p class="console-help" role="status">Executando seu programa…</p>';
    try {
      const result = await api('/api/run', input, { signal: controller.signal });
      output.innerHTML = executionMarkup(result);
      onResult?.(input, result);
    } catch (error) {
      output.innerHTML = error.name === 'AbortError' ? '<p class="console-help">Execução interrompida.</p>' : `<p class="console-help error">${escape(error.message)}</p>`;
    } finally { controller = null; runButton.disabled = false; stopButton.hidden = true; onBusy?.(false); }
  };
  stopButton.onclick = () => controller?.abort();
  return () => controller?.abort();
}
export async function mountLab(container, api, notify) {
  container.innerHTML = '<p class="muted" role="status">Verificando as linguagens do seu computador…</p>';
  const capabilities = await api('/api/runtimes');
  const available = capabilities.languages.filter(runtime => runtime.available);
  container.innerHTML = `<div class="section-heading"><span class="eyebrow">EXPERIMENTE UMA IDEIA</span><h1>Laboratório de código</h1><p>Escreva, observe e ajuste. O laboratório é livre: executar um programa aqui não envia uma tentativa de aula.</p></div><div class="runtime-strip">${capabilities.languages.map(runtime => `<span class="runtime-chip ${runtime.available ? 'ready' : ''}" title="${escape(runtime.version || runtime.reason)}"><i></i>${escape(runtime.label)} <small>${runtime.available ? 'pronto' : 'indisponível'}</small></span>`).join('')}</div>${!capabilities.sandbox.available ? `<div class="notice error">${escape(capabilities.sandbox.reason)}</div>` : ''}<div class="lab-card"><div class="lab-toolbar"><label for="lab-language">Linguagem <select id="lab-language">${capabilities.languages.map(runtime => `<option value="${escape(runtime.id)}" ${!runtime.available ? 'disabled' : ''}>${escape(runtime.label)}</option>`).join('')}</select></label><span id="lab-version" class="muted"></span></div><div class="lab-workspace"><div class="lab-source"><div class="editor-shell"><div class="editor-bar"><span id="lab-filename"></span><span>Ctrl/Cmd + Enter para executar</span></div><textarea id="lab-code" class="code-editor" aria-label="Código do laboratório" spellcheck="false" autocapitalize="off" maxlength="50000"></textarea></div><label class="field-label" for="lab-stdin">Entrada do programa (stdin)</label><textarea id="lab-stdin" class="stdin-input" rows="3" maxlength="8000" placeholder="Valores que seu programa vai ler, um por linha"></textarea><p class="field-help">A entrada é enviada de uma vez. Não há um terminal interativo durante a execução.</p><div class="lab-actions"><label class="confidence">Tempo limite <select id="lab-timeout" aria-label="Tempo limite"><option value="5000">5 segundos</option><option value="10000">10 segundos</option></select></label><button type="button" class="secondary" id="lab-stop" hidden>Parar</button><button type="button" class="primary" id="lab-run" ${available.length ? '' : 'disabled'}>▷ Executar código</button></div></div><div class="lab-console"><div class="console-title">CONSOLE <span id="lab-stale"></span></div><div id="lab-output" aria-live="polite"><div class="console-empty"><span aria-hidden="true">&gt;_</span><p>A saída do seu programa aparece aqui.</p><small>Faça uma previsão antes de executar.</small></div></div></div></div><div class="lab-footnote">Um arquivo por execução · arquivos temporários · sem rede ou acesso às suas pastas · Java usa a classe Main</div></div><details class="runtime-details"><summary>Versões e limites do ambiente</summary><ul>${capabilities.languages.map(runtime => `<li><strong>${escape(runtime.label)}</strong>: ${escape(runtime.version || 'não instalado')}${runtime.available ? '' : ` — ${escape(runtime.reason)}`}</li>`).join('')}</ul><p>Até 2 execuções simultâneas, 32 KiB de saída, 1.536 MiB de memória virtual por processo e 10 segundos incluindo compilação. Bibliotecas do sistema disponíveis no ambiente podem ser usadas; pacotes do seu projeto e processos filhos não estão disponíveis.</p></details>`;
  const query = selector => container.querySelector(selector);
  const select = query('#lab-language'), code = query('#lab-code'), stdin = query('#lab-stdin');
  let completedInput;
  const save = () => {
    try { localStorage.setItem(`atelie:lab:${select.value}`, JSON.stringify({ code: code.value, stdin: stdin.value })); } catch {}
    query('#lab-stale').textContent = completedInput && (completedInput.code !== code.value || completedInput.stdin !== stdin.value) ? 'Código ou entrada alterados desde a execução' : '';
  };
  const load = () => {
    const language = capabilities.languages.find(runtime => runtime.id === select.value);
    if (!language) return;
    let draft;
    try { draft = JSON.parse(localStorage.getItem(`atelie:lab:${language.id}`)); } catch {}
    code.value = draft?.code ?? language.sample;
    stdin.value = draft?.stdin ?? language.input;
    query('#lab-filename').textContent = language.filename;
    query('#lab-version').textContent = language.version || '';
    completedInput = undefined;
    query('#lab-stale').textContent = '';
    query('#lab-output').innerHTML = '<p class="console-help">Execute para observar o resultado nesta linguagem.</p>';
  };
  if (available.length) select.value = available[0].id;
  load();
  code.addEventListener('input', save);
  stdin.addEventListener('input', save);
  select.onchange = load;
  const cancel = attachExecution({ runButton: query('#lab-run'), stopButton: query('#lab-stop'), output: query('#lab-output'), getInput: () => ({ language: select.value, code: code.value, stdin: stdin.value, timeoutMs: Number(query('#lab-timeout').value) }), api, notify, onBusy: busy => { select.disabled = busy; }, onResult: input => { completedInput = input; save(); } });
  code.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!query('#lab-run').disabled) query('#lab-run').click(); } };
  return cancel;
}
