// Edge Function : réception des pièces envoyées par e-mail (Palier 4).
//
// Le client configure un transfert automatique de ses e-mails de prélèvement récurrent vers une
// adresse dédiée <code_dossier>@precompta.jdarnis.fr — sans jamais donner accès à sa messagerie.
// Resend reçoit ces e-mails et appelle cette fonction via un webhook "email.received" à chaque
// réception ; on récupère les pièces jointes, on les dépose dans le Storage du dossier correspondant
// et on crée une pièce "à valider", exactement comme un dépôt manuel — rien n'est jamais validé
// automatiquement.
//
// Sécurité : cette fonction est publique (pas de vérification JWT Supabase, Resend n'en envoie pas) —
// la seule authentification est la signature du webhook (RESEND_WEBHOOK_SECRET), vérifiée avant tout
// traitement. Elle utilise la clé de service Supabase pour écrire directement en base et au storage,
// sans passer par les policies RLS (il n'y a pas d'utilisateur authentifié dans ce flux).

import { Resend } from "npm:resend@6"
import { createClient } from "npm:@supabase/supabase-js@2"

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

// Le "to" d'un e-mail reçu peut être un simple "code@domaine" ou "Nom <code@domaine>" selon le
// client mail d'origine du transfert — on isole l'adresse dans les deux cas.
function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1] : raw).trim().toLowerCase()
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET")
  if (!resendApiKey || !webhookSecret) {
    console.error("RESEND_API_KEY ou RESEND_WEBHOOK_SECRET manquant")
    return new Response("Configuration serveur incomplète", { status: 500 })
  }

  // Le corps brut (texte, pas encore parsé) est nécessaire à la vérification de signature.
  const rawBody = await req.text()
  const svixId = req.headers.get("svix-id")
  const svixTimestamp = req.headers.get("svix-timestamp")
  const svixSignature = req.headers.get("svix-signature")
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("En-têtes de signature manquants", { status: 400 })
  }

  const resend = new Resend(resendApiKey)

  let event
  try {
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret,
    })
  } catch (err) {
    console.error("Signature webhook invalide:", err)
    return new Response("Signature invalide", { status: 401 })
  }

  if (event.type !== "email.received") {
    // On ne s'abonne qu'à cet événement côté Resend, mais on répond calmement si un autre arrive.
    return new Response("ok", { status: 200 })
  }

  const { email_id, to, from, subject, attachments } = event.data

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const codeEmail = to.map(extractEmail).map((addr) => addr.split("@")[0]).find((c) => !!c)
  if (!codeEmail) {
    console.error("Aucun destinataire exploitable:", to)
    return new Response("ok", { status: 200 })
  }

  const { data: dossier, error: dossierError } = await supabase
    .from("dossiers")
    .select("id")
    .eq("code_email", codeEmail)
    .maybeSingle()

  if (dossierError) {
    console.error(dossierError)
    return new Response("Erreur base de données", { status: 500 })
  }
  if (!dossier) {
    // Adresse inconnue (faute de frappe côté client, ancien transfert...) — on ignore silencieusement
    // plutôt que de renvoyer une erreur, ce qui ferait retenter Resend inutilement.
    console.warn(`Aucun dossier pour "${codeEmail}" (e-mail ${email_id}, de ${from}, sujet "${subject}")`)
    return new Response("ok", { status: 200 })
  }

  // Seules les vraies pièces jointes nous intéressent — pas les images intégrées à une signature
  // (logo...), qui arrivent avec content_disposition "inline".
  const fichiers = (attachments ?? []).filter((a) => a.content_disposition === "attachment")

  let nbImportees = 0
  for (const fichier of fichiers) {
    try {
      const { data: detail, error: attachError } = await resend.emails.receiving.attachments.get({
        emailId: email_id,
        id: fichier.id,
      })
      if (attachError || !detail) {
        console.error("Récupération pièce jointe échouée:", fichier.id, attachError)
        continue
      }

      const res = await fetch(detail.download_url)
      if (!res.ok) {
        console.error("Téléchargement pièce jointe échoué:", fichier.id, res.status)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) continue

      const nomFichier = fichier.filename || `piece-${fichier.id}`
      const path = `${dossier.id}/${Date.now()}-${slugify(nomFichier)}`

      const { error: uploadError } = await supabase.storage
        .from("pieces")
        .upload(path, bytes, { contentType: fichier.content_type || "application/octet-stream" })
      if (uploadError) {
        console.error("Upload storage échoué:", fichier.id, uploadError)
        continue
      }

      const { error: insertError } = await supabase.from("pieces").insert({
        dossier_id: dossier.id,
        source: "email",
        storage_path: path,
        nom_fichier: nomFichier,
        type_piece: "achat",
        statut: "a_valider",
      })
      if (insertError) {
        console.error("Insertion pièce échouée:", fichier.id, insertError)
        continue
      }

      nbImportees++
    } catch (err) {
      console.error("Erreur traitement pièce jointe:", fichier.id, err)
    }
  }

  console.log(`E-mail ${email_id} ("${subject}") → dossier ${dossier.id} : ${nbImportees}/${fichiers.length} pièce(s) importée(s)`)
  return new Response("ok", { status: 200 })
})
