// Edge Function : émission de factures de vente via Super PDP (plateforme de dématérialisation
// partenaire agréée DGFiP, https://www.superpdp.tech) — complète superpdp-sync (dédié à la
// réception) et réutilise les mêmes identifiants OAuth2 par dossier (voir superpdp-credentials).
// La plateforme agréée du CLIENT, elle, reçoit ses factures par plateforme-agreee (« deposer ») : les
// deux canaux transmettent le MÊME fichier, et une seule transmission active par facture les tient.
//
// Flux d'émission (ligne 28.5 de la feuille de route, étape c) :
// 1. Relire la facture validée, ses lignes, le statut de TVA du dossier et, pour un avoir, la facture
//    qu'il corrige, puis la juger (`refusEmission`) AVANT tout appel : ce qui empêche de la transmettre
//    se dit tout ensemble, et rien ne part.
// 2. L'écrire en CII par le générateur de l'application (blocs recopiés de src/lib : montantsFacture,
//    statutTva, factureCii) — le fichier que factureCii.test.ts fait juger par le validateur officiel de
//    la norme EN 16931. Super PDP ne convertit plus rien : ce qui part est ce que les tests ont jugé.
// 3. Le faire valider par le schematron de Super PDP (POST /validation_reports) AVANT tout envoi réel —
//    un envoi une fois transmis part réellement vers le client, aucune annulation possible (seul un
//    avoir corrige). Mieux vaut un rejet synchrone et clair ici qu'un rejet découvert bien plus tard.
// 4. Réserver la transmission (transmissions_factures, canal superpdp) : une seule active par facture,
//    tous canaux confondus — ni deux clics ni un dépôt par la plateforme du client ne la transmettent
//    deux fois.
// 5. Transmettre (POST /invoices) — retourne un id Super PDP, mis en file d'attente asynchrone. Une
//    issue inconnue (pas de réponse, un 5xx, un 2xx sans id) laisse la transmission « envoi » : la
//    facture est peut-être partie, et repartir la transmettrait deux fois.
// 6. Relire le statut (GET /invoices/{id}) juste après l'envoi, et à la demande ensuite (action
//    "actualiser") — l'historique complet des invoice_events est conservé (voir migration
//    superpdp_emission_factures). L'envoi initial (200 OK) ne dit rien du sort réel de la facture.
//
// Deux actions (voir payload.action) :
// - "envoyer" : juge, écrit, valide, réserve et transmet une facture validée pas encore transmise.
// - "actualiser" : relit le statut d'une facture déjà transmise et met à jour son historique.
//
// Qui peut quoi (`QUI_PEUT_QUOI`, espace client, étape P3) : les deux actions au cabinet du dossier et au client dont
// l'accès porte la case « Ventes », lus avec le jeton de l'appelant (bloc droitsDeLAppelant) avant toute lecture de la
// facture et des identifiants ; la transmission réservée garde le compte qui l'a demandée (`cree_par`).
//
// Les journaux ne portent ni le fichier transmis ni la raison d'un refus, qui revient à l'écran du
// cabinet : des codes de retour, des nombres et, pour une erreur inattendue, son message.

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

/** Un champ du corps qui se lit comme un texte : un texte, ou rien (absent, nul — « requis » le refuse ensuite). */
function texteOuAbsent(valeur: unknown): valeur is string | null | undefined {
  return valeur == null || typeof valeur === "string"
}

// QUI PEUT QUOI (conception de l'espace client, §3.5) : le droit que chaque action exige — « ventes », le cabinet du
// dossier ou un accès client qui porte la case « Ventes » ; « cabinet », le cabinet seul. Un changement de décision est
// une ligne.
const QUI_PEUT_QUOI: Readonly<Record<string, DroitExige>> = {
  envoyer: "ventes",
  actualiser: "ventes",
}

// La facture telle que le générateur la lit, avec l'émetteur qu'elle a figé, la facture qu'un avoir corrige et son
// identifiant chez Super PDP.
const COLONNES_FACTURE = "id, numero, statut, type, facture_origine_id, date_emission, date_echeance, tiers_nom, tiers_adresse, " +
  "tiers_siret, montant_ht, montant_tva, montant_ttc, mentions_legales, type_client, tiers_siren, " +
  "tiers_adresse_electronique, code_service, numero_engagement, nature_operation, date_prestation, periode_debut, " +
  "periode_fin, livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays, option_debits, emetteur_nom, " +
  "emetteur_siret, emetteur_adresse, superpdp_invoice_id"
type FactureLue = FactureEnBase & { id: string; facture_origine_id: string | null; superpdp_invoice_id: number | null }
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

// ── DÉBUT ENVOI ─────────────────────────────────────────────────────────────────────────────────
// Ce que la réponse de Super PDP à l'envoi (POST /v1.beta/invoices) permet de dire. Un 2xx qui rend un id entier est
// un envoi. Un refus 4xx n'a rien envoyé : Super PDP rend alors {http_status_code, message}, et ce message est la
// raison que le cabinet doit lire (une adresse de destinataire qui n'accepte pas ce document, par exemple) — il est
// repris, nettoyé et borné, sur la transmission et dans la réponse à l'écran, jamais dans les journaux. Tout le reste —
// pas de réponse, une réponse coupée, un 5xx, un 2xx sans id — laisse l'issue INCONNUE : la transmission reste
// « envoi », et la facture ne repart pas sans qu'on ait vérifié sur Super PDP qu'elle n'y est pas.
const HOTE_SUPERPDP = "api.superpdp.tech"
const DELAI_ENVOI_MS = 25_000

/** Le jour à Paris : une facture ne se date pas dans l'avenir, et la fonction tourne en UTC. */
function dateDeParis(ms: number): string {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms))
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ""
  return `${partie("year")}-${partie("month")}-${partie("day")}`
}

async function empreinteSha256(octets: Uint8Array<ArrayBuffer>): Promise<string> {
  const condensat = new Uint8Array(await crypto.subtle.digest("SHA-256", octets))
  return [...condensat].map((o) => o.toString(16).padStart(2, "0")).join("")
}

function messageDeSuperPdp(corps: unknown): string | null {
  const brut = corps as { message?: unknown; error?: unknown } | null
  const valeur = typeof brut?.message === "string" ? brut.message : typeof brut?.error === "string" ? brut.error : null
  if (valeur === null) return null
  const net = valeur.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim()
  return net === "" ? null : net.slice(0, 300)
}

function issueDeLEnvoi(statut: number, corps: unknown):
  | { etat: "depose"; id: number; detail: null }
  | { etat: "echec" | "envoi"; detail: string } {
  if (statut >= 200 && statut < 300) {
    const id = (corps as { id?: unknown } | null)?.id
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return { etat: "depose", id, detail: null }
    return {
      etat: "envoi",
      detail: `Super PDP a répondu ${statut} sans identifiant de facture : elle est peut-être partie. Vérifiez sur Super PDP avant toute nouvelle tentative.`,
    }
  }
  if (statut >= 400 && statut < 500) {
    const message = messageDeSuperPdp(corps)
    return { etat: "echec", detail: `Super PDP a refusé la facture (${statut})${message ? ` : ${message}` : ""}. Rien n'a été envoyé.` }
  }
  return {
    etat: "envoi",
    detail: `${statut === 0 ? "Super PDP n'a pas répondu à temps" : `Super PDP a répondu ${statut}`} : la facture est peut-être ` +
      "partie. Vérifiez sur Super PDP avant toute nouvelle tentative.",
  }
}
// ── FIN ENVOI ───────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT SUIVI ─────────────────────────────────────────────────────────────────────────────────
// Ce que l'historique d'une facture chez Super PDP dit de sa transmission. Les codes « fr: » sont ceux que publient les
// spécifications externes de la DGFiP : le statut d'une facture (§ 3.6.4, tableau 8) — 213 « Rejetée », un contrôle de
// la plateforme d'émission ou de réception a trouvé une anomalie ; 202 « Reçue par la plateforme » du destinataire, et
// tout ce qui la suit — et celui d'un flux (§ 3.4.4, tableau 2) : 501 « Irrecevable ». Un rejet rend la transmission
// REJETÉE ; une réception la rend ACCEPTÉE, et ce qu'en fait l'acheteur (approuvée, refusée, encaissée) se lit dans
// l'historique, pas sur elle. Un code propre à Super PDP ne décide que s'il est sans ambiguïté : « api:invalid », la
// facture rejetée avant l'envoi. Tout le reste — déposée, émise, un code inconnu — la laisse déposée.
const REJETS_SUPERPDP = new Set(["fr:213", "fr:501", "api:invalid"])
const RECEPTIONS_SUPERPDP = new Set([
  "fr:202", "fr:203", "fr:204", "fr:205", "fr:206", "fr:207", "fr:208", "fr:209", "fr:210", "fr:211", "fr:212",
])

