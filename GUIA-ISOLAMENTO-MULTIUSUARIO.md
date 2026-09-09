# Guia — Isolamento de dados por usuário (multitenant)

## O que muda
Hoje todos os dados ficam numa "caixa" única compartilhada. Depois desta correção,
**cada usuário passa a ter a sua própria base**, isolada de verdade no banco (via RLS).
Seus dados atuais são **preservados** e passam a pertencer à sua conta.

## Importante — ORDEM dos passos
Faça **o SQL primeiro**, depois publique o site. (Se publicar o site antes do SQL,
você verá a tela vazia temporariamente — seus dados NÃO se perdem; ao rodar o SQL,
tudo reaparece. Mas o ideal é SQL primeiro.)

---

## Passo 1 — (recomendado) Faça um backup rápido
No sistema atual, vá em **Relatórios → selecione todos → Exportar Excel**. Guarde o arquivo.
É só uma garantia extra; nada será apagado.

## Passo 2 — Rodar o SQL de isolamento
1. Supabase → **SQL Editor** → **New query**.
2. Cole todo o conteúdo de `supabase/isolamento-multiusuario.sql`.
3. Clique em **Run**.
4. Confira no fim (descomente a linha de conferência) que a sua linha ficou com `user_id` preenchido.

> O script vincula automaticamente a linha atual ('db') ao **primeiro administrador aprovado**
> (você). Se aparecer erro dizendo que não achou admin, rode manualmente:
> `update public.app_data set user_id = '<SEU_AUTH_USER_ID>' where key='db';`
> (o seu ID está em Supabase → Authentication → Users → seu e-mail → User UID).

## Passo 3 — Publicar a nova versão do site
1. Baixe/extraia o `sm-sistema.zip`.
2. GitHub → **Add file → Upload files** → suba o `src/App.jsx` (e a pasta `supabase/` se quiser guardar os scripts).
3. **Commit changes** → Netlify republica sozinho.

## Passo 4 — Testar com duas contas
- **Conta A (a sua):** entre normalmente. Você deve ver **todos os seus dados** como antes.
- **Conta B (nova):** crie uma conta nova, com outro e-mail.
  - Observação: pelo fluxo de aprovação atual, a Conta B entra como **pendente** até um
    administrador aprovar (você aprova em **Usuários**). Depois de aprovada, a Conta B
    entra com o sistema **totalmente vazio**.
  - Crie um animal na Conta B → ele aparece só para a Conta B.
  - Volte na Conta A → o animal da Conta B **não aparece**. E os dados da A **não aparecem** para a B.

## Segurança garantida
- O isolamento é no **banco** (RLS), não só no front. Mesmo tentando acessar pela API,
  um usuário só enxerga a própria linha (`auth.uid() = user_id`).
- INSERT/UPDATE/DELETE também são checados por `auth.uid() = user_id`.

## Observações honestas
- **Você e seu pai:** antes vocês compartilhavam a mesma base. Agora, se ele entrar com uma
  conta própria, verá vazio. Para continuarem vendo o mesmo rebanho, usem **o mesmo login**
  (mesma conta). Um compartilhamento entre contas diferentes seria uma funcionalidade nova
  (dá para fazer no futuro, com uma tabela de "equipe/permite ver a base de fulano").
- **Aprovação de novos usuários:** mantive o login exatamente como estava (novos usuários
  ficam pendentes até um admin aprovar). Se você preferir que cada novo cadastro entre
  direto (cada um dono da própria base, sem precisar de aprovação), me avise que eu ajusto —
  é uma pequena mudança no gatilho de cadastro.
