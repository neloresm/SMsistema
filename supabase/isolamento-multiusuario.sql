-- =====================================================================
-- ISOLAMENTO MULTIUSUÁRIO (multitenant) para o SM sistema
-- Rode este script no Supabase → SQL Editor.
-- É SEGURO: não apaga dados. Apenas vincula a sua linha atual ao seu
-- usuário e ativa o Row Level Security (RLS) por user_id.
--
-- ORDEM IMPORTANTE: rode este SQL ANTES (ou junto) de publicar a nova
-- versão do site. Recomendo exportar um relatório antes, por garantia.
-- =====================================================================

-- 1) coluna de proprietário
alter table public.app_data add column if not exists user_id uuid references auth.users(id);

-- 2) cada usuário terá UMA linha própria (identificada por user_id)
create unique index if not exists app_data_user_id_uidx on public.app_data (user_id);

-- 3) permitir inserir novas linhas sem informar "key" (gera uma automática)
--    (a sua linha atual continua com key = 'db'; novas linhas ganham uma key aleatória)
alter table public.app_data alter column key set default gen_random_uuid()::text;

-- 4) VINCULAR A LINHA ATUAL ('db') AO PRIMEIRO ADMINISTRADOR (você).
--    Seus dados NÃO são alterados — só passam a ter dono.
update public.app_data
set user_id = (
  select id from public.profiles
  where role = 'Administrador' and aprovado = true
  order by criado_em asc
  limit 1
)
where key = 'db' and user_id is null;

-- (Se por algum motivo o passo 4 não achou admin, rode manualmente:
--  update public.app_data set user_id = '<SEU_AUTH_USER_ID>' where key='db';)

-- 5) ativar RLS
alter table public.app_data enable row level security;

-- 6) remover QUAISQUER políticas antigas de app_data (que davam acesso amplo)
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='app_data'
  loop
    execute format('drop policy if exists %I on public.app_data', pol.policyname);
  end loop;
end $$;

-- 7) políticas novas: cada usuário só acessa a PRÓPRIA linha (auth.uid() = user_id)
create policy "app_data_select_own" on public.app_data
  for select to authenticated using (auth.uid() = user_id);

create policy "app_data_insert_own" on public.app_data
  for insert to authenticated with check (auth.uid() = user_id);

create policy "app_data_update_own" on public.app_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "app_data_delete_own" on public.app_data
  for delete to authenticated using (auth.uid() = user_id);

-- =====================================================================
-- CONFERÊNCIA (opcional): veja que sua linha ficou com user_id preenchido
-- select key, user_id, length(value) as tamanho from public.app_data;
-- =====================================================================
