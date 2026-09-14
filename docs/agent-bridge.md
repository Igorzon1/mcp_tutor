# Ponte do chat com o agente — versão 0.4

Este documento registra o contrato implementado do backend do chat na v0.4. A UI consome os status e ações descritos aqui.

## Fluxo

Para o início automático pelo formulário (`startTutor: true`), a sessão e sua mensagem inicial são salvas antes da geração. A criação retorna sem aguardar a resposta e o painel acompanha a operação. A abertura é dedicada a plano, explicação e exemplo, sem exercícios nesse primeiro turno. Veja o [contrato de mini-lições e layout](mini-lessons-and-layout.md) para a proteção de abertura, a recuperação e as diferenças em relação ao MCP externo.

O chat integrado usa a mesma sessão do MCP Tutor em todas as etapas:

```text
navegador
  └─ POST /api/sessions/:id/chat
       ├─ salva a mensagem do aluno
       ├─ inicia Luna com o estado da sessão
       ├─ o agente pode chamar as ferramentas MCP existentes
       │    └─ adicionar desafio, ler tentativa, revisar e avançar etapa
       ├─ atualiza status e permite cancelar a execução
       └─ salva a resposta final como mensagem do tutor
```

O serviço não cria uma segunda memória de conversa. O histórico persistido da sessão é a fonte da aula; o agente recebe uma fotografia do estado atual para decidir o próximo passo e pode consultar a sessão pelas ferramentas MCP. Materiais, histórico de atividades e plano aparecem em superfícies próprias do painel, não como conteúdo despejado no transcript do chat. Notas são dados privados do aluno em `localStorage`, indexados por `sessionId`, e não entram no contexto nem em nenhuma chamada do tutor.

## Status e fases visíveis da resposta

`GET /api/agent?sessionId=…` retorna o estado geral da ponte e, quando o `sessionId` é informado, a propriedade `session` com este formato:

```json
{
  "session": {
    "phase": "thinking",
    "active": true,
    "lastError": null,
    "startedAt": 1725950000000,
    "updatedAt": 1725950001200,
    "elapsedSeconds": 1
  }
}
```

`session` sempre contém `phase`, `active`, `lastError`, `startedAt`, `updatedAt` e `elapsedSeconds`. A fase da sessão é uma destas:

`idle`, `starting`, `connecting`, `thinking`, `reading_session`, `updating_plan`, `creating_activity`, `reviewing_attempt`, `advancing_stage`, `using_tools`, `finishing`, `completed`, `failed` ou `cancelled`.

Enquanto uma mensagem está sendo processada, a ponte acompanha a fase atual para que o painel comunique o andamento sem simular uma resposta pronta:

| Fase | O que significa |
| --- | --- |
| `connecting` | A chamada ao agente está sendo iniciada. |
| `thinking` | O agente está interpretando a mensagem e decidindo o próximo passo. |
| `reading_session` | O agente está lendo progresso, tentativas ou eventos da sessão. |
| `updating_plan` | O agente está registrando ou ajustando o plano de aprendizagem. |
| `creating_activity` | O agente está criando o exercício ou outro bloco de apoio. |
| `reviewing_attempt` | O agente está avaliando uma tentativa com base nas evidências. |
| `advancing_stage` | O agente está registrando a transição para a próxima etapa. |
| `finishing` | A resposta textual está sendo concluída. |
| `completed` | O agente concluiu; o servidor salva a mensagem do tutor logo depois. |
| `failed` | A execução terminou com erro; `lastError` informa uma mensagem segura. |
| `cancelled` | A execução foi interrompida por cancelamento. |

Se nenhuma resposta estiver em andamento, a sessão fica em `idle` ou em um estado terminal (`completed`, `failed` ou `cancelled`) até a próxima operação. A fase é um indicador operacional, não uma afirmação sobre a qualidade pedagógica da resposta. As fases não representam streaming token-a-token: a UI recebe atualizações de status/fase e, ao final, a resposta textual completa.

### Cancelamento e retry

