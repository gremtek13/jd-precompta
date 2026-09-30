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

// ── DÉBUT CLÉS SUPABASE ─────────────────────────────────────────────────────────────────────────
// Les clés d'API de Supabase, lues dans les variables que la plateforme pose elle-même. Les clés
// historiques (`anon`, `service_role`) étaient des jetons signés du projet, et Supabase les coupe à la
// fin de 2026 ; les nouvelles arrivent dans deux objets JSON « nom → clé », `SUPABASE_PUBLISHABLE_KEYS`
// et `SUPABASE_SECRET_KEYS`, et ce projet se sert de la clé nommée `default`. Une variable absente,
// illisible ou sans clé `default` de la bonne forme LÈVE : une clé vide ferait refuser chaque requête
// pour une raison que personne ne lirait. Le message ne cite jamais la clé.
// Bloc copié à l'identique dans chaque fonction qui parle à la base : `clesSupabase.test.ts` compare
// les copies et exécute celle-ci.
function cleSupabase(variable: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS", brut: string | undefined): string {
  const prefixe = variable === "SUPABASE_SECRET_KEYS" ? "sb_secret_" : "sb_publishable_"
  if (!brut) throw new Error(`${variable} est absente de l'environnement de la fonction.`)
  let cles: unknown
  try {
    cles = JSON.parse(brut)
  } catch {
    throw new Error(`${variable} n'est pas un objet JSON lisible.`)
  }
  const cle = cles !== null && typeof cles === "object" ? (cles as Record<string, unknown>).default : undefined
  if (typeof cle !== "string" || !cle.startsWith(prefixe) || cle.length === prefixe.length) {
    throw new Error(`${variable} ne porte pas de clé « default » de la forme ${prefixe}…`)
  }
  return cle
}
// ── FIN CLÉS SUPABASE ───────────────────────────────────────────────────────────────────────────

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
  const clePublique = cleSupabase("SUPABASE_PUBLISHABLE_KEYS", Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))
  const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))

  const supabaseAsCaller = createClient(supabaseUrl, clePublique, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }

  const admin = createClient(supabaseUrl, cleSecrete)

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

  // Un seul appel, avec le JWT de l'appelant : réutilise exactement la même fonction que les règles de
  // sécurité de la base (voir migration hiérarchie_comptables) — super-admin, chef de cabinet ou
  // comptable simple assigné à ce dossier précisément.
  const { data: aAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: dossierId })
  if (!aAcces) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  if (payload.action === "status") {
    // `configured: false` est une AFFIRMATION, et l'écran en tire « ce dossier n'est pas configuré »
    // — donc invite à ressaisir un `client_secret` par-dessus celui qui existe. Une lecture refusée
    // ne doit pas produire cette réponse-là.
    const { data, error } = await admin
      .from("superpdp_credentials")
      .select("client_id, updated_at")
      .eq("dossier_id", dossierId)
      .maybeSingle()
    if (error) {
      return json({ error: `Le statut Super PDP de ce dossier n'a pas pu être lu (${error.message}).` }, 503)
    }
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
