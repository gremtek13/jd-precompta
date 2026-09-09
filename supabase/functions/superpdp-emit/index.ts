// Edge Function : émission de factures de vente via Super PDP (plateforme de dématérialisation
// partenaire agréée DGFiP, https://www.superpdp.tech) — complète superpdp-sync (dédié à la
// réception) et réutilise les mêmes identifiants OAuth2 par dossier (voir superpdp-credentials).
//
// Flux d'émission (voir la doc Super PDP "Formats de facture" et la référence OpenAPI) :
// 1. Construire la facture déjà validée dans l'app au format EN16931 (JSON) — voir construireEnInvoice.
// 2. La faire convertir en XML CII par Super PDP lui-même (POST /invoices/convert, endpoint public
//    sans authentification — opération purement algorithmique, pas besoin de générer du XML à la main).
// 3. La faire valider par leur schematron officiel (POST /validation_reports) AVANT tout envoi réel —
//    un envoi une fois transmis part réellement sur le réseau Peppol/PPF vers le client, aucune
//    annulation possible (seul un avoir corrige, comme pour une facture papier). Mieux vaut un rejet
//    synchrone et clair ici qu'un fr:501 "Inadmissible" découvert bien plus tard.
// 4. Transmettre (POST /invoices) — retourne un id Super PDP, mis en file d'attente asynchrone.
// 5. Relire le statut (GET /invoices/{id}) juste après l'envoi, et à la demande ensuite (action
//    "actualiser") — l'historique complet des invoice_events est conservé (voir migration
//    superpdp_emission_factures) : fr:200 soumise, fr:201 envoyée, fr:205 acceptée, fr:210 refusée...
//    L'envoi initial (200 OK) ne dit rien du sort réel de la facture, qui est asynchrone.
//
// Deux actions (voir payload.action) :
// - "envoyer" : construit, valide et transmet une facture validée pas encore envoyée par cette voie
//   (superpdp_invoice_id doit être encore null — pas de double envoi possible depuis cet écran).
// - "actualiser" : relit le statut d'une facture déjà transmise et met à jour son historique.
//
// Simplifications connues, à corriger si le validateur Super PDP les signale en sandbox (voir échange
// avec l'utilisateur — test en sandbox avant tout dossier réel) :
// - postal_address : l'adresse stockée en base est un simple texte multi-lignes (voir FacturesTab),
//   aplati ici en une seule ligne plutôt que découpé en rue/code postal/ville — EN16931 n'exige que
//   country_code, donc ça passe la validation structurelle, mais un futur découpage serait plus propre.
// - vat_identifier (numéro de TVA intracommunautaire) n'est jamais renseigné : aucun champ ne le
//   stocke aujourd'hui côté dossier — à ajouter si le schematron l'exige pour un dossier assujetti.
// - electronic_address de l'acheteur est déduite de son SIREN (les 9 premiers chiffres du SIRET
//   stocké) avec le schéma Peppol France "0225", en supposant qu'il n'a pas déclaré d'adresse
//   spécifique (voir doc "Annuaire" : c'est le cas de la grande majorité des entreprises).
// - Le champ multipart de /validation_reports est nommé "file_name" d'après l'exemple de la spec
//   OpenAPI (propriété du schéma multipart) — à corriger si Super PDP attend un autre nom de champ.

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

const SUPERPDP_ENDPOINT = "https://api.superpdp.tech"
// France, réseau Peppol : schéma d'adresse électronique de facturation basé sur le SIREN (voir doc
// "Annuaire"), et schéma ISO/IEC 6523 pour un identifiant légal de type SIRET.
const SCHEME_ELECTRONIC_ADDRESS_FR = "0225"
const SCHEME_LEGAL_SIRET = "0002"
const SPECIFICATION_IDENTIFIER = "urn:cen.eu:en16931:2017"

interface FactureRow {
  id: string; dossier_id: string; numero: string | null; statut: string; type: "facture" | "avoir"
  date_emission: string; date_echeance: string | null
  tiers_nom: string; tiers_adresse: string | null; tiers_siret: string | null
  montant_ht: number; montant_tva: number; montant_ttc: number
  emetteur_nom: string | null; emetteur_siret: string | null; emetteur_adresse: string | null
  superpdp_invoice_id: number | null
}
interface LigneRow { designation: string; quantite: number; prix_unitaire_ht: number; taux_tva: number }
interface InvoiceEvent { id: number; status_code: string; status_text: string; created_at: string }

