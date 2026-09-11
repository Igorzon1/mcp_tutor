# Registro de validação — v0.4

**Data:** 2026-09-10  
**Status:** evidência parcial de validação manual e automatizada; não é declaração de prontidão pública nem de segurança.

Este registro reúne somente o que foi observado até agora. Ele não substitui a [prontidão de entrega](release-readiness.md) e não deve ser lido como conclusão dos itens ainda em teste.

## Evidências observadas

- **JavaScript no browser:** o exercício de dobro retornou `8`; dois testes passaram.
- **Loop:** um loop infinito foi interrompido após aproximadamente `1,5 s` e a UI não congelou.
- **Persistência local:** o rascunho de código e as notas persistiram após reload.
- **Privacidade das notas:** as notas privadas não foram enviadas ao tutor.
- **Viewport móvel:** com width `390`, não houve overflow; `scrollWidth` observado foi `390`.
- **Drawer Estudo:** o Estudo abriu como drawer, recebeu foco em **Fechar** e fechou corretamente.
- **Luna real:** respondeu a uma pergunta de dica em aproximadamente `10 s` sem alterar o desafio.
- **Duplicação de mensagem:** foi observada duplicação causada por `message` via MCP e mensagem final. O prompt foi corrigido e há um teste novo cobrindo resposta direta mais salvamento automático da mensagem final.
- **Tentativa com raciocínio vazio:** o envio de código com o campo de raciocínio em branco foi aceito e a revisão automática foi acionada.
- **Reload durante resposta:** o reload recuperou o estado da resposta (`thinking`/`finishing`) e exibiu o botão **Parar**.
- **Revisão Luna concluída:** Luna aprovou o código, avançou de `practice` para `explain` e criou no painel lateral a reflection **“Explique a função dobro”**. A reflection foi criada, mas sua conclusão não está declarada neste registro.
- **Mensagem final:** após o ajuste do prompt, houve apenas uma mensagem final do tutor, sem duplicação causada por `message` via MCP.
- **Rascunho durante revisão:** uma próxima mensagem digitada enquanto a revisão estava em andamento permaneceu intacta após a conclusão.
- **Cancelamento real:** ao clicar em **Parar** durante um turno ativo, a UI mostrou **“Resposta interrompida por você”**, reabilitou o composer, não criou mensagem tutor parcial e preservou atividade e histórico.
- **Retomada real após cancelamento:** depois de cancelar e fazer reload, **Retomar resposta** concluiu com status `completed` em aproximadamente `9 s`, usando o modelo `gpt-5.6-luna`. A mesma atividade permaneceu ativa pelo mesmo `activeBlockId`; uma consulta `GET` da sessão confirmou exatamente uma cópia da pergunta learner. A resposta do tutor foi salva sem duplicar a pergunta.
- **Prompts de atividades:** os prompts agora usam a mesma formatação Markdown segura do chat, sem backticks crus.

## Ambiente e verificações finais

- Node.js: `v24.11.0`.
- Codex CLI: `0.153.4`.
- `quality`: **42 testes aprovados**.
- `git diff --check`: **aprovado**.

## Suíte atual

A contagem informada é de **42 testes realizados nesta rodada**.

## Pendências explícitas

- A conclusão da reflection criada ainda não foi testada, e o restante da jornada e dos critérios de validação não está concluído por este registro.
- A prontidão para publicação ou release público permanece não testada e não declarada.
- Estas observações não provam isolamento absoluto do Worker, segurança para código hostil, prontidão para publicação ou release público.
