import type { NumerotationFec } from './fec'
import {
  encoderWindows1252, horsDeWindows1252, justificatifsDeLExport, pointDeCode, REFUS_NOMMES_AU_PLUS,
  type CompteDeLExport, type JournalDeLExport, type JustificatifAJoindre, type JustificatifsDeLExport, type PieceDesJustificatifs,
} from './profilsDExport'

// LE PROFIL « CEGID QUADRA » DE L'EXPORT VERS UN LOGICIEL COMPTABLE (EXP3, 26/11/2026 ; la recherche :
// docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.2 et § 5 point 3). Le fichier d'entrée « ASCII » de Cegid
// Quadra Comptabilité, à LARGEUR FIXE, tel que l'éditeur le décrit dans sa fiche publique : Cegid, « Fichier d'entrée ASCII
// dans Cegid Quadra Comptabilité », KB0014530, fiche version Comptabilité 2023.194.10, mise à jour 08/2023, « Niveau :
// Document Public » (hébergée par le wiki de Dolibarr, relue le 26/11/2026, SHA-256 du PDF df71f839…ecd14ecc). Chaque
// position ci-dessous cite sa ligne de la fiche (« KB0014530, p. 2 » ou « p. 3 »).
//
// LE MÊME MOTEUR QUE LE PROFIL ACD : le fichier part du FEC RÉGLEMENTAIRE de l'onglet Écritures (le texte de `formaterFec`),
// relu colonne par colonne, et n'en récrit que la FORME. Aucun montant, aucune date, aucune pièce ne se recalcule ; le FEC ne
// change pas d'un octet. Ce module ne lit ni n'écrit la base : pur, sans `supabase.ts`.
//
// CE QUE LA FICHE FIXE, ÉCRIT TEL QUEL : l'enregistrement `M` d'une ligne d'écriture, ses positions et ses longueurs ; le
// folio « 000 » ; la date JJMMAA ; le sens D/C ; le montant en centimes, signé en position 43 ; le code devise « EUR » (la
// fiche : « Espace = FRF ») ; le code journal en 10 sur deux caractères ET en 111 sur trois, l'un et l'autre obligatoires ; le
// libellé sur 30 en 117, la position 22 laissée à blanc ; le numéro de pièce en 232 sur 20, « prioritaire » ; le justificatif
// en 182, « nom du fichier sur 8 caractères + extension sur 3 », le fichier « au même endroit que le fichier ASCII ».
//
// CE QU'ELLE NE FIXE PAS, ET QUI NE SE DEVINE PAS — un réglage SANS défaut, « à saisir » tant que le cabinet ne l'a pas dit,
// et l'export refusé d'ici là : l'ENCODAGE (la fiche dit « ASCII » et rien de plus : Windows-1252, ou l'ASCII strict qui refuse
// toute lettre accentuée) ; la FIN D'ENREGISTREMENT (« se terminant par un "Return" » : CR LF ou CR seul) ; la LONGUEUR DES
// COMPTES du dossier dans Quadra (de 6 à 8, le compte complété de zéros à droite comme pour ACD, la zone de 8 complétée de
// blancs) ; le CODE de chacun de nos journaux dans le dossier Quadra (une ou deux lettres ou chiffres — un code de trois ne
// tient pas dans la position 10, que la fiche dit obligatoire « même si renseigné en 111 sur 3 » : refusé plutôt que coupé).
//
// CE QUI NE PART PAS, DIT AVANT LE CLIC : les comptes auxiliaires (un tiers de Quadra est un compte à lui, que décrit
// l'enregistrement `C` et son compte collectif, p. 3 : il n'est pas écrit — chaque ligne reste sur son compte collectif, le
// 401 ou le 411 du plan) ; le lettrage (deux caractères en 70, nos codes ne s'y confrontent pas) ; les quatre champs du BNC
// (DateRglt, ModeRglt, NatOp, IdClient : l'enregistrement `M` n'en a pas) ; EcritureNum et ValidDate. Un libellé de plus de
// 30 caractères et un numéro de pièce de plus de 20 se coupent à la largeur que la fiche leur donne — comptés, dits avant
// le clic ; deux numéros de pièce que la coupe rendrait égaux se refusent (deux écritures se confondraient).
//
// AUCUN TEXTE DE PLUS QUE LE FEC : ni le libellé du compte (CompteLib), ni celui du tiers, ni le nom d'un fichier — seul le
// libellé de l'écriture du FEC, déjà neutre (JJ1, JJ1-Q1), et la référence neutre de la pièce, dont le justificatif prend
// l'empreinte courte pour nom (§ 4, point 1 de la recherche).

