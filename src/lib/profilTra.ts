import {
  encoderWindows1252, horsDeWindows1252, pointDeCode, REFUS_NOMMES_AU_PLUS, type CompteDeLExport,
} from './profilsDExport'

// LE PROFIL « TRA » DE L'EXPORT VERS UN LOGICIEL COMPTABLE (EXP4, 27/11/2026 ; la recherche :
// docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.4 et § 5 point 4). Le fichier de mouvements « .TRA » que
// lisent Cegid Expert (Cegid Business), et par lui Cegid Loop (`importTRA`) et MyUnisoft (`/api/v1/TRA/partial`), à LARGEUR
// FIXE, tel que l'éditeur le décrit : Cegid, « Cegid Business Comptabilité – Descriptif du fichier de mouvement "TRA" »,
// version '11', 89 pages, que MyUnisoft publie avec la documentation de son API (github.com/MyUnisoft/api-partenaires,
// docs/MAD/TRA.pdf, relu le 27/11/2026, SHA-256 du PDF 2fd4c0ed…e99067). Chaque position ci-dessous cite sa page (« v11,
// p. 40 »). Les deux descriptions plus anciennes que cite la recherche — la version 010 pour Yourcegid Finance Y2 (LD Système,
// SHA-256 f4939635…ad5f02) et la version 7 du 04/08/2005 (Logilys, SHA-256 cbbb45a0…842582) — donnent les MÊMES positions à
// l'enregistrement d'écriture, de 1 à 222, et au document GED : `profilTra.test.ts` le garde.
//
// LE MÊME MOTEUR QUE LES PROFILS ACD ET QUADRA : le fichier part du FEC RÉGLEMENTAIRE de l'onglet Écritures (le texte de
// `formaterFec`), relu colonne par colonne, et n'en récrit que la FORME. Aucun montant, aucune date, aucune pièce ne se
// recalcule ; le FEC ne change pas d'un octet. Ce module ne lit ni n'écrit la base : pur, sans `supabase.ts`.
//
// CE QUE LA DESCRIPTION FIXE, ÉCRIT TEL QUEL. Un fichier « de type journal » ne porte que l'en-tête (« XX ») et les journaux
// (« JAL »), puis les écritures (v11, p. 2 : « Si vous générez un fichier TRA de type journal les lignes d'entête
// obligatoirement présentes dans le fichier sont la principale (XX) et l'entête Journal (JAL) » ; « tous les enregistrements
// paramètres […] doivent précéder les enregistrements écritures »). L'en-tête : « *** », TYPE FICHIER « JRL », FORMAT « STD »
// (« Si vous avez besoin […] des enregistrements présents dans Informations complémentaires sur les écritures (#1) […],
// indiquez le format ETE, sinon spécifiez STD », p. 10 — on n'en a pas besoin : l'écriture s'arrête en 222), VERSION « 011 »
// (celle de la description suivie), SOUSVERSION « 001 », « 01011900 » dans les trois dates « pour ne rien faire »,
// SO_READYGUID « - » (aucun GUID). L'écriture : la date JJMMAAAA, le compte sur 17 complété de « 0 » à la longueur du dossier
// (« Caractère de bourrage pour les comptes généraux — Valeur par défaut ‘0’ », PS2, p. 11), TYPE CPTE à blanc pour une ligne
// sans auxiliaire ni section (l'exemple de l'éditeur, p. 42 : la colonne « Nature ligne » est vide sur le 44561000 et le
// 60150000), REFINTERNE la pièce sur 35, LIBELLE sur 35, SENS D/C, MONTANT1 « séparés par des virgules ‘,’ (exemple 100,00) et
// […] alignés à droite », TYPE ECRITURE « N » (« Ecriture normale »), CODEMONTANT « E-- » (« la zone MONTANT1 est en €uro, et
// […] MONTANT2 et MONTANT3=0 »), DEVISE à blanc (« Si Rien, considéré comme la monnaie de tenue »). Le justificatif : un
// enregistrement de TYPE CPTE « G », « Chemin du document + document associé » sur 255 en 84 (p. 49).
//
// CE QU'ELLE NE FIXE PAS, ET QUI NE SE DEVINE PAS — un réglage SANS défaut, « à saisir » tant que le cabinet ne l'a pas dit,
// et l'export refusé d'ici là : l'ENCODAGE et la FIN D'ENREGISTREMENT (la description n'en dit rien) ; la LONGUEUR DES COMPTES
// du dossier (« Valeur comprise entre 6 et 17 », PS2, p. 11) ; le PRODUIT qui génère le fichier (S1, S3, S5, SI, QU, WS, WT :
// l'application n'en est aucun) ; l'ORIGINE (« CLI pour PME ; EXP pour cabinet ») ; SO_NEWANALYTIQUE (« X » ou « - »,
// obligatoire, dont dépend qu'un dossier dont la structure analytique a changé accepte le fichier, p. 7) ; le NUMÉRO DE PIÈCE
// (vide pour tout le fichier, et Cegid numérote ; ou notre numéro continu sur huit chiffres — « Si non renseignée, vide ou ‘0’
// alors obligatoirement pour la totalité du fichier », p. 40) ; pour CHACUN de nos journaux, son code (une à trois lettres ou
// chiffres, a3), son libellé et sa NATURE dans le dossier Cegid (JAL, p. 39, obligatoires), le compte de contrepartie qu'exige
// une nature BQE ou CAI, et la NATURE DU MOUVEMENT de ses écritures (TYPE PIECE, obligatoire : FC, AC, RC, FF, AF, RF, OD, OC,
// OF — une écriture de trésorerie n'est ni d'office une facture ni d'office un règlement) ; avec les justificatifs, le CHEMIN
// qui précède leur nom dans l'enregistrement « G ».
//
// CE QUI NE PART PAS, DIT AVANT LE CLIC : les comptes auxiliaires (TYPE CPTE « X » exige un compte collectif et un tiers que le
// dossier Cegid connaisse, p. 41 : chaque ligne reste sur son compte, le 401 ou le 411 du plan) ; le lettrage (« Pour les
// journaux et balance, le code lettrage n'est pas intégré », v010, p. 48) ; les quatre champs du BNC (MODEPAIE « identique à
// CATEGORIE (MDP) », des codes du dossier) ; EcritureNum et ValidDate. Un libellé ou une pièce de plus de 35 caractères se
// coupent, comptés ; deux pièces que la coupe confondrait se refusent. Un montant NÉGATIF se refuse : la description ne dit
// pas comment s'écrit son signe, et inverser le sens serait récrire l'écriture.
//
// AUCUN TEXTE DE PLUS QUE LE FEC : ni le libellé d'un compte, ni celui d'un tiers, ni le nom d'un fichier déposé — le libellé
// de l'écriture, déjà neutre (JJ1, JJ1-Q1), la référence neutre de la pièce, que le justificatif prend pour nom (§ 4, point 1
// de la recherche), et les libellés de journaux que le cabinet saisit.

