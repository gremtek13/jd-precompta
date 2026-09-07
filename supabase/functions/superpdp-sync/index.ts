// Edge Function : synchronisation des factures reçues via Super PDP (plateforme de dématérialisation
// partenaire agréée DGFiP, https://www.superpdp.tech) — brique "réception" de la facturation
// électronique. L'émission (factures de vente) n'est pas traitée : aucun dossier actuel n'émet de
// facture électronique, seuls des achats sont concernés pour l'instant (voir discussion).
//
// Fonctionnement : Super PDP normalise n'importe quel format reçu (Factur-X, UBL, CII...) en une
// structure unique "en_invoice" (norme EN16931) — on n'a donc jamais besoin de parser un PDF ou un
// XML nous-mêmes, contrairement à une intégration Factur-X faite maison. On y lit directement tiers,
// dates et montants, avec une confiance "haute" (donnée structurée officielle, pas de l'OCR).
//
// Chaque dossier a ses propres identifiants OAuth2 (voir superpdp-credentials) : une application
// Super PDP est rattachée à une seule entreprise/SIRET, impossible de mutualiser.
//
// Comme tout import (voir ImportDossierModal, receive-email) : une facture importée arrive en
// statut "a_valider", jamais validée automatiquement — rien ne s'écrit comme définitif sans un clic
// explicite du cabinet. La déduplication se fait par superpdp_invoice_id (voir migration), pas par
// contenu : une resynchronisation répétée ne réimporte jamais deux fois la même facture.
//
// Le document attaché à la pièce est un résumé texte lisible généré à partir de en_invoice (Super PDP
// ne semble pas exposer de téléchargement du fichier original reçu dans son API actuelle — seulement
// la structure normalisée) : si une telle route existe, on pourra la brancher ici pour joindre le
// vrai PDF/XML plus tard sans rien changer au reste du flux.

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
// Borne défensive : évite qu'une synchronisation ne tourne indéfiniment sur un très gros historique.
// Largement suffisant en usage normal (une synchro régulière ne rattrape jamais des milliers de
// factures d'un coup) ; augmenter si un dossier a un vrai retard à rattraper.
const MAX_FACTURES_PAR_SYNC = 100

interface EnInvoiceMontant { value: string; currency_code: string }
interface EnInvoiceParty { name: string }
interface EnInvoice {
  number: string
  issue_date: string
  seller: EnInvoiceParty
  buyer: EnInvoiceParty
  totals: {
    total_without_vat: string
    total_vat_amount: EnInvoiceMontant
    total_with_vat: string
  }
  lines?: { item_information?: { name?: string }; net_amount?: string }[]
}
interface InvoiceListItem { id: number; direction: "in" | "out" }
interface InvoiceDetail { id: number; direction: "in" | "out"; en_invoice?: EnInvoice }

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

