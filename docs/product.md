# Produto: um tutor que cria oportunidades de prática

**Versão documentada: 0.5.** O laboratório e as revisões ampliam o chat, editor e máquina de estados existentes.

## Implementado na versão 0.5

- Laboratório livre com Python, Java, JavaScript, C e C++, quando instalados; console, entrada, cancelamento e isolamento local.
- Exercícios nativos com casos de entrada e saída registrados junto da tentativa.
- Aulas demonstrativas de Python e Java, além de HTML, com exemplo comentado e variação final.
- Revisões persistidas, recuperação antes da referência e intervalo definido pela autoavaliação.
- Navegação entre aulas, laboratório e revisões; objetivos, indicação da próxima atividade e indicadores de tentativas. O raciocínio complementar continua opcional e as notas permanecem privadas.


## O problema e a proposta

Conversar com uma IA pode ajudar a entender uma explicação, mas a conversa sozinha nem sempre permite observar o que a pessoa consegue fazer. A proposta é ligar a orientação do tutor a tentativas concretas: uma previsão, uma solução, uma explicação e uma nova aplicação.

O aluno escolhe um objetivo, por exemplo “quero construir meu primeiro site”. O tutor entende o ponto de partida e cria atividades pequenas durante a conversa. O painel é um espaço de trabalho que acompanha a aula. Não é necessário transformar todo assunto em um curso fixo antes de começar.

O nome Ateliê é provisório: destaca um espaço em que se aprende construindo e revisando.

## O percurso principal

1. **Entender e ensinar.** Aproveitar o objetivo e o nível já informados, registrar um plano ajustável e ensinar um único conceito com explicação e exemplo resolvido. A primeira resposta não contém tarefa; o aluno pode ler e tirar dúvidas. Não exigir novamente as informações do formulário.
2. **Prever.** Depois da mini-lição, pedir uma escolha ou previsão sobre uma pequena variação do exemplo, usando somente conceitos que já foram ensinados.
3. **Praticar.** Apresentar um exercício limitado a uma dificuldade principal. O aluno escreve, observa e envia sua tentativa.
4. **Revisar.** Ler o resultado e, quando informado, o raciocínio complementar. Identificar um acerto e um próximo passo. Usar dicas graduais quando houver dificuldade.
5. **Explicar.** Pedir que a pessoa justifique a solução ou compare duas alternativas.
6. **Transferir.** Propor uma variação que exija recuperar e adaptar o que foi aprendido, começando com menos ajuda.

Essas etapas orientam a experiência; não precisam ser um roteiro rígido. Uma resposta pode justificar voltar a uma explicação, reduzir o exercício ou avançar. No MVP, a aula de exemplo usa um roteiro; sessões reais dependem das decisões do tutor conectado.

## Guardrails implementados

O núcleo agora protege a sequência sem transformar a aula em um curso rígido:

- uma sessão tem uma etapa atual e um estado de progresso persistido;
- o primeiro turno do chat integrado bloqueia atividades respondíveis até que a mini-lição textual seja concluída; a qualidade pedagógica do texto continua dependendo do tutor;
- apenas uma atividade respondível fica aberta por vez;
- tentativas incorretas mantêm a atividade disponível para retry;
- reflexões podem aguardar revisão explícita do tutor;
- uma tentativa aprovada libera a transição, mas não avança sozinha;
- `tutor_advance_stage` registra a evidência e move a sessão uma etapa por vez;
- a etapa de transferência concluída encerra a sessão.

O contrato técnico e os estados possíveis estão em [`docs/state-machine.md`](state-machine.md). Essa camada garante ordem e evidência mínima; a decisão sobre a qualidade da explicação e a adaptação da dificuldade continua pertencendo ao tutor.

## A interação que diferencia o produto

O tutor pode dizer “antes de continuar, tente isto” e adicionar uma atividade. O aluno responde no painel; o tutor recebe a resposta ou código, o raciocínio complementar quando fornecido, a confiança relatada e as dicas utilizadas. A próxima atividade nasce dessa evidência e só pode ser aberta depois que a atividade atual for resolvida ou revisada.

