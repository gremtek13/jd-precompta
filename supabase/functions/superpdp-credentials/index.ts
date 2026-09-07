// Edge Function : configuration des identifiants Super PDP (facturation électronique) d'un dossier.
//
// Une application Super PDP (client_id/client_secret OAuth2) est rattachée à une seule entreprise —
// donc un dossier a ses propres identifiants, jamais partagés avec un autre. Cette fonction est le
// SEUL point d'entrée qui touche la table superpdp_credentials (verrouillée par RLS sans aucune
// policy, voir la migration) : le secret n'est jamais lu depuis le navigateur, seulement écrit
// (action "save") ou effacé (action "remove") ; la consultation de statut (action "status") ne
// renvoie jamais le secret, seulement s'il est configuré et le client_id (repère non sensible, utile
// pour vérifier qu'on a bien collé le bon).
//
// Réservé au cabinet (cabinet_admins), même vérification que create-client-access / agent-comptable.

import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return json({ error: "Non authentifié." }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  const supabaseAsCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // "cabinet_id" (pas juste l'appartenance à cabinet_admins) : depuis l'introduction du multi-cabinet,
  // être admin ne suffit pas — encore faut-il être admin DU cabinet propriétaire de ce dossier précis
  // (ou super-admin). Sans cette seconde vérification, l'admin d'un cabinet pourrait configurer les
  // identifiants Super PDP d'un dossier appartenant à un autre cabinet.
  const { data: adminRow } = await admin
    .from("cabinet_admins")
    .select("cabinet_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  const { data: superAdminRow } = await admin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  if (!adminRow && !superAdminRow) {
    return json({ error: "Réservé au cabinet." }, 403)
  }

  let payload: { dossierId?: string; action?: string; client_id?: string; client_secret?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }

  const dossierId = payload.dossierId?.trim()
  if (!dossierId) {
    return json({ error: "dossierId est requis." }, 400)
  }

  const { data: dossierRow } = await admin.from("dossiers").select("cabinet_id").eq("id", dossierId).maybeSingle()
  if (!dossierRow || (!superAdminRow && dossierRow.cabinet_id !== adminRow?.cabinet_id)) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  if (payload.action === "status") {
    const { data } = await admin
      .from("superpdp_credentials")
      .select("client_id, updated_at")
      .eq("dossier_id", dossierId)
      .maybeSingle()
    return json({ configured: !!data, client_id: data?.client_id ?? null, updated_at: data?.updated_at ?? null })
  }

  if (payload.action === "save") {
    const clientId = payload.client_id?.trim()
    const clientSecret = payload.client_secret?.trim()
    if (!clientId || !clientSecret) {
      return json({ error: "client_id et client_secret sont requis." }, 400)
    }
    const { error } = await admin
      .from("superpdp_credentials")
      .upsert({ dossier_id: dossierId, client_id: clientId, client_secret: clientSecret, updated_at: new Date().toISOString() })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  if (payload.action === "remove") {
    const { error } = await admin.from("superpdp_credentials").delete().eq("dossier_id", dossierId)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: "action inconnue (attendu : status, save ou remove)." }, 400)
})
