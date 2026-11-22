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
// traitement. Elle utilise la clé secrète Supabase pour écrire directement en base et au storage,
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

// Doit lister TOUTES les classifications que rend `extract-piece`, y compris celles ajoutées après
// coup : cette union était restée à quatre valeurs alors que la classification en rendait six, et un
// type qui ment ne protège de rien — c'est ce qui a laissé passer le défaut corrigé plus bas.
interface ExtractionPiece {
  classification: "releve_bancaire" | "cotisation" | "attestation" | "autre" | "facture" | "facture_vente"
  date_piece: string | null
  tiers: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  confiance: "haute" | "moyenne" | "basse"
  // La date vient de la règle de dernier recours (la première du document) : la confiance écrite ne dépasse alors pas
  // « moyenne » (`confianceDeLExtraction`, bloc dateDeduite plus bas).
  _date_deduite?: boolean
}

// Où va un document une fois classé, et sous quelle forme. Copie assumée de `orientationDe`
// (src/lib/extraction.ts) : cette fonction est auto-portée, elle ne peut rien importer de src/.
//
// **C'est la troisième copie de cette règle, et celle qui a été oubliée.** `depot.ts` et
// `importFichiers.ts` ont été unifiés derrière `orientationDe` quand les bordereaux de
// télétransmission sont devenus des recettes ; ce chemin-ci, lui, est resté sur son test binaire
// `classification === "facture"`. Conséquence en production : un bordereau reçu par e-mail tombait
// dans la branche « Documents » avec `categorie: "facture_vente"`, une valeur que le CHECK de
// `documents_divers` refuse — l'insertion échouait, la pièce jointe était perdue et le fichier restait
// orphelin dans le stockage. Le client envoyait son bordereau, rien n'arrivait, et seul un
// `console.error` en gardait trace.
//
// La leçon tient en une ligne : une règle dupliquée se corrige dans TOUTES ses copies le même jour.
// `receiveEmailOrientation.test.ts` lit désormais cette source-ci et la source de `src/lib` pour
// vérifier qu'elles rendent la même chose sur toutes les classifications.
type ClassificationDocument = ExtractionPiece["classification"]
type CategorieDocument = "releve_bancaire" | "cotisation" | "attestation" | "autre"
type Orientation =
  | { destination: "pieces"; type_piece: "achat" | "vente" }
  | { destination: "documents"; categorie: CategorieDocument }

function orientationDe(classification: ClassificationDocument): Orientation {
  if (classification === "facture") return { destination: "pieces", type_piece: "achat" }
  if (classification === "facture_vente") return { destination: "pieces", type_piece: "vente" }
  return { destination: "documents", categorie: classification }
}

// Même appel que celui que fait le navigateur (lib/extraction.ts côté client) mais depuis le serveur —
// pas de session utilisateur ici, donc la clé secrète sert d'autorisation. Elle part dans l'en-tête
// `apikey` et nulle part ailleurs : ce n'est pas un jeton, et la plateforme refuse une clé de cette
// forme en `Authorization` (voir `appelantAutorise` dans extract-piece). Best-effort : un échec
// (Textract, format refusé...) ne doit pas bloquer l'import, juste laisser les champs vides à compléter
// à la main, comme pour un dépôt manuel dont l'extraction aurait échoué. Mais un refus se JOURNALISE :
// muet, un changement de contrat entre les deux fonctions ferait arriver chaque pièce jointe sans
// lecture, et rien ne le dirait.
async function classifierEtExtraire(bytes: Uint8Array, supabaseUrl: string, cleSecrete: string): Promise<ExtractionPiece | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/extract-piece`, {
      method: "POST",
      headers: { apikey: cleSecrete },
      body: bytes,
    })
    if (!res.ok) {
      console.error(`[receive-email] extract-piece a répondu ${res.status} : pièce jointe déposée sans lecture`)
      return null
    }
    const result = await res.json()
    return result.error ? null : result
  } catch (err) {
    console.error("Appel extract-piece échoué:", err)
    return null
  }
}

// LA TRACE D'UNE PIÈCE JOINTE ÉCARTÉE (ligne 22.7 ; décision du cabinet du 13/10/2026, S226-Q3). Écartée sans trace,
// elle manquait à tout le monde : le client croyait l'avoir envoyée, le cabinet n'en savait rien — le journal de la
// fonction ne se garde qu'un temps et ne s'ouvre pas depuis l'application. Une ligne par pièce jointe dans
// `pieces_jointes_ecartees`, que l'onglet Justificatifs du cabinet lit : le dossier, la raison, le poids — jamais le nom
// du fichier, son extension, l'expéditeur ni l'objet. Resend rejoue le webhook quand la fonction échoue en cours de
// route : la clé — le dossier, et l'EMPREINTE des deux identifiants que Resend donne à la pièce jointe, jamais ces
// identifiants eux-mêmes, qui désigneraient un e-mail qu'on peut relire chez Resend — fait qu'un rejeu n'écrit rien de
// plus (`on conflict do nothing`). L'erreur se lit et se journalise sans lever — ce qui lèverait en chemin aussi : rien
// ne recharge derrière, et la pièce jointe suivante se traite.
//
// LE DÉPÔT QUI A ÉCHOUÉ (ligne 22.8 ; décision du cabinet du 13/10/2026, S227-Q3). Les autres pertes d'une pièce jointe
// — Resend ne la rend pas, son téléchargement échoue, la recherche de doublon tombe, le stockage ou l'insertion refusent,
// une exception — n'avaient, elles aussi, que le journal : la fonction répond 200, et Resend ne rejoue pas. Elles
// s'écrivent sous la raison `depot`, avec le poids de la pièce jointe s'il a été lu, INCONNU (null) sinon — jamais
// deviné : la migration `pieces_jointes_ecartees_depot` ne l'admet que pour cette raison. Une pièce jointe déjà au
// dossier (même empreinte) n'est pas une perte : rien ne s'écrit.
//
// LA PIÈCE JOINTE ARRIVÉE VIDE (ligne 22.91 ; décision du cabinet du 13/10/2026, S228-Q2). Une pièce jointe de 0 octet
// n'était que sautée : elle s'écrit sous la raison `vide`, au poids ZÉRO — la migration `pieces_jointes_ecartees_vide`
// n'admet zéro que pour elle, et ne l'admet pas d'un autre poids.
async function noterLaPieceJointeEcartee(
  supabase: ReturnType<typeof createClient>, dossierId: string, emailId: string, pieceJointeId: string,
  raison: "format" | "taille" | "depot" | "vide" | "bordereau", octets: number | null,
): Promise<void> {
  let erreur: string | null
  try {
    const empreinte = await hashBytes(new TextEncoder().encode(JSON.stringify([emailId, pieceJointeId])))
    const { error } = await supabase
      .from("pieces_jointes_ecartees")
      .upsert({ dossier_id: dossierId, raison, octets, empreinte }, { onConflict: "dossier_id,empreinte", ignoreDuplicates: true })
    erreur = error ? error.message : null
  } catch (err) {
    erreur = String(err)
  }
  if (erreur !== null) {
    console.error(`[receive-email] pièce jointe écartée NON consignée (${raison}, ${octets === null ? "poids inconnu" : `${octets} octets`}) : ${erreur}`)
  }
}

// LES ÉLÉMENTS DE L'E-MAIL QUI NE SONT PAS DES PIÈCES JOINTES, COMPTÉS AU JOURNAL (ligne 22.92 ; décision du cabinet du
// 13/10/2026, S228-Q4). Resend range dans `attachments` tout fichier que porte l'e-mail, chacun avec sa disposition et
// son type DÉCLARÉ (documentation publique de l'événement `email.received` : resend.com/docs/webhooks/emails/received,
// dont l'exemple porte une image « inline ») ; la boucle de dépôt ne prend que
// les vraies pièces jointes (`"attachment"`), et les autres partaient sans aucune trace — or un PDF « inline » peut être
// une facture que le client croit avoir envoyée. Avant de décider, le cabinet veut les COMPTER sur les e-mails réels :
// leur nombre, par disposition (inline, une autre, aucune) et par famille de type DÉCLARÉ (PDF, image, autre). Ce type
// n'est ici qu'un compte, jamais une décision de dépôt — celle-ci se prend sur le nom et les octets (bornes des seaux,
// ligne 22.6). Rien n'est lu chez Resend, téléchargé, déposé ni écrit en base pour eux ; et la ligne ne porte ni leur
// nom, ni leur identifiant, ni leur disposition ou leur type tels quels — un en-tête MIME peut porter le nom du fichier
// (`name=`, `filename=`) — : des comptes seulement.
type DispositionComptee = "inline" | "autre" | "aucune"
type FamilleComptee = "pdf" | "image" | "autre"

function dispositionComptee(brute: unknown): DispositionComptee {
  if (brute === undefined || brute === null || brute === "") return "aucune"
  if (typeof brute !== "string") return "autre"
  return brute.split(";")[0].trim().toLowerCase() === "inline" ? "inline" : "autre"
}

function familleComptee(brut: unknown): FamilleComptee {
  if (typeof brut !== "string") return "autre"
  const type = brut.split(";")[0].trim().toLowerCase()
  if (type === "application/pdf") return "pdf"
  return type.startsWith("image/") ? "image" : "autre"
}

/** Ce que le journal dit des éléments de `attachments` qui ne sont pas des pièces jointes : des comptes, sans nom. */
function compteDesElementsIntegres(elements: readonly unknown[]): string {
  const comptes: Record<DispositionComptee, Record<FamilleComptee, number>> = {
    inline: { pdf: 0, image: 0, autre: 0 }, autre: { pdf: 0, image: 0, autre: 0 }, aucune: { pdf: 0, image: 0, autre: 0 },
  }
  let total = 0
  for (const element of elements) {
    const e = (element !== null && typeof element === "object" ? element : {}) as Record<string, unknown>
    // Le complément EXACT du filtre des pièces jointes : tout ce qui n'est pas `"attachment"`, l'absence comprise.
    if (e.content_disposition === "attachment") continue
    comptes[dispositionComptee(e.content_disposition)][familleComptee(e.content_type)] += 1
    total += 1
  }
  const dits = (d: DispositionComptee) => {
    const c = comptes[d]
    return `${c.pdf + c.image + c.autre} (PDF ${c.pdf}, image ${c.image}, autre ${c.autre})`
  }
  return `${total} élément(s) de l'e-mail hors pièces jointes, non déposé(s) — inline ${dits("inline")} ; `
    + `autre disposition ${dits("autre")} ; sans disposition ${dits("aucune")}`
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

