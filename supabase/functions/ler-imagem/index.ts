// Edge Function: ler-imagem
// Recebe { path } de uma imagem no bucket privado "ia-docs", envia para a OpenAI (visão),
// e devolve um JSON estruturado com os dados do documento.
// A chave da OpenAI NUNCA fica no frontend — só aqui, como secret do Supabase.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `Você é um assistente que lê documentos do agronegócio (pecuária de elite Nelore):
notas de compra/venda de animais, participações/cotas, prenhezes, aspirações, contratos e catálogos de leilão.
Extraia os dados e responda SOMENTE com um JSON válido (sem texto fora do JSON), com estas chaves
(use null quando não encontrar — NUNCA invente):
{
  "tipo_documento": "compra | venda | compra_adicional | prenhez | aspiracao | contrato | catalogo | nao_identificado",
  "nome_animal": null,
  "registro": null,
  "pai": null,
  "mae": null,
  "registro_mae": null,
  "avo_paterno": null, "avo_paterna": null, "avo_materno": null, "avo_materna": null,
  "leilao": null,
  "data": null,
  "valor_negociado": null,
  "porcentagem": null,
  "parcelas": null,
  "valor_parcela": null,
  "comissao": null,
  "vendedor": null,
  "comprador": null,
  "onde_esta": null,
  "sociedade": null,
  "observacoes": null,
  "campos_baixa_confianca": [],
  "observacoes_ia": null,
  "confianca": 0.0
}
Regras: valores monetários apenas números (ex.: 15000.50). Datas em AAAA-MM-DD quando possível.
"campos_baixa_confianca": liste os nomes dos campos que você não teve certeza.
"confianca": número de 0 a 1 indicando a confiança geral da leitura.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { path } = await req.json();
    if (!path) return json({ error: "path é obrigatório" }, 400);

    // cliente admin (service role) para baixar a imagem do bucket privado
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: file, error: dlErr } = await supabase.storage.from("ia-docs").download(path);
    if (dlErr || !file) return json({ error: "Não consegui baixar a imagem: " + (dlErr?.message || "arquivo não encontrado") }, 400);

    // converte para base64 data URL
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const mime = file.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${b64}`;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY não configurada nos secrets da função." }, 500);

    // chama a OpenAI (modelo com visão)
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: [
            { type: "text", text: "Leia este documento e devolva o JSON pedido." },
            { type: "image_url", image_url: { url: dataUrl } },
          ]},
        ],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: "Erro na OpenAI: " + t }, 502);
    }
    const out = await resp.json();
    const txt = out?.choices?.[0]?.message?.content || "{}";
    let dados; try { dados = JSON.parse(txt); } catch { dados = { tipo_documento: "nao_identificado", observacoes_ia: "A IA não retornou JSON válido.", confianca: 0 }; }
    return json(dados, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
