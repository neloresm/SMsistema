-- =====================================================================
-- SM SISTEMA — Configuração do banco de dados (executar UMA única vez)
-- Onde: Supabase → SQL Editor → New query → cole este arquivo → RUN
-- Resultado esperado: "Success. No rows returned"
-- =====================================================================

-- 1) Perfis de usuário (nome, permissão, aprovação)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  role text not null default 'Usuário',
  aprovado boolean not null default false,
  criado_em timestamptz not null default now()
);

-- 2) Dados do sistema (animais, prenhezes, aspirações, parcelas etc.)
create table if not exists public.app_data (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- 3) Funções auxiliares de permissão
create or replace function public.is_aprovado() returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select aprovado from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select (role = 'Administrador') and aprovado from public.profiles where id = auth.uid()), false);
$$;

-- 4) Criação automática do perfil quando alguém se cadastra
--    (o PRIMEIRO usuário do sistema vira Administrador, já aprovado)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare cnt int;
begin
  select count(*) into cnt from public.profiles;
  insert into public.profiles (id, nome, email, role, aprovado)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    new.email,
    case when cnt = 0 then 'Administrador' else 'Usuário' end,
    cnt = 0
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Segurança (RLS): somente usuários logados e APROVADOS acessam os dados
alter table public.profiles enable row level security;
alter table public.app_data enable row level security;

drop policy if exists "perfil: proprio ou admin ve todos" on public.profiles;
create policy "perfil: proprio ou admin ve todos"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "perfil: admin altera" on public.profiles;
create policy "perfil: admin altera"
  on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "dados: aprovados leem" on public.app_data;
create policy "dados: aprovados leem"
  on public.app_data for select
  using (public.is_aprovado());

drop policy if exists "dados: aprovados inserem" on public.app_data;
create policy "dados: aprovados inserem"
  on public.app_data for insert
  with check (public.is_aprovado());

drop policy if exists "dados: aprovados atualizam" on public.app_data;
create policy "dados: aprovados atualizam"
  on public.app_data for update
  using (public.is_aprovado()) with check (public.is_aprovado());

-- 6) Índices auxiliares
create index if not exists idx_profiles_criado_em on public.profiles (criado_em);
create index if not exists idx_app_data_updated_at on public.app_data (updated_at);
