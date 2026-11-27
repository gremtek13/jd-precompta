// CE QUI EST FACTURÉ À L'ASSURANCE MALADIE : DES BORDEREAUX LUS AUX AGRÉGATS (conception 59, lot BOR2 ;
// docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md, § 4.2, § 12.3 et § 13). La décision du cabinet du
// 16/11/2026 : « on récupère que les chiffres et on stocke pas de données patients » (RGPD.md § 8.7).
//
// UN MODULE PUR, ET SANS SORTIE : il ne lit rien en base, n'appelle personne, ne journalise rien, ne lit ni l'horloge (le jour
// de référence est un PARAMÈTRE, le jour de Paris que l'appelant lit) ni le stockage du navigateur ; il n'importe que la liste
// des régimes et des types (bordereauDeTeletransmissionSansSortie.test.ts le garde, défauts plantés compris). Il reçoit ce que
// rend la lecture d'un bordereau (BOR1, `BordereauLu`), d'un ou de plusieurs fichiers d'un même envoi, et rend :
//
//   - LES AGRÉGATS DU FACTURÉ, au grain de BOR-Q4 (A) : par jour (la date de CRÉATION DU LOT, seule date du bordereau qui soit
//     de l'en-tête — la date de prescription d'une ligne n'est jamais lue, § 12.3), par organisme et par part :
//       · la part OBLIGATOIRE = la colonne « Caisse », sous le régime (reconnu par le libellé, ou choisi par celui qui importe,
//         lib/regimesAssuranceMaladie.ts) et la caisse au code imprimé (un entier de 0 à 999, comme le payé de NOE3) ;
//       · la part COMPLÉMENTAIRE = la colonne « Mutuelle », sous un organisme complémentaire « non dit » (BORQ5-Q1 (A)) : le
//         bordereau n'en imprime aucun. Quand un état qui nomme la mutuelle sera lu, l'union s'ouvrira à un organisme dit, sous
//         son numéro (BOR-Q5 (B)) ; rien ici ne le devine ;
//     des montants en centimes ENTIERS, aucun texte (ni libellé, ni ville, ni numéro de lot) : des dates, des entiers et des
//     unions littérales ;
//   - L'IDENTIFICATION DES LOTS POUR LE REGISTRE (BOR1-Q1 (C), puis BOR1Q1-Q1 (A)) : le numéro du lot, sa date de création,
//     le code de sa caisse et le nombre de ses factures, À PART, pour le seul appel d'import, qui les donnera à la base ; c'est
//     la BASE qui calcule l'empreinte du numéro, de la date et de la caisse sous une clé secrète du dossier, puis oublie le
//     numéro (BOR3, la migration préparée le 19/11/2026) ; la caisse et le nombre de factures
//     lui servent aussi à confronter les totaux à leurs lots. Ce module n'en calcule aucune : une empreinte faite ici le serait
//     sous une clé que le navigateur connaîtrait, et un numéro de lot n'a que quelques milliers de valeurs (§ 13.3). Le numéro
//     n'entre dans aucun agrégat, aucun résumé, aucune raison de refus ; il n'est rendu que par une FONCTION
//     (`pourLAppelDImport`), que `JSON.stringify` saute : un résultat sérialisé par mégarde (un journal, un message) ne le
//     porte pas — le canari de factureAssuranceMaladie.test.ts le prouve ;
//   - LE RÉSUMÉ que l'écran montre avant le clic : le nombre de lots et de factures, la première et la dernière date, les deux
//     parts et le dû (caisse + mutuelle : le lot se compte comme en tiers payant, BOR1-Q2 (B)).
//
// « ASSURÉ » N'EST PAS GARDÉ : ce que le patient doit, que l'assurance maladie ne paiera pas. Il ne sert qu'à vérifier que le
// total du lot se referme (total = caisse + mutuelle + assuré), puis il est oublié : ni agrégat, ni résumé.
//
// TOUT DOUTE SE REFUSE, TOUT ENTIER, AUX MOTS QUE L'ÉCRAN DIT AVANT LE CLIC : un envoi vide ; un numéro de lot, un code de
// caisse ou un nombre de factures qui n'ont pas leur forme ; une date de création qui n'est pas une date civile, ou qui suit le
// jour de référence ; un montant qui n'est pas un entier de centimes dans ses bornes ; un total qui ne se referme pas ; le même
// numéro de lot deux fois dans l'envoi (dans un même fichier, BOR1 le refuse déjà ; ici, d'un fichier à l'autre, et même sous
// deux dates : le registre de BOR3 les distinguerait, mais deux lots d'un même numéro dans un même envoi sont un doute, et deux
// envois le lèvent) ; un choix de régime hors de la liste fermée, en double, pour un organisme absent de l'envoi, ou pour un
// organisme dont le libellé dit déjà le régime. Une raison cite le RANG du bordereau dans l'envoi, jamais son numéro de lot.
//
// AUCUNE BORNE BASSE SUR LA DATE au-delà de celle de BOR1 (1990) : la répétition générale rejoue l'année 2025 (MVP-D7), et un
// lot ancien importé tard est un cas ordinaire.
//
// CE QUI RELÈVE DE BOR3 (la migration), ET QUE CE MODULE NE FIXE PAS : la forme des tables, le nom des colonnes et des
// paramètres de la fonction d'import, la clé et l'algorithme de l'empreinte. Le type des agrégats est celui du module ; la
// fonction d'import le reçoit par la traduction écrite avec elle (lib/importDuFactureAssuranceMaladie.ts,
// `corpsDeLImportDuFacture`).
//
// LE NOMBRE DE FACTURES D'UN AGRÉGAT est celui des LOTS qui y contribuent (BOR1 ne rend que le compte d'un lot, jamais celui
// des lignes dont une part est non nulle) : un ordre de grandeur, dit tel (§ 4.2) ; une part nulle d'un lot n'y contribue pas.