/**
 * Le drapeau de l'écran : BAISSÉ, l'onglet Écritures n'offre pas ce profil. EXP-Q6 (B), tranchée le 17/11/2026, fait écrire
 * Quadra et le TRA sans attendre la demande d'un cabinet ; mais aucun fichier de ce profil n'a encore été importé dans un
 * logiciel Cegid : le drapeau ne se lève qu'après un premier essai d'import réel chez un expert-comptable qui l'a, avec ses
 * réponses à EXP4-Q1 à Q5.
 */
export const PROFIL_TRA_OFFERT: boolean = false

/**
 * Le profil, À PART de `PROFILS_D_EXPORT`, comme Quadra : la base ne garde de réglages que pour `acd`
 * (`logiciels_d_export()`). Les garder pour le TRA est une migration (EXP4-Q5) ; d'ici là, ils se saisissent à chaque export.
 */
export const PROFIL_TRA = { id: 'tra', libelle: 'Cegid Expert, Loop, MyUnisoft (fichier TRA)' } as const

export type EncodageTra = 'windows-1252' | 'ascii'
export const ENCODAGES_TRA: readonly { id: EncodageTra; libelle: string }[] = [
  { id: 'windows-1252', libelle: 'Windows-1252 (les lettres accentuées passent)' },
  { id: 'ascii', libelle: 'ASCII strict (toute lettre accentuée se refuse)' },
]

export type FinDEnregistrementTra = 'crlf' | 'lf' | 'cr'
export const FINS_D_ENREGISTREMENT_TRA: readonly { id: FinDEnregistrementTra; libelle: string }[] = [
  { id: 'crlf', libelle: 'CR LF (retour chariot et saut de ligne)' },
  { id: 'lf', libelle: 'LF seul (saut de ligne)' },
  { id: 'cr', libelle: 'CR seul (retour chariot)' },
]
const FIN: Readonly<Record<FinDEnregistrementTra, string>> = { crlf: '\r\n', lf: '\n', cr: '\r' }

/** LGGEN, « Valeur comprise entre 6 et 17 » (PS2, v11, p. 11). */
export const LONGUEUR_DES_COMPTES_TRA_MIN = 6
export const LONGUEUR_DES_COMPTES_TRA_MAX = 17

/** « Produit générant le fichier » (en-tête, v11, p. 9) : la liste de la description, aucun choisi d'office. */
export const PRODUITS_TRA = [
  { id: 'S1', libelle: 'S1 (Business Line)' },
  { id: 'S3', libelle: 'S3 (Business Suite)' },
  { id: 'S5', libelle: 'S5 (Business Place)' },
  { id: 'SI', libelle: 'SI (SISCO)' },
  { id: 'QU', libelle: 'QU (Quadratus)' },
  { id: 'WS', libelle: 'WS (Winner surveillance)' },
  { id: 'WT', libelle: 'WT (Winner tenue)' },
] as const
export type ProduitTra = (typeof PRODUITS_TRA)[number]['id']

/** « Origine du fichier » (en-tête, v11, p. 9). */
export const ORIGINES_TRA = [
  { id: 'CLI', libelle: 'CLI (pour PME)' },
  { id: 'EXP', libelle: 'EXP (pour cabinet d’expertise comptable)' },
] as const
export type OrigineTra = (typeof ORIGINES_TRA)[number]['id']

/** SO_NEWANALYTIQUE (en-tête, position 148, v11, p. 9) : « X » nouveau format analytique, « - » l'ancien. */
export const NOUVELLES_ANALYTIQUES_TRA = [
  { id: 'X', libelle: 'X (nouvelle gestion de l’analytique)' },
  { id: '-', libelle: '- (ancienne gestion de l’analytique)' },
] as const
export type NouvelleAnalytiqueTra = (typeof NOUVELLES_ANALYTIQUES_TRA)[number]['id']

/** NUMEROPIECE (écriture, position 152, v11, p. 40). */
export type NumeroDePieceTra = 'vide' | 'continu'
export const NUMEROS_DE_PIECE_TRA: readonly { id: NumeroDePieceTra; libelle: string }[] = [
  { id: 'vide', libelle: 'Vide pour tout le fichier (le logiciel numérote)' },
  { id: 'continu', libelle: 'Notre numéro d’écriture continu, sur huit chiffres' },
]

