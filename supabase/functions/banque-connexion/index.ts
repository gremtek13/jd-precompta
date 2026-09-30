// Edge Function : la connexion bancaire d'un dossier (ligne 24 de la feuille de route), en preuve de
// concept sur le bac à sable d'Enable Banking.
//
// Enable Banking est un prestataire d'information sur les comptes (DSP2) : avec l'accord que le titulaire
// donne sur le site de SA banque, il ouvre la lecture des mouvements d'un compte. Cette fonction est le
// SEUL point de contact avec lui, et la seule à lire ou écrire `connexions_bancaires` (RLS sans aucune
// policy : refus total côté navigateur, voir supabase/essais/connexionBancaire.sql). Deux secrets ne
// quittent jamais le serveur : la clé privée de l'application, qui signe chaque appel, et l'identifiant
// de la session ouverte chez le prestataire, qui avec elle ouvre les mouvements du compte.
//
// Sept actions, toutes demandées par un membre du cabinet qui a accès au dossier — `admin_du_dossier`,
// vérifié AVANT tout appel au prestataire :
//   - statut          la connexion du dossier, SANS appel extérieur : c'est le seul appel que l'écran
//                     fait en s'ouvrant, tous les autres partent d'un clic ;
//   - banques         les banques qu'on peut connecter, et l'environnement de l'application ;
//   - demarrer        ouvre une demande d'accord et rend l'adresse de la banque ;
//   - finaliser       au retour de la banque : ouvre la session et retient les comptes ouverts ;
//   - choisir_compte  le compte dont on importe les mouvements ;
//   - mouvements      les mouvements d'une période, RENDUS au navigateur : rien n'est écrit dans le
//                     relevé ici — c'est l'écran qui importe, sur le clic, par le chemin d'un relevé ;
//   - retirer         referme la session chez le prestataire, puis supprime la connexion.
//
// UNE connexion par dossier, et c'est la base qui le tient (`connexions_bancaires_dossier_unique`) :
// l'application ne tient qu'un relevé par dossier, écrit sur le seul 512000.
//
// Ce qui sort vers le navigateur est MINIMAL : ni l'identifiant de session, ni celui d'un compte, ni le
// nom du titulaire, ni l'IBAN — ses quatre derniers caractères seulement. Un mouvement ne remonte qu'en
// date, libellé et montant, avec l'identifiant externe qui le dédoublonne. Et les journaux ne portent que
// des nombres et des codes de retour, jamais un libellé ni un montant.

import { createClient } from "npm:@supabase/supabase-js@2"

const API = "https://api.enablebanking.com"
// L'application que le cabinet a enregistrée sur le bac à sable, le 29/09/2026. Ce n'est pas un secret :
// il DÉSIGNE l'application, c'est la clé privée qui prouve qu'on l'est. Une application de production
// aura le sien, à poser dans `ENABLE_BANKING_APPLICATION_ID` avec sa clé.
const APPLICATION_BAC_A_SABLE = "ded8dcc5-f953-45bb-96b0-6884d1ca7b55"
// L'adresse où la banque renvoie le navigateur. Elle doit figurer À L'IDENTIQUE parmi celles de
// l'application chez le prestataire : `demarrer` le vérifie avant d'envoyer quiconque à sa banque.
const URL_RETOUR = "https://compta.jdarnis.fr/retour-banque.html"
const PAYS_PAR_DEFAUT = "FR"
const DELAI_APPEL_MS = 25_000
// La plateforme coupe une fonction à 150 s, sans un mot et en perdant tout (voir extract-piece). La
// lecture des pages s'arrête bien avant, et le DIT.
const BUDGET_PAGES_MS = 100_000
const MAX_PAGES = 200