function suiteDeLHistorique(evenements: { id: number; status_code: string; status_text: string }[]):
  { etat: "accepte" | "rejete"; detail: string | null } | null {
  const tries = [...evenements].sort((a, b) => a.id - b.id)
  // Un rejet l'emporte sur une réception, quel que soit leur ordre : une facture rejetée s'annule par un avoir interne.
  const rejet = tries.find((e) => REJETS_SUPERPDP.has(e.status_code))
  if (rejet) {
    const texte = typeof rejet.status_text === "string"
      ? rejet.status_text.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300)
      : ""
    return { etat: "rejete", detail: `Super PDP : ${rejet.status_code}${texte ? ` — ${texte}` : ""}.` }
  }
  return tries.some((e) => RECEPTIONS_SUPERPDP.has(e.status_code)) ? { etat: "accepte", detail: null } : null
}
// ── FIN SUIVI ───────────────────────────────────────────────────────────────────────────────────

// Les trois types que les blocs du générateur nomment, déclarés comme src/lib/types.ts les déclare
// (copiesFacturation.test.ts le vérifie).
type StatutTva = 'redevable' | 'franchise' | 'exonere'
type ArticleExoneration = 'cgi_261_4_1' | 'cgi_261_4_4_a' | 'cgi_261_4_4_b' | 'cgi_261_c_2'
type NatureOperation = 'biens' | 'services' | 'mixte'

// ── DÉBUT COPIE montantsFacture ──────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) : elles sont auto-portées, et le générateur de la facture électronique, qu'elles recopient aussi,
// en dépend. `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute seule.

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// Au centime, le demi ÉLOIGNÉ DE ZÉRO, dans les deux sens. `Math.round` arrondit le demi vers +∞ : une ligne d'avoir
// à -0,125 € valait -0,12 € quand la même ligne d'une facture vaut 0,13 €. L'avoir, relu dans son sens par le
// générateur de la facture électronique (un avoir de la norme porte des montants positifs), ne retrouvait plus les
// montants qu'on avait enregistrés, et ne se transmettait pas. Un montant positif s'arrondit exactement comme avant.
function auCentime(x: number): number {
  const c = Math.round(Math.abs(x) * 100) / 100
  return c === 0 ? 0 : x < 0 ? -c : c
}

// Arrondi à 2 décimales systématique — chaque ligne est arrondie avant d'être sommée (comme le ferait
// n'importe quel logiciel de facturation), plutôt que de sommer des valeurs flottantes brutes puis
// arrondir le total : les deux méthodes peuvent différer d'un centime sur certains taux de TVA.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  const ht = auCentime(quantite * prixUnitaireHt)
  const tva = auCentime(ht * (tauxTva / 100))
  return { montant_ht: ht, montant_tva: tva, montant_ttc: auCentime(ht + tva) }
}
// ── FIN COPIE montantsFacture ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE statutTva ────────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) : le générateur de la facture électronique, qu'elles recopient aussi, en tire le motif d'une
// ligne à 0 % et le refus d'une ligne taxée. `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute.

export interface Exoneration {
  code: ArticleExoneration
  // Ce que l'article exonère, pour la liste de choix.
  objet: string
  // La disposition, telle qu'une facture la cite.
  reference: string
  // La mention de la facture : la référence de la disposition qui exonère (CGI, ann. II, art. 242 nonies A).
  mention: string
  // Le code du motif d'exonération (BT-121 de la norme EN 16931), dans la liste VATEX que la France a complétée. La
  // facture électronique (factureCii.ts) transmet le code ET le texte, et le validateur officiel de la norme les accepte.
  vatex: string
}

// La liste fermée de la base (`dossiers_article_exoneration_check`) : `statutTva.test.ts` la confronte à la
// migration exportée. Un article qui n'y est pas se saisit à la main sur la facture.
export const EXONERATIONS: readonly Exoneration[] = [
  {
    code: 'cgi_261_4_1',
    objet: 'Soins dispensés par les professions médicales et paramédicales',
    reference: 'art. 261, 4, 1° du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 1° du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_4_4_a',
    objet: 'Enseignement scolaire ou universitaire, formation professionnelle continue',
    reference: 'art. 261, 4, 4° a du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 4° a du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_4_4_b',
    objet: 'Cours particuliers donnés par une personne physique à ses élèves',
    reference: 'art. 261, 4, 4° b du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 4° b du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_c_2',
    objet: 'Assurance et réassurance, courtage et intermédiation en assurance',
    reference: 'art. 261 C, 2° du CGI',
    mention: 'Exonération de TVA, art. 261 C, 2° du CGI.',
    vatex: 'VATEX-FR-CGI261C-2',
  },
]

export function exonerationDe(article: ArticleExoneration | null): Exoneration | null {
  return article == null ? null : EXONERATIONS.find((e) => e.code === article) ?? null
}

export const MENTION_FRANCHISE = 'TVA non applicable, art. 293 B du CGI.'
export const VATEX_FRANCHISE = 'VATEX-FR-FRANCHISE'

export interface MotifExoneration {
  // La catégorie de TVA de la ligne (BT-151) : E, exonérée — la franchise en base comprise, dans la norme.
  categorie: 'E'
  code: string
  texte: string
}

// Le motif d'une ligne à 0 % qu'on transmet à une plateforme (BT-120, BT-121), ou la raison de ne pas la
// transmettre : un motif faux part dans une facture que l'administration reçoit, et ne se reprend que par un avoir.
export function motifExoneration(
  statut: StatutTva | null, article: ArticleExoneration | null,
): { motif: MotifExoneration; refus: null } | { motif: null; refus: string } {
  if (statut == null) {
    return { motif: null, refus: 'Le statut de TVA du dossier est à préciser : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture.' }
  }
  if (statut === 'franchise') {
    return { motif: { categorie: 'E', code: VATEX_FRANCHISE, texte: MENTION_FRANCHISE }, refus: null }
  }
  const exoneration = exonerationDe(article)
  if (exoneration) {
    return { motif: { categorie: 'E', code: exoneration.vatex, texte: exoneration.mention }, refus: null }
  }
  return {
    motif: null,
    refus: statut === 'exonere'
      ? 'Le dossier est exonéré sans article d’exonération : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture à 0 %.'
      : 'Une ligne à 0 % d’un dossier redevable demande l’article de son exonération : choisis-le dans l’onglet TVA du dossier, ou corrige le taux.',
  }
}

// Une ligne qui porte de la TVA sur la facture d'un dossier qui n'en facture pas. Toute personne qui mentionne la
// TVA sur une facture en devient redevable du seul fait de l'avoir facturée (CGI, art. 283, 3) : c'est une
// facture à corriger par un avoir, pas à transmettre.
export function refusTauxPositif(statut: StatutTva | null, taux: number): string | null {
  if (taux <= 0) return null
  const tauxLu = `${String(taux).replace('.', ',')}\u00a0%`
  if (statut === 'franchise') {
    return `Un dossier en franchise en base ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + 'S’il a dépassé les seuils de la franchise, il est redevable : change son statut de TVA.'
  }
  if (statut === 'exonere') {
    return `Un dossier exonéré ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + 'Si une partie de son activité est taxable, il est redevable, avec l’article de son exonération.'
  }
  return null
}
// ── FIN COPIE statutTva ──────────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE factureCii ───────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee), après ceux de montantsFacture.ts et de statutTva.ts : elles sont auto-portées, et ce qu'elles
// transmettent doit être le fichier que les tests de ce module ont passé au validateur officiel. Il ne nomme rien
// d'autre hors de lui que trois types, que chaque fonction déclare comme types.ts les déclare (StatutTva,
// ArticleExoneration, NatureOperation). `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute.

export const PROFIL_EN16931 = 'urn:cen.eu:en16931:2017'

// L'unité « pièce » de la recommandation 20 de la CEE-ONU : l'application ne distingue pas encore les unités par ligne
// (une heure, un kilogramme), et la règle BR-23 en exige une sur chaque ligne.
export const UNITE_GENERIQUE = 'C62'

// Les taux que la DGFiP admet (règle G1.24), en pour cent.
export const TAUX_ADMIS: readonly number[] = [0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6]