### Versão 0.4: chat central e estudo separado

Em telas largas, Aulas fica à esquerda, o chat ocupa uma área central ampla e Estudo fica à direita. Estudo usa as abas **Atividade**, **Dicas**, **Notas** e **Plano**. Em telas pequenas, Estudo é recolhido em um drawer aberto pelo botão **Estudo**. A área de chat continua dedicada à conversa e não absorve materiais nem histórico.

Estudo pode ser redimensionado arrastando a divisória, com suporte ao teclado e preferência salva no navegador. O formulário de Nova conversa inicia o plano e a mini-lição automaticamente, sem segundo envio no chat. Os contratos, limites e testes estão em [Mini-lições e layout](mini-lessons-and-layout.md).

A conversa é independente do exercício: o aluno pode perguntar, descrever uma dificuldade ou registrar uma descoberta enquanto o desafio continua aberto. O material da aula, o histórico de atividades e o plano ficam fora do transcript, em Aulas ou Estudo. No chat integrado, a mensagem é salva e encaminhada ao backend Luna na mesma sessão; a resposta volta ao histórico da conversa. Quando o aluno envia uma tentativa, o painel dispara uma solicitação de revisão no chat se o tutor está habilitado e sem resposta ativa. Se não puder disparar, a tentativa permanece salva e o aluno pede a revisão ao terminar. Em clientes MCP externos, a tentativa continua sendo registrada no painel e o aluno avisa ao tutor quando quiser retomar o turno.

O formulário da tentativa combina a resposta principal com um campo de raciocínio complementar, usado quando o aluno quiser tornar explícita a decisão ou o caminho seguido. Isso não deve ser confundido com a aba Notas: Notas são privadas, persistidas apenas em `localStorage` por sessão e nunca enviadas ao tutor. A evidência da tentativa ajuda a revisão, mas não substitui o resultado objetivo nem a avaliação do tutor; confiança relatada também não é prova de domínio.

A aba Dicas revela ajuda gradual, uma dica por vez, sem antecipar a solução completa. A aba Atividade concentra o exercício atual; Plano mostra a etapa e o próximo objetivo; materiais e histórico continuam fora do chat. A existência de uma atividade respondível aberta continua intencional: evita acumular tarefas sem tentativa.

O painel agora suporta um segundo tipo de prática de programação: blocos JavaScript. O tutor configura testes curtos com expressões booleanas; o aluno escreve no editor, executa os testes e envia a tentativa. O painel devolve checks, saída, erro e duração como evidência para a conversa. O código roda no Worker dedicado `/exercise-worker.js`, com CSP própria para permitir `Function`, conexões de rede desabilitadas e timeout interrompível, e nunca é executado no Node, no terminal ou no sistema de arquivos. Essa evidência do browser é não confiável e não promete isolamento absoluto.

Esse desenho mantém o painel com papel de extensão prática da conversa: o chat integrado conduz a pergunta, a dica e a revisão; Estudo oferece o lugar para fazer, observar o resultado e enviar evidência. Durante uma resposta, o backend expõe status e fases compreensíveis — conexão, raciocínio, leitura da sessão, criação de atividade, revisão, avanço, finalização, falha ou cancelamento — para que o aluno saiba se deve continuar praticando ou aguardar a próxima orientação. Isso não é streaming token-a-token; é acompanhamento operacional até a resposta final. A integração ainda é um painel web local, não uma extensão empacotada nem uma interface MCP Apps dentro do chat.

Quando o usuário preferir conversar diretamente no Codex ou Claude Code, o fluxo MCP continua disponível: o tutor lê a resposta chamando uma ferramenta de leitura ou espera. Nesse modo externo, o aluno pode precisar avisar no chat que enviou. No chat integrado, `retry: true` reutiliza a última mensagem do aprendiz sem duplicá-la; cancelamento interrompe o agente, mas preserva mudanças MCP já realizadas.