const ACTIONS = ["statut", "banques", "demarrer", "finaliser", "choisir_compte", "mouvements", "retirer"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLONNES = "id, dossier_id, banque_nom, banque_pays, type_acces, environnement, etat, jeton_etat, " +
  "session_id, valide_jusqu_au, comptes, compte_uid, compte_empreinte, derniere_recuperation, created_at"

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

// ── DÉBUT JETON ─────────────────────────────────────────────────────────────────────────────────────
// Chaque appel au prestataire porte un jeton signé par la clé privée de l'application (RS256). La clé
// arrive par un secret posé à la main : elle est acceptée au format PKCS#8 (« BEGIN PRIVATE KEY », celui
// que le prestataire fait télécharger) comme au format PKCS#1 (« BEGIN RSA PRIVATE KEY »), avec de vrais
// retours à la ligne ou des « \n » écrits, ou réduite à son seul corps — un secret collé une fois de
// travers ne doit pas coûter une journée de diagnostic. Une clé chiffrée ou d'un autre algorithme est
// refusée en le disant.
const DUREE_JETON_S = 3600

function base64url(octets: Uint8Array): string {
  let binaire = ""
  for (const o of octets) binaire += String.fromCharCode(o)
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function longueurDer(n: number): number[] {
  if (n < 0x80) return [n]
  const octets: number[] = []
  for (let reste = n; reste > 0; reste = Math.floor(reste / 256)) octets.unshift(reste % 256)
  return [0x80 | octets.length, ...octets]
}

/** Une clé PKCS#1 enveloppée en PKCS#8, la seule forme que WebCrypto importe. */
function enveloppePkcs8(pkcs1: Uint8Array): Uint8Array {
  // AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
  const algorithme = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const cle = [0x04, ...longueurDer(pkcs1.length), ...pkcs1]
  const contenu = [0x02, 0x01, 0x00, ...algorithme, ...cle]
  return Uint8Array.from([0x30, ...longueurDer(contenu.length), ...contenu])
}

const CLE_ILLISIBLE = "La clé privée de l'application est illisible : colle le contenu entier du fichier .pem " +
  "téléchargé chez Enable Banking, de « -----BEGIN » à « -----END … KEY----- »."

/** Le DER PKCS#8 d'une clé RSA, quelle que soit la forme sous laquelle le secret l'a reçue. */
function derDepuisPem(pem: string): Uint8Array {
  const texte = pem.replace(/\\r/g, "").replace(/\\n/g, "\n").trim()
  if (/BEGIN (ENCRYPTED|EC|DSA|OPENSSH) PRIVATE KEY/.test(texte)) {
    throw new Error("La clé privée de l'application n'est pas une clé RSA en clair (chiffrée, ou d'un autre " +
      "algorithme) : Enable Banking signe en RS256, il faut la clé RSA non chiffrée qu'il a fait télécharger.")
  }
  const corps = texte.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "")
  if (corps === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(corps)) throw new Error(CLE_ILLISIBLE)
  const der = Uint8Array.from(atob(corps), (c) => c.charCodeAt(0))
  // PKCS#8 : SEQUENCE { INTEGER 0, SEQUENCE { algorithme }, OCTET STRING } ;
  // PKCS#1 : SEQUENCE { INTEGER 0, INTEGER module, … }. La STRUCTURE les distingue, pas l'en-tête, qu'un
  // secret réduit à son corps a perdu.
  if (der.length < 8 || der[0] !== 0x30) throw new Error(CLE_ILLISIBLE)
  const i = der[1] < 0x80 ? 2 : 2 + (der[1] & 0x7f)
  if (der[i] !== 0x02 || der[i + 1] !== 0x01 || der[i + 2] !== 0x00) throw new Error(CLE_ILLISIBLE)
  if (der[i + 3] === 0x30) return der
  if (der[i + 3] === 0x02) return enveloppePkcs8(der)
  throw new Error(CLE_ILLISIBLE)
}

async function jetonApplication(pem: string, applicationId: string, maintenantS: number): Promise<string> {
  // Recopiée dans un tableau neuf : WebCrypto veut un tampon qui ne soit que la clé.
  const cle = await crypto.subtle.importKey(
    "pkcs8", new Uint8Array(derDepuisPem(pem)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const encodeur = new TextEncoder()
  const entete = base64url(encodeur.encode(JSON.stringify({ typ: "JWT", alg: "RS256", kid: applicationId })))
  const corps = base64url(encodeur.encode(JSON.stringify({
    iss: "enablebanking.com", aud: "api.enablebanking.com", iat: maintenantS, exp: maintenantS + DUREE_JETON_S,
  })))
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cle, encodeur.encode(`${entete}.${corps}`)))
  return `${entete}.${corps}.${base64url(signature)}`
}
// ── FIN JETON ───────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT MOUVEMENTS ────────────────────────────────────────────────────────────────────────────────
// Un mouvement de la banque devient une ligne de relevé : une date, un libellé, un montant signé, et un
// identifiant externe qui le dédoublonne. Tout ce qui n'est pas COMPTABILISÉ, en euros et lisible est
// écarté et COMPTÉ, jamais deviné : un mouvement en attente change souvent de référence en passant en
// compte, donc l'importer ferait un doublon le lendemain.
interface TransactionBanque {
  entry_reference?: unknown
  transaction_amount?: { currency?: unknown; amount?: unknown } | null
  credit_debit_indicator?: unknown
  status?: unknown
  booking_date?: unknown
  value_date?: unknown
  transaction_date?: unknown
  remittance_information?: unknown
  creditor?: { name?: unknown } | null
  debtor?: { name?: unknown } | null
  bank_transaction_code?: { description?: unknown } | null
}

interface MouvementLu {
  id_externe: string
  date: string
  libelle: string
  montant: number
}

interface Ecartes {
  non_comptabilises: number
  autre_devise: number
  hors_periode: number
  illisibles: number
  doublons: number
}

const LIBELLE_MAX = 500
const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/

async function empreinteHex(texte: string): Promise<string> {
  const octets = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)))
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("")
}

function texteNet(valeur: unknown): string {
  return typeof valeur === "string" ? valeur.replace(/\s+/g, " ").trim() : ""
}

/**
 * Le montant en CENTIMES, lu sur la chaîne que rend le prestataire (« 1234.56 », point décimal) — jamais
 * par un produit de flottants, qui ferait 100,49999… de « 1.005 ». Au-delà de deux décimales, l'arrondi
 * se fait au plus proche, la moitié s'éloignant de zéro.
 */
function centimesDe(montant: unknown): number | null {
  if (typeof montant !== "string") return null
  const m = /^-?(\d{1,12})(?:\.(\d+))?$/.exec(montant.trim())
  if (!m) return null
  const fraction = m[2] ?? ""
  const arrondi = fraction.length > 2 && Number(fraction[2]) >= 5 ? 1 : 0
  return Number(m[1]) * 100 + Number((fraction + "00").slice(0, 2)) + arrondi
}

/**
 * Les mouvements d'une page de banque, pour la période [du, au]. La période est REFILTRÉE ici : plusieurs
 * banques ignorent les dates demandées — le bac à sable d'Enable Banking le dit de la plupart des siennes
 * — et un mouvement hors période importé à côté du relevé d'un autre mois passerait pour un oubli.
 */