/**
 * Le drapeau de l'écran : BAISSÉ, l'onglet Écritures n'offre pas ce profil. EXP-Q6 (B), tranchée le 17/11/2026, fait écrire
 * Quadra et le TRA sans attendre la demande d'un cabinet ; mais aucun fichier de ce profil n'a encore été importé dans Quadra :
 * le drapeau ne se lève qu'après un premier essai d'import réel chez un expert-comptable qui l'a, avec ses réponses à EXP3-Q1
 * à Q3.
 */
export const PROFIL_QUADRA_OFFERT: boolean = false

/**
 * Le profil, À PART de `PROFILS_D_EXPORT` : la base ne garde de réglages que pour les logiciels de `logiciels_d_export()`,
 * `acd` seul (migration 20261125123611_reglages_d_export, contrainte `reglages_d_export_logiciel`). Ajouter « quadra » à
 * cette liste est une migration (EXP3-Q4) ; d'ici là, ses réglages se saisissent à chaque export et ne se gardent pas.
 */
export const PROFIL_QUADRA = { id: 'quadra', libelle: 'Cegid Quadra (fichier ASCII)' } as const

export type EncodageQuadra = 'windows-1252' | 'ascii'
export const ENCODAGES_QUADRA: readonly { id: EncodageQuadra; libelle: string }[] = [
  { id: 'windows-1252', libelle: 'Windows-1252 (les lettres accentuées passent)' },
  { id: 'ascii', libelle: 'ASCII strict (toute lettre accentuée se refuse)' },
]

export type FinDEnregistrementQuadra = 'crlf' | 'cr'
export const FINS_D_ENREGISTREMENT_QUADRA: readonly { id: FinDEnregistrementQuadra; libelle: string }[] = [
  { id: 'crlf', libelle: 'CR LF (retour chariot et saut de ligne)' },
  { id: 'cr', libelle: 'CR seul (retour chariot)' },
]
const FIN: Readonly<Record<FinDEnregistrementQuadra, string>> = { crlf: '\r\n', cr: '\r' }

export const LONGUEUR_DES_COMPTES_QUADRA_MIN = 6
/** La zone du numéro de compte : position 2, longueur 8 (KB0014530, p. 2). */
export const LONGUEUR_DES_COMPTES_QUADRA_MAX = 8

/** Ce que le cabinet dit pour un export ; un réglage nul est « à saisir ». */
export interface ReglagesQuadra {
  encodage: EncodageQuadra | null
  finDEnregistrement: FinDEnregistrementQuadra | null
  longueurDesComptes: number | null
  /** Nos codes de journaux → ceux du dossier Quadra. Un journal du fichier sans code est à saisir : aucun ne garde le nôtre. */
  journaux: Readonly<Record<string, string>>
  /** Sans le journal des à-nouveaux : le dossier Quadra a déjà les siens, les importer les doublerait. */
  sansANouveaux: boolean
}

/** Un code de journal de Quadra : une ou deux lettres ou chiffres (la position 10, longueur 2, KB0014530, p. 2). */
export const CODE_DE_JOURNAL_QUADRA = /^[A-Za-z0-9]{1,2}$/

