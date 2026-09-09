-- Bucket privado para as imagens do Assistente IA.
-- Rode isto no Supabase → SQL Editor. É seguro: só cria o bucket e as políticas, não apaga nada.

-- 1) cria o bucket privado (não público)
insert into storage.buckets (id, name, public)
values ('ia-docs', 'ia-docs', false)
on conflict (id) do nothing;

-- 2) permite que usuários logados enviem imagens para o bucket
create policy "ia-docs upload autenticado"
on storage.objects for insert to authenticated
with check (bucket_id = 'ia-docs');

-- 3) permite que usuários logados leiam as próprias imagens (prévia/thumbnail)
create policy "ia-docs leitura autenticado"
on storage.objects for select to authenticated
using (bucket_id = 'ia-docs');