async function mouvementsDuCompte(
  transactions: unknown[], empreinteCompte: string, du: string, au: string,
): Promise<{ mouvements: MouvementLu[]; ecartes: Ecartes }> {
  const mouvements: MouvementLu[] = []
  const ecartes: Ecartes = { non_comptabilises: 0, autre_devise: 0, hors_periode: 0, illisibles: 0, doublons: 0 }
  const vus = new Set<string>()
  const occurrences = new Map<string, number>()
  for (const brut of transactions) {
    const t = (brut ?? {}) as TransactionBanque
    if (t.status !== "BOOK") { ecartes.non_comptabilises++; continue }
    if (t.transaction_amount?.currency !== "EUR") { ecartes.autre_devise++; continue }
    const date = [t.booking_date, t.value_date, t.transaction_date]
      .find((d): d is string => typeof d === "string" && DATE_CIVILE.test(d))
    const sens = t.credit_debit_indicator === "CRDT" ? 1 : t.credit_debit_indicator === "DBIT" ? -1 : 0
    const centimes = centimesDe(t.transaction_amount?.amount)
    if (!date || sens === 0 || centimes === null || centimes === 0) { ecartes.illisibles++; continue }
    if (date < du || date > au) { ecartes.hors_periode++; continue }

    // Le libellé : le motif du paiement, puis le nom de la contrepartie quand il n'y figure pas déjà — c'est
    // sur lui que se reconnaissent le fournisseur d'un justificatif et les règles d'affectation. À défaut,
    // l'intitulé de l'opération que donne la banque.
    const lignes = (Array.isArray(t.remittance_information) ? t.remittance_information : []).map(texteNet).filter(Boolean)
    const motif = lignes.join(" ")
    const contrepartie = texteNet(sens < 0 ? t.creditor?.name : t.debtor?.name)
    const parties = [motif]
    if (contrepartie && !motif.toLowerCase().includes(contrepartie.toLowerCase())) parties.push(contrepartie)
    const libelle = (parties.filter(Boolean).join(" — ") || texteNet(t.bank_transaction_code?.description) ||
      "Mouvement bancaire").slice(0, LIBELLE_MAX)

    // L'identifiant externe. La référence de la banque est stable d'une session à l'autre pour un même
    // compte, mais pas unique d'un compte à l'autre : elle est donc préfixée de l'empreinte du compte. Sans
    // référence, l'empreinte porte ce que la banque a DONNÉ — jamais le libellé composé ici, qu'une
    // retouche changerait — et le rang du mouvement parmi ses identiques du lot : deux cafés du même prix
    // le même jour restent deux mouvements, et relire la même période redonne les mêmes identifiants.
    const reference = texteNet(t.entry_reference)
    let id: string
    if (reference) {
      id = `eb:r:${await empreinteHex(`${empreinteCompte}|${reference}`)}`
    } else {
      const cle = [empreinteCompte, date, String(sens * centimes), lignes.join("\n"), contrepartie].join("|")
      const rang = occurrences.get(cle) ?? 0
      occurrences.set(cle, rang + 1)
      id = `eb:e:${await empreinteHex(`${cle}|${rang}`)}`
    }
    if (vus.has(id)) { ecartes.doublons++; continue }
    vus.add(id)
    mouvements.push({ id_externe: id, date, libelle, montant: (sens * centimes) / 100 })
  }
  // Du plus ancien au plus récent, comme un relevé — la banque rend souvent l'inverse.
  mouvements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { mouvements, ecartes }
}
// ── FIN MOUVEMENTS ──────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT PAGES BANQUE ──────────────────────────────────────────────────────────────────────────────
// La banque rend ses mouvements par pages, et c'est la CLÉ DE SUITE qui dit s'il en reste — une page
// vide n'est pas la fin. Trois bornes, et chacune rend la lecture INCOMPLÈTE en le disant, jamais courte
// en silence : un nombre de pages, un budget de temps (la plateforme coupe à 150 s et perd tout), et une
// clé déjà servie, qui ferait tourner la boucle sans fin. Une page refusée LÈVE : c'est à l'appelant de
// dire pourquoi.
interface PageBanque {
  transactions?: unknown
  continuation_key?: unknown
}

async function toutesLesPages(
  page: (cle: string | null) => Promise<PageBanque>,
  bornes: { maxPages: number; echeance: number; maintenant: () => number },
): Promise<{ transactions: unknown[]; pages: number; complete: boolean; motif: string | null }> {
  const transactions: unknown[] = []
  const clesServies = new Set<string>()
  let cle: string | null = null
  for (let n = 0; n < bornes.maxPages; n++) {
    if (n > 0 && bornes.maintenant() > bornes.echeance) {
      return { transactions, pages: n, complete: false,
        motif: "la banque met trop de temps à rendre ses pages : réduis la période demandée" }
    }
    const reponse = await page(cle)
    if (!Array.isArray(reponse?.transactions)) {
      return { transactions, pages: n + 1, complete: false, motif: "la banque a rendu une page illisible" }
    }
    transactions.push(...reponse.transactions)
    const suite = typeof reponse.continuation_key === "string" && reponse.continuation_key !== ""
      ? reponse.continuation_key : null
    if (suite === null) return { transactions, pages: n + 1, complete: true, motif: null }
    if (clesServies.has(suite)) {
      return { transactions, pages: n + 1, complete: false, motif: "la banque a renvoyé deux fois la même page" }
    }
    clesServies.add(suite)
    cle = suite
  }
  return { transactions, pages: bornes.maxPages, complete: false,
    motif: `plus de ${bornes.maxPages} pages : réduis la période demandée` }
}
// ── FIN PAGES BANQUE ────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT RÈGLES ────────────────────────────────────────────────────────────────────────────────────
// La DSP2 borne un accord à 180 jours ; la banque peut le borner plus court.
const ACCORD_MAX_S = 180 * 24 * 3600
const TYPES_ACCES = ["business", "personal"]

interface CompteConnexion {
  uid: string | null
  empreinte: string
  nom: string | null
  devise: string | null
  iban_fin: string | null
}

function texteCourt(valeur: unknown, max = 80): string | null {
  if (typeof valeur !== "string") return null
  const net = valeur.replace(/\s+/g, " ").trim()
  return net === "" ? null : net.slice(0, max)
}

