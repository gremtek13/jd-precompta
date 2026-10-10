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

// Correctif audit sécurité (compte utilisateurs, Haute) — voir create-client-access, même fonction
// dupliquée ici (fichiers auto-porteurs, voir en-tête) : un compte Auth existant ne rejoint l'équipe
// d'ici QUE s'il a déjà une relation avec CE cabinet. Son mot de passe n'est plus jamais touché, mais le
// contrôle garde sa raison : repris, ce compte entrerait dans le cabinet avec SON mot de passe, et son
// titulaire n'est peut-être pas la personne que le chef croit ajouter.
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
  const payload = corps as { email?: unknown; password?: unknown; role?: unknown; cabinetId?: unknown }
  // Même porte pour un champ reçu sous une autre forme qu'un texte (un nombre) : `.trim()` y levait — sur
  // l'adresse, et sur le cabinet que désigne un super-admin —, et un mot de passe en nombre passait le
  // contrôle de longueur. `role` n'en a pas besoin : seuls deux textes passent la comparaison plus bas,
  // toute autre forme y est refusée en 400. Absent ou nul, un champ tombe sur le refus « requis ».
  const emailLu = payload.email
  const password = payload.password
  const role = payload.role
  const cabinetIdLu = payload.cabinetId
  if (!texteOuAbsent(emailLu)) {
    return json({ error: "email doit être un texte." }, 400)
  }
  if (!texteOuAbsent(password)) {
    return json({ error: "password doit être un texte." }, 400)
  }
  if (!texteOuAbsent(cabinetIdLu)) {
    return json({ error: "cabinetId doit être un texte." }, 400)
  }

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

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })

  const dejaInscrit = createError && (
    createError.status === 422 || /already|exist|registered|duplicate/i.test(createError.message)
  )

  let userId: string
  // Ce que la réponse dit à l'écran : le mot de passe saisi est-il celui du compte ?
  let compte: "cree" | "existant"
  if (created?.user) {
    userId = created.user.id
    compte = "cree"
  } else if (dejaInscrit) {
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
    // compte, ni ce qu'il est — et rien n'y a été écrit.
    if (!(await appartientDejaAuCabinet(admin, userId, cabinetId))) {
      return json({
        error: "Un compte existe déjà avec cet e-mail, mais il n'est rattaché à aucun dossier ou membre de ce cabinet : il ne rejoint pas l'équipe depuis ici, et rien n'y a été changé. Demande à cette personne d'utiliser une autre adresse e-mail.",
      }, 409)
    }
    // Repris TEL QU'IL EST, mot de passe compris (voir l'en-tête) : aucune écriture sur le compte, ni
    // ici ni plus bas. Jusqu'au 10/10/2026 le mot de passe saisi s'y posait à cet endroit, avant
    // l'écriture dans cabinet_admins — et un refus de cette écriture (la personne déjà dans un cabinet)
    // le laissait changé.
    compte = "existant"
  } else {
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
