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

  const { data: adminRow } = await supabaseAdmin
    .from("cabinet_admins")
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  if (!adminRow) {
    return json({ error: "Réservé au cabinet." }, 403)
  }

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

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  })

  let clientUserId: string
  if (created?.user) {
    clientUserId = created.user.id
  } else if (createError && /already|exist/i.test(createError.message)) {
    // Compte déjà existant (accès retiré précédemment sur un autre dossier, ou même client réinvité) —
    // on le retrouve par e-mail plutôt que d'échouer. listUsers() ne filtre pas par e-mail côté API,
    // on pagine donc et on compare nous-mêmes (suffisant pour un nombre de comptes clients raisonnable).
    const emailNormalise = email.toLowerCase()
    let trouve: string | null = null
    for (let page = 1; page <= 25 && !trouve; page++) {
      const { data: liste, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
      if (listError || !liste || liste.users.length === 0) break
      trouve = liste.users.find((u) => (u.email ?? "").toLowerCase() === emailNormalise)?.id ?? null
      if (liste.users.length < 200) break // dernière page atteinte
    }
    if (!trouve) {
      return json({ error: "Un compte existe déjà pour cet e-mail mais n'a pas pu être retrouvé — contacte le support." }, 500)
    }
    clientUserId = trouve
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