/** NATURE d'un journal (JAL, position 45, v11, p. 39). */
export const NATURES_DE_JOURNAL_TRA = [
  { id: 'ACH', libelle: 'ACH — Achat' },
  { id: 'VTE', libelle: 'VTE — Vente' },
  { id: 'BQE', libelle: 'BQE — Banque' },
  { id: 'CAI', libelle: 'CAI — Caisse' },
  { id: 'OD', libelle: 'OD — Opérations diverses' },
  { id: 'ANO', libelle: 'ANO — À-nouveaux' },
  { id: 'REG', libelle: 'REG — Régularisation' },
  { id: 'CLO', libelle: 'CLO — Clôture' },
  { id: 'ECC', libelle: 'ECC — Écart de change' },
  { id: 'EXT', libelle: 'EXT — Extra-comptable' },
  { id: 'ODA', libelle: 'ODA — OD analytique' },
  { id: 'ANA', libelle: 'ANA — ODA à-nouveaux' },
] as const
export type NatureDeJournalTra = (typeof NATURES_DE_JOURNAL_TRA)[number]['id']
/** « Obligatoire pour les journaux de nature BQE ou CAI » : le compte de contrepartie automatique (JAL, position 54). */
export const NATURES_A_CONTREPARTIE: readonly NatureDeJournalTra[] = ['BQE', 'CAI']
/** Des natures que la description réserve à l'analytique : elles demandent un AXE (« Obligatoire pour les journaux de nature ODA »). */
const NATURES_ANALYTIQUES: readonly NatureDeJournalTra[] = ['ODA', 'ANA']

/** TYPE PIECE, « Nature du mouvement » (écriture, position 12, v11, p. 40). */
export const TYPES_DE_PIECE_TRA = [
  { id: 'FC', libelle: 'FC — Facture client' },
  { id: 'AC', libelle: 'AC — Avoir client' },
  { id: 'RC', libelle: 'RC — Règlement client' },
  { id: 'FF', libelle: 'FF — Facture fournisseur' },
  { id: 'AF', libelle: 'AF — Avoir fournisseur' },
  { id: 'RF', libelle: 'RF — Règlement fournisseur' },
  { id: 'OD', libelle: 'OD — Opérations diverses' },
  { id: 'OC', libelle: 'OC — Acompte client' },
  { id: 'OF', libelle: 'OF — Acompte fournisseur' },
] as const
export type TypeDePieceTra = (typeof TYPES_DE_PIECE_TRA)[number]['id']

/** Ce que le cabinet dit de l'un de nos journaux ; une valeur nulle ou vide est « à saisir ». */
export interface JournalTra {
  code: string
  libelle: string
  nature: NatureDeJournalTra | null
  typeDePiece: TypeDePieceTra | null
  /** Le compte de contrepartie automatique, pour une nature BQE ou CAI seulement. */
  contrepartie: string
}

/** Ce qui précède le nom du justificatif dans « Chemin du document + document associé ». */
export type CheminDesJustificatifsTra = { mode: 'nom_seul' } | { mode: 'dossier'; dossier: string }

/** Ce que le cabinet dit pour un export ; un réglage nul est « à saisir ». */
export interface ReglagesTra {
  encodage: EncodageTra | null
  finDEnregistrement: FinDEnregistrementTra | null
  longueurDesComptes: number | null
  produit: ProduitTra | null
  origine: OrigineTra | null
  nouvelleAnalytique: NouvelleAnalytiqueTra | null
  numeroDePiece: NumeroDePieceTra | null
  /** Nos codes de journaux → ce qu'ils sont dans le dossier Cegid. Un journal du fichier sans réglage est à saisir. */
  journaux: Readonly<Record<string, JournalTra>>
  /** Sans le journal des à-nouveaux : le dossier a déjà les siens, les importer les doublerait. */
  sansANouveaux: boolean
  /** Nul tant qu'il n'est pas dit ; ne se demande qu'avec les justificatifs. */
  cheminDesJustificatifs: CheminDesJustificatifsTra | null
}

export const JOURNAL_TRA_A_SAISIR: JournalTra = { code: '', libelle: '', nature: null, typeDePiece: null, contrepartie: '' }

/** Un code de journal : a3 (JAL, position 7 ; écriture, position 1) — une à trois lettres ou chiffres. */
export const CODE_DE_JOURNAL_TRA = /^[A-Za-z0-9]{1,3}$/

type Zones = Readonly<Record<string, readonly [number, number]>>

