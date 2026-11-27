// LE BORDEREAU DE TÉLÉTRANSMISSION DE TÉLÉVITALE, LU DANS LE NAVIGATEUR : LES TOTAUX SEULS (conception 59, lot BOR1 ;
// docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md, § « BOR0 : ce que la page réelle a montré »).
// La décision du cabinet du 16/11/2026 : « on récupère que les chiffres et on stocke pas de données patients » (pas
// d'hébergeur de données de santé, RGPD.md § 8.7).
//
// UN MODULE PUR, ET SANS SORTIE : il ne lit rien en base, n'appelle personne, ne journalise rien, ne lit ni l'horloge ni le
// stockage du navigateur, n'importe rien (bordereauDeTeletransmissionSansSortie.test.ts le garde, défauts plantés compris).
// Il reçoit le TEXTE des pages, tel que pdf.js le rend (lib/bordereauDeTeletransmissionLecture.ts ouvre le fichier), sous
// l'une des deux formes : des lignes déjà recomposées, ou des fragments positionnés qu'il regroupe par ordonnée.
//
// CE QUI SORT D'ICI, ET RIEN D'AUTRE, PAR BORDEREAU : le numéro du lot et sa date de création, sécurisé ou non, le code et le
// libellé de l'organisme destinataire (l'en-tête, jamais une ligne), le nombre de factures annoncé, les quatre totaux en
// centimes entiers. Le type `BordereauLu` n'a aucun champ de texte venu d'une ligne de facture : le libellé de l'organisme est
// la seule chaîne, lue dans l'en-tête et bornée à sa forme.
//
// LE DESTINATAIRE DU RÈGLEMENT (BOR1-Q2 (B), réponse du cabinet du 18/11/2026) : la ligne « Destinataire du réglement : … »
// doit être là (elle est de la forme de l'en-tête), mais son libellé, quel qu'il soit, est ACCEPTÉ et JAMAIS RENDU, ni même
// analysé : il n'entre ni dans le résultat, ni dans une raison de refus, ni dans une comparaison entre pages. Un libellé autre
// que « Partenaire de santé » (l'assuré remboursé lui-même, par exemple) pourrait porter un nom de personne : c'est la raison
// de ne rien en garder. Le lot se compte toujours comme en tiers payant : ce qui est dû au praticien par l'assurance maladie
// est la caisse plus la mutuelle (conception 59, § 12.3), quel que soit ce libellé.
//
// CE QUI EST LU ET JAMAIS RENDU : chaque ligne de facture est COMPTÉE (contre le nombre annoncé) et ses quatre montants
// ADDITIONNÉS (contre les totaux, au centime). Rien d'autre d'une ligne n'est analysé : ni le numéro de facture, ni la date
// de prescription, ni le numéro d'assuré, ni le nom du bénéficiaire, ni sa date de naissance — et rien d'une ligne, pas même
// un montant, n'entre dans une raison de refus, qui ne dit que le bordereau, la page et le rang de la ligne. L'identité et le
// numéro d'assurance maladie du praticien, le nom et l'adresse de la caisse sont lus comme des lignes d'en-tête, et ignorés.
//
// LE CONTRÔLE « TOTAL = CAISSE + MUTUELLE + ASSURÉ » SUR CHAQUE LIGNE RESTE (BOR1-Q3 (A), réponse du cabinet du 18/11/2026).
//
// CE QUI N'EST PAS SÛR SE REFUSE, TOUT ENTIER, AVEC SA RAISON : titre absent, en-tête de lot ou d'organisme illisible, en-tête
// des colonnes non reconnu, ligne du tableau non reconnue, total absent, nombre de lignes différent du nombre annoncé, sommes
// qui ne tombent pas, total différent de caisse + mutuelle + assuré (sur la ligne de total comme sur chaque ligne), deux
// bordereaux du même lot. Rien n'est deviné : un bordereau qui se lit à moitié ne rend rien.
//
// PLUSIEURS BORDEREAUX DANS UN FICHIER : chacun est rendu à part, un lot par bordereau, et chacun se contrôle par son propre
// total ; un seul refusé refuse le fichier (tout ou rien, comme l'import NOEMIE). Refuser le fichier entier aurait obligé
// le praticien à imprimer ses lots un par un, sans rien gagner en sûreté, puisque chaque bordereau porte sa preuve.
//
// UN BORDEREAU SUR PLUSIEURS PAGES : le total est en dernière page. Une page qui suit et qui reprend le titre, l'en-tête du
// lot et celui des colonnes continue le même bordereau, ses valeurs d'en-tête confrontées à la première page (un autre lot
// avant le total est un refus) ; une page qui reprend seulement l'en-tête des colonnes, ou aucun, continue aussi. Le pied
// (la date d'impression, « k/n », « Réalisé par Televitale ») est ignoré où qu'il soit.

