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
//
// LE LOGO DU CABINET (ligne 22.61, 04/11/2026). Le seau `cabinet-logos` est PUBLIC : un logo que rien ne retire reste
// lisible par son adresse après la disparition du cabinet. Ses chemins ont la forme `<cabinetId>/logo-<instant>.<ext>`
// (CabinetBrandingPage). L'ordre est imposé : LA LIGNE D'ABORD, LES FICHIERS ENSUITE — une suppression refusée (23503 ou
// autre) ne touche à aucun fichier, sinon un cabinet resté en place perdrait son logo. Une fois la ligne partie, le
// retrait est un meilleur effort : la réponse reste 200 et dit ce qui a été retiré et ce qui ne l'a pas été. L'identifiant
// est un UUID vérifié avant toute lecture ; le `list()` vise le seul préfixe `<cabinetId>/`, jamais la racine, et se
// pagine ; chaque chemin retiré est rejugé sur ce préfixe. Le journal ne dit que des comptes.
//
// LE DOSSIER DU CABINET (ligne 47, LM1 et LM2 ; migration `dossier_du_cabinet`). Le cabinet qui facture ses honoraires dans
// l'application les tient dans un dossier qu'il a désigné, et que seul le super-administrateur supprime (LM1-Q1) : il fait
// partie des dossiers qui retiennent le cabinet. Le refus le NOMME, lu après le refus seulement (aucune lecture avant la
// suppression) ; une lecture en panne, ou une base d'avant la migration (la ligne se lit entière : la colonne n'y est pas),
// rendent le refus d'hier, sans rien de plus.

import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

/**
 * Ce que le refus ajoute quand le cabinet a désigné son dossier : une phrase qui le nomme, ou rien. Ne lève jamais.
 */