/**
 * Les comptes qu'ouvre une session, réduits à ce qui sert à choisir : l'identifiant du compte POUR CETTE
 * SESSION, son empreinte STABLE (l'espace de noms de ses identifiants externes), son intitulé, sa devise
 * et les quatre derniers caractères de l'IBAN. Le nom du titulaire n'est PAS retenu. Un compte sans
 * empreinte ne peut pas être dédoublonné d'une session à l'autre : il n'est pas proposé. Un compte sans
 * identifiant est gardé, mais la banque n'en donne pas les mouvements (fermé, bloqué) : l'écran le dit.
 */
function comptesDeLaSession(accounts: unknown): CompteConnexion[] {
  if (!Array.isArray(accounts)) return []
  const comptes: CompteConnexion[] = []
  for (const a of accounts) {
    const compte = (a ?? {}) as Record<string, unknown>
    const empreinte = typeof compte.identification_hash === "string" && compte.identification_hash !== ""
      ? compte.identification_hash : null
    if (!empreinte) continue
    const identification = (compte.account_id ?? {}) as Record<string, unknown>
    const iban = typeof identification.iban === "string" ? identification.iban.replace(/\s+/g, "") : ""
    comptes.push({
      uid: typeof compte.uid === "string" && compte.uid !== "" ? compte.uid : null,
      empreinte,
      nom: texteCourt(compte.details) ?? texteCourt(compte.product),
      devise: typeof compte.currency === "string" ? compte.currency : null,
      iban_fin: iban.length >= 4 ? iban.slice(-4) : null,
    })
  }
  return comptes
}

/** Les comptes tels que la table les garde — relus d'un JSON, donc revérifiés. */
function comptesGardes(valeur: unknown): CompteConnexion[] {
  if (!Array.isArray(valeur)) return []
  return valeur.flatMap((v) => {
    const c = (v ?? {}) as Record<string, unknown>
    if (typeof c.empreinte !== "string" || c.empreinte === "") return []
    return [{
      uid: typeof c.uid === "string" && c.uid !== "" ? c.uid : null,
      empreinte: c.empreinte,
      nom: typeof c.nom === "string" ? c.nom : null,
      devise: typeof c.devise === "string" ? c.devise : null,
      iban_fin: typeof c.iban_fin === "string" ? c.iban_fin : null,
    }]
  })
}

/** La fin de l'accord à demander : le plus court de ce que la banque admet et des 180 jours, moins une marge. */
function finAccordDemandee(maxBanqueS: unknown, maintenantMs: number): string {
  const max = typeof maxBanqueS === "number" && Number.isFinite(maxBanqueS) && maxBanqueS > 0
    ? Math.min(maxBanqueS, ACCORD_MAX_S) : ACCORD_MAX_S
  // Une heure de marge pour les horloges — un dixième de la durée si la banque l'accorde plus courte.
  const duree = max - Math.min(3600, max / 10)
  return new Date(maintenantMs + Math.floor(duree) * 1000).toISOString()
}

/** Aujourd'hui, en date civile du cabinet : une fonction tourne en UTC, un cabinet à Paris. */
function aujourdHuiCabinet(maintenant: Date): string {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(maintenant)
  const valeur = (type: string) => parties.find((p) => p.type === type)?.value ?? ""
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`
}

function dateCivileValide(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const [a, m, j] = d.split("-").map(Number)
  const x = new Date(Date.UTC(a, m - 1, j))
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === j
}

/** Ce qui ne va pas dans une période demandée, ou null : deux dates civiles, dans l'ordre, sans avenir. */
function refusPeriode(du: unknown, au: unknown, aujourdHui: string): string | null {
  if (typeof du !== "string" || typeof au !== "string" || !dateCivileValide(du) || !dateCivileValide(au)) {
    return "La période demandée n'est pas faite de deux dates valides."
  }
  if (du > au) return "La période demandée commence après sa fin."
  if (au > aujourdHui) return "La période demandée finit après aujourd'hui."
  return null
}

/** Le message d'erreur du prestataire, borné — il décrit la requête, jamais un mouvement. */
function messageDuPrestataire(donnees: unknown): string | null {
  if (!donnees || typeof donnees !== "object") return null
  const d = donnees as { message?: unknown; detail?: unknown }
  const texte = [d.message, d.detail].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join(" — ")
  return texte === "" ? null : texte.slice(0, 300)
}

/** Les banques proposées : leur nom, leur pays, les espaces de connexion qu'elles offrent, la durée d'accord. */
function banquesDeLaListe(donnees: unknown): { nom: string; pays: string; types_acces: string[]; accord_jours: number | null }[] {
  const liste = (donnees ?? {}) as { aspsps?: unknown }
  if (!Array.isArray(liste.aspsps)) return []
  const banques = liste.aspsps.flatMap((v) => {
    const b = (v ?? {}) as Record<string, unknown>
    if (typeof b.name !== "string" || b.name.trim() === "" || typeof b.country !== "string") return []
    const types = Array.isArray(b.psu_types) ? TYPES_ACCES.filter((t) => (b.psu_types as unknown[]).includes(t)) : []
    if (types.length === 0) return []
    const max = typeof b.maximum_consent_validity === "number" && b.maximum_consent_validity > 0
      ? Math.floor(Math.min(b.maximum_consent_validity, ACCORD_MAX_S) / 86400) : null
    return [{ nom: b.name, pays: b.country, types_acces: types, accord_jours: max }]
  })
  return banques.sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
}

/**
 * La connexion telle que l'écran la voit : RIEN de ce qui ouvre le compte. Ni l'identifiant de session,
 * ni le jeton de retour, ni l'identifiant d'un compte — seulement de quoi afficher et choisir.
 */
function vuePublique(c: Record<string, unknown> | null) {
  if (!c) return null
  return {
    banque_nom: c.banque_nom,
    banque_pays: c.banque_pays,
    type_acces: c.type_acces,
    environnement: c.environnement,
    etat: c.etat,
    valide_jusqu_au: c.valide_jusqu_au,
    derniere_recuperation: c.derniere_recuperation,
    created_at: c.created_at,
    compte_empreinte: c.compte_empreinte,
    comptes: comptesGardes(c.comptes).map((compte) => ({
      empreinte: compte.empreinte,
      nom: compte.nom,
      devise: compte.devise,
      iban_fin: compte.iban_fin,
      mouvements_lisibles: compte.uid !== null,
    })),
  }
}
// ── FIN RÈGLES ──────────────────────────────────────────────────────────────────────────────────────

interface ReponsePrestataire {
  statut: number
  donnees: unknown
}

/** Un appel au prestataire. Statut 0 : il n'a pas répondu (réseau, délai). */
async function appeler(action: string, methode: string, chemin: string, jeton: string, corps?: unknown): Promise<ReponsePrestataire> {
  // Le journal ne nomme que la RESSOURCE (« sessions », « accounts »…) : le chemin porte l'identifiant de
  // la session ou du compte.
  const ressource = chemin.split("?")[0].split("/")[1]
  let reponse: Response
  try {
    reponse = await fetch(`${API}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", Accept: "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
    })
  } catch {
    console.error(`[banque-connexion] ${action} : pas de réponse du prestataire (${methode} ${ressource})`)
    return { statut: 0, donnees: null }
  }
  let donnees: unknown = null
  try {
    donnees = await reponse.json()
  } catch {
    donnees = null
  }
  if (reponse.status < 200 || reponse.status >= 300) {
    console.error(`[banque-connexion] ${action} : le prestataire a répondu ${reponse.status} (${methode} ${ressource})`)
  }
  return { statut: reponse.status, donnees }
}