/** Les zones de l'enregistrement `M` (KB0014530, p. 2), position de 1 en tête et longueur : l'ordre de la fiche. */
export const ZONES_DE_L_ENREGISTREMENT_M = {
  type: [1, 1], // « * Type = M »
  compte: [2, 8], // « * Numéro de compte »
  journal2: [10, 2], // « * Code journal sur 2 caract. (obligatoire même si renseigné en 111 sur 3) »
  folio: [12, 3], // « * N° folio (à initialiser à "000" si pas de folio) »
  date: [15, 6], // « * Date écriture (JJMMAA) »
  codeLibelle: [21, 1], // « Code libellé » : à blanc
  libelleLibre: [22, 20], // « Libellé libre » : à blanc, le libellé part en 117
  sens: [42, 1], // « * Sens Débit/Crédit (D/C) »
  montant: [43, 13], // « * Montant en centimes signé (position 43=signe) »
  contrepartie: [56, 8], // « Compte de contrepartie » : à blanc
  echeance: [64, 6], // « Date échéance (JJMMAA) » : à blanc
  lettrage: [70, 2], // « Code lettrage » : à blanc
  statistiques: [72, 3], // « Code statistiques » : à blanc
  piece5: [75, 5], // « N° de pièce sur 5 caractères maximum » : à blanc (la 232 est prioritaire)
  affaire: [80, 10], // « Code affaire » : à blanc
  quantite1: [90, 10], // « Quantité 1 » : à blanc
  piece8: [100, 8], // « Numéro de pièce jusqu'à 8 caractères » : à blanc
  devise: [108, 3], // « Code devise (FRF ou EUR, Espace = FRF, ou Devise) » : EUR
  journal3: [111, 3], // « QC Windows seulement — * Code journal sur 3 caractères »
  tvaGeree: [114, 1], // « Flag Code TVA géré dans l'écriture = O (oui) » : à blanc
  codeTva: [115, 1], // « Code TVA =0à9 » : à blanc
  methodeTva: [116, 1], // « Méthode de calcul TVA = D (Débits) ou E (Encaissements) » : à blanc
  libelle: [117, 30], // « Libellé écriture sur 30 caract. (blanc si renseigné en 22 sur 20 caract.) »
  codeTva2: [147, 2], // « Code TVA sur 2 caractères » : à blanc
  piece10: [149, 10], // « N° de pièce alphanumérique sur 10 caract. » : à blanc
  reserve: [159, 10], // « Réservé »
  montantDevise: [169, 13], // « Montant dans la devise (en centimes signés position 169=signe) » : à blanc
  pieceJointe: [182, 12], // « Pièce jointe à l'écriture, nom du fichier sur 8 caractères + extension sur 3 — Importation seulement »
  quantite2: [194, 10], // « Quantité 2 » : à blanc
  exportation: [204, 28], // « NumUniq » (10), « Code opérateur » (4), « Date système » (14) : « Exportation seulement », à blanc
  piece: [232, 20], // « Numéro de pièce (*) — (*) prioritaire »
} as const satisfies Record<string, readonly [number, number]>

type Zone = keyof typeof ZONES_DE_L_ENREGISTREMENT_M

/** La longueur d'un enregistrement `M` tel qu'il s'écrit : la fin de sa dernière zone (« Longueur d'enreg. : Variable »). */
export const LONGUEUR_DE_L_ENREGISTREMENT_M = ZONES_DE_L_ENREGISTREMENT_M.piece[0] + ZONES_DE_L_ENREGISTREMENT_M.piece[1] - 1

/** Les chiffres d'un montant après son signe : la zone de 13, moins la position du signe. */
const CHIFFRES_DU_MONTANT = ZONES_DE_L_ENREGISTREMENT_M.montant[1] - 1

/**
 * L'enregistrement `M` composé de ses zones : chaque valeur cadrée à gauche et complétée de blancs (« les autres peuvent être
 * renseignées à blanc ») ; une valeur plus longue que sa zone LÈVE — l'appelant l'a coupée ou refusée avant, jamais ici.
 */