async function dossierDuCabinetANommer(admin: ReturnType<typeof createClient>, cabinetId: string): Promise<string> {
  try {
    const { data: cabinet, error: cabinetError } = await admin.from("cabinets").select("*").eq("id", cabinetId).maybeSingle()
    if (cabinetError || !cabinet) return ""
    const designe = (cabinet as { dossier_du_cabinet?: unknown }).dossier_du_cabinet
    if (typeof designe !== "string") return ""
    const { data: dossier, error: dossierError } = await admin.from("dossiers").select("nom").eq("id", designe).maybeSingle()
    const nom = !dossierError && dossier ? (dossier as { nom?: unknown }).nom : null
    const nomme = typeof nom === "string" && nom.trim() !== "" ? `« ${nom.trim()} »` : "désigné"
    return ` Parmi eux, le dossier du cabinet ${nomme} porte les factures du cabinet : seul le super-administrateur le supprime, depuis l'onglet Informations du dossier.`
  } catch {
    return ""
  }
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

const SEAU_DES_LOGOS = "cabinet-logos"
/** Le format d'un UUID, tel que Postgres le rend : le seul identifiant qui puisse ouvrir un préfixe du seau. */
const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Une page de `list()`, et un lot de `remove()`. */
const TAILLE_DE_PAGE = 100
/** Un plafond de pages : un logo actif à la fois, cent pages ne se voient jamais — au-delà, la liste est dite incomplète. */
const PAGES_AU_PLUS = 100

interface BilanDesLogos {
  /** `lue` : la liste du préfixe est revenue en entier ; `illisible` : une page a échoué ; `incomplete` : le plafond. */
  liste: "lue" | "illisible" | "incomplete"
  retires: number
  echecs: number
}

/**
 * Retire les fichiers du préfixe `<cabinetId>/` du seau public, en meilleur effort : rien ne lève, le bilan dit tout.
 * La liste se lit EN ENTIER avant tout retrait (retirer pendant la pagination déplacerait les pages suivantes).
 */
async function retirerLesLogos(admin: ReturnType<typeof createClient>, cabinetId: string): Promise<BilanDesLogos> {
  const prefixe = `${cabinetId}/`
  const chemins: string[] = []
  let echecs = 0
  let liste: BilanDesLogos["liste"] = "incomplete"
  for (let page = 0; page < PAGES_AU_PLUS; page++) {
    const { data, error } = await admin.storage.from(SEAU_DES_LOGOS).list(cabinetId, {
      limit: TAILLE_DE_PAGE,
      offset: page * TAILLE_DE_PAGE,
      sortBy: { column: "name", order: "asc" },
    })
    if (error || !Array.isArray(data)) {
      liste = "illisible"
      break
    }
    for (const entree of data as { name?: unknown; id?: unknown }[]) {
      const nom = typeof entree?.name === "string" ? entree.name : ""
      const chemin = `${prefixe}${nom}`
      // Un sous-dossier (`id` nul) ou un nom qui sortirait du préfixe ne se retire pas : il se compte en échec.
      if (entree?.id == null || nom === "" || nom.includes("/") || nom.includes("..") || !chemin.startsWith(prefixe)) {
        echecs += 1
        continue
      }
      chemins.push(chemin)
    }
    if (data.length < TAILLE_DE_PAGE) {
      liste = "lue"
      break
    }
  }

  let retires = 0
  for (let debut = 0; debut < chemins.length; debut += TAILLE_DE_PAGE) {
    const lot = chemins.slice(debut, debut + TAILLE_DE_PAGE).filter((c) => c.startsWith(prefixe))
    const { data, error } = await admin.storage.from(SEAU_DES_LOGOS).remove(lot)
    const rendus = !error && Array.isArray(data) ? data.length : 0
    retires += Math.min(rendus, lot.length)
    echecs += lot.length - Math.min(rendus, lot.length)
  }
  if (echecs > 0 || liste !== "lue") {
    console.warn(`delete-cabinet : logos retirés ${retires}, non retirés ${echecs}, liste ${liste}`)
  }
  return { liste, retires, echecs }
}

// ── DÉBUT DEUX FACTEURS ──────────────────────────────────────────────────────────────────────────────────────────────
// La double authentification exigée d'un compte (C7, second temps ; migration `deux_facteurs_exiges`, PRÉPARÉE). Une
// fonction qui lit avec la clé secrète contourne la RLS et la pré-requête de PostgREST : elle refuse donc elle-même, en
// 403 et avant toute dépense, un jeton `aal1` d'un compte que le cabinet a exigé, et tout jeton émis avant le retrait du
// second facteur du compte (l'appareil perdu, `aal2` compris). La base le dit, lue au jeton de l'appelant
// (`deux_facteurs_satisfaits`, que la pré-requête laisse passer) ; une réponse illisible rend 503 (le côté fermé). Le
// drapeau reste baissé tant que la migration n'est pas en base : la fonction SQL n'existerait pas, et chaque appel
// tomberait en 503. Bloc identique dans chaque fonction qui agit pour un compte (edgeFunctionsDeuxFacteurs.test.ts).
const DEUX_FACTEURS_EXIGES_EN_BASE = false

interface AppelantDesDeuxFacteurs {
  rpc: (fonction: "deux_facteurs_satisfaits") => PromiseLike<{ data: unknown; error: unknown }>
}

async function refusDesDeuxFacteurs(appelant: AppelantDesDeuxFacteurs): Promise<Response | null> {
  if (!DEUX_FACTEURS_EXIGES_EN_BASE) return null
  let satisfaite: unknown = null
  try {
    const { data, error } = await appelant.rpc("deux_facteurs_satisfaits")
    satisfaite = error ? null : data
  } catch {
    satisfaite = null
  }
  if (satisfaite === true) return null
  if (satisfaite === false) {
    return json({
      error: "Cette session ne satisfait pas la double authentification de ce compte : donner le code de l'application d'authentification, ou se reconnecter si le second facteur a été retiré, avant de recommencer.",
    }, 403)
  }
  return json({ error: "La double authentification de ce compte n'a pas pu être vérifiée : recommencer dans un instant." }, 503)
}
// ── FIN DEUX FACTEURS ────────────────────────────────────────────────────────────────────────────────────────────────

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
  // La double authentification exigée (bloc DEUX FACTEURS) : refusée avant toute autre lecture.
  const refusDeuxFacteurs = await refusDesDeuxFacteurs(supabaseAsCaller)
  if (refusDeuxFacteurs) return refusDeuxFacteurs

  const admin = createClient(supabaseUrl, cleSecrete)

  const { data: superAdminRow } = await admin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  if (!superAdminRow) {
    return json({ error: "Réservé aux super-admins." }, 403)
  }

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait alors un 500
  // en texte brut, sans en-tête CORS, que la page ne pouvait pas lire (le patron de create-cabinet, 10/10/2026). Le
  // navigateur envoie toujours un objet ; tout le reste se refuse ici, avant toute suppression.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  // Même porte pour un champ reçu sous une autre forme qu'un texte (un nombre) : `.trim()` y levait. Absent ou nul,
  // le champ tombe sur le refus « requis » juste après.
  const cabinetIdLu = (corps as { cabinetId?: unknown }).cabinetId
  if (!texteOuAbsent(cabinetIdLu)) {
    return json({ error: "cabinetId doit être un texte." }, 400)
  }

  const cabinetId = cabinetIdLu?.trim()
  if (!cabinetId) {
    return json({ error: "cabinetId est requis." }, 400)
  }
  // Avant toute écriture et toute lecture du stockage : seul un UUID ouvre un préfixe du seau des logos.
  if (!FORME_UUID.test(cabinetId)) {
    return json({ error: "cabinetId doit être un identifiant de cabinet (UUID)." }, 400)
  }

  const { error: deleteError } = await admin.from("cabinets").delete().eq("id", cabinetId)
  if (deleteError) {
    // Code Postgres 23503 = violation de contrainte de clé étrangère (voir l'en-tête) : le cabinet a
    // encore au moins un dossier ou un membre d'équipe.
    if (deleteError.code === "23503") {
      const reste = "Ce cabinet a encore des dossiers et/ou des membres d'équipe — retire-les d'abord (voir la fiche du dossier pour le supprimer, ou Équipe pour retirer un membre)."
      return json({ error: `${reste}${await dossierDuCabinetANommer(admin, cabinetId)}` }, 409)
    }
    return json({ error: `La suppression du cabinet a échoué : ${deleteError.message}` }, 500)
  }

  // La ligne est partie : le logo suit, en meilleur effort, et le bilan se dit sans jamais devenir une erreur HTTP.
  const logos = await retirerLesLogos(admin, cabinetId)
  return json({ ok: true, logos })
})
