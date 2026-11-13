-- =====================================================================
-- SM sistema · Recebimentos · atualização 05
--  - Ajustes informados pela contabilidade: aceitar ou contestar cada um
--  - Fechamento do mês (trava com data e responsável; reabrir pede motivo)
--  - Mês fechado não aceita envio, troca ou exclusão de relatório
-- Aditivo: só mexe em objetos rcb_*. Pode rodar de novo sem problema.
-- =====================================================================

-- histórico: aceita também tabelas cuja chave é "mes"
create or replace function public.rcb_tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_j jsonb; v_id text;
begin
  if tg_op = 'DELETE' then v_j := to_jsonb(old); else v_j := to_jsonb(new); end if;
  v_id := coalesce(v_j->>'id', v_j->>'chave', v_j->>'mes');
  insert into public.rcb_audit_log (tabela, registro_id, acao, antes, depois, usuario, usuario_email)
  values (tg_table_name, v_id, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid(), (select email from public.profiles where id = auth.uid()));
  return coalesce(new, old);
end $$;

alter table public.rcb_repasse_linhas add column if not exists decisao text check (decisao in ('aceito','contestado'));
alter table public.rcb_repasse_linhas add column if not exists decisao_nota text;
alter table public.rcb_repasse_linhas add column if not exists decisao_por uuid;
alter table public.rcb_repasse_linhas add column if not exists decisao_em timestamptz;

create table if not exists public.rcb_fechamentos (
  mes text primary key check (mes ~ '^\d{4}-\d{2}$'),
  status text not null default 'fechado' check (status in ('fechado','aberto')),
  nota text,
  resumo jsonb,                       -- números do mês no momento do fechamento
  fechado_por uuid, fechado_por_email text, fechado_em timestamptz,
  reaberto_motivo text, reaberto_por uuid, reaberto_em timestamptz
);
alter table public.rcb_fechamentos enable row level security;
drop policy if exists rcb_fechamentos_sel on public.rcb_fechamentos;
create policy rcb_fechamentos_sel on public.rcb_fechamentos for select to authenticated using (public.is_aprovado());
revoke all on public.rcb_fechamentos from anon;
revoke insert, update, delete on public.rcb_fechamentos from authenticated;
drop trigger if exists rcb_fechamentos_audit on public.rcb_fechamentos;
create trigger rcb_fechamentos_audit after insert or update or delete on public.rcb_fechamentos for each row execute function public.rcb_tg_audit();

create or replace function public.rcb_mes_fechado(p_mes text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rcb_fechamentos where mes = p_mes and status = 'fechado');
$$;