// L'adresse électronique d'une partie dans l'annuaire de la facturation électronique : le schéma « FRCTC electronic
// address » (0225 de la liste ISO 6523, que l'annexe 7 de la DGFiP ajoute), dont la valeur est le SIREN, puis au besoin
// le SIRET, un code de routage ou un suffixe, séparés par « _ » (règles G1.93, G1.95 et G1.115).
export const SCHEMA_ADRESSE_ELECTRONIQUE = '0225'
const SCHEMA_SIREN = '0002'
const SCHEMA_SIRET = '0009'

const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const

export interface VendeurCii {
  // L'identité de l'émetteur, telle que la facture l'a figée à sa validation (emetteur_nom, emetteur_siret,
  // emetteur_adresse) — jamais celle d'aujourd'hui.
  nom: string | null
  siret: string | null
  adresse: string | null
  // Le numéro de TVA intracommunautaire du dossier (BT-31). Celui d'un dossier redevable se calcule sur son SIREN
  // (`numeroTvaFrancais`) ; un dossier en franchise ou exonéré n'en a pas toujours un : il se calcule de même quand le
  // cabinet a dit qu'il en a un (`numero_tva_attribue`), et le module ne l'invente jamais.
  numeroTva: string | null
  // Le cabinet a dit que ce dossier en franchise ou exonéré a un numéro de TVA (la case de l'onglet TVA) : s'il manque
  // encore, c'est qu'il ne se calcule pas, et ce n'est plus la case qui se réclame.
  numeroTvaAttribue: boolean
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
}

export interface OrigineCii {
  numero: string | null
  date_emission: string
}

// Une ligne de la facture (`facture_lignes`), telle que le générateur la lit.
export interface LigneCii {
  ordre: number
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
}

// La facture (`factures_emises`), telle que le générateur la lit : les colonnes dont il se sert, sous leurs types en
// base. FactureEmise (types.ts) en porte d'autres, et le compilateur vérifie qu'elle se lit comme celle-ci
// (copiesFacturation.test.ts) : une valeur ajoutée à l'une de ses listes fermées ne passerait pas ici en silence.
export interface FactureCii {
  numero: string | null
  statut: 'brouillon' | 'validee'
  type: 'facture' | 'avoir'
  date_emission: string
  date_echeance: string | null
  tiers_nom: string
  tiers_adresse: string | null
  tiers_siret: string | null
  montant_ht: number
  montant_tva: number
  montant_ttc: number
  mentions_legales: string | null
  type_client: 'assujetti' | 'organisme_public' | 'non_assujetti' | 'etranger' | null
  tiers_siren: string | null
  tiers_adresse_electronique: string | null
  code_service: string | null
  numero_engagement: string | null
  nature_operation: NatureOperation | null
  date_prestation: string | null
  periode_debut: string | null
  periode_fin: string | null
  livraison_adresse: string | null
  livraison_code_postal: string | null
  livraison_ville: string | null
  livraison_pays: string | null
  option_debits: boolean | null
}

export interface DonneesCii {
  facture: FactureCii
  lignes: LigneCii[]
  vendeur: VendeurCii
  // La facture qu'un avoir corrige (règles BR-55 et G1.31 : son numéro, et sa date).
  origine: OrigineCii | null
  // AAAA-MM-JJ : une facture ne se date pas dans l'avenir (règle G1.07).
  aujourdHui: string
}

// ── Identifiants ───────────────────────────────────────────────────────────────────────────────────────────────────

// La clé de Luhn : le dernier chiffre d'un SIREN ou d'un SIRET contrôle les autres (INSEE). Elle attrape la faute de
// frappe que l'annuaire refuserait — après la transmission, et sans dire laquelle.
function luhn(chiffres: string): boolean {
  let somme = 0
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    somme += d
  }
  return somme % 10 === 0
}

export function sirenValide(siren: string | null | undefined): siren is string {
  return siren != null && /^\d{9}$/.test(siren) && luhn(siren)
}

// Les établissements de La Poste (SIREN 356000000), trop nombreux pour la clé de Luhn, ont un SIRET dont la somme des
// chiffres est un multiple de 5 (INSEE) ; son siège (35600000000048) garde la clé de Luhn.
const SIEGE_DE_LA_POSTE = '35600000000048'

export function siretValide(siret: string | null | undefined): siret is string {
  if (siret == null || !/^\d{14}$/.test(siret)) return false
  if (siret.startsWith('356000000') && siret !== SIEGE_DE_LA_POSTE) {
    return [...siret].reduce((s, c) => s + Number(c), 0) % 5 === 0
  }
  return luhn(siret)
}

export function sirenDe(siret: string | null | undefined): string | null {
  const chiffres = (siret ?? '').replace(/\s/g, '')
  return /^\d{9}(\d{5})?$/.test(chiffres) ? chiffres.slice(0, 9) : null
}