// ── DÉBUT COPIE formeDUnBordereau ────────────────────────────────────────────────────────────────────────────────────
// LA FORME D'UN BORDEREAU DE TÉLÉTRANSMISSION, ET LES LIGNES D'UNE PAGE (BOR6). Ce bloc est copié À L'IDENTIQUE dans
// receive-email, auto-portée, qui écarte à la réception par e-mail la pièce jointe qui a cette forme (seconde partie de BOR6),
// et dans extract-piece, qui refuse de citer ou de rendre le texte d'un document dont la lecture (Textract) a cette forme — une
// photo, un PDF numérisé (troisième partie, 27/11/2026) ; bordereauALaReceptionCopie.test.ts et bordereauALaLectureCopie.test.ts
// comparent chaque copie au caractère près et l'exécutent contre l'original. La lecture des bordereaux, plus bas, s'en sert
// telle quelle.

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

function normaliserLaLigne(texte: string): string {
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
      const normalisee = normaliserLaLigne(originale)
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

export interface TotauxDuBordereau {
  totalCentimes: number
  caisseCentimes: number
  mutuelleCentimes: number
  assureCentimes: number
}

/** Un bordereau lu : l'en-tête du lot et ses totaux, jamais une valeur d'une ligne de facture. */
export interface BordereauLu {
  lot: number
  /** La date de création du lot, AAAA-MM-JJ. */
  creeLe: string
  securise: boolean
  organisme: {
    /** Trois chiffres, tels qu'imprimés (« 999 »). */
    code: string
    /** Le libellé imprimé après le code (« CPAM - VILLE ») : lettres, espaces, tirets, apostrophes et points seuls. */
    libelle: string
  }
  nombreDeFactures: number
  totaux: TotauxDuBordereau
}

export type LectureDuBordereau =
  | { etat: 'lu'; bordereaux: readonly BordereauLu[] }
  | { etat: 'refuse'; raison: string }

/** Le libellé d'un organisme, au plus : au-delà, ce n'est plus un en-tête. */
export const LIBELLE_ORGANISME_MAX = 60
/** Un montant, au plus, en centimes (dix millions d'euros) : au-delà, la lecture s'est trompée de colonne. */
const MONTANT_MAX_CENTIMES = 1_000_000_000

// ── Les montants à la française, lus depuis la fin d'une ligne. ──

/**
 * Les `n` derniers montants d'une ligne (« 1 234,56 », « 12,34 », « -12,00 »), en centimes, et ce qui les précède ; nul
 * quand la ligne ne finit pas par `n` montants. Une espace sépare les milliers : un groupe de trois chiffres qui précède un
 * montant s'y rattache, tant que le montant n'a lui-même que trois chiffres avant ce groupe.
 */
export function montantsEnFin(ligne: string, n: number): { tete: string; centimes: number[] } | null {
  const jetons = ligne.replace(ESPACES, ' ').trim().split(/\s+/).filter((j) => j !== '')
  const centimes: number[] = []
  let i = jetons.length - 1
  while (centimes.length < n) {
    if (i < 0) return null
    const dernier = /^(-?)(\d+),(\d{2})$/.exec(jetons[i])
    if (dernier === null) return null
    let signe = dernier[1]
    let entier = dernier[2]
    i -= 1
    // Les groupes de milliers : « 1 234 567,00 » s'écrit en trois jetons. Un groupe ne se rattache qu'à une partie entière
    // faite de groupes de trois chiffres : après un groupe de moins de trois chiffres, ou signé, la boucle s'arrête d'elle-même.
    // Un rattachement faux (un champ de chiffres collé au premier montant) ne passe pas les contrôles des sommes.
    while (signe === '' && i >= 0 && entier.length % 3 === 0) {
      const groupe = /^(-?)(\d{1,3})$/.exec(jetons[i])
      if (groupe === null) break
      signe = groupe[1]
      entier = groupe[2] + entier
      i -= 1
    }
    if (entier.length > 9) return null
    const valeur = Number(entier) * 100 + Number(dernier[3])
    if (!Number.isSafeInteger(valeur) || valeur > MONTANT_MAX_CENTIMES) return null
    centimes.unshift(signe === '-' ? -valeur : valeur)
  }
  return { tete: jetons.slice(0, i + 1).join(' '), centimes }
}

// ── La reconnaissance des lignes. ──

function dateCivile(jour: string, mois: string, annee: string): string | null {
  const j = Number(jour)
  const m = Number(mois)
  const a = Number(annee)
  if (a < 1990 || a > 2200 || m < 1 || m > 12 || j < 1) return null
  const bissextile = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
  const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  if (j > jours) return null
  return `${annee}-${mois}-${jour}`
}

const LIBELLE_PERMIS = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' .-]*$/

interface EnteteDuLot {
  lot?: number
  creeLe?: string
  securise?: boolean
  organisme?: { code: string; libelle: string }
  /** La ligne « Destinataire du réglement » a été vue ; son libellé, jamais gardé. */
  destinataireVu?: true
}

type ChampDEntete = { champ: 'lot'; lot: number; creeLe: string }
  | { champ: 'securise'; securise: boolean }
  | { champ: 'organisme'; code: string; libelle: string }
  | { champ: 'destinataire' }
  | { champ: 'illisible'; raison: string }

/** Une ligne d'en-tête reconnue, illisible (son intitulé est là, sa valeur ne se lit pas), ou nulle (une autre ligne). */
function champDEntete(originale: string, normalisee: string): ChampDEntete | null {
  if (/^lot\s*:/.test(normalisee)) {
    const m = /^lot\s*:\s*(\d{1,9})\s+cree\s+le\s+(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalisee)
    const creeLe = m === null ? null : dateCivile(m[2], m[3], m[4])
    if (m === null || creeLe === null || Number(m[1]) < 1) return { champ: 'illisible', raison: 'le numéro du lot ou sa date de création ne se lit pas' }
    return { champ: 'lot', lot: Number(m[1]), creeLe }
  }
  if (normalisee === 'lot securise') return { champ: 'securise', securise: true }
  if (normalisee === 'lot non securise') return { champ: 'securise', securise: false }
  if (/^organisme assurance maladie destinataire\s*:/.test(normalisee)) {
    const m = /:\s*(\d{3})\s*-\s*(.+)$/.exec(originale.replace(ESPACES, ' '))
    const libelle = m === null ? '' : m[2].replace(/\s+/g, ' ').trim()
    if (m === null || libelle === '' || libelle.length > LIBELLE_ORGANISME_MAX || !LIBELLE_PERMIS.test(libelle)) {
      return { champ: 'illisible', raison: 'l’organisme destinataire ne se lit pas' }
    }
    return { champ: 'organisme', code: m[1], libelle }
  }
  // Le libellé qui suit les deux-points n'est ni lu ni gardé (BOR1-Q2 (B)) : seul l'intitulé compte.
  if (/^destinataire du reglement\s*:/.test(normalisee)) return { champ: 'destinataire' }
  return null
}

const NOMS_DES_CHAMPS: Record<Exclude<ChampDEntete['champ'], 'illisible'>, string> = {
  lot: 'le numéro du lot et sa date de création',
  securise: 'la mention « lot sécurisé » ou « lot non sécurisé »',
  organisme: 'l’organisme destinataire',
  destinataire: 'le destinataire du règlement',
}

/** Pose un champ d'en-tête ; une valeur différente d'une valeur déjà lue (deux fois sur une page, ou une page qui suit) est un refus. */
function poserChamp(entete: EnteteDuLot, champ: Exclude<ChampDEntete, { champ: 'illisible' }>): string | null {
  const conflit = 'deux valeurs différentes dans le même bordereau'
  switch (champ.champ) {
    case 'lot':
      if (entete.lot !== undefined && (entete.lot !== champ.lot || entete.creeLe !== champ.creeLe)) return `${NOMS_DES_CHAMPS.lot} : ${conflit}`
      entete.lot = champ.lot
      entete.creeLe = champ.creeLe
      return null
    case 'securise':
      if (entete.securise !== undefined && entete.securise !== champ.securise) return `${NOMS_DES_CHAMPS.securise} : ${conflit}`
      entete.securise = champ.securise
      return null
    case 'organisme':
      if (entete.organisme !== undefined && (entete.organisme.code !== champ.code || entete.organisme.libelle !== champ.libelle)) {
        return `${NOMS_DES_CHAMPS.organisme} : ${conflit}`
      }
      entete.organisme = { code: champ.code, libelle: champ.libelle }
      return null
    case 'destinataire':
      entete.destinataireVu = true
      return null
  }
}

// ── La lecture. ──

interface BordereauEnCours {
  rang: number
  entete: EnteteDuLot
  /** Les lignes de facture comptées, jamais gardées. */
  lignesDeFacture: number
  sommes: [number, number, number, number]
  total: { nombre: number; centimes: [number, number, number, number] } | null
}

function refus(raison: string): LectureDuBordereau {
  return { etat: 'refuse', raison }
}

/**
 * Les bordereaux de télétransmission d'un fichier, à partir du texte de ses pages. Tout ou rien : un bordereau refusé refuse
 * le fichier, et la raison ne cite que le rang du bordereau, la page et le rang d'une ligne, jamais une valeur.
 */
export function lireBordereauxDeTeletransmission(pages: readonly PageDeTexte[]): LectureDuBordereau {
  const lignes = lignesDuFichier(pages)
  const finis: BordereauEnCours[] = []
  let enCours: BordereauEnCours | null = null
  // 'avant' : avant le premier titre ; 'entete' : après un titre ; 'tableau' : après l'en-tête des colonnes ; 'apres' : après le total.
  let etat: 'avant' | 'entete' | 'tableau' | 'apres' = 'avant'

  const ou = (l: LigneDuFichier) => `bordereau ${enCours?.rang ?? finis.length + 1}, page ${l.page}`

  for (const l of lignes) {
    const n = l.normalisee
    if (n === TITRE) {
      if (etat === 'avant' || etat === 'apres') {
        enCours = { rang: finis.length + 1, entete: {}, lignesDeFacture: 0, sommes: [0, 0, 0, 0], total: null }
        etat = 'entete'
        continue
      }
      if (etat === 'tableau' && l.enTeteDePage) {
        // Une page qui suit et reprend le titre : son en-tête se relit, confronté à la première page.
        etat = 'entete'
        continue
      }
      return refus(`${ou(l)} : un titre au milieu du bordereau, avant son total`)
    }
    if (estUnPied(n)) continue

    if (etat === 'avant') {
      return refus(`page ${l.page} : du texte avant le titre « Bordereau de Teletransmission » ; ce fichier n’a pas la forme d’un bordereau de télétransmission de Télévitale`)
    }
    if (etat === 'apres') return refus(`${ou(l)} : une ligne inattendue après la ligne de total`)
    if (enCours === null) return refus('lecture interrompue')

    if (n === ENTETE_DES_COLONNES) {
      if (etat === 'tableau' && !l.enTeteDePage) return refus(`${ou(l)} : l’en-tête des colonnes répété au milieu d’une page`)
      etat = 'tableau'
      continue
    }

    if (etat === 'entete') {
      const champ = champDEntete(l.originale, n)
      if (champ === null) {
        if (/^\d{9}(\s|$)/.test(n) || /^total\b/.test(n)) {
          return refus(`${ou(l)} : le tableau commence sans l’en-tête des colonnes attendu (les neuf intitulés de Télévitale, de « Facture » à « Assuré »)`)
        }
        continue // l'identité du praticien, le nom et l'adresse de la caisse : lus, ignorés
      }
      if (champ.champ === 'illisible') return refus(`${ou(l)} : ${champ.raison}`)
      const conflit = poserChamp(enCours.entete, champ)
      if (conflit !== null) return refus(`${ou(l)} : ${conflit}`)
      continue
    }

    // etat === 'tableau'
    if (/^total\b/.test(n)) {
      const lus = montantsEnFin(n, 4)
      const m = lus === null ? null : /^total\s*:?\s*lot\s+de\s+(\d{1,6})\s+factures?$/.exec(lus.tete)
      if (lus === null || m === null) return refus(`${ou(l)} : la ligne de total ne se lit pas (« TOTAL: LOT de N Factures » suivi de quatre montants)`)
      const [total, caisse, mutuelle, assure] = lus.centimes
      enCours.total = { nombre: Number(m[1]), centimes: [total, caisse, mutuelle, assure] }
      finis.push(enCours)
      etat = 'apres'
      continue
    }
    const rangDansLeTableau = enCours.lignesDeFacture + 1
    if (!/^\d{9}(\s|$)/.test(n)) {
      return refus(`${ou(l)} : une ligne du tableau non reconnue après la ligne de facture n° ${enCours.lignesDeFacture} (ni une facture, ni le total, ni le pied de page)`)
    }
    const montants = montantsEnFin(n, 4)
    if (montants === null) return refus(`${ou(l)} : la ligne de facture n° ${rangDansLeTableau} ne finit pas par quatre montants lisibles`)
    const [total, caisse, mutuelle, assure] = montants.centimes
    if (total !== caisse + mutuelle + assure) {
      return refus(`${ou(l)} : sur la ligne de facture n° ${rangDansLeTableau}, le total n’est pas la somme de la caisse, de la mutuelle et de l’assuré`)
    }
    enCours.lignesDeFacture = rangDansLeTableau
    enCours.sommes = [enCours.sommes[0] + total, enCours.sommes[1] + caisse, enCours.sommes[2] + mutuelle, enCours.sommes[3] + assure]
  }

  if (etat === 'avant') return refus('le titre « Bordereau de Teletransmission » est absent : ce fichier n’est pas un bordereau de télétransmission de Télévitale')
  if (etat === 'entete') return refus(`bordereau ${finis.length + 1} : l’en-tête des colonnes est absent`)
  if (etat === 'tableau') return refus(`bordereau ${finis.length + 1} : la ligne de total (« TOTAL: LOT de N Factures ») est absente`)

  const bordereaux: BordereauLu[] = []
  for (const b of finis) {
    const ici = `bordereau ${b.rang}`
    const e = b.entete
    if (e.lot === undefined || e.creeLe === undefined) return refus(`${ici} : ${NOMS_DES_CHAMPS.lot} sont absents`)
    if (e.securise === undefined) return refus(`${ici} : ${NOMS_DES_CHAMPS.securise} est absente`)
    if (e.organisme === undefined) return refus(`${ici} : ${NOMS_DES_CHAMPS.organisme} est absent`)
    if (e.destinataireVu === undefined) return refus(`${ici} : ${NOMS_DES_CHAMPS.destinataire} est absent`)
    if (b.total === null) return refus(`${ici} : la ligne de total est absente`)
    if (b.lignesDeFacture === 0) return refus(`${ici} : aucune ligne de facture`)
    if (b.lignesDeFacture !== b.total.nombre) {
      return refus(`${ici} : ${b.lignesDeFacture} ligne(s) de facture lue(s), quand le total en annonce ${b.total.nombre}`)
    }
    const [total, caisse, mutuelle, assure] = b.total.centimes
    if (total !== caisse + mutuelle + assure) return refus(`${ici} : le total du lot n’est pas la somme de la caisse, de la mutuelle et de l’assuré`)
    const colonnes = ['Total', 'Caisse', 'Mutuelle', 'Assuré']
    for (let c = 0; c < 4; c++) {
      if (b.sommes[c] !== b.total.centimes[c]) return refus(`${ici} : la somme des lignes de la colonne « ${colonnes[c]} » diffère du total imprimé`)
    }
    // Le même lot : un même numéro, une même date de création et une même caisse — la clé du registre de la base (BOR3,
    // `doublonLot`). Un numéro seul ne suffit pas (relecture du 27/11/2026) : à trois chiffres, il revient au fil d'une année
    // (conception 59, § 5.2), et rien n'établit qu'il soit unique d'une caisse à l'autre.
    const { lot, creeLe, organisme } = e
    if (bordereaux.some((d) => d.lot === lot && d.creeLe === creeLe && d.organisme.code === organisme.code)) {
      return refus(`${ici} : le même lot figure deux fois dans le fichier`)
    }
    bordereaux.push({
      lot: e.lot,
      creeLe: e.creeLe,
      securise: e.securise,
      organisme: { code: e.organisme.code, libelle: e.organisme.libelle },
      nombreDeFactures: b.total.nombre,
      totaux: { totalCentimes: total, caisseCentimes: caisse, mutuelleCentimes: mutuelle, assureCentimes: assure },
    })
  }
  return { etat: 'lu', bordereaux }
}
