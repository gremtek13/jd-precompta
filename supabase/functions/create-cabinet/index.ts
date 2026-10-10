// Edge Function : création d'un nouveau cabinet ("compte master") depuis l'écran Comptes master.
//
// Réservée aux super-admins — jusqu'ici, créer un cabinet était un accès direct en base (voir le
// texte de SuperAdminPage avant cette fonction), pour ne jamais exposer une action aussi lourde à un
// simple formulaire mal protégé. Crée en un seul appel le cabinet ET son premier comptable en chef
// (un cabinet sans personne pour s'y connecter ne sert à rien) : deux écritures (cabinets puis
// cabinet_admins), avec la clé de service — RLS n'a aucune policy INSERT sur `cabinets`, ce qui
// bloquerait même un super-admin authentifié normalement.
//
// Sécurité (voir l'audit qui a aussi corrigé create-team-member/create-client-access) : jamais de
// réutilisation d'un compte Auth existant ici, contrairement à ces deux fonctions — un cabinet tout
// neuf ne peut par définition avoir aucune relation légitime avec un compte déjà inscrit ailleurs sur
// la plateforme, donc réutiliser un tel compte reviendrait toujours à écraser le mot de passe de
// quelqu'un d'autre. Si l'email existe déjà, la création échoue et demande une autre adresse.

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

