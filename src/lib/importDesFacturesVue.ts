import { calculerLigne } from './montantsFacture'
import {
  formeDImport,
  type ChoixDeLaReprise,
  type FactureAImporter,
  type FactureRepriseLue,
  type FormatDUnFichier,
  type LectureDeReprise,
  type TransmiseePar,
} from './lectureDesFacturesReprises'
import type { IssueDuDepot } from './bornesStockage'
import type { ModeComptable, NatureOperation, TypeClient } from './types'

// L'ÉCRAN D'IMPORT DES FACTURES DE L'ANCIEN LOGICIEL (ligne 51.5, étape A8d2b), côté CABINET seul : la règle et les mots,
// sans base ni écran. La lecture (lib/importDesFacturesLecture.ts) rend l'état du dossier et les fichiers lus ; ce module
// les juge AVANT le clic — chaque fichier, ses refus nommés ; le lot, ses refus ; et ce qui part, dans l'ordre où la base
// l'attend. La base juge de nouveau tout (`importer_factures`, tout ou rien) : ce module ne redit que ce qui se dit à
// coup sûr avant l'appel (le dossier, les doublons, la date de reprise, l'avoir et sa facture), et les refus d'A8d1
// (`formeDImport`) tels quels. Il ne journalise rien : une facture porte le nom de son client.
//
// CE QUE LE FICHIER NE DIT PAS EST UN CHOIX, SANS DÉFAUT (A8d1) : le type du client, la transmission (et la plateforme),
// l'encaissé avant la reprise, et — quand le cadre BT-23 ou la date BT-8 ne les disent pas — la nature des opérations et
// l'option sur les débits. Rien n'est prérempli ; « Appliquer à toutes » est un geste du cabinet, jamais un défaut.
// L'encaissé se répartit par taux AU PRORATA par la base (`encaisse_par_taux` n'est pas envoyé) : l'aperçu le dit.
//
// SOURCES : CGI, ann. II, art. 242 nonies A, I, 7° (la séquence chronologique des numéros : la base refuse une facture
// reprise datée d'avant la plus récente de sa série, d'où l'ordre du lot par date) ; EN 16931, BR-CO-17 (la TVA d'un taux,
// base × taux, arrondie) ; le reste, les refus d'`importer_factures` (supabase/schema/20261110143020_factures_importees.sql).

/**
 * L'écran d'import est-il offert ? Levé le 11/11/2026, sur la décision du cabinet (A8D2B-Q3 : « après la modification du
 * stockage », la migration `originaux_des_imports` en production le même jour ; la base depuis le 10/11/2026 ; le CSV
 * attend A4B3-Q6). Baissé, l'onglet Factures était celui d'hier — rien lu ni montré —, un état que l'accesseur
 * d'ImportDesFactures.test.tsx joue encore.
 */
export const IMPORT_DES_FACTURES_OFFERT: boolean = true

/** Le nombre de factures qu'un lot porte au plus (`importer_factures`). */
export const FACTURES_PAR_LOT_MAX = 2000

// ── Ce que la lecture rend ───────────────────────────────────────────────────────────────────────────────────────

export interface FactureDUnLot {
  facture_id: string
  numero: string
  rang: number
  fichier_chemin: string | null
}

export interface LotLu {
  id: string
  format: string
  importe_le: string
  nombre_factures: number
  factures: readonly FactureDUnLot[]
}

export interface FactureRepriseEnBase {
  numero: string
  type: 'facture' | 'avoir'
  date_emission: string
}

/** L'état du dossier que l'import demande, lu EN ENTIER (sinon la lecture est « illisible » et rien ne s'offre). */
export interface EtatDeLImport {
  dossierId: string
  modeComptable: ModeComptable
  bascule: boolean
  /** Le jour, à Paris, de la bascule des ventes ; nul sans bascule. */
  basculeLe: string | null
  repriseLe: string | null
  /** Le SIREN de l'émetteur du dossier ; nul s'il n'en a pas (toute facture se refuse alors). */
  siren: string | null
  /** Tous les numéros des factures du dossier, validées, reprises, brouillons numérotés. */
  numeros: readonly string[]
  /** Les factures reprises d'avant (un avoir de ce lot peut en citer une). */
  reprises: readonly FactureRepriseEnBase[]
  /** Les empreintes des fichiers déjà importés : celle d'un lot, celle d'une facture. */
  empreintes: readonly string[]
  lots: readonly LotLu[]
}

export type LectureDeLImport =
  | { etat: 'lue'; lue: EtatDeLImport }
  | { etat: 'illisible'; dossierId: string; motif: string }

