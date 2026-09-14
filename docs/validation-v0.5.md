# Validação da versão 0.5

Registro de 14 de setembro de 2026. Esta versão integra o laboratório e as revisões ao chat, editor e máquina de estados da versão 0.4. As duas linhas de trabalho foram preservadas no histórico Git.

## Verificações automatizadas

`npm run quality` concluiu com **86 testes aprovados, zero falhas e zero casos pulados**, nesta máquina Linux com Python, JDK, Node, GCC, G++, Bubblewrap e libseccomp disponíveis.

- Execução real nas cinco linguagens, com compilação quando necessária, entrada e saída Unicode.
- Erros de sintaxe/compilação, laços infinitos, cancelamento, saída excessiva, concorrência e limites de memória e arquivos.
- Bloqueio de acesso a pastas do host, variáveis do serviço, rede e criação de processos pelo exercício.
- Percurso completo de Python, casos de entrada e saída, Node local e compatibilidade dos testes JavaScript no Worker.
- Migração de aulas antigas, preservação de conclusão e revisões, referência oculta antes da tentativa e cálculo de intervalos.
- Máquina de estados, uma atividade aberta por vez, plano, revisão e avanço explícito do tutor.
- Contratos do agente, status, cancelamento/retry, editor, formatação de mensagens, Worker, painel ajustável, backup e integração pelo SDK MCP real.

Os testes do agente usam processos controlados. Esta verificação não revalida disponibilidade ou qualidade do modelo remoto em uma conversa real.

## Verificação no navegador

- Python e Java executados no laboratório, com entrada e saída no console.
- Cancelamento de um laço infinito e execução normal em seguida.
- Aviso de resultado anterior quando código ou entrada são modificados.
- Aula demonstrativa de Python percorrida até o agendamento; resposta de recuperação registrada antes da referência, seguida de autoavaliação e reagendamento.
- Após integrar a versão remota: Java executado dentro da atividade, três casos de teste aprovados e passagem para a explicação.
- Teoria e exemplo visíveis desde o início da aula; rótulo de roteiro guiado sem sugerir resposta de IA.
- Revisão existente preservada na interface integrada.
- Em largura de 390 px: painel Estudo abre como drawer e a página permanece sem rolagem horizontal; navegação e revisões continuam acessíveis.
- Nenhum erro ou aviso do navegador observado no fluxo integrado verificado.

As aulas existentes foram preservadas, com cópia local anterior à migração em `.data/backups/pre-v0.5-integration.json`. As tentativas usadas para verificar a interface pertencem a aulas demonstrativas; não representam progresso do usuário.

## Limites

Os testes verificam funcionamento e fronteiras específicas do executor; não garantem isolamento contra qualquer falha do kernel ou runtime. Cada programa usa um arquivo temporário, sem rede ou pacotes de projeto. A base pedagógica e seus limites estão em [pedagogy.md](pedagogy.md): testes verdes e autoavaliação não comprovam aprendizagem.
