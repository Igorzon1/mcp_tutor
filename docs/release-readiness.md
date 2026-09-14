# Prontidão de entrega — versão 0.4

A versão desta documentação permanece **0.4**; não há incremento de versão nesta mudança.

## Veredito atual

**Nível: piloto local controlado.**

O MCP Tutor tem um caminho principal funcional: iniciar uma sessão, abrir o painel, apresentar uma atividade, registrar tentativa, revisar evidência e avançar a máquina de estados. O chat integrado com Luna foi conectado ao mesmo núcleo MCP, com status por sessão, retry da última mensagem e cancelamento. Isso é uma base boa para uso individual e testes com pessoas conhecidas.

O produto ainda não atende ao padrão de lançamento público ou multiusuário. O armazenamento, a identidade, a operação do agente, a observabilidade e a cobertura de clientes ainda são insuficientes para prometer disponibilidade, privacidade forte ou execução segura em escala.

## Matriz de critérios

| Área | Estado atual | Critério para declarar pronto para piloto | Critério para lançamento público |
| --- | --- | --- | --- |
| Jornada | Chat central amplo, Aulas à esquerda e Estudo à direita; drawer Estudo em telas pequenas | Uma pessoa nova completa uma aula curta sem orientação operacional extra | Testes moderados em objetivos e tamanhos de tela variados |
| Pedagogia | Máquina de estados e orientação do tutor | Tentativas, dicas e transferência são observáveis | Rubricas, avaliação de qualidade e evidência de retenção |
| Luna | Backend obrigatório com `gpt-5.6-luna`, sem override de ambiente | Status, falha e cancelamento recuperáveis; chamada real confirma disponibilidade | Matriz de versões, retry e telemetria sem conteúdo sensível |
| Claude Code | Cliente MCP via `stdio` documentado | Ferramentas carregam e o tutor conduz a aula no Claude | Adaptador próprio se o chat automático do navegador for prometido |
| Dados | JSON local, escrita serializada | Backup manual e uma instância por diretório | Contas, autorização, criptografia, migrações e restore testado |
| Segurança | Loopback, token/cookie, CSP separada do Worker e ausência de `blob:` na página principal | Uso em máquina pessoal e conteúdo não secreto; evidência do browser tratada como não confiável | Threat model, isolamento revisado, rate limiting e auditoria |
| Código executável | HTML sem script; JavaScript em `/exercise-worker.js` com `Function`, CSP própria e limite de 1,5 s | Exercícios pequenos e conhecidos, sem promessa de isolamento absoluto | Executor adicional somente com isolamento independente validado |
| Operação | Healthcheck, diagnóstico, backup, status e cancelamento do agente | Procedimento de troubleshooting seguido com sucesso; status não é tratado como prova de autenticação | Métricas, alertas, atualização e recuperação automatizadas |
| Privacidade da UI | Notas por sessão em `localStorage`; materiais e histórico fora do chat | Notas não aparecem em payloads do tutor e as superfícies são compreensíveis | Auditoria de retenção, exportação e exclusão por pessoa |
| Distribuição | Execução local por Node | README e guia operacional suficientes | Empacotamento, instalação reproduzível e política de suporte |

## Definition of Ready para mudanças

Uma mudança de produto só está pronta para entrar em uma versão do piloto quando:

1. o comportamento esperado está descrito na documentação correspondente;
2. o caminho principal e pelo menos um erro recuperável foram exercitados;
3. a mudança não enfraquece a máquina de estados, a fronteira de execução ou a privacidade local;
4. `npm run check` e `npm test` passam;
5. a documentação diz claramente quais clientes e modos são suportados;
6. existe uma forma de desfazer ou recuperar os dados afetados.

Para o chat da v0.4, também é obrigatório demonstrar modelo fixo Luna, ignorar overrides de modelo por ambiente, expor status operacional, cancelar uma execução ativa sem duplicar mensagens e não apresentar status como prova de autenticação. A documentação não deve prometer streaming token-a-token.

Para uma integração com agente ou cliente novo, acrescente um teste manual registrado com versão do cliente, comando usado, criação de sessão, atividade, tentativa, revisão e retomada.

## Definition of Done para o piloto

Antes de convidar uma pessoa a usar o produto, confirme:

- Node.js 22+ instalado;
- `npm install`, `npm run check` e `npm test` concluídos;
- uma chamada real ao agente concluída ou falhou de modo observável; o status sozinho não é usado para declarar autenticação;
- diferença entre chat Codex integrado e Claude Code via MCP compreendida;
- backup privado de uma sessão de teste criado;
- porta e diretório de dados definidos;
- usuário informado de que não há login, nuvem, colaboração ou promessa de segurança para segredos;
- uma aula curta completada com explicação e transferência;
- uma falha de agente ou reinício do serviço recuperado sem apagar `.data`.

## Riscos que bloqueiam uma declaração mais forte

- compartilhar o painel fora da máquina local;
- armazenar segredos, tokens ou código proprietário sem política de proteção;
- executar linguagens adicionais no servidor sem sandbox independente;
- anunciar “suporte Claude no chat integrado” sem implementar e testar um adaptador específico;
- considerar testes automáticos ou confiança relatada como prova de domínio;
- apagar `.data` para resolver falhas sem backup;
- iniciar múltiplos serviços com o mesmo diretório de dados.

## Roadmap de maturidade

### P0 — confiabilidade e segurança operacional

- restauração assistida e teste periódico dos backups já automatizados por `npm run backup`;
- teste periódico do diagnóstico de inicialização, agente indisponível, timeout e arquivo inválido;
- teste manual Codex e Claude Code com versões registradas;
- rubricas mínimas por tipo de atividade e revisão baseada em evidência;
- revisão independente da fronteira do agente, herança de ambiente e política de dados sensíveis.

### P1 — experiência de uso consistente

- fila, telemetria e recuperação de resposta do agente;
- auditoria assistiva com leitor de tela e testes em uma matriz de dispositivos;
- rascunhos e arquivos com recuperação previsível;
- matriz de compatibilidade de clientes MCP e mensagens de erro orientadas à ação;
- avaliações de retenção e recuperação sem consulta.

### P2 — expansão controlada

- adaptador MCP Apps, mantendo o painel web como fallback;
- executor adicional somente após threat model e validação de isolamento;
- exercícios ligados a repositórios com escopo e comandos autorizados;
- identidade, sincronização e colaboração apenas quando houver necessidade real e desenho de privacidade.

O produto deve avançar de nível somente quando os critérios da matriz forem demonstrados por testes repetíveis, não apenas por uma sessão bem-sucedida.
