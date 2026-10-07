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
// avec l'utilisateur — test en sandbox avant tout dossier réel ; BR-S-08, BR-23 et BR-S-02 déjà
// rencontrées et corrigées en cours de route) :
// - postal_address : l'adresse stockée en base est un simple texte multi-lignes (voir FacturesTab),
//   aplati ici en une seule ligne plutôt que découpé en rue/code postal/ville — EN16931 n'exige que
//   country_code, donc ça passe la validation structurelle, mais un futur découpage serait plus propre.
// - invoiced_quantity_code (unité de mesure) est toujours "C62" (générique, voir CODE_UNITE_GENERIQUE) —
//   cette app ne distingue pas encore les unités par ligne (kg, heure...).
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

// Numéro de TVA intracommunautaire français, calculé à partir du SIREN (clé officielle : voir Code
// général des impôts, art. 286 ter) — évite de demander un champ de plus au cabinet alors que la
// valeur se déduit entièrement et de façon fiable du SIREN déjà saisi. Repose sur BR-S-02 (EN16931) :
// une facture avec une ligne à taux standard doit porter au moins un identifiant fiscal du vendeur
// (numéro de TVA, immatriculation fiscale locale, ou représentant fiscal) — celui-ci est le plus
// naturel pour une entreprise française assujettie.
function numeroTvaFr(siren9: string): string {
  const n = parseInt(siren9, 10)
  const cle = (12 + 3 * (n % 97)) % 97
  return `FR${String(cle).padStart(2, "0")}${siren9}`
}

// Code d'unité UN/ECE Rec. 20 générique ("un", "pièce") — cette app ne distingue pas encore les
// unités de mesure (kg, heure...) par ligne de facture, "C62" est le repli standard des logiciels de
// facturation français quand aucune unité spécifique n'est saisie. BR-23 (EN16931) l'exige sur
// chaque ligne, quel que soit le cas d'usage.
const CODE_UNITE_GENERIQUE = "C62"

function adresseUneLigne(adresse: string | null): string {
  return (adresse ?? "").replace(/\r?\n/g, ", ").trim() || "Adresse non renseignée"
}

// ── DÉBUT STATUT TVA ────────────────────────────────────────────────────────────────────────────
// Le statut de TVA du dossier (ligne 28.5, étape a) : la copie de src/lib/statutTva.ts — les exonérations,
// `motifExoneration` et `refusTauxPositif` —, que superpdpStatutTva.test.ts extrait, transpile et compare à
// l'original sur chaque statut, chaque article et chaque taux. Une ligne à 0 % partait jusqu'ici avec le
// motif de la franchise en base quel que soit le dossier, donc un dossier de soins exonérés transmettait à
// une plateforme agréée une franchise qu'il n'a pas. Un motif faux ne se reprend que par un avoir.
type StatutTva = "redevable" | "franchise" | "exonere"
type ArticleExoneration = "cgi_261_4_1" | "cgi_261_4_4_a" | "cgi_261_4_4_b" | "cgi_261_c_2"

// La mention de la facture et le code VATEX de chaque article (BT-120, BT-121). La règle BR-E-10 admet le
// code OU le texte : seul le TEXTE est transmis, dont le champ est connu.
const EXONERATIONS: readonly { code: ArticleExoneration; mention: string; vatex: string }[] = [
  { code: "cgi_261_4_1", mention: "Exonération de TVA, art. 261, 4, 1° du CGI.", vatex: "VATEX-FR-CGI261-4" },
  { code: "cgi_261_4_4_a", mention: "Exonération de TVA, art. 261, 4, 4° a du CGI.", vatex: "VATEX-FR-CGI261-4" },
  { code: "cgi_261_4_4_b", mention: "Exonération de TVA, art. 261, 4, 4° b du CGI.", vatex: "VATEX-FR-CGI261-4" },
  { code: "cgi_261_c_2", mention: "Exonération de TVA, art. 261 C, 2° du CGI.", vatex: "VATEX-FR-CGI261C-2" },
]