/** Un fichier déposé dans la fenêtre, lu. */
export interface FichierLu {
  /** Une clé propre au dépôt (deux fichiers du même nom restent deux). */
  cle: string
  nom: string
  taille: number
  /** Le fichier lui-même : son original se prépare de nouveau au dépôt. */
  fichier: File
  /** L'empreinte SHA-256 du fichier ; nulle si elle n'a pas pu se calculer (le fichier se refuse). */
  sha256: string | null
  lecture: LectureDeReprise
  /** L'original prêt au dépôt (A8d2a) ; nul quand les originaux ne se déposent pas encore. */
  original: IssueDuDepot | null
}

// ── Les choix du cabinet ─────────────────────────────────────────────────────────────────────────────────────────

export interface ChoixSaisis {
  type_client: TypeClient | null
  transmise_par: TransmiseePar | null
  plateforme_nom: string
  /** L'encaissé avant la reprise, tel que saisi, en euros (« 0 » s'il n'y a rien) ; vide : pas encore choisi. */
  encaisse: string
  nature_operation: NatureOperation | null
  option_debits: boolean | null
  natures_des_lignes: readonly ('biens' | 'services' | null)[]
}

export function choixVides(): ChoixSaisis {
  return { type_client: null, transmise_par: null, plateforme_nom: '', encaisse: '', nature_operation: null, option_debits: null, natures_des_lignes: [] }
}

export const LIBELLES_TYPE_CLIENT: Readonly<Record<TypeClient, string>> = {
  assujetti: 'Entreprise assujettie à la TVA',
  organisme_public: 'Organisme public',
  non_assujetti: 'Particulier ou non-assujetti',
  etranger: 'Client établi hors de France',
}
export const LIBELLES_TRANSMISSION: Readonly<Record<TransmiseePar, string>> = {
  papier: 'Papier',
  pdf: 'PDF par e-mail',
  plateforme: 'Plateforme agréée',
  inconnu: 'Inconnue',
}
export const LIBELLES_NATURE: Readonly<Record<NatureOperation, string>> = { biens: 'Biens', services: 'Services', mixte: 'Mixte' }
export const LIBELLES_FORMAT: Readonly<Record<FormatDUnFichier, string>> = { facturx: 'Factur-X', cii: 'CII', ubl: 'UBL' }

/** Un montant en euros saisi (« 1 234,56 », « 1234.5 », « 0 ») en centimes ; nul s'il n'en est pas un, positif ou nul. */
export function centimesSaisis(saisie: string): number | null {
  const t = saisie.replace(/[\s  ]/g, '').replace(/€$/, '').replace(',', '.')
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null
  const [entier, dec = ''] = t.split('.')
  return Number(entier) * 100 + Number(dec.padEnd(2, '0'))
}

// ── Le dossier ───────────────────────────────────────────────────────────────────────────────────────────────────

export const IMPORT_EN_ENGAGEMENT = 'Les factures d’un ancien logiciel ne se reprennent pas encore dans un dossier tenu en comptabilité d’engagement.'
export const IMPORT_SANS_BASCULE = 'Les factures d’un ancien logiciel se reprennent dans un dossier dont les factures sont la source de leurs ventes : la bascule d’abord (onglet Informations, « Source des ventes »).'
export const IMPORT_SANS_DATE_DE_REPRISE = 'La date de reprise des factures n’est pas posée : le chef du cabinet la pose d’abord, ci-dessous.'

/** Ce qui retient tout import dans ce dossier, dans l'ordre de la base ; null si rien. */
export function refusDuDossier(etat: EtatDeLImport): string | null {
  if (etat.modeComptable === 'engagement') return IMPORT_EN_ENGAGEMENT
  if (!etat.bascule || etat.basculeLe === null) return IMPORT_SANS_BASCULE
  if (etat.repriseLe === null) return IMPORT_SANS_DATE_DE_REPRISE
  if (etat.repriseLe > etat.basculeLe) return `La date de reprise, le ${jjmmaaaa(etat.repriseLe)}, suit le jour de la bascule : la reposer.`
  return null
}

// ── La date de reprise (`fixer_reprise_des_factures`, le chef du cabinet seul) ───────────────────────────────────

/** Le premier jour du mois saisi (« AAAA-MM »), ou null. */
export function premierDuMois(mois: string): string | null {
  return /^(20\d{2})-(0[1-9]|1[0-2])$/.test(mois) ? `${mois}-01` : null
}

