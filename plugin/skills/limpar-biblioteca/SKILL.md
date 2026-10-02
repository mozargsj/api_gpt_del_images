---
name: limpar-biblioteca
description: Apaga os arquivos da biblioteca do ChatGPT (chatgpt.com/library). Use quando o usuario pedir para limpar, esvaziar ou apagar a biblioteca.
---

Executa o script local do plugin (precisa de shell no computador do usuario, com Node e Chrome instalados).
O script fica em `scripts/clean.mjs`, dois niveis acima deste arquivo (`../../scripts/clean.mjs`).

1. Se o usuario ainda nao logou, rode `node <plugin>/scripts/clean.mjs login` e peca para ele entrar no ChatGPT e fechar o navegador.
2. Rode `node <plugin>/scripts/clean.mjs`.
3. Se `dryRun` estiver `true` em `scripts/config.json`, nada e apagado: diga isso ao usuario e pergunte se quer trocar para `false`.
4. Se o script falhar, mostre o erro e o caminho de `scripts/erro.png`.

O script verifica a data de cada imagem (`record_creation_time`) e so apaga as adicionadas ha mais de `olderThanDays` dias (padrao 15, em `scripts/config.json`); imagens mais recentes sao mantidas. `category` ("image") limita o tipo; `null` inclui todos os arquivos.

Os arquivos vao para o Lixo do ChatGPT e sao eliminados de vez apos 30 dias. Mesmo assim, confirme com o usuario antes de rodar com `dryRun: false`.
