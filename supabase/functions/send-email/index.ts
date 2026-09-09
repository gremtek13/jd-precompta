// Edge Function : envoi d'e-mails au client depuis l'app — facture par e-mail, relance pour obtenir
// des pièces. Utilise le même compte Resend et le même domaine que receive-email (réception),
// precompta.jdarnis.fr, déjà vérifié en envoi ET en réception (voir Dashboard Resend).
//
// Deux modèles pour l'instant (voir payload.type) :
// - "facture" : envoie le détail d'une facture déjà validée (lignes, montants, mentions légales) en
//   corps d'e-mail HTML. PAS de pièce jointe PDF pour l'instant — générer un vrai PDF côté serveur
//   est un chantier à part (voir FactureApercu, qui s'appuie sur l'impression navigateur) : à ajouter
//   si les cabinets réclament la pièce jointe une fois ce premier envoi en usage.
// - "relance_pieces" : simple rappel invitant le client à se connecter à son espace pour déposer ses
//   pièces — aucun lien magique/jeton, le client se connecte normalement, comme d'habitude.
//
// Chaque envoi est journalisé (table emails_envoyes) : un cabinet doit toujours pouvoir retrouver qui
// a reçu quoi et quand, jamais un envoi "silencieux" qu'on ne peut plus vérifier après coup.

import { Resend } from "npm:resend@6"
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

const DOMAINE_ENVOI = "precompta.jdarnis.fr"
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FactureRow {
  id: string; numero: string | null; date_emission: string; date_echeance: string | null
  tiers_nom: string; montant_ht: number; montant_tva: number; montant_ttc: number
  mentions_legales: string | null; emetteur_nom: string | null; type: "facture" | "avoir"
}
interface LigneRow { designation: string; quantite: number; prix_unitaire_ht: number; taux_tva: number }

function formaterMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
}
function formaterDate(d: string): string {
  return new Date(d).toLocaleDateString("fr-FR")
}
// Échappement minimal — designation/tiers_nom/message viennent d'une saisie du cabinet, pas d'un
// tiers non authentifié, mais un e-mail HTML reste un contexte où un "<" mal placé casse le rendu.
function echapper(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function construireEmailFacture(facture: FactureRow, lignes: LigneRow[], messagePerso: string | null): { objet: string; html: string } {
  const emetteur = facture.emetteur_nom ?? "Le cabinet"
  const typeLabel = facture.type === "avoir" ? "Avoir" : "Facture"
  const lignesHtml = lignes.map((l) => {
    const ht = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${echapper(l.designation)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${l.quantite}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${formaterMontant(ht)}</td></tr>`
  }).join("")
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : ""}
      <p>Veuillez trouver ci-dessous le détail de ${typeLabel === "Avoir" ? "l'avoir" : "la facture"} <strong>${echapper(facture.numero ?? "")}</strong>, émis${typeLabel === "Avoir" ? "" : "e"} le ${formaterDate(facture.date_emission)}${facture.date_echeance ? ` (échéance le ${formaterDate(facture.date_echeance)})` : ""}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc;">Désignation</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Qté</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Montant HT</th></tr></thead>
        <tbody>${lignesHtml}</tbody>
      </table>
      <p style="text-align:right;margin:4px 0;">Total HT : ${formaterMontant(facture.montant_ht)}</p>
      <p style="text-align:right;margin:4px 0;">Total TVA : ${formaterMontant(facture.montant_tva)}</p>
      <p style="text-align:right;margin:4px 0;font-weight:bold;">Total TTC : ${formaterMontant(facture.montant_ttc)}</p>
      ${facture.mentions_legales ? `<p style="font-size:0.8em;color:#666;white-space:pre-line;">${echapper(facture.mentions_legales)}</p>` : ""}
      <p style="margin-top:24px;">Cordialement,<br>${echapper(emetteur)}</p>
    </div>`
  return { objet: `${typeLabel} ${facture.numero ?? ""} — ${emetteur}`, html }
}

function construireEmailRelance(dossierNom: string, messagePerso: string | null): { objet: string; html: string } {
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : `<p>Petit rappel : il nous manque encore des pièces (factures, relevés, justificatifs) pour continuer le suivi comptable de <strong>${echapper(dossierNom)}</strong>.</p>`}
      <p>Merci de vous connecter à votre espace habituel pour les déposer.</p>
      <p style="margin-top:24px;">Cordialement,<br>Votre cabinet comptable</p>
    </div>`
  return { objet: `Pièces à transmettre — ${dossierNom}`, html }
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  if (!resendApiKey) {
    return json({ error: "RESEND_API_KEY non configuré côté serveur." }, 500)
  }

  const supabaseAsCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  let payload: { dossierId?: string; type?: "facture" | "relance_pieces"; destinataire?: string; message?: string; factureId?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  const dossierId = payload.dossierId?.trim()
  const type = payload.type
  const destinataire = payload.destinataire?.trim()
  const messagePerso = payload.message?.trim() || null
  if (!dossierId || (type !== "facture" && type !== "relance_pieces") || !destinataire) {
    return json({ error: "dossierId, type ('facture' ou 'relance_pieces') et destinataire sont requis." }, 400)
  }
  if (!EMAIL_REGEX.test(destinataire)) {
    return json({ error: "Adresse e-mail du destinataire invalide." }, 400)
  }

  // Même vérification que les autres fonctions de ce dossier (voir agent-comptable, superpdp-emit).
  const { data: aAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: dossierId })
  if (!aAcces) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  const { data: dossierRow } = await admin.from("dossiers").select("nom").eq("id", dossierId).maybeSingle()
  if (!dossierRow) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  let objet: string, html: string
  let factureId: string | null = null
  // Nom affiché comme expéditeur — celui de la facture (recopié à l'émission, voir types.ts) quand il
  // y en a un, sinon celui du dossier (cas "relance_pieces", qui n'a pas de facture associée).
  let nomExpediteur = dossierRow.nom

  if (type === "facture") {
    factureId = payload.factureId?.trim() ?? null
    if (!factureId) {
      return json({ error: "factureId est requis pour le modèle 'facture'." }, 400)
    }
    const { data: factureData, error: factureError } = await admin
      .from("factures_emises")
      .select("id, numero, statut, type, date_emission, date_echeance, tiers_nom, montant_ht, montant_tva, montant_ttc, mentions_legales, emetteur_nom")
      .eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()
    if (factureError || !factureData) {
      return json({ error: "Facture introuvable." }, 404)
    }
    if (factureData.statut !== "validee") {
      return json({ error: "Seule une facture validée peut être envoyée par e-mail." }, 400)
    }
    const { data: lignesData } = await admin
      .from("facture_lignes")
      .select("designation, quantite, prix_unitaire_ht, taux_tva")
      .eq("facture_id", factureId)
      .order("ordre")
    const construit = construireEmailFacture(factureData as FactureRow, (lignesData ?? []) as LigneRow[], messagePerso)
    objet = construit.objet
    html = construit.html
    nomExpediteur = factureData.emetteur_nom ?? dossierRow.nom
  } else {
    const construit = construireEmailRelance(dossierRow.nom, messagePerso)
    objet = construit.objet
    html = construit.html
  }

  const resend = new Resend(resendApiKey)

  const { data: sent, error: sendError } = await resend.emails.send({
    from: `${nomExpediteur} <contact@${DOMAINE_ENVOI}>`,
    to: destinataire,
    replyTo: callerData.user.email ?? undefined,
    subject: objet,
    html,
  })
  if (sendError) {
    return json({ error: `Échec de l'envoi : ${sendError.message}` }, 502)
  }

  await admin.from("emails_envoyes").insert({
    dossier_id: dossierId, type, destinataire, objet,
    facture_id: factureId, resend_id: sent?.id ?? null, envoye_par: callerData.user.id,
  })

  if (type === "facture" && factureId) {
    await admin.from("factures_emises").update({ tiers_email: destinataire }).eq("id", factureId)
  }

  return json({ ok: true })
})
