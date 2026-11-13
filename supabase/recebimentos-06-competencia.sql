-- =====================================================================
-- SM sistema · Recebimentos · atualização 06
--  - Competência do relatório = mês + quinzena escolhidos na importação
--    (a data impressa no arquivo fica guardada só para consulta)
--  - Alterar a competência de um relatório já enviado
-- Aditivo: só mexe em objetos rcb_*. Pode rodar de novo sem problema.
-- =====================================================================

alter table public.rcb_repasses add column if not exists quinzena smallint check (quinzena in (1,2));
alter table public.rcb_repasses add column if not exists data_relatorio date;

-- relatórios já enviados: quinzena pelo meio do período de crédito; data do título "Repasse dd/mm/aaaa"
update public.rcb_repasses
   set quinzena = case when extract(day from (periodo_inicio + (periodo_fim - periodo_inicio) / 2)) <= 15 then 1 else 2 end
 where quinzena is null and periodo_inicio is not null and periodo_fim is not null;
update public.rcb_repasses set quinzena = 1 where quinzena is null;
update public.rcb_repasses
   set data_relatorio = to_date(substring(titulo from 'Repasse\s+(\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY')
 where data_relatorio is null and titulo ~ 'Repasse\s+\d{2}/\d{2}/\d{4}';

create or replace function public.rcb_salvar_repasse(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; r jsonb; v_cred numeric := 0; v_tax numeric := 0; v_deb numeric := 0; v_contab bigint; v_q smallint;
begin
  if not public.is_admin() then raise exception 'Apenas administradores podem enviar relatórios.'; end if;
  if coalesce(p->>'mes','') !~ '^\d{4}-\d{2}$' then raise exception 'Informe o mês da competência.'; end if;
  v_q := nullif(p->>'quinzena','')::smallint;
  if v_q is null or v_q not in (1,2) then raise exception 'Informe a quinzena da competência (1ª ou 2ª).'; end if;
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
  insert into rcb_repasses (mes, quinzena, data_relatorio, titulo, periodo_inicio, periodo_fim, creditos, debitos, taxas, valor_final, arquivo_nome, storage_path, obs, contabilidade_id)
  values (p->>'mes', v_q, nullif(p->>'data_relatorio','')::date, p->>'titulo', nullif(p->>'periodo_inicio','')::date, nullif(p->>'periodo_fim','')::date,
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

create or replace function public.rcb_definir_competencia(p_id bigint, p_mes text, p_quinzena smallint) returns void
language plpgsql security definer set search_path = public as $$
declare v_mes text;
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  if coalesce(p_mes,'') !~ '^\d{4}-\d{2}$' then raise exception 'Mês inválido.'; end if;
  if p_quinzena not in (1,2) then raise exception 'Quinzena inválida.'; end if;
  select mes into v_mes from rcb_repasses where id = p_id and not removido;
  if v_mes is null then raise exception 'Relatório % não encontrado.', p_id; end if;
  if public.rcb_mes_fechado(v_mes) or public.rcb_mes_fechado(p_mes) then raise exception 'Mês fechado. Reabra o mês antes de mudar a competência.'; end if;
  update rcb_repasses set mes = p_mes, quinzena = p_quinzena where id = p_id;
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