## Por que MCP mais um painel

MCP é a conexão das ferramentas com o modelo, não a interface visual inteira. O núcleo da aprendizagem deve funcionar independentemente de quem produz a explicação.

O painel local oferece a mesma experiência de prática para os clientes que conseguem executar o servidor stdio. Uma camada futura de MCP Apps pode renderizar atividades em clientes que suportam a extensão. A estrutura das atividades já é separada da interface para facilitar esse caminho.

Na v0.4, o backend do chat usa obrigatoriamente Luna com `gpt-5.6-luna`; variáveis de ambiente não podem substituir esse modelo. O status de configuração não comprova autenticação: somente o resultado de uma chamada real confirma disponibilidade. Uma versão com chat próprio ainda exigiria trabalho adicional de autenticação, custos e gestão de contexto.

## O que observar em testes com pessoas

As seguintes perguntas são hipóteses de produto, não resultados medidos:

- A pessoa entende que a conversa fica no cliente e a prática no painel?
- Ela tenta resolver antes de pedir a solução?
- As dicas ajudam a avançar sem revelar tudo de uma vez?
- A exigência de explicar ajuda o tutor ou interrompe demais o fluxo?
- A variação final pode ser resolvida com menos ajuda?
- O retorno do tutor distingue erros de estrutura, aparência e entendimento?
- O chat central amplo e as superfícies Aulas/Estudo mantêm a continuidade sem misturar materiais e histórico ao transcript?

Não usar quantidade de cliques, confiança relatada ou número de testes verdes como evidência suficiente de domínio. Guardar tentativas permite investigar o progresso, mas não substitui uma avaliação pedagógica.

## Crítica de maturidade

O MCP Tutor já deixou de ser apenas uma demonstração visual: existe um núcleo persistente, uma máquina de estados, atividades respondíveis, evidência de tentativa, revisão explícita e uma ponte de chat com Luna. Isso é suficiente para um piloto local em que uma pessoa quer aprender construindo.

Ele ainda não atingiu maturidade de produto geral. As lacunas mais importantes são operacionais, não apenas de interface:

- o armazenamento é um JSON local sem contas, criptografia, migração assistida ou backup/restauração no produto;
- o agente é um processo local com modelo Luna fixo, status, retry da última mensagem e cancelamento; ainda faltam fila, telemetria e recuperação de um processo órfão;
- a ponte automática do navegador deve usar `gpt-5.6-luna` sem override de ambiente; a integração do Claude Code é MCP no cliente externo, não um backend automático equivalente;
- os executores atendem exercícios pequenos; pacotes de projeto, programas com vários arquivos e aplicações completas exigem outro desenho de ambiente;
- a qualidade pedagógica ainda depende do agente: a máquina impõe ordem e evidência mínima, mas não garante que o feedback seja correto, claro ou adequado ao nível do aluno;
- não há extensão MCP Apps empacotada, colaboração, sincronização, acessibilidade auditada, matriz de compatibilidade de clientes ou política de atualização.

Conclusão: a classificação atual é **pronto para piloto local controlado**, **não pronto para lançamento público**. “Pronto para uso” significa que o caminho principal é compreensível, recuperável e seguro o bastante para uma máquina pessoal; não significa que todos os riscos de um serviço multiusuário foram resolvidos. Os critérios verificáveis estão em [release-readiness.md](release-readiness.md).

## Jornada operacional do usuário

Uma aula recomendada segue este contrato:

1. O aluno inicia o serviço, abre o painel e conecta um cliente MCP ou o chat integrado com Luna.
2. O tutor aproveita objetivo e nível já informados, registra o plano e ensina uma mini-lição com exemplo antes de escolher a primeira atividade. Preferências e tempo podem ser ajustados durante a conversa.
3. O tutor mantém uma única atividade respondível aberta. O aluno prevê, tenta no painel e envia a resposta, sua confiança e, quando útil, um raciocínio complementar opcional. Notas pessoais ficam apenas em `localStorage` e não são enviadas.
4. O tutor lê a tentativa e a evidência objetiva, oferece uma dica graduada ou revisa a resposta com um próximo passo observável.
5. Só depois de evidência suficiente o tutor avança a etapa. A etapa final pede reconstrução ou transferência para reduzir dependência do exemplo.
6. Ao terminar, o aluno registra o que conseguiu fazer sem consulta e encerra ou retoma a sessão pela lista local.