// ── DÉBUT COPIE bornesDesPieces ──────────────────────────────────────────────────────────────────────────────────────
// LA BORNE D'UNE PIÈCE ET LE TYPE SOUS LEQUEL ELLE SE DÉPOSE (ligne 22.6). L'original vit dans src/lib/bornesStockage.ts ;
// il est copié À L'IDENTIQUE dans receive-email, auto-portée, et bornesDesPiecesCopie.test.ts compare la copie au
// caractère près et l'exécute contre l'original.

/**
 * La plus grande pièce déposée, 20 Mio (20 971 520 octets) : décision du cabinet du 13/10/2026 (S226-Q1), la borne que
 * receive-email appliquait déjà aux pièces jointes. Au-dessus du plus gros fichier d'aujourd'hui (1,4 Mo) et d'une photo
 * de téléphone (3 à 15 Mo), en dessous du plafond du plan gratuit (50 Mo) ; la lecture automatique, elle, s'arrête à
 * 10 Mio (extract-piece). La changer, c'est la changer ici, dans cette copie, et par une nouvelle migration du seau :
 * `bornes_du_stockage` est appliquée.
 */
export const TAILLE_MAX_PIECE = 20 * 1024 * 1024

/** Le type d'une pièce d'après son extension : celles que l'application accepte depuis toujours. */
const TYPES_PAR_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['csv', 'text/csv'],
])

/** Le type d'une pièce d'après ses premiers octets, quand son nom ne le dit pas : PDF, JPEG ou PNG. */
function typeParSignature(o: Uint8Array): string | null {
  if (o[0] === 0x25 && o[1] === 0x50 && o[2] === 0x44 && o[3] === 0x46) return 'application/pdf'
  if (o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'image/jpeg'
  if (o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47) return 'image/png'
  return null
}

/**
 * Le type sous lequel une pièce se dépose, ou null si l'application ne la prend pas : son extension d'abord, comme
 * l'import l'a toujours fait ; sinon sa signature — un PDF renommé sans extension reste un PDF. Le type que déclare le
 * navigateur ou l'expéditeur d'un e-mail ne compte pas.
 */
export function typeDUnePiece(nom: string, debut: Uint8Array): string | null {
  const point = nom.lastIndexOf('.')
  const parExtension = point < 0 ? undefined : TYPES_PAR_EXTENSION.get(nom.slice(point + 1).toLowerCase())
  return parExtension ?? typeParSignature(debut)
}
// ── FIN COPIE bornesDesPieces ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE dateDeduite ──────────────────────────────────────────────────────────────────────────────────────────
// LE PLAFOND D'UNE DATE DÉDUITE, AUX QUATRE CHEMINS QUI ÉCRIVENT UNE EXTRACTION (PIECES-Q1, option (A)). L'original vit dans
// src/lib/dateDeduite.ts ; il est copié À L'IDENTIQUE dans receive-email, auto-portée — le quatrième chemin, la pièce jointe
// reçue par e-mail, qui écrivait la confiance d'extract-piece sans plafond (relecture du 04/11/2026) —, et
// dateDeduiteCopie.test.ts compare la copie au caractère près et l'exécute contre l'original.

/** Ce qu'une extraction dit de sa date et de sa confiance : les seuls champs que la règle lit. */
export interface LectureDeLaDate {
  date_piece: string | null
  _date_deduite?: boolean
}

/** La date de cette extraction vient-elle de la règle de dernier recours ? Seulement si elle en a rendu une. */
export function dateDeduite(extraction: LectureDeLaDate): boolean {
  return extraction._date_deduite === true && !!extraction.date_piece
}

/** La confiance qu'une pièce reçoit de son extraction : « haute » redescend à « moyenne » quand sa date est déduite. */
export function confianceDeLExtraction(
  extraction: LectureDeLaDate & { confiance: 'haute' | 'moyenne' | 'basse' },
): 'haute' | 'moyenne' | 'basse' {
  return dateDeduite(extraction) && extraction.confiance === 'haute' ? 'moyenne' : extraction.confiance
}
// ── FIN COPIE dateDeduite ────────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE formeDUnBordereau ────────────────────────────────────────────────────────────────────────────────────
// LA FORME D'UN BORDEREAU DE TÉLÉTRANSMISSION, ET LES LIGNES D'UNE PAGE (BOR6). Ce bloc est copié À L'IDENTIQUE dans
// receive-email, auto-portée, qui écarte à la réception par e-mail la pièce jointe qui a cette forme (seconde partie de BOR6) ;
// formeDUnBordereauCopie.test.ts compare la copie au caractère près et l'exécute contre l'original. La lecture des
// bordereaux, plus bas, s'en sert telle quelle.

/** Un fragment de texte tel que pdf.js le rend (`getTextContent`), réduit à ce qui sert : le texte et sa position. */
export interface FragmentDeTexte {
  texte: string
  /** L'abscisse du début du fragment (`transform[4]`). */
  x: number
  /** L'ordonnée de la ligne de base (`transform[5]`), qui croît vers le haut de la page. */
  y: number
  /** La largeur du fragment, quand pdf.js la donne : deux fragments qui se touchent se recollent sans espace. */
  largeur?: number
  /** La hauteur du fragment, quand pdf.js la donne : elle règle la tolérance d'une ligne. */
  hauteur?: number
}

/** Une page : ses lignes déjà recomposées, ou ses fragments positionnés. */
export type PageDeTexte = { lignes: readonly string[] } | { fragments: readonly FragmentDeTexte[] }

// ── La normalisation : minuscules, sans accents, espaces insécables ramenées, espaces réduites. ──

const ESPACES = /[   \t]/g

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(ESPACES, ' ').toLowerCase().replace(/\s+/g, ' ').trim()
}

// ── Les lignes d'une page faite de fragments. ──

/** Les lignes d'une page de fragments : regroupés par ordonnée (du haut vers le bas), puis par abscisse. */
export function lignesDesFragments(fragments: readonly FragmentDeTexte[]): string[] {
  const utiles = fragments.filter((f) => f.texte.trim() !== '' && Number.isFinite(f.x) && Number.isFinite(f.y))
  const parOrdonnee = [...utiles].sort((a, b) => b.y - a.y || a.x - b.x)
  const groupes: FragmentDeTexte[][] = []
  for (const f of parOrdonnee) {
    const courant = groupes[groupes.length - 1]
    const tolerance = Math.max(2, (f.hauteur ?? 0) / 3)
    if (courant !== undefined && Math.abs(courant[0].y - f.y) <= tolerance) courant.push(f)
    else groupes.push([f])
  }
  return groupes.map((groupe) => {
    const tries = [...groupe].sort((a, b) => a.x - b.x)
    let ligne = ''
    let finPrecedente: number | null = null
    for (const f of tries) {
      // Deux fragments qui se touchent (pdf.js coupe parfois un mot) se recollent ; sinon une espace les sépare.
      const colle = finPrecedente !== null && f.largeur !== undefined && f.x - finPrecedente < 0.5
      ligne += (ligne === '' || colle ? '' : ' ') + f.texte
      finPrecedente = f.largeur !== undefined ? f.x + f.largeur : null
    }
    return ligne.replace(ESPACES, ' ').replace(/\s+/g, ' ').trim()
  })
}

const TITRE = 'bordereau de teletransmission'
const ENTETE_DES_COLONNES = 'facture date prescription numero assure nom beneficiaire naissance total caisse mutuelle assure'

function estUnPied(normalisee: string): boolean {
  const reste = normalisee.replace('realise par televitale', ' ').trim()
  if (reste === '') return normalisee !== ''
  return reste.split(' ').every((j) => /^\d{2}\/\d{2}\/\d{4}$/.test(j) || /^\d{1,3}\/\d{1,3}$/.test(j))
}

interface LigneDuFichier {
  page: number
  originale: string
  normalisee: string
  /** La première ligne de sa page qui ne soit ni vide ni un pied. */
  enTeteDePage: boolean
}

function lignesDuFichier(pages: readonly PageDeTexte[]): LigneDuFichier[] {
  const toutes: LigneDuFichier[] = []
  pages.forEach((page, indice) => {
    const brutes = 'lignes' in page ? page.lignes.map((l) => l.replace(ESPACES, ' ').replace(/\s+/g, ' ').trim()) : lignesDesFragments(page.fragments)
    let premiere = true
    for (const originale of brutes) {
      const normalisee = normaliser(originale)
      if (normalisee === '') continue
      const pied = estUnPied(normalisee)
      toutes.push({ page: indice + 1, originale, normalisee, enTeteDePage: premiere && !pied })
      if (!pied) premiere = false
    }
  })
  return toutes
}

/**
 * LA FORME D'UN BORDEREAU, AU DÉPÔT (lot BOR6, BOR-Q9 (A)) : vrai dès qu'une ligne du fichier, sur n'importe quelle page, EST
 * le titre « Bordereau de Teletransmission », ou CONTIENT l'en-tête des colonnes (« … Numéro Assuré Nom Bénéficiaire
 * Naissance … ») — les deux reconnaissances de la lecture ci-dessous, sous la même normalisation, jamais recopiées. Deux
 * signaux indépendants plutôt qu'un : un titre que pdf.js aurait collé à un autre texte de sa ligne laisse l'en-tête des
 * colonnes, propre à un état nominatif. Aucun autre contrôle (ni le lot, ni les totaux) : un bordereau que la lecture
 * refuserait (mal formé, tronqué) porte les mêmes noms, et se refuse au dépôt de même. Le titre n'est cherché qu'en ligne
 * ENTIÈRE : une facture de logiciel qui vend « l'impression du bordereau de télétransmission » ne se refuse pas
 * (refusDesBordereaux.test.ts mesure les faux positifs). Rend un booléen, jamais une ligne.
 */