const MENTION_FRANCHISE = "TVA non applicable, art. 293 B du CGI."
const VATEX_FRANCHISE = "VATEX-FR-FRANCHISE"

function exonerationDe(article: ArticleExoneration | null) {
  return article == null ? null : EXONERATIONS.find((e) => e.code === article) ?? null
}

interface MotifExoneration {
  categorie: "E"
  code: string
  texte: string
}

function motifExoneration(
  statut: StatutTva | null, article: ArticleExoneration | null,
): { motif: MotifExoneration; refus: null } | { motif: null; refus: string } {
  if (statut == null) {
    return { motif: null, refus: "Le statut de TVA du dossier est à préciser : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture." }
  }
  if (statut === "franchise") {
    return { motif: { categorie: "E", code: VATEX_FRANCHISE, texte: MENTION_FRANCHISE }, refus: null }
  }
  const exoneration = exonerationDe(article)
  if (exoneration) {
    return { motif: { categorie: "E", code: exoneration.vatex, texte: exoneration.mention }, refus: null }
  }
  return {
    motif: null,
    refus: statut === "exonere"
      ? "Le dossier est exonéré sans article d’exonération : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture à 0 %."
      : "Une ligne à 0 % d’un dossier redevable demande l’article de son exonération : choisis-le dans l’onglet TVA du dossier, ou corrige le taux.",
  }
}

function refusTauxPositif(statut: StatutTva | null, taux: number): string | null {
  if (taux <= 0) return null
  const tauxLu = `${String(taux).replace(".", ",")}\u00a0%`
  if (statut === "franchise") {
    return `Un dossier en franchise en base ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + "S’il a dépassé les seuils de la franchise, il est redevable : change son statut de TVA."
  }
  if (statut === "exonere") {
    return `Un dossier exonéré ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + "Si une partie de son activité est taxable, il est redevable, avec l’article de son exonération."
  }
  return null
}

// Ce que le statut permet de transmettre, ligne par ligne, AVANT tout appel à la plateforme : un statut à
// préciser ne transmet rien ; une ligne taxée d'un dossier qui ne facture pas de TVA se corrige par un avoir ;
// une ligne à 0 % porte le motif de son statut, ou se refuse quand on ne le connaît pas.
function motifDeLaFacture(
  statut: StatutTva | null, article: ArticleExoneration | null, taux: readonly number[],
): { motif: MotifExoneration | null; refus: null } | { motif: null; refus: string } {
  if (statut == null) return motifExoneration(null, article)
  const taxe = taux.map((t) => refusTauxPositif(statut, t)).find((r) => r != null)
  if (taxe) return { motif: null, refus: taxe }
  if (!taux.some((t) => t === 0)) return { motif: null, refus: null }
  return motifExoneration(statut, article)
}
// ── FIN STATUT TVA ──────────────────────────────────────────────────────────────────────────────

