// Edge Function : suppression d'un cabinet ("compte master") depuis l'écran Comptes master.
//
// Réservée aux super-admins. Volontairement minimaliste : ne supprime QUE la ligne `cabinets` elle-
// même, jamais en cascade ses dossiers ou son équipe — les contraintes de clé étrangère sur
// cabinet_admins.cabinet_id et dossiers.cabinet_id sont en ON DELETE NO ACTION (voir le schéma), donc
// Postgres refuse déjà tout seul de supprimer un cabinet qui a encore des dossiers ou des membres
// d'équipe. C'est le garde-fou recherché : un cabinet ne peut disparaître qu'une fois vidé dossier par
// dossier (voir suppressionDossier.ts, avec sa propre confirmation) et membre par membre (voir
// EquipePage "Retirer"), jamais d'un coup par accident. Cette fonction se contente de traduire
// l'erreur de contrainte (23503) en message compréhensible plutôt que de renvoyer le code SQL brut.

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

  const { data: superAdminRow } = await admin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  if (!superAdminRow) {
    return json({ error: "Réservé aux super-admins." }, 403)
  }

  let payload: { cabinetId?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }

  const cabinetId = payload.cabinetId?.trim()
  if (!cabinetId) {
    return json({ error: "cabinetId est requis." }, 400)
  }

  const { error: deleteError } = await admin.from("cabinets").delete().eq("id", cabinetId)
  if (deleteError) {
    // Code Postgres 23503 = violation de contrainte de clé étrangère (voir l'en-tête) : le cabinet a
    // encore au moins un dossier ou un membre d'équipe.
    if (deleteError.code === "23503") {
      return json({ error: "Ce cabinet a encore des dossiers et/ou des membres d'équipe — retire-les d'abord (voir la fiche du dossier pour le supprimer, ou Équipe pour retirer un membre)." }, 409)
    }
    return json({ error: deleteError.message }, 500)
  }

  return json({ ok: true })
})