export function porteLaFormeDUnBordereau(pages: readonly PageDeTexte[]): boolean {
  return lignesDuFichier(pages).some((l) => l.normalisee === TITRE || l.normalisee.includes(ENTETE_DES_COLONNES))
}
// ── FIN COPIE formeDUnBordereau ──────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE texteDUnPdf ──────────────────────────────────────────────────────────────────────────────────────────
// LA COUCHE DE TEXTE D'UN PDF, LUE SANS PDF.JS (conception 59, BOR6, seconde partie : écarter un bordereau de télétransmission
// à la réception par e-mail, AVANT tout dépôt). L'original vit dans src/lib/texteDUnPdf.ts ; il est copié À L'IDENTIQUE dans
// receive-email, auto-portée, et texteDUnPdfCopie.test.ts compare la copie au caractère près et l'exécute contre l'original.
//
// POURQUOI PAS PDF.JS : mesuré le 21/11/2026 (HISTORIQUE.md, « BOR6, SECONDE PARTIE »), pdf.js demande 14,8 s de calcul et
// 420 Mo de mémoire pour un PDF de texte de 5 Mio (3 400 pages), quand une Edge Function n'a que 2 s de calcul et 256 Mo par
// requête ; son code pèse 3,3 Mo. Ce lecteur-ci ne fait que ce que la reconnaissance demande : il trouve les objets du
// fichier (les flux d'objets compris), décompresse les flux par le `DecompressionStream` natif, suit l'arbre des pages, et
// interprète les opérateurs de texte du contenu de chaque page (et de ses formulaires) en fragments positionnés, de la forme
// que pdf.js rend : le texte, l'abscisse et l'ordonnée de son origine, sa largeur quand la police la donne, sa hauteur.
// Les polices simples (WinAnsi, une table « Differences »), composites (Identity-H ou un CMap embarqué), et leur ToUnicode.
//
// CE QU'IL NE LIT PAS, ET QUI REND « ILLISIBLE » OU UN TEXTE VIDE : un fichier chiffré, un filtre autre que FlateDecode,
// ASCIIHexDecode et ASCII85Decode, un prédicteur, une police composite sous un CMap prédéfini autre qu'Identity, une police
// qui ne dit pas ses caractères. Ce qui ne se lit pas ne se reconnaît pas : à la réception, la pièce jointe part comme avant
// (BOR6-Q1 (A)).
//
// BORNÉ : la somme des octets décompressés et la durée de la lecture ont leur plafond, l'horloge est injectée ; au-delà, la
// lecture s'arrête et rend « illisible » sous la raison `borne`. NE REJETTE JAMAIS, et ne rend jamais un morceau du fichier
// dans une raison : les raisons sont des codes fixes. Rien ne sort d'ici : ni réseau, ni journal, ni stockage.

/** Un fragment de texte d'une page, de la forme que pdf.js rend : le texte et sa position. */
export interface FragmentDuPdf {
  texte: string
  x: number
  y: number
  largeur?: number
  hauteur?: number
}

/** Une page lue : ses fragments, dans l'ordre du contenu. */
export interface PageDuPdf {
  fragments: FragmentDuPdf[]
}

export type RaisonIllisible = 'pas-un-pdf' | 'chiffre' | 'sans-page' | 'borne' | 'erreur'

/** `pages` : le nombre de pages lues ; `arrete` : la lecture s'est arrêtée sur la demande de `surLaPage`. */
export type LectureDuTexte = { etat: 'lu'; pages: number; arrete: boolean } | { etat: 'illisible'; raison: RaisonIllisible }

export interface BornesDuTexte {
  /** La somme des octets décompressés, au plus. */
  octetsDecompressesMax: number
  /** La durée de la lecture, au plus, en millisecondes, mesurée par `maintenant`. */
  dureeMaxMs: number
  maintenant: () => number
}

type Valeur = null | boolean | number | Nom | Chaine | Reference | Valeur[] | Dico | Flux
interface Nom { t: 'nom'; v: string }
interface Chaine { t: 'chaine'; v: Uint8Array }
interface Reference { t: 'ref'; n: number }
interface Dico { t: 'dico'; v: Map<string, Valeur> }
interface Flux { t: 'flux'; dico: Dico; debut: number; fin: number; source: Uint8Array }
interface Mot { t: 'mot'; v: string }
type Jeton = number | Nom | Chaine | Mot

function estMot(v: Valeur | Mot | null): v is Mot {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.t === 'mot'
}

/** La lecture s'arrête au-delà d'une borne : levée ici, attrapée en tête, jamais au-dehors. */
class Borne extends Error {}

const ESPACE = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) ESPACE[c] = 1
const DELIMITEUR = new Uint8Array(256)
for (const c of '()<>[]{}/%') DELIMITEUR[c.charCodeAt(0)] = 1

function latin1(o: Uint8Array, debut: number, fin: number): string {
  let s = ''
  for (let i = debut; i < fin; i++) s += String.fromCharCode(o[i])
  return s
}

/** Le lecteur de jetons d'un morceau d'octets, sous la syntaxe des objets et du contenu des pages. */
class Lexeur {
  i: number
  private retour: Jeton[] = []
  /** Faux dans le contenu d'une page, qui ne porte aucune référence : un nombre ne fait pas lire les deux jetons qui suivent. */
  readonly o: Uint8Array
  readonly fin: number
  private readonly references: boolean
  constructor(o: Uint8Array, debut: number, fin: number, references = true) {
    this.o = o
    this.i = debut
    this.fin = fin
    this.references = references
  }

  sauterLesEspaces(): void {
    const o = this.o
    while (this.i < this.fin) {
      const c = o[this.i]
      if (ESPACE[c]) this.i++
      else if (c === 0x25) {
        while (this.i < this.fin && o[this.i] !== 10 && o[this.i] !== 13) this.i++
      } else break
    }
  }

  rendre(j: Jeton): void {
    this.retour.push(j)
  }

  /** Le jeton suivant, ou null à la fin. */
  jeton(): Jeton | null {
    if (this.retour.length > 0) return this.retour.pop() as Jeton
    this.sauterLesEspaces()
    const o = this.o
    if (this.i >= this.fin) return null
    const c = o[this.i]
    if (c === 0x2f) { // nom
      let j = this.i + 1
      let s = ''
      while (j < this.fin && !ESPACE[o[j]] && !DELIMITEUR[o[j]]) {
        if (o[j] === 0x23 && j + 2 < this.fin) {
          const h = parseInt(latin1(o, j + 1, j + 3), 16)
          if (!Number.isNaN(h)) { s += String.fromCharCode(h); j += 3; continue }
        }
        s += String.fromCharCode(o[j])
        j++
      }
      this.i = j
      return { t: 'nom', v: s }
    }
    if (c === 0x28) return this.chaineLitterale()
    if (c === 0x3c) {
      if (o[this.i + 1] === 0x3c) { this.i += 2; return { t: 'mot', v: '<<' } }
      return this.chaineHexa()
    }
    if (c === 0x3e) {
      if (o[this.i + 1] === 0x3e) { this.i += 2; return { t: 'mot', v: '>>' } }
      this.i++
      return { t: 'mot', v: '>' }
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x29) {
      this.i++
      return { t: 'mot', v: String.fromCharCode(c) }
    }
    let j = this.i
    while (j < this.fin && !ESPACE[o[j]] && !DELIMITEUR[o[j]]) j++
    if (j === this.i) j++
    const s = latin1(o, this.i, j)
    this.i = j
    // Un nombre commence par un chiffre, un signe ou un point ; « 12.5.3 » ou « - » restent des mots.
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const n = Number(s)
      if (s.length > 0 && !Number.isNaN(n) && !/[eExX]/.test(s)) return n
    }
    return { t: 'mot', v: s }
  }

  private chaineLitterale(): Chaine {
    const o = this.o
    const sortie: number[] = []
    let profondeur = 1
    let j = this.i + 1
    while (j < this.fin) {
      const c = o[j]
      if (c === 0x5c) {
        const d = o[j + 1]
        j += 2
        if (d === 0x6e) sortie.push(10)
        else if (d === 0x72) sortie.push(13)
        else if (d === 0x74) sortie.push(9)
        else if (d === 0x62) sortie.push(8)
        else if (d === 0x66) sortie.push(12)
        else if (d === 13) { if (o[j] === 10) j++ }
        else if (d === 10) { /* suite de ligne */ }
        else if (d >= 0x30 && d <= 0x37) {
          let v = d - 0x30
          for (let k = 0; k < 2 && o[j] >= 0x30 && o[j] <= 0x37; k++, j++) v = v * 8 + (o[j] - 0x30)
          sortie.push(v & 0xff)
        } else if (d !== undefined) sortie.push(d)
        continue
      }
      if (c === 0x28) profondeur++
      else if (c === 0x29) {
        profondeur--
        if (profondeur === 0) { j++; break }
      }
      sortie.push(c)
      j++
    }
    this.i = j
    return { t: 'chaine', v: Uint8Array.from(sortie) }
  }

  private chaineHexa(): Chaine {
    const o = this.o
    let fin = o.indexOf(0x3e, this.i + 1)
    if (fin < 0 || fin > this.fin) fin = this.fin
    const sortie = new Uint8Array((fin - this.i) >> 1)
    let n = 0
    let moitie = -1
    for (let j = this.i + 1; j < fin; j++) {
      const c = o[j]
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1
      if (v < 0) continue
      if (moitie < 0) moitie = v
      else { sortie[n++] = moitie * 16 + v; moitie = -1 }
    }
    if (moitie >= 0) sortie[n++] = moitie * 16
    this.i = fin + 1
    return { t: 'chaine', v: sortie.subarray(0, n) }
  }

  /** Une valeur entière : un nombre, un nom, une chaîne, un tableau, un dictionnaire, une référence `n g R`. */
  valeur(profondeur = 0): Valeur | Mot | null {
    const j = this.jeton()
    if (j === null) return null
    if (typeof j === 'number') {
      if (!this.references) return j
      const g = this.jeton()
      if (typeof g === 'number' && Number.isInteger(j) && Number.isInteger(g)) {
        const r = this.jeton()
        if (r !== null && typeof r === 'object' && r.t === 'mot' && r.v === 'R') return { t: 'ref', n: j }
        if (r !== null) this.rendre(r)
      }
      if (g !== null) this.rendre(g)
      return j
    }
    if (j.t !== 'mot') return j
    if (profondeur > 64) return null
    if (j.v === '[') {
      const tableau: Valeur[] = []
      for (;;) {
        const v = this.valeur(profondeur + 1)
        if (v === null) return tableau
        if (estMot(v)) {
          if (v.v === ']') return tableau
          continue
        }
        tableau.push(v)
      }
    }
    if (j.v === '<<') {
      const dico = new Map<string, Valeur>()
      for (;;) {
        const cle = this.jeton()
        if (cle === null) return { t: 'dico', v: dico }
        if (typeof cle === 'object' && cle.t === 'mot' && cle.v === '>>') return { t: 'dico', v: dico }
        if (typeof cle !== 'object' || cle.t !== 'nom') continue
        const v = this.valeur(profondeur + 1)
        if (v === null) return { t: 'dico', v: dico }
        if (estMot(v)) {
          if (v.v === '>>') return { t: 'dico', v: dico }
          continue
        }
        dico.set(cle.v, v)
      }
    }
    if (j.v === 'true') return true
    if (j.v === 'false') return false
    if (j.v === 'null') return null
    return j
  }
}

