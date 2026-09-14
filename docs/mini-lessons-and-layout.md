# Mini-lições, início automático e painel ajustável

Revisão da v0.4 — 2026-09-10. Não requer migração dos dados existentes.

## Experiência

- Nova conversa recebe título, objetivo e nível. **Começar aula** salva a sessão e uma mensagem inicial e começa a resposta do Luna no servidor, sem esperar um segundo envio no chat.
- A primeira resposta registra um plano curto, explica um único conceito, mostra um exemplo resolvido pequeno e convida à conversa. A primeira atividade só é proposta em um turno posterior.
- O ciclo de aprendizagem continua `prever → praticar → explicar → transferir`, mas começa **depois** da introdução. Prever não deve significar adivinhar conceitos que ainda não foram ensinados.
- Nos turnos seguintes, o tutor deve explicar e exemplificar cada conceito novo antes de cobrá-lo. Dúvidas levam a mais ensino, não a tarefas adicionais.
- O aluno pode arrastar a divisória vertical entre chat e Estudo. A coluna ajustável amplia editor, enunciado, dicas e notas juntos.

## Contratos e recuperação

`POST /api/sessions` aceita o campo booleano opcional `startTutor`, cujo padrão é `false` para manter compatibilidade. O formulário envia `true`. A resposta HTTP `201` entrega a sessão sem aguardar a geração completa; a operação continua no servidor se a página for recarregada.

O objetivo completo fica na sessão e no contexto do agente (até o limite de 12.000 caracteres do contrato). A mensagem inicial limita sua cópia do objetivo para caber no limite de 5.000 caracteres do chat. O modelo continua fixado em `gpt-5.6-luna`.

Status, timeout, cancelamento e retry reutilizam o fluxo existente. Agente desativado ou falha ao iniciar deixam a mensagem salva e um estado `failed`, para a UI oferecer retomada. Consultar ou reabrir uma sessão não inicia outro turno nem repete a mensagem inicial. Retomar uma falha reutiliza a pergunta salva. Uma interrupção do próprio servidor continua sujeita aos limites de recuperação descritos no guia operacional.

Durante o primeiro turno integrado, `AgentRunner.assertCanAddBlock` impede a criação de `quiz`, `code` e `reflection`. Plano e materiais de apoio continuam permitidos. A resposta textual final é a mini-lição. Mensagens de diagnóstico de conexão não contam como introdução concluída. Em turnos posteriores, a proteção inicial não impede criar tarefas; a qualidade do ensino e a introdução de conceitos novos dependem das instruções e da avaliação do modelo.

No cliente MCP externo, as instruções pedagógicas também orientam ensinar antes de cobrar, mas o bloqueio operacional específico da abertura é do agente integrado. Nenhuma atividade ou tentativa antiga é removida ou reescrita.

## Redimensionamento e acessibilidade

- Padrão: 420 px; mínimo: 320 px; máximo: 900 px ou o espaço disponível mantendo 380 px para o chat e 12 px para a divisória.
- Preferência em `localStorage`, chave `mcp-tutor:study-width`, compartilhada entre aulas neste navegador.
- Arraste para a esquerda amplia Estudo; para a direita reduz.
- Teclado: setas ajustam 32 px; Home usa o mínimo; End usa o máximo; duplo clique restaura o padrão.
- O divisor expõe `role=separator`, orientação vertical e valores ARIA. Captura do ponteiro evita perder o arraste ao cruzar as colunas.
- Em telas de até 1190 px, permanece o drawer de Estudo e o divisor fica oculto. Reduzir a janela limita a largura aplicada sem apagar a preferência de telas largas.

## Validação

`npm run quality`: 50 testes aprovados. A cobertura inclui limites, arraste, teclado, persistência, cancelamento de ponteiro, bloqueio de tarefas na introdução, objetivo inicial, abertura com agente indisponível e retry sem duplicação.

Verificação real no navegador em 2026-09-10, em uma aula de validação separada:

- Arraste ampliou Estudo de 420 para 600 px; reload preservou 600 px. Três ajustes pelo teclado reduziram para 504 px.
- Criar a conversa com objetivo e nível iniciou o Luna automaticamente, sem digitar no chat. Ele registrou o plano e explicou largura fluida em CSS com um exemplo resolvido usando `width` e `max-width`.
- A primeira resposta terminou sem nenhuma atividade respondível. Só após a mensagem “Entendi o exemplo… quero praticar” foi criado um quiz curto sobre a mesma ideia.
- Recarregar durante o segundo turno preservou acompanhamento e histórico, sem reiniciar a introdução.
- Em 390 px, a largura do documento permaneceu em 390 px, a divisória ficou oculta e o drawer de Estudo abriu normalmente. A preferência desktop voltou ao restaurar a janela.

A sessão de validação não prova domínio do aluno nem qualidade pedagógica universal do modelo. As atividades e tentativas existentes do usuário foram preservadas.