import type { BordereauLu } from './bordereauDeTeletransmission'
import { regimeChoisi, regimeDuLibelle } from './regimesAssuranceMaladie'

/** La part facturée : la colonne « Caisse » (obligatoire) ou la colonne « Mutuelle » (complémentaire). */
export type PartFacturee = 'obligatoire' | 'complementaire'

interface CommunDUnAgregat {
  /** La date de création des lots, AAAA-MM-JJ. */
  date: string
  /** Le facturé de la part, en centimes (négatif si les lots le portent négatif). */
  montantCentimes: number
  /** Les lots qui y contribuent (une part nulle n'y contribue pas). */
  nombreDeLots: number
  /** Les factures de ces lots : un ordre de grandeur, pas le compte des lignes dont la part est non nulle. */
  nombreDeFactures: number
}

/** Un agrégat du facturé : des dates, des entiers et des unions littérales, aucun texte. */
export type AgregatDuFacture =
  | (CommunDUnAgregat & { part: 'obligatoire'; regime: number; caisse: number })
  | (CommunDUnAgregat & { part: 'complementaire'; organismeComplementaire: 'non_dit' })

/** Un organisme dont le libellé ne dit pas le régime : celui qui importe le choisit (`regimeChoisi`). */
export interface OrganismeAChoisir {
  /** Le code de caisse imprimé, trois chiffres. */
  code: string
  /** Le libellé de l'en-tête (« MSA - VILLE »), tel que BOR1 l'a lu et borné. */
  libelle: string
}

/** Le choix de celui qui importe, pour un organisme « à choisir » : le code d'une ligne de `GRANDS_REGIMES`. */
export interface ChoixDuRegime extends OrganismeAChoisir {
  regime: number
}

export interface ResumeDuFacture {
  nombreDeLots: number
  nombreDeFactures: number
  premiereDate: string
  derniereDate: string
  obligatoireCentimes: number
  complementaireCentimes: number
  /** Ce que l'assurance maladie doit au praticien : caisse + mutuelle. */
  duCentimes: number
}

/** Un lot pour le registre de BOR3 : son numéro, sa date de création, le code de sa caisse (un entier, comme l'agrégat) et
 *  le nombre de ses factures. Rendu au seul appel d'import. */
export interface LotPourLeRegistre {
  numero: number
  creeLe: string
  caisse: number
  nombreDeFactures: number
}

/**
 * L'identification des lots, à part : le nombre se montre, les numéros ne sortent que par `pourLAppelDImport`, une fonction,
 * que `JSON.stringify` ne sérialise pas.
 */
export interface IdentificationDesLots {
  readonly nombre: number
  pourLAppelDImport(): readonly LotPourLeRegistre[]
}

export type FactureDesBordereaux =
  | { etat: 'pret'; agregats: readonly AgregatDuFacture[]; resume: ResumeDuFacture; identificationDesLots: IdentificationDesLots }
  | { etat: 'regimes_a_choisir'; organismes: readonly OrganismeAChoisir[]; resume: ResumeDuFacture }
  | { etat: 'refuse'; raison: string }

export interface ParametresDuFacture {
  /** Le jour de référence, AAAA-MM-JJ (le jour de Paris, lu par l'appelant) : un lot créé après lui se refuse. */
  aujourdHui: string
  /** Les régimes choisis pour les organismes « à choisir » ; vide tant que l'écran n'en a demandé aucun. */
  regimesChoisis: readonly ChoixDuRegime[]
}

