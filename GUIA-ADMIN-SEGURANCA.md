# Guia — Proteção do Admin + Exclusão Segura de Usuários

Você faz 3 coisas no Supabase (uma vez). A `service_role` fica só no backend, nunca no site.

## 1) Rodar o SQL de proteção do admin
Supabase → SQL Editor → cole e rode `supabase/admin-protecao.sql`.
Isso: marca sua conta como **principal** (protegida), impede que te rebaixem/excluam
(inclusive outro admin ou via API), impede usuário comum de virar admin, e cria a
tabela de **log** (admin_log). Seguro: não apaga nada.

> Confira depois: `select email, role, aprovado, principal from public.profiles;`
> A sua linha deve ter `principal = true`.

## 2) Publicar a Edge Function `excluir-usuario`
Pasta: `supabase/functions/excluir-usuario/index.ts`.

Opção CLI:
```
supabase functions deploy excluir-usuario
```
Opção painel: Edge Functions → Create function → nome `excluir-usuario` → cole o index.ts → Deploy.

## 3) Conferir os secrets da função
As Edge Functions já recebem automaticamente `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY`. Você **não** precisa cadastrar nada.
(Se sua versão do Supabase não injetar `SUPABASE_ANON_KEY`, adicione-a em
Edge Functions → Manage secrets.)

## 4) Publicar o site novo
GitHub → suba o `src/App.jsx` → Netlify republica. Pronto.

## Como funciona a exclusão (o que você pediu)
1. Admin clica em **🗑 Excluir** na aba Usuários.
2. Abre confirmação com **nome e e-mail** do alvo.
3. Pede a **SUA senha de administrador**.
4. A Edge Function **reautentica** essa senha no backend (não é comparação no front).
5. Só então exclui: usuário do Auth + perfil + **a linha de dados dele** (app_data por user_id).
6. Senha errada → nada acontece.
7. A conta **principal** e a **sua própria** conta nunca aparecem com opção de excluir,
   e o banco recusa a exclusão mesmo se tentarem pela API.
8. A ação fica registrada em **admin_log** (quem excluiu, quem foi excluído, quando).

## Testes (do seu checklist)
- Novo usuário cria conta → aparece **pendente** → não entra até você aprovar.
- Você aprova → ele entra (base vazia, isolada).
- Usuário comum não vê a aba Usuários.
- Excluir usuário → pede sua senha → senha errada não exclui → senha certa exclui.
- Conta excluída não entra mais; os dados dela somem; os seus e dos demais ficam intactos.
- Sua conta continua **Administrador principal** o tempo todo.