const estDico = (v: unknown): v is Dico => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Dico).t === 'dico'
const estFlux = (v: unknown): v is Flux => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Flux).t === 'flux'
const nomDe = (v: unknown): string | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Nom).t === 'nom' ? (v as Nom).v : null

/** Cherche `motif` dans `o` à partir de `depuis`, par la recherche native de son premier octet. */
function chercher(o: Uint8Array, motif: string, depuis: number, fin = o.length): number {
  const premier = motif.charCodeAt(0)
  let i = depuis
  for (;;) {
    i = o.indexOf(premier, i)
    if (i < 0 || i + motif.length > fin) return -1
    let k = 1
    while (k < motif.length && o[i + k] === motif.charCodeAt(k)) k++
    if (k === motif.length) return i
    i++
  }
}

/** Le document : ses objets, lus par leur marque `n g obj`, sans la table des références (souvent fausse, jamais nécessaire). */
class FichierPdf {
  readonly objets = new Map<number, Valeur>()
  chiffre = false
  catalogue: Dico | null = null
  readonly pagesEnVrac: Dico[] = []
  /** Les polices déjà lues, d'une page à l'autre : une police se lit une fois par fichier. */
  readonly polices = new Map<Dico, Police>()
  private octetsRestants: number

  readonly o: Uint8Array
  private readonly bornes: BornesDuTexte
  private readonly debutMs: number
  constructor(o: Uint8Array, bornes: BornesDuTexte, debutMs: number) {
    this.o = o
    this.bornes = bornes
    this.debutMs = debutMs
    this.octetsRestants = bornes.octetsDecompressesMax
  }

  verifierLaDuree(): void {
    if (this.bornes.maintenant() - this.debutMs > this.bornes.dureeMaxMs) throw new Borne()
  }

  /** Les objets du fichier, dans l'ordre : un objet redéfini plus loin (une mise à jour incrémentale) remplace le premier. */
  lireLesObjets(): void {
    const o = this.o
    let i = 0
    for (;;) {
      const j = chercher(o, 'obj', i)
      if (j < 0) break
      i = j + 3
      if (j === 0 || !ESPACE[o[j - 1]] || (j + 3 < o.length && !ESPACE[o[j + 3]] && !DELIMITEUR[o[j + 3]])) continue
      // « n g obj » : deux entiers avant le mot.
      let k = j - 1
      while (k >= 0 && ESPACE[o[k]]) k--
      const finG = k + 1
      while (k >= 0 && o[k] >= 0x30 && o[k] <= 0x39) k--
      if (k + 1 === finG) continue
      const finN = k
      while (k >= 0 && ESPACE[o[k]]) k--
      if (k === finN) continue
      const finNum = k + 1
      while (k >= 0 && o[k] >= 0x30 && o[k] <= 0x39) k--
      if (k + 1 === finNum) continue
      const numero = Number(latin1(o, k + 1, finNum))
      const lexeur = new Lexeur(o, j + 3, o.length)
      const valeur = lexeur.valeur()
      if (estMot(valeur)) continue
      lexeur.sauterLesEspaces()
      let position = lexeur.i
      if (estDico(valeur) && chercher(o, 'stream', position, position + 6) === position) {
        let debut = position + 6
        if (o[debut] === 13) debut++
        if (o[debut] === 10) debut++
        const longueur = valeur.v.get('Length')
        let fin = -1
        if (typeof longueur === 'number' && Number.isInteger(longueur) && longueur >= 0 && debut + longueur <= o.length) {
          let e = debut + longueur
          while (e < o.length && ESPACE[o[e]]) e++
          if (chercher(o, 'endstream', e, e + 9) === e) fin = debut + longueur
        }
        if (fin < 0) {
          const e = chercher(o, 'endstream', debut)
          if (e < 0) continue
          fin = e
          while (fin > debut && (o[fin - 1] === 10 || o[fin - 1] === 13)) fin--
        }
        this.objets.set(numero, { t: 'flux', dico: valeur, debut, fin, source: o })
        position = fin + 9
      } else {
        this.objets.set(numero, valeur as Valeur)
      }
      i = Math.max(i, position)
    }
  }

  /** Le chiffrement se dit dans la remorque, ou dans le dictionnaire d'un flux de références. */
  repererLeChiffrement(): void {
    const o = this.o
    let i = 0
    for (;;) {
      const j = chercher(o, '/Encrypt', i)
      if (j < 0) return
      i = j + 8
      if (i < o.length && !ESPACE[o[i]] && !DELIMITEUR[o[i]]) continue
      this.chiffre = true
      return
    }
  }

  resoudre(v: Valeur | undefined, profondeur = 0): Valeur {
    if (v === undefined) return null
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && v.t === 'ref') {
      if (profondeur > 16) return null
      return this.resoudre(this.objets.get(v.n), profondeur + 1)
    }
    return v
  }

  dans(d: Dico, cle: string): Valeur {
    return this.resoudre(d.v.get(cle))
  }

  /** Les octets décodés d'un flux, ou null quand un filtre n'est pas lu. Lève `Borne` au-delà du plafond des octets. */
  async decoder(f: Flux): Promise<Uint8Array | null> {
    let donnees = f.source.subarray(f.debut, f.fin)
    const filtre = this.dans(f.dico, 'Filter')
    const filtres = (Array.isArray(filtre) ? filtre : filtre === null ? [] : [filtre]).map((x) => nomDe(this.resoudre(x)))
    const parametres = this.dans(f.dico, 'DecodeParms')
    const listeParametres = Array.isArray(parametres) ? parametres : [parametres]
    for (let k = 0; k < filtres.length; k++) {
      const p = this.resoudre(listeParametres[k] ?? null)
      if (estDico(p)) {
        const predicteur = this.dans(p, 'Predictor')
        if (typeof predicteur === 'number' && predicteur > 1) return null
      }
      const nom = filtres[k]
      if (nom === 'FlateDecode' || nom === 'Fl') {
        const sortie = await this.inflater(donnees)
        if (sortie === null) return null
        donnees = sortie
      } else if (nom === 'ASCIIHexDecode' || nom === 'AHx') {
        const hexa = new Uint8Array(donnees.length + 1)
        hexa[0] = 0x3c
        hexa.set(donnees, 1)
        const j = new Lexeur(hexa, 0, hexa.length).jeton()
        donnees = typeof j === 'object' && j !== null && j.t === 'chaine' ? j.v : new Uint8Array(0)
      } else if (nom === 'ASCII85Decode' || nom === 'A85') {
        donnees = ascii85(donnees)
      } else {
        return null
      }
      this.octetsRestants -= donnees.length
      if (this.octetsRestants < 0) throw new Borne()
    }
    this.verifierLaDuree()
    return donnees
  }

  private async inflater(donnees: Uint8Array): Promise<Uint8Array | null> {
    for (const format of ['deflate', 'deflate-raw'] as const) {
      const morceaux: Uint8Array[] = []
      let total = 0
      let depasse = false
      try {
        const lecteur = new Blob([donnees.slice()]).stream().pipeThrough(new DecompressionStream(format)).getReader()
        for (;;) {
          const { done, value } = await lecteur.read()
          if (done) break
          total += value.length
          if (total > this.octetsRestants) {
            await lecteur.cancel().catch(() => undefined)
            depasse = true
            break
          }
          morceaux.push(value)
        }
      } catch {
        // Un flux tronqué ou suivi d'octets en trop : ce qui a été décompressé se garde, comme pdf.js le fait.
        if (total === 0) continue
      }
      if (depasse) throw new Borne()
      const sortie = new Uint8Array(total)
      let position = 0
      for (const m of morceaux) { sortie.set(m, position); position += m.length }
      return sortie
    }
    return null
  }

  /** Les objets des flux d'objets (PDF 1.5) qu'aucun objet direct ne définit déjà. */
  async lireLesFluxDObjets(): Promise<void> {
    const flux = [...this.objets.values()].filter((v): v is Flux => estFlux(v) && nomDe(this.dans(v.dico, 'Type')) === 'ObjStm')
    for (const f of flux) {
      const octets = await this.decoder(f)
      const n = this.dans(f.dico, 'N')
      const premier = this.dans(f.dico, 'First')
      if (octets === null || typeof n !== 'number' || typeof premier !== 'number') continue
      const entete = new Lexeur(octets, 0, Math.min(premier, octets.length))
      const paires: [number, number][] = []
      for (let k = 0; k < n && k < 100_000; k++) {
        const numero = entete.jeton()
        const decalage = entete.jeton()
        if (typeof numero !== 'number' || typeof decalage !== 'number') break
        paires.push([numero, decalage])
      }
      for (const [numero, decalage] of paires) {
        if (this.objets.has(numero) || premier + decalage >= octets.length) continue
        const v = new Lexeur(octets, premier + decalage, octets.length).valeur()
        if (estMot(v)) continue
        this.objets.set(numero, v as Valeur)
      }
    }
    for (const v of this.objets.values()) {
      if (!estDico(v)) continue
      const type = nomDe(this.dans(v, 'Type'))
      if (type === 'Catalog' && this.catalogue === null) this.catalogue = v
      if (type === 'Page') this.pagesEnVrac.push(v)
    }
  }

  /** Les pages dans l'ordre de l'arbre ; à défaut d'arbre lisible, dans l'ordre du fichier. */
  pages(): Dico[] {
    const vues = new Set<Dico>()
    const rangees: Dico[] = []
    const parcourir = (noeud: Valeur, profondeur: number) => {
      if (!estDico(noeud) || vues.has(noeud) || profondeur > 32) return
      vues.add(noeud)
      const kids = this.dans(noeud, 'Kids')
      if (Array.isArray(kids)) for (const k of kids) parcourir(this.resoudre(k), profondeur + 1)
      else if (nomDe(this.dans(noeud, 'Type')) === 'Page' || this.dans(noeud, 'Contents') !== null) rangees.push(noeud)
    }
    if (this.catalogue !== null) parcourir(this.dans(this.catalogue, 'Pages'), 0)
    return rangees.length > 0 ? rangees : this.pagesEnVrac
  }

  /** Une clé d'une page, héritée de ses parents quand elle ne la porte pas (les ressources). */
  herite(page: Dico, cle: string): Valeur {
    let noeud: Valeur = page
    for (let k = 0; k < 32 && estDico(noeud); k++) {
      const v = this.dans(noeud, cle)
      if (v !== null) return v
      noeud = this.dans(noeud, 'Parent')
    }
    return null
  }
}

