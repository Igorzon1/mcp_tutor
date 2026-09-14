# Máquina de estados pedagógica — versão 0.4

## Propósito

A máquina de estados transforma parte do ciclo pedagógico em uma garantia do núcleo do MCP Tutor. Ela não escolhe o conteúdo da aula no lugar do tutor; apenas impede que a sessão avance sem uma atividade respondida e uma evidência explícita.

## Etapas

A ordem padrão é:

```text
predict → practice → explain → transfer → completed
```

Cada atividade deve declarar sua `stage`. O tutor pode criar várias peças de apoio — mensagens, diagramas e gráficos — na etapa atual, mas só uma atividade respondível pode ficar aberta por vez. Atividades respondíveis são `quiz`, `code` e `reflection`.

A mini-lição inicial ocorre antes da primeira atividade, sem adicionar uma nova etapa persistida: o progresso permanece em `predict / ready_for_activity`. Durante o primeiro turno do agente integrado, a ponte rejeita blocos respondíveis; após a explicação e o exemplo, uma conversa posterior pode iniciar a prática. A progressão de evidências continua inalterada. Veja [mini-lições e início automático](mini-lessons-and-layout.md).

### Código JavaScript no painel

Um bloco `code` com `language: "javascript"` usa `tests` em vez de verificações de seletor HTML. O aluno edita `lesson.js` e pode executar os testes no painel. O painel carrega o Worker dedicado `/exercise-worker.js`, com CSP própria `default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'`, desabilita conexões de rede e impõe limite de 1,5 segundo; o Worker pode ser terminado mesmo se o código entrar em loop. A página principal mantém `script-src 'self'` sem `unsafe-eval` e `worker-src 'self'` sem `blob:`. O servidor recebe apenas a evidência serializada — status, checks, saída, erro e duração — e nunca executa o código JavaScript. Essa evidência do browser é não confiável e não representa isolamento absoluto.

Mesmo quando todos os testes passam, a tentativa fica em `awaiting_review`. O tutor deve considerar o código, o raciocínio complementar quando informado e os limites dos testes antes de chamar `tutor_review_attempt` e, se fizer sentido, `tutor_advance_stage`. A ausência desse campo opcional, por si só, não reprova a tentativa. Isso mantém a diferença entre “o exemplo executou” e “o aluno demonstrou que entendeu”.

## Estados

| Estado | Significado | Próxima ação permitida |
| --- | --- | --- |
| `ready_for_activity` | Não há atividade respondível aberta. | O tutor pode adicionar uma atividade na etapa atual. |
| `awaiting_attempt` | O painel está aguardando uma tentativa do aluno. | O aluno pode responder ou pedir uma dica. O tutor pode adicionar apoio. |
| `awaiting_review` | A resposta precisa de avaliação do tutor. | O tutor deve revisar a tentativa. |
| `ready_for_transition` | Há uma tentativa aprovada como evidência. | O tutor pode chamar `tutor_advance_stage`. |
| `completed` | A transferência foi concluída. | A sessão permanece somente como histórico. |

O progresso persistido tem o formato:

```json
{
  "stage": "practice",
  "status": "awaiting_attempt",
  "activeBlockId": "uuid-da-atividade",
  "lastAttemptId": "uuid-da-tentativa",
  "completedStages": ["predict"]
}
```

`progress.status` é o estado pedagógico e não deve ser confundido com o status operacional do chat. O backend do chat expõe `session` em `GET /api/agent?sessionId=…`, com `phase`, `active`, `lastError`, `startedAt`, `updatedAt` e `elapsedSeconds`. As fases operacionais são `idle`, `starting`, `connecting`, `thinking`, `reading_session`, `updating_plan`, `creating_activity`, `reviewing_attempt`, `advancing_stage`, `using_tools`, `finishing`, `completed`, `failed` e `cancelled`. Cancelar uma resposta não avança a etapa nem cria tentativa; ele preserva a sessão para retry e não desfaz atividades, revisões, avanços ou outras mudanças MCP já persistidas.

## Transições

1. `tutor_start_session` cria a sessão em `predict` e `ready_for_activity`.
2. `tutor_add_block` com `quiz`, `code` ou `reflection` abre a atividade e muda o estado para `awaiting_attempt`.
3. Uma tentativa com `needs_work` mantém a etapa e a atividade aberta para retry.
4. Uma tentativa com `pending_review` muda o estado para `awaiting_review`. Isso vale para reflexões e para execuções JavaScript, mesmo quando os testes configurados passam.
5. Uma tentativa automática aprovada muda o estado para `ready_for_transition`.
6. `tutor_review_attempt` pode aprovar ou reprovar uma tentativa. A aprovação libera a transição; a reprovação devolve a sessão para `awaiting_attempt`.
7. `tutor_advance_stage` exige o ID da tentativa mais recente e uma justificativa. Ele avança uma única etapa por vez.
8. Depois de uma tentativa aprovada em `transfer`, a sessão muda para `completed`.

A aula `demo` mantém seu roteiro determinístico: ela faz as transições internas depois das respostas esperadas para continuar a experiência sem um tutor conectado. Sessões `tutor` usam `tutor_advance_stage` como transição explícita.

Tentativas anteriores continuam no histórico, mas não podem ser reenviadas como se fossem a atividade atual. Isso evita que um cliente alternativo contorne a sequência exibida no painel.

## Compatibilidade e eventos

Sessões do formato de dados v1 recebem `progress` por inferência, sem apagar tentativas ou atividades. O próximo salvamento passa a usar o formato v2.

Além dos eventos existentes, a sessão registra `progress_changed` e `stage_completed`. O painel usa esses eventos para atualizar o estado sem recarregar a página inteira. Tentativas JavaScript também preservam a evidência do executor em `attempt.result`.

## Limite deliberado

O tutor continua responsável por decidir se a evidência é pedagogicamente suficiente, especialmente em explicações abertas. A máquina garante a ordem e a existência de uma evidência; ela não substitui uma rubrica nem avalia domínio profundo.