create or replace function public.rcb_decidir_ajuste(p_id bigint, p_decisao text, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare v_mes text;
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  if p_decisao is not null and p_decisao not in ('aceito','contestado') then raise exception 'Decisão inválida.'; end if;
  select r.mes into v_mes from rcb_repasse_linhas l join rcb_repasses r on r.id = l.repasse_id where l.id = p_id;
  if v_mes is null then raise exception 'Linha % não encontrada.', p_id; end if;
  if public.rcb_mes_fechado(v_mes) then raise exception 'O mês % está fechado. Reabra o mês para mudar a decisão.', v_mes; end if;
  update rcb_repasse_linhas set decisao = p_decisao, decisao_nota = nullif(trim(coalesce(p_nota,'')),''), decisao_por = auth.uid(), decisao_em = now() where id = p_id;
end $$;

create or replace function public.rcb_fechar_mes(p_mes text, p_nota text, p_resumo jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mês inválido.'; end if;
  insert into rcb_fechamentos (mes, status, nota, resumo, fechado_por, fechado_por_email, fechado_em, reaberto_motivo, reaberto_por, reaberto_em)
  values (p_mes, 'fechado', nullif(trim(coalesce(p_nota,'')),''), p_resumo, auth.uid(), (select email from profiles where id = auth.uid()), now(), null, null, null)
  on conflict (mes) do update set status = 'fechado', nota = excluded.nota, resumo = excluded.resumo, fechado_por = excluded.fechado_por,
    fechado_por_email = excluded.fechado_por_email, fechado_em = excluded.fechado_em;
end $$;

create or replace function public.rcb_reabrir_mes(p_mes text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo para reabrir o mês.'; end if;
  update rcb_fechamentos set status = 'aberto', reaberto_motivo = trim(p_motivo), reaberto_por = auth.uid(), reaberto_em = now() where mes = p_mes;
end $$;

-- envio de relatório: bloqueado em mês fechado
create or replace function public.rcb_salvar_repasse(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; r jsonb; v_cred numeric := 0; v_tax numeric := 0; v_deb numeric := 0; v_contab bigint;
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem enviar relatórios.'; end if;
  if public.rcb_mes_fechado(p->>'mes') then raise exception 'O mês % está fechado. Reabra o mês para enviar ou trocar relatórios.', p->>'mes'; end if;
  if (p->>'substitui') is not null and public.rcb_mes_fechado((select mes from rcb_repasses where id = (p->>'substitui')::bigint)) then
    raise exception 'O relatório substituído pertence a um mês fechado. Reabra o mês primeiro.';
  end if;
  for r in select value from jsonb_array_elements(coalesce(p->'linhas','[]'::jsonb)) loop
    if r->>'tipo' = 'credito' then v_cred := v_cred + (r->>'valor')::numeric;
    elsif r->>'tipo' = 'taxa' then v_tax := v_tax + (r->>'valor')::numeric;
    else v_deb := v_deb + (r->>'valor')::numeric; end if;
  end loop;
  if coalesce((p->>'forcar')::boolean,false) = false and (
       abs(v_cred - coalesce((p->>'creditos')::numeric,0)) > 0.009 or abs(v_tax - coalesce((p->>'taxas')::numeric,0)) > 0.009
    or abs(v_deb - coalesce((p->>'debitos')::numeric,0)) > 0.009) then
    raise exception 'As linhas lidas (créditos %, taxas %, débitos %) não batem com o resumo do relatório. Confira o arquivo.', v_cred, v_tax, v_deb;
  end if;
  v_contab := coalesce(nullif(p->>'contabilidade_id','')::bigint, (select valor::bigint from rcb_config where chave = 'contabilidade_atual'));
  if (p->>'substitui') is not null then
    update rcb_repasses set substituido = true, obs = coalesce(obs || ' · ','') || 'Substituído por novo envio em ' || to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')
     where id = (p->>'substitui')::bigint;
  end if;
  insert into rcb_repasses (mes, titulo, periodo_inicio, periodo_fim, creditos, debitos, taxas, valor_final, arquivo_nome, storage_path, obs, contabilidade_id)
  values (p->>'mes', p->>'titulo', nullif(p->>'periodo_inicio','')::date, nullif(p->>'periodo_fim','')::date,
          coalesce((p->>'creditos')::numeric,0), coalesce((p->>'debitos')::numeric,0), coalesce((p->>'taxas')::numeric,0),
          (p->>'valor_final')::numeric, p->>'arquivo_nome', p->>'storage_path', nullif(p->>'obs',''), v_contab)
  returning id into v_id;
  for r in select value from jsonb_array_elements(coalesce(p->'linhas','[]'::jsonb)) loop
    insert into rcb_repasse_linhas (repasse_id, tipo, contrato_id, parcelas, referencia, descricao, comprador, vencimento, data_credito, honorario, valor)
    values (v_id, r->>'tipo', nullif(r->>'contrato_id','')::bigint,
            coalesce((select array_agg(x::int) from jsonb_array_elements_text(r->'parcelas') x), '{}'),
            nullif(r->>'referencia',''), nullif(r->>'descricao',''), nullif(r->>'comprador',''),
            nullif(r->>'vencimento','')::date, nullif(r->>'data_credito','')::date,
            coalesce((r->>'honorario')::numeric,0), (r->>'valor')::numeric);
  end loop;
  return v_id;
end $$;

-- exclusão de relatório: bloqueada em mês fechado
create or replace function public.rcb_remover_repasse(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Apenas administradores podem remover relatórios.'; end if;
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Informe o motivo da remoção.'; end if;
  if not exists (select 1 from rcb_repasses where id = p_id) then raise exception 'Relatório % não encontrado.', p_id; end if;
  if public.rcb_mes_fechado((select mes from rcb_repasses where id = p_id)) then raise exception 'O mês deste relatório está fechado. Reabra o mês para excluir.'; end if;
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