function ascii85(o: Uint8Array): Uint8Array {
  const sortie: number[] = []
  let groupe: number[] = []
  for (let i = 0; i < o.length; i++) {
    const c = o[i]
    if (c === 0x7e) break
    if (ESPACE[c]) continue
    if (c === 0x7a && groupe.length === 0) { sortie.push(0, 0, 0, 0); continue }
    if (c < 0x21 || c > 0x75) continue
    groupe.push(c - 0x21)
    if (groupe.length === 5) {
      let v = 0
      for (const g of groupe) v = v * 85 + g
      sortie.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
      groupe = []
    }
  }
  if (groupe.length > 1) {
    const n = groupe.length
    while (groupe.length < 5) groupe.push(84)
    let v = 0
    for (const g of groupe) v = v * 85 + g
    const octets = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
    sortie.push(...octets.slice(0, n - 1))
  }
  return Uint8Array.from(sortie)
}

// ── Les polices : la longueur d'un code, son texte, sa largeur. ──

/** Les octets 0x80 à 0x9F de WinAnsiEncoding ; le reste est l'ASCII et le Latin-1. */
const WIN_ANSI_80 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const ACCENTS: Record<string, string> = {
  acute: '́', grave: '̀', circumflex: '̂', dieresis: '̈', cedilla: '̧', tilde: '̃', ring: '̊',
}
const NOMS_DE_GLYPHES: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: '\'',
  quoteright: '’', quoteleft: '‘', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-',
  minus: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}',
  germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', fi: 'fi', fl: 'fl', Euro: '€', degree: '°', endash: '–', emdash: '—',
  nbspace: ' ', guillemotleft: '«', guillemotright: '»',
}

function texteDuGlyphe(nom: string): string {
  if (nom.length === 1) return nom
  const connu = NOMS_DE_GLYPHES[nom]
  if (connu !== undefined) return connu
  const accent = /^([A-Za-z])(acute|grave|circumflex|dieresis|cedilla|tilde|ring)$/.exec(nom)
  if (accent !== null) return (accent[1] + ACCENTS[accent[2]]).normalize('NFC')
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(nom) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(nom)
  if (uni !== null) {
    const point = parseInt(uni[1], 16)
    if (point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)) return String.fromCodePoint(point)
  }
  return ''
}

interface PlageDeCodes { octets: number; bas: Uint8Array; haut: Uint8Array }
interface CMapLu {
  plages: PlageDeCodes[]
  unicode: Map<number, string>
  plagesUnicode: { bas: number; haut: number; base: string | string[] }[]
  cid: Map<number, number>
  plagesCid: { bas: number; haut: number; cid: number }[]
}

function versNombre(o: Uint8Array): number {
  let v = 0
  for (const c of o) v = v * 256 + c
  return v
}

function utf16(o: Uint8Array): string {
  let s = ''
  for (let i = 0; i + 1 < o.length; i += 2) s += String.fromCharCode(o[i] * 256 + o[i + 1])
  if (o.length === 1) s += String.fromCharCode(o[0])
  return s
}

/** Un CMap (ToUnicode, ou l'encodage embarqué d'une police composite) : ses plages de codes, ses textes, ses CID. */
function lireCMap(octets: Uint8Array): CMapLu {
  const lu: CMapLu = { plages: [], unicode: new Map(), plagesUnicode: [], cid: new Map(), plagesCid: [] }
  const lexeur = new Lexeur(octets, 0, octets.length)
  const chaine = (v: unknown): Uint8Array | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Chaine).t === 'chaine' ? (v as Chaine).v : null
  let section: string | null = null
  const operandes: (Valeur | Mot)[] = []
  for (let garde = 0; garde < 2_000_000; garde++) {
    const v = lexeur.valeur()
    if (v === null && lexeur.i >= lexeur.fin) break
    if (estMot(v)) {
      if (v.v.startsWith('begin')) { section = v.v; operandes.length = 0; continue }
      if (v.v.startsWith('end')) { section = null; operandes.length = 0; continue }
      continue
    }
    if (section === null) continue
    operandes.push(v)
    if (section === 'begincodespacerange' && operandes.length === 2) {
      const [bas, haut] = operandes.map(chaine)
      if (bas !== null && haut !== null && bas.length === haut.length && bas.length >= 1 && bas.length <= 4) {
        lu.plages.push({ octets: bas.length, bas, haut })
      }
      operandes.length = 0
    } else if (section === 'beginbfchar' && operandes.length === 2) {
      const source = chaine(operandes[0])
      const cible = operandes[1]
      if (source !== null) {
        const texte = chaine(cible)
        if (texte !== null) lu.unicode.set(versNombre(source), utf16(texte))
        else if (nomDe(cible) !== null) lu.unicode.set(versNombre(source), texteDuGlyphe(nomDe(cible) as string))
      }
      operandes.length = 0
    } else if (section === 'beginbfrange' && operandes.length === 3) {
      const [bas, haut] = operandes.slice(0, 2).map(chaine)
      const cible = operandes[2]
      if (bas !== null && haut !== null && lu.plagesUnicode.length < 50_000) {
        const texte = chaine(cible)
        if (texte !== null) lu.plagesUnicode.push({ bas: versNombre(bas), haut: versNombre(haut), base: utf16(texte) })
        else if (Array.isArray(cible)) {
          lu.plagesUnicode.push({ bas: versNombre(bas), haut: versNombre(haut), base: cible.map((c) => utf16(chaine(c) ?? new Uint8Array(0))) })
        }
      }
      operandes.length = 0
    } else if (section === 'begincidchar' && operandes.length === 2) {
      const source = chaine(operandes[0])
      if (source !== null && typeof operandes[1] === 'number') lu.cid.set(versNombre(source), operandes[1])
      operandes.length = 0
    } else if (section === 'begincidrange' && operandes.length === 3) {
      const [bas, haut] = operandes.slice(0, 2).map(chaine)
      if (bas !== null && haut !== null && typeof operandes[2] === 'number' && lu.plagesCid.length < 50_000) {
        lu.plagesCid.push({ bas: versNombre(bas), haut: versNombre(haut), cid: operandes[2] })
      }
      operandes.length = 0
    }
  }
  return lu
}

function texteDuCMap(cmap: CMapLu, code: number): string | undefined {
  const direct = cmap.unicode.get(code)
  if (direct !== undefined) return direct
  for (const p of cmap.plagesUnicode) {
    if (code < p.bas || code > p.haut) continue
    if (Array.isArray(p.base)) return p.base[code - p.bas] ?? ''
    if (p.base === '') return ''
    const dernier = p.base.charCodeAt(p.base.length - 1) + (code - p.bas)
    return p.base.slice(0, -1) + String.fromCharCode(dernier & 0xffff)
  }
  return undefined
}

interface Police {
  /** La longueur, en octets, du code qui commence en `i`. */
  longueur(o: Uint8Array, i: number): number
  texte(code: number): string
  /** La largeur d'un code en millièmes de l'unité de texte, ou undefined quand la police ne la dit pas. */
  largeur(code: number): number | undefined
}