/** Ce qui retient la date de reprise saisie, dans l'ordre de la base ; null si elle se pose. */
export function refusDeLaDateDeReprise(etat: EtatDeLImport, mois: string, chefDuCabinet: boolean): string | null {
  if (!chefDuCabinet) return 'Seul le chef du cabinet pose la date de reprise des factures d’un dossier.'
  const jour = premierDuMois(mois)
  if (jour === null) return 'La date de reprise est le premier jour d’un mois, de 2000 à 2099 : choisis le mois.'
  if (!etat.bascule || etat.basculeLe === null) return IMPORT_SANS_BASCULE
  if (jour > etat.basculeLe) {
    return `La date de reprise, le ${jjmmaaaa(jour)}, suit le jour de la bascule (le ${jjmmaaaa(etat.basculeLe)}) : elle est au plus tard le premier jour du mois de la bascule.`
  }
  if (etat.lots.length > 0) {
    return 'La date de reprise est figée depuis le premier import de factures : elle ne change qu’une fois tous les imports retirés.'
  }
  if (jour === etat.repriseLe) return 'C’est déjà la date de reprise du dossier.'
  return null
}

export function confirmationDeLaDateDeReprise(mois: string): string {
  const jour = premierDuMois(mois) ?? mois
  return `La date de reprise des factures de ce dossier sera le ${jjmmaaaa(jour)} : les factures datées d’avant ce jour se reprennent `
    + 'de l’ancien logiciel, l’application émet celles d’après. Elle se change tant qu’aucun import n’est fait ; elle se fige au '
    + 'premier import, et ne change ensuite qu’une fois tous les imports retirés. Continuer ?'
}

// ── Le jugement du lot ───────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne de TVA de l'aperçu : la base et la taxe d'un taux, en centimes, dans le sens de la facture. */
export interface TauxDeLApercu { taux: number; ht_centimes: number; tva_centimes: number }

export interface ApercuDUneFacture {
  numero: string
  type: 'facture' | 'avoir'
  format: FormatDUnFichier
  date_emission: string
  client: string
  ht_centimes: number
  tva_centimes: number
  ttc_centimes: number
  par_taux: TauxDeLApercu[]
  /** La nature lue dans le fichier, ou celle choisie ; nulle tant qu'elle n'est ni l'une ni l'autre. */
  nature: NatureOperation | null
  nombre_de_lignes: number
}

export interface FichierJuge {
  cle: string
  nom: string
  /** La facture lue, ou null si le fichier ne se lit pas. */
  lue: FactureRepriseLue | null
  apercu: ApercuDUneFacture | null
  refus: string[]
  facture: FactureAImporter | null
}

export interface LotPret {
  format: FormatDUnFichier
  /** Les factures, dans l'ordre où la base les attend, chacune avec la clé de son fichier. */
  factures: { cle: string; facture: FactureAImporter }[]
  /** Les noms des fichiers de cet import, dans l'ordre de ses factures : ce que la confirmation nomme. */
  noms: string[]
}

/** Un import du découpage d'un dépôt : son format et ses fichiers lus, dans l'ordre où les imports partiront. */
export interface ImportDuDecoupage {
  format: FormatDUnFichier
  cles: string[]
  noms: string[]
}

export interface JugementDuLot {
  fichiers: FichierJuge[]
  refusDuLot: string[]
  /**
   * Le DÉCOUPAGE du dépôt (A8D2B-Q2) : un import par format, dans l'ordre où ils partiront — les fichiers lus seulement, dit
   * avant le clic dès qu'il y en a plus d'un, que le dépôt soit prêt ou non.
   */
  decoupage: ImportDuDecoupage[]
  /** Les imports prêts, dans l'ordre du découpage ; null tant qu'un fichier ou le dépôt retient. */
  imports: LotPret[] | null
}

function apercuDe(lue: FactureRepriseLue, nature: NatureOperation | null): ApercuDUneFacture {
  const parTaux = new Map<number, { ht: number; tvaLignes: number }>()
  for (const l of lue.lignes) {
    const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    const t = parTaux.get(l.taux_tva) ?? { ht: 0, tvaLignes: 0 }
    t.ht += Math.round(c.montant_ht * 100)
    t.tvaLignes += Math.round(c.montant_tva * 100)
    parTaux.set(l.taux_tva, t)
  }
  // La TVA d'un taux, base × taux (BR-CO-17) quand la somme des taux fait la TVA déclarée ; sinon ligne à ligne — la
  // règle qu'`importer_factures` a reconnue (A8b, `montants_par_taux_facture`).
  const taux = [...parTaux.keys()].sort((a, b) => b - a)
  const parBase = taux.map((t) => Math.round(calculerLigne(1, Math.abs(parTaux.get(t)!.ht) / 100, t).montant_tva * 100) * Math.sign(parTaux.get(t)!.ht))
  const parBaseFait = parBase.reduce((s, v) => s + v, 0) === lue.tva_centimes
  return {
    numero: lue.numero,
    type: lue.type,
    format: lue.format,
    date_emission: lue.date_emission,
    client: lue.tiers_nom,
    ht_centimes: lue.ht_centimes,
    tva_centimes: lue.tva_centimes,
    ttc_centimes: lue.ttc_centimes,
    par_taux: taux.map((t, i) => ({ taux: t, ht_centimes: parTaux.get(t)!.ht, tva_centimes: parBaseFait ? parBase[i] : parTaux.get(t)!.tvaLignes })),
    nature,
    nombre_de_lignes: lue.lignes.length,
  }
}

