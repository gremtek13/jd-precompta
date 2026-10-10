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
// Qui peut quoi (`QUI_PEUT_QUOI`, espace client, étape P3) : le cabinet du dossier, et le client dont l'accès porte la
// case « Ventes » — c'est l'entreprise du client qui crée son application chez Super PDP. Les droits se lisent avec le
// jeton de l'appelant (bloc droitsDeLAppelant) avant toute lecture des identifiants.

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

/** Un champ du corps qui se lit comme un texte : un texte, ou rien (absent, nul — « requis » le refuse ensuite). */
function texteOuAbsent(valeur: unknown): valeur is string | null | undefined {
  return valeur == null || typeof valeur === "string"
}

// QUI PEUT QUOI (conception de l'espace client, §3.5) : le droit que chaque action exige — « ventes », le cabinet du
// dossier ou un accès client qui porte la case « Ventes » ; « cabinet », le cabinet seul. Un changement de décision est
// une ligne. HYPOTHÈSE EC-Q4 (« le client relie aussi sa plateforme », et Super PDP), recommandée au cabinet et PAS
// ENCORE TRANCHÉE : `save` et `remove` sont ouverts au client ; « le cabinet seul » les fait passer à « cabinet ».
const QUI_PEUT_QUOI: Readonly<Record<string, DroitExige>> = {
  status: "ventes",
  save: "ventes", // EC-Q4
  remove: "ventes", // EC-Q4
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

// ── DÉBUT COPIE droitsDeLAppelant ────────────────────────────────────────────────────────────────────────────────────
// Ce que l'appelant peut faire sur ce dossier (espace client, étape P3). Ses droits se lisent par
// `droits_sur_le_dossier` (migration `droits_des_acces_clients`, étape P1) avec SON jeton — sous la clé de service,
// `auth.uid()` serait nul —, avant toute lecture d'un secret et tout appel extérieur. Seul `true` accorde : une erreur,
// une exception, ou une réponse sans ses quatre cases booléennes rendent `illisible`, le côté fermé ; une case de plus
// (un domaine neuf, que la fonction SQL ajoute sans changer de signature) ne ferme rien. Le droit qu'une action exige
// est une DONNÉE de chaque fonction, sa table « qui peut quoi » : « cabinet » (`admin_du_dossier`), ou « ventes »
// (`gere_les_ventes` : le cabinet, ou un accès client qui porte la case « Ventes ») ; une action hors de la table n'est
// permise à personne. Copié à l'identique dans plateforme-agreee, superpdp-emit, superpdp-credentials et send-email :
// `droitsDeLAppelantCopie.test.ts` exécute chaque copie contre sa propre grille.
type DroitExige = "cabinet" | "ventes"
interface Droits { cabinet: boolean; membre: boolean; ventes: boolean; banque: boolean }

async function droitsDeLAppelant(
  appelant: { rpc: (nom: string, args: { p_dossier_id: string }) => PromiseLike<{ data: unknown; error: unknown }> },
  dossierId: string,
): Promise<{ droits: Droits } | { illisible: string }> {
  let lu: unknown
  try {
    const reponse = await appelant.rpc("droits_sur_le_dossier", { p_dossier_id: dossierId })
    if (reponse.error != null) {
      const message = (reponse.error as { message?: unknown }).message
      return { illisible: typeof message === "string" && message !== "" ? message : "erreur de la base" }
    }
    lu = reponse.data
  } catch {
    return { illisible: "la base n'a pas répondu" }
  }
  if (lu === null || typeof lu !== "object" || Array.isArray(lu)) return { illisible: "réponse d'une autre forme" }
  const cases = lu as Record<string, unknown>
  if (!["cabinet", "membre", "ventes", "banque"].every((c) => typeof cases[c] === "boolean")) {
    return { illisible: "réponse d'une autre forme" }
  }
  const { cabinet, membre, ventes, banque } = cases as unknown as Droits
  return { droits: { cabinet, membre, ventes, banque } }
}

/** L'appelant porte-t-il le droit que la table exige pour cette action ? */
function actionPermise(table: Readonly<Record<string, DroitExige>>, action: string, droits: Droits): boolean {
  const exige = Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null
  return exige === "cabinet" ? droits.cabinet : exige === "ventes" ? droits.ventes : false
}
// ── FIN COPIE droitsDeLAppelant ──────────────────────────────────────────────────────────────────────────────────────

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

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait alors un 500 en
  // texte brut, sans en-tête CORS, que la page ne pouvait pas lire ; un champ reçu en nombre faisait lever `.trim()`
  // (défauts connus des Edge Functions, corrigés ici comme dans create-cabinet). Absent ou nul, un champ tombe sur le
  // refus « requis » qui suit.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  const payload = corps as Record<string, unknown>
  for (const champ of ["dossierId", "action", "client_id", "client_secret"]) {
    if (!texteOuAbsent(payload[champ])) {
      return json({ error: `Corps de requête invalide : « ${champ} » doit être un texte.` }, 400)
    }
  }

  const dossierId = (payload.dossierId as string | null | undefined)?.trim()
  if (!dossierId) {
    return json({ error: "dossierId est requis." }, 400)
  }
  const action = (payload.action as string | null | undefined) ?? ""
  if (!Object.prototype.hasOwnProperty.call(QUI_PEUT_QUOI, action)) {
    return json({ error: "action inconnue (attendu : status, save ou remove)." }, 400)
  }

  // Les droits de l'appelant, avec SON jeton, avant toute lecture des identifiants. Sans le droit que l'action exige,
  // la réponse d'avant l'espace client, mot pour mot : elle ne dit pas si le dossier existe.
  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)
  if ("illisible" in lus) {
    return json({ error: `L'accès à ce dossier n'a pas pu être vérifié (${lus.illisible}).` }, 503)
  }
  if (!actionPermise(QUI_PEUT_QUOI, action, lus.droits)) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  if (action === "status") {
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

  if (action === "save") {
    const clientId = (payload.client_id as string | null | undefined)?.trim()
    const clientSecret = (payload.client_secret as string | null | undefined)?.trim()
    if (!clientId || !clientSecret) {
      return json({ error: "client_id et client_secret sont requis." }, 400)
    }
    const { error } = await admin
      .from("superpdp_credentials")
      .upsert({ dossier_id: dossierId, client_id: clientId, client_secret: clientSecret, updated_at: new Date().toISOString() })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  if (action === "remove") {
    const { error } = await admin.from("superpdp_credentials").delete().eq("dossier_id", dossierId)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  // Une action de la table sans branche ici ne fait rien : jamais un retrait par défaut.
  return json({ error: "action inconnue (attendu : status, save ou remove)." }, 400)
})
