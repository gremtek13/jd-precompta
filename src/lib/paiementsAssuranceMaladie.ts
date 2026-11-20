import { parseDateBancaire, parseMontantBancaire } from './csv'

// LES PAIEMENTS DE L'ASSURANCE MALADIE, LUS DANS LE NAVIGATEUR (conception 53, lots NOE1 et NOE2 ; docs/conceptions/
// 53-import-noemie-et-remboursements.md ; la base : supabase/schema/20261120110000_paiements_assurance_maladie.sql, NOE3).
// La décision du cabinet du 16/11/2026 : « on récupère que les chiffres et on stocke pas de données patients » (pas
// d'hébergeur de données de santé, RGPD.md §8.7).
//
// UN MODULE PUR, ET SANS SORTIE : il ne lit rien en base, n'appelle personne, ne journalise rien, ne lit ni l'horloge ni le
// stockage du navigateur (paiementsAssuranceMaladieSansSortie.test.ts le garde, défaut planté compris). Le fichier est lu
// ici, dans le navigateur de celui qui importe — le praticien depuis son espace client, ou le cabinet (NOE-Q1) — et ne part
// nulle part : ni au stockage, ni vers une Edge Function, ni dans un journal, ni au modèle de l'assistant. Seuls les
// AGRÉGATS que rend ce module atteignent la base, au clic, par `importer_paiements_assurance_maladie`.
//
// CE QUI SORT D'ICI, ET RIEN D'AUTRE : par journée comptable, organisme (le code du régime et celui de la caisse, des
// entiers, ou rien ; l'organisme complémentaire de la part complémentaire, un entier, ou rien — « non dit », BORQ5-Q1 (A) :
// l'export lu ici ne le nomme pas encore) et part (obligatoire, complémentaire), le montant net en centimes, ce que les régularisations en ont
// retiré, le nombre de factures payées ; le nombre des rejets et leur montant total, si le fichier dit les statuts ; des
// COMPTES de ce qui a été écarté, sous un numéro de ligne et une raison — JAMAIS la valeur d'une cellule (un message
// d'erreur finit dans un journal). Ni nom, ni NIR, ni date de naissance, ni date de soins, ni acte, ni numéro de facture ou
// de lot, ni référence de virement, ni empreinte du fichier : ces colonnes, si le fichier les porte, ne sont jamais lues.
//
// LES DEUX FORMATS (NOE-Q2, « Les deux ») :
//   - L'EXPORT CSV DU LOGICIEL DU PRATICIEN : le nom du logiciel et les en-têtes de son export ne sont pas encore connus
//     (NOE1) ; il se lit par un RÉGLAGE DES COLONNES que celui qui importe choisit à l'écran, sur les seuls en-têtes et le
//     genre de chaque colonne (`genresDesColonnes` : date, montant, code, statut), jamais un exemple de valeur. Une ligne
//     est une facture ; chacune de ses parts (obligatoire, complémentaire) a sa colonne de montant, de journée comptable,
//     et au choix de statut et d'organisme. Le décodage et le découpage du fichier sont ceux de l'import des clients
//     (`decoderLeFichier`, `decouperLeFichier`, `tableauDuFichier` de lib/contactsImportFichier.ts), purs eux aussi.
//   - LE FICHIER NOEMIE BRUT (576, 580) : NON LU. Le seul cahier des charges public (NOEMIE PS, mai 2004, sesam-vitale.fr)
//     se déclare la copropriété de l'assurance maladie, « publication [qui] n'entraîne aucune cession des droits », protégé
//     contre la copie ; la version de 2016 (ameli.fr) n'a pas pu être lue. Sa disposition n'est donc pas tirée d'une source
//     dont les conditions permettent l'exploitation : le format attend la réponse du cabinet (la fiche NOE2-Q1).
//
// CE QUI N'EST PAS SÛR SE REFUSE OU S'ÉCARTE, ET SE COMPTE : un montant illisible n'est jamais zéro ; une date illisible,
// un organisme qui n'est pas fait de chiffres, un statut inconnu écartent la part de la ligne ; une part sans montant (vide
// ou nul) n'est pas un paiement. Les refus de la base (`refus_de_l_import_assurance_maladie` et la fonction d'import) sont
// redits ici, sous les mêmes mots et dans le même ordre, avant le clic (`refusDeLImport`, `refusAvantLEnvoi`).