/** Les choix saisis, sous la forme d'A8d1 ; ou ce qui manque encore, nommé. */
function choixDeLaReprise(lue: FactureRepriseLue, c: ChoixSaisis): { choix: ChoixDeLaReprise } | { refus: string[] } {
  const refus: string[] = []
  if (c.type_client === null) refus.push('Le type du client est à choisir.')
  if (c.transmise_par === null) refus.push('La transmission de la facture est à choisir (« Inconnue » si on ne la sait pas).')
  let encaisse = 0
  if (lue.type === 'facture') {
    const lu = c.encaisse.trim() === '' ? null : centimesSaisis(c.encaisse)
    if (c.encaisse.trim() === '') refus.push('L’encaissé avant la reprise est à saisir (« 0 » si rien n’était encaissé).')
    else if (lu === null) refus.push('L’encaissé avant la reprise est un montant en euros, au centime, positif ou nul.')
    else encaisse = lu
  }
  const nature = lue.nature_lue ?? c.nature_operation
  let natures: ('biens' | 'services')[] | null = null
  if (nature === 'mixte') {
    if (c.natures_des_lignes.length !== lue.lignes.length || c.natures_des_lignes.some((n) => n === null)) {
      refus.push(`Une facture mixte dit la nature de chacune de ses ${lue.lignes.length} lignes : à choisir.`)
    } else {
      natures = c.natures_des_lignes as ('biens' | 'services')[]
    }
  }
  if (refus.length > 0 || c.type_client === null || c.transmise_par === null) return { refus }
  return {
    choix: {
      type_client: c.type_client,
      transmise_par: c.transmise_par,
      plateforme_nom: c.transmise_par === 'plateforme' ? c.plateforme_nom : null,
      encaisse_avant_reprise_centimes: encaisse,
      // Ce que le fichier dit ne se redit pas : le choix reste nul, et `formeDImport` prend la valeur lue.
      nature_operation: lue.nature_lue === null ? c.nature_operation : null,
      option_debits: lue.option_debits_lue === null ? c.option_debits : null,
      natures_des_lignes: natures,
    },
  }
}

const ordreC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const ORDRE_DES_FORMATS: readonly FormatDUnFichier[] = ['facturx', 'cii', 'ubl']

/**
 * LE DÉCOUPAGE D'UN DÉPÔT EN IMPORTS (A8D2B-Q2, « Couper en plusieurs imports », tranchée par le cabinet le 11/11/2026, contre
 * la recommandation) : la base garde un seul format par import (`imports_factures.format`) et juge chaque import tout ou rien ;
 * des fichiers de formats différents déposés ensemble partent donc en un import par format, l'un après l'autre. L'ordre : un
 * import qui porte la facture qu'un avoir d'un autre format cite part AVANT celui de l'avoir (la base ne reconnaît une facture
 * citée que « plus haut dans ce lot, ou d'un import d'avant ») ; à défaut, le plus ancien d'abord (sa première date), puis
 * Factur-X, CII, UBL. Des formats dont les avoirs se citent en boucle n'ont aucun ordre : le dépôt se refuse, et le dit.
 * Rien d'autre ne lie deux imports : la séquence des numéros que la base juge oppose les factures de l'application aux
 * reprises, jamais deux imports entre eux.
 */
