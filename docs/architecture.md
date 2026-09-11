# Arquitetura e fronteiras de confiança — versão 0.4

## Visão geral

O MCP Tutor é um serviço local com dois pontos de entrada: um servidor MCP por `stdio` para o cliente de IA e um servidor HTTP para o painel do navegador. Ambos apontam para o mesmo armazenamento local e para a mesma máquina de estados.

```text
Codex / Claude Code / outro cliente MCP
              │ stdio
              ▼
        src/mcp.js
              │ HTTP local + Bearer
              ▼
         src/server.js ───────► public/
               │                     │
               │                     ├─ Aulas (esquerda)
               │                     ├─ chat central amplo
               │                     ├─ Estudo (direita: abas)
               │                     ├─ drawer Estudo em telas pequenas
               │                     └─ `/exercise-worker.js` para JS
              ▼
        src/store.js ───────► .data/sessions.json
              │
              └─ eventos e progresso persistidos

Chat integrado do navegador ─► backend Luna ─► gpt-5.6-luna
```

Em telas largas, a composição é Aulas à esquerda, chat central amplo e Estudo à direita. Estudo contém as abas Atividade, Dicas, Notas e Plano. Em telas pequenas, a superfície Estudo é um drawer aberto pelo botão Estudo. A conversa é o espaço para perguntas e orientação; materiais e histórico ficam nas superfícies próprias, fora do transcript. As notas são privadas no `localStorage` de cada `sessionId` e não fazem parte dos dados enviados ao tutor.

## Responsabilidade dos componentes

| Componente | Responsabilidade | Não deve ser confundido com |
| --- | --- | --- |
| `src/mcp.js` | Registra ferramentas, prompt e recurso MCP; inicia ou encontra o serviço HTTP | Um modelo de IA ou um banco de dados |
| `src/server.js` | Autenticação local, rotas HTTP, SSE, arquivos estáticos e ponte para ferramentas | Uma API pública multiusuário |
| `src/store.js` | Validação de domínio, persistência, eventos, tentativas e transições | Um avaliador completo de aprendizagem |
| `src/schema.js` | Contratos das sessões, blocos, tentativas, revisões e orientação do tutor | Uma rubrica universal para qualquer assunto |
| `src/agent.js` | Ponte do chat para o backend Luna, com modelo fixo `gpt-5.6-luna`, status e cancelamento | Uma integração genérica com qualquer provedor |
| `public/` | Aulas, chat central, Estudo, drawer responsivo, editores, prévias e envio de evidências | Um ambiente de execução de código no servidor |
| `public/study-layout.js` | Divisória arrastável, limites responsivos, teclado e preferência de largura | Uma alteração no conteúdo das aulas |
| `.data/` | Histórico local e metadados efêmeros de conexão | Armazenamento criptografado ou sincronizado |

## Fluxo de uma mensagem no chat integrado

A criação pelo formulário envia `startTutor: true` a `POST /api/sessions`. O servidor salva uma mensagem inicial derivada do objetivo e inicia a mesma ponte de chat em segundo plano. O HTTP `201` não aguarda o modelo; status e SSE acompanham a aula mesmo após reload. O primeiro turno integrado bloqueia exercícios respondíveis para reservar a abertura à explicação e a um exemplo. Ver [contrato completo](mini-lessons-and-layout.md).

1. O navegador envia `POST /api/sessions/:id/chat` com uma mensagem JSON.
2. O servidor grava a mensagem do aluno antes de chamar o agente.
3. `src/agent.js` monta um contexto limitado com objetivo, progresso, blocos recentes e tentativas recentes.
4. Luna recebe a orientação com `gpt-5.6-luna` e pode chamar o servidor MCP configurado para a sessão.
5. As ferramentas MCP alteram a sessão por meio do mesmo `Store`, preservando a máquina de estados.
6. O texto final do agente é gravado como mensagem do tutor e o navegador atualiza o painel.

Se o agente falhar, a mensagem do aluno continua salva e uma mensagem de conexão é registrada. O cliente oferece retry; a aula também pode ser retomada por um cliente MCP externo.

Durante esse fluxo, a ponte atualiza status da sessão e a fase operacional (`connecting`, `thinking`, leitura da sessão, atualização do plano, criação de atividade, revisão, avanço ou `finishing`). O painel pode cancelar uma execução ativa. Essas atualizações não são streaming token-a-token, não liberam atividade, não avançam a máquina de estados e não substituem a resposta final.

## Dados e concorrência

O arquivo `.data/sessions.json` contém sessões, blocos, tentativas, avaliações, eventos e progresso. O `Store` serializa escritas e usa substituição atômica. Existe uma instância de serviço por diretório de dados; iniciar dois processos contra o mesmo diretório não é suportado.

O painel usa cookie local `HttpOnly` e o MCP usa um Bearer token lido de `.data/runtime.json`. O serviço aceita somente `127.0.0.1` e `localhost` na porta configurada, valida origem e rejeita requisições cross-site. Isso reduz exposição acidental, mas não substitui isolamento de usuário nem criptografia em repouso. Um endpoint/status de configuração não é prova de autenticação; essa condição só é conhecida após uma chamada real bem-sucedida.

## Fronteiras de confiança

- A mensagem, o raciocínio complementar opcional e o código do aluno são dados não confiáveis. O prompt do agente os delimita, mas a qualidade dessa defesa também depende do cliente e do modelo.
- O JavaScript do aluno roda em `/exercise-worker.js`, um Worker dedicado descartável no navegador, com limite de 1,5 segundo e `connect-src 'none'`. A página principal mantém `script-src 'self'` sem `unsafe-eval` e `worker-src 'self'` sem `blob:`; o asset do Worker responde com `default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'` para que `Function` funcione somente no Worker. O servidor não executa esse código.
- A evidência produzida pelo Worker — status, checks, saída, erro e duração — é não confiável e não implica isolamento absoluto. Ela deve ser tratada como sinal para revisão do tutor, não como prova de domínio nem como garantia contra código hostil.
- A prévia HTML não executa scripts e bloqueia recursos externos.
- Luna roda localmente em modo efêmero com `--sandbox read-only` e `gpt-5.6-luna` fixo. Isso restringe alterações feitas pelo processo, mas o processo herda o ambiente local e usa a autenticação já disponível. Não trate a instalação como sandbox de segurança para dados secretos ou código hostil.
- O MCP Tutor não fornece autenticação própria, controle de acesso por usuário, rate limiting público ou auditoria de identidade.

## Decisões que orientam a evolução

O núcleo de sessão/tentativa/evidência deve permanecer independente do cliente. Uma futura extensão MCP Apps ou outro frontend deve reutilizar os contratos e o `Store`, sem duplicar a máquina de estados. Novos executores de linguagem só devem ser adicionados depois de uma revisão específica de isolamento; adicionar uma linguagem ao schema não equivale a torná-la segura para execução.