/** Le drapeau de la migration `paiements_assurance_maladie` (NOE3, préparée le 16/11/2026, pas appliquée) : baissé, aucun
 *  écran ne lit ni n'écrit les deux tables, et le plan de sauvegarde ne les nomme pas (une sauvegarde lirait des tables
 *  absentes et échouerait). Il se lève le jour de la migration (NOE8). */
export const PAIEMENTS_ASSURANCE_MALADIE_PREVUS = false

/** Les parts d'un paiement, la liste fermée de la base (`paiements_assurance_maladie_part`). */
export type PartDuPaiement = 'obligatoire' | 'complementaire' | 'forfait'
export const PARTS_DU_PAIEMENT: readonly PartDuPaiement[] = ['obligatoire', 'complementaire', 'forfait']

/** Un paiement agrégé, tel qu'il part en base : les huit clés que la fonction d'import accepte, et aucune autre (la
 *  migration amendée le 19/11/2026, avant tout collage : l'organisme complémentaire, BOR-Q5 (B)). */
export interface PaiementAgrege {
  date_journee_comptable: string
  regime: number | null
  caisse: number | null
  /** L'organisme complémentaire, en chiffres (de 1 à 9 999 999 999), de la seule part complémentaire ; nul : non dit. */
  organisme_complementaire: number | null
  part: PartDuPaiement
  /** Le net, régularisations déduites, en centimes. */
  montant_centimes: number
  /** Ce que les régularisations ont retiré (négatif ou nul), en centimes. */
  regularisations_centimes: number
  nombre_de_factures: number
}

/** Les rejets d'un import : une part rejetée d'une facture compte un rejet (NOE-Q4 : par import, jamais par facture). */
export interface RejetsDeLImport {
  nombre: number
  montant_centimes: number
}

/** Ce que reçoit `importer_paiements_assurance_maladie` : la version 1, ses trois clés. Des rejets nuls : le fichier ne les
 *  dit pas — jamais zéro sur un non-dit. */
export interface ImportAEnvoyer {
  version: 1
  paiements: PaiementAgrege[]
  rejets: RejetsDeLImport | null
}

/** Un paiement déjà en base, ce qu'en lit l'écran pour redire le conflit et « rien de neuf » avant le clic. */
export type PaiementEnBase = Omit<PaiementAgrege, never>

// ── Les mots de la base ────────────────────────────────────────────────────────────────────────────────────────────────
// Les constantes de `refus_de_l_import_assurance_maladie`, au caractère près (paiementsAssuranceMaladie.test.ts les relit
// dans le texte de la migration), puis ceux de la fonction d'import.
export const REFUS_DE_L_IMPORT = {
  forme: 'L\'import n\'est pas dans la forme que la base connaît (version 1).',
  nombre: 'Un import porte de 1 à 5 000 paiements.',
  paiement: 'Un paiement de l\'import est mal formé : une journée comptable, un organisme en chiffres ou rien (l\'organisme complémentaire, pour la seule part complémentaire), une part de la liste, des montants en centimes entiers et un nombre de factures.',
  aVenir: 'Un paiement de l\'import porte une journée comptable à venir.',
  coherence: 'Un paiement de l\'import ne se tient pas : ses factures, son montant et ses régularisations ne s\'accordent pas.',
  doublon: 'L\'import porte deux fois le même paiement : une même journée comptable, un même organisme et une même part.',
  rejets: 'Les rejets de l\'import sont mal formés : un nombre de factures et un montant en centimes entiers, positifs, ou rien.',
} as const

