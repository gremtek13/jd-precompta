// Edge Function : création d'un compte comptable / comptable en chef pour l'équipe d'un cabinet.
//
// Réservé aux chefs de cabinet (rôle comptable_en_chef) et au(x) super-admin(s) — jamais un simple
// comptable, qui ne doit pas pouvoir s'ajouter des collègues ou se promouvoir lui-même. Seule cette
// création de compte (identifiants de connexion) passe par la clé de service ; le reste de la gestion
// d'équipe (retrait, changement de rôle, assignation de dossiers) se fait directement depuis le
// navigateur via les règles de sécurité (RLS), voir la migration gestion_equipe_cabinet.
//
// Même schéma que create-client-access : réutilise un compte Auth existant si l'email est déjà
// inscrit (ex. quelqu'un qui a d'abord été client avant de rejoindre l'équipe) plutôt que d'échouer —
// et, comme elle depuis le 10/10/2026 (décision du cabinet : « le propriétaire du compte peut changer son
// mot de passe »), le reprend TEL QU'IL EST : rien n'écrit sur un compte existant, ni avant un refus ni
// avant un rattachement. Le mot de passe saisi ne sert qu'à un compte neuf ; la réponse dit lequel des
// deux cas s'est produit (`compte: "cree"` ou `"existant"`), et l'écran de l'équipe dit au chef de ne
// pas communiquer un mot de passe qui n'a pas servi. Voir l'en-tête de create-client-access.
//
// UN COMPTE CLIENT D'UN AUTRE CABINET N'ENTRE PAS DANS L'ÉQUIPE D'ICI (23Q2-Q2, sur la recommandation : « le refuser »).
// L'application range du côté du cabinet tout compte qui a une ligne dans `cabinet_admins` (AuthContext, avant même de
// lire ses accès) : entré dans l'équipe, un compte qui porte un accès client dans un dossier d'un AUTRE cabinet y
// perdrait son espace client — chez cet autre cabinet aussi. Depuis 23-Q2, un tel compte peut être connu d'ici
// (create-client-access le rattache sur la confirmation du cabinet) ; il est refusé en 409, avant toute écriture, sous
// une phrase qui ne dit ni quel cabinet ni qu'il y est client (voir accesClientDansUnAutreCabinet).
//
// LE CLIENT D'UN DOSSIER DE CE CABINET N'ENTRE DANS L'ÉQUIPE QU'APRÈS UNE CONFIRMATION (23Q2Q2-Q1, décision du cabinet du
// 26/10/2026, à la recommandation : « le confirmer, en nommant l'adresse, le rôle et ce qu'il perd »). Entré dans
// l'équipe, il perd son espace client (AuthContext, plus haut), et une adresse mal tapée suffisait : choisi « comptable en
// chef », il voit tous les dossiers du cabinet. Le patron de 23-Q2, dans create-client-access : le PREMIER appel refuse en
// 409 — rien n'est écrit, ni sur le compte ni dans l'équipe — et son corps porte le marqueur `entreeAConfirmer: true`, que
// la page de l'équipe lit pour ouvrir sa confirmation ; le SECOND porte `entreeConfirmee: true` — le booléen `true`, et lui
// seul ; toute autre forme se refuse en 400, avant tout compte cherché — et le compte entre dans l'équipe TEL QU'IL EST. La
// confirmation ne passe outre aucun contrôle : la session, le rôle de l'appelant, le corps, le mot de passe, le service
// d'authentification, le refus d'un compte inconnu et celui du client d'un autre cabinet viennent avant elle. Elle ne vaut
// que pour un compte sans ligne d'équipe (voir ligneDEquipe) : un membre d'une équipe n'a pas d'espace client à perdre, et
// la clé primaire le refuse comme avant.
//
// NE PAS SAVOIR N'EST PAS UN « NON » (le « À REVOIR » de 23-Q2) : une lecture qui décide qu'un compte est connu, client
// d'un autre cabinet, ou membre d'une équipe, lit son erreur ; en panne, la fonction refuse en 500, avant tout autre geste,
// et rien n'est écrit.

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

/** Un champ du corps qui se lit comme une confirmation : un booléen, ou rien (absent, nul — qui ne confirment pas). */
function booleenOuAbsent(valeur: unknown): valeur is boolean | null | undefined {
  return valeur == null || typeof valeur === "boolean"
}

// Une vérification d'un compte existant en panne, avant son entrée dans l'équipe : une seule phrase pour les deux lectures
// qui la font (l'accès client ailleurs, la ligne d'équipe).
const VERIFICATION_EN_PANNE =
  "Ce compte n'a pas pu être vérifié avant son entrée dans l'équipe : personne n'a été ajouté, et rien n'a été changé. Réessaie dans un instant."

