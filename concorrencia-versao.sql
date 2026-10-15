-- =====================================================================
-- SM AGROPECUÁRIA — Proteção contra sobrescrita entre aparelhos
-- (controle de concorrência otimista)
-- Onde rodar: Supabase → SQL Editor → New query → cole → RUN.
--
-- É SEGURO e ADITIVO: só acrescenta uma coluna "rev" (número de versão)
-- na tabela de dados. Não apaga, não altera nem move nenhum dado.
-- Reversível: para desfazer, bastaria remover a coluna.
--
-- Como funciona: a cada gravação o app aumenta esse número. Antes de
-- salvar, ele confere se a versão na nuvem ainda é a que carregou. Se
-- outro aparelho já gravou, a versão não bate e o app avisa em vez de
-- sobrescrever.
-- =====================================================================

alter table public.app_data
  add column if not exists rev bigint not null default 0;

-- CONFERÊNCIA (opcional):
--   select user_id, rev, updated_at from public.app_data;
