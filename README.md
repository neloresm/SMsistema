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

## Banco de dados na nuvem (Supabase)

O sistema usa o **Supabase** para login (e-mail + senha, gerenciados no servidor) e para o
banco de dados compartilhado: todos os usuários aprovados veem os mesmos dados, em qualquer
aparelho, com sincronização automática (a cada 5 s).

Configuração (uma única vez):
1. No Supabase, desative a confirmação de e-mail: **Authentication → Sign In / Providers → Email → "Confirm email" OFF → Save**.
2. Rode o script `supabase-setup.sql` no **SQL Editor** do projeto.
3. As credenciais (URL + chave publishable) ficam em `src/supabase.js`.

Regras: o **primeiro** cadastro vira Administrador aprovado; os demais entram como Usuário
pendente até o administrador aprovar (menu **Usuários**). A segurança dos dados é garantida
pelas políticas RLS criadas pelo script — sem login aprovado, nada é lido nem gravado.

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
