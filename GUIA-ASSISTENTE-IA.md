# Guia — Ativar o Assistente IA (Ler Imagem)

O sistema (front-end) já está pronto. Falta você configurar **3 coisas no Supabase** e **1 chave da OpenAI**.
A chave da OpenAI **nunca** entra no GitHub/site — ela fica só nos "secrets" do Supabase.

---

## 1) Criar o bucket privado de imagens

No Supabase → **SQL Editor** → cole e rode o conteúdo de `supabase/storage-ia-docs.sql`.
Isso cria o bucket privado **ia-docs** e as permissões. (Seguro: não apaga nada.)

---

## 2) Publicar a Edge Function `ler-imagem`

A função está em `supabase/functions/ler-imagem/index.ts`.

**Opção A — pelo computador (CLI, recomendado):**
1. Instale o Supabase CLI: https://supabase.com/docs/guides/cli (uma vez só).
2. No terminal, dentro da pasta do projeto:
   ```
   supabase login
   supabase link --project-ref rtftkxbhmsfmkatlzlpe
   supabase functions deploy ler-imagem
   ```

**Opção B — pelo painel (sem instalar nada):**
1. Supabase → **Edge Functions** → **Create a new function** → nome: `ler-imagem`.
2. Cole todo o conteúdo do arquivo `index.ts` e clique em **Deploy**.

---

## 3) Cadastrar a chave da OpenAI (secret)

1. Crie a chave em https://platform.openai.com/api-keys (começa com `sk-...`).
2. Supabase → **Edge Functions** → **Manage secrets** (ou **Settings → Edge Functions → Secrets**) e adicione:
   - `OPENAI_API_KEY` = sua chave `sk-...`
3. As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente nas functions — não precisa criar.

> Depois de salvar o secret, publique a função de novo se ela já estava publicada (`supabase functions deploy ler-imagem` ou botão **Deploy**), para ela enxergar a chave.

---

## 4) Testar

1. Publique o site (GitHub → Netlify) com a nova versão do sistema.
2. Abra **🤖 Assistente IA → 📷 Ler Imagem**, tire uma foto de um documento e aguarde.
3. Se aparecer erro de "função não respondeu", confira os passos 2 e 3 (function publicada + secret salvo).

---

## Custos e observações honestas

- A leitura usa o modelo **gpt-4o-mini** (visão), que é barato (centavos por imagem), mas **tem custo** por uso na OpenAI. Você controla isso na sua conta da OpenAI (pode definir limite de gasto).
- A IA **erra às vezes** — por isso o sistema **nunca cadastra sozinho**. Todo documento vira uma **pré-ficha** para você revisar e aprovar.
- Formatos aceitos hoje: **JPG, JPEG, PNG, WEBP**. PDF pode ser adicionado depois.
- Se quiser trocar o modelo (ex.: `gpt-4o` para mais precisão), altere a linha `model: "gpt-4o-mini"` no `index.ts`.

## Segurança / preservação
- Nada nos seus dados atuais é alterado. As pré-fichas ficam numa lista separada (`prefichas`) e só viram cadastro quando você clica em **Aprovar Cadastro**.
- O bucket é **privado**; as imagens não ficam públicas na internet.