/** Un montant, au plus, en centimes (dix millions d'euros) : la borne de BOR1. */
const MONTANT_MAX_CENTIMES = 1_000_000_000
/** Un numéro de lot, au plus : neuf chiffres, la borne de BOR1. */
const NUMERO_DE_LOT_MAX = 999_999_999

/** Vrai pour une date civile AAAA-MM-JJ, de 1990 à 2200 (les bornes de BOR1). Sans l'horloge : le calendrier, à la main. */
export function estUneDateCivile(texte: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte)
  if (m === null) return false
  const a = Number(m[1])
  const mois = Number(m[2])
  const j = Number(m[3])
  if (a < 1990 || a > 2200 || mois < 1 || mois > 12 || j < 1) return false
  const bissextile = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
  return j <= [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1]
}

const estUnMontant = (n: number) => Number.isSafeInteger(n) && Math.abs(n) <= MONTANT_MAX_CENTIMES

// La barre verticale ne peut paraître ni dans un code (trois chiffres) ni dans un libellé (borné par BOR1).
const cleDeLOrganisme = (code: string, libelle: string) => `${code}|${libelle}`

function refus(raison: string): FactureDesBordereaux {
  return { etat: 'refuse', raison }
}

/** La raison d'un bordereau qui n'a pas sa forme, ou nulle. Elle cite le rang, jamais le numéro du lot. */
function doute(b: BordereauLu, rang: number, aujourdHui: string): string | null {
  const ici = `bordereau ${rang} de l’envoi`
  if (!Number.isSafeInteger(b.lot) || b.lot < 1 || b.lot > NUMERO_DE_LOT_MAX) return `${ici} : le numéro du lot ne se lit pas`
  if (!estUneDateCivile(b.creeLe)) return `${ici} : la date de création du lot n’est pas une date possible`
  if (b.creeLe > aujourdHui) return `${ici} : le lot serait créé après aujourd’hui`
  if (!/^\d{3}$/.test(b.organisme.code)) return `${ici} : le code de la caisse ne se lit pas (trois chiffres)`
  if (!Number.isSafeInteger(b.nombreDeFactures) || b.nombreDeFactures < 1) return `${ici} : le nombre de factures du lot ne se lit pas`
  const t = b.totaux
  if (![t.totalCentimes, t.caisseCentimes, t.mutuelleCentimes, t.assureCentimes].every(estUnMontant)) {
    return `${ici} : un total du lot n’est pas un montant lisible`
  }
  if (t.totalCentimes !== t.caisseCentimes + t.mutuelleCentimes + t.assureCentimes) {
    return `${ici} : le total du lot ne se referme pas (il n’est pas la somme de la caisse, de la mutuelle et de l’assuré)`
  }
  return null
}

/**
 * Le facturé d'un envoi de bordereaux lus : les agrégats, le résumé et l'identification des lots ; ou les organismes dont le
 * régime reste à choisir ; ou le refus, tout entier, avec sa raison. Tout ou rien.
 */