// Construit la structure EN16931 (voir doc Super PDP "Formats de facture" et les schémas OpenAPI
// seller/buyer/totals/invoice_line/vat_break_down) à partir d'une facture déjà validée dans l'app.
// Un avoir (type_code 381) est envoyé en montants positifs, comme la pratique EN16931/XP Z12-012
// habituelle — c'est le type_code qui porte le sens "note de crédit", pas le signe des montants —
// alors qu'en base ce dossier stocke ses avoirs en négatif (voir FactureAvoirModal) : on inverse donc
// le signe ici, uniquement pour cette structure d'échange, jamais en base.
function construireEnInvoice(facture: FactureRow, lignes: LigneRow[], motif: MotifExoneration | null) {
  const signe = facture.type === "avoir" ? -1 : 1
  const emetteurSiret = (facture.emetteur_siret ?? "").replace(/\s/g, "")
  const tiersSiret = (facture.tiers_siret ?? "").replace(/\s/g, "")

  const lignesEnInvoice = lignes.map((l, i) => {
    const { ht } = calculerLigneMontants(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    return {
      identifier: String(i + 1),
      item_information: { name: l.designation },
      invoiced_quantity: String(Math.abs(l.quantite)),
      // Exigé par BR-23 (EN16931) — voir CODE_UNITE_GENERIQUE.
      invoiced_quantity_code: CODE_UNITE_GENERIQUE,
      net_amount: (signe * Math.abs(ht)).toFixed(2),
      price_details: { item_net_price: Math.abs(l.prix_unitaire_ht).toFixed(2) },
      // Indispensable pour BR-S-08 (voir doc EN16931) : sans le taux de TVA propre à chaque ligne,
      // le validateur Super PDP ne peut pas rattacher son montant au bon vat_break_down ci-dessous —
      // il constate alors un total à 0 € pour la catégorie déclarée et rejette la facture.
      vat_information: {
        invoiced_item_vat_category_code: l.taux_tva === 0 ? "E" : "S",
        invoiced_item_vat_rate: l.taux_tva.toFixed(2),
      },
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
    // Le motif de la ligne à 0 % (BT-120) est celui du statut de TVA du dossier : `motifDeLaFacture` refuse la
    // facture avant d'arriver ici quand on ne le connaît pas, donc une ligne à 0 % a toujours le sien.
    ...(taux === 0 && motif ? { vat_exemption_reason: motif.texte } : {}),
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
      // Exigé par BR-S-02 dès qu'une ligne est à taux standard (voir numeroTvaFr) — omis quand la
      // facture ne comporte que des lignes exonérées (franchise en base, taux 0) : réclamer un numéro
      // de TVA sur une facture "TVA non applicable, art. 293 B du CGI" serait trompeur.
      ...(lignes.some((l) => l.taux_tva > 0) ? { vat_identifier: numeroTvaFr(siren(emetteurSiret)) } : {}),
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
  if (!resp.ok) throw new Error(`Lecture du statut Super PDP échouée (${resp.status}) : ${body?.message ?? body?.error ?? "réponse invalide"}.`)
  const evenements = (body?.events ?? []) as InvoiceEvent[]
  if (evenements.length > 0) {
    const lignes = evenements.map((e) => ({
      dossier_id: dossierId, facture_id: factureId, superpdp_event_id: e.id,
      status_code: e.status_code, status_text: e.status_text, occurred_at: e.created_at,
    }))
    // CE QUI EST RENDU VIENT DE L'API, PAS DE LA BASE : un échec d'écriture ici ne se voit donc pas
    // tout de suite — l'écran affiche les événements fraîchement lus, et c'est à la RÉOUVERTURE de
    // la modale, qui relit la table, que l'historique se révèle vide sous un statut bien présent.
    // Non bloquant (la facture est déjà partie chez la plateforme), mais journalisé : sur cette
    // fonction, le diagnostic passe par les logs de production, ce sandbox ne pouvant pas appeler
    // l'API Super PDP.
    const { error: erreurEvenements } = await admin.from("facture_superpdp_events").upsert(lignes, { onConflict: "facture_id,superpdp_event_id", ignoreDuplicates: true })
    if (erreurEvenements) {
      console.error(`[superpdp-emit] ${lignes.length} événement(s) non enregistré(s) pour la facture ${factureId} : ${erreurEvenements.message}`)
    }
  }
  const dernier = [...evenements].sort((a, b) => a.id - b.id).at(-1) ?? null
  const { error: erreurStatut } = await admin.from("factures_emises").update({ superpdp_dernier_statut: dernier?.status_code ?? null }).eq("id", factureId)
  if (erreurStatut) {
    console.error(`[superpdp-emit] statut « ${dernier?.status_code ?? "aucun"} » non écrit sur la facture ${factureId} : ${erreurStatut.message}`)
  }
  return { dernierStatut: dernier?.status_code ?? null, evenements }
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

    // Le statut de TVA du dossier décide du motif d'une ligne à 0 % et refuse ce qui ne se transmet pas — un statut à
    // préciser, une ligne taxée d'un dossier qui ne facture pas de TVA, une ligne à 0 % sans son article —, AVANT la
    // conversion, la validation et l'envoi. Illisible, il ne se devine pas : la facture ne part pas.
    const { data: tva, error: tvaError } = await admin
      .from("dossiers")
      .select("statut_tva, article_exoneration")
      .eq("id", dossierId)
      .single()
    if (tvaError || !tva) throw new Error(`Statut de TVA du dossier illisible : ${tvaError?.message ?? "dossier introuvable"}.`)
    const verdict = motifDeLaFacture(
      tva.statut_tva as StatutTva | null, tva.article_exoneration as ArticleExoneration | null, lignes.map((l) => l.taux_tva))
    if (verdict.refus) {
      console.log(`[superpdp-emit] refusée avant envoi : statut de TVA ${tva.statut_tva ?? "à préciser"}`)
      return json({ error: verdict.refus }, 400)
    }

    const enInvoice = construireEnInvoice(facture, lignes, verdict.motif)
    console.log(`[superpdp-emit] en_invoice construit : ${JSON.stringify(enInvoice)}`)

    // 1. Conversion JSON EN16931 → XML CII (endpoint public, sans authentification).
    const convertResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/invoices/convert?from=en16931&to=cii`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enInvoice),
    })
    const cii = await convertResp.text()
    console.log(`[superpdp-emit] convert status=${convertResp.status} body=${cii.slice(0, 1500)}`)
    if (!convertResp.ok) {
      throw new Error(`Conversion en CII échouée (${convertResp.status}) : ${cii.slice(0, 1500)}`)
    }

    // 2. Validation schematron officielle AVANT tout envoi réel — voir en-tête de fichier.
    const form = new FormData()
    form.append("file_name", new File([cii], `facture-${facture.numero ?? facture.id}.xml`, { type: "application/xml" }))
    const validationResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/validation_reports`, { method: "POST", body: form })
    const validationBody = await validationResp.json().catch(() => null)
    console.log(`[superpdp-emit] validation status=${validationResp.status} body=${JSON.stringify(validationBody).slice(0, 5000)}`)
    if (!validationResp.ok) {
      throw new Error(`Validation Super PDP échouée (${validationResp.status}) : ${validationBody?.message ?? validationBody?.error ?? "réponse invalide"}.`)
    }
    const rapport = validationBody?.data?.[0]
    if (rapport?.is_valid === false) {
      // is_valid vaut false dès qu'un contrôle échoue, y compris un simple avertissement (ex.
      // BR-FR-05 sur les mentions de pénalités/escompte, ou BR-FR-08 sur le mode de facturation) —
      // observé en sandbox : un rapport composé uniquement d'avertissements (flag="warning" dans
      // `raw`, ou schematron nommé "..._WARNING.xslt") est malgré tout marqué is_valid=false, alors
      // que ces règles ne sont pas bloquantes pour la transmission réelle (voir doc "Erreurs" : le
      // POST /invoices lui-même est l'arbitre final). On ne bloque donc ici que s'il reste au moins
      // un message qui n'est PAS un avertissement, jamais sur is_valid seul.
      type Msg = { message: string; raw?: string }
      const messagesBloquants = ((rapport.subreports ?? []) as { messages?: Msg[]; failures?: Msg[] }[])
        .flatMap((s) => [...(s.failures ?? []), ...(s.messages ?? [])])
        .filter((m) => !m.raw?.includes('flag="warning"'))
        .map((m) => m.message)
      if (messagesBloquants.length > 0) {
        return json({ error: `Facture non conforme selon le validateur Super PDP : ${[...new Set(messagesBloquants)].slice(0, 5).join(" ; ")}` }, 400)
      }
      console.log(`[superpdp-emit] validation is_valid=false mais uniquement des avertissements — envoi maintenu`)
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
      // Super PDP renvoie {http_status_code, message} sur erreur (pas {error}) — d'où le repli
      // "réponse invalide" observé tant que seul .error était lu, alors que .message contenait déjà
      // la vraie raison (ex. "pre-check: receiver address <...> does not accept this document").
      throw new Error(`Envoi Super PDP échoué (${sendResp.status}) : ${sendBody?.message ?? sendBody?.error ?? "réponse invalide"}.`)
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