O painel é o espaço de execução e observação; o cliente de IA é o espaço de diálogo e decisão. No chat externo, o aluno precisa avisar ao tutor que enviou uma tentativa. No chat integrado do navegador, o próprio painel faz essa chamada ao backend Luna e grava a resposta na mesma sessão.

## Critérios de qualidade pedagógica

Uma aula só deve ser considerada boa quando o aluno produz evidência, não apenas quando recebe uma explicação. Para cada atividade, o tutor deve conseguir responder:

- qual habilidade específica estava sendo praticada;
- qual parte da tentativa mostrou compreensão ou confusão;
- qual dica menor poderia destravar o próximo passo;
- por que a atividade seguinte aumenta, reduz ou transfere a dificuldade;
- o que o aluno conseguiu reconstruir sem copiar o exemplo.

Se a resposta automática estiver correta, mas a explicação não corresponder ao objetivo, mantenha a sessão em revisão. Testes verdes são sinais úteis, não uma nota de domínio.

## Roadmap priorizado

| Prioridade | Incremento | Resultado esperado | Como validar |
| --- | --- | --- |
| P0 | Testar aulas reais com Codex e Claude Code | Identificar quebras no ciclo e documentar a diferença entre os dois modos | Registrar instalação, retomada, qualidade das dicas e autonomia na tarefa final |
| P0 | Backup, restauração e diagnóstico do serviço | Tornar sessões recuperáveis e falhas explicáveis | Simular arquivo inválido, encerramento durante escrita e troca de porta |
| P0 | Contratos de rubricas e revisões do tutor | Feedback consistente e vinculado à tentativa | Comparar avaliações com critérios explícitos e casos conhecidos |
| P1 | Fila, telemetria e recuperação do agente | Melhorar a experiência de conversa e evitar turnos perdidos | Simular timeout, cancelamento, duas mensagens simultâneas e processo indisponível |
| P1 | Editor com realce de sintaxe e arquivos | Aproximar exercícios do trabalho real sem perder o foco pedagógico | Avaliar edição, erros, rascunhos e evidência enviada |
| P1 | Acessibilidade e matriz de compatibilidade | Permitir uso confiável por mais pessoas e clientes | Navegação por teclado, leitor de tela, viewport móvel e clientes MCP suportados |
| P1 | Revisão posterior e recuperação sem ajuda | Observar retenção além da mesma sessão | Aplicar uma tarefa nova após um intervalo, sem mostrar o exemplo anterior |
| P2 | Executor isolado para outra linguagem | Ampliar práticas com comportamento verificável | Definir limites de tempo, memória, rede e arquivos; validar isolamento independentemente |
| P2 | Adaptador MCP Apps | Renderizar atividades dentro de chats compatíveis | Validar negociação de capacidades e manter o painel como alternativa |
| P2 | Exercícios sobre um repositório local | Praticar no projeto do aluno com escopo controlado | Separar arquivos, comandos autorizados e evidências de teste |

A expansão para outros assuntos deve acrescentar tipos de atividade sobre o mesmo modelo de sessão, tentativa, evidência e feedback. Exemplos: ordenar etapas, manipular uma simulação, comparar escolhas de design ou resolver uma situação escrita. O editor de código é um dos componentes, não o centro do modelo de dados.

## Escopo deixado para depois

Contas, colaboração, marketplace de cursos, publicação, pagamento, geração de voz/vídeo e um sistema próprio de agentes ainda não fazem parte do MVP. O primeiro experimento é verificar se uma conversa que alterna orientação e prática melhora a experiência e produz evidência útil para ensinar.