function reussi(r: ReponsePrestataire): boolean {
  return r.statut >= 200 && r.statut < 300
}

/** Une réponse d'erreur du prestataire, dite en français et sans rien de ce qu'il a lu. */
function erreurPrestataire(r: ReponsePrestataire) {
  if (r.statut === 0) {
    return json({ error: "Le prestataire bancaire n'a pas répondu à temps. Réessaie dans un instant." }, 504)
  }
  const detail = messageDuPrestataire(r.donnees)
  if (r.statut === 401 || r.statut === 403) {
    return json({
      error: `Le prestataire bancaire refuse l'accès${detail ? ` (${detail})` : ""}. Si l'accord de la banque a ` +
        "expiré ou a été retiré, renouvelle-le ; sinon, la clé de l'application est à vérifier.",
      acces_refuse: true,
    }, 502)
  }
  return json({ error: `Le prestataire bancaire a répondu ${r.statut}${detail ? ` : ${detail}` : "."}` }, 502)
}

class ErreurPrestataire extends Error {
  constructor(readonly reponse: ReponsePrestataire) {
    super(`le prestataire a répondu ${reponse.statut}`)
  }
}

function environnementDe(donnees: unknown): "SANDBOX" | "PRODUCTION" | null {
  const e = (donnees as { environment?: unknown } | null)?.environment
  return e === "SANDBOX" || e === "PRODUCTION" ? e : null
}

function paysDemande(valeur: unknown): string | null {
  if (valeur === undefined || valeur === null || valeur === "") return PAYS_PAR_DEFAUT
  return typeof valeur === "string" && /^[A-Z]{2}$/.test(valeur) ? valeur : null
}

