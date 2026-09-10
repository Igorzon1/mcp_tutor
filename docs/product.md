# Produto: um tutor que cria oportunidades de prática

## O problema e a proposta

Conversar com uma IA pode ajudar a entender uma explicação, mas a conversa sozinha nem sempre permite observar o que a pessoa consegue fazer. A proposta é ligar a orientação do tutor a tentativas concretas: uma previsão, uma solução, uma explicação e uma nova aplicação.

O aluno escolhe um objetivo, por exemplo “quero construir meu primeiro site”. O tutor entende o ponto de partida e cria atividades pequenas durante a conversa. O painel é um espaço de trabalho que acompanha a aula. Não é necessário transformar todo assunto em um curso fixo antes de começar.

O nome Ateliê é provisório: destaca um espaço em que se aprende construindo e revisando.

## O percurso principal

1. **Entender o ponto de partida.** Perguntar objetivo, experiência e restrições. Uma pergunta prática curta costuma gerar mais evidência que apenas perguntar o nível.
2. **Prever.** Pedir uma escolha ou uma previsão antes de mostrar o resultado.
3. **Praticar.** Apresentar um exercício limitado a uma dificuldade principal. O aluno escreve, observa e envia sua tentativa.
4. **Revisar.** Ler o resultado e o raciocínio. Identificar um acerto e um próximo passo. Usar dicas graduais quando houver dificuldade.
5. **Explicar.** Pedir que a pessoa justifique a solução ou compare duas alternativas.
6. **Transferir.** Propor uma variação que exija recuperar e adaptar o que foi aprendido, começando com menos ajuda.

Essas etapas orientam a experiência; não precisam ser um roteiro rígido. Uma resposta pode justificar voltar a uma explicação, reduzir o exercício ou avançar. No MVP, a aula de exemplo usa um roteiro; sessões reais dependem das decisões do tutor conectado.

## A interação que diferencia o produto

O tutor pode dizer “antes de continuar, tente isto” e adicionar uma atividade. O aluno responde no painel; o tutor recebe o código, o raciocínio, a confiança relatada e as dicas utilizadas. A próxima atividade nasce dessa evidência.

Na versão atual, o tutor lê a resposta ao chamar uma ferramenta de leitura ou de espera. O aluno pode precisar avisar no chat que enviou. Uma experiência que retoma a fala automaticamente exige uma integração específica com o cliente ou um chat próprio que execute o ciclo do modelo.

## Por que MCP mais um painel

MCP é a conexão das ferramentas com o modelo, não a interface visual inteira. O núcleo da aprendizagem deve funcionar independentemente de quem produz a explicação.

O painel local oferece a mesma experiência de prática para os clientes que conseguem executar o servidor stdio. Uma camada futura de MCP Apps pode renderizar atividades em clientes que suportam a extensão. A estrutura das atividades já é separada da interface para facilitar esse caminho.

Neste MVP, usar a conta e o modelo do cliente evita construir imediatamente um sistema próprio de credenciais, cobrança e orquestração de IA. Uma versão com chat próprio seria outro adaptador sobre o mesmo núcleo, com trabalho adicional de autenticação, custos, streaming e gestão de contexto.

## O que observar em testes com pessoas

As seguintes perguntas são hipóteses de produto, não resultados medidos:

- A pessoa entende que a conversa fica no cliente e a prática no painel?
- Ela tenta resolver antes de pedir a solução?
- As dicas ajudam a avançar sem revelar tudo de uma vez?
- A exigência de explicar ajuda o tutor ou interrompe demais o fluxo?
- A variação final pode ser resolvida com menos ajuda?
- O retorno do tutor distingue erros de estrutura, aparência e entendimento?
- Trocar entre chat e painel atrapalha a continuidade?

Não usar quantidade de cliques, confiança relatada ou número de testes verdes como evidência suficiente de domínio. Guardar tentativas permite investigar o progresso, mas não substitui uma avaliação pedagógica.

## Próximos incrementos sugeridos

| Incremento | Resultado esperado | Como validar |
| --- | --- | --- |
| Testar uma aula real com Codex e outra com Claude Code | Identificar onde o ciclo de conversa e prática quebra | Registrar dificuldades, qualidade das dicas e autonomia na tarefa final |
| Contratos de rubricas e revisões do tutor | Feedback consistente e vinculado à tentativa | Comparar avaliações com critérios explícitos e casos conhecidos |
| Editor com realce de sintaxe e arquivos | Exercícios de programação mais próximos do trabalho real | Avaliar edição, leitura de erros e preservação de rascunhos |
| Executor isolado para uma segunda linguagem | Exercícios com comportamento verificável | Definir primeiro limites de tempo, memória, rede e acesso a arquivos; depois testar isolamento |
| Adaptador MCP Apps | Atividades dentro dos chats compatíveis | Validar negociação de capacidades e manter o painel como alternativa |
| Exercícios sobre um repositório local | Prática no projeto do aluno | Separar arquivos de exercício, comandos autorizados e evidências de teste |
| Revisão posterior e recuperação sem ajuda | Observar retenção além da mesma sessão | Uma tarefa nova após um intervalo, sem mostrar o exemplo anterior |

A expansão para outros assuntos deve acrescentar tipos de atividade sobre o mesmo modelo de sessão, tentativa, evidência e feedback. Exemplos: ordenar etapas, manipular uma simulação, comparar escolhas de design ou resolver uma situação escrita. O editor de código é um dos componentes, não o centro do modelo de dados.

## Escopo deixado para depois

Contas, colaboração, marketplace de cursos, publicação, pagamento, geração de voz/vídeo e um sistema próprio de agentes ainda não fazem parte do MVP. O primeiro experimento é verificar se uma conversa que alterna orientação e prática melhora a experiência e produz evidência útil para ensinar.
