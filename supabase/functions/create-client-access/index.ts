// Edge Function : création d'un accès client sur un dossier — pour un compte neuf, ou pour un compte qui existe
// déjà et que ce cabinet connaît.
//
// Remplace l'ancien flux signUp() côté navigateur (AccesTab) : retirer un accès (bouton "Retirer")
// ne supprime que la ligne memberships, jamais le compte Auth sous-jacent — donc redonner accès avec
// la même adresse e-mail à un autre dossier faisait échouer supabase.auth.signUp() en "déjà inscrit".
// Ici, avec la clé de service : on crée le compte s'il n'existe pas encore, avec le mot de passe saisi ; sinon on
// reprend le compte existant TEL QU'IL EST, et on ajoute simplement la ligne memberships pour ce dossier.
//
// UN COMPTE QUI EXISTE GARDE SON MOT DE PASSE (décision du cabinet du 10/10/2026 : « le propriétaire du compte peut
// changer son mot de passe »). La fonction posait jusque-là le mot de passe saisi sur le compte repris, pour que « le
// mot de passe tapé soit toujours celui à donner au client » — et le posait AVANT d'écrire l'accès : un accès déjà
// donné sur ce dossier répondait 409 « existe déjà » sur un compte dont le mot de passe venait de changer, et l'ancien
// ne marchait plus, sans que le cabinet le sache. Désormais rien n'écrit sur un compte existant, ni avant un refus ni
// avant un rattachement. La réponse dit lequel des deux cas s'est produit — `compte: "cree"` (le mot de passe saisi
// est celui du compte) ou `compte: "existant"` (il n'a pas servi) —, et l'écran dit au cabinet de ne pas communiquer
// un mot de passe qui n'ouvre rien. Le titulaire change le sien lui-même : « Mot de passe oublié », ou le lien que le
// cabinet lui envoie depuis l'onglet Accès. La distinction n'est rendue que pour un compte que le cabinet connaît déjà
// (voir appartientDejaAuCabinet) : de tout autre compte, la fonction ne dit que ce qu'elle disait avant (le 409).
//
// Sécurité : vérifie que l'appelant est bien un administrateur du cabinet (via son propre JWT, celui
// que le navigateur envoie normalement) avant d'utiliser la clé de service — sans ce contrôle,
// n'importe quel utilisateur authentifié pourrait s'octroyer un accès à n'importe quel dossier.

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