`POST /api/sessions/:id/chat/cancel` recebe o corpo `{}`. A operação interrompe a execução ativa e retorna o estado atualizado. Se não houver resposta ativa, é segura para repetir. O cancelamento preserva a mensagem do aluno e o histórico anterior. Ele não desfaz mudanças MCP que o agente já tenha concluído: atividades, revisões, avanço de etapa ou qualquer outra alteração persistida antes do cancelamento permanecem na sessão. Também não cria uma resposta parcial apresentada como resposta do tutor.

`POST /api/sessions/:id/chat` aceita `{ "body": "…" }` para uma nova mensagem. Com `{ "retry": true }`, reutiliza a última mensagem do aprendiz e não cria um bloco duplicado antes de iniciar nova resposta. A resposta bem-sucedida retorna `learnerMessage`, `tutorMessage` e `agent`; quando o agente conclui, `agent.session.phase` é `completed` e `tutorMessage` é salvo logo após a conclusão do agente.

O status operacional é separado do progresso pedagógico (`progress.status`). `active: false` e uma fase terminal não comprovam autenticação; configuração, autenticação e disponibilidade só podem ser avaliadas pelo resultado de uma chamada real.

Quando o aluno envia uma tentativa no chat integrado, o painel tenta disparar automaticamente uma mensagem de revisão se o tutor estiver habilitado e não houver outra resposta ativa para a sessão. Se a ponte não estiver disponível, estiver ocupada ou a chamada não puder ser iniciada, a tentativa continua salva e o aluno pede a revisão ao terminar. Isso é diferente do cliente MCP externo, em que o aluno normalmente precisa avisar o tutor manualmente.

## Configuração

O backend da v0.4 usa obrigatoriamente Luna com o modelo `gpt-5.6-luna`:

```sh
npm start
```

Para o chat integrado, `npm start` inicia a ponte quando o backend Luna está disponível. A chamada deve ignorar configurações pessoais de plugins/MCPs e injetar somente o MCP Tutor. O modelo não é configurável: `gpt-5.6-luna` é obrigatório e qualquer variável de ambiente que tente substituí-lo deve ser ignorada. A autenticação e a disponibilidade não são consideradas verificadas pelo status de configuração; somente uma chamada real pode confirmá-las.

O comando `setup:codex` registra o MCP Tutor no cadastro global apenas para conduzir aulas diretamente em uma conversa externa do Codex. Esse modo externo não altera o modelo fixo do backend do chat integrado. Para desligar o chat automático e usar somente a conexão MCP manual:

```sh
TUTOR_AGENT=none npm start
```

O painel pode consultar um status operacional para indicar se a ponte está configurada ou ocupada. “Configurado” nunca significa “autenticado” ou “pronto”: autenticação, rede e disponibilidade do backend só são confirmadas pelo resultado de uma mensagem enviada.

## Limites de segurança

- Luna é executado em modo efêmero e com sandbox `read-only`;
- a configuração pessoal do agente é ignorada e somente o MCP Tutor é injetado na chamada; a autenticação local necessária é usada, mas não é inferida pelo status;
- o prompt delimita mensagens, código e estado do aluno como dados não confiáveis;
- o código JavaScript do aluno nunca é enviado para o executor Node;
- uma resposta do agente pode criar atividades por MCP, mas não pode ignorar a máquina de estados;
- uma mensagem do aluno é salva antes da chamada do agente e não é perdida se o agente falhar;
- em caso de falha ou cancelamento, o painel mantém a mensagem do aluno e a sessão disponível para retry ou para um cliente MCP externo;
- o cancelamento não reverte atividades, revisões, avanços ou outras mudanças MCP já persistidas;
- apenas uma resposta do agente por sessão fica em execução por vez.
- o aluno pode continuar consultando a conversa e retornar à superfície Estudo; uma fase em andamento não cria uma segunda atividade nem altera o histórico por conta própria.

## Por que o adaptador é CLI

MCP fornece as ferramentas que o agente usa, mas não inicia um novo turno em um cliente externo quando o navegador recebe uma mensagem. O adaptador CLI resolve essa lacuna para o chat do painel, reaproveitando o executável e a autenticação já disponíveis na máquina. Clientes MCP externos continuam suportados e podem conduzir a aula diretamente em suas próprias conversas.

O contrato atual deve ser reutilizado por clientes compatíveis, sem duplicar a lógica de sessão, tentativa, evidência e revisão.
