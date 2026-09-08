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

  const { data: superAdminRow } = await admin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  if (!superAdminRow) {
    return json({ error: "Réservé aux super-admins." }, 403)
  }

  let payload: { nom?: string; email?: string; password?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }

  const nom = payload.nom?.trim()
  const email = payload.email?.trim()
  const password = payload.password
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
    await admin.from("cabinets").delete().eq("id", cabinet.id)
    const dejaInscrit = createError && (
      createError.status === 422 || /already|exist|registered|duplicate/i.test(createError.message)
    )
    return json({
      error: dejaInscrit
        ? "Un compte existe déjà avec cet e-mail — utilise une autre adresse pour le premier comptable en chef de ce cabinet."
        : (createError?.message ?? "Création du compte échouée."),
    }, dejaInscrit ? 409 : 500)
  }

  const { error: insertError } = await admin
    .from("cabinet_admins")
    .insert({ user_id: created.user.id, cabinet_id: cabinet.id, role: "comptable_en_chef", email })
  if (insertError) {
    await admin.from("cabinets").delete().eq("id", cabinet.id)
    if (/duplicate|unique/i.test(insertError.message)) {
      return json({ error: "Cette personne appartient déjà à un cabinet (le sien ou un autre)." }, 409)
    }
    return json({ error: insertError.message }, 500)
  }

  return json({ ok: true, cabinetId: cabinet.id })
})
