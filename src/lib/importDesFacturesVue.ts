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
}

export interface JugementDuLot {
  fichiers: FichierJuge[]
  refusDuLot: string[]
  pret: LotPret | null
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
  const formats = [...new Set(lues.filter((l): l is FactureRepriseLue => l !== null).map((l) => l.format))]
  if (formats.length > 1) {
    refusDuLot.push(`Un import ne mêle pas les formats (${formats.map((f) => LIBELLES_FORMAT[f]).join(', ')}) : importer chaque format à part.`)
  }
  if (fichiers.length > FACTURES_PAR_LOT_MAX) {
    refusDuLot.push(`Un import porte ${FACTURES_PAR_LOT_MAX} factures au plus : celui-ci en porte ${fichiers.length}. Le scinder.`)
  }

  const toutesPretes = juges.length > 0 && juges.every((j) => j.refus.length === 0 && j.facture !== null)
  if (!toutesPretes || refusDuLot.length > 0) return { fichiers: juges, refusDuLot, pret: null }
  // L'ordre de la base : par date d'émission (la séquence chronologique de chaque série), la facture avant l'avoir du même
  // jour (l'avoir cite une facture « plus haut dans ce lot »), puis le numéro.
  const factures = juges
    .map((j) => ({ cle: j.cle, facture: j.facture as FactureAImporter }))
    .sort((a, b) => ordreC(a.facture.date_emission, b.facture.date_emission)
      || (a.facture.type === b.facture.type ? 0 : a.facture.type === 'facture' ? -1 : 1)
      || ordreC(a.facture.numero, b.facture.numero))
  return { fichiers: juges, refusDuLot, pret: { format: formats[0], factures } }
}

// ── Les mots des gestes ──────────────────────────────────────────────────────────────────────────────────────────

const euros = (c: number) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

export function jjmmaaaa(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** La confirmation de l'import : elle NOMME ce qui part, et dit comment il se défait. */
export function confirmationDeLImport(pret: LotPret, originauxDeposes: boolean): string {
  const n = pret.factures.length
  const avoirs = pret.factures.filter((f) => f.facture.type === 'avoir').length
  const ttc = pret.factures.reduce((s, f) => s + Math.round(f.facture.montant_ttc * 100), 0)
  const numeros = pret.factures.map((f) => f.facture.numero)
  const dits = numeros.length <= 6 ? numeros.join(', ') : `${numeros.slice(0, 3).join(', ')} … ${numeros.slice(-2).join(', ')}`
  const quoi = n === 1 ? (avoirs === 1 ? '1 avoir' : '1 facture') : `${n} documents (${n - avoirs} facture${n - avoirs > 1 ? 's' : ''}, ${avoirs} avoir${avoirs > 1 ? 's' : ''})`
  return `Reprendre ${quoi} de l’ancien logiciel, au format ${LIBELLES_FORMAT[pret.format]} : ${dits} — ${euros(ttc)} TTC au total. `
    + 'Elles comptent dès lors comme les factures sources de leurs ventes, chacune par son registre après la date de reprise. '
    + (originauxDeposes ? 'Leurs fichiers se déposent avec elles. ' : 'Leurs fichiers ne se gardent pas encore dans l’application. ')
    + 'L’import ne se défait que par « Retirer l’import », en entier, tant que rien ne s’y rattache. Continuer ?'
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