export const REFUS_DE_LA_FONCTION = {
  acces: 'Accès refusé à ce dossier.',
  exerciceValide: 'Un paiement de l\'import tombe dans un exercice que le cabinet a validé : il ne s\'importe plus.',
  rienDeNeuf: 'Ces paiements sont déjà tous importés : rien de neuf.',
  retraitExerciceValide: 'Un paiement de cet import tombe dans un exercice que le cabinet a validé : l\'import ne se retire plus.',
} as const

/** Le refus d'un paiement déjà en base avec d'autres chiffres, la journée nommée en JJ/MM/AAAA. */
export function refusDuConflit(journee: string): string {
  const [a, m, j] = journee.split('-')
  return `Un paiement de l\'import est déjà en base avec d\'autres chiffres (la journée comptable du ${j}/${m}/${a}) : retirer `
    + 'd\'abord l\'import qui le porte.'
}

// ── La forme d'un import, redite (`refus_de_l_import_assurance_maladie`) ─────────────────────────────────────────────────
const PLAFOND = 100_000_000_000_000
const CLES_DE_L_IMPORT = ['paiements', 'rejets', 'version']
const CLES_D_UN_PAIEMENT = ['caisse', 'date_journee_comptable', 'montant_centimes', 'nombre_de_factures',
  'organisme_complementaire', 'part', 'regime', 'regularisations_centimes']
/** L'organisme complémentaire, au plus : dix chiffres (sa forme publique n'est pas établie, conception 59, § 13.4). */
const ORGANISME_COMPLEMENTAIRE_MAX = 9_999_999_999
const CLES_DES_REJETS = ['montant_centimes', 'nombre']

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// L'ordre `collate "C"` de la base : celui des points de code, celui de `<` sur des clés ASCII.
const clesTriees = (o: Record<string, unknown>) => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const memesCles = (o: Record<string, unknown>, attendues: readonly string[]) => {
  const cles = clesTriees(o)
  return cles.length === attendues.length && cles.every((c, i) => c === attendues[i])
}
const estEntier = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Un jour civil AAAA-MM-JJ qui existe au calendrier, depuis le 1er janvier 2000. */
export function estUneJourneeComptable(texte: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte)
  if (!m) return false
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (annee < 2000 || mois < 1 || mois > 12 || jour < 1) return false
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  return jour <= [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1]
}

/**
 * Le refus, en mots, d'un import pour le jour de Paris donné (AAAA-MM-JJ), ou nul : la fonction
 * `refus_de_l_import_assurance_maladie` de la base, dans son ordre — la forme, le nombre des paiements, chaque paiement (mal
 * formé, à venir, qui ne se tient pas), deux paiements de même clé, les rejets.
 */
