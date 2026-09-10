// Edge Function: excluir-usuario
// Exclui um usuário com SEGURANÇA:
//  - só um ADMIN aprovado pode chamar (validado no backend pelo token da sessão);
//  - a senha do admin é reautenticada no PRÓPRIO site antes de chamar aqui;
//  - NUNCA exclui a conta administradora principal, nem a própria conta;
//  - apaga: usuário do Auth + perfil + a linha de dados DELE (app_data por user_id);
//  - registra a ação no admin_log.
// A service_role fica SÓ aqui (secret do Supabase), nunca no navegador.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(URL, SERVICE);

    // 1) quem está chamando? Valida o token da sessão com a service_role.
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Não autenticado." }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);
    const adminUser = userData.user;

    // 2) o chamador é admin aprovado? (autorização real, no backend)
    const { data: perfilAdmin } = await admin.from("profiles").select("*").eq("id", adminUser.id).maybeSingle();
    if (!perfilAdmin || perfilAdmin.role !== "Administrador" || perfilAdmin.aprovado !== true) {
      return json({ error: "Apenas administradores podem excluir usuários." }, 403);
    }

    const { alvoId } = await req.json();
    if (!alvoId) return json({ error: "Dados incompletos." }, 400);

    // 3) proteções: não excluir a si mesmo nem a conta principal
    if (alvoId === adminUser.id) return json({ error: "Você não pode excluir a própria conta." }, 400);
    const { data: perfilAlvo } = await admin.from("profiles").select("*").eq("id", alvoId).maybeSingle();
    if (!perfilAlvo) return json({ error: "Usuário não encontrado." }, 404);
    if (perfilAlvo.principal === true) return json({ error: "A conta administradora principal não pode ser excluída." }, 403);

    // 4) apaga os DADOS exclusivos do usuário (a linha dele na app_data)
    await admin.from("app_data").delete().eq("user_id", alvoId);

    // 5) log ANTES de remover o perfil (guarda nome/email)
    await admin.from("admin_log").insert({
      acao: "excluir", alvo_id: alvoId, alvo_email: perfilAlvo.email, alvo_nome: perfilAlvo.nome,
      feito_por: adminUser.id, feito_por_email: adminUser.email,
      detalhe: "Usuário e dados próprios excluídos (admin reautenticado no app).",
    });

    // 6) remove o usuário do Auth (o perfil cai junto por ON DELETE CASCADE)
    const { error: delErr } = await admin.auth.admin.deleteUser(alvoId);
    if (delErr) return json({ error: "Falha ao excluir do Auth: " + delErr.message }, 500);

    return json({ ok: true, excluido: { id: alvoId, email: perfilAlvo.email, nome: perfilAlvo.nome } });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