/** L'en-tête (« XX », v11, p. 9 et 10), position de 1 en tête et longueur : l'ordre de la description. */
export const ZONES_DE_L_EN_TETE = {
  fixe: [1, 3], // « Zone fixe — *** »
  produit: [4, 2], // « Produit générant le fichier »
  origine: [6, 3], // « Origine du fichier — CLI pour PME ; EXP pour cabinet d'expertise comptable »
  typeFichier: [9, 3], // « Contenu du fichier — JRL=journal »
  format: [12, 3], // « Format du fichier — STD=standard ; ETE=étendu »
  codeExoClos: [15, 3], // « Si aucune information, la zone est à blanc »
  dateBascule: [18, 8], // « Pour ne rien faire, mettre 01011900 »
  dateArrete: [26, 8], // « Pour ne rien faire, mettre 01011900 »
  version: [34, 3], // « Version de fichier = ‘011’ »
  dossierCabinet: [37, 5], // « Si aucune information, la zone est à blanc »
  dateHeure: [42, 12], // « Date et heure de génération » : non obligatoire, à blanc
  utilisateur: [54, 35], // non obligatoire, à blanc
  raisonSociale: [89, 35], // non obligatoire, à blanc
  reprise: [124, 4], // « Indicateur de Reprise » : à blanc
  numeroDossier: [128, 6], // « Spécifique mode PCL lanceur » : à blanc
  frequence: [134, 3], // « Spécifique Business Line » : à blanc
  datePurge: [137, 8], // SO_CPDATEREFPURGE, « Pour ne rien faire, mettre 01011900 »
  sousVersion: [145, 3], // « Sous Version de fichier — Version à ‘001’ »
  nouvelleAnalytique: [148, 1], // SO_NEWANALYTIQUE, « ‘X’ ou ‘-’ », obligatoire
  readyGuid: [149, 1], // SO_READYGUID, « si le fichier a des GUID =‘X’ ou pas ‘-’ »
  agricole: [150, 1], // « Dossier agricole » : non obligatoire, à blanc
  sequence: [151, 15], // SO_NOSEQBL : à blanc
} as const satisfies Zones

/** Un journal (« JAL », v11, p. 39). */
export const ZONES_DU_JOURNAL = {
  fixe: [1, 3], // « *** »
  identifiant: [4, 3], // « JAL »
  code: [7, 3], // « Code journal », obligatoire
  libelle: [10, 35], // « Libellé du journal », obligatoire
  nature: [45, 3], // « Nature », obligatoire
  soucheN: [48, 3], // « Souche écriture » : à blanc
  soucheS: [51, 3], // « Souche écriture simulation » : à blanc
  compte: [54, 17], // « Numéro de compte de contrepartie automatique — Obligatoire pour les journaux de nature BQE ou CAI »
  axe: [71, 3], // « Obligatoire pour les journaux de nature ODA » : ces natures ne se proposent pas sans axe, refusées
  modeSaisie: [74, 3], // « -=Saisie courante ; BOR ; LIB » — « - » pour un journal ANO (« NATURE=ANO & MODESAISIE=- »)
  comptesAutomatiques: [77, 200], // à blanc
  comptesInterdits: [277, 200], // à blanc
  abrege: [477, 17], // à blanc
  codeExpert: [494, 1], // à blanc
  ferme: [495, 1], // à blanc
  contrepartieAux: [496, 17], // « Non utilisé »
  effet: [513, 1], // à blanc
  multidevise: [514, 1], // à blanc
  centralisable: [515, 1], // à blanc
  aExtourner: [516, 1], // à blanc
  excluDosEco: [517, 1], // à blanc
} as const satisfies Zones

/** L'écriture (v11, p. 40 et 41 ; v010, p. 42 et 43 ; v7, p. 35 et 36 : les mêmes positions). */
export const ZONES_DE_L_ECRITURE = {
  journal: [1, 3], // « Code journal »
  date: [4, 8], // « Date du mouvement sous la forme ‘JJMMAAAA’ »
  typePiece: [12, 2], // « Nature du mouvement », obligatoire
  general: [14, 17], // « Compte général »
  typeCompte: [31, 1], // « Nature de la ligne de mouvement » : à blanc pour une ligne générale (l'exemple, p. 42)
  auxiliaire: [32, 17], // « Compte auxiliaire si TYPE CPTE=X » : à blanc
  refInterne: [49, 35], // « Référence du mouvement interne (numéro de pièce comptable) »
  libelle: [84, 35], // « Libellé du mouvement »
  modePaie: [119, 3], // « Codification identique à CATEGORIE (MDP) » : à blanc
  echeance: [122, 8], // « Si non renseignée, vide ou 01011900 » : à blanc
  sens: [130, 1], // « D=Débit ; C=Crédit »
  montant1: [131, 20], // « Les montants sont séparés par des virgules ‘,’ (exemple 100,00) et sont alignés à droite »
  typeEcriture: [151, 1], // « N=Ecriture normale »
  numeroPiece: [152, 8], // « Si non renseignée, vide ou ‘0’ alors obligatoirement pour la totalité du fichier »
  devise: [160, 3], // « Si Rien, considéré comme la monnaie de tenue de comptabilité » : à blanc
  tauxDevise: [163, 10], // « Vide ou 1 pour la monnaie de tenue » : à blanc
  codeMontant: [173, 3], // « E-- signifie que la zone MONTANT1 est en €uro, et que les zones MONTANT2 et MONTANT3=0 »
  montant2: [176, 20], // à blanc
  montant3: [196, 20], // à blanc
  etablissement: [216, 3], // « Si non renseignée, établissement par défaut » : à blanc
  axe: [219, 2], // « Si TYPE CPTE = A1, A2, A3 » : à blanc
  numeroEcheance: [221, 2], // « Si TYPE CPTE = X » : à blanc
} as const satisfies Zones

/** Le document GED associé à une écriture (v11, p. 49 ; v7, p. 42). */
export const ZONES_DU_DOCUMENT = {
  journal: [1, 3],
  date: [4, 8],
  typePiece: [12, 2],
  general: [14, 17],
  typeCompte: [31, 1], // « G=GED »
  auxiliaire: [32, 17], // « selon cpte » : à blanc
  refInterne: [49, 35],
  document: [84, 255], // « Chemin du document + document associé », obligatoire
} as const satisfies Zones