// Le numéro de TVA intracommunautaire français d'une entreprise : FR, une clé de deux chiffres, le SIREN (CGI, art. 286
// ter ; clé = (12 + 3 × (SIREN modulo 97)) modulo 97).
export function numeroTvaFrancais(siren: string): string {
  const cle = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(cle).padStart(2, '0')}${siren}`
}

// ── Adresse ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdresseStructuree {
  lignes: string[]
  codePostal: string | null
  ville: string | null
}

// Une adresse saisie en texte libre, rangée dans les champs de la norme (BT-35 à BT-38) : la ligne qui commence par un
// code postal français de cinq chiffres donne le code postal et la ville, les autres sont les lignes de l'adresse.
// Une adresse sur une seule ligne qui finit par « , 75001 Paris » se lit de même. Rien d'autre n'est interprété : sans
// code postal reconnu, tout reste dans les lignes, telles qu'écrites.
export function adresseStructuree(texte: string | null): AdresseStructuree {
  let lignes = (texte ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
  if (lignes.length === 1) {
    const m = /^(.+?),\s*(\d{5}\s+\S.*)$/.exec(lignes[0])
    if (m) lignes = [m[1].trim(), m[2].trim()]
  }
  for (let i = lignes.length - 1; i >= 0; i--) {
    const m = /^(\d{5})\s+(\S.*)$/.exec(lignes[i])
    if (m) return { lignes: lignes.filter((_, j) => j !== i), codePostal: m[1], ville: m[2] }
  }
  return { lignes, codePostal: null, ville: null }
}

// ── Lignes et montants ─────────────────────────────────────────────────────────────────────────────────────────────

export type CategorieTva = 'S' | 'E'

export interface LigneDocument {
  numero: number
  libelle: string
  // Dans le sens du document : positives sur une facture comme sur un avoir, sauf une remise, négative.
  quantite: number
  prix: number
  taux: number
  categorie: CategorieTva
  htCentimes: number
  tvaCentimes: number
}

export interface GroupeTva {
  categorie: CategorieTva
  taux: number
  baseCentimes: number
  tvaCentimes: number
  codeMotif: string | null
  motif: string | null
}

export interface MontantsDocument {
  lignes: LigneDocument[]
  groupes: GroupeTva[]
  htCentimes: number
  tvaCentimes: number
  ttcCentimes: number
}

const centimes = (euros: number) => Math.round(euros * 100)

// La ligne dans le sens du document. Le prix d'une ligne de la norme n'est jamais négatif (règle BR-27, G1.16) : une
// remise saisie avec un prix négatif se transmet avec une quantité négative, au même produit — donc au même montant,
// au bit près, puisque le produit de deux flottants ne dépend pas de leurs signes.
export function montantsDuDocument(facture: Pick<FactureCii, 'type'>, lignes: LigneCii[], motif: { code: string; texte: string } | null): MontantsDocument {
  const sens = facture.type === 'avoir' ? -1 : 1
  const triees = [...lignes].sort((a, b) => a.ordre - b.ordre)
  const doc: LigneDocument[] = triees.map((l, i) => {
    let quantite = l.quantite * sens
    let prix = l.prix_unitaire_ht
    if (prix < 0) {
      quantite = -quantite
      prix = -prix
    }
    const c = calculerLigne(quantite, prix, l.taux_tva)
    return {
      numero: i + 1,
      libelle: l.designation,
      quantite: quantite === 0 ? 0 : quantite,
      prix,
      taux: l.taux_tva,
      categorie: l.taux_tva > 0 ? 'S' : 'E',
      htCentimes: centimes(c.montant_ht),
      tvaCentimes: centimes(c.montant_tva),
    }
  })
  const groupes: GroupeTva[] = []
  for (const l of doc) {
    let g = groupes.find((x) => x.categorie === l.categorie && x.taux === l.taux)
    if (!g) {
      g = {
        categorie: l.categorie,
        taux: l.taux,
        baseCentimes: 0,
        tvaCentimes: 0,
        codeMotif: l.categorie === 'E' ? motif?.code ?? null : null,
        motif: l.categorie === 'E' ? motif?.texte ?? null : null,
      }
      groupes.push(g)
    }
    g.baseCentimes += l.htCentimes
    g.tvaCentimes += l.tvaCentimes
  }
  // Dans un ordre qui ne dépend pas de la saisie : les taux du plus fort au plus faible.
  groupes.sort((a, b) => b.taux - a.taux)
  const htCentimes = doc.reduce((s, l) => s + l.htCentimes, 0)
  const tvaCentimes = doc.reduce((s, l) => s + l.tvaCentimes, 0)
  return { lignes: doc, groupes, htCentimes, tvaCentimes, ttcCentimes: htCentimes + tvaCentimes }
}

// ── Ce qui empêche de transmettre ──────────────────────────────────────────────────────────────────────────────────

// Un nombre décimal écrit sans exposant, avec au plus `decimales` chiffres après le point ; null s'il en porte plus, ou
// s'il ne s'écrit pas exactement — infini, ou au-delà de 2^53 unités de sa dernière décimale, où un nombre à virgule
// flottante ne dit plus ses derniers chiffres : `Number.isSafeInteger` écarte les deux. Les quantités admettent quatre
// décimales (G1.15), les prix six (G1.16).
export function decimal(x: number, decimales: number): string | null {
  const f = 10 ** decimales
  const entier = Math.round(x * f)
  if (!Number.isSafeInteger(entier) || Math.abs(x * f - entier) > 1e-6) return null
  const a = Math.abs(entier)
  const fraction = String(a % f).padStart(decimales, '0').replace(/0+$/, '')
  return `${entier < 0 ? '-' : ''}${Math.floor(a / f)}${fraction ? `.${fraction}` : ''}`
}

// Une date AAAA-MM-JJ écrite JJ/MM/AAAA, comme l'écrit formatDate (format.ts), que le bloc ne peut pas nommer ;
// une valeur d'une autre forme est rendue telle quelle.
function dateLisible(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso
}

const NUMERO_ADMIS = /^[A-Za-z0-9 +_/-]{1,35}$/
const BORNES = '(années 2000 à 2099)'

// Le numéro d'une facture (G1.05) : 35 caractères au plus, chiffres, lettres, espace, « - », « + », « _ » et « / »,
// sans espace en tête, en fin ni doublé.
export function numeroAdmis(numero: string): boolean {
  return NUMERO_ADMIS.test(numero) && numero.trim() === numero && !numero.includes('  ')
}

const ADRESSE_ELECTRONIQUE = /^\d{9}(_[A-Za-z0-9._-]+(_[A-Za-z0-9_-]+)?)?$/

// Une année de 2000 à 2099, dans toute date que la facture transmet (règle G1.36).
function anneeAdmise(date: string): boolean {
  const annee = Number(date.slice(0, 4))
  return annee >= 2000 && annee <= 2099
}

// Les codes d'exonération qui sortent une facture entre entreprises de la facturation électronique (règle G2.32) :
// une facture qui ne porte QUE des opérations exonérées par les articles 261 à 261 E ne se transmet pas — sauf à un
// organisme public, que la règle excepte. La règle en énumère dix-neuf, et ce sont exactement les codes de la liste
// VATEX qui commencent ainsi (artefacts de validation 1.3.16) : le préfixe ne désigne rien d'autre.
function exonerationHorsChamp(code: string | null): boolean {
  return code != null && code.startsWith('VATEX-FR-CGI261')
}

// Tout ce qui empêche de transmettre la facture, dans l'ordre où l'écran le dit ; vide quand elle peut partir.
export function refusEmission(d: DonneesCii): string[] {
  const { facture: f, vendeur: v } = d
  const refus: string[] = []

  if (f.statut !== 'validee' || !f.numero) return ['Seule une facture validée se transmet.']
  if (!numeroAdmis(f.numero)) {
    refus.push(`Le numéro ${f.numero} ne peut pas être transmis : 35 caractères au plus — chiffres, lettres, espace, « - », « + », « _ » et « / ».`)
  }
  if (!anneeAdmise(f.date_emission)) refus.push(`La date d’émission (${dateLisible(f.date_emission)}) n’est pas une date admise ${BORNES}.`)
  else if (f.date_emission > d.aujourdHui) refus.push(`La facture est datée du ${dateLisible(f.date_emission)}, qui n’est pas encore arrivé.`)

  // Le destinataire. Un particulier et un client établi hors de France ne reçoivent pas de facture électronique :
  // l'opération se déclare par l'e-reporting.
  switch (f.type_client) {
    case null:
      refus.push('Dis à qui la facture est adressée : une entreprise assujettie, ou un organisme public.')
      break
    case 'non_assujetti':
      refus.push('Une facture à un particulier ne passe pas par la plateforme : l’opération se déclare par l’e-reporting.')
      break
    case 'etranger':
      refus.push('Une facture à un client établi hors de France ne passe pas par la plateforme : l’opération se déclare par l’e-reporting.')
      break
  }
  const versEntreprise = f.type_client === 'assujetti' || f.type_client === 'organisme_public'

  if (f.nature_operation == null) {
    refus.push('Dis si la facture porte sur des livraisons de biens, des prestations de services, ou les deux.')
  }

  // Le vendeur.
  const sirenVendeur = sirenDe(v.siret)
  if (!v.nom?.trim()) refus.push('Le nom du dossier manque à la facture.')
  if (!sirenValide(sirenVendeur)) refus.push('Le SIRET du dossier, figé sur la facture, ne donne pas un SIREN valide (neuf chiffres et leur clé).')
  if (!v.adresse?.trim()) refus.push('L’adresse du dossier manque à la facture.')

  // Le client.
  if (versEntreprise) {
    if (!f.tiers_nom.trim()) refus.push('Le nom du client manque.')
    if (!sirenValide(f.tiers_siren)) refus.push('Le SIREN du client manque ou ne passe pas sa clé de contrôle.')
    if (!f.tiers_adresse?.trim()) refus.push('L’adresse du client manque.')
    const siret = f.tiers_siret?.replace(/\s/g, '') ?? null
    if (f.type_client === 'organisme_public' && !siret) {
      refus.push('Un organisme public se désigne par son SIRET (Chorus Pro) : indique celui du service destinataire.')
    }
    // Ce qui découle du SIREN ne se juge que sur un SIREN valide : son refus est déjà dit, et le redire sous une autre
    // forme ferait chercher deux fautes là où il n'y en a qu'une.
    if (siret) {
      if (!siretValide(siret)) refus.push('Le SIRET du client ne passe pas sa clé de contrôle.')
      else if (sirenValide(f.tiers_siren) && !siret.startsWith(f.tiers_siren)) refus.push('Le SIRET du client ne commence pas par son SIREN.')
    }
    const adresse = f.tiers_adresse_electronique
    if (adresse != null && !ADRESSE_ELECTRONIQUE.test(adresse)) {
      refus.push('L’adresse de facturation électronique du client n’a pas la forme que l’annuaire publie : SIREN, SIREN_SIRET ou SIREN_suffixe.')
    } else if (adresse != null && sirenValide(f.tiers_siren) && !adresse.startsWith(f.tiers_siren)) {
      refus.push('L’adresse de facturation électronique du client ne commence pas par son SIREN.')
    }
  }

  // La TVA, ligne par ligne.
  const motifConnu = motifExoneration(v.statutTva, v.articleExoneration)
  if (v.statutTva == null && motifConnu.refus) refus.push(motifConnu.refus)
  const triees = [...d.lignes].sort((a, b) => a.ordre - b.ordre)
  if (triees.length === 0) refus.push('La facture n’a aucune ligne.')
  const motifs = new Set<string>()
  triees.forEach((l, i) => {
    const n = i + 1
    if (!l.designation.trim()) refus.push(`Ligne ${n} : sa désignation manque.`)
    if (decimal(l.quantite, 4) == null) refus.push(`Ligne ${n} : la quantité ne s’écrit pas avec quatre décimales au plus.`)
    if (decimal(Math.abs(l.prix_unitaire_ht), 6) == null) refus.push(`Ligne ${n} : le prix ne s’écrit pas avec six décimales au plus.`)
    if (!TAUX_ADMIS.includes(l.taux_tva)) {
      refus.push(`Ligne ${n} : le taux de ${String(l.taux_tva).replace('.', ',')} % n’est pas un taux de TVA admis.`)
    } else if (l.taux_tva > 0) {
      const r = refusTauxPositif(v.statutTva, l.taux_tva)
      if (r) refus.push(`Ligne ${n} : ${r}`)
    } else if (v.statutTva != null && motifConnu.refus) {
      motifs.add(motifConnu.refus)
    }
  })
  for (const m of motifs) refus.push(m)

  const motif = motifConnu.motif ? { code: motifConnu.motif.code, texte: motifConnu.motif.texte } : null
  const m = montantsDuDocument(f, triees, motif)
  const sens = f.type === 'avoir' ? -1 : 1
  if (triees.length > 0) {
    if (m.ttcCentimes <= 0) {
      refus.push(f.type === 'avoir'
        ? 'Un avoir crédite un montant : son total doit être positif.'
        : 'Le total de la facture n’est pas positif : un montant à rendre au client se fait par un avoir.')
    }
    if (centimes(sens * f.montant_ht) !== m.htCentimes || centimes(sens * f.montant_tva) !== m.tvaCentimes
      || centimes(sens * f.montant_ttc) !== m.ttcCentimes) {
      refus.push('Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes : elle ne peut pas être transmise telle quelle.')
    }
  }

  // Entre entreprises, une facture qui ne porte que des opérations exonérées par l'article 261 sort du champ (G2.32) :
  // c'est alors tout ce qu'il y a à dire, et réclamer le numéro de TVA du dossier laisserait croire qu'il suffirait.
  const horsChamp = f.type_client === 'assujetti' && m.groupes.length > 0
    && m.groupes.every((g) => g.categorie === 'E' && exonerationHorsChamp(g.codeMotif))
  if (horsChamp) {
    refus.push('Une facture dont toutes les opérations sont exonérées par les articles 261 à 261 E du CGI n’entre pas dans la facturation électronique entre entreprises.')
  }

  // Une ligne à 0 % ou au taux normal demande le numéro de TVA du vendeur (règles BR-S-02, BR-E-02, G1.47). Celui d'un
  // dossier redevable découle de son SIREN, comme celui d'un dossier en franchise ou exonéré dont le cabinet a dit qu'il
  // en a un, et un statut à préciser se dit déjà : un numéro absent ne se réclame que s'il ne découle pas d'une faute
  // déjà dite.
  if (triees.length > 0 && !horsChamp) {
    if (!v.numeroTva) {
      if ((v.statutTva === 'franchise' || v.statutTva === 'exonere') && !v.numeroTvaAttribue) {
        refus.push('Le numéro de TVA intracommunautaire du dossier est nécessaire à une facture sans TVA (règle G1.47 de la DGFiP) : '
          + 's’il en a un, sa case se coche dans l’onglet TVA du dossier, sous son statut de TVA.')
      } else if (v.statutTva !== null && sirenValide(sirenVendeur)) {
        refus.push('Le numéro de TVA intracommunautaire du dossier manque.')
      }
    } else if (sirenValide(sirenVendeur) && v.numeroTva !== numeroTvaFrancais(sirenVendeur)) {
      refus.push('Le numéro de TVA intracommunautaire du dossier ne correspond pas à son SIREN.')
    }
  }

  // Ce que la facture doit dire du paiement et de l'opération.
  if (f.type === 'facture' && !f.date_echeance) {
    refus.push('Indique la date d’échéance : la facture porte la date à laquelle le règlement doit intervenir (art. L441-9 du code de commerce).')
  }
  if (f.type === 'facture' && f.date_echeance && !anneeAdmise(f.date_echeance)) refus.push(`La date d’échéance n’est pas une date admise ${BORNES}.`)
  if (f.type === 'avoir') {
    if (!d.origine || !d.origine.numero) refus.push('L’avoir doit citer la facture qu’il corrige.')
    else {
      // La facture corrigée se transmet par son numéro et sa date (BT-25, BT-26) : les mêmes règles que les siens.
      if (!numeroAdmis(d.origine.numero)) refus.push(`Le numéro de la facture corrigée (${d.origine.numero}) ne peut pas être transmis.`)
      if (!anneeAdmise(d.origine.date_emission)) refus.push(`La date de la facture corrigée n’est pas une date admise ${BORNES}.`)
    }
  }
  if (f.periode_debut && f.periode_fin) {
    if (!anneeAdmise(f.periode_debut) || !anneeAdmise(f.periode_fin)) refus.push(`La période de la prestation porte une date qui n’est pas admise ${BORNES}.`)
    else if (f.periode_fin < f.periode_debut) refus.push('La période de la prestation finit avant de commencer.')
  }
  if (f.date_prestation && !anneeAdmise(f.date_prestation)) refus.push(`La date de la livraison ou de la prestation n’est pas une date admise ${BORNES}.`)

  return refus
}

// ── Écriture ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Noeud {
  nom: string
  attributs?: Record<string, string>
  texte?: string
  enfants?: (Noeud | null)[]
}

// Les caractères que XML 1.0 n'admet pas sont retirés, les autres échappés.
function echapper(t: string): string {
  return t
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const uneLigne = (t: string) => t.replace(/\s+/g, ' ').trim()

function el(nom: string, contenu: string | (Noeud | null)[], attributs?: Record<string, string>): Noeud {
  return typeof contenu === 'string' ? { nom, attributs, texte: contenu } : { nom, attributs, enfants: contenu }
}

function serialiser(n: Noeud, profondeur: number): string {
  const retrait = '  '.repeat(profondeur)
  const attributs = Object.entries(n.attributs ?? {}).map(([k, v]) => ` ${k}="${echapper(v)}"`).join('')
  if (n.texte !== undefined) return `${retrait}<${n.nom}${attributs}>${echapper(n.texte)}</${n.nom}>`
  const enfants = (n.enfants ?? []).filter((e): e is Noeud => e !== null)
  if (enfants.length === 0) return `${retrait}<${n.nom}${attributs}/>`
  return [`${retrait}<${n.nom}${attributs}>`, ...enfants.map((e) => serialiser(e, profondeur + 1)), `${retrait}</${n.nom}>`].join('\n')
}

const date102 = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

function dateCii(nom: string, iso: string, prefixe: 'udt' | 'qdt' = 'udt'): Noeud {
  return el(nom, [el(`${prefixe}:DateTimeString`, date102(iso), { format: '102' })])
}

function montant(c: number): string {
  const a = Math.abs(c)
  return `${c < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

function adresseCii(nom: string, adresse: AdresseStructuree, pays: string): Noeud {
  const lignes = adresse.lignes.length > 3 ? [...adresse.lignes.slice(0, 2), adresse.lignes.slice(2).join(', ')] : adresse.lignes
  return el(nom, [
    adresse.codePostal ? el('ram:PostcodeCode', adresse.codePostal) : null,
    lignes[0] ? el('ram:LineOne', lignes[0]) : null,
    lignes[1] ? el('ram:LineTwo', lignes[1]) : null,
    lignes[2] ? el('ram:LineThree', lignes[2]) : null,
    adresse.ville ? el('ram:CityName', adresse.ville) : null,
    el('ram:CountryID', pays),
  ])
}

const CADRES: Record<NatureOperation, string> = { biens: 'B1', services: 'S1', mixte: 'M1' }

// Le cadre de facturation (BT-23, règle G1.02) : le dépôt d'une facture de biens, de services, ou des deux. Les cadres
// « déjà payée », « définitive après acompte », de sous-traitance ou de cotraitance ne sont pas modélisés.
export function cadreDeFacturation(nature: NatureOperation): string {
  return CADRES[nature]
}

// L'option pour la TVA sur les débits ne vise que les prestations de services : sur une facture de biens seuls, elle
// ne dit rien (règle G1.43).
function optionDebitsApplicable(f: Pick<FactureCii, 'option_debits' | 'nature_operation'>): boolean {
  return f.option_debits === true && (f.nature_operation === 'services' || f.nature_operation === 'mixte')
}

export type ResultatCii = { xml: string; refus: [] } | { xml: null; refus: string[] }

// La facture en CII, ou ce qui l'empêche de l'être.
export function factureCii(d: DonneesCii): ResultatCii {
  const refus = refusEmission(d)
  if (refus.length > 0) return { xml: null, refus }
  const { facture: f, vendeur: v } = d
  const motifConnu = motifExoneration(v.statutTva, v.articleExoneration).motif
  const motif = motifConnu ? { code: motifConnu.code, texte: motifConnu.texte } : null
  const m = montantsDuDocument(f, d.lignes, motif)
  const sirenVendeur = sirenDe(v.siret) as string
  const siretClient = f.tiers_siret?.replace(/\s/g, '') || null
  // L'option pour les débits se dit dans chaque ventilation de TVA (règle G1.43, et S1.13 des spécifications : la même
  // valeur partout), dès que le prestataire a opté — comme la mention imprimée (11° bis), qui ne regarde pas les lignes.
  const debits = optionDebitsApplicable(f)
  // L'adresse de livraison n'existe que sur une facture de biens ou mixte : la base le garantit
  // (factures_emises_livraison_de_biens), et ses quatre champs vont ensemble (factures_emises_livraison_complete).
  const livraison = f.livraison_adresse && f.livraison_code_postal && f.livraison_ville && f.livraison_pays
    ? { lignes: [uneLigne(f.livraison_adresse)], codePostal: f.livraison_code_postal, ville: f.livraison_ville, pays: f.livraison_pays }
    : null

  const lignes = m.lignes.map((l) => el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', [el('ram:LineID', String(l.numero))]),
    el('ram:SpecifiedTradeProduct', [el('ram:Name', uneLigne(l.libelle))]),
    el('ram:SpecifiedLineTradeAgreement', [
      el('ram:NetPriceProductTradePrice', [el('ram:ChargeAmount', decimal(l.prix, 6) as string)]),
    ]),
    el('ram:SpecifiedLineTradeDelivery', [el('ram:BilledQuantity', decimal(l.quantite, 4) as string, { unitCode: UNITE_GENERIQUE })]),
    el('ram:SpecifiedLineTradeSettlement', [
      el('ram:ApplicableTradeTax', [
        el('ram:TypeCode', 'VAT'),
        el('ram:CategoryCode', l.categorie),
        el('ram:RateApplicablePercent', decimal(l.taux, 2) as string),
      ]),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [el('ram:LineTotalAmount', montant(l.htCentimes))]),
    ]),
  ]))

  const document = el('rsm:CrossIndustryInvoice', [
    el('rsm:ExchangedDocumentContext', [
      el('ram:BusinessProcessSpecifiedDocumentContextParameter', [el('ram:ID', cadreDeFacturation(f.nature_operation as NatureOperation))]),
      el('ram:GuidelineSpecifiedDocumentContextParameter', [el('ram:ID', PROFIL_EN16931)]),
    ]),
    el('rsm:ExchangedDocument', [
      el('ram:ID', f.numero as string),
      el('ram:TypeCode', f.type === 'avoir' ? '381' : '380'),
      dateCii('ram:IssueDateTime', f.date_emission),
      // Seules les mentions légales partent avec la facture (BT-22). Les notes n'y figurent pas, ni le motif d'un avoir
      // rangé avec elles : l'écran le dit en les saisissant, l'aperçu ne les imprime pas, l'acheteur n'en reçoit rien.
      // Elles ne sont pas internes pour autant : le client qui porte la case « Ventes » les lit (`ventes_du_client`).
      f.mentions_legales?.trim() ? el('ram:IncludedNote', [el('ram:Content', f.mentions_legales.trim())]) : null,
    ]),
    el('rsm:SupplyChainTradeTransaction', [
      ...lignes,
      el('ram:ApplicableHeaderTradeAgreement', [
        f.type_client === 'organisme_public' && f.code_service ? el('ram:BuyerReference', uneLigne(f.code_service)) : null,
        el('ram:SellerTradeParty', [
          el('ram:Name', uneLigne(v.nom as string)),
          el('ram:SpecifiedLegalOrganization', [el('ram:ID', sirenVendeur, { schemeID: SCHEMA_SIREN })]),
          adresseCii('ram:PostalTradeAddress', adresseStructuree(v.adresse), 'FR'),
          el('ram:URIUniversalCommunication', [el('ram:URIID', sirenVendeur, { schemeID: SCHEMA_ADRESSE_ELECTRONIQUE })]),
          el('ram:SpecifiedTaxRegistration', [el('ram:ID', v.numeroTva as string, { schemeID: 'VA' })]),
        ]),
        el('ram:BuyerTradeParty', [
          siretClient ? el('ram:GlobalID', siretClient, { schemeID: SCHEMA_SIRET }) : null,
          el('ram:Name', uneLigne(f.tiers_nom)),
          el('ram:SpecifiedLegalOrganization', [el('ram:ID', f.tiers_siren as string, { schemeID: SCHEMA_SIREN })]),
          adresseCii('ram:PostalTradeAddress', adresseStructuree(f.tiers_adresse), 'FR'),
          el('ram:URIUniversalCommunication', [
            el('ram:URIID', f.tiers_adresse_electronique ?? (f.tiers_siren as string), { schemeID: SCHEMA_ADRESSE_ELECTRONIQUE }),
          ]),
        ]),
        f.type_client === 'organisme_public' && f.numero_engagement
          ? el('ram:BuyerOrderReferencedDocument', [el('ram:IssuerAssignedID', uneLigne(f.numero_engagement))])
          : null,
      ]),
      el('ram:ApplicableHeaderTradeDelivery', [
        livraison
          ? el('ram:ShipToTradeParty', [adresseCii('ram:PostalTradeAddress', livraison, livraison.pays)])
          : null,
        f.date_prestation
          ? el('ram:ActualDeliverySupplyChainEvent', [dateCii('ram:OccurrenceDateTime', f.date_prestation)])
          : null,
      ]),
      el('ram:ApplicableHeaderTradeSettlement', [
        el('ram:InvoiceCurrencyCode', 'EUR'),
        ...m.groupes.map((g) => el('ram:ApplicableTradeTax', [
          el('ram:CalculatedAmount', montant(g.tvaCentimes)),
          el('ram:TypeCode', 'VAT'),
          g.motif ? el('ram:ExemptionReason', g.motif) : null,
          el('ram:BasisAmount', montant(g.baseCentimes)),
          el('ram:CategoryCode', g.categorie),
          g.codeMotif ? el('ram:ExemptionReasonCode', g.codeMotif) : null,
          debits ? el('ram:DueDateTypeCode', '5') : null,
          el('ram:RateApplicablePercent', decimal(g.taux, 2) as string),
        ])),
        f.periode_debut && f.periode_fin
          ? el('ram:BillingSpecifiedPeriod', [dateCii('ram:StartDateTime', f.periode_debut), dateCii('ram:EndDateTime', f.periode_fin)])
          : null,
        el('ram:SpecifiedTradePaymentTerms', [
          f.type === 'avoir' && d.origine?.numero
            ? el('ram:Description', `Avoir sur la facture ${d.origine.numero} du ${dateLisible(d.origine.date_emission)}.`)
            : null,
          f.type === 'facture' && f.date_echeance ? dateCii('ram:DueDateDateTime', f.date_echeance) : null,
        ]),
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
          el('ram:LineTotalAmount', montant(m.htCentimes)),
          el('ram:TaxBasisTotalAmount', montant(m.htCentimes)),
          el('ram:TaxTotalAmount', montant(m.tvaCentimes), { currencyID: 'EUR' }),
          el('ram:GrandTotalAmount', montant(m.ttcCentimes)),
          el('ram:DuePayableAmount', montant(m.ttcCentimes)),
        ]),
        f.type === 'avoir' && d.origine?.numero
          ? el('ram:InvoiceReferencedDocument', [
            el('ram:IssuerAssignedID', d.origine.numero),
            dateCii('ram:FormattedIssueDateTime', d.origine.date_emission, 'qdt'),
          ])
          : null,
      ]),
    ]),
  ], { 'xmlns:rsm': NS.rsm, 'xmlns:qdt': NS.qdt, 'xmlns:ram': NS.ram, 'xmlns:udt': NS.udt })

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${serialiser(document, 0)}\n`, refus: [] }
}
// La facture telle que la base la garde, avec l'émetteur qu'elle a figé à sa validation.
export interface FactureEnBase extends FactureCii {
  emetteur_nom: string | null
  emetteur_siret: string | null
  emetteur_adresse: string | null
}

// Ce que le générateur reçoit, assemblé depuis la base — le même assemblage pour l'écran qui dit les refus avant le clic
// et pour les fonctions qui transmettent. Le vendeur est l'émetteur que la facture a figé ; le statut de TVA est celui du
// dossier aujourd'hui, que la facture ne fige pas ; le numéro de TVA se calcule sur le SIREN figé. Un dossier en
// franchise ou exonéré n'a de numéro que si le cabinet l'a dit (`numero_tva_attribue`, décision du 08/10/2026) : sans
// cela, aucun n'est inventé, et `refusEmission` le réclame.
export interface DossierCii {
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  numero_tva_attribue: boolean
}

export function donneesDeLaFacture(
  facture: FactureEnBase,
  lignes: LigneCii[],
  dossier: DossierCii,
  origine: OrigineCii | null,
  aujourdHui: string,
): DonneesCii {
  const siren = sirenDe(facture.emetteur_siret)
  const sansNumero = (dossier.statut_tva === 'franchise' || dossier.statut_tva === 'exonere') && !dossier.numero_tva_attribue
  return {
    facture,
    lignes,
    vendeur: {
      nom: facture.emetteur_nom,
      siret: facture.emetteur_siret,
      adresse: facture.emetteur_adresse,
      numeroTva: !sansNumero && sirenValide(siren) ? numeroTvaFrancais(siren) : null,
      numeroTvaAttribue: dossier.numero_tva_attribue,
      statutTva: dossier.statut_tva,
      articleExoneration: dossier.article_exoneration,
    },
    origine,
    aujourdHui,
  }
}
// ── FIN COPIE factureCii ─────────────────────────────────────────────────────────────────────────────────────────────

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
  // Le numéro se repose avec le statut : un envoi réussi dont l'écriture du numéro a échoué le retrouve ici.
  const { error: erreurStatut } = await admin.from("factures_emises")
    .update({ superpdp_dernier_statut: dernier?.status_code ?? null, superpdp_invoice_id: superpdpInvoiceId }).eq("id", factureId)
  if (erreurStatut) {
    console.error(`[superpdp-emit] statut « ${dernier?.status_code ?? "aucun"} » non écrit sur la facture ${factureId} : ${erreurStatut.message}`)
  }
  return { dernierStatut: dernier?.status_code ?? null, evenements }
}

// Ce que l'historique dit se reporte sur la transmission DÉPOSÉE de ce numéro (`suiteDeLHistorique`). Rejetée ou
// acceptée, elle ne change plus — le déclencheur le garantit —, et le report ne vaut que tant qu'elle est déposée :
// deux actualisations concurrentes ne s'écrasent pas. Non bloquant, comme l'historique : la facture est partie, et une
// prochaine actualisation le refera ; journalisé, sans rien de la facture.
async function reporterSurLaTransmission(
  admin: ReturnType<typeof createClient>, factureId: string, superpdpInvoiceId: number, evenements: InvoiceEvent[],
): Promise<void> {
  const suite = suiteDeLHistorique(evenements)
  if (!suite) return
  const { error } = await admin.from("transmissions_factures")
    .update({ etat: suite.etat, detail: suite.detail })
    .eq("facture_id", factureId).eq("canal", "superpdp").eq("flux_id", String(superpdpInvoiceId)).eq("etat", "depose")
  if (error) console.error(`[superpdp-emit] statut « ${suite.etat} » non reporté sur la transmission : ${error.message}`)
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

// ── DÉBUT COPIE droitsDeLAppelant ────────────────────────────────────────────────────────────────────────────────────
// Ce que l'appelant peut faire sur ce dossier (espace client, étape P3). Ses droits se lisent par
// `droits_sur_le_dossier` (migration `droits_des_acces_clients`, étape P1) avec SON jeton — sous la clé de service,
// `auth.uid()` serait nul —, avant toute lecture d'un secret et tout appel extérieur. Seul `true` accorde : une erreur,
// une exception, ou une réponse sans ses quatre cases booléennes rendent `illisible`, le côté fermé ; une case de plus
// (un domaine neuf, que la fonction SQL ajoute sans changer de signature) ne ferme rien. Le droit qu'une action exige
// est une DONNÉE de chaque fonction, sa table « qui peut quoi » : « cabinet » (`admin_du_dossier`), ou « ventes »
// (`gere_les_ventes` : le cabinet, ou un accès client qui porte la case « Ventes ») ; une action hors de la table n'est
// permise à personne. Copié à l'identique dans plateforme-agreee, superpdp-emit, superpdp-credentials et send-email :
// `droitsDeLAppelantCopie.test.ts` exécute chaque copie contre sa propre grille.
type DroitExige = "cabinet" | "ventes"
interface Droits { cabinet: boolean; membre: boolean; ventes: boolean; banque: boolean }

async function droitsDeLAppelant(
  appelant: { rpc: (nom: string, args: { p_dossier_id: string }) => PromiseLike<{ data: unknown; error: unknown }> },
  dossierId: string,
): Promise<{ droits: Droits } | { illisible: string }> {
  let lu: unknown
  try {
    const reponse = await appelant.rpc("droits_sur_le_dossier", { p_dossier_id: dossierId })
    if (reponse.error != null) {
      const message = (reponse.error as { message?: unknown }).message
      return { illisible: typeof message === "string" && message !== "" ? message : "erreur de la base" }
    }
    lu = reponse.data
  } catch {
    return { illisible: "la base n'a pas répondu" }
  }
  if (lu === null || typeof lu !== "object" || Array.isArray(lu)) return { illisible: "réponse d'une autre forme" }
  const cases = lu as Record<string, unknown>
  if (!["cabinet", "membre", "ventes", "banque"].every((c) => typeof cases[c] === "boolean")) {
    return { illisible: "réponse d'une autre forme" }
  }
  const { cabinet, membre, ventes, banque } = cases as unknown as Droits
  return { droits: { cabinet, membre, ventes, banque } }
}

/** L'appelant porte-t-il le droit que la table exige pour cette action ? */
function actionPermise(table: Readonly<Record<string, DroitExige>>, action: string, droits: Droits): boolean {
  const exige = Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null
  return exige === "cabinet" ? droits.cabinet : exige === "ventes" ? droits.ventes : false
}
// ── FIN COPIE droitsDeLAppelant ──────────────────────────────────────────────────────────────────────────────────────

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

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait alors un 500 en
  // texte brut, sans en-tête CORS, que la page ne pouvait pas lire ; un champ reçu en nombre faisait lever `.trim()`
  // (défauts connus des Edge Functions, corrigés ici comme dans create-cabinet). Absent ou nul, un champ tombe sur le
  // refus « requis » qui suit.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  const payload = corps as Record<string, unknown>
  for (const champ of ["dossierId", "factureId", "action"]) {
    if (!texteOuAbsent(payload[champ])) {
      return json({ error: `Corps de requête invalide : « ${champ} » doit être un texte.` }, 400)
    }
  }
  const dossierId = (payload.dossierId as string | null | undefined)?.trim()
  const factureId = (payload.factureId as string | null | undefined)?.trim()
  const action = payload.action
  if (!dossierId || !factureId || (action !== "envoyer" && action !== "actualiser")) {
    return json({ error: "dossierId, factureId et action ('envoyer' ou 'actualiser') sont requis." }, 400)
  }

  // Les droits de l'appelant, avec SON jeton, avant toute lecture de la facture et des identifiants. Sans le droit que
  // l'action exige, la réponse d'avant l'espace client, mot pour mot : elle ne dit pas si le dossier existe.
  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)
  if ("illisible" in lus) {
    return json({ error: `L'accès à ce dossier n'a pas pu être vérifié (${lus.illisible}).` }, 503)
  }
  if (!actionPermise(QUI_PEUT_QUOI, action, lus.droits)) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  const { data: factureData, error: factureError } = await admin
    .from("factures_emises")
    .select(COLONNES_FACTURE)
    .eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()
  if (factureError) {
    return json({ error: `La facture n'a pas pu être lue (${factureError.message}).` }, 503)
  }
  if (!factureData) {
    return json({ error: "Facture introuvable." }, 404)
  }
  const facture = factureData as FactureLue

  const { data: creds } = await admin
    .from("superpdp_credentials")
    .select("client_id, client_secret")
    .eq("dossier_id", dossierId)
    .maybeSingle()
  if (!creds) {
    return json({ error: "Identifiants Super PDP non configurés pour ce dossier." }, 400)
  }

  // La facture à envoyer — ses lignes, le statut de TVA du dossier et, pour un avoir, la facture qu'il corrige — se lit
  // et se juge AVANT tout appel à Super PDP : ce qui empêche de la transmettre se dit tout ensemble, et rien ne part.
  let fichier: { xml: string; sha256: string } | null = null
  if (action === "envoyer") {
    if (facture.superpdp_invoice_id) {
      return json({ error: "Cette facture a déjà été transmise via Super PDP." }, 409)
    }
    const { data: lignesData, error: lignesError } = await admin
      .from("facture_lignes")
      .select("ordre, designation, quantite, prix_unitaire_ht, taux_tva")
      .eq("facture_id", factureId)
      .order("ordre")
    if (lignesError) {
      return json({ error: `Les lignes de la facture n'ont pas pu être lues (${lignesError.message}).` }, 503)
    }
    const { data: tva, error: tvaError } = await admin
      .from("dossiers")
      .select("statut_tva, article_exoneration, numero_tva_attribue")
      .eq("id", dossierId)
      .maybeSingle()
    if (tvaError || !tva) {
      return json({ error: `Le statut de TVA du dossier n'a pas pu être lu (${tvaError?.message ?? "dossier introuvable"}).` }, 503)
    }
    let origine: OrigineCii | null = null
    if (facture.type === "avoir" && facture.facture_origine_id) {
      const { data: origineData, error: origineError } = await admin
        .from("factures_emises")
        .select("numero, date_emission")
        .eq("id", facture.facture_origine_id).eq("dossier_id", dossierId).maybeSingle()
      if (origineError) {
        return json({ error: `La facture que l'avoir corrige n'a pas pu être lue (${origineError.message}).` }, 503)
      }
      origine = origineData ? { numero: origineData.numero, date_emission: origineData.date_emission } : null
    }
    const donnees = donneesDeLaFacture(facture, (lignesData ?? []) as LigneCii[], tva, origine, dateDeParis(Date.now()))
    const refus = refusEmission(donnees)
    if (refus.length > 0) {
      return json({ error: `Cette facture ne peut pas être transmise telle quelle : ${refus.join(" ")}`, refus }, 422)
    }
    const cii = factureCii(donnees)
    if (cii.xml === null) {
      return json({ error: `Cette facture ne peut pas être transmise telle quelle : ${cii.refus.join(" ")}`, refus: cii.refus }, 422)
    }
    fichier = { xml: cii.xml, sha256: await empreinteSha256(new TextEncoder().encode(cii.xml)) }
  }

  // Le numéro de la facture chez Super PDP : celui qu'elle porte ou, si son écriture a échoué après un envoi réussi,
  // celui que sa transmission a gardé — sans quoi elle ne se suivrait plus.
  let numeroSuperPdp = facture.superpdp_invoice_id
  if (action === "actualiser" && !numeroSuperPdp) {
    const { data: transmise, error: erreurTransmise } = await admin
      .from("transmissions_factures")
      .select("flux_id")
      .eq("facture_id", factureId).eq("canal", "superpdp").not("flux_id", "is", null)
      .order("cree_le", { ascending: false }).limit(1).maybeSingle()
    if (erreurTransmise) {
      return json({ error: `La transmission de la facture n'a pas pu être lue (${erreurTransmise.message}).` }, 503)
    }
    const lu = Number(transmise?.flux_id)
    if (Number.isSafeInteger(lu) && lu > 0) numeroSuperPdp = lu
  }

  try {
    const token = await obtenirToken(creds.client_id, creds.client_secret)
    const headers = { Authorization: `Bearer ${token}` }

    if (action === "actualiser") {
      if (!numeroSuperPdp) {
        return json({ error: "Cette facture n'a jamais été transmise via Super PDP." }, 400)
      }
      const { dernierStatut, evenements } = await actualiserStatut(admin, headers, dossierId, factureId, numeroSuperPdp)
      await reporterSurLaTransmission(admin, factureId, numeroSuperPdp, evenements)
      return json({ ok: true, dernier_statut: dernierStatut, evenements })
    }

    // action === "envoyer"
    if (!fichier) throw new Error("La facture à envoyer n'a pas été préparée.")

    // 1. Validation schematron de Super PDP AVANT tout envoi réel — voir en-tête de fichier.
    const form = new FormData()
    form.append("file_name", new File([fichier.xml], `facture-${facture.numero ?? facture.id}.xml`, { type: "application/xml" }))
    const validationResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/validation_reports`, { method: "POST", body: form })
    const validationBody = await validationResp.json().catch(() => null)
    console.log(`[superpdp-emit] validation ${validationResp.status}`)
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
        console.log(`[superpdp-emit] validation : ${messagesBloquants.length} message(s) bloquant(s)`)
        return json({ error: `Facture non conforme selon le validateur Super PDP : ${[...new Set(messagesBloquants)].slice(0, 5).join(" ; ")}` }, 400)
      }
      console.log(`[superpdp-emit] validation is_valid=false mais uniquement des avertissements — envoi maintenu`)
    }

    // 2. La transmission se RÉSERVE avant de partir : une seule active par facture, tous canaux confondus (index
    // unique), si bien que deux clics, deux onglets ou un dépôt par la plateforme du client ne la transmettent pas deux
    // fois. Elle garde le compte qui l'a demandée, le cabinet ou le client (`cree_par`, étape P2) : posé ici, à la
    // réservation, puisque la garde de la table refuse qu'il change ensuite.
    const { data: reservee, error: erreurReservation } = await admin
      .from("transmissions_factures")
      .insert({
        dossier_id: dossierId, facture_id: factureId, canal: "superpdp", hote: HOTE_SUPERPDP, sha256: fichier.sha256,
        cree_par: callerData.user.id,
      })
      .select("id")
      .maybeSingle()
    if (erreurReservation?.code === "23505") {
      return json({ error: "Cette facture a déjà une transmission en cours ou faite : elle ne repart pas.", deja: true }, 409)
    }
    if (erreurReservation || !reservee) {
      return json({ error: `La transmission n'a pas pu être réservée (${erreurReservation?.message ?? "aucune ligne rendue"}).` }, 500)
    }

    // 3. Envoi réel — irréversible, voir en-tête de fichier. external_id (l'id de notre facture,
    // 36 caractères comme tout uuid) sert à la retrouver côté Super PDP en cas de doute.
    let statutEnvoi = 0
    let corpsEnvoi: unknown = null
    try {
      const sendResp = await fetch(`${SUPERPDP_ENDPOINT}/v1.beta/invoices?external_id=${encodeURIComponent(facture.id)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/xml" },
        body: fichier.xml,
        signal: AbortSignal.timeout(DELAI_ENVOI_MS),
      })
      statutEnvoi = sendResp.status
      corpsEnvoi = await sendResp.json().catch(() => null)
    } catch {
      // Pas de réponse, ou une réponse coupée : l'issue reste inconnue (statut 0).
    }
    const issue = issueDeLEnvoi(statutEnvoi, corpsEnvoi)
    console.log(`[superpdp-emit] envoi ${statutEnvoi}, ${issue.etat}`)
    const suivi = issue.etat === "depose"
      ? { etat: issue.etat, flux_id: String(issue.id), detail: issue.detail }
      : issue.etat === "echec" ? { etat: issue.etat, detail: issue.detail } : { detail: issue.detail }
    const { error: erreurSuivi } = await admin
      .from("transmissions_factures")
      .update(suivi)
      .eq("id", reservee.id).eq("etat", "envoi")
    if (erreurSuivi) {
      console.error(`[superpdp-emit] issue de l'envoi non enregistrée sur la transmission : ${erreurSuivi.message}`)
    }
    if (issue.etat !== "depose") {
      // Un refus que la transmission n'a pas enregistré la laisse réservée : le dire, sans quoi « Rien n'a été envoyé »
      // ferait recliquer sur un refus « déjà une transmission en cours ».
      const encoreReservee = erreurSuivi && issue.etat === "echec"
        ? " Ce refus n'a pas pu être enregistré : la transmission reste réservée, et la facture ne repartira qu'après vérification."
        : ""
      return json({ error: `${issue.detail}${encoreReservee}` }, 502)
    }

    const { error: updateError } = await admin.from("factures_emises").update({ superpdp_invoice_id: issue.id }).eq("id", factureId)
    if (updateError) throw new Error(updateError.message)

    // Relit immédiatement l'état (plutôt que de se fier au seul champ `events`, optionnel, de la
    // réponse de création) pour afficher un premier statut sans attendre un clic sur "Actualiser".
    const { dernierStatut, evenements } = await actualiserStatut(admin, headers, dossierId, factureId, issue.id)
    await reporterSurLaTransmission(admin, factureId, issue.id, evenements)

    return json({ ok: true, superpdp_invoice_id: issue.id, dernier_statut: dernierStatut, evenements })
  } catch (err) {
    console.error(`[superpdp-emit] erreur attrapée :`, err)
    const detail = err instanceof Error ? `${err.name} : ${err.message}` : String(err)
    return json({ error: `Erreur inattendue : ${detail}` }, 500)
  }
})