async function lirePolice(doc: FichierPdf, police: Dico): Promise<Police> {
  const sousType = nomDe(doc.dans(police, 'Subtype'))
  const toUnicodeFlux = doc.dans(police, 'ToUnicode')
  const toUnicodeOctets = estFlux(toUnicodeFlux) ? await doc.decoder(toUnicodeFlux) : null
  const toUnicode = toUnicodeOctets === null ? null : lireCMap(toUnicodeOctets)

  if (sousType === 'Type0') {
    const descendantes = doc.dans(police, 'DescendantFonts')
    const descendante = doc.resoudre(Array.isArray(descendantes) ? descendantes[0] : null)
    const encodage = doc.dans(police, 'Encoding')
    const identite = nomDe(encodage) === 'Identity-H' || nomDe(encodage) === 'Identity-V'
    const embarque = estFlux(encodage) ? await doc.decoder(encodage) : null
    const cmapEncodage = embarque === null ? null : lireCMap(embarque)
    const lisible = identite || cmapEncodage !== null
    const plages = cmapEncodage?.plages.length ? cmapEncodage.plages : toUnicode?.plages.length ? toUnicode.plages : null
    const largeurs = new Map<number, number>()
    let parDefaut = 1000
    if (estDico(descendante)) {
      const dw = doc.dans(descendante, 'DW')
      if (typeof dw === 'number') parDefaut = dw
      const w = doc.dans(descendante, 'W')
      if (Array.isArray(w)) {
        for (let k = 0; k < w.length && largeurs.size < 100_000;) {
          const premier = doc.resoudre(w[k])
          const suivant = doc.resoudre(w[k + 1])
          if (typeof premier !== 'number') break
          if (Array.isArray(suivant)) {
            suivant.forEach((l, r) => { const v = doc.resoudre(l); if (typeof v === 'number') largeurs.set(premier + r, v) })
            k += 2
          } else {
            const largeur = doc.resoudre(w[k + 2])
            if (typeof suivant !== 'number' || typeof largeur !== 'number') break
            for (let c = premier; c <= suivant && largeurs.size < 100_000; c++) largeurs.set(c, largeur)
            k += 3
          }
        }
      }
    }
    const cidDe = (code: number): number => {
      if (cmapEncodage === null) return code
      const direct = cmapEncodage.cid.get(code)
      if (direct !== undefined) return direct
      for (const p of cmapEncodage.plagesCid) if (code >= p.bas && code <= p.haut) return p.cid + (code - p.bas)
      return code
    }
    return {
      longueur: (o, i) => longueurParPlages(plages, o, i, 2),
      texte: (code) => (lisible && toUnicode !== null ? texteDuCMap(toUnicode, code) ?? '' : ''),
      largeur: (code) => largeurs.get(cidDe(code)) ?? parDefaut,
    }
  }

  // Une police simple : un octet par code.
  const table: string[] = []
  for (let c = 0; c < 256; c++) table.push(c >= 0x80 && c <= 0x9f ? WIN_ANSI_80[c - 0x80] : String.fromCharCode(c))
  const encodage = doc.dans(police, 'Encoding')
  if (estDico(encodage)) {
    const differences = doc.dans(encodage, 'Differences')
    if (Array.isArray(differences)) {
      let code = 0
      for (const d of differences) {
        const v = doc.resoudre(d)
        if (typeof v === 'number') code = v
        else if (nomDe(v) !== null && code >= 0 && code < 256) table[code++] = texteDuGlyphe(nomDe(v) as string)
      }
    }
  }
  const premier = doc.dans(police, 'FirstChar')
  const largeurs = doc.dans(police, 'Widths')
  const type3 = sousType === 'Type3'
  return {
    longueur: () => 1,
    texte: (code) => (toUnicode !== null ? texteDuCMap(toUnicode, code) : undefined) ?? table[code] ?? '',
    largeur: (code) => {
      if (type3 || !Array.isArray(largeurs) || typeof premier !== 'number') return undefined
      const v = doc.resoudre(largeurs[code - premier])
      return typeof v === 'number' ? v : undefined
    },
  }
}

function longueurParPlages(plages: PlageDeCodes[] | null, o: Uint8Array, i: number, parDefaut: number): number {
  if (plages === null) return parDefaut
  for (let n = 1; n <= 4; n++) {
    for (const p of plages) {
      if (p.octets !== n || i + n > o.length) continue
      let dedans = true
      for (let k = 0; k < n && dedans; k++) dedans = o[i + k] >= p.bas[k] && o[i + k] <= p.haut[k]
      if (dedans) return n
    }
  }
  return 1
}

// ── Le contenu d'une page : les opérateurs de texte, en fragments positionnés. ──

type Matrice = [number, number, number, number, number, number]
const IDENTITE: Matrice = [1, 0, 0, 1, 0, 0]

function produit(m: Matrice, n: Matrice): Matrice {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}

function matriceDe(v: unknown): Matrice | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null
  return v as Matrice
}

interface EtatGraphique {
  ctm: Matrice
  police: Police | null
  taille: number
  espacementCaracteres: number
  espacementMots: number
  echelle: number
  interligne: number
}

const FRAGMENTS_MAX = 2_000_000

class Interprete {
  readonly fragments: FragmentDuPdf[] = []
  private formulaires = 0

  private readonly doc: FichierPdf
  constructor(doc: FichierPdf) {
    this.doc = doc
  }

  private async police(ressources: Valeur, nom: string): Promise<Police | null> {
    const dictionnaire = estDico(ressources) ? this.doc.dans(ressources, 'Font') : null
    const police = estDico(dictionnaire) ? this.doc.dans(dictionnaire, nom) : null
    if (!estDico(police)) return null
    const connue = this.doc.polices.get(police)
    if (connue !== undefined) return connue
    const lue = await lirePolice(this.doc, police)
    this.doc.polices.set(police, lue)
    return lue
  }

  async contenu(octets: Uint8Array, ressources: Valeur, ctmInitiale: Matrice, profondeur: number): Promise<void> {
    const lexeur = new Lexeur(octets, 0, octets.length, false)
    const parNom = new Map<string, Police | null>()
    const pile: EtatGraphique[] = []
    let e: EtatGraphique = { ctm: ctmInitiale, police: null, taille: 0, espacementCaracteres: 0, espacementMots: 0, echelle: 1, interligne: 0 }
    let tm: Matrice = IDENTITE
    let tlm: Matrice = IDENTITE
    const operandes: (Valeur | Mot)[] = []
    const nombre = (k: number): number => {
      const v = operandes[operandes.length - k]
      return typeof v === 'number' ? v : 0
    }
    const montrer = (elements: readonly (Valeur | Mot)[]) => {
      const police = e.police
      if (police === null) return
      let texte = ''
      let avance = 0
      let largeurConnue = true
      const debut = produit(tm, e.ctm)
      for (const el of elements) {
        if (typeof el === 'number') {
          const decalage = (-el / 1000) * e.taille * e.echelle
          if (el < -250 && texte !== '' && !texte.endsWith(' ')) texte += ' '
          avance += decalage
          continue
        }
        if (typeof el !== 'object' || el === null || Array.isArray(el) || el.t !== 'chaine') continue
        const o = el.v
        for (let i = 0; i < o.length;) {
          const n = police.longueur(o, i)
          let code = 0
          for (let k = 0; k < n && i + k < o.length; k++) code = code * 256 + o[i + k]
          texte += police.texte(code)
          const l = police.largeur(code)
          if (l === undefined) largeurConnue = false
          else avance += ((l / 1000) * e.taille + e.espacementCaracteres + (n === 1 && code === 32 ? e.espacementMots : 0)) * e.echelle
          i += n
        }
      }
      if (texte.trim() !== '' && this.fragments.length < FRAGMENTS_MAX) {
        const echelleX = Math.hypot(debut[0], debut[1])
        this.fragments.push({
          texte,
          x: debut[4],
          y: debut[5],
          largeur: largeurConnue ? avance * echelleX : undefined,
          hauteur: e.taille * Math.hypot(debut[2], debut[3]),
        })
      }
      if (largeurConnue) tm = produit([1, 0, 0, 1, avance, 0], tm)
    }
    const allerALaLigne = (tx: number, ty: number) => {
      tlm = produit([1, 0, 0, 1, tx, ty], tlm)
      tm = tlm
    }
    for (let compte = 0; ; compte++) {
      if ((compte & 0xfff) === 0) this.doc.verifierLaDuree()
      const v = lexeur.valeur()
      if (v === null) {
        if (lexeur.i >= lexeur.fin) break
        operandes.push(null)
        continue
      }
      if (typeof v !== 'object' || v === null || Array.isArray(v) || v.t !== 'mot') {
        operandes.push(v)
        if (operandes.length > 64) operandes.shift()
        continue
      }
      const op = v.v
      switch (op) {
        case 'q': pile.push({ ...e }); break
        case 'Q': e = pile.pop() ?? e; break
        case 'cm': { const m = matriceDe(operandes.slice(-6)); if (m) e.ctm = produit(m, e.ctm); break }
        case 'BT': tm = IDENTITE; tlm = IDENTITE; break
        case 'Tf': {
          const nom = nomDe(operandes[operandes.length - 2])
          e.taille = nombre(1)
          if (nom === null) e.police = null
          else if (parNom.has(nom)) e.police = parNom.get(nom) ?? null
          else { e.police = await this.police(ressources, nom); parNom.set(nom, e.police) }
          break
        }
        case 'Tc': e.espacementCaracteres = nombre(1); break
        case 'Tw': e.espacementMots = nombre(1); break
        case 'Tz': e.echelle = nombre(1) / 100; break
        case 'TL': e.interligne = nombre(1); break
        case 'Td': allerALaLigne(nombre(2), nombre(1)); break
        case 'TD': e.interligne = -nombre(1); allerALaLigne(nombre(2), nombre(1)); break
        case 'Tm': { const m = matriceDe(operandes.slice(-6)); if (m) { tm = m; tlm = m } break }
        case 'T*': allerALaLigne(0, -e.interligne); break
        case 'Tj': montrer(operandes.slice(-1)); break
        case '\'': allerALaLigne(0, -e.interligne); montrer(operandes.slice(-1)); break
        case '"': e.espacementMots = nombre(3); e.espacementCaracteres = nombre(2); allerALaLigne(0, -e.interligne); montrer(operandes.slice(-1)); break
        case 'TJ': { const t = operandes[operandes.length - 1]; if (Array.isArray(t)) montrer(t); break }
        case 'Do': await this.formulaire(nomDe(operandes[operandes.length - 1]), ressources, e.ctm, profondeur); break
        case 'BI': sauterLImage(lexeur); break
        default: break
      }
      operandes.length = 0
    }
  }

