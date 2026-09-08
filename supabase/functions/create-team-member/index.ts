// Edge Function : création d'un compte comptable / comptable en chef pour l'équipe d'un cabinet.
//
// Réservé aux chefs de cabinet (rôle comptable_en_chef) et au(x) super-admin(s) — jamais un simple
// comptable, qui ne doit pas pouvoir s'ajouter des collègues ou se promouvoir lui-même. Seule cette
// création de compte (identifiants de connexion) passe par la clé de service ; le reste de la gestion
// d'équipe (retrait, changement de rôle, assignation de dossiers) se fait directement depuis le
// navigateur via les règles de sécurité (RLS), voir la migration gestion_equipe_cabinet.
//
// Même schéma que create-client-access : réutilise un compte Auth existant si l'email est déjà
// inscrit (ex. quelqu'un qui a d'abord été client avant de rejoindre l'équipe) plutôt que d'échouer.

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

// Correctif audit sécurité (compte utilisateurs, Haute) — voir create-client-access, même fonction
// dupliquée ici (fichiers auto-porteurs, voir en-tête) : réutiliser un compte Auth existant en lui
// appliquant un nouveau mot de passe n'est sûr QUE si ce compte a déjà une relation avec CE cabinet.
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

  const supabaseAsCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

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

  let payload: { email?: string; password?: string; role?: string; cabinetId?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }

  const email = payload.email?.trim()
  const password = payload.password
  const role = payload.role
  const cabinetId = (superAdminRow && payload.cabinetId?.trim()) || adminRow?.cabinet_id
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
  if (created?.user) {
    userId = created.user.id
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
    // Voir appartientDejaAuCabinet ci-dessus : jamais toucher au mot de passe d'un compte qui n'a
    // aucun lien préexistant avec ce cabinet (prise de contrôle du compte de quelqu'un d'autre sinon).
    if (!(await appartientDejaAuCabinet(admin, userId, cabinetId))) {
      return json({
        error: "Un compte existe déjà avec cet e-mail, mais il n'est rattaché à aucun dossier ou membre de ce cabinet — impossible de le réutiliser ici (ça écraserait le mot de passe d'un compte qui n'est pas le tien). Demande à cette personne d'utiliser une autre adresse e-mail.",
      }, 409)
    }
    await admin.auth.admin.updateUserById(userId, { password })
  } else {
    return json({ error: createError?.message ?? "Création du compte échouée." }, 500)
  }

  const { error: insertError } = await admin
    .from("cabinet_admins")
    .insert({ user_id: userId, cabinet_id: cabinetId, role, email })
  if (insertError) {
    if (/duplicate|unique/i.test(insertError.message)) {
      return json({ error: "Cette personne appartient déjà à un cabinet (le sien ou un autre)." }, 409)
    }
    return json({ error: insertError.message }, 500)
  }

  return json({ ok: true })
})
