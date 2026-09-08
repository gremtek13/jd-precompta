// Edge Function : création (ou réutilisation) d'un accès client sur un dossier.
//
// Remplace l'ancien flux signUp() côté navigateur (AccesTab) : retirer un accès (bouton "Retirer")
// ne supprime que la ligne memberships, jamais le compte Auth sous-jacent — donc redonner accès avec
// la même adresse e-mail à un autre dossier faisait échouer supabase.auth.signUp() en "déjà inscrit".
// Ici, avec la clé de service : on crée le compte s'il n'existe pas encore, sinon on réutilise le
// compte existant (et on applique le mot de passe saisi, pour que le formulaire reste prévisible :
// le mot de passe tapé est toujours celui à donner au client, compte neuf ou réutilisé) et on ajoute
// simplement la ligne memberships pour ce nouveau dossier.
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

// Correctif audit sécurité (compte utilisateurs, Haute) : réutiliser un compte Auth existant en lui
// appliquant un nouveau mot de passe n'est sûr QUE si ce compte a déjà une relation avec CE cabinet —
// un client d'un de ses dossiers, ou un membre de son équipe. Avant ce contrôle, n'importe quel email
// déjà inscrit ailleurs sur la plateforme (client d'un autre cabinet, comptable d'un autre cabinet...)
// voyait son mot de passe écrasé par le premier cabinet qui tapait cet email dans ce formulaire —
// prise de contrôle de compte, avant même toute vérification d'appartenance. Vrai uniquement si le
// cabinet appelant a déjà, en base, une raison légitime de gérer ce compte.
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

  // Client "appelant" : sert uniquement à identifier qui fait la demande, avec son propre JWT —
  // jamais la clé de service pour cette vérification.
  const supabaseAsCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

  let payload: { dossierId?: string; email?: string; password?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  const dossierId = payload.dossierId?.trim()
  const email = payload.email?.trim()
  const password = payload.password
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
  // seule cette vérification côté serveur est une vraie garantie, ici l'unique point d'entrée pour
  // créer ou changer le mot de passe d'un compte client.
  if (password.length < 10) {
    return json({ error: "Le mot de passe doit faire au moins 10 caractères." }, 400)
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  })

  // Le message exact ("User already registered", "A user with this email address has already been
  // registered"...) varie selon la version de GoTrue — on élargit donc la détection (mots-clés +
  // statut 422, le code HTTP habituel de ce cas précis) plutôt que de dépendre d'un seul libellé.
  const dejaInscrit = createError && (
    createError.status === 422 || /already|exist|registered|duplicate/i.test(createError.message)
  )

  let clientUserId: string
  if (created?.user) {
    clientUserId = created.user.id
  } else if (dejaInscrit) {
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
    // Voir appartientDejaAuCabinet ci-dessus : jamais toucher au mot de passe d'un compte qui n'a
    // aucun lien préexistant avec ce cabinet, sous peine de prise de contrôle du compte de quelqu'un
    // d'autre (client ou comptable d'un cabinet tiers, ou personne sans lien du tout avec celui-ci).
    if (!(await appartientDejaAuCabinet(supabaseAdmin, clientUserId, cabinetId))) {
      return json({
        error: "Un compte existe déjà avec cet e-mail, mais il n'est rattaché à aucun dossier ou membre de ce cabinet — impossible de lui donner accès depuis ici (ça écraserait le mot de passe d'un compte qui n'est pas le tien). Demande à cette personne d'utiliser une autre adresse e-mail.",
      }, 409)
    }
    // Le mot de passe saisi dans le formulaire doit rester celui à donner au client, que le compte
    // soit neuf ou réutilisé.
    await supabaseAdmin.auth.admin.updateUserById(clientUserId, { password })
  } else {
    return json({ error: createError?.message ?? "Création du compte échouée." }, 500)
  }

  const { error: membershipError } = await supabaseAdmin
    .from("memberships")
    .insert({ user_id: clientUserId, dossier_id: dossierId, role: "client", email })
  if (membershipError) {
    if (/duplicate|unique/i.test(membershipError.message)) {
      return json({ error: "Cet accès existe déjà pour ce dossier." }, 409)
    }
    return json({ error: membershipError.message }, 500)
  }

  return json({ ok: true })
})