export const LONGUEUR_DE_L_EN_TETE = 165
export const LONGUEUR_DU_JOURNAL = 517
export const LONGUEUR_DE_L_ECRITURE = 222
export const LONGUEUR_DU_DOCUMENT = 338

/**
 * Un enregistrement composé de ses zones : chaque valeur cadrée à gauche et complétée de blancs, sauf celles que l'appelant
 * cadre lui-même (MONTANT1, aligné à droite) ; une valeur plus longue que sa zone LÈVE — l'appelant l'a coupée ou refusée
 * avant, jamais ici ; une zone qui ne commence pas où la précédente finit lève aussi.
 */
export function enregistrementTra<Z extends Zones>(zones: Z, valeurs: Partial<Record<keyof Z & string, string>>): string {
  let ligne = ''
  for (const [zone, [position, longueur]] of Object.entries(zones)) {
    if (ligne.length !== position - 1) throw new RangeError(`La zone ${zone} commence en ${position}, pas en ${ligne.length + 1}.`)
    const v = (valeurs as Record<string, string | undefined>)[zone] ?? ''
    if ([...v].length > longueur) throw new RangeError(`La zone ${zone} a ${longueur} caractères, la valeur en a ${[...v].length}.`)
    ligne += v.padEnd(longueur, ' ')
  }
  return ligne
}

/**
 * Le montant du FEC (« 1234,56 ») tel que MONTANT1 l'écrit : « séparés par des virgules ‘,’ (exemple 100,00) et […] alignés à
 * droite » sur vingt ; null s'il ne se lit pas, s'il est négatif (le signe n'est pas décrit) ou plus long que la zone.
 */
export function montantTra(montantDuFec: string): { texte: string; nul: boolean } | null {
  const m = /^(\d+),(\d{2})$/.exec(montantDuFec)
  if (!m) return null
  const texte = `${m[1].replace(/^0+(?=\d)/, '')},${m[2]}`
  if (texte.length > ZONES_DE_L_ECRITURE.montant1[1]) return null
  return { texte: texte.padStart(ZONES_DE_L_ECRITURE.montant1[1], ' '), nul: /^0+$/.test(m[1] + m[2]) }
}

/** La date du FEC (AAAAMMJJ) en JJMMAAAA ; null si elle n'a pas cette forme. */
export function dateTra(dateDuFec: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(dateDuFec)
  return m ? `${m[3]}${m[2]}${m[1]}` : null
}

/** Le nom d'un justificatif : la référence neutre de sa pièce (« AAAAMMJJ-xxxxxxxx »), puis son extension. */
export function nomDuJustificatifTra(reference: string, extension: string): string | null {
  return /^\d{8}-[0-9a-f]{8}$/.test(reference) && /^[a-z0-9]{3}$/.test(extension) ? `${reference}.${extension}` : null
}

/** Le nom du fichier de mouvements : celui du FEC, « TRA » à la place de « FEC », en `.TRA` (« le fichier de mouvements .TRA »). */
export function nomDuFichierTra(nomDuFec: string): string {
  return nomDuFec.replace(/FEC(\d{8})\.txt$/, 'TRA$1.TRA')
}

/** Le nom de l'archive : celui du fichier de mouvements, en `.zip`. */
export function nomDeLArchiveTra(nomDuFec: string): string {
  return nomDuFichierTra(nomDuFec).replace(/\.TRA$/, '.zip')
}

export type ExportTra =
  | {
    ok: true
    texte: string
    /** Le fichier dans l'encodage choisi, tel qu'il part. */
    octets: Uint8Array
    ecritures: number
    /** Les enregistrements d'écriture (une ligne du FEC chacun), hors en-tête, journaux et documents. */
    lignes: number
    /** Les EcritureNum du FEC qui partent, avec leur numéro continu (pour les justificatifs et NUMEROPIECE). */
    numeros: ReadonlyMap<string, number>
    comptes: CompteDeLExport[]
    journaux: { nous: string; eux: string; libelle: string; nature: NatureDeJournalTra; typeDePiece: TypeDePieceTra }[]
    /** Ce que la largeur fixe ou l'enregistrement d'écriture ne porte pas : compté, dit avant le clic. */
    libellesCoupes: number
    piecesCoupees: number
    auxiliairesNonRepris: number
    lettragesNonRepris: number
    vingtDeux: boolean
    /** Les enregistrements « G » écrits : un par écriture dont le justificatif part. */
    justificatifsNommes: number
  }
  | { ok: false; refus: string[] }

const COLONNES_REQUISES = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'PieceRef', 'EcritureLib',
  'Debit', 'Credit'] as const

function plafonner(refus: string[]): string[] {
  if (refus.length <= REFUS_NOMMES_AU_PLUS) return refus
  return [...refus.slice(0, REFUS_NOMMES_AU_PLUS), `… et ${refus.length - REFUS_NOMMES_AU_PLUS} autre(s) du même genre.`]
}

function couper(texte: string, longueur: number): { valeur: string; coupe: boolean } {
  const c = [...texte]
  return c.length > longueur ? { valeur: c.slice(0, longueur).join(''), coupe: true } : { valeur: texte, coupe: false }
}

function horsDeLEncodage(texte: string, encodage: EncodageTra): string | null {
  if (encodage === 'windows-1252') return horsDeWindows1252(texte)
  for (const c of texte) if (c.codePointAt(0)! > 0x7f) return c
  return null
}

function nomDeLEncodage(encodage: EncodageTra): string {
  return encodage === 'ascii' ? 'ASCII strict' : 'Windows-1252'
}