export function refusDeLImport(imp: unknown, jour: string): string | null {
  if (!estUneJourneeComptable(jour)) return REFUS_DE_L_IMPORT.aVenir
  if (!estObjet(imp) || !memesCles(imp, CLES_DE_L_IMPORT)) return REFUS_DE_L_IMPORT.forme
  if (imp.version !== 1 || !Array.isArray(imp.paiements) || !(imp.rejets === null || estObjet(imp.rejets))) {
    return REFUS_DE_L_IMPORT.forme
  }
  const paiements: unknown[] = imp.paiements
  if (paiements.length < 1 || paiements.length > 5000) return REFUS_DE_L_IMPORT.nombre
  for (const p of paiements) {
    if (!estObjet(p) || !memesCles(p, CLES_D_UN_PAIEMENT)) return REFUS_DE_L_IMPORT.paiement
    const { date_journee_comptable: date, regime, caisse, organisme_complementaire: organisme, part, montant_centimes: montant,
      regularisations_centimes: regularisations, nombre_de_factures: factures } = p
    if (typeof date !== 'string' || !(regime === null || typeof regime === 'number') || !(caisse === null || typeof caisse === 'number')
      || !(organisme === null || typeof organisme === 'number')
      || typeof part !== 'string' || typeof montant !== 'number' || typeof regularisations !== 'number' || typeof factures !== 'number') {
      return REFUS_DE_L_IMPORT.paiement
    }
    if (!estUneJourneeComptable(date)) return REFUS_DE_L_IMPORT.paiement
    if (!(PARTS_DU_PAIEMENT as readonly string[]).includes(part)) return REFUS_DE_L_IMPORT.paiement
    if ((regime !== null && (!estEntier(regime) || regime < 0 || regime > 99))
      || (caisse !== null && (!estEntier(caisse) || caisse < 0 || caisse > 999))
      || (organisme !== null && (part !== 'complementaire' || !estEntier(organisme) || organisme < 1 || organisme > ORGANISME_COMPLEMENTAIRE_MAX))
      || !estEntier(montant) || Math.abs(montant) >= PLAFOND
      || !estEntier(regularisations) || regularisations > 0 || regularisations <= -PLAFOND
      || !estEntier(factures) || factures < 0 || factures > 100000) {
      return REFUS_DE_L_IMPORT.paiement
    }
    if (date > jour) return REFUS_DE_L_IMPORT.aVenir
    const brut = montant - regularisations
    if (brut < 0 || brut >= PLAFOND || (montant === 0 && regularisations === 0)
      || (part === 'forfait' && factures !== 0) || (part !== 'forfait' && (factures === 0) !== (montant === regularisations))) {
      return REFUS_DE_L_IMPORT.coherence
    }
  }
  const cles = new Set<string>()
  for (const p of paiements as PaiementAgrege[]) {
    const cle = cleDUnPaiement(p)
    if (cles.has(cle)) return REFUS_DE_L_IMPORT.doublon
    cles.add(cle)
  }
  if (imp.rejets !== null) {
    const r = imp.rejets as Record<string, unknown>
    if (!memesCles(r, CLES_DES_REJETS)) return REFUS_DE_L_IMPORT.rejets
    if (typeof r.nombre !== 'number' || typeof r.montant_centimes !== 'number') return REFUS_DE_L_IMPORT.rejets
    if (!estEntier(r.nombre) || r.nombre < 0 || r.nombre > 100000 || !estEntier(r.montant_centimes) || r.montant_centimes < 0
      || r.montant_centimes >= PLAFOND || (r.nombre === 0 && r.montant_centimes !== 0)) {
      return REFUS_DE_L_IMPORT.rejets
    }
  }
  return null
}

/** La clé TOTALE d'un paiement dans son dossier : la journée, l'organisme (deux organismes non dits se heurtent), la part,
 *  l'organisme complémentaire. */
export function cleDUnPaiement(p: Pick<PaiementAgrege, 'date_journee_comptable' | 'regime' | 'caisse' | 'part' | 'organisme_complementaire'>): string {
  return `${p.date_journee_comptable}|${p.regime ?? '-'}|${p.caisse ?? '-'}|${p.part}|${p.organisme_complementaire ?? '-'}`
}

/** Ce que la fonction d'import fera d'un import bien formé, face aux paiements déjà en base du dossier : la journée la plus
 *  ancienne d'un paiement déjà importé avec d'autres chiffres (le refus), et le nombre de paiements nouveaux. */
export function confrontationAuxPaiementsEnBase(imp: ImportAEnvoyer, enBase: readonly PaiementEnBase[]):
  { conflit: string | null; nouveaux: number; dejaImportes: number } {
  const parCle = new Map(enBase.map((p) => [cleDUnPaiement(p), p]))
  let conflit: string | null = null
  let nouveaux = 0
  for (const p of imp.paiements) {
    const deja = parCle.get(cleDUnPaiement(p))
    if (!deja) {
      nouveaux++
      continue
    }
    if (deja.montant_centimes !== p.montant_centimes || deja.regularisations_centimes !== p.regularisations_centimes
      || deja.nombre_de_factures !== p.nombre_de_factures) {
      if (conflit === null || p.date_journee_comptable < conflit) conflit = p.date_journee_comptable
    }
  }
  return { conflit, nouveaux, dejaImportes: imp.paiements.length - nouveaux }
}