async function obtenirToken(clientId: string, clientSecret: string): Promise<string> {
  const resp = await fetch(`${SUPERPDP_ENDPOINT}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  })
  const body = await resp.json().catch(() => null)
  if (resp.status !== 200 || !body?.access_token) {
    throw new Error(`Authentification Super PDP échouée (${resp.status}) : ${body?.error_description ?? body?.error ?? "réponse invalide"}.`)
  }
  return body.access_token
}

// Arrondi à 2 décimales — dupliqué depuis src/lib/factures.ts (fichier auto-porteur, voir les autres
// fonctions de ce dossier).
function calculerLigneMontants(quantite: number, prixUnitaireHt: number, tauxTva: number) {
  const ht = Math.round(quantite * prixUnitaireHt * 100) / 100
  const tva = Math.round(ht * (tauxTva / 100) * 100) / 100
  return { ht, tva }
}

function siren(siret: string): string {
  return siret.replace(/\s/g, "").slice(0, 9)
}

function adresseUneLigne(adresse: string | null): string {
  return (adresse ?? "").replace(/\r?\n/g, ", ").trim() || "Adresse non renseignée"
}

// Construit la structure EN16931 (voir doc Super PDP "Formats de facture" et les schémas OpenAPI
// seller/buyer/totals/invoice_line/vat_break_down) à partir d'une facture déjà validée dans l'app.
// Un avoir (type_code 381) est envoyé en montants positifs, comme la pratique EN16931/XP Z12-012
// habituelle — c'est le type_code qui porte le sens "note de crédit", pas le signe des montants —
// alors qu'en base ce dossier stocke ses avoirs en négatif (voir FactureAvoirModal) : on inverse donc
// le signe ici, uniquement pour cette structure d'échange, jamais en base.
function construireEnInvoice(facture: FactureRow, lignes: LigneRow[]) {
  const signe = facture.type === "avoir" ? -1 : 1
  const emetteurSiret = (facture.emetteur_siret ?? "").replace(/\s/g, "")
  const tiersSiret = (facture.tiers_siret ?? "").replace(/\s/g, "")

  const lignesEnInvoice = lignes.map((l, i) => {
    const { ht } = calculerLigneMontants(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    return {
      identifier: String(i + 1),
      item_information: { name: l.designation },
      invoiced_quantity: String(Math.abs(l.quantite)),
      net_amount: (signe * Math.abs(ht)).toFixed(2),
      price_details: { item_net_price: Math.abs(l.prix_unitaire_ht).toFixed(2) },
    }
  })

  // Regroupé par taux (voir FactureFormModal : une facture a le plus souvent un taux unique, mais une
  // facture à taux mixtes doit rester correcte sans code séparé).
  const parTaux = new Map<number, { base: number; tva: number }>()
  for (const l of lignes) {
    const { ht, tva } = calculerLigneMontants(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    const cur = parTaux.get(l.taux_tva) ?? { base: 0, tva: 0 }
    cur.base += Math.abs(ht)
    cur.tva += Math.abs(tva)
    parTaux.set(l.taux_tva, cur)
  }
  const vatBreakDown = [...parTaux.entries()].map(([taux, { base, tva }]) => ({
    vat_category_code: taux === 0 ? "E" : "S",
    vat_category_rate: taux.toFixed(2),
    vat_category_taxable_amount: base.toFixed(2),
    vat_category_tax_amount: tva.toFixed(2),
    ...(taux === 0 ? { vat_exemption_reason: "Franchise en base de TVA, art. 293 B du CGI." } : {}),
  }))

  return {
    number: facture.numero ?? "",
    issue_date: facture.date_emission,
    ...(facture.date_echeance ? { payment_due_date: facture.date_echeance } : {}),
    type_code: facture.type === "avoir" ? 381 : 380,
    currency_code: "EUR",
    process_control: { specification_identifier: SPECIFICATION_IDENTIFIER },
    seller: {
      name: facture.emetteur_nom ?? "",
      electronic_address: { scheme: SCHEME_ELECTRONIC_ADDRESS_FR, value: siren(emetteurSiret) },
      postal_address: { address_line1: adresseUneLigne(facture.emetteur_adresse), country_code: "FR" },
      legal_registration_identifier: { scheme: SCHEME_LEGAL_SIRET, value: emetteurSiret },
    },
    buyer: {
      name: facture.tiers_nom,
      electronic_address: { scheme: SCHEME_ELECTRONIC_ADDRESS_FR, value: siren(tiersSiret) },
      postal_address: { address_line1: adresseUneLigne(facture.tiers_adresse), country_code: "FR" },
      legal_registration_identifier: { scheme: SCHEME_LEGAL_SIRET, value: tiersSiret },
    },
    totals: {
      sum_invoice_lines_amount: (signe * Math.abs(facture.montant_ht)).toFixed(2),
      total_without_vat: (signe * Math.abs(facture.montant_ht)).toFixed(2),
      total_vat_amount: { value: (signe * Math.abs(facture.montant_tva)).toFixed(2), currency_code: "EUR" },
      total_with_vat: (signe * Math.abs(facture.montant_ttc)).toFixed(2),
      amount_due_for_payment: (signe * Math.abs(facture.montant_ttc)).toFixed(2),
    },
    vat_break_down: vatBreakDown,
    lines: lignesEnInvoice,
  }
}

// Relit l'état complet d'une facture déjà transmise (GET /invoices/{id} inclut son tableau
// `events`), enregistre les événements pas encore connus (idempotent — voir la contrainte unique
// facture_id+superpdp_event_id de la migration) et dénormalise le plus récent sur
// factures_emises.superpdp_dernier_statut. Renvoie l'ensemble des événements pour l'affichage.
async function actualiserStatut(
  admin: ReturnType<typeof createClient>, headers: Record<string, string>,
  dossierId: string, factureId: string, superpdpInvoiceId: number,
): Promise<{ dernierStatut: string | null; evenements: InvoiceEvent[] }> {
  const resp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/invoices/${superpdpInvoiceId}`, { headers })
  const body = await resp.json().catch(() => null)
  if (!resp.ok) throw new Error(`Lecture du statut Super PDP échouée (${resp.status}) : ${body?.error ?? "réponse invalide"}.`)
  const evenements = (body?.events ?? []) as InvoiceEvent[]
  if (evenements.length > 0) {
    const lignes = evenements.map((e) => ({
      dossier_id: dossierId, facture_id: factureId, superpdp_event_id: e.id,
      status_code: e.status_code, status_text: e.status_text, occurred_at: e.created_at,
    }))
    await admin.from("facture_superpdp_events").upsert(lignes, { onConflict: "facture_id,superpdp_event_id", ignoreDuplicates: true })
  }
  const dernier = [...evenements].sort((a, b) => a.id - b.id).at(-1) ?? null
  await admin.from("factures_emises").update({ superpdp_dernier_statut: dernier?.status_code ?? null }).eq("id", factureId)
  return { dernierStatut: dernier?.status_code ?? null, evenements }
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

  let payload: { dossierId?: string; factureId?: string; action?: "envoyer" | "actualiser" }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  const dossierId = payload.dossierId?.trim()
  const factureId = payload.factureId?.trim()
  const action = payload.action
  if (!dossierId || !factureId || (action !== "envoyer" && action !== "actualiser")) {
    return json({ error: "dossierId, factureId et action ('envoyer' ou 'actualiser') sont requis." }, 400)
  }

  // Même vérification que les autres fonctions de ce dossier (voir agent-comptable, superpdp-sync) :
  // super-admin, chef de cabinet, ou comptable assigné à ce dossier précisément.
  const { data: aAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: dossierId })
  if (!aAcces) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  const { data: factureData, error: factureError } = await admin
    .from("factures_emises")
    .select("id, dossier_id, numero, statut, type, date_emission, date_echeance, tiers_nom, tiers_adresse, tiers_siret, montant_ht, montant_tva, montant_ttc, emetteur_nom, emetteur_siret, emetteur_adresse, superpdp_invoice_id")
    .eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()
  if (factureError || !factureData) {
    return json({ error: "Facture introuvable." }, 404)
  }
  const facture = factureData as FactureRow

  const { data: creds } = await admin
    .from("superpdp_credentials")
    .select("client_id, client_secret")
    .eq("dossier_id", dossierId)
    .maybeSingle()
  if (!creds) {
    return json({ error: "Identifiants Super PDP non configurés pour ce dossier." }, 400)
  }

  try {
    console.log(`[superpdp-emit] action=${action} facture=${factureId}`)
    const token = await obtenirToken(creds.client_id, creds.client_secret)
    console.log(`[superpdp-emit] token OK`)
    const headers = { Authorization: `Bearer ${token}` }

    if (action === "actualiser") {
      if (!facture.superpdp_invoice_id) {
        return json({ error: "Cette facture n'a jamais été transmise via Super PDP." }, 400)
      }
      const { dernierStatut, evenements } = await actualiserStatut(admin, headers, dossierId, factureId, facture.superpdp_invoice_id)
      return json({ ok: true, dernier_statut: dernierStatut, evenements })
    }

    // action === "envoyer"
    console.log(`[superpdp-emit] checkpoint 1 : statut=${facture.statut} superpdp_invoice_id=${facture.superpdp_invoice_id} emetteur_siret=${JSON.stringify(facture.emetteur_siret)} tiers_siret=${JSON.stringify(facture.tiers_siret)}`)
    if (facture.statut !== "validee") {
      return json({ error: "Seule une facture validée peut être transmise." }, 400)
    }
    if (facture.superpdp_invoice_id) {
      return json({ error: "Cette facture a déjà été transmise via Super PDP." }, 400)
    }
    if (!facture.emetteur_siret || facture.emetteur_siret.replace(/\s/g, "").length < 9) {
      return json({ error: "Le SIRET de l'émetteur (ce dossier) est manquant ou invalide — renseigne-le dans Mes informations avant de transmettre via Super PDP." }, 400)
    }
    if (!facture.tiers_siret || facture.tiers_siret.replace(/\s/g, "").length < 9) {
      return json({ error: "Le SIRET du client facturé est manquant ou invalide — Super PDP a besoin de son identifiant pour acheminer la facture." }, 400)
    }
    console.log(`[superpdp-emit] checkpoint 2 : garde-fous passés, lecture des lignes…`)

    const { data: lignesData, error: lignesError } = await admin
      .from("facture_lignes")
      .select("designation, quantite, prix_unitaire_ht, taux_tva")
      .eq("facture_id", factureId)
      .order("ordre")
    if (lignesError) throw new Error(lignesError.message)
    const lignes = (lignesData ?? []) as LigneRow[]
    if (lignes.length === 0) {
      return json({ error: "Cette facture n'a aucune ligne." }, 400)
    }

    const enInvoice = construireEnInvoice(facture, lignes)
    console.log(`[superpdp-emit] en_invoice construit : ${JSON.stringify(enInvoice).slice(0, 800)}`)

    // 1. Conversion JSON EN16931 → XML CII (endpoint public, sans authentification).
    const convertResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/invoices/convert?from=en16931&to=cii`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enInvoice),
    })
    const cii = await convertResp.text()
    console.log(`[superpdp-emit] convert status=${convertResp.status}`)
    if (!convertResp.ok) {
      throw new Error(`Conversion en CII échouée (${convertResp.status}) : ${cii.slice(0, 500)}`)
    }

    // 2. Validation schematron officielle AVANT tout envoi réel — voir en-tête de fichier.
    const form = new FormData()
    form.append("file_name", new File([cii], `facture-${facture.numero ?? facture.id}.xml`, { type: "application/xml" }))
    const validationResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/validation_reports`, { method: "POST", body: form })
    const validationBody = await validationResp.json().catch(() => null)
    console.log(`[superpdp-emit] validation status=${validationResp.status} body=${JSON.stringify(validationBody).slice(0, 800)}`)
    if (!validationResp.ok) {
      throw new Error(`Validation Super PDP échouée (${validationResp.status}) : ${validationBody?.error ?? "réponse invalide"}.`)
    }
    const rapport = validationBody?.data?.[0]
    if (rapport?.is_valid === false) {
      const messages = ((rapport.subreports ?? []) as { failures?: { message: string }[] }[])
        .flatMap((s) => (s.failures ?? []).map((m) => m.message))
      return json({ error: `Facture non conforme selon le validateur Super PDP : ${messages.slice(0, 5).join(" ; ") || "raison non précisée."}` }, 400)
    }

    // 3. Envoi réel — irréversible, voir en-tête de fichier. external_id (l'id de notre facture,
    // 36 caractères comme tout uuid) sert à la retrouver côté Super PDP en cas de doute.
    const sendResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/invoices?external_id=${encodeURIComponent(facture.id)}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/xml" },
      body: cii,
    })
    const sendBody = await sendResp.json().catch(() => null)
    console.log(`[superpdp-emit] send status=${sendResp.status} body=${JSON.stringify(sendBody).slice(0, 800)}`)
    if (!sendResp.ok || !sendBody?.id) {
      throw new Error(`Envoi Super PDP échoué (${sendResp.status}) : ${sendBody?.error ?? "réponse invalide"}.`)
    }

    const { error: updateError } = await admin.from("factures_emises").update({ superpdp_invoice_id: sendBody.id }).eq("id", factureId)
    if (updateError) throw new Error(updateError.message)

    // Relit immédiatement l'état (plutôt que de se fier au seul champ `events`, optionnel, de la
    // réponse de création) pour afficher un premier statut sans attendre un clic sur "Actualiser".
    const { dernierStatut, evenements } = await actualiserStatut(admin, headers, dossierId, factureId, sendBody.id)

    return json({ ok: true, superpdp_invoice_id: sendBody.id, dernier_statut: dernierStatut, evenements })
  } catch (err) {
    console.error(`[superpdp-emit] erreur attrapée :`, err)
    const detail = err instanceof Error ? `${err.name} : ${err.message}` : String(err)
    return json({ error: `Erreur inattendue : ${detail}` }, 500)
  }
})
