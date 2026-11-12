-- =====================================================================
-- SM sistema · Recebimentos · atualização 04
--  - Remover um relatório da contabilidade (ex.: para reimportar)
--    O relatório sai de todos os cálculos, mas o registro fica no histórico.
--    Contratos, parcelas e pagamentos não são alterados.
-- Aditivo: só mexe em objetos rcb_*. Pode rodar de novo sem problema.
-- =====================================================================

alter table public.rcb_repasses add column if not exists removido boolean not null default false;
alter table public.rcb_repasses add column if not exists removido_em timestamptz;
alter table public.rcb_repasses add column if not exists removido_motivo text;
alter table public.rcb_repasses add column if not exists removido_por uuid;

create or replace function public.rcb_remover_repasse(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Apenas administradores podem remover relatórios.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo da remoção.'; end if;
  if not exists (select 1 from rcb_repasses where id = p_id) then raise exception 'Relatório % não encontrado.', p_id; end if;
  update rcb_repasses set removido = true, removido_em = now(), removido_motivo = trim(p_motivo), removido_por = auth.uid()
   where id = p_id and not removido;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'rcb\_%' loop
    execute format('revoke execute on function %s from anon, public;', f.sig);
    execute format('grant execute on function %s to authenticated;', f.sig);
  end loop;
end $$;