/**
 * Le refus que la base opposerait à cet import, dit avant le clic, ou nul : la forme, puis un paiement déjà en base avec
 * d'autres chiffres, puis rien de neuf. Les exercices validés ne se disent pas ici : le client ne les lit pas
 * (`ANNEES_ILLISIBLES`) ; la base seule en juge, sous ses mots.
 */
export function refusAvantLEnvoi(imp: ImportAEnvoyer, jour: string, enBase: readonly PaiementEnBase[]): string | null {
  const forme = refusDeLImport(imp, jour)
  if (forme) return forme
  const { conflit, nouveaux } = confrontationAuxPaiementsEnBase(imp, enBase)
  if (conflit) return refusDuConflit(conflit)
  if (nouveaux === 0) return REFUS_DE_LA_FONCTION.rienDeNeuf
  return null
}

// ── L'export CSV du logiciel du praticien : le réglage des colonnes ─────────────────────────────────────────────────────
/** Les parts qu'une ligne de l'export peut porter : un forfait n'est pas une facture, l'export d'un suivi des factures ne
 *  le dit pas (il se lirait du fichier brut). */
export type PartDUneLigne = 'obligatoire' | 'complementaire'

/** Les colonnes d'une part, par leur rang (depuis zéro). Le statut et l'organisme sont au choix. */
export interface ColonnesDUnePart {
  part: PartDUneLigne
  journee: number
  montant: number
  statut: number | null
  regime: number | null
  caisse: number | null
}

export interface ReglageDesColonnes {
  parts: readonly ColonnesDUnePart[]
}

/** Le refus d'un réglage, ou nul : une ou deux parts, différentes ; chaque colonne dans le fichier ; une colonne ne sert
 *  qu'à un usage dans une part. */
export function refusDuReglage(reglage: ReglageDesColonnes, largeur: number): string | null {
  if (reglage.parts.length < 1 || reglage.parts.length > 2) {
    return 'Choisir les colonnes d’une part au moins (obligatoire ou complémentaire), de deux au plus.'
  }
  if (new Set(reglage.parts.map((p) => p.part)).size !== reglage.parts.length) {
    return 'Une part ne se règle qu’une fois.'
  }
  for (const p of reglage.parts) {
    const rangs = [p.journee, p.montant, p.statut, p.regime, p.caisse].filter((r): r is number => r !== null)
    if (rangs.some((r) => !Number.isInteger(r) || r < 0 || r >= largeur)) return 'Une colonne choisie n’est pas dans le fichier.'
    if (new Set(rangs).size !== rangs.length) return 'Une même colonne ne sert qu’à un usage dans une part.'
  }
  return null
}

// ── Les statuts ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Une liste FERMÉE de mots, comparés sans casse, sans accents, les blancs réduits : un statut qui n'y est pas écarte la
// part (le fichier de NOE1 dira les siens ; d'ici là, rien ne se devine).
export type Statut = 'payee' | 'rejetee' | 'en_attente'
const MOTS_DES_STATUTS: Readonly<Record<Statut, readonly string[]>> = {
  payee: ['paye', 'payee', 'paiement', 'regle', 'reglee', 'vire', 'viree'],
  rejetee: ['rejet', 'rejete', 'rejetee', 'refus', 'refuse', 'refusee'],
  en_attente: ['en attente', 'attente', 'en cours', 'traitement caisse', 'non paye', 'non payee', 'impaye', 'impayee'],
}

const normaliser = (texte: string) =>
  texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Le statut d'une cellule, ou nul s'il n'est pas dans la liste. */
export function statutDe(cellule: string): Statut | null {
  const mot = normaliser(cellule)
  for (const s of Object.keys(MOTS_DES_STATUTS) as Statut[]) if (MOTS_DES_STATUTS[s].includes(mot)) return s
  return null
}