Deno.serve(async (req: Request) => {
  const debut = Date.now()
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
  if (callerError || !callerData?.user) {
    return json({ error: "Non authentifié." }, 401)
  }
  const utilisateur: string = callerData.user.id

  const admin = createClient(supabaseUrl, serviceRoleKey)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  const action = typeof payload?.action === "string" ? payload.action : ""
  if (!ACTIONS.includes(action)) {
    return json({ error: `Action inconnue (attendu : ${ACTIONS.join(", ")}).` }, 400)
  }

  // LE DOSSIER : celui qu'annonce l'appelant — sauf au retour de la banque, où c'est la DEMANDE qui le
  // dit, retrouvée par son jeton de retour. L'accès se vérifie ensuite sur ce dossier-là, dans les deux cas.
  let connexion: Record<string, unknown> | null = null
  let dossierId: string
  if (action === "finaliser") {
    const etatRetour = typeof payload.state === "string" ? payload.state : ""
    if (!UUID.test(etatRetour)) return json({ error: "Retour de banque sans demande reconnaissable." }, 400)
    const { data, error } = await admin
      .from("connexions_bancaires").select(COLONNES).eq("jeton_etat", etatRetour).maybeSingle()
    if (error) return json({ error: `La demande de connexion n'a pas pu être lue (${error.message}).` }, 503)
    if (!data) {
      return json({
        error: "Cette demande de connexion n'existe plus : elle a déjà été traitée, ou une autre l'a remplacée. " +
          "La connexion du dossier est dans l'onglet Banque.",
      }, 404)
    }
    connexion = data
    dossierId = String(data.dossier_id)
  } else {
    dossierId = typeof payload.dossierId === "string" ? payload.dossierId.trim() : ""
    if (!UUID.test(dossierId)) return json({ error: "dossierId est requis." }, 400)
  }

  // Avec le jeton de l'APPELANT : la même fonction que les règles de la base (super-admin, chef du cabinet,
  // ou membre d'équipe assigné à ce dossier). Rien ne part chez le prestataire avant cette réponse.
  const { data: aAcces, error: erreurAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: dossierId })
  if (erreurAcces) return json({ error: `L'accès à ce dossier n'a pas pu être vérifié (${erreurAcces.message}).` }, 503)
  if (!aAcces) return json({ error: "Dossier introuvable." }, 404)

  if (action !== "finaliser") {
    const { data, error } = await admin
      .from("connexions_bancaires").select(COLONNES).eq("dossier_id", dossierId).maybeSingle()
    // « Aucune banque connectée » est une AFFIRMATION : une lecture refusée ne doit pas la produire.
    if (error) return json({ error: `La connexion bancaire de ce dossier n'a pas pu être lue (${error.message}).` }, 503)
    connexion = data
  }

  const clePrivee = Deno.env.get("ENABLE_BANKING_CLE_PRIVEE") ?? ""
  const applicationId = Deno.env.get("ENABLE_BANKING_APPLICATION_ID")?.trim() || APPLICATION_BAC_A_SABLE
  const configuree = clePrivee.trim() !== ""

  if (action === "statut") {
    return json({ configuree, connexion: vuePublique(connexion) })
  }

  // Le jeton n'est signé qu'au moment d'appeler le prestataire — jamais pour une action qui s'en passe.
  const NON_CONFIGUREE = "La connexion bancaire n'est pas configurée : la clé privée de l'application manque " +
    "(secret ENABLE_BANKING_CLE_PRIVEE des fonctions Supabase)."
  async function signer(): Promise<{ jeton: string; refus: null } | { jeton: null; refus: string }> {
    if (!configuree) return { jeton: null, refus: NON_CONFIGUREE }
    try {
      return { jeton: await jetonApplication(clePrivee, applicationId, Math.floor(Date.now() / 1000)), refus: null }
    } catch (e) {
      // Nos propres messages : ils décrivent la FORME de la clé, jamais son contenu.
      return { jeton: null, refus: e instanceof Error ? e.message : CLE_ILLISIBLE }
    }
  }

  if (action === "retirer") {
    if (!connexion) return json({ ok: true })
    // L'accord est refermé chez la banque AVANT que la connexion disparaisse d'ici : dans l'autre ordre, un
    // échec laisserait un accès ouvert que plus rien ne désigne. Une demande jamais aboutie ou un accord
    // expiré n'ont rien à refermer ; et « Retirer quand même » (`forcer`) passe outre un prestataire qui
    // refuse ou une clé qui manque — l'accord expirera alors de lui-même, à sa date.
    const aRefermer = typeof connexion.session_id === "string" && typeof connexion.valide_jusqu_au === "string" &&
      Date.parse(connexion.valide_jusqu_au) > Date.now()
    if (aRefermer && payload.forcer !== true) {
      const { jeton, refus } = await signer()
      const r = jeton ? await appeler(action, "DELETE", `/sessions/${encodeURIComponent(String(connexion.session_id))}`, jeton) : null
      if (!r || (!reussi(r) && r.statut !== 404)) {
        return json({
          error: `La banque n'a pas pu être prévenue du retrait${refus ? ` (${refus})` : ""} : l'accord reste ouvert chez ` +
            "elle. Réessaie, ou retire quand même — l'accord expirera alors de lui-même à sa date.",
          fermeture_impossible: true,
        }, 502)
      }
    }
    const { error } = await admin.from("connexions_bancaires").delete().eq("id", connexion.id)
    if (error) return json({ error: `La connexion n'a pas pu être retirée (${error.message}).` }, 500)
    return json({ ok: true })
  }

  const { jeton, refus } = await signer()
  if (!jeton) return json({ error: refus, non_configuree: true }, 503)

  if (action === "banques") {
    const pays = paysDemande(payload.pays)
    if (!pays) return json({ error: "Pays inconnu." }, 400)
    const [application, liste] = await Promise.all([
      appeler(action, "GET", "/application", jeton),
      appeler(action, "GET", `/aspsps?country=${pays}&service=AIS`, jeton),
    ])
    if (!reussi(application)) return erreurPrestataire(application)
    if (!reussi(liste)) return erreurPrestataire(liste)
    const banques = banquesDeLaListe(liste.donnees)
    console.log(`[banque-connexion] banques : ${banques.length} proposée(s)`)
    return json({ environnement: environnementDe(application.donnees), banques })
  }

  if (action === "demarrer") {
    // Renouveler : la MÊME banque et le même espace, et la connexion reste active jusqu'au retour — une
    // demande abandonnée ne coupe rien. Sinon : une connexion nouvelle, ou la demande précédente reprise.
    const renouveler = payload.renouveler === true
    let banqueNom: string
    let banquePays: string
    let typeAcces: string
    if (renouveler) {
      if (!connexion || connexion.etat !== "active") return json({ error: "Aucune banque connectée à renouveler." }, 409)
      banqueNom = String(connexion.banque_nom)
      banquePays = String(connexion.banque_pays)
      typeAcces = String(connexion.type_acces)
    } else {
      if (connexion?.etat === "active") {
        return json({ error: "Une banque est déjà connectée à ce dossier : retire-la d'abord, ou renouvelle son accord." }, 409)
      }
      const banque = (payload.banque ?? {}) as { nom?: unknown; pays?: unknown }
      banqueNom = typeof banque.nom === "string" ? banque.nom.trim() : ""
      const pays = paysDemande(banque.pays)
      if (!banqueNom || !pays) return json({ error: "Choisis la banque à connecter." }, 400)
      banquePays = pays
      typeAcces = typeof payload.type_acces === "string" ? payload.type_acces : ""
    }

    const [application, liste] = await Promise.all([
      appeler(action, "GET", "/application", jeton),
      appeler(action, "GET", `/aspsps?country=${banquePays}&service=AIS`, jeton),
    ])
    if (!reussi(application)) return erreurPrestataire(application)
    if (!reussi(liste)) return erreurPrestataire(liste)
    const environnement = environnementDe(application.donnees)
    if (!environnement) return json({ error: "Le prestataire n'a pas dit dans quel environnement tourne l'application." }, 502)
    const retours = (application.donnees as { redirect_urls?: unknown } | null)?.redirect_urls
    if (!Array.isArray(retours) || !retours.includes(URL_RETOUR)) {
      return json({
        error: `L'adresse de retour ${URL_RETOUR} n'est pas déclarée dans l'application chez Enable Banking : ` +
          "la banque ne saurait pas où renvoyer. Elle s'ajoute dans le panneau de contrôle d'Enable Banking.",
      }, 409)
    }
    const aspsps = ((liste.donnees ?? {}) as { aspsps?: unknown }).aspsps
    const aspsp = (Array.isArray(aspsps) ? aspsps : []).find((v) => {
      const b = (v ?? {}) as Record<string, unknown>
      return b.name === banqueNom && b.country === banquePays
    }) as Record<string, unknown> | undefined
    if (!aspsp) return json({ error: "Cette banque n'est plus proposée par le prestataire." }, 404)
    const typesBanque = Array.isArray(aspsp.psu_types) ? TYPES_ACCES.filter((t) => (aspsp.psu_types as unknown[]).includes(t)) : []
    if (!typesBanque.includes(typeAcces)) {
      return json({ error: "Cet espace de connexion n'est pas proposé par cette banque : choisis-en un autre." }, 400)
    }

    const jetonEtat = crypto.randomUUID()
    if (renouveler) {
      const { data, error } = await admin.from("connexions_bancaires")
        .update({ jeton_etat: jetonEtat }).eq("id", connexion!.id).eq("etat", "active").select("id").maybeSingle()
      if (error) return json({ error: `La demande n'a pas pu être enregistrée (${error.message}).` }, 500)
      if (!data) return json({ error: "La connexion a changé entre-temps : recharge la page." }, 409)
    } else if (connexion) {
      const { data, error } = await admin.from("connexions_bancaires")
        .update({ banque_nom: banqueNom, banque_pays: banquePays, type_acces: typeAcces, environnement, jeton_etat: jetonEtat, created_by: utilisateur })
        .eq("id", connexion.id).eq("etat", "en_attente").select("id").maybeSingle()
      if (error) return json({ error: `La demande n'a pas pu être enregistrée (${error.message}).` }, 500)
      if (!data) return json({ error: "La connexion a changé entre-temps : recharge la page." }, 409)
    } else {
      const { error } = await admin.from("connexions_bancaires").insert({
        dossier_id: dossierId, banque_nom: banqueNom, banque_pays: banquePays, type_acces: typeAcces,
        environnement, jeton_etat: jetonEtat, created_by: utilisateur,
      })
      if (error?.code === "23505") return json({ error: "Une connexion vient d'être lancée pour ce dossier : recharge la page." }, 409)
      if (error) return json({ error: `La demande n'a pas pu être enregistrée (${error.message}).` }, 500)
    }

    const demande = await appeler(action, "POST", "/auth", jeton, {
      access: { valid_until: finAccordDemandee(aspsp.maximum_consent_validity, Date.now()), transactions: true },
      aspsp: { name: banqueNom, country: banquePays },
      state: jetonEtat,
      redirect_url: URL_RETOUR,
      psu_type: typeAcces,
      language: "fr",
    })
    const url = (demande.donnees as { url?: unknown } | null)?.url
    if (!reussi(demande) || typeof url !== "string" || !url.startsWith("https://")) {
      return reussi(demande) ? json({ error: "Le prestataire n'a pas donné l'adresse de la banque." }, 502) : erreurPrestataire(demande)
    }
    return json({ url, environnement })
  }

  if (action === "finaliser") {
    const code = typeof payload.code === "string" ? payload.code.trim() : ""
    if (!code || code.length > 2000) return json({ error: "Retour de banque sans code d'autorisation." }, 400)
    // Le code ne vit que quelques minutes : la session s'ouvre d'abord, le reste attend.
    const session = await appeler(action, "POST", "/sessions", jeton, { code })
    if (!reussi(session)) return erreurPrestataire(session)
    const ouverte = (session.donnees ?? {}) as { session_id?: unknown; accounts?: unknown; access?: { valid_until?: unknown } }
    const sessionId = typeof ouverte.session_id === "string" && ouverte.session_id !== "" ? ouverte.session_id : null
    const validite = typeof ouverte.access?.valid_until === "string" ? ouverte.access.valid_until : ""
    if (!sessionId || Number.isNaN(Date.parse(validite))) {
      return json({ error: "Le prestataire a ouvert l'accès sans dire lequel ni jusqu'à quand : réessaie la connexion." }, 502)
    }
    const comptes = comptesDeLaSession(ouverte.accounts)
    // Un RENOUVELLEMENT retrouve le compte qu'on importait à son empreinte, qui ne change pas d'une session
    // à l'autre. Une première connexion laisse le choix à l'écran : rien ne se décide ici.
    const retrouve = typeof connexion!.compte_empreinte === "string"
      ? comptes.find((c) => c.empreinte === connexion!.compte_empreinte && c.uid !== null) : undefined
    const application = await appeler(action, "GET", "/application", jeton)
    const environnement = environnementDe(application.donnees) ?? String(connexion!.environnement)
    const ancienneSession = typeof connexion!.session_id === "string" ? connexion!.session_id : null

    // Écrite SEULEMENT si la demande est toujours celle qu'on finalise — sinon une autre l'a remplacée
    // entre-temps, et c'est elle qui décide. Le jeton de retour change au passage : il ne sert qu'une fois.
    const { data: majData, error: majErreur } = await admin.from("connexions_bancaires")
      .update({
        etat: "active", session_id: sessionId, valide_jusqu_au: validite, comptes, environnement,
        compte_uid: retrouve?.uid ?? null, compte_empreinte: retrouve?.empreinte ?? null,
        jeton_etat: crypto.randomUUID(),
      })
      .eq("id", connexion!.id).eq("jeton_etat", String(connexion!.jeton_etat)).select("id").maybeSingle()
    if (majErreur || !majData) {
      // La session ouverte n'est enregistrée nulle part : elle est refermée, sinon elle resterait ouverte
      // chez la banque jusqu'à son terme sans que rien ne la désigne.
      const fermeture = await appeler(action, "DELETE", `/sessions/${encodeURIComponent(sessionId)}`, jeton)
      const suite = reussi(fermeture) ? "" : " L'accord ouvert chez la banque n'a pas pu être refermé : il expirera de lui-même."
      return majErreur
        ? json({ error: `La connexion n'a pas pu être enregistrée (${majErreur.message}).${suite}` }, 500)
        : json({ error: `Une autre demande de connexion a remplacé celle-ci entre-temps.${suite}` }, 409)
    }
    // L'accord qu'un renouvellement remplace ne sert plus : il est refermé.
    let avertissement: string | null = null
    if (ancienneSession && ancienneSession !== sessionId) {
      const r = await appeler(action, "DELETE", `/sessions/${encodeURIComponent(ancienneSession)}`, jeton)
      if (!reussi(r) && r.statut !== 404) {
        avertissement = "L'accord précédent n'a pas pu être refermé chez la banque : il expirera de lui-même."
      }
    }
    console.log(`[banque-connexion] finaliser : ${comptes.length} compte(s) ouvert(s), compte repris : ${retrouve ? "oui" : "non"}`)
    return json({ dossierId, renouvellement: ancienneSession !== null, compte_repris: !!retrouve, avertissement })
  }

  if (action === "choisir_compte") {
    if (!connexion || connexion.etat !== "active") return json({ error: "Aucune banque n'est connectée à ce dossier." }, 409)
    const empreinte = typeof payload.empreinte === "string" ? payload.empreinte : ""
    const compte = comptesGardes(connexion.comptes).find((c) => c.empreinte === empreinte)
    if (!compte) return json({ error: "Ce compte n'est pas ouvert par l'accord de la banque." }, 404)
    if (!compte.uid) return json({ error: "La banque ne donne pas les mouvements de ce compte (fermé ou bloqué)." }, 409)
    if (compte.devise !== "EUR") return json({ error: "Ce compte n'est pas tenu en euros : l'application ne tient qu'un relevé en euros." }, 409)
    const { data, error } = await admin.from("connexions_bancaires")
      .update({ compte_uid: compte.uid, compte_empreinte: compte.empreinte })
      .eq("id", connexion.id).eq("etat", "active").select("id").maybeSingle()
    if (error) return json({ error: `Le compte n'a pas pu être retenu (${error.message}).` }, 500)
    if (!data) return json({ error: "La connexion a changé entre-temps : recharge la page." }, 409)
    return json({ ok: true })
  }

  // action === "mouvements"
  if (!connexion || connexion.etat !== "active") return json({ error: "Aucune banque n'est connectée à ce dossier." }, 409)
  if (typeof connexion.compte_uid !== "string" || typeof connexion.compte_empreinte !== "string") {
    return json({ error: "Choisis d'abord le compte dont importer les mouvements." }, 409)
  }
  if (typeof connexion.valide_jusqu_au !== "string" || Date.parse(connexion.valide_jusqu_au) <= Date.now()) {
    return json({ error: "L'accord de la banque a expiré : renouvelle-le pour récupérer les mouvements.", accord_expire: true }, 409)
  }
  const du = payload.du
  const au = payload.au
  const refusDates = refusPeriode(du, au, aujourdHuiCabinet(new Date()))
  if (refusDates) return json({ error: refusDates }, 400)
  const compteUid = connexion.compte_uid
  const compteEmpreinte = connexion.compte_empreinte

  let lecture: Awaited<ReturnType<typeof toutesLesPages>>
  try {
    lecture = await toutesLesPages(async (cleSuite) => {
      const parametres = new URLSearchParams({ date_from: String(du), date_to: String(au) })
      if (cleSuite) parametres.set("continuation_key", cleSuite)
      const r = await appeler(action, "GET", `/accounts/${encodeURIComponent(compteUid)}/transactions?${parametres}`, jeton)
      if (!reussi(r)) throw new ErreurPrestataire(r)
      return (r.donnees ?? {}) as PageBanque
    }, { maxPages: MAX_PAGES, echeance: debut + BUDGET_PAGES_MS, maintenant: () => Date.now() })
  } catch (e) {
    if (e instanceof ErreurPrestataire) return erreurPrestataire(e.reponse)
    console.error(`[banque-connexion] mouvements : lecture interrompue (${(e as { name?: unknown })?.name ?? "?"})`)
    return json({ error: "La lecture des mouvements s'est interrompue : réessaie." }, 500)
  }
  const { mouvements, ecartes } = await mouvementsDuCompte(lecture.transactions, compteEmpreinte, String(du), String(au))
  console.log(`[banque-connexion] mouvements : ${lecture.pages} page(s), ${lecture.transactions.length} lu(s), ` +
    `${mouvements.length} rendu(s), ${lecture.complete ? "complet" : "incomplet"}`)

  let avertissement: string | null = null
  if (lecture.complete) {
    const { error } = await admin.from("connexions_bancaires")
      .update({ derniere_recuperation: new Date().toISOString() }).eq("id", connexion.id)
    if (error) {
      console.error("[banque-connexion] mouvements : date de récupération non enregistrée")
      avertissement = "La date de cette récupération n'a pas pu être enregistrée ; les mouvements, eux, sont là."
    }
  }
  const compte = comptesGardes(connexion.comptes).find((c) => c.empreinte === compteEmpreinte)
  return json({
    du, au,
    complete: lecture.complete,
    motif: lecture.motif,
    mouvements,
    ecartes,
    banque_nom: connexion.banque_nom,
    environnement: connexion.environnement,
    compte: compte ? { nom: compte.nom, iban_fin: compte.iban_fin } : null,
    avertissement,
  })
})
