-- =====================================================================
-- SM AGROPECUÁRIA — BACKUP AUTOMÁTICO DIÁRIO (servidor / Supabase)
-- Onde rodar: Supabase → SQL Editor → New query → cole TUDO → RUN.
--
-- É SEGURO: não apaga nem altera seus dados atuais. Só adiciona uma
-- tabela de cópias (app_backups), uma função e um agendamento diário.
-- Roda sozinho no servidor todos os dias, sem depender de abrir o site.
-- A chave de administrador (service_role) NÃO é usada aqui: tudo roda
-- dentro do próprio banco.
-- =====================================================================

-- 1) Agendador interno do Postgres (já disponível no Supabase)
create extension if not exists pg_cron;

-- 2) Tabela que guarda as cópias diárias (protegida por RLS)
create table if not exists public.app_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  value text not null,
  origem text not null default 'automatico',   -- 'automatico' | 'manual'
  criado_em timestamptz not null default now()
);

create index if not exists app_backups_user_data_idx
  on public.app_backups (user_id, criado_em desc);

alter table public.app_backups enable row level security;

-- cada usuário só ENXERGA (lê) as próprias cópias; ninguém grava/apaga pelo app
drop policy if exists "backups: le os proprios" on public.app_backups;
create policy "backups: le os proprios"
  on public.app_backups for select to authenticated
  using (auth.uid() = user_id);

-- 3) Função que tira o retrato diário e mantém as últimas 30 por usuário
create or replace function public.fazer_backup_diario()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- copia o estado atual de cada usuário
  insert into public.app_backups (user_id, value, origem)
  select user_id, value, 'automatico'
    from public.app_data
   where user_id is not null and value is not null;

  -- retenção: mantém as 30 cópias mais recentes de cada usuário
  delete from public.app_backups b
   using (
     select id,
            row_number() over (partition by user_id order by criado_em desc) as rn
       from public.app_backups
   ) ranked
   where b.id = ranked.id and ranked.rn > 30;
end;
$fn$;

-- 4) Agendamento diário às 03:00 de Brasília (06:00 UTC).
--    Remove um agendamento anterior de mesmo nome (se existir) e recria.
do $do$
begin
  perform cron.unschedule('sm_backup_diario');
exception when others then
  null;  -- ainda não existia: tudo bem
end
$do$;

select cron.schedule(
  'sm_backup_diario',
  '0 6 * * *',
  $cron$ select public.fazer_backup_diario(); $cron$
);

-- 5) Gera uma primeira cópia AGORA, para já ter histórico:
select public.fazer_backup_diario();

-- =====================================================================
-- CONFERÊNCIA (opcional):
--   select user_id, origem, criado_em from public.app_backups order by criado_em desc;
--   select jobname, schedule, active from cron.job where jobname = 'sm_backup_diario';
-- =====================================================================
