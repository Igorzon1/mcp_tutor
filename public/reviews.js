const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export async function mountReviews(container, api, notify, onChange) {
  const { reviews } = await api('/api/reviews');
  const due = reviews.filter(card => Date.parse(card.dueAt) <= Date.now() || card.awaitingRating);
  const future = reviews.filter(card => !due.includes(card));
  container.innerHTML = `<div class="section-heading"><span class="eyebrow">LEMBRAR SEM CONSULTAR</span><h1>Revisões</h1><p>Primeiro tente recuperar a ideia. Depois compare com a referência e escolha o que precisa praticar de novo.</p></div><div class="review-overview"><strong>${due.length}</strong><span>para revisar agora</span><span class="review-upcoming">${future.length} programada${future.length === 1 ? '' : 's'}</span></div><div class="review-list" id="reviews-due"></div>${!due.length ? `<div class="empty-state"><span aria-hidden="true">✓</span><h2>Nenhuma revisão pendente</h2><p>${future.length ? 'Suas próximas revisões já estão programadas. Confira as datas abaixo ou antecipe uma prática.' : 'Conclua uma aula de exemplo ou peça ao tutor uma revisão de algo que você já praticou.'}</p></div>` : ''}${future.length ? '<details class="upcoming-reviews"><summary>Próximas revisões — você também pode antecipar uma prática</summary><div class="review-list" id="reviews-future"></div></details>' : ''}<p class="field-help">Os intervalos são ajustados pelo seu relato: 1, 3, 7, 14 ou 30 dias. Isso organiza a prática; não é uma medida de domínio nem um lembrete externo.</p>`;
  function cardElement(card) {
    const article = document.createElement('article');
    article.className = 'review-card';
    article.innerHTML = `<div class="review-meta"><span>${escape(card.concept)}</span><time datetime="${escape(card.dueAt)}">${escape(new Date(card.dueAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }))}</time></div><a class="review-session" href="#session=${card.sessionId}">${escape(card.sessionTitle)}</a><h2>${escape(card.prompt)}</h2>${card.awaitingRating ? `<div class="recall-comparison"><div><span class="field-label">SUA TENTATIVA</span><p>${escape(card.attempts.at(-1).answer)}</p></div><div><span class="field-label">REFERÊNCIA PARA COMPARAR</span><p>${escape(card.referenceAnswer)}</p></div></div><p class="field-label">Como foi recuperar essa ideia?</p><div class="rating-actions"><button class="secondary" data-rating="again">Preciso retomar</button><button class="secondary" data-rating="partial">Lembrei em parte</button><button class="primary" data-rating="remembered">Consegui explicar</button></div>` : `<form class="recall-form"><label class="field-label" for="recall-${card.id}">Sua resposta, sem consultar</label><textarea class="answer" id="recall-${card.id}" name="answer" maxlength="5000" required placeholder="Recupere a ideia com suas palavras…"></textarea><button class="primary" type="submit">Comparar com a referência</button></form>`}`;
    const endpoint = `/api/sessions/${card.sessionId}/reviews/${card.id}`;
    const redraw = async () => { await mountReviews(container, api, notify, onChange); await onChange?.(); };
    const form = article.querySelector('form');
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('button'); button.disabled = true;
      try { await api(`${endpoint}/recall`, { answer: form.elements.answer.value }); await redraw(); }
      catch (error) { notify(error.message); button.disabled = false; }
    };
    for (const button of article.querySelectorAll('[data-rating]')) button.onclick = async () => {
      article.querySelectorAll('button').forEach(item => { item.disabled = true; });
      try { const updated = await api(`${endpoint}/rate`, { rating: button.dataset.rating }); await redraw(); notify(`Revisão registrada. Próxima prática em ${updated.intervalDays} dia(s).`); }
      catch (error) { notify(error.message); article.querySelectorAll('button').forEach(item => { item.disabled = false; }); }
    };
    return article;
  }
  for (const card of due) container.querySelector('#reviews-due').append(cardElement(card));
  for (const card of future) container.querySelector('#reviews-future').append(cardElement(card));
}