// ── Les cellules ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une journée lue par `parseDateBancaire` (JJ/MM/AAAA, AAAA-MM-JJ…), depuis 2000 ; nulle si elle n'est pas sûre. */
function journeeDe(cellule: string): string | null {
  const iso = parseDateBancaire(cellule)
  return iso !== null && estUneJourneeComptable(iso) ? iso : null
}

/** Un montant en centimes, lu par `parseMontantBancaire` ; nul s'il est illisible ou hors des bornes. */
function centimesDe(cellule: string): number | null {
  const euros = parseMontantBancaire(cellule)
  if (euros === null || !Number.isFinite(euros)) return null
  const centimes = Math.round(euros * 100)
  return Number.isSafeInteger(centimes) && Math.abs(centimes) < PLAFOND ? centimes : null
}

/** Un code d'organisme : des chiffres seulement, au plus `chiffres`. */
function codeDe(cellule: string, chiffres: number): number | null {
  const t = cellule.trim()
  return new RegExp(`^\\d{1,${chiffres}}$`).test(t) ? Number(t) : null
}

/** Le genre de chaque colonne, pour l'écran du réglage : ce que toutes ses cellules non vides sont. Jamais une valeur. */
export interface GenreDUneColonne {
  vide: boolean
  date: boolean
  montant: boolean
  code: boolean
  statut: boolean
}

export function genresDesColonnes(lignes: readonly { cellules: readonly string[] }[], largeur: number): GenreDUneColonne[] {
  return Array.from({ length: largeur }, (_, rang) => {
    const cellules = lignes.map((l) => (l.cellules[rang] ?? '').trim()).filter((c) => c !== '')
    return {
      vide: cellules.length === 0,
      date: cellules.length > 0 && cellules.every((c) => journeeDe(c) !== null),
      montant: cellules.length > 0 && cellules.every((c) => centimesDe(c) !== null),
      code: cellules.length > 0 && cellules.every((c) => codeDe(c, 3) !== null),
      statut: cellules.length > 0 && cellules.every((c) => statutDe(c) !== null),
    }
  })
}

// ── La lecture et l'agrégation ─────────────────────────────────────────────────────────────────────────────────────────
export type RaisonDEcart = 'journee' | 'montant' | 'organisme' | 'statut'

export const LIBELLES_DES_ECARTS: Readonly<Record<RaisonDEcart, string>> = {
  journee: 'journée comptable illisible',
  montant: 'montant illisible',
  organisme: 'organisme qui n’est pas un code en chiffres',
  statut: 'statut inconnu',
}

/** Une part écartée : sa ligne dans le fichier (depuis un), sa part, sa raison. JAMAIS la valeur. */
export interface PartEcartee {
  ligne: number
  part: PartDUneLigne
  raison: RaisonDEcart
}

export interface LectureDesPaiements {
  /** Les paiements agrégés, dans l'ordre de leur clé. */
  paiements: PaiementAgrege[]
  /** La plus ancienne et la plus récente journée comptable des paiements ; nulle sans paiement. */
  periode: { du: string; au: string } | null
  /** Nuls quand aucune part n'a de colonne de statut : le fichier ne dit pas les rejets. */
  rejets: RejetsDeLImport | null
  lignes: number
  ecartees: PartEcartee[]
  /** Les parts sans montant (cellule vide, ou nulle) : pas un paiement. */
  sansMontant: number
  /** Les parts au statut ni payé ni rejeté (en attente, en cours…) : pas encore un paiement. */
  enAttente: number
}

/**
 * Les paiements d'un export, lignes déjà découpées (sans leur en-tête), sous le réglage choisi : une part payée apporte son
 * montant à l'agrégat de sa journée, de son organisme et de sa part — positif, une facture de plus ; négatif, une
 * régularisation —, une part rejetée compte un rejet et son montant ; tout le reste se compte sans sa valeur.
 */