function decouper(
  fichiers: readonly FichierLu[],
  lues: readonly (FactureRepriseLue | null)[],
): { decoupage: ImportDuDecoupage[]; cycle: FormatDUnFichier[] | null } {
  const parFormat = new Map<FormatDUnFichier, { cles: string[]; noms: string[]; premiere: string; numeros: Set<string> }>()
  lues.forEach((l, i) => {
    if (!l) return
    const g = parFormat.get(l.format) ?? { cles: [], noms: [], premiere: l.date_emission, numeros: new Set<string>() }
    g.cles.push(fichiers[i].cle)
    g.noms.push(fichiers[i].nom)
    if (l.date_emission < g.premiere) g.premiere = l.date_emission
    if (l.type === 'facture') g.numeros.add(l.numero)
    parFormat.set(l.format, g)
  })
  // Les formats qu'un format attend : ceux qui portent une facture que l'un de ses avoirs cite.
  const attend = new Map<FormatDUnFichier, Set<FormatDUnFichier>>()
  for (const l of lues) {
    if (!l || l.type !== 'avoir' || l.origine_numero === null || parFormat.get(l.format)?.numeros.has(l.origine_numero)) continue
    for (const [format, g] of parFormat) {
      if (format !== l.format && g.numeros.has(l.origine_numero)) {
        const a = attend.get(l.format) ?? new Set<FormatDUnFichier>()
        a.add(format)
        attend.set(l.format, a)
      }
    }
  }
  const restants = ORDRE_DES_FORMATS.filter((f) => parFormat.has(f))
  const ordre: FormatDUnFichier[] = []
  while (restants.length > 0) {
    const libres = restants.filter((f) => [...(attend.get(f) ?? [])].every((x) => ordre.includes(x)))
    if (libres.length === 0) return { decoupage: [], cycle: restants }
    // Le plus ancien d'abord ; à égalité, l'ordre des formats (`restants` le suit, et le tri est stable).
    const suivant = [...libres].sort((a, b) => ordreC(parFormat.get(a)!.premiere, parFormat.get(b)!.premiere))[0]
    ordre.push(suivant)
    restants.splice(restants.indexOf(suivant), 1)
  }
  return { decoupage: ordre.map((format) => ({ format, cles: parFormat.get(format)!.cles, noms: parFormat.get(format)!.noms })), cycle: null }
}

/**
 * Juge les fichiers déposés et les choix du cabinet. Un fichier refusé, ou un refus du lot, retient TOUT le lot : la base
 * importe tout ou rien. Les refus de chaque fichier sont tous dits, dans l'ordre : sa lecture, ses doublons, sa date, son
 * avoir, puis ses choix et ceux d'A8d1.
 */