// Un compte Auth existant ne reçoit un accès d'ici QUE s'il a déjà une relation avec CE cabinet — un
// client d'un de ses dossiers, ou un membre de son équipe. Le contrôle est né d'un audit de sécurité
// (compte utilisateurs, Haute) : la fonction posait alors le mot de passe saisi sur le compte repris, et
// n'importe quel email déjà inscrit ailleurs sur la plateforme (client d'un autre cabinet, comptable d'un
// autre cabinet...) voyait son mot de passe écrasé par le premier cabinet qui le tapait — prise de
// contrôle de compte. Le mot de passe d'un compte existant n'est plus jamais touché (voir l'en-tête),
// mais le contrôle garde sa raison : rattaché, ce compte verrait aussitôt le dossier avec SON mot de
// passe, et son titulaire n'est peut-être pas le client du cabinet (une adresse mal tapée, la personne
// d'un autre cabinet). Vrai uniquement si le cabinet appelant a déjà, en base, une raison légitime de
// connaître ce compte.
async function appartientDejaAuCabinet(
  admin: ReturnType<typeof createClient>,
  userId: string,
  cabinetId: string,
): Promise<boolean> {
  const { data: dossiers } = await admin.from("dossiers").select("id").eq("cabinet_id", cabinetId)
  const dossierIds = ((dossiers ?? []) as { id: string }[]).map((d) => d.id)
  if (dossierIds.length > 0) {
    const { data: membership } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", userId)
      .in("dossier_id", dossierIds)
      .limit(1)
    if (membership && membership.length > 0) return true
  }
  const { data: adminRow } = await admin
    .from("cabinet_admins")
    .select("user_id")
    .eq("user_id", userId)
    .eq("cabinet_id", cabinetId)
    .maybeSingle()
  return !!adminRow
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

  // Client "appelant" : sert uniquement à identifier qui fait la demande, avec son propre JWT —
  // jamais la clé de service pour cette vérification.
  const supabaseAsCaller = createClient(supabaseUrl, clePublique, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }

  const supabaseAdmin = createClient(supabaseUrl, cleSecrete)

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait
  // alors un 500 en texte brut, sans en-tête CORS, que la page ne pouvait même pas lire (le patron
  // d'agent-comptable, 09/10/2026). Le navigateur envoie toujours un objet ; tout le reste se refuse ici,
  // avant le contrôle du dossier et avant tout compte.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  const payload = corps as { dossierId?: unknown; email?: unknown; password?: unknown }
  // Même porte pour un champ reçu sous une autre forme qu'un texte (un nombre) : `.trim()` y levait, et
  // un mot de passe en nombre passait le contrôle de longueur (la longueur d'un nombre n'existe pas, et
  // la comparaison est fausse). Absent ou nul, le champ tombe sur le refus « requis » juste après.
  const dossierIdLu = payload.dossierId
  const emailLu = payload.email
  const password = payload.password
  if (!texteOuAbsent(dossierIdLu)) {
    return json({ error: "dossierId doit être un texte." }, 400)
  }
  if (!texteOuAbsent(emailLu)) {
    return json({ error: "email doit être un texte." }, 400)
  }
  if (!texteOuAbsent(password)) {
    return json({ error: "password doit être un texte." }, 400)
  }
  const dossierId = dossierIdLu?.trim()
  const email = emailLu?.trim()
  if (!dossierId || !email || !password) {
    return json({ error: "dossierId, email et password sont requis." }, 400)
  }

  // Un seul appel, avec le JWT de l'appelant : réutilise exactement la même fonction que les règles de
  // sécurité de la base (voir migration hiérarchie_comptables) — c'est LE contrôle qui empêche de donner
  // un accès client à un dossier hors de son cabinet (ou, pour un simple comptable, hors des dossiers
  // qui lui sont assignés) — sans ça, cette fonction (clé de service, contourne RLS) serait le seul
  // endroit de toute l'appli où cette règle ne serait pas garantie.
  const { data: aAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: dossierId })
  if (!aAcces) {
    return json({ error: "Dossier introuvable." }, 404)
  }
  // Cabinet propriétaire de ce dossier — sert au contrôle appartientDejaAuCabinet ci-dessous, pas à
  // l'autorisation elle-même (déjà tranchée par admin_du_dossier juste au-dessus).
  const { data: dossierRow, error: dossierError } = await supabaseAdmin
    .from("dossiers")
    .select("cabinet_id")
    .eq("id", dossierId)
    .single()
  if (dossierError || !dossierRow) {
    return json({ error: "Dossier introuvable." }, 404)
  }
  const cabinetId = dossierRow.cabinet_id as string
  // Le formulaire (AccesTab) a bien minLength={10}, mais un attribut HTML se contourne facilement —
  // seule cette vérification côté serveur est une vraie garantie, ici l'unique point d'entrée qui crée
  // un compte client avec un mot de passe choisi par le cabinet.
  if (password.length < 10) {
    return json({ error: "Le mot de passe doit faire au moins 10 caractères." }, 400)
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  })

  let clientUserId: string
  // Ce que la réponse dit à l'écran : le mot de passe saisi est-il celui du compte ?
  let compte: "cree" | "existant"
  if (created?.user) {
    clientUserId = created.user.id
    compte = "cree"
  } else if (adresseDejaInscrite(createError)) {
    // « Déjà inscrit » se lit au CODE de l'erreur (le bloc refusDuService), jamais au statut : 422 est aussi celui d'un
    // mot de passe que la règle du projet refuse, et le prendre pour un doublon faisait chercher un compte qui n'existe
    // pas, puis dire « Un compte existe déjà… » (10/10/2026, défaut 23.5).
    // Compte déjà existant (accès retiré précédemment sur un autre dossier, ou même client réinvité) —
    // on le retrouve par e-mail plutôt que d'échouer. listUsers() ne filtre pas par e-mail côté API,
    // on pagine donc et on compare nous-mêmes (suffisant pour un nombre de comptes clients raisonnable).
    const emailNormalise = email.toLowerCase()
    let trouve: string | null = null
    let dernierListError: string | null = null
    for (let page = 1; page <= 25 && !trouve; page++) {
      const { data: liste, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
      if (listError) { dernierListError = listError.message; break }
      if (!liste || liste.users.length === 0) break
      trouve = liste.users.find((u) => (u.email ?? "").toLowerCase() === emailNormalise)?.id ?? null
      if (liste.users.length < 200) break // dernière page atteinte
    }
    if (!trouve) {
      return json({
        error: dernierListError
          ? `Compte existant introuvable (recherche échouée : ${dernierListError}).`
          : "Un compte existe déjà pour cet e-mail mais n'a pas pu être retrouvé parmi les comptes existants.",
      }, 500)
    }
    clientUserId = trouve
    // Voir appartientDejaAuCabinet ci-dessus : un compte qui n'a aucun lien préexistant avec ce cabinet
    // ne reçoit pas d'accès d'ici. Le refus dit ce qu'il disait avant, et pas davantage : ni où vit ce
    // compte, ni ce qu'il est — et rien n'y a été écrit.
    if (!(await appartientDejaAuCabinet(supabaseAdmin, clientUserId, cabinetId))) {
      return json({
        error: "Un compte existe déjà avec cet e-mail, mais il n'est rattaché à aucun dossier ou membre de ce cabinet : il ne reçoit pas d'accès depuis ici, et rien n'y a été changé. Demande à cette personne d'utiliser une autre adresse e-mail.",
      }, 409)
    }
    // Repris TEL QU'IL EST, mot de passe compris (voir l'en-tête) : aucune écriture sur le compte, ni
    // ici ni plus bas. Jusqu'au 10/10/2026 le mot de passe saisi s'y posait à cet endroit, avant
    // l'insertion de l'accès — et un refus de l'insertion le laissait changé.
    compte = "existant"
  } else {
    // Un mot de passe que la règle du projet refuse se dit en français, en 400, sans chercher aucun compte ; tout autre
    // refus du service garde son chemin : 500, et son message.
    const refusMotDePasse = refusDuMotDePasse(createError)
    if (refusMotDePasse !== null) return json({ error: refusMotDePasse }, 400)
    return json({ error: createError?.message ?? "Création du compte échouée." }, 500)
  }

  const { error: membershipError } = await supabaseAdmin
    .from("memberships")
    .insert({ user_id: clientUserId, dossier_id: dossierId, role: "client", email })
  if (membershipError) {
    if (/duplicate|unique/i.test(membershipError.message)) {
      return json({
        error: "Cet accès existe déjà pour ce dossier : rien n'a changé, le mot de passe du client non plus. S'il ne s'en souvient plus, envoie-lui un lien de réinitialisation depuis la liste des accès.",
      }, 409)
    }
    return json({ error: membershipError.message }, 500)
  }

  return json({ ok: true, compte })
})
