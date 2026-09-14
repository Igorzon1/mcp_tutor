# Como o Ateliê combina teoria, prática e revisão

As escolhas desta versão se apoiam em guias de evidências sobre aprendizagem. Sua aplicação a um tutor MCP de programação para adultos é uma hipótese de projeto: ainda não medimos a eficácia do Ateliê com alunos.

## Fundamentos e aplicação

O guia do [Institute of Education Sciences: Organizing Instruction and Study to Improve Student Learning](https://ies.ed.gov/ncee/wwc/PracticeGuide/1) recomenda distribuir o estudo, alternar exemplos resolvidos com problemas, combinar gráficos e explicação verbal, usar perguntas que recuperem conhecimentos e pedir explicações profundas. O próprio guia distingue a força da evidência entre recomendações.

No Ateliê, isso orienta uma explicação breve com exemplo comentado, seguida de previsão e exercício. O exemplo não resolve a tarefa seguinte. Um diagrama deve ajudar a explicar o mesmo conceito, sem ser apenas decoração. A etapa de transferência pede outra aplicação, com menos apoio. O tutor pode intercalar conceitos conhecidos para exercitar a escolha da estratégia, sem alternar assuntos aleatoriamente para um iniciante.

O guia da [Education Endowment Foundation: Metacognition and Self-Regulated Learning](https://educationendowmentfoundation.org.uk/education-evidence/guidance-reports/metacognition) enfatiza ensino explícito e apoio ao planejamento, monitoramento e avaliação da própria aprendizagem. Seu contexto é principalmente escolar; não comprova, por si só, resultados de tutores de IA para adultos.

Aplicamos essa orientação a objetivos claros, previsão, explicação do raciocínio, dicas graduais e comparação após a tentativa. O tutor recebe código, histórico, confiança relatada e verificações para escolher o próximo passo. A ajuda deve diminuir quando há evidências de autonomia e aumentar quando uma dificuldade impede o aluno de começar.

## O que a experiência faz

1. **Entender:** objetivo curto e teoria ligada a uma ação, com exemplo comentado diferente do exercício.
2. **Prever:** antecipar um resultado antes de executar ou ver a resposta.
3. **Praticar:** experimentar, inspecionar a saída e enviar uma tentativa com raciocínio.
4. **Explicar:** justificar uma decisão ou comparar alternativas em uma pergunta específica.
5. **Transferir:** resolver outra situação usando o conceito, começando com menos ajuda.
6. **Revisar:** recuperar o conceito depois, antes de consultar a referência, e comparar o que lembrou.

O fluxo é adaptável. Um aluno experiente pode precisar de menos teoria inicial. Uma tentativa com erro pode pedir um exemplo adicional, uma dica ou um exercício menor. Não é necessário solicitar longas explicações em toda interação; perguntas abertas têm apenas um campo de resposta.

## Revisões e limites da avaliação

O calendário inicial usa 1, 3, 7, 14 e 30 dias. “Preciso retomar” volta ao primeiro intervalo; “Lembrei em parte” recua um estágio; “Consegui explicar” avança um estágio. Esses números são uma heurística do produto, não intervalos ótimos demonstrados pelas fontes acima. O aplicativo não usa SM-2, FSRS nem um modelo personalizado de retenção. As aulas demonstrativas agendam a primeira revisão para o dia seguinte; o tutor também pode informar uma data.

A referência fica oculta na API do navegador até o aluno registrar sua resposta. Em seguida, ele compara e relata sua avaliação. O tutor conectado pode ler a referência e o histórico para oferecer feedback. As revisões ficam no painel e não disparam mensagens ou turnos do modelo automaticamente.

Testes verdes mostram que um programa satisfez casos definidos, não que o aluno compreendeu o conceito. Confiança e autoavaliação são relatos, não comprovação. Por isso, a interface distingue resultado automático, feedback do tutor e tentativas. Não atribuímos uma porcentagem de domínio a partir de cliques ou testes aprovados.

## Próxima validação com pessoas

Observar se o aluno consegue explicar uma decisão, corrigir um erro com menos ajuda e resolver uma tarefa nova após um intervalo. Comparar isso com as tentativas anteriores e registrar onde a alternância entre conversa e painel interrompe o estudo. Os testes automatizados verificam o funcionamento do produto; não medem aprendizagem.

Fontes consultadas em 14 de setembro de 2026.
