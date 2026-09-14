# Guia operacional — versão 0.4

Este documento é o caminho recomendado para alguém começar a usar o MCP Tutor localmente.

## Pré-requisitos

- Node.js 22 ou superior;
- um terminal com acesso à pasta do projeto;
- para o chat integrado: Codex CLI instalado, autenticado e disponível como `codex`;
- para uso MCP externo: Codex, Claude Code ou outro cliente que aceite servidor `stdio`.

Claude Code pode usar o servidor MCP com `npm run setup:claude` e conduzir a aula dentro do próprio cliente. Isso é diferente do chat automático do painel: o chat automático da v0.4 usa o backend Luna com modelo fixo `gpt-5.6-luna`.

## Instalação e pré-voo

Na raiz do projeto:

```sh
npm install
npm run check
npm test
```

Uma instalação só deve ser considerada pronta quando os três comandos terminarem sem erro. O teste não precisa de uma API própria do MCP Tutor.

Para um diagnóstico resumido da versão do Node, dados locais, painel e Codex CLI:

```sh
npm run doctor
```

## Escolha do modo de uso

### Chat integrado no navegador

```sh
npm start
```

Abra [http://127.0.0.1:4317](http://127.0.0.1:4317), escolha **Nova conversa**, informe título, objetivo e nível e clique em **Começar aula**. O painel já inicia o Luna: você recebe um plano e uma mini-lição com exemplo, sem precisar enviar novamente o objetivo. A primeira tarefa vem depois dessa explicação, em um próximo turno. Se a abertura falhar, use **Tentar novamente** na mesma aula.

O painel injeta o servidor MCP Tutor diretamente na chamada isolada do backend Luna e não depende do cadastro global. O projeto não solicita nem armazena uma chave de API própria. Use `npm run setup:codex` somente para disponibilizar as ferramentas em conversas externas do Codex. Um status de configuração não confirma autenticação; faça uma chamada real e use seu resultado.

O backend usa obrigatoriamente `gpt-5.6-luna`. Não há override de modelo por ambiente; qualquer variável que tente escolher outro modelo é ignorada. A v0.4 mostra status/fases durante o processamento, mas não promete streaming token-a-token. O cancelamento interrompe a resposta ativa e deixa a sessão disponível para retry.

Consulte o status por sessão com `GET /api/agent?sessionId=…`. A resposta em `session` contém `phase`, `active`, `lastError`, `startedAt`, `updatedAt` e `elapsedSeconds`. As fases incluem `idle`, `starting`, `connecting`, `thinking`, `reading_session`, `updating_plan`, `creating_activity`, `reviewing_attempt`, `advancing_stage`, `using_tools`, `finishing`, `completed`, `failed` e `cancelled`. `completed` significa que o agente terminou; o `tutorMessage` é salvo logo depois. O status não comprova autenticação.

Para cancelar, envie `POST /api/sessions/:id/chat/cancel` com corpo `{}`. Para repetir a última mensagem sem duplicar o bloco do aprendiz, envie `POST /api/sessions/:id/chat` com `{ "retry": true }`. O cancelamento não desfaz atividades, revisões, avanços ou outras mudanças MCP já persistidas.

### Conversa em um cliente MCP externo

Para Codex:

```sh
npm run setup:codex
```

Para Claude Code:

```sh
npm run setup:claude
```

Depois abra uma nova conversa no cliente e use uma instrução semelhante:

> Use o MCP Tutor para me ensinar [objetivo]. Pergunte o que eu já sei, crie uma sessão, compartilhe o link do painel e ofereça uma atividade pequena por vez. Espere minha tentativa, use dicas graduais, revise com evidência e peça uma reconstrução em outro contexto.

No cliente externo, enviar algo no painel não inicia um turno automaticamente. Após enviar, diga ao tutor: “Enviei minha tentativa; leia a sessão e me ajude com o próximo passo.”

## Rotina de uma aula

1. Defina um objetivo observável, como “criar uma função que transforma texto”, em vez de “aprender JavaScript”.
2. Informe seu nível real e o tempo disponível.
3. Leia a primeira mini-lição e seu exemplo. Tire dúvidas e, quando estiver pronto, peça uma prática pequena sobre o que foi ensinado.
4. Use a aba **Atividade** da superfície **Estudo** como área de prática; Aulas fica à esquerda e a conversa permanece ampla no centro para perguntas e descobertas durante a tentativa.
5. Envie a resposta e, quando ajudar a revisão, acrescente o raciocínio complementar e sua confiança. No chat integrado, o painel tenta pedir a revisão automaticamente se o tutor estiver habilitado e livre.
6. Peça no máximo uma dica por vez quando travar.
7. Se a revisão automática não for iniciada, peça a revisão ao terminar; depois leia o feedback e corrija a tentativa antes de pedir a solução.
8. Explique com suas próprias palavras e refaça uma variação sem copiar o exemplo.
9. Ao terminar, registre o que ainda precisa praticar e retome a mesma sessão depois, se necessário.

Estudo, à direita em telas largas, reúne as abas **Atividade**, **Dicas**, **Notas** e **Plano**. Em telas pequenas, abra-o pelo botão **Estudo**. Materiais e histórico ficam fora do chat. Notas são privadas em `localStorage` por sessão e não são enviadas ao tutor. Uma atividade respondível aberta é intencional: ela impede que a conversa acumule tarefas sem que haja tentativa. Durante uma resposta do agente, observe status/fase — conexão, raciocínio, leitura, criação, revisão, avanço, finalização, falha ou cancelamento — e aguarde a conclusão ou cancele antes de enviar outra mensagem para a mesma sessão.

Arraste a divisória entre chat e Estudo para ampliar o editor ou a conversa. Sua preferência fica salva neste navegador. Com foco no divisor, use as setas; dois cliques restauram a largura padrão. Consulte os [limites e o início automático](mini-lessons-and-layout.md).

## Configuração e isolamento local

O padrão é porta `4317` e diretório `.data` dentro do projeto. Para uma instância independente, defina ambos:

```sh
TUTOR_PORT=4318 TUTOR_DATA_DIR=/tmp/meu-tutor npm start
```

No PowerShell:

```powershell
$env:TUTOR_PORT='4318'
$env:TUTOR_DATA_DIR='C:\caminho\meu-tutor-data'
npm start
```

Não execute duas instâncias com o mesmo `TUTOR_DATA_DIR`. O painel usa `.data/runtime.json` para o token local, porta e PID da instância. O histórico fica em `.data/sessions.json`; esse diretório está no `.gitignore`, mas contém conteúdo de aprendizagem e código enviado pelo aluno.

Para desativar o backend automático do chat:

```sh
TUTOR_AGENT=none npm start
```

O chat integrado não oferece override de modelo. Para Claude Code, use a conexão MCP externa; ela não transforma o Claude em backend automático do navegador.

## Backup e encerramento

Antes de atualizar ou mover a instalação, encerre o serviço e crie uma cópia privada:

```sh
npm run backup
```

O comando valida o JSON e cria uma cópia com data e hora em `.data/backups/`, sem sobrescrever backups anteriores nem alterar `sessions.json`. Preserve também a versão do projeto que criou o arquivo. Não copie o token de `runtime.json` para um repositório ou compartilhe a pasta de dados.

Para encerrar um serviço iniciado no terminal, use `Ctrl+C`. Se o serviço foi iniciado automaticamente por `src/mcp.js`, consulte `.data/runtime.json`, confirme que o PID pertence ao MCP Tutor e envie SIGTERM. Não mate processos pelo nome de forma ampla.

Ainda não há restauração ou limpeza seletiva automatizada. Restaure somente com o serviço encerrado, mantenha uma cópia do arquivo atual e não apague `.data` para corrigir uma falha sem preservar o histórico primeiro.

## Troubleshooting

### “A porta 4317 está ocupada”

Abra `http://127.0.0.1:4317/health`. Se retornar `app: mcp-tutor`, reutilize o painel existente. Se for outro processo, encerre apenas depois de identificar o PID ou inicie outra instância com `TUTOR_PORT` e `TUTOR_DATA_DIR` diferentes.

### O painel abre, mas o chat diz que o agente está indisponível

Não conclua que há autenticação apenas porque o status mostra o agente configurado. Envie uma mensagem real e examine o resultado; confirme também que o backend Luna está disponível. A mensagem do aluno deve continuar no histórico mesmo quando a chamada falha ou é cancelada.

### O agente responde sem criar atividade

Peça explicitamente: “Leia `progress` e crie uma única atividade pequena na etapa atual usando `tutor_add_block`.” Se continuar, verifique se o cliente carregou o servidor MCP e se a conversa está usando a sessão correta. O chat não deve criar uma segunda sessão para a mesma conversa.

### A configuração do Claude Code não funciona

Verifique se o comando `claude` está instalado e se uma nova conversa foi aberta após `npm run setup:claude`. Essa configuração habilita o servidor MCP no Claude Code; ela não configura o Claude como backend do chat automático do navegador.

### A tentativa JavaScript fica em erro ou timeout

Reduza o exercício, remova dependências de rede/DOM/arquivos e envie uma implementação pequena. O executor usa `/exercise-worker.js`, suporta apenas o subconjunto disponível no Worker e impõe aproximadamente 1,5 segundo. A evidência do browser não é confiável nem representa isolamento absoluto; um teste verde ainda precisa de revisão do tutor.

### O histórico parece corrompido

Pare o serviço e faça uma cópia de `.data/sessions.json` antes de qualquer ação. Um arquivo ilegível deve gerar erro explícito; não substitua o arquivo por vazio. Tente restaurar a última cópia conhecida. Se não houver backup, preserve o arquivo para diagnóstico.

### A sessão ficou presa em “aguardando revisão”

Isso é esperado para reflexões e para evidência JavaScript. O tutor precisa chamar `tutor_review_attempt` e, se aprovado, `tutor_advance_stage`. Não tente abrir outra atividade respondível para contornar o estado.

## Checklist de encerramento de uma sessão

- a última tentativa foi revisada com evidência concreta;
- o aluno explicou a decisão e fez uma variação;
- a sessão foi deixada em `completed` ou em um estado claro para retomada;
- nenhum segredo foi enviado como código ou resposta;
- se a sessão for importante, o arquivo de dados foi copiado para backup privado.

## Adições da v0.5: laboratório e revisões

O Laboratório e as aulas de Python/Java exigem Linux, Bubblewrap, libseccomp e Python 3. JDK, GCC e G++ são opcionais e detectados quando instalados em caminhos do sistema. O painel mostra versões e motivos de indisponibilidade. Cada programa usa um arquivo e stdin fornecido de uma vez; não há rede, terminal interativo ou acesso a pastas pessoais. Reinicie o serviço após instalar um runtime.

Use npm run backup antes de atualizar. O Store preserva as aulas e inclui revisões na migração. Ao terminar uma aula de exemplo, uma revisão fica programada para o dia seguinte; a aba Revisões permite recuperar a ideia antes da referência. Não há notificações externas. Reconecte o MCP para carregar tutor_list_runtimes, tutor_run_code, tutor_schedule_review e tutor_get_reviews.