  private async formulaire(nom: string | null, ressources: Valeur, ctm: Matrice, profondeur: number): Promise<void> {
    if (nom === null || profondeur >= 4 || ++this.formulaires > 2_000) return
    const xobjets = estDico(ressources) ? this.doc.dans(ressources, 'XObject') : null
    const f = estDico(xobjets) ? this.doc.dans(xobjets, nom) : null
    if (!estFlux(f) || nomDe(this.doc.dans(f.dico, 'Subtype')) !== 'Form') return
    const octets = await this.doc.decoder(f)
    if (octets === null) return
    const propres = this.doc.dans(f.dico, 'Resources')
    const matrice = matriceDe(this.doc.dans(f.dico, 'Matrix')) ?? IDENTITE
    await this.contenu(octets, propres ?? ressources, produit(matrice, ctm), profondeur + 1)
  }
}

/** Une image en ligne (`BI … ID … EI`) : ses octets ne sont pas du contenu. */
function sauterLImage(lexeur: Lexeur): void {
  const o = lexeur.o
  const id = chercher(o, 'ID', lexeur.i, lexeur.fin)
  if (id < 0) { lexeur.i = lexeur.fin; return }
  let i = id + 3
  for (;;) {
    const ei = chercher(o, 'EI', i, lexeur.fin)
    if (ei < 0) { lexeur.i = lexeur.fin; return }
    if (ESPACE[o[ei - 1]] && (ei + 2 >= lexeur.fin || ESPACE[o[ei + 2]])) { lexeur.i = ei + 2; return }
    i = ei + 2
  }
}

/**
 * Le texte des pages d'un PDF, page après page, remis à `surLaPage` ; la lecture s'arrête quand elle rend vrai. Une page
 * dont le contenu ne se décode pas rend une page sans fragment. Ne rejette jamais.
 */
export async function lireLeTexteDUnPdf(
  octets: Uint8Array, bornes: BornesDuTexte, surLaPage: (page: PageDuPdf) => boolean,
): Promise<LectureDuTexte> {
  try {
    const entete = chercher(octets, '%PDF-', 0, Math.min(octets.length, 1029))
    if (entete < 0) return { etat: 'illisible', raison: 'pas-un-pdf' }
    const doc = new FichierPdf(octets, bornes, bornes.maintenant())
    doc.repererLeChiffrement()
    if (doc.chiffre) return { etat: 'illisible', raison: 'chiffre' }
    doc.lireLesObjets()
    doc.verifierLaDuree()
    await doc.lireLesFluxDObjets()
    const pages = doc.pages()
    if (pages.length === 0) return { etat: 'illisible', raison: 'sans-page' }
    let lues = 0
    for (const page of pages) {
      const interprete = new Interprete(doc)
      const contenus = doc.dans(page, 'Contents')
      const flux = (Array.isArray(contenus) ? contenus.map((c) => doc.resoudre(c)) : [contenus]).filter(estFlux)
      const morceaux: Uint8Array[] = []
      for (const f of flux) {
        const decode = await doc.decoder(f)
        if (decode !== null) morceaux.push(decode, Uint8Array.of(10))
      }
      const total = morceaux.reduce((s, m) => s + m.length, 0)
      const contenu = new Uint8Array(total)
      let position = 0
      for (const m of morceaux) { contenu.set(m, position); position += m.length }
      await interprete.contenu(contenu, doc.herite(page, 'Resources'), IDENTITE, 0)
      lues++
      if (surLaPage({ fragments: interprete.fragments })) return { etat: 'lu', pages: lues, arrete: true }
    }
    return { etat: 'lu', pages: lues, arrete: false }
  } catch (e) {
    return { etat: 'illisible', raison: e instanceof Borne ? 'borne' : 'erreur' }
  }
}
// ── FIN COPIE texteDUnPdf ────────────────────────────────────────────────────────────────────────────────────────────

// LE BORDEREAU DE TÉLÉTRANSMISSION ÉCARTÉ À LA RÉCEPTION (conception 59, BOR6, seconde partie ; BOR-Q9 (A), décision du cabinet :
// refuser au dépôt dans le navigateur, écarter à la réception par e-mail). Un bordereau porte des noms de patients, et
// l'application n'est pas hébergée chez un hébergeur de données de santé (RGPD.md § 8.7) : une pièce jointe PDF qui en a la
// forme (`porteLaFormeDUnBordereau`, la règle du navigateur, copiée) ne se dépose jamais — ni au stockage, ni chez Textract —, et
// se dit au cabinet sous la raison `bordereau`, que la migration `pieces_jointes_ecartees_bordereau` ajoute (en production depuis
// le 21/11/2026). Le texte se lit ici, sans pdf.js (`lireLeTexteDUnPdf`, copié) : ce qui ne se lit pas (chiffré, filtre inconnu,
// au-delà des bornes) ne se reconnaît pas, et part comme avant (BOR6-Q1 (A)).
//
// LEVÉE le 22/11/2026, après l'essai d'un vrai bordereau par le cabinet (BOR6R-Q1). La baisser rend la réception d'avant : tout
// PDF déposé sans lecture de son texte (l'état baissé reste éprouvé par bordereauxALaReceptionHttp.test.ts). Elle se baisse
// AVANT tout retour de la migration (supabase/preparees/retour/…_retour_pieces_jointes_ecartees_bordereau.sql).
const BORDEREAUX_ECARTES_A_LA_RECEPTION = true

// LES BORNES DE LA LECTURE. Une Edge Function a 2 s de calcul par requête : la lecture de TOUS les PDF d'un e-mail tient dans
// une même seconde de durée (mesurée par l'horloge, qui ne compte pas moins que le calcul), et chaque PDF dans 48 Mio d'octets
// décompressés (la mémoire est de 256 Mo, la pièce jointe en prend jusqu'à 20). Mesuré le 21/11/2026 : un bordereau de
// quelques pages se reconnaît en quelques dizaines de millisecondes ; un PDF de 30 pages de texte se lit en une centaine.
const LECTURE_DES_PDF_MS = 1000
const OCTETS_DECOMPRESSES_MAX = 48 * 1024 * 1024