/** Ce qui précède le nom du justificatif ; null si ce n'est pas dit, ou si le dossier saisi ne finit pas par son séparateur. */
function prefixeDuChemin(chemin: CheminDesJustificatifsTra): string | null {
  if (chemin.mode === 'nom_seul') return ''
  return /[\\/]$/.test(chemin.dossier) && chemin.dossier.trim() !== '' ? chemin.dossier : null
}

/**
 * Le FEC réglementaire mis en forme en fichier TRA « de type journal ». `avecJustificatifs` : l'aperçu demande déjà le chemin
 * des justificatifs quand la case est cochée ; `joints` : la PieceRef d'une pièce → le nom de son justificatif tel que
 * l'archive le porte (vide pour l'aperçu, avant que leur type soit lu). Refuse AVANT tout fichier : un réglage à saisir, un
 * code ou un réglage de journal qui ne tient pas, un compte plus long que la longueur dite, un montant négatif ou illisible,
 * une date qui ne se lit pas, une ligne au débit ET au crédit, ou à zéro, un montant en devise, un caractère hors de
 * l'encodage choisi, deux pièces que la coupe confondrait, un numéro d'écriture de plus de huit chiffres — chacun nommé.
 */
export function mettreEnFormePourTra(
  fec: string, reglages: ReglagesTra,
  { avecJustificatifs, joints = new Map() }: { avecJustificatifs: boolean; joints?: ReadonlyMap<string, string> },
): ExportTra {
  const aSaisir: string[] = []
  if (reglages.encodage === null) aSaisir.push('L’encodage du fichier : à saisir.')
  if (reglages.finDEnregistrement === null) aSaisir.push('La fin d’enregistrement : à saisir.')
  const longueur = reglages.longueurDesComptes
  if (longueur === null) aSaisir.push('La longueur des comptes dans le dossier Cegid : à saisir.')
  else if (!Number.isInteger(longueur) || longueur < LONGUEUR_DES_COMPTES_TRA_MIN || longueur > LONGUEUR_DES_COMPTES_TRA_MAX) {
    aSaisir.push(`La longueur des comptes va de ${LONGUEUR_DES_COMPTES_TRA_MIN} à ${LONGUEUR_DES_COMPTES_TRA_MAX} caractères.`)
  }
  if (reglages.produit === null) aSaisir.push('Le produit qui génère le fichier (en-tête, position 4) : à saisir.')
  if (reglages.origine === null) aSaisir.push('L’origine du fichier, CLI ou EXP (en-tête, position 6) : à saisir.')
  if (reglages.nouvelleAnalytique === null) aSaisir.push('La gestion de l’analytique du dossier, X ou - (en-tête, position 148) : à saisir.')
  if (reglages.numeroDePiece === null) aSaisir.push('Le numéro de pièce des écritures : à saisir.')
  let prefixe: string | null = ''
  if (avecJustificatifs) {
    if (reglages.cheminDesJustificatifs === null) { aSaisir.push('Le chemin des justificatifs dans le fichier : à saisir.'); prefixe = null }
    else {
      prefixe = prefixeDuChemin(reglages.cheminDesJustificatifs)
      if (prefixe === null) aSaisir.push('Le dossier des justificatifs se termine par son séparateur, « \\ » ou « / ».')
    }
  }

  const lignesDuFec = fec.split('\r\n')
  const entete = lignesDuFec[0]?.split('\t') ?? []
  const colonne = (nom: string) => entete.indexOf(nom)
  if (COLONNES_REQUISES.some((c) => colonne(c) < 0)) return { ok: false, refus: ['Le FEC relu n’a pas les colonnes attendues : rien ne part.'] }
  const i = Object.fromEntries(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompAuxNum', 'PieceRef',
    'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'Idevise'].map((n) => [n, colonne(n)])) as Record<string, number>
  const vingtDeux = entete.length === 22 && colonne('NatOp') >= 0

  const lignes = lignesDuFec.slice(1).filter((l) => l !== '').map((l) => l.split('\t'))
  if (lignes.some((c) => c.length !== entete.length)) {
    return { ok: false, refus: ['Une ligne du FEC relu n’a pas le nombre de colonnes de son en-tête : rien ne part.'] }
  }
  const partent = lignes.filter((c) => !(reglages.sansANouveaux && c[i.JournalCode] === 'AN'))

  // Les journaux qui partent, chacun à décrire : aucun ne garde notre code, notre libellé ni une nature en silence.
  const journaux = new Map<string, { nous: string; eux: string; libelle: string; nature: NatureDeJournalTra; typeDePiece: TypeDePieceTra; contrepartie: string }>()
  const journauxVus = new Set<string>()
  const codesPris = new Map<string, string>()
  for (const c of partent) {
    const nous = c[i.JournalCode]
    if (journauxVus.has(nous)) continue
    journauxVus.add(nous)
    const r = reglages.journaux[nous] ?? JOURNAL_TRA_A_SAISIR
    const nom = `Le journal ${nous} (${c[i.JournalLib]})`
    const avant = aSaisir.length
    const code = r.code.trim()
    if (code === '') aSaisir.push(`${nom} : son code dans le dossier Cegid, à saisir.`)
    else if (!CODE_DE_JOURNAL_TRA.test(code)) aSaisir.push(`${nom} : son code tient en une à trois lettres ou chiffres (« ${code} »).`)
    else if (codesPris.has(code)) aSaisir.push(`${nom} : le code « ${code} » est déjà celui du journal ${codesPris.get(code)}.`)
    else codesPris.set(code, nous)
    const libelle = r.libelle.trim()
    if (libelle === '') aSaisir.push(`${nom} : son libellé dans le dossier Cegid, à saisir.`)
    else if ([...libelle].length > ZONES_DU_JOURNAL.libelle[1]) aSaisir.push(`${nom} : son libellé tient en trente-cinq caractères.`)
    if (r.nature === null) aSaisir.push(`${nom} : sa nature dans le dossier Cegid, à saisir.`)
    else if (NATURES_ANALYTIQUES.includes(r.nature)) aSaisir.push(`${nom} : la nature ${r.nature} demande un axe analytique, que ce fichier n’écrit pas.`)
    if (r.typeDePiece === null) aSaisir.push(`${nom} : la nature du mouvement de ses écritures (TYPE PIECE), à saisir.`)
    const contrepartie = r.contrepartie.trim()
    if (r.nature !== null && NATURES_A_CONTREPARTIE.includes(r.nature)) {
      if (contrepartie === '') aSaisir.push(`${nom} : une nature ${r.nature} demande son compte de contrepartie, à saisir.`)
      else if (!/^[A-Za-z0-9]+$/.test(contrepartie)) aSaisir.push(`${nom} : le compte de contrepartie « ${contrepartie} » n’est pas fait de lettres et de chiffres.`)
      else if (longueur !== null && contrepartie.length > longueur) {
        aSaisir.push(`${nom} : le compte de contrepartie ${contrepartie} a plus de caractères que la longueur choisie (${longueur}).`)
      }
    }
    if (aSaisir.length === avant && r.nature !== null && r.typeDePiece !== null) {
      journaux.set(nous, { nous, eux: code, libelle, nature: r.nature, typeDePiece: r.typeDePiece, contrepartie })
    }
  }
  if (aSaisir.length > 0 || longueur === null || reglages.encodage === null || reglages.finDEnregistrement === null
    || reglages.produit === null || reglages.origine === null || reglages.nouvelleAnalytique === null || reglages.numeroDePiece === null
    || prefixe === null) {
    return { ok: false, refus: aSaisir }
  }
  if (partent.length === 0) return { ok: false, refus: ['Aucune écriture à exporter.'] }
  const encodage = reglages.encodage

  const refus: string[] = []
  const horsEncodage: string[] = []
  const comptes = new Map<string, string>()
  const numeros = new Map<string, number>()
  const piecesCoupees = new Map<string, string>()
  const confondues = new Set<string>()
  const ecritures: string[] = []
  const sortie: string[] = []
  let libellesCoupes = 0
  let nombreDePiecesCoupees = 0
  let auxiliairesNonRepris = 0
  let lettragesNonRepris = 0
  let justificatifsNommes = 0
  // Le document GED d'une écriture s'écrit après sa DERNIÈRE ligne : il se garde jusqu'au changement d'écriture.
  let documentEnAttente: string | null = null
  let ecritureEnCours: string | null = null

  const verifierLEncodage = (ou: string, quoi: string, valeur: string) => {
    const hors = horsDeLEncodage(valeur, encodage)
    if (hors) {
      horsEncodage.push(`${ou}, ${quoi} : le caractère « ${hors} » (${pointDeCode(hors)}) n’existe pas en ${nomDeLEncodage(encodage)} — `
        + 'corrige-le dans l’application.')
      return false
    }
    return true
  }

  const completer = (compte: string) => compte.padEnd(longueur, '0')
  for (const j of journaux.values()) {
    const ou = `Le journal ${j.nous}`
    verifierLEncodage(ou, 'son libellé', j.libelle)
    sortie.push(enregistrementTra(ZONES_DU_JOURNAL, {
      fixe: '***', identifiant: 'JAL', code: j.eux, libelle: j.libelle, nature: j.nature,
      compte: NATURES_A_CONTREPARTIE.includes(j.nature) ? completer(j.contrepartie) : '',
      modeSaisie: j.nature === 'ANO' ? '-' : '',
    }))
  }

  for (const c of partent) {
    const numeroDuFec = c[i.EcritureNum]
    if (ecritureEnCours !== null && numeroDuFec !== ecritureEnCours && documentEnAttente !== null) {
      sortie.push(documentEnAttente)
      documentEnAttente = null
    }
    ecritureEnCours = numeroDuFec
    const numeroDeLigne = ecritures.length + 1
    const ou = `Ligne ${numeroDeLigne} des écritures (écriture ${numeroDuFec})`
    const premiereDeLEcriture = !numeros.has(numeroDuFec)
    if (premiereDeLEcriture) numeros.set(numeroDuFec, numeros.size + 1)
    const numero = numeros.get(numeroDuFec)!
    const numeroDePiece = reglages.numeroDePiece === 'continu' ? String(numero).padStart(ZONES_DE_L_ECRITURE.numeroPiece[1], '0') : ''
    if (numeroDePiece.length > ZONES_DE_L_ECRITURE.numeroPiece[1]) refus.push(`${ou} : le numéro d’écriture ${numero} passe huit chiffres.`)

    const compte = c[i.CompteNum]
    let compteEcrit = ''
    if (!/^[A-Za-z0-9]+$/.test(compte)) refus.push(`${ou} : le compte « ${compte} » n’est pas fait de lettres et de chiffres.`)
    else if (compte.length > longueur) {
      refus.push(`${ou} : le compte ${compte} a ${compte.length} caractères, plus que la longueur choisie (${longueur}) — il ne se tronque pas.`)
    } else {
      compteEcrit = completer(compte)
      comptes.set(compte, compteEcrit)
    }

    const date = dateTra(c[i.EcritureDate])
    if (date === null) refus.push(`${ou} : la date « ${c[i.EcritureDate]} » n’a pas la forme AAAAMMJJ.`)

    const debit = montantTra(c[i.Debit])
    const credit = montantTra(c[i.Credit])
    let sens: 'D' | 'C' | null = null
    let montant: string | null = null
    if (/^-/.test(c[i.Debit]) || /^-/.test(c[i.Credit])) {
      refus.push(`${ou} : un montant négatif — la description du TRA ne dit pas comment s’écrit son signe.`)
    } else if (debit === null || credit === null) refus.push(`${ou} : un montant ne se lit pas, ou passe vingt caractères.`)
    else if (!debit.nul && !credit.nul) refus.push(`${ou} : la ligne porte un débit ET un crédit — le sens ne se devine pas.`)
    else if (debit.nul && credit.nul) refus.push(`${ou} : la ligne est à zéro — le sens ne se devine pas.`)
    else if (!debit.nul) { sens = 'D'; montant = debit.texte } else { sens = 'C'; montant = credit.texte }

    if (i.Idevise >= 0 && c[i.Idevise].trim() !== '') refus.push(`${ou} : un montant en devise (${c[i.Idevise]}) — ce profil n’écrit que l’euro.`)
    if (i.CompAuxNum >= 0 && c[i.CompAuxNum] !== '') auxiliairesNonRepris++
    if (i.EcritureLet >= 0 && c[i.EcritureLet] !== '') lettragesNonRepris++

    const libelle = couper(c[i.EcritureLib], ZONES_DE_L_ECRITURE.libelle[1])
    if (libelle.coupe) libellesCoupes++
    const reference = c[i.PieceRef]
    const piece = couper(reference, ZONES_DE_L_ECRITURE.refInterne[1])
    if (piece.coupe) {
      nombreDePiecesCoupees++
      const autre = piecesCoupees.get(piece.valeur)
      if (autre !== undefined && autre !== reference && !confondues.has(piece.valeur)) {
        confondues.add(piece.valeur)
        refus.push(`${ou} : coupées à trente-cinq caractères, les pièces « ${autre} » et « ${reference} » se confondraient.`)
      }
      piecesCoupees.set(piece.valeur, reference)
    }
    if (verifierLEncodage(ou, 'son libellé', libelle.valeur)) verifierLEncodage(ou, 'sa pièce', piece.valeur)

    const journal = journaux.get(c[i.JournalCode])!
    ecritures.push(numeroDuFec)
    if (sens === null || montant === null || date === null || compteEcrit === '') { sortie.push(''); continue }
    sortie.push(enregistrementTra(ZONES_DE_L_ECRITURE, {
      journal: journal.eux, date, typePiece: journal.typeDePiece, general: compteEcrit, refInterne: piece.valeur,
      libelle: libelle.valeur, sens, montant1: montant, typeEcriture: 'N', numeroPiece: numeroDePiece, codeMontant: 'E--',
    }))

    // Le justificatif, un enregistrement « G » par écriture, sous le compte et la pièce de sa PREMIÈRE ligne.
    // Les justificatifs (`justificatifsDeLExport`, le profil commun) ne se nomment que la case cochée.
    const joint = avecJustificatifs && premiereDeLEcriture ? joints.get(reference) : undefined
    if (joint !== undefined) {
      const document = `${prefixe}${joint}`
      if ([...document].length > ZONES_DU_DOCUMENT.document[1]) refus.push(`${ou} : le chemin du justificatif passe 255 caractères.`)
      else if (verifierLEncodage(ou, 'le chemin de son justificatif', document)) {
        documentEnAttente = enregistrementTra(ZONES_DU_DOCUMENT, {
          journal: journal.eux, date, typePiece: journal.typeDePiece, general: compteEcrit, typeCompte: 'G', refInterne: piece.valeur, document,
        })
        justificatifsNommes++
      }
    }
  }
  if (documentEnAttente !== null) sortie.push(documentEnAttente)

  const tousLesRefus = [...plafonner(refus), ...plafonner(horsEncodage)]
  if (tousLesRefus.length > 0) return { ok: false, refus: tousLesRefus }

  const enTete = enregistrementTra(ZONES_DE_L_EN_TETE, {
    fixe: '***', produit: reglages.produit, origine: reglages.origine, typeFichier: 'JRL', format: 'STD',
    dateBascule: '01011900', dateArrete: '01011900', version: '011', datePurge: '01011900', sousVersion: '001',
    nouvelleAnalytique: reglages.nouvelleAnalytique, readyGuid: '-',
  })
  const fin = FIN[reglages.finDEnregistrement]
  const texte = [enTete, ...sortie].join(fin) + fin
  const octets = encodage === 'windows-1252' ? encoderWindows1252(texte) : Uint8Array.from([...texte].map((ch) => ch.codePointAt(0)!))
  return {
    ok: true, texte, octets, ecritures: numeros.size, lignes: ecritures.length, numeros,
    comptes: [...comptes].map(([nous, eux]) => ({ nous, eux })).sort((a, b) => a.nous.localeCompare(b.nous)),
    journaux: [...journaux.values()].map(({ nous, eux, libelle, nature, typeDePiece }) => ({ nous, eux, libelle, nature, typeDePiece })),
    libellesCoupes, piecesCoupees: nombreDePiecesCoupees, auxiliairesNonRepris, lettragesNonRepris, vingtDeux, justificatifsNommes,
  }
}