export function jugerLeLot(
  etat: EtatDeLImport,
  fichiers: readonly FichierLu[],
  choix: Readonly<Record<string, ChoixSaisis>>,
  originauxPrevus: boolean,
): JugementDuLot {
  const numerosEnBase = new Set(etat.numeros)
  const empreintesEnBase = new Set(etat.empreintes)
  const lues = fichiers.map((f) => ('lue' in f.lecture ? f.lecture.lue : null))
  // Les factures que ce lot ou un import d'avant reprennent : un avoir peut citer l'une d'elles.
  const facturesCitables = new Map<string, string>()
  for (const r of etat.reprises) if (r.type === 'facture') facturesCitables.set(r.numero, r.date_emission)
  for (const l of lues) if (l && l.type === 'facture' && !numerosEnBase.has(l.numero)) facturesCitables.set(l.numero, l.date_emission)

  const juges: FichierJuge[] = fichiers.map((f, i) => {
    const lue = lues[i]
    const refus: string[] = []
    if (!lue) {
      refus.push(...('refus' in f.lecture ? f.lecture.refus : []))
      return { cle: f.cle, nom: f.nom, lue: null, apercu: null, refus, facture: null }
    }
    if (f.sha256 === null) refus.push('Son empreinte n’a pas pu se calculer : le fichier ne se reprend pas.')
    else if (empreintesEnBase.has(f.sha256)) refus.push('Ce fichier a déjà été importé dans ce dossier (la même empreinte).')
    else if (fichiers.slice(0, i).some((g) => g.sha256 === f.sha256)) refus.push('Ce fichier est déposé deux fois dans ce lot.')
    if (numerosEnBase.has(lue.numero)) refus.push(`Le numéro ${lue.numero} est déjà celui d’une facture de ce dossier : un numéro ne se réemploie jamais.`)
    else if (lues.slice(0, i).some((l) => l?.numero === lue.numero)) refus.push(`Le numéro ${lue.numero} est aussi celui d’un autre fichier de ce lot.`)
    if (etat.repriseLe !== null && lue.date_emission >= etat.repriseLe) {
      refus.push(`Elle est datée du ${jjmmaaaa(lue.date_emission)}, la date de reprise ou après (le ${jjmmaaaa(etat.repriseLe)}) : l’application émet les factures d’après, une facture reprise se date d’avant.`)
    }
    if (lue.type === 'avoir' && lue.origine_numero !== null) {
      const dateOrigine = facturesCitables.get(lue.origine_numero)
      if (dateOrigine === undefined) {
        refus.push(`Il cite la facture « ${lue.origine_numero} », qui n’est pas une facture reprise de ce dossier (dans ce lot, ou d’un import d’avant).`)
      } else if (lue.date_emission < dateOrigine) {
        refus.push(`Il précède la facture qu’il crédite (émise le ${jjmmaaaa(dateOrigine)}).`)
      }
    }
    if (originauxPrevus && f.original !== null && 'refus' in f.original) refus.push(`Son original ne se dépose pas : ${f.original.refus.message}.`)
    const c = choixDeLaReprise(lue, choix[f.cle] ?? choixVides())
    const nature = lue.nature_lue ?? (choix[f.cle]?.nature_operation ?? null)
    let facture: FactureAImporter | null = null
    if ('refus' in c) {
      refus.push(...c.refus)
      // Les choix manquants qu'A8d1 nomme aussi (la nature, l'option) se disent une fois, à sa façon.
      const forme = formeDImport(lue, { type_client: 'assujetti', transmise_par: 'inconnu', plateforme_nom: null, encaisse_avant_reprise_centimes: 0,
        nature_operation: lue.nature_lue === null ? (choix[f.cle]?.nature_operation ?? null) : null,
        option_debits: lue.option_debits_lue === null ? (choix[f.cle]?.option_debits ?? null) : null,
        natures_des_lignes: null })
      if ('refus' in forme) refus.push(...forme.refus.filter((r) => !r.startsWith('Une facture mixte') && !r.startsWith('Seule une facture mixte')))
    } else {
      const forme = formeDImport(lue, c.choix)
      if ('refus' in forme) refus.push(...forme.refus)
      else facture = forme.facture
    }
    return { cle: f.cle, nom: f.nom, lue, apercu: apercuDe(lue, nature), refus, facture: refus.length === 0 ? facture : null }
  })

  const refusDuLot: string[] = []
  const refusDossier = refusDuDossier(etat)
  if (refusDossier) refusDuLot.push(refusDossier)
  const { decoupage, cycle } = decouper(fichiers, lues)
  if (cycle) {
    refusDuLot.push(`Des avoirs ${cycle.map((f) => LIBELLES_FORMAT[f]).join(', ')} citent chacun une facture d’un autre de ces formats : `
      + 'aucun ordre d’import ne fait passer leurs factures avant eux. Reprendre d’abord les factures citées, seules, puis leurs avoirs.')
  }
  // Le plafond de la base vaut pour chaque import ; un dépôt d'un seul format garde les mots d'hier.
  if (decoupage.length > 1) {
    for (const d of decoupage) {
      if (d.cles.length > FACTURES_PAR_LOT_MAX) {
        refusDuLot.push(`Un import porte ${FACTURES_PAR_LOT_MAX} factures au plus : celui au format ${LIBELLES_FORMAT[d.format]} en porte ${d.cles.length}. Le scinder.`)
      }
    }
  } else if (fichiers.length > FACTURES_PAR_LOT_MAX) {
    refusDuLot.push(`Un import porte ${FACTURES_PAR_LOT_MAX} factures au plus : celui-ci en porte ${fichiers.length}. Le scinder.`)
  }

  const toutesPretes = juges.length > 0 && juges.every((j) => j.refus.length === 0 && j.facture !== null)
  if (!toutesPretes || refusDuLot.length > 0) return { fichiers: juges, refusDuLot, decoupage, imports: null }
  // L'ordre de la base, dans chaque import : par date d'émission (la séquence chronologique de chaque série), la facture avant
  // l'avoir du même jour (l'avoir cite une facture « plus haut dans ce lot »), puis le numéro.
  const imports = decoupage.map((d): LotPret => {
    const factures = juges
      .filter((j) => d.cles.includes(j.cle))
      .map((j) => ({ cle: j.cle, facture: j.facture as FactureAImporter }))
      .sort((a, b) => ordreC(a.facture.date_emission, b.facture.date_emission)
        || (a.facture.type === b.facture.type ? 0 : a.facture.type === 'facture' ? -1 : 1)
        || ordreC(a.facture.numero, b.facture.numero))
    return { format: d.format, factures, noms: factures.map((f) => fichiers.find((x) => x.cle === f.cle)?.nom ?? f.cle) }
  })
  return { fichiers: juges, refusDuLot, decoupage, imports }
}

// ── Les mots des gestes ──────────────────────────────────────────────────────────────────────────────────────────

const euros = (c: number) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

