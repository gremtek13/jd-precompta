// Edge Function : réception des pièces envoyées par e-mail (Palier 4).
//
// Le client configure un transfert automatique de ses e-mails de prélèvement récurrent vers une
// adresse dédiée <code_dossier>@precompta.jdarnis.fr — sans jamais donner accès à sa messagerie.
// Resend reçoit ces e-mails et appelle cette fonction via un webhook "email.received" à chaque
// réception ; on récupère les pièces jointes, on les dépose dans le Storage du dossier correspondant,
// on les fait passer par la même extraction/classification que l'import manuel ou en masse (voir
// extract-piece), puis on crée une pièce ou un document "à valider" selon le résultat — exactement
// comme un dépôt manuel, rien n'est jamais validé automatiquement.
//
// Sécurité : cette fonction est publique (pas de vérification JWT Supabase, Resend n'en envoie pas) —
// la seule authentification est la signature du webhook (RESEND_WEBHOOK_SECRET), vérifiée avant tout
// traitement. Elle utilise la clé de service Supabase pour écrire directement en base et au storage,
// sans passer par les policies RLS (il n'y a pas d'utilisateur authentifié dans ce flux) — et pour
// appeler extract-piece en tant que service (le client web l'appelle avec la session de l'utilisateur,
// ici il n'y en a pas).

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

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

interface ExtractionPiece {
  classification: "releve_bancaire" | "cotisation" | "attestation" | "facture"
  date_piece: string | null
  tiers: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
}

// Même appel que celui que fait le navigateur (lib/extraction.ts côté client) mais depuis le serveur —
// pas de session utilisateur ici, donc la clé de service sert d'autorisation. Best-effort : un échec
// (Textract, format refusé...) ne doit pas bloquer l'import, juste laisser les champs vides à compléter
// à la main, comme pour un dépôt manuel dont l'extraction aurait échoué.
async function classifierEtExtraire(bytes: Uint8Array, supabaseUrl: string, serviceRoleKey: string): Promise<ExtractionPiece | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/extract-piece`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
      body: bytes,
    })
    if (!res.ok) return null
    const result = await res.json()
    return result.error ? null : result
  } catch (err) {
    console.error("Appel extract-piece échoué:", err)
    return null
  }
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

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

      // Même détection de doublon que les autres points d'entrée (import manuel, en masse) — un
      // transfert automatique peut renvoyer plusieurs fois le même e-mail (relance client, règle de
      // transfert mal configurée...).
      const hash = await hashBytes(bytes)
      const [{ count: dansPieces }, { count: dansDocuments }] = await Promise.all([
        supabase.from("pieces").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("storage_hash", hash),
        supabase.from("documents_divers").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("storage_hash", hash),
      ])
      if ((dansPieces ?? 0) > 0 || (dansDocuments ?? 0) > 0) {
        console.log(`Pièce jointe déjà présente (hash identique), ignorée: ${fichier.id}`)
        continue
      }

      const nomFichier = fichier.filename || `piece-${fichier.id}`
      const path = `${dossier.id}/${Date.now()}-${slugify(nomFichier)}`

      const { error: uploadError } = await supabase.storage
        .from("pieces")
        .upload(path, bytes, { contentType: fichier.content_type || "application/octet-stream" })
      if (uploadError) {
        console.error("Upload storage échoué:", fichier.id, uploadError)
        continue
      }

      // Un CSV n'est jamais envoyé à Textract (relevés/factures en PDF ou image uniquement) — classé
      // directement en relevé bancaire sur son extension, comme les autres points d'entrée. Les autres
      // formats passent par la même extraction/classification que l'import manuel ou en masse : une
      // facture (ou une extraction en échec) atterrit dans Pièces à compléter/vérifier, le reste
      // (relevé, cotisation, attestation) dans Documents.
      const estCsv = nomFichier.toLowerCase().endsWith(".csv")
      const extraction = estCsv ? null : await classifierEtExtraire(bytes, supabaseUrl, serviceRoleKey)
      const classification = estCsv ? "releve_bancaire" : (extraction?.classification ?? "facture")

      const insertError = classification === "facture"
        ? (await supabase.from("pieces").insert({
            dossier_id: dossier.id,
            source: "email",
            storage_path: path,
            storage_hash: hash,
            nom_fichier: nomFichier,
            type_piece: "achat",
            statut: "a_valider",
            date_piece: extraction?.date_piece ?? null,
            tiers: extraction?.tiers ?? null,
            montant_ht: extraction?.montant_ht ?? null,
            montant_tva: extraction?.montant_tva ?? null,
            montant_ttc: extraction?.montant_ttc ?? null,
          })).error
        : (await supabase.from("documents_divers").insert({
            dossier_id: dossier.id,
            storage_path: path,
            storage_hash: hash,
            nom_fichier: nomFichier,
            categorie: classification,
          })).error

      if (insertError) {
        console.error("Insertion échouée:", fichier.id, insertError)
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
