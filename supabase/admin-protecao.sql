-- =====================================================================
-- SM SISTEMA — Proteção do Administrador Principal + Log de ações
-- Onde: Supabase → SQL Editor → New query → cole → RUN
-- Seguro: não apaga nem altera seus dados. Só adiciona proteções.
-- =====================================================================

-- E-MAIL DO ADMIN PRINCIPAL (âncora fixa e protegida)
-- Se um dia trocar, altere só esta linha e rode de novo.
-- ---------------------------------------------------------------------

-- 1) Marca sua conta como admin principal e garante Administrador+aprovado.
--    (não cria nada novo; só reforça o que já é seu)
alter table public.profiles add column if not exists principal boolean not null default false;

update public.profiles
   set role = 'Administrador', aprovado = true, principal = true
 where lower(email) = lower('fabsebben@gmail.com');

-- 2) Trava no banco: NINGUÉM pode rebaixar, revogar ou mudar o admin principal.
--    Vale inclusive para outro administrador e para chamadas diretas na API.
create or replace function public.protege_admin_principal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.principal = true then
    -- não deixa tirar o papel de admin, revogar aprovação, nem desmarcar principal
    if NEW.role is distinct from 'Administrador'
       or NEW.aprovado is distinct from true
       or NEW.principal is distinct from true then
      raise exception 'A conta administradora principal não pode ser rebaixada, revogada ou desmarcada.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protege_admin_principal on public.profiles;
create trigger trg_protege_admin_principal
  before update on public.profiles
  for each row execute function public.protege_admin_principal();

-- 3) Trava de exclusão: o perfil do admin principal não pode ser apagado.
create or replace function public.bloqueia_delete_principal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.principal = true then
    raise exception 'A conta administradora principal não pode ser excluída.';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_bloqueia_delete_principal on public.profiles;
create trigger trg_bloqueia_delete_principal
  before delete on public.profiles
  for each row execute function public.bloqueia_delete_principal();

-- 4) Impede que usuário comum altere o PRÓPRIO papel (virar admin sozinho).
--    Já havia RLS de admin; esta policy garante que o update de perfil por
--    não-admin nunca mude role/aprovado/principal.
drop policy if exists "perfil: usuario edita so o proprio nome" on public.profiles;
create policy "perfil: usuario edita so o proprio nome"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and aprovado = (select aprovado from public.profiles where id = auth.uid())
    and principal = (select principal from public.profiles where id = auth.uid())
  );

-- 5) Log de ações administrativas (quem aprovou/excluiu quem, e quando)
create table if not exists public.admin_log (
  id uuid primary key default gen_random_uuid(),
  acao text not null,                -- 'aprovar' | 'revogar' | 'excluir' | 'mudar_papel'
  alvo_id uuid,                      -- usuário afetado
  alvo_email text,
  alvo_nome text,
  feito_por uuid,                    -- admin que fez
  feito_por_email text,
  detalhe text,
  criado_em timestamptz not null default now()
);

alter table public.admin_log enable row level security;

drop policy if exists "log: admin le" on public.admin_log;
create policy "log: admin le"
  on public.admin_log for select using (public.is_admin());

drop policy if exists "log: admin insere" on public.admin_log;
create policy "log: admin insere"
  on public.admin_log for insert with check (public.is_admin());

-- pronto. Verifique: select email, role, aprovado, principal from public.profiles;