// Correctif audit sécurité (compte utilisateurs, Haute) — voir create-client-access, même fonction
// dupliquée ici (fichiers auto-porteurs, voir en-tête) : un compte Auth existant ne rejoint l'équipe
// d'ici QUE s'il a déjà une relation avec CE cabinet. Son mot de passe n'est plus jamais touché, mais le
// contrôle garde sa raison : repris, ce compte entrerait dans le cabinet avec SON mot de passe, et son
// titulaire n'est peut-être pas la personne que le chef croit ajouter. Vrai, faux, ou null si l'une des
// trois lectures a échoué : l'appelant refuse alors en 500 (voir l'en-tête), au lieu de dire inconnu
// d'ici un compte qu'il ne sait pas lire.
async function appartientDejaAuCabinet(
  admin: ReturnType<typeof createClient>,
  userId: string,
  cabinetId: string,
): Promise<boolean | null> {
  const { data: dossiers, error: erreurDossiers } = await admin.from("dossiers").select("id").eq("cabinet_id", cabinetId)
  if (erreurDossiers) return null
  const dossierIds = ((dossiers ?? []) as { id: string }[]).map((d) => d.id)
  if (dossierIds.length > 0) {
    const { data: membership, error: erreurAcces } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", userId)
      .in("dossier_id", dossierIds)
      .limit(1)
    if (erreurAcces) return null
    if (membership && membership.length > 0) return true
  }
  const { data: adminRow, error: erreurEquipe } = await admin
    .from("cabinet_admins")
    .select("user_id")
    .eq("user_id", userId)
    .eq("cabinet_id", cabinetId)
    .maybeSingle()
  if (erreurEquipe) return null
  return !!adminRow
}

// UN ACCÈS CLIENT DANS UN DOSSIER D'UN AUTRE CABINET (23Q2-Q2, voir l'en-tête) : une ligne de `memberships` (dont le rôle
// est toujours « client ») sur un dossier dont le cabinet n'est pas `cabinetId` — le cabinet VISÉ, celui que désigne un
// super-administrateur, jamais celui de l'appelant. Une seule lecture : le cabinet du dossier se lit par la jointure
// (`dossiers!inner`, filtrée par `dossiers.cabinet_id` : la forme que documente Supabase, « Querying referenced table
// with inner join », supabase.com/docs/reference/javascript/select), et `limit(1)` ne tronque rien, la question étant
// « en existe-t-il un ? ». `dossiers.cabinet_id` est NOT NULL : `neq` n'écarte aucun dossier faute de cabinet. Vrai ou
// faux, null si la lecture a échoué — l'appelant refuse alors en 500 : ne pas savoir n'ajoute personne.
async function accesClientDansUnAutreCabinet(
  admin: ReturnType<typeof createClient>,
  userId: string,
  cabinetId: string,
): Promise<boolean | null> {
  const { data: acces, error: erreurAilleurs } = await admin
    .from("memberships")
    .select("id, dossiers!inner(cabinet_id)")
    .eq("user_id", userId)
    .neq("dossiers.cabinet_id", cabinetId)
    .limit(1)
  if (erreurAilleurs || !acces) return null
  return acces.length > 0
}