export function factureDesBordereaux(bordereaux: readonly BordereauLu[], parametres: ParametresDuFacture): FactureDesBordereaux {
  const { aujourdHui, regimesChoisis } = parametres
  if (!estUneDateCivile(aujourdHui)) return refus('le jour de référence n’est pas une date possible')
  if (bordereaux.length === 0) return refus('aucun bordereau dans l’envoi')

  // 1. Chaque bordereau, sa forme ; puis le même numéro de lot deux fois.
  // Le même lot : un même numéro, une même date de création et une même caisse — la clé du registre de la base (BOR3,
  // `doublonLot`), jamais le numéro seul (relecture du 27/11/2026 : un envoi que la base aurait accepté se refusait ici).
  const lotsVus = new Map<string, number>()
  for (const [i, b] of bordereaux.entries()) {
    const raison = doute(b, i + 1, aujourdHui)
    if (raison !== null) return refus(raison)
    const cle = `${b.lot}|${b.creeLe}|${Number(b.organisme.code)}`
    const premier = lotsVus.get(cle)
    if (premier !== undefined) return refus(`bordereaux ${premier} et ${i + 1} de l’envoi : le même lot deux fois`)
    lotsVus.set(cle, i + 1)
  }

  // 2. Les régimes : lus sur le libellé, sinon choisis ; un choix qui ne répond à rien de l'envoi se refuse.
  const aChoisir = new Map<string, OrganismeAChoisir>()
  const reconnus = new Map<string, number>()
  for (const b of bordereaux) {
    const cle = cleDeLOrganisme(b.organisme.code, b.organisme.libelle)
    const lu = regimeDuLibelle(b.organisme.libelle)
    if (lu.etat === 'reconnu') reconnus.set(cle, lu.regime.code)
    else if (!aChoisir.has(cle)) aChoisir.set(cle, { code: b.organisme.code, libelle: b.organisme.libelle })
  }
  const choisis = new Map<string, number>()
  for (const c of regimesChoisis) {
    const cle = cleDeLOrganisme(c.code, c.libelle)
    const nom = `l’organisme ${c.code} - ${c.libelle}`
    if (regimeChoisi(c.regime) === null) return refus(`${nom} : le régime choisi n’est pas dans la liste des régimes`)
    if (choisis.has(cle)) return refus(`${nom} : deux choix de régime`)
    if (reconnus.has(cle)) return refus(`${nom} : son libellé dit déjà son régime, aucun choix n’est attendu`)
    if (!aChoisir.has(cle)) return refus(`${nom} : absent de l’envoi`)
    choisis.set(cle, c.regime)
  }

  // 3. Le résumé, qui se montre aussi pendant le choix des régimes.
  let obligatoire = 0
  let complementaire = 0
  let factures = 0
  let premiereDate = bordereaux[0].creeLe
  let derniereDate = bordereaux[0].creeLe
  for (const b of bordereaux) {
    obligatoire += b.totaux.caisseCentimes
    complementaire += b.totaux.mutuelleCentimes
    factures += b.nombreDeFactures
    if (b.creeLe < premiereDate) premiereDate = b.creeLe
    if (b.creeLe > derniereDate) derniereDate = b.creeLe
  }
  const resume: ResumeDuFacture = {
    nombreDeLots: bordereaux.length,
    nombreDeFactures: factures,
    premiereDate,
    derniereDate,
    obligatoireCentimes: obligatoire,
    complementaireCentimes: complementaire,
    duCentimes: obligatoire + complementaire,
  }

  const manquants = [...aChoisir.entries()].filter(([cle]) => !choisis.has(cle)).map(([, o]) => o)
  if (manquants.length > 0) {
    manquants.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.libelle < b.libelle ? -1 : a.libelle > b.libelle ? 1 : 0))
    return { etat: 'regimes_a_choisir', organismes: manquants, resume }
  }

  // 4. Les agrégats : par jour, organisme et part ; une part nulle d'un lot n'y contribue pas.
  const parCle = new Map<string, AgregatDuFacture>()
  const ajouter = (cle: string, neuf: AgregatDuFacture, b: BordereauLu, montant: number) => {
    const deja = parCle.get(cle)
    if (deja === undefined) {
      parCle.set(cle, neuf)
      return
    }
    deja.montantCentimes += montant
    deja.nombreDeLots += 1
    deja.nombreDeFactures += b.nombreDeFactures
  }
  for (const b of bordereaux) {
    const cleOrganisme = cleDeLOrganisme(b.organisme.code, b.organisme.libelle)
    const regime = reconnus.get(cleOrganisme) ?? choisis.get(cleOrganisme)
    if (regime === undefined) return refus('lecture interrompue')
    const caisse = Number(b.organisme.code)
    const commun = { date: b.creeLe, nombreDeLots: 1, nombreDeFactures: b.nombreDeFactures }
    if (b.totaux.caisseCentimes !== 0) {
      ajouter(`${b.creeLe}|obligatoire|${regime}|${caisse}`,
        { ...commun, part: 'obligatoire', regime, caisse, montantCentimes: b.totaux.caisseCentimes }, b, b.totaux.caisseCentimes)
    }
    if (b.totaux.mutuelleCentimes !== 0) {
      ajouter(`${b.creeLe}|complementaire`,
        { ...commun, part: 'complementaire', organismeComplementaire: 'non_dit', montantCentimes: b.totaux.mutuelleCentimes }, b, b.totaux.mutuelleCentimes)
    }
  }
  const rangDeLaPart = (a: AgregatDuFacture) => (a.part === 'obligatoire' ? 0 : 1)
  const agregats = [...parCle.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.part !== b.part) return rangDeLaPart(a) - rangDeLaPart(b)
    if (a.part === 'obligatoire' && b.part === 'obligatoire') return a.regime - b.regime || a.caisse - b.caisse
    return 0
  })

  // 5. L'identification des lots, à part : une copie figée, rendue par une fonction seulement.
  const lots: readonly LotPourLeRegistre[] = Object.freeze(bordereaux.map((b) => Object.freeze({
    numero: b.lot, creeLe: b.creeLe, caisse: Number(b.organisme.code), nombreDeFactures: b.nombreDeFactures,
  })))
  const identificationDesLots: IdentificationDesLots = { nombre: lots.length, pourLAppelDImport: () => lots }

  return { etat: 'pret', agregats, resume, identificationDesLots }
}
