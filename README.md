# Meu Caixa

Controle financeiro pessoal: lançamentos únicos, fixos e parcelados, saldo atual e previsto,
previsão de 12 meses e calculadora de juros compostos. Funciona offline e se instala no celular.

Tudo roda no navegador (HTML, CSS e JavaScript puros, sem build). Os dados ficam **só no aparelho**
(IndexedDB). Nada vai para o GitHub nem para a Vercel; use **Ajustes > Exportar** para fazer backup.

## Rodar no computador

    python3 -m http.server 8000

Abra http://localhost:8000

## Publicar

**Vercel:** Add New > Project > escolha este repositório > Framework Preset "Other", sem comando de build > Deploy.

**GitHub Pages:** Settings > Pages > Deploy from a branch > `main` / `(root)`.

## Instalar no celular

Abra o endereço publicado no Chrome > menu ⋮ > **Instalar app** (ou Adicionar à tela inicial).

## Atualizar o app depois de mudar os arquivos

1. Em `sw.js`, aumente `VERSAO` (`'v1'` para `'v2'`...). Isso limpa o que o celular guardou da versão antiga.
2. Faça o commit e o push. O celular pega a versão nova na **segunda** abertura do app.

## Testes da lógica

    node testes/logic.test.js

## Estrutura

- `logic.js`: regras e contas (saldo, fixos, parcelas, previsão, juros). Sem DOM, fácil de testar.
- `db.js`: guarda e lê os dados (IndexedDB). Para sincronizar na nuvem no futuro, a mudança fica concentrada aqui.
- `app.js`: telas. `styles.css`: visual. `sw.js` e `manifest.webmanifest`: parte instalável e offline.
- Valores sempre em centavos (inteiros), para não ter erro de arredondamento.