// UNE LIGNE D'ÉQUIPE, DANS N'IMPORTE QUEL CABINET (23Q2Q2-Q1, voir l'en-tête) : c'est elle qui range un compte du côté du
// cabinet — AuthContext la lit avant ses accès, et l'espace client ne s'ouvre jamais pour lui. Sans elle, un compte connu
// d'ici (`appartientDejaAuCabinet`) ne l'est que par un accès client d'un dossier de ce cabinet — ses accès ailleurs venant
// d'être refusés (`accesClientDansUnAutreCabinet`) — : il se sert de son espace client, et le perdrait. La clé primaire
// de `cabinet_admins` est le compte : une ligne au plus. Vrai ou faux, null si la lecture a échoué — l'appelant refuse alors
// en 500 : ne pas savoir n'ajoute personne, ni ne demande une confirmation qui dirait faux.
async function ligneDEquipe(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean | null> {
  const { data: ligne, error: erreurLigne } = await admin
    .from("cabinet_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (erreurLigne) return null
  return !!ligne
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

  const { data: adminRow } = await admin
    .from("cabinet_admins")
    .select("cabinet_id, role")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  const { data: superAdminRow } = await admin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()

  // Chef de son propre cabinet, ou super-admin (qui peut alors préciser cabinetId dans le corps pour
  // agir sur un autre cabinet que le sien — usage rare, l'onboarding d'un nouveau cabinet restant un
  // accès direct en base).
  const estChef = adminRow?.role === "comptable_en_chef"
  if (!superAdminRow && !estChef) {
    return json({ error: "Réservé aux chefs de cabinet." }, 403)
  }

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait
  // alors un 500 en texte brut, sans en-tête CORS, que la page ne pouvait même pas lire (le patron
  // d'agent-comptable, 09/10/2026). Le navigateur envoie toujours un objet ; tout le reste se refuse ici,
  // avant tout compte.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  const payload = corps as { email?: unknown; password?: unknown; role?: unknown; cabinetId?: unknown; entreeConfirmee?: unknown }
  // Même porte pour un champ reçu sous une autre forme qu'un texte (un nombre) : `.trim()` y levait — sur
  // l'adresse, et sur le cabinet que désigne un super-admin —, et un mot de passe en nombre passait le
  // contrôle de longueur. `role` n'en a pas besoin : seuls deux textes passent la comparaison plus bas,
  // toute autre forme y est refusée en 400. Absent ou nul, un champ tombe sur le refus « requis ».
  const emailLu = payload.email
  const password = payload.password
  const role = payload.role
  const cabinetIdLu = payload.cabinetId
  const confirmationLue = payload.entreeConfirmee
  if (!texteOuAbsent(emailLu)) {
    return json({ error: "email doit être un texte." }, 400)
  }
  if (!texteOuAbsent(password)) {
    return json({ error: "password doit être un texte." }, 400)
  }
  if (!texteOuAbsent(cabinetIdLu)) {
    return json({ error: "cabinetId doit être un texte." }, 400)
  }
  // La confirmation de l'entrée dans l'équipe d'un client de ce cabinet (23Q2Q2-Q1, voir l'en-tête) : SEUL le booléen
  // `true` confirme. Toute autre forme — le texte « true », un nombre, un objet — se refuse ici, avec les champs texte,
  // avant tout compte cherché ; absente, nulle ou `false`, elle ne confirme pas.
  if (!booleenOuAbsent(confirmationLue)) {
    return json({ error: "entreeConfirmee doit être un booléen (true pour confirmer l'entrée dans l'équipe)." }, 400)
  }
  const entreeConfirmee = confirmationLue === true

  const email = emailLu?.trim()
  const cabinetId = (superAdminRow && cabinetIdLu?.trim()) || adminRow?.cabinet_id
  if (!email || !password || !role || !cabinetId) {
    return json({ error: "email, password et role sont requis." }, 400)
  }
  if (role !== "comptable_en_chef" && role !== "comptable") {
    return json({ error: "role invalide (attendu : comptable_en_chef ou comptable)." }, 400)
  }
  if (password.length < 10) {
    return json({ error: "Le mot de passe doit faire au moins 10 caractères." }, 400)
  }
  // Le maximum de bcrypt se compte en OCTETS (UTF-8), pas en caractères : le service refuse au-delà, en anglais, et la
  // fonction le rendait en 500 (défaut 23.5, 23-Q5). Refusé ici, avant tout appel au service d'authentification.
  if (new TextEncoder().encode(password).length > 72) {
    return json({ error: "Le mot de passe ne doit pas dépasser 72 octets (une lettre accentuée ou un symbole comme « € » compte pour plusieurs octets)." }, 400)
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })

  let userId: string
  // Ce que la réponse dit à l'écran : le mot de passe saisi est-il celui du compte ?
  let compte: "cree" | "existant"
  if (created?.user) {
    userId = created.user.id
    compte = "cree"
  } else if (adresseDejaInscrite(createError)) {
    // « Déjà inscrit » se lit au CODE de l'erreur (le bloc refusDuService), jamais au statut : 422 est aussi celui d'un
    // mot de passe que la règle du projet refuse (10/10/2026, défaut 23.5).
    const emailNormalise = email.toLowerCase()
    let trouve: string | null = null
    for (let page = 1; page <= 25 && !trouve; page++) {
      const { data: liste, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (listError || !liste || liste.users.length === 0) break
      trouve = liste.users.find((u) => (u.email ?? "").toLowerCase() === emailNormalise)?.id ?? null
      if (liste.users.length < 200) break
    }
    if (!trouve) {
      return json({ error: "Un compte existe déjà pour cet e-mail mais n'a pas pu être retrouvé." }, 500)
    }
    userId = trouve
    // Voir appartientDejaAuCabinet ci-dessus : un compte qui n'a aucun lien préexistant avec ce cabinet
    // ne rejoint pas l'équipe d'ici. Le refus dit ce qu'il disait avant, et pas davantage : ni où vit ce
    // compte, ni ce qu'il est — et rien n'y a été écrit. Une lecture en panne n'en fait pas un compte
    // inconnu : 500, avant tout autre geste.
    const connu = await appartientDejaAuCabinet(admin, userId, cabinetId)
    if (connu === null) {
      return json({ error: "Le lien de ce compte avec ce cabinet n'a pas pu être vérifié : personne n'a été ajouté à l'équipe, et rien n'a été changé. Réessaie dans un instant." }, 500)
    }
    if (!connu) {
      return json({
        error: "Un compte existe déjà avec cet e-mail, mais il n'est rattaché à aucun dossier ou membre de ce cabinet : il ne rejoint pas l'équipe depuis ici, et rien n'y a été changé. Demande à cette personne d'utiliser une autre adresse e-mail.",
      }, 409)
    }
    // Connu d'ici, il n'entre pas dans l'équipe s'il est client d'un dossier d'un AUTRE cabinet (23Q2-Q2, voir l'en-tête) :
    // jugé après le refus d'un compte inconnu, qui reste la même phrase pour tous, et avant toute écriture. La phrase ne
    // dit ni quel cabinet, ni que ce compte y est client : un cabinet qui rattacherait une adresse sur confirmation pour
    // l'essayer ici ne lirait pas, dans la réponse, la relation d'un tiers avec un autre cabinet. Le refus lui-même reste
    // un signal pour qui lit ce code, public : le prix que dit HISTORIQUE.md, et que le cabinet arbitre (23Q2Q2-Q2).
    const clientAilleurs = await accesClientDansUnAutreCabinet(admin, userId, cabinetId)
    if (clientAilleurs === null) {
      return json({ error: VERIFICATION_EN_PANNE }, 500)
    }
    if (clientAilleurs) {
      return json({
        error: "Ce compte ne peut pas entrer dans l'équipe de ce cabinet, et rien n'y a été changé. Demande à cette personne d'utiliser une autre adresse e-mail.",
      }, 409)
    }
    // Le client d'un dossier de CE cabinet n'entre dans l'équipe qu'après une confirmation (23Q2Q2-Q1, voir l'en-tête) :
    // jugé après les deux refus d'hier, et avant toute écriture. Sans ligne d'équipe, ce compte connu d'ici l'est par un
    // accès client d'un dossier de ce cabinet (voir ligneDEquipe) : sans confirmation, 409 et le seul marqueur, rien
    // d'écrit ; confirmé, il entre comme tout compte repris. Un membre d'une équipe passe outre, sans marqueur : la clé
    // primaire le refuse plus bas, comme avant. La phrase ne dit rien que le chef ne lise déjà dans l'onglet Accès de ses
    // dossiers : ni lequel.
    const membre = await ligneDEquipe(admin, userId)
    if (membre === null) {
      return json({ error: VERIFICATION_EN_PANNE }, 500)
    }
    if (!membre && !entreeConfirmee) {
      return json({
        error: "Cette adresse est celle d'un client d'un dossier de ce cabinet : il n'entre dans l'équipe qu'après ta confirmation, et rien n'a été changé.",
        entreeAConfirmer: true,
      }, 409)
    }
    // Repris TEL QU'IL EST, mot de passe compris (voir l'en-tête) : aucune écriture sur le compte, ni
    // ici ni plus bas. Jusqu'au 10/10/2026 le mot de passe saisi s'y posait à cet endroit, avant
    // l'écriture dans cabinet_admins — et un refus de cette écriture (la personne déjà dans un cabinet)
    // le laissait changé.
    compte = "existant"
  } else {
    // Un mot de passe que la règle du projet refuse se dit en français, en 400, sans chercher aucun compte ; tout autre
    // refus du service garde son chemin : 500, et son message.
    const refusMotDePasse = refusDuMotDePasse(createError)
    if (refusMotDePasse !== null) return json({ error: refusMotDePasse }, 400)
    return json({ error: createError?.message ?? "Création du compte échouée." }, 500)
  }

  const { error: insertError } = await admin
    .from("cabinet_admins")
    .insert({ user_id: userId, cabinet_id: cabinetId, role, email })
  if (insertError) {
    if (/duplicate|unique/i.test(insertError.message)) {
      return json({ error: "Cette personne appartient déjà à un cabinet (le sien ou un autre) : rien n'a changé, son mot de passe non plus." }, 409)
    }
    return json({ error: insertError.message }, 500)
  }

  return json({ ok: true, compte })
})
