# SM sistema — Gestão de Gado de Elite

Sistema web para gestão de gado de elite: **Animais, Prenhezes e Aspirações**, com compra por cotas, comissão automática (8% sobre o valor da compra), geração automática de parcelas (pagas automaticamente pela data de vencimento), genealogia em árvore de pedigree horizontal (machos em azul, fêmeas em rosa), sociedade informativa, leilões/locais/vendedores com autocomplete, login com aprovação de usuários, dashboard e relatórios com exportação CSV.

Construído com **React + Vite + Recharts**.

## Rodar localmente

Pré-requisito: [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev
```

Abra o endereço mostrado no terminal (normalmente `http://localhost:5173`).

Para gerar a versão de produção:

```bash
npm run build   # gera a pasta dist/
```

## Publicar este projeto no GitHub

1. Crie um repositório vazio em <https://github.com/new> (ex.: `sm-sistema`). **Não** marque "Add a README" (este projeto já tem um).
2. No terminal, dentro desta pasta:

```bash
git remote add origin https://github.com/SEU_USUARIO/sm-sistema.git
git branch -M main
git push -u origin main
```

(O repositório Git local já vem iniciado com o primeiro commit.)

Alternativa com GitHub CLI:

```bash
gh repo create sm-sistema --private --source=. --push
```

## Publicar o site (deploy)

Qualquer host de site estático funciona:

- **Vercel** (mais fácil): importe o repositório em <https://vercel.com/new> — ela detecta Vite automaticamente.
- **Netlify**: build command `npm run build`, publish directory `dist`.
- **GitHub Pages**: adicione `base: "/sm-sistema/"` no `vite.config.js`, rode `npm run build` e publique a pasta `dist` (por exemplo com a action `actions/deploy-pages`).

## ⚠️ Limitação importante: dados locais (sem servidor)

Este projeto é **somente front-end**. Fora do ambiente Claude, os dados (animais, parcelas, usuários e senhas) são salvos no **localStorage do navegador** — ou seja:

- cada navegador/aparelho tem **seus próprios dados**;
- **não há sincronização** entre usuários/aparelhos diferentes;
- o login funciona por aparelho, e o hash de senha no navegador **não substitui** a segurança de um servidor;
- limpar os dados do navegador apaga o banco.

Para uso real multiusuário (você + outras pessoas, cada um no seu aparelho, mesmo banco em tempo real), conecte um back-end como **Firebase** (Auth + Firestore) ou **Supabase** (Auth + Postgres). A estrutura do código já concentra leitura/escrita na interface `window.storage` (ver `src/main.jsx`), o que facilita trocar o adaptador local por chamadas ao back-end.

## Estrutura

```
sm-sistema/
├── index.html          # página raiz (título da aba)
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx        # bootstrap + adaptador de armazenamento
    └── App.jsx         # todo o sistema (componentes, lógica, estilos)
```
