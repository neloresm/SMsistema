# Área Recebimentos dentro do SM sistema

O que muda no SM sistema:
- `src/App.jsx`: só o item **◈ Recebimentos** no fim do menu. Ao clicar, abre `/recebimentos/`. Nada mais foi alterado.
- `public/recebimentos/` (pasta nova): a área Recebimentos, com navegação própria e o mesmo login.
- `supabase/recebimentos-01-estrutura.sql`: tabelas e funções novas, todas com prefixo `rcb_`. Não altera nem apaga nada que já existe.

## 1. Banco de dados (uma vez)
1. Supabase do SM sistema → **SQL Editor** → New query → cole `supabase/recebimentos-01-estrutura.sql` → **Run**.
2. Nova query → cole `C:\Users\fabse\Documents\sm-recebiveis\supabase\recebimentos-02-contratos-SCM.sql` → **Run**.
   Esse arquivo carrega os 37 contratos e **contém CPFs e telefones**: ele fica fora desta pasta de propósito e não deve ser enviado ao GitHub.

## 2. Publicar
Suba para o repositório do SM sistema, do mesmo jeito de sempre:
- `src/App.jsx` (o mesmo arquivo de `Downloads\App-COM-RECEBIMENTOS-SUBIR-ESTE.jsx`);
- a pasta inteira `public/recebimentos/` (7 arquivos: `index.html`, `styles.css`, `config.js` e `js/` com 4 arquivos).

O Netlify gera o site e a área fica em `https://<seu-endereço>/recebimentos/`.

## 3. Usar
1. Entre no SM sistema e clique em **Recebimentos** no menu.
2. **Repasses MECOB → Enviar relatório da MECOB**: envie os PDFs "Prestação de Contas" (um por quinzena).
3. Escolha o mês: aparecem **Deveria repassar**, **MECOB informou**, **Taxas descontadas** e a **Diferença**. Clique na diferença para ver os motivos, as linhas e cada parcela.
4. Quando tiver o extrato bancário, use **Conferir no extrato** em cada relatório.
5. Para atualizar pagamentos, cole o extrato de contratos da MECOB em **Novo contrato / importar**. Contratos que já existem são atualizados, sem duplicar.

## Permissões
Usa o mesmo cadastro do SM sistema: administrador aprovado pode enviar e editar; usuário aprovado só consulta; não aprovado não vê nada.