export function enregistrementM(valeurs: Partial<Record<Zone, string>>): string {
  let ligne = ''
  for (const [zone, [position, longueur]] of Object.entries(ZONES_DE_L_ENREGISTREMENT_M) as [Zone, readonly [number, number]][]) {
    if (ligne.length !== position - 1) throw new RangeError(`La zone ${zone} commence en ${position}, pas en ${ligne.length + 1}.`)
    const v = valeurs[zone] ?? ''
    if ([...v].length > longueur) throw new RangeError(`La zone ${zone} a ${longueur} caractères, la valeur en a ${[...v].length}.`)
    ligne += v.padEnd(longueur, ' ')
  }
  return ligne
}

/** Le montant du FEC (« 1234,56 », « -12,00 ») en centimes signés sur 13 : le signe, puis douze chiffres ; null s'il ne se lit pas. */
export function montantQuadra(montantDuFec: string): { signe: '+' | '-'; chiffres: string; nul: boolean } | null {
  const m = /^(-?)(\d+),(\d{2})$/.exec(montantDuFec)
  if (!m) return null
  const centimes = (m[2] + m[3]).replace(/^0+(?=\d)/, '')
  if (centimes.length > CHIFFRES_DU_MONTANT) return null
  // Un « -0,00 » n'est qu'un zéro : il ne porte pas de signe.
  const nul = /^0+$/.test(centimes)
  return { signe: m[1] === '-' && !nul ? '-' : '+', chiffres: centimes.padStart(CHIFFRES_DU_MONTANT, '0'), nul }
}

/** La date du FEC (AAAAMMJJ) en JJMMAA (KB0014530, p. 2) ; null si elle n'a pas cette forme. */
export function dateQuadra(dateDuFec: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(dateDuFec)
  return m ? `${m[4]}${m[3]}${m[2]}` : null
}

/** Le nom 8+3 d'un justificatif : l'empreinte courte de sa référence neutre (« AAAAMMJJ-xxxxxxxx »), puis son extension. */
export function nomDuJustificatifQuadra(reference: string, extension: string): string | null {
  const m = /^\d{8}-([0-9a-f]{8})$/.exec(reference)
  return m && /^[a-z0-9]{3}$/.test(extension) ? `${m[1]}.${extension}` : null
}

/** Le nom du fichier d'écritures (« Nom du fichier : Libre », p. 2) : celui du FEC, « ASCII » à la place de « FEC ». */
export function nomDuFichierQuadra(nomDuFec: string): string {
  return nomDuFec.replace(/FEC(\d{8})\.txt$/, 'ASCII$1.txt')
}