// Retire le cabinet créé quand une étape suivante a échoué, et REND ce qu'il faut dire quand ce
// retrait n'a pas pu se faire : une chaîne vide si tout va bien, la phrase à ajouter à l'erreur
// sinon. Rendre la phrase plutôt que la journaliser seule est délibéré — les logs d'Edge Function ne
// sont lus que par quelqu'un qui sait déjà qu'il y a un problème, et ici personne ne le saurait.
async function retirerCabinet(admin: ReturnType<typeof createClient>, cabinetId: string): Promise<string> {
  const { error } = await admin.from("cabinets").delete().eq("id", cabinetId)
  if (!error) return ""
  console.error(`[create-cabinet] cabinet ${cabinetId} NON retiré après échec : ${error.message}`)
  return ` (Attention : le cabinet créé n'a pas pu être retiré — il reste vide en base, à supprimer depuis l'écran super-admin.)`
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

// ── DÉBUT COPIE refusDuService ───────────────────────────────────────────────────────────────────────────────────────
// CE QUE LE SERVICE D'AUTHENTIFICATION DIT QUAND IL REFUSE de créer un compte (`auth.admin.createUser` :
// create-client-access, create-team-member, create-cabinet) ou de poser un mot de passe (`auth.updateUser` : l'écran
// du nouveau mot de passe). Son original vit dans src/lib/recuperationMotDePasse.ts ; il est copié À L'IDENTIQUE dans
// les trois fonctions, qui sont auto-portées, et refusDuServiceCopie.test.ts compare les copies au caractère près et les
// exécute contre l'original.
//
// Lu sur le CODE de l'erreur, jamais sur son statut ni sur son message. Le service (supabase/auth, `adminUserCreate`
// et `errors.go`) rend 422 pour une adresse déjà inscrite (`email_exists`) COMME pour un mot de passe que la règle du
// projet refuse (`weak_password`) : la détection par le statut prenait le second pour le premier, et le cabinet lisait
// « Un compte existe déjà… » sur un mot de passe refusé (10/10/2026, défaut 23.5). Le message, lui, est en anglais et
// change d'une version du service à l'autre. auth-js (2.112.4, `lib/fetch.js`) recopie sur l'erreur le code de la
// réponse (`code`), et fait d'un refus du mot de passe une `AuthWeakPasswordError` qui porte ses raisons (`reasons`) —
// `refusDuServiceClient.test.ts` le joue sur le client installé.

/**
 * Les codes d'une adresse qui a déjà un compte : `email_exists`, celui d'`adminUserCreate`, et `user_already_exists`,
 * celui de l'inscription publique — auth-js nomme les deux, et ils disent la même chose.
 */
const CODES_DEJA_INSCRIT: readonly string[] = ['email_exists', 'user_already_exists']

/** Le code que porte une erreur du service (`AuthError.code`), lu sur la valeur et non sur sa classe. */
function codeDuRefus(erreur: unknown): string | null {
  if (erreur === null || typeof erreur !== 'object') return null
  const code = (erreur as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** Vrai si le service refuse la création parce que l'adresse a déjà un compte. */
export function adresseDejaInscrite(erreur: unknown): boolean {
  const code = codeDuRefus(erreur)
  return code !== null && CODES_DEJA_INSCRIT.includes(code)
}

/**
 * Ce qui manque au mot de passe, raison par raison, dans l'ordre où le service les juge (`checkPasswordStrength` :
 * `length`, `characters`, `pwned`). Une raison qu'il ajouterait demain ne se recopie pas : un texte venu du service ne
 * s'affiche pas tel quel, et la phrase de tête suffit à dire le refus.
 */
const CE_QUI_MANQUE: readonly (readonly [string, string])[] = [
  ['length', 'il est trop court'],
  ['characters', "il lui manque une sorte de caractères qu'elle exige (minuscule, majuscule, chiffre ou symbole, selon le réglage)"],
  ['pwned', 'il figure parmi les mots de passe divulgués lors de fuites de données'],
]

/**
 * Le refus d'un mot de passe par la règle du projet, dit en français — ou null si l'erreur n'en est pas un. La règle
 * se règle au tableau de bord de Supabase et le service seul l'applique : la phrase la dit « du projet », et dit ce
 * qui manque sans la recopier (elle a pu changer depuis que les écrans en ont écrit le reflet).
 */
export function refusDuMotDePasse(erreur: unknown): string | null {
  if (codeDuRefus(erreur) !== 'weak_password') return null
  const lues = (erreur as { reasons?: unknown }).reasons
  const raisons: unknown[] = Array.isArray(lues) ? lues : []
  const manques = CE_QUI_MANQUE.filter(([raison]) => raisons.includes(raison)).map(([, phrase]) => phrase)
  const tete = "Le service d'authentification refuse ce mot de passe : il ne suit pas la règle des mots de passe du projet, "
    + 'réglée au tableau de bord de Supabase'
  return manques.length === 0 ? `${tete}.` : `${tete} — ${manques.join(' ; ')}.`
}
// ── FIN COPIE refusDuService ─────────────────────────────────────────────────────────────────────────────────────────

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

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait alors un 500
  // en texte brut, sans en-tête CORS, que la page ne pouvait pas lire (le patron de create-client-access, 10/10/2026).
  // Tout le reste se refuse ici, avant tout cabinet et tout compte.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  const payload = corps as { nom?: unknown; email?: unknown; password?: unknown }
  // Même porte pour un champ reçu sous une autre forme qu'un texte (un nombre) : `.trim()` y levait. Absent ou nul,
  // le champ tombe sur le refus « requis » juste après.
  const nomLu = payload.nom
  const emailLu = payload.email
  const password = payload.password
  if (!texteOuAbsent(nomLu)) {
    return json({ error: "nom doit être un texte." }, 400)
  }
  if (!texteOuAbsent(emailLu)) {
    return json({ error: "email doit être un texte." }, 400)
  }
  if (!texteOuAbsent(password)) {
    return json({ error: "password doit être un texte." }, 400)
  }
  const nom = nomLu?.trim()
  const email = emailLu?.trim()
  if (!nom || !email || !password) {
    return json({ error: "nom, email et password sont requis." }, 400)
  }
  if (password.length < 10) {
    return json({ error: "Le mot de passe doit faire au moins 10 caractères." }, 400)
  }

  const { data: cabinet, error: cabinetError } = await admin
    .from("cabinets")
    .insert({ nom })
    .select("id")
    .single()
  if (cabinetError || !cabinet) {
    return json({ error: cabinetError?.message ?? "Création du cabinet échouée." }, 500)
  }

  // Voir l'en-tête : jamais de compte réutilisé ici, contrairement à create-team-member/
  // create-client-access — un cabinet neuf ne justifie jamais d'écraser le mot de passe d'un compte
  // déjà inscrit ailleurs.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (createError || !created?.user) {
    // Compensation best-effort : sans ça, chaque tentative avec un email déjà pris laisserait un
    // cabinet fantôme sans personne pour s'y connecter.
    // ET UNE COMPENSATION QUI ÉCHOUE EN SILENCE LAISSE EXACTEMENT LE FANTÔME QU'ELLE EXISTE POUR
    // ÉVITER. Le super-admin ne lit que l'erreur d'ORIGINE, donc il recommence avec une autre
    // adresse — et le cabinet vide reste, sans que personne l'ait jamais su.
    const fantome = await retirerCabinet(admin, cabinet.id)
    // « Déjà inscrit » se lit au CODE de l'erreur (le bloc refusDuService), jamais au statut : 422 est aussi celui d'un
    // mot de passe que la règle du projet refuse, que la fonction disait « Un compte existe déjà » (défaut 23.5).
    if (adresseDejaInscrite(createError)) {
      return json({
        error: "Un compte existe déjà avec cet e-mail — utilise une autre adresse pour le premier comptable en chef de ce cabinet." + fantome,
      }, 409)
    }
    // Un mot de passe que la règle du projet refuse se dit en français, en 400 ; tout autre refus garde son chemin.
    const refusMotDePasse = refusDuMotDePasse(createError)
    if (refusMotDePasse !== null) return json({ error: refusMotDePasse + fantome }, 400)
    return json({ error: (createError?.message ?? "Création du compte échouée.") + fantome }, 500)
  }

  const { error: insertError } = await admin
    .from("cabinet_admins")
    .insert({ user_id: created.user.id, cabinet_id: cabinet.id, role: "comptable_en_chef", email })
  if (insertError) {
    const fantome = await retirerCabinet(admin, cabinet.id)
    if (/duplicate|unique/i.test(insertError.message)) {
      return json({ error: "Cette personne appartient déjà à un cabinet (le sien ou un autre)." + fantome }, 409)
    }
    return json({ error: insertError.message + fantome }, 500)
  }

  return json({ ok: true, cabinetId: cabinet.id })
})