/** La forme d'un bordereau dans ce PDF : reconnue, absente, ou illisible (et la raison, un code fixe). */
async function formeDUnBordereauDansLePdf(
  bytes: Uint8Array, finDesLecturesMs: number,
): Promise<{ forme: "bordereau" | "absente" } | { forme: "illisible"; raison: string }> {
  const reste = finDesLecturesMs - performance.now()
  if (reste <= 0) return { forme: "illisible", raison: "borne" }
  const lu = await lireLeTexteDUnPdf(
    bytes,
    { octetsDecompressesMax: OCTETS_DECOMPRESSES_MAX, dureeMaxMs: reste, maintenant: () => performance.now() },
    (page) => porteLaFormeDUnBordereau([page]),
  )
  if (lu.etat === "illisible") return { forme: "illisible", raison: lu.raison }
  return { forme: lu.arrete ? "bordereau" : "absente" }
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

  // `from` et `subject` ne se lisent pas : rien de cette fonction n'en a besoin, et ne pas les nommer garantit qu'aucune
  // ligne de journal ne les recopie.
  const { email_id, to, attachments } = event.data

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))
  const supabase = createClient(supabaseUrl, cleSecrete)

  // LE JOURNAL NE PORTE QUE DES COMPTES (ligne 23-journalEmail ; décision du cabinet du 18/10/2026) : ni l'adresse d'un
  // destinataire, ni son code de collecte, ni l'expéditeur, ni l'objet — un objet peut nommer un patient, une adresse
  // désigne une personne, et le journal de la fonction se garde et se lit ailleurs que dans l'application. Chaque ligne
  // ci-dessous dit COMBIEN (de destinataires, de pièces jointes, de pièces importées), jamais DE QUI ni DE QUOI ;
  // l'identifiant que Resend donne à l'e-mail reste, opaque : c'est lui qui retrouve l'e-mail chez Resend, où seul le
  // cabinet peut le lire.
  const codeEmail = to.map(extractEmail).map((addr) => addr.split("@")[0]).find((c) => !!c)
  if (!codeEmail) {
    console.error(`[receive-email] aucun destinataire exploitable : ${to.length} destinataire(s) reçu(s), e-mail ${email_id}`)
    return new Response("ok", { status: 200 })
  }

  const { data: dossier, error: dossierError } = await supabase
    .from("dossiers")
    .select("id")
    .eq("code_email", codeEmail)
    .maybeSingle()

  if (dossierError) {
    // Le code et le message de PostgREST, jamais son détail ni l'objet entier : le journal ne recopie rien de la requête.
    console.error(`[receive-email] lecture du dossier refusée (${dossierError.code || "sans code"} ${dossierError.message})`)
    return new Response("Erreur base de données", { status: 500 })
  }
  if (!dossier) {
    // Adresse inconnue (faute de frappe côté client, ancien transfert...) — on ignore silencieusement
    // plutôt que de renvoyer une erreur, ce qui ferait retenter Resend inutilement. Le journal dit qu'elle est
    // inconnue et combien l'e-mail portait de destinataires et de fichiers : ni l'adresse, ni son code, ni l'expéditeur,
    // ni l'objet — l'identifiant de l'e-mail suffit à le retrouver chez Resend.
    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, ${to.length} destinataire(s), ${(attachments ?? []).length} fichier(s) joint(s)`)
    return new Response("ok", { status: 200 })
  }

  // Seules les vraies pièces jointes nous intéressent — pas les images intégrées à une signature
  // (logo...), qui arrivent avec content_disposition "inline".
  const fichiers = (attachments ?? []).filter((a) => a.content_disposition === "attachment")
  // Les autres se COMPTENT, sans nom (ligne 22.92), avant toute pièce jointe : le compte reste au journal même si la
  // boucle s'arrête en route.
  console.log(`[receive-email] dossier ${dossier.id} : ${compteDesElementsIntegres(attachments ?? [])}`)

  let nbImportees = 0
  // L'échéance commune des lectures de PDF de cet e-mail (BOR6) : posée une fois, avant la première pièce jointe.
  const finDesLecturesMs = performance.now() + LECTURE_DES_PDF_MS
  for (const fichier of fichiers) {
    // Le poids de la pièce jointe, une fois téléchargée : inconnu (null) tant que rien n'a été lu — Resend ne l'a pas
    // rendue, son téléchargement a échoué, une exception est venue avant —, et dit tel quel au cabinet, jamais deviné.
    let octets: number | null = null
    try {
      const { data: detail, error: attachError } = await resend.emails.receiving.attachments.get({
        emailId: email_id,
        id: fichier.id,
      })
      if (attachError || !detail) {
        console.error("Récupération pièce jointe échouée:", fichier.id, attachError)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)
        continue
      }

      const res = await fetch(detail.download_url)
      if (!res.ok) {
        console.error("Téléchargement pièce jointe échoué:", fichier.id, res.status)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      octets = bytes.byteLength
      // UNE PIÈCE JOINTE ARRIVÉE VIDE (0 octet ; ligne 22.91) : il n'y a rien à déposer ni à lire — ni le stockage ni
      // extract-piece ne la voient —, mais le client croit l'avoir envoyée. Elle se consigne pour le cabinet sous sa
      // raison, au poids zéro, une fois (la clé de toute pièce jointe écartée), et se journalise sans son nom. Ni « son
      // format et son poids allaient » ni « renvoie-la telle quelle » ne sont vrais d'elle : l'écran demande au client de
      // vérifier son fichier.
      if (bytes.byteLength === 0) {
        console.warn(`Pièce jointe écartée, arrivée vide (0 octet) : ${fichier.id}`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "vide", 0)
        continue
      }
      // LES BORNES DU SEAU DES PIÈCES (ligne 22.6), celles que l'application applique à tout dépôt : le type se décide
      // sur le nom et les premiers octets — jamais sur celui que DÉCLARE l'expéditeur, qui partait tel quel au stockage
      // —, et une pièce jointe hors des bornes est écartée avant tout envoi, journalisée sans son nom, et consignée pour
      // le cabinet (ligne 22.7).
      const nomFichier = fichier.filename || `piece-${fichier.id}`
      const type = typeDUnePiece(nomFichier, bytes.subarray(0, 16))
      if (type === null) {
        console.warn(`Pièce jointe écartée, format non pris en charge (PDF, JPEG, PNG ou CSV) : ${fichier.id}`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "format", bytes.byteLength)
        continue
      }
      if (bytes.byteLength > TAILLE_MAX_PIECE) {
        console.warn(`Pièce jointe écartée, ${bytes.byteLength} octets au-delà de la borne de ${TAILLE_MAX_PIECE} : ${fichier.id}`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "taille", bytes.byteLength)
        continue
      }
      // UN BORDEREAU DE TÉLÉTRANSMISSION (BOR6) : jugé sur un PDF, après les bornes et AVANT le doublon, le stockage et Textract.
      // Reconnu, il s'écarte et se consigne au poids lu ; illisible, il part comme avant, et le journal n'en dit que le code.
      if (BORDEREAUX_ECARTES_A_LA_RECEPTION && type === "application/pdf") {
        const lecture = await formeDUnBordereauDansLePdf(bytes, finDesLecturesMs)
        if (lecture.forme === "bordereau") {
          console.warn(`Pièce jointe écartée, forme d'un bordereau de télétransmission : ${fichier.id}`)
          await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "bordereau", bytes.byteLength)
          continue
        }
        if (lecture.forme === "illisible") {
          console.warn(`[receive-email] texte du PDF non lu (${lecture.raison}), pièce jointe déposée comme avant : ${fichier.id}`)
        }
      }

      // Même détection de doublon que les autres points d'entrée (import manuel, en masse) — un
      // transfert automatique peut renvoyer plusieurs fois le même e-mail (relance client, règle de
      // transfert mal configurée...).
      const hash = await hashBytes(bytes)
      const [pieces, documents] = await Promise.all([
        supabase.from("pieces").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("storage_hash", hash),
        supabase.from("documents_divers").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("storage_hash", hash),
      ])
      // UN `count` NUL EST INDISCERNABLE D'UN « AUCUN DOUBLON TROUVÉ ». C'est mot pour mot le défaut
      // que `fichierDejaPresent` (src/lib/extraction.ts) a été corrigé pour ne plus avoir, resté
      // entier sur cette troisième copie — que la fonction soit auto-portée n'y change rien, et le
      // commentaire ci-dessus promettait justement « la même détection que les autres points
      // d'entrée ».
      //
      // ON SAUTE LA PIÈCE JOINTE plutôt que de la déposer : un doublon est PERMANENT et compte la
      // même charge deux fois en 2035 comme en balance, alors qu'une pièce jointe non déposée laisse
      // la trace que laisse déjà tout échec de cette fonction — et le dossier continue de réclamer
      // le document sur les trois écrans « ce qu'il reste à envoyer », donc le manque se voit.
      // Le twin de `src/` LÈVE ; ici il n'y a aucun opérateur pour recevoir une exception.
      const erreurDoublon = pieces.error ?? documents.error
      if (erreurDoublon) {
        console.error(`Détection de doublon impossible, pièce jointe ignorée: ${fichier.id} (${erreurDoublon.message})`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
        continue
      }
      // Déjà au dossier : ce n'est pas une perte, rien ne s'écrit pour le cabinet.
      if ((pieces.count ?? 0) > 0 || (documents.count ?? 0) > 0) {
        console.log(`Pièce jointe déjà présente (hash identique), ignorée: ${fichier.id}`)
        continue
      }

      // L'horodatage à part : le journal d'un fichier orphelin le cite sans le nom que porte le chemin.
      const horodatage = Date.now()
      const path = `${dossier.id}/${horodatage}-${slugify(nomFichier)}`

      // Un Blob du type décidé ci-dessus : c'est lui que le stockage juge (supabase-js envoie un Blob en multipart, la
      // partie portant son type).
      const { error: uploadError } = await supabase.storage
        .from("pieces")
        .upload(path, new Blob([bytes], { type }))
      if (uploadError) {
        console.error("Upload storage échoué:", fichier.id, uploadError)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
        continue
      }

      // Un CSV n'est jamais envoyé à Textract (relevés/factures en PDF ou image uniquement) — classé
      // directement en relevé bancaire sur son extension, comme les autres points d'entrée. Les autres
      // formats passent par la même extraction/classification que l'import manuel ou en masse.
      const estCsv = nomFichier.toLowerCase().endsWith(".csv")
      const extraction = estCsv ? null : await classifierEtExtraire(bytes, supabaseUrl, cleSecrete)
      const classification = estCsv ? "releve_bancaire" : (extraction?.classification ?? "facture")
      const orientation = orientationDe(classification)

      const insertError = orientation.destination === "pieces"
        ? (await supabase.from("pieces").insert({
            dossier_id: dossier.id,
            source: "email",
            storage_path: path,
            storage_hash: hash,
            nom_fichier: nomFichier,
            type_piece: orientation.type_piece,
            statut: "a_valider",
            date_piece: extraction?.date_piece ?? null,
            tiers: extraction?.tiers ?? null,
            montant_ht: extraction?.montant_ht ?? null,
            montant_tva: extraction?.montant_tva ?? null,
            montant_ttc: extraction?.montant_ttc ?? null,
            // Une date DÉDUITE plafonne la confiance à « moyenne », comme aux trois autres chemins du dépôt (PIECES-Q1).
            confiance: extraction ? confianceDeLExtraction(extraction) : null,
          })).error
        : (await supabase.from("documents_divers").insert({
            dossier_id: dossier.id,
            storage_path: path,
            storage_hash: hash,
            nom_fichier: nomFichier,
            categorie: orientation.categorie,
          })).error

      if (insertError) {
        // Le fichier est dans le stockage mais rien ne pointe dessus : on le retire avant de passer à
        // la pièce jointe suivante. Sans ça il y reste orphelin, invisible de tout écran, et seule la
        // suppression du dossier entier l'aurait nettoyé — même règle que `depot.ts` et
        // `importFichiers.ts`, qui la portent depuis longtemps.
        // Et une compensation dont on jette le résultat laisse exactement l'orphelin qu'elle existe
        // pour éviter — même défaut que les deux `delete` de create-cabinet. Rien ne recharge
        // derrière : personne ne relit le seau, donc le fichier resterait là sans qu'aucun écran ni
        // aucun compte ne puisse le montrer.
        // Le code et le message de PostgREST, jamais son détail : il recopie la ligne refusée — le nom du fichier, le
        // tiers et les montants lus.
        console.error(`Insertion échouée: ${fichier.id} (${insertError.code || "sans code"} ${insertError.message})`)
        const { error: erreurRetrait } = await supabase.storage.from("pieces").remove([path])
        if (erreurRetrait) {
          // Le dossier et l'horodatage le retrouvent dans le seau ; le reste du chemin est le nom du fichier.
          console.error(`[receive-email] fichier ORPHELIN laissé dans le stockage : ${dossier.id}/${horodatage}-… (${erreurRetrait.message})`)
        }
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
        continue
      }

      nbImportees++
    } catch (err) {
      console.error("Erreur traitement pièce jointe:", fichier.id, err)
      await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
    }
  }

  console.log(`E-mail ${email_id} → dossier ${dossier.id} : ${nbImportees}/${fichiers.length} pièce(s) importée(s)`)
  return new Response("ok", { status: 200 })
})