export type ExportQuadra =
  | {
    ok: true
    texte: string
    /** Le fichier dans l'encodage choisi, tel qu'il part. */
    octets: Uint8Array
    ecritures: number
    lignes: number
    /** Les EcritureNum du FEC qui partent (pour les justificatifs) : ceux qu'on ne retient pas ne partent pas. */
    numeros: ReadonlyMap<string, number>
    comptes: CompteDeLExport[]
    journaux: JournalDeLExport[]
    /** Ce que la largeur fixe ou l'enregistrement `M` ne porte pas : compté, dit avant le clic. */
    libellesCoupes: number
    piecesCoupees: number
    auxiliairesNonRepris: number
    lettragesNonRepris: number
    vingtDeux: boolean
    /** Les écritures qui portent le nom de leur justificatif en position 182. */
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

function horsDeLEncodage(texte: string, encodage: EncodageQuadra): string | null {
  if (encodage === 'windows-1252') return horsDeWindows1252(texte)
  for (const c of texte) if (c.codePointAt(0)! > 0x7f) return c
  return null
}

/**
 * Le FEC réglementaire mis en forme pour Cegid Quadra. `joints` : la PieceRef d'une pièce → le nom 8+3 de son justificatif,
 * tel que l'archive le porte (vide pour un fichier sans justificatif, ou pour l'aperçu, avant que leur type soit lu). Refuse
 * AVANT tout fichier : un réglage à saisir, un code de journal qui ne tient pas, un compte plus long que la longueur dite, un
 * montant ou une date qui ne se lisent pas, une ligne au débit ET au crédit, ou à zéro (le sens ne se devine pas), un montant
 * en devise, un caractère hors de l'encodage choisi, deux numéros de pièce que la coupe confondrait — chacun nommé par sa ligne.
 */
export function mettreEnFormePourQuadra(fec: string, reglages: ReglagesQuadra, joints: ReadonlyMap<string, string> = new Map()): ExportQuadra {
  const aSaisir: string[] = []
  if (reglages.encodage === null) aSaisir.push('L’encodage du fichier : à saisir.')
  if (reglages.finDEnregistrement === null) aSaisir.push('La fin d’enregistrement : à saisir.')
  const longueur = reglages.longueurDesComptes
  if (longueur === null) aSaisir.push('La longueur des comptes dans le dossier Quadra : à saisir.')
  else if (!Number.isInteger(longueur) || longueur < LONGUEUR_DES_COMPTES_QUADRA_MIN || longueur > LONGUEUR_DES_COMPTES_QUADRA_MAX) {
    aSaisir.push(`La longueur des comptes va de ${LONGUEUR_DES_COMPTES_QUADRA_MIN} à ${LONGUEUR_DES_COMPTES_QUADRA_MAX} caractères `
      + '(la zone du compte en a huit).')
  }
  for (const [nous, eux] of Object.entries(reglages.journaux)) {
    if (eux.trim() !== '' && !CODE_DE_JOURNAL_QUADRA.test(eux)) {
      aSaisir.push(`Le code du journal qui remplace « ${nous} » tient en une ou deux lettres ou chiffres (« ${eux} »).`)
    }
  }

  const lignesDuFec = fec.split('\r\n')
  const entete = lignesDuFec[0]?.split('\t') ?? []
  const colonne = (nom: string) => entete.indexOf(nom)
  if (COLONNES_REQUISES.some((c) => colonne(c) < 0)) return { ok: false, refus: ['Le FEC relu n’a pas les colonnes attendues : rien ne part.'] }
  const i = Object.fromEntries(['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompAuxNum', 'PieceRef',
    'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'Montantdevise', 'Idevise'].map((n) => [n, colonne(n)])) as Record<string, number>
  const vingtDeux = entete.length === 22 && colonne('NatOp') >= 0

  // Les journaux qui partent, chacun à faire correspondre : aucun ne garde notre code en silence.
  const lignes = lignesDuFec.slice(1).filter((l) => l !== '').map((l) => l.split('\t'))
  if (lignes.some((c) => c.length !== entete.length)) {
    return { ok: false, refus: ['Une ligne du FEC relu n’a pas le nombre de colonnes de son en-tête : rien ne part.'] }
  }
  const partent = lignes.filter((c) => !(reglages.sansANouveaux && c[i.JournalCode] === 'AN'))
  const journaux = new Map<string, JournalDeLExport>()
  for (const c of partent) {
    const nous = c[i.JournalCode]
    if (journaux.has(nous)) continue
    const eux = (reglages.journaux[nous] ?? '').trim()
    if (eux === '') aSaisir.push(`Le code du journal ${nous} (${c[i.JournalLib]}) dans le dossier Quadra : à saisir.`)
    journaux.set(nous, { nous, eux, libelle: c[i.JournalLib] })
  }
  if (aSaisir.length > 0 || longueur === null || reglages.encodage === null || reglages.finDEnregistrement === null) {
    return { ok: false, refus: aSaisir }
  }
  if (partent.length === 0) return { ok: false, refus: ['Aucune écriture à exporter.'] }

  const refus: string[] = []
  const horsEncodage: string[] = []
  const comptes = new Map<string, string>()
  const numeros = new Map<string, number>()
  const piecesCoupees = new Map<string, string>()
  const confondues = new Set<string>()
  const ecrituresNommees = new Set<string>()
  const sortie: string[] = []
  let libellesCoupes = 0
  let nombreDePiecesCoupees = 0
  let auxiliairesNonRepris = 0
  let lettragesNonRepris = 0

  for (const c of partent) {
    const numeroDeLigne = sortie.length + 1
    const numeroDuFec = c[i.EcritureNum]
    const ou = `Ligne ${numeroDeLigne} du fichier (écriture ${numeroDuFec})`
    const premiereDeLEcriture = !numeros.has(numeroDuFec)
    if (premiereDeLEcriture) numeros.set(numeroDuFec, numeros.size + 1)

    const compte = c[i.CompteNum]
    let compteEcrit = ''
    if (!/^[A-Za-z0-9]+$/.test(compte)) refus.push(`${ou} : le compte « ${compte} » n’est pas fait de lettres et de chiffres.`)
    else if (compte.length > longueur) {
      refus.push(`${ou} : le compte ${compte} a ${compte.length} caractères, plus que la longueur choisie (${longueur}) — il ne se tronque pas.`)
    } else {
      compteEcrit = compte.padEnd(longueur, '0')
      comptes.set(compte, compteEcrit)
    }

    const date = dateQuadra(c[i.EcritureDate])
    if (date === null) refus.push(`${ou} : la date « ${c[i.EcritureDate]} » n’a pas la forme AAAAMMJJ.`)

    const debit = montantQuadra(c[i.Debit])
    const credit = montantQuadra(c[i.Credit])
    let sens: 'D' | 'C' | null = null
    let montant: { signe: string; chiffres: string } | null = null
    if (debit === null || credit === null) refus.push(`${ou} : un montant ne se lit pas, ou passe douze chiffres en centimes.`)
    else if (!debit.nul && !credit.nul) refus.push(`${ou} : la ligne porte un débit ET un crédit — le sens ne se devine pas.`)
    else if (debit.nul && credit.nul) refus.push(`${ou} : la ligne est à zéro — le sens ne se devine pas.`)
    else if (!debit.nul) { sens = 'D'; montant = debit } else { sens = 'C'; montant = credit }

    if (i.Idevise >= 0 && c[i.Idevise].trim() !== '') {
      refus.push(`${ou} : un montant en devise (${c[i.Idevise]}) — ce profil n’écrit que l’euro.`)
    }
    if (i.CompAuxNum >= 0 && c[i.CompAuxNum] !== '') auxiliairesNonRepris++
    if (i.EcritureLet >= 0 && c[i.EcritureLet] !== '') lettragesNonRepris++

    const libelle = couper(c[i.EcritureLib], ZONES_DE_L_ENREGISTREMENT_M.libelle[1])
    if (libelle.coupe) libellesCoupes++
    const reference = c[i.PieceRef]
    const piece = couper(reference, ZONES_DE_L_ENREGISTREMENT_M.piece[1])
    if (piece.coupe) {
      nombreDePiecesCoupees++
      const autre = piecesCoupees.get(piece.valeur)
      if (autre !== undefined && autre !== reference && !confondues.has(piece.valeur)) {
        confondues.add(piece.valeur)
        refus.push(`${ou} : coupés à vingt caractères, les numéros de pièce « ${autre} » et « ${reference} » se confondraient.`)
      }
      piecesCoupees.set(piece.valeur, reference)
    }
    // Le justificatif se nomme sur la PREMIÈRE ligne de son écriture : « pièce jointe à l'écriture », une fois.
    const joint = premiereDeLEcriture ? joints.get(reference) : undefined
    if (joint !== undefined) ecrituresNommees.add(numeroDuFec)

    const code = journaux.get(c[i.JournalCode])!.eux
    const champsTextes = { libelle: libelle.valeur, piece: piece.valeur }
    for (const [nom, valeur] of Object.entries(champsTextes)) {
      const hors = horsDeLEncodage(valeur, reglages.encodage)
      if (hors) {
        horsEncodage.push(`${ou}, ${nom === 'libelle' ? 'son libellé' : 'son numéro de pièce'} : le caractère « ${hors} » (${pointDeCode(hors)}) `
          + `n’existe pas en ${reglages.encodage === 'ascii' ? 'ASCII strict' : 'Windows-1252'} — corrige-le dans l’application.`)
        break
      }
    }
    if (sens === null || montant === null || date === null || compteEcrit === '') { sortie.push(''); continue }
    sortie.push(enregistrementM({
      type: 'M', compte: compteEcrit, journal2: code, folio: '000', date, sens, montant: `${montant.signe}${montant.chiffres}`,
      devise: 'EUR', journal3: code, libelle: libelle.valeur, pieceJointe: joint ?? '', piece: piece.valeur,
    }))
  }

  const tousLesRefus = [...plafonner(refus), ...plafonner(horsEncodage)]
  if (tousLesRefus.length > 0) return { ok: false, refus: tousLesRefus }

  const texte = sortie.join(FIN[reglages.finDEnregistrement]) + FIN[reglages.finDEnregistrement]
  const octets = reglages.encodage === 'windows-1252' ? encoderWindows1252(texte) : Uint8Array.from([...texte].map((ch) => ch.codePointAt(0)!))
  return {
    ok: true, texte, octets, ecritures: numeros.size, lignes: sortie.length, numeros,
    comptes: [...comptes].map(([nous, eux]) => ({ nous, eux })).sort((a, b) => a.nous.localeCompare(b.nous)),
    journaux: [...journaux.values()],
    libellesCoupes, piecesCoupees: nombreDePiecesCoupees, auxiliairesNonRepris, lettragesNonRepris, vingtDeux,
    justificatifsNommes: ecrituresNommees.size,
  }
}

/**
 * Les justificatifs que le fichier Quadra peut nommer : ceux du profil commun (`justificatifsDeLExport` : chaque pièce citée,
 * une fois, sous sa référence neutre), moins une pièce dont l'empreinte courte est déjà celle d'une autre — deux fichiers ne
 * portent pas le même nom de huit caractères, et le second se dit écarté.
 */
export function justificatifsDeLExportQuadra(
  dossierId: string, numerotation: NumerotationFec, pieces: readonly PieceDesJustificatifs[], numeros: ReadonlyMap<string, number>,
): JustificatifsDeLExport {
  const communs = justificatifsDeLExport(dossierId, numerotation, pieces, numeros)
  const parEmpreinte = new Map<string, string>()
  const aJoindre: JustificatifAJoindre[] = []
  const ecartes = [...communs.ecartes]
  for (const j of communs.aJoindre) {
    const empreinte = j.reference.slice(-8)
    const autre = parEmpreinte.get(empreinte)
    if (autre !== undefined) {
      ecartes.push(`La pièce ${j.reference} a la même empreinte courte que ${autre} : un seul fichier « ${empreinte} » part, le sien non.`)
      continue
    }
    parEmpreinte.set(empreinte, j.reference)
    aJoindre.push(j)
  }
  // Recompté sur ce qui part vraiment : une écriture dont la pièce a été écartée ici n'a plus de justificatif.
  const joints = new Set(aJoindre.map((j) => j.pieceId))
  const justifiees = new Set<string>()
  for (const l of numerotation.lignes) {
    const numero = `${l.journal}${String(l.numero).padStart(5, '0')}`
    if (l.ecriture.piece_id && joints.has(l.ecriture.piece_id) && numeros.has(numero)) justifiees.add(numero)
  }
  return { aJoindre, ecartes, ecrituresSansJustificatif: [...numeros.keys()].filter((n) => !justifiees.has(n)).length }
}