// Résumé texte lisible d'une facture EN16931 — sert de document attaché à la pièce en l'absence
// d'accès au fichier original (voir note en tête de fichier). Volontairement simple, pas un vrai
// rendu de facture : juste de quoi identifier le document sans ambiguïté à l'ouverture.
function resumeTexteFacture(inv: EnInvoice, invoiceId: number): string {
  const lignes = (inv.lines ?? [])
    .map((l) => `  - ${l.item_information?.name ?? "(sans libellé)"} : ${l.net_amount ?? "?"} € HT`)
    .join("\n")
  return `Facture reçue via Super PDP (id ${invoiceId})
Numéro : ${inv.number}
Date d'émission : ${inv.issue_date}
Fournisseur : ${inv.seller?.name ?? "?"}
Client : ${inv.buyer?.name ?? "?"}

Total HT : ${inv.totals?.total_without_vat ?? "?"} €
Total TVA : ${inv.totals?.total_vat_amount?.value ?? "?"} €
Total TTC : ${inv.totals?.total_with_vat ?? "?"} €
${lignes ? `\nLignes :\n${lignes}\n` : ""}
Ce document est un résumé généré automatiquement à partir des données structurées transmises par
Super PDP — à vérifier comme toute pièce "à valider", pas un rendu du fichier original.
`
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
    .select("user_id")
    .eq("user_id", callerData.user.id)
    .maybeSingle()
  if (!adminRow) {
    return json({ error: "Réservé au cabinet." }, 403)
  }

  let payload: { dossierId?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  const dossierId = payload.dossierId?.trim()
  if (!dossierId) {
    return json({ error: "dossierId est requis." }, 400)
  }

  const { data: creds } = await admin
    .from("superpdp_credentials")
    .select("client_id, client_secret")
    .eq("dossier_id", dossierId)
    .maybeSingle()
  if (!creds) {
    return json({ error: "Identifiants Super PDP non configurés pour ce dossier." }, 400)
  }

  try {
    const token = await obtenirToken(creds.client_id, creds.client_secret)
    const headers = { Authorization: `Bearer ${token}` }

    // Liste paginée (la plus récente d'abord) — on s'arrête dès qu'il n'y a plus de page suivante ou
    // que la borne défensive est atteinte.
    const invoices: InvoiceListItem[] = []
    let apres: number | undefined
    for (let page = 0; page < 20 && invoices.length < MAX_FACTURES_PAR_SYNC; page++) {
      const url = new URL(`${SUPERPDP_ENDPOINT}/v1.beta/invoices`)
      url.searchParams.set("order", "desc")
      if (apres) url.searchParams.set("starting_after_id", String(apres))
      const resp = await fetch(url, { headers })
      const body = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(`Liste des factures Super PDP échouée (${resp.status}) : ${body?.error ?? "réponse invalide"}.`)
      const data = (body?.data ?? []) as InvoiceListItem[]
      invoices.push(...data)
      if (!body?.has_after || data.length === 0) break
      apres = data[data.length - 1].id
    }

    // Uniquement les factures reçues (direction "in") — l'émission n'est pas traitée par cette
    // synchronisation (voir note en tête de fichier).
    const recues = invoices.filter((i) => i.direction === "in").slice(0, MAX_FACTURES_PAR_SYNC)

    const { data: dejaImportees } = await admin
      .from("pieces")
      .select("superpdp_invoice_id")
      .eq("dossier_id", dossierId)
      .not("superpdp_invoice_id", "is", null)
    const idsConnus = new Set(((dejaImportees ?? []) as { superpdp_invoice_id: number }[]).map((p) => p.superpdp_invoice_id))

    const aTraiter = recues.filter((i) => !idsConnus.has(i.id))

    let importees = 0
    let enAttenteTraitement = 0
    const erreurs: string[] = []

    for (const item of aTraiter) {
      try {
        const resp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/invoices/${item.id}`, { headers })
        const detail = (await resp.json().catch(() => null)) as InvoiceDetail | null
        if (!resp.ok || !detail) {
          erreurs.push(`Facture ${item.id} : détail illisible (${resp.status}).`)
          continue
        }
        if (!detail.en_invoice) {
          // Encore en cours de traitement côté Super PDP (asynchrone) — pas encore d'erreur, sera
          // repris à la prochaine synchronisation puisqu'aucune pièce n'a été créée pour cet id.
          enAttenteTraitement++
          continue
        }

        const inv = detail.en_invoice
        const texte = resumeTexteFacture(inv, item.id)
        const nomFichier = `Facture Super PDP ${inv.number || item.id} - ${inv.seller?.name ?? "fournisseur inconnu"}.txt`
        const path = `${dossierId}/superpdp-${item.id}.txt`
        const { error: uploadError } = await admin.storage.from("pieces").upload(path, new Blob([texte], { type: "text/plain" }), { upsert: true })
        if (uploadError) {
          erreurs.push(`Facture ${item.id} : échec de l'enregistrement du document (${uploadError.message}).`)
          continue
        }

        const { error: insertError } = await admin.from("pieces").insert({
          dossier_id: dossierId,
          source: "superpdp",
          storage_path: path,
          nom_fichier: nomFichier,
          superpdp_invoice_id: item.id,
          type_piece: "achat",
          statut: "a_valider",
          date_piece: inv.issue_date || null,
          tiers: inv.seller?.name || null,
          montant_ht: inv.totals?.total_without_vat ? Number(inv.totals.total_without_vat) : null,
          montant_tva: inv.totals?.total_vat_amount?.value ? Number(inv.totals.total_vat_amount.value) : null,
          montant_ttc: inv.totals?.total_with_vat ? Number(inv.totals.total_with_vat) : null,
          confiance: "haute",
        })
        if (insertError) {
          erreurs.push(`Facture ${item.id} : ${insertError.message}`)
          continue
        }
        importees++
      } catch (err) {
        erreurs.push(`Facture ${item.id} : ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return json({
      importees,
      deja_connues: recues.length - aTraiter.length,
      en_attente_traitement: enAttenteTraitement,
      erreurs,
    })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Erreur inattendue." }, 500)
  }
})