export function lireLesPaiements(lignes: readonly { ligne: number; cellules: readonly string[] }[], reglage: ReglageDesColonnes):
  LectureDesPaiements {
  const agregats = new Map<string, PaiementAgrege>()
  const ecartees: PartEcartee[] = []
  let sansMontant = 0
  let enAttente = 0
  let rejetes = 0
  let montantRejete = 0
  const cellule = (cellules: readonly string[], rang: number | null) => (rang === null ? '' : (cellules[rang] ?? '')).trim()
  for (const { ligne, cellules } of lignes) {
    for (const c of reglage.parts) {
      const ecarter = (raison: RaisonDEcart) => ecartees.push({ ligne, part: c.part, raison })
      let statut: Statut = 'payee'
      if (c.statut !== null) {
        const lu = statutDe(cellule(cellules, c.statut))
        if (lu === null) {
          if (cellule(cellules, c.montant) === '' && cellule(cellules, c.statut) === '') {
            sansMontant++
            continue
          }
          ecarter('statut')
          continue
        }
        statut = lu
      }
      if (statut === 'en_attente') {
        enAttente++
        continue
      }
      const texteDuMontant = cellule(cellules, c.montant)
      const montant = texteDuMontant === '' ? 0 : centimesDe(texteDuMontant)
      if (montant === null) {
        ecarter('montant')
        continue
      }
      if (statut === 'rejetee') {
        if (montant < 0) {
          ecarter('montant')
          continue
        }
        rejetes++
        montantRejete += montant
        continue
      }
      if (montant === 0) {
        sansMontant++
        continue
      }
      const journee = journeeDe(cellule(cellules, c.journee))
      if (journee === null) {
        ecarter('journee')
        continue
      }
      const regime = c.regime === null ? null : codeDe(cellule(cellules, c.regime), 2)
      const caisse = c.caisse === null ? null : codeDe(cellule(cellules, c.caisse), 3)
      if ((c.regime !== null && regime === null) || (c.caisse !== null && caisse === null)) {
        ecarter('organisme')
        continue
      }
      // L'export ne nomme pas encore l'organisme complémentaire (aucun en-tête connu, NOE1) : non dit (BORQ5-Q1 (A)).
      const cle = cleDUnPaiement({ date_journee_comptable: journee, regime, caisse, part: c.part, organisme_complementaire: null })
      const agregat = agregats.get(cle) ?? {
        date_journee_comptable: journee, regime, caisse, organisme_complementaire: null, part: c.part,
        montant_centimes: 0, regularisations_centimes: 0, nombre_de_factures: 0,
      }
      agregat.montant_centimes += montant
      if (montant > 0) agregat.nombre_de_factures++
      else agregat.regularisations_centimes += montant
      agregats.set(cle, agregat)
    }
  }
  const paiements = [...agregats.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, p]) => p)
  const journees = paiements.map((p) => p.date_journee_comptable).sort()
  return {
    paiements,
    periode: journees.length === 0 ? null : { du: journees[0], au: journees[journees.length - 1] },
    rejets: reglage.parts.some((c) => c.statut !== null) ? { nombre: rejetes, montant_centimes: montantRejete } : null,
    lignes: lignes.length,
    ecartees,
    sansMontant,
    enAttente,
  }
}

/** L'import qui part en base, ou nul s'il n'y a aucun paiement : la version 1, ses trois clés, rien d'autre. */
export function importAEnvoyer(lecture: LectureDesPaiements): ImportAEnvoyer | null {
  if (lecture.paiements.length === 0) return null
  return {
    version: 1,
    paiements: lecture.paiements.map((p) => ({
      date_journee_comptable: p.date_journee_comptable, regime: p.regime, caisse: p.caisse,
      organisme_complementaire: p.organisme_complementaire, part: p.part,
      montant_centimes: p.montant_centimes, regularisations_centimes: p.regularisations_centimes,
      nombre_de_factures: p.nombre_de_factures,
    })),
    rejets: lecture.rejets === null ? null : { nombre: lecture.rejets.nombre, montant_centimes: lecture.rejets.montant_centimes },
  }
}