export function jjmmaaaa(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

const enAbrege = (liste: readonly string[]) => (liste.length <= 6 ? liste.join(', ') : `${liste.slice(0, 3).join(', ')} … ${liste.slice(-2).join(', ')}`)

/** Ce qu'un import reprend : ses documents, son format, ses numéros et son total. */
function ceQueReprend(pret: LotPret): string {
  const n = pret.factures.length
  const avoirs = pret.factures.filter((f) => f.facture.type === 'avoir').length
  const ttc = pret.factures.reduce((s, f) => s + Math.round(f.facture.montant_ttc * 100), 0)
  const dits = enAbrege(pret.factures.map((f) => f.facture.numero))
  const quoi = n === 1 ? (avoirs === 1 ? '1 avoir' : '1 facture') : `${n} documents (${n - avoirs} facture${n - avoirs > 1 ? 's' : ''}, ${avoirs} avoir${avoirs > 1 ? 's' : ''})`
  return `${quoi} de l’ancien logiciel, au format ${LIBELLES_FORMAT[pret.format]} : ${dits} — ${euros(ttc)} TTC au total`
}

const APRES_L_IMPORT = 'Elles comptent dès lors comme les factures sources de leurs ventes, chacune par son registre après la date de reprise. '

/** La confirmation de l'import : elle NOMME ce qui part, et dit comment il se défait. */
export function confirmationDeLImport(pret: LotPret, originauxDeposes: boolean): string {
  return `Reprendre ${ceQueReprend(pret)}. `
    + APRES_L_IMPORT
    + (originauxDeposes ? 'Leurs fichiers se déposent avec elles. ' : 'Leurs fichiers ne se gardent pas encore dans l’application. ')
    + 'L’import ne se défait que par « Retirer l’import », en entier, tant que rien ne s’y rattache. Continuer ?'
}

/** Le titre d'un import du découpage : son rang et son format (« Import 2 sur 3, au format CII »). */
export function titreDUnImport(rang: number, nombre: number, format: FormatDUnFichier): string {
  return `Import ${rang} sur ${nombre}, au format ${LIBELLES_FORMAT[format]}`
}

/**
 * Ce que l'écran dit du découpage AVANT LE CLIC (A8D2B-Q2) : combien d'imports, dans quel ordre, et ce que « tout ou rien »
 * veut dire alors ; l'écran nomme sous lui chaque import et ses fichiers. Null pour un dépôt d'un seul format.
 */
export function avisDuDecoupage(decoupage: readonly ImportDuDecoupage[]): string | null {
  if (decoupage.length < 2) return null
  return `Ces fichiers mêlent ${decoupage.length} formats : un import ne porte qu’un format, ils partiront donc en `
    + `${decoupage.length} imports, l’un après l’autre, dans l’ordre ci-dessous. Chacun est tout ou rien : un import refusé ne `
    + 'reprend aucun de ses fichiers, ceux qui le suivent ne partent pas, et ceux qui l’ont précédé restent repris.'
}

/** Les fichiers d'un import du découpage, nommés. */
export function fichiersDUnImport(d: { noms: readonly string[] }): string {
  return `${d.noms.length} fichier${d.noms.length > 1 ? 's' : ''} : ${enAbrege(d.noms)}`
}

/**
 * La confirmation des imports : d'un seul, celle d'hier au caractère près ; de plusieurs, elle NOMME chacun — son rang, son
 * format, ses fichiers, ce qu'il reprend —, dit qu'ils partent l'un après l'autre et ce qu'un refus arrête.
 */
export function confirmationDesImports(imports: readonly LotPret[], originauxDeposes: boolean): string {
  if (imports.length === 1) return confirmationDeLImport(imports[0], originauxDeposes)
  const chacun = imports.map((p, i) => `${titreDUnImport(i + 1, imports.length, p.format)} (${fichiersDUnImport(p)}) : reprendre ${ceQueReprend(p)}.`)
  return `Ces fichiers partent en ${imports.length} imports, l’un après l’autre, chacun tout ou rien :\n`
    + chacun.join('\n') + '\n'
    + 'Un import refusé ne reprend aucun de ses fichiers, et ceux qui le suivent ne partent pas ; ceux qui l’ont précédé restent '
    + 'repris. ' + APRES_L_IMPORT
    + (originauxDeposes
      ? 'Les fichiers de chaque import se déposent avec lui, et se retirent s’il est refusé. '
      : 'Leurs fichiers ne se gardent pas encore dans l’application. ')
    + 'Chaque import ne se défait que par son « Retirer l’import », en entier, tant que rien ne s’y rattache. Continuer ?'
}

/** L'issue d'un import du découpage. */
export type IssueDUnImport =
  | { etat: 'repris'; message: string }
  | { etat: 'refuse'; erreur: string }
  | { etat: 'pas_parti' }

/**
 * Le BILAN des imports, après le clic : chacun dit, sous son titre, s'il est passé, refusé (et pourquoi) ou pas parti —
 * aucun ne passe en silence. `fait` porte ce qui est passé, `erreur` ce qui ne l'est pas ; d'un seul import, les mots d'hier.
 */
export function bilanDesImports(imports: readonly LotPret[], issues: readonly IssueDUnImport[]): { fait: string | null; erreur: string | null } {
  if (imports.length === 1) {
    const i = issues[0]
    if (i?.etat === 'repris') return { fait: i.message, erreur: null }
    return { fait: null, erreur: i?.etat === 'refuse' ? i.erreur : 'L’import n’est pas parti.' }
  }
  const faits: string[] = []
  const erreurs: string[] = []
  imports.forEach((p, n) => {
    const titre = titreDUnImport(n + 1, imports.length, p.format)
    const i = issues[n] ?? { etat: 'pas_parti' as const }
    if (i.etat === 'repris') faits.push(`${titre} : passé — ${i.message}`)
    else if (i.etat === 'refuse') erreurs.push(`${titre} : refusé, aucun de ses fichiers n’est repris — ${i.erreur}`)
    else erreurs.push(`${titre} : pas parti, un import qui le précède a été refusé ; ses fichiers restent à reprendre.`)
  })
  return { fait: faits.length > 0 ? faits.join(' ') : null, erreur: erreurs.length > 0 ? erreurs.join(' ') : null }
}

/** Les chemins des originaux d'un lot, sans doublon : ce que l'écran retire du stockage APRÈS un retrait réussi. */
export function originauxDuLot(lot: LotLu): string[] {
  return [...new Set(lot.factures.flatMap((f) => (f.fichier_chemin ? [f.fichier_chemin] : [])))]
}

/**
 * Ce que deviennent les originaux d'un lot retiré (`retirer_import` ne retire que les LIGNES) : drapeau baissé ou lot sans
 * original, rien ; sinon l'écran les retire après le retrait réussi — le chef du cabinet seul retire un fichier du seau
 * des ventes (A8d2a), et pour un membre de l'équipe ils restent, ce que l'écran dit, avant le clic comme après.
 */
export function sortDesOriginaux(lot: LotLu, originauxPrevus: boolean, chefDuCabinet: boolean): { retirer: string[]; phrase: string | null } {
  const chemins = originauxPrevus ? originauxDuLot(lot) : []
  if (chemins.length === 0) return { retirer: [], phrase: null }
  const n = chemins.length
  const ses = n === 1 ? 'Son original' : `Ses ${n} originaux`
  if (!chefDuCabinet) {
    return { retirer: [], phrase: `${ses} ${n === 1 ? 'reste' : 'restent'} dans le stockage : seul le chef du cabinet retire un fichier du seau des ventes ; la suppression du dossier les ramassera.` }
  }
  return { retirer: chemins, phrase: `${ses} ${n === 1 ? 'quitte' : 'quittent'} le stockage ensuite ; un retrait que le stockage refuserait est consigné au journal, et le fichier reste jusqu’à la suppression du dossier.` }
}

/** La confirmation du retrait d'un lot : elle nomme ses factures, et ce que deviennent ses originaux. */
export function confirmationDuRetrait(lot: LotLu, originauxPrevus: boolean, chefDuCabinet: boolean): string {
  const numeros = [...lot.factures].sort((a, b) => a.rang - b.rang).map((f) => f.numero)
  const dits = numeros.length <= 6 ? numeros.join(', ') : `${numeros.slice(0, 3).join(', ')} … ${numeros.slice(-2).join(', ')}`
  const originaux = sortDesOriginaux(lot, originauxPrevus, chefDuCabinet).phrase
  return `Retirer l’import du ${jjmmaaaa(lot.importe_le.slice(0, 10))} : ses ${lot.nombre_factures} document${lot.nombre_factures > 1 ? 's' : ''} (${dits}) `
    + 'quittent le dossier, en entier. La base le refuse si l’une a un encaissement, un avoir, ou si l’application a continué sa série. '
    + (originaux ? `${originaux} ` : '') + 'Continuer ?'
}

export const ORIGINAUX_PAS_ENCORE_GARDES = 'Les fichiers importés ne se gardent pas encore dans l’application (la policy du seau attend '
  + 'sa migration) : seules leurs factures entrent. Garde les originaux de ton côté.'
export const CSV_A_VENIR = 'Le CSV de l’ancien logiciel viendra ensuite (la forme de ses colonnes est à décider).'
export const ENCAISSE_AU_PRORATA = 'L’encaissé avant la reprise se répartit entre les taux au prorata de leurs TTC.'
