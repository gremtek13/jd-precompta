// CE QUE L'ASSURANCE MALADIE DOIT : LE FACTURÉ CONFRONTÉ AU PAYÉ (conception 59, lot BOR5 ; docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md,
// § 6, § 13.4 (BOR-Q6 (A) : le niveau 1, ESTIMÉ, tant qu'aucun suivi tiers payant n'est lu) et § 14).
//
// UN MODULE PUR, ET SANS SORTIE : il ne lit rien en base, n'appelle personne, ne journalise rien, ne lit pas l'horloge (le jour de
// Paris est un PARAMÈTRE) et n'importe que des types (duContrePayeSansSortie.test.ts le garde, défauts plantés compris). Il reçoit
// les deux côtés TELS QUE L'ÉCRAN LES A LUS — le facturé (les imports des bordereaux et leurs totaux, BOR3) et le payé (les
// imports NOEMIE et leurs paiements, NOE3) —, une fenêtre et le jour, et rend, par organisme et par part, le facturé, le payé et
// un reste ESTIMÉ, en centimes entiers ; jamais un conseil, jamais le mot « impayé » (§ 6.2 : « à vérifier dans ton logiciel de
// télétransmission »).
//
// CE QUI SE COMPARE, ET SOUS QUELLE RÉSERVE.
//   - LA PART OBLIGATOIRE, par organisme (le régime et la caisse, deux entiers des deux côtés). LA RÉSERVE, écrite à l'écran : que
//     le code de caisse à trois chiffres imprimé sur le bordereau soit celui que porte le paiement NOEMIE de la même caisse n'est
//     PAS VÉRIFIÉ (§ 13.2) — aucune page du payé de Télévitale n'a été vue. Un organisme présent d'un seul côté se dit tel
//     (« aucun paiement importé sous cet organisme », « aucun lot importé sous cet organisme »), jamais comme une dette.
//   - EN COMPTE COURANT, jamais par lot ni par jour (§ 6.1) : le facturé est daté de la CRÉATION DU LOT, le payé de la JOURNÉE
//     COMPTABLE, et un lot de décembre est payé en janvier. Le payé s'impute aux lots les plus anciens d'abord, et jamais à un lot
//     créé après la journée qui le paie ; ce qu'aucun lot ouvert n'attend reste « payé sans lot en face ». L'imputation est une
//     ESTIMATION (un rejet laisse un lot ancien ouvert et la règle le couvre avec un paiement plus récent : le total du reste est
//     juste, sa date ne l'est pas) ; le reste et ses tranches portent ce mot.
//   - LE COMPTE COURANT PART D'UNE ORIGINE COMMUNE, le plus tardif des deux débuts (le premier lot importé, la première journée
//     importée), pour qu'un paiement d'un lot plus ancien ne s'impute pas à un lot de la fenêtre ; la FENÊTRE ne choisit que ce
//     qui est montré. La SITUATION est la dernière journée comptable importée, jamais le jour : les anciennetés s'y mesurent.
//   - LE BRUT d'un paiement (net moins régularisations) paie des factures ; les RÉGULARISATIONS (indus, trop-perçus) et les
//     FORFAITS (aides, sommes sans facture) n'ont pas de facturé en face : ils se comptent à part, des faits, hors du reste.
//   - LE NOMBRE DE FACTURES est un ORDRE DE GRANDEUR des deux côtés (BOR2-Q1 (A) ; NOE3) : il se montre, il ne se soustrait pas.
//
// CE QUI NE SE COMPARE PAS (« non comparable », la raison dite) :
//   - LA PART COMPLÉMENTAIRE : le bordereau ne nomme aucun organisme complémentaire (« non dit », BORQ5-Q1 (A)), et rien n'établit
//     que toutes les complémentaires passent par NOEMIE ; ses deux totaux se montrent, aucun reste ;
//   - UN ORGANISME DONT LE FACTURÉ PORTE UN LOT D'AVOIRS (un total négatif) : la règle d'imputation ne sait pas à quel lot il se
//     rapporte ;
//   - UN PAIEMENT DE LA PART OBLIGATOIRE SANS RÉGIME OU SANS CAISSE (la table l'admet) : il ne se range sous aucun organisme.
//
// MUET, SOUS UN ÉTAT NOMMÉ, JAMAIS 0 : une lecture partielle de l'un des quatre ; un côté sans aucun import ; une donnée illisible
// (une date qui n'est pas civile, un montant qui n'est pas un entier) ; une fenêtre à l'envers ou à venir ; une fenêtre que l'un
// des deux côtés ne couvre pas — l'étendue d'un côté va de son premier à son dernier jour importé (les lots, les journées
// comptables). DANS L'ÉTENDUE, UN LOT NON IMPORTÉ NE SE VOIT PAS (un import peut porter un lot seul, § 13.3) : le module dit les
// MOIS de la fenêtre où aucun lot, ou aucun paiement, n'a été importé — un fait sur les imports, pas sur l'activité.
//
// LES TRANCHES D'ANCIENNETÉ sont en JOURS CIVILS, de la date de création du lot à la situation : « sept jours au plus », « de 8 à
// 30 », « de 31 à 90 », « plus de 90 ». Le délai de D. 161-13-3 (sept jours OUVRÉS, depuis un point de départ que le bordereau ne
// dit pas : la date de création du lot n'est pas celle de la télétransmission) ne se calcule pas ici : DU-Q2.

import type {
  FactureAssuranceMaladie, ImportAssuranceMaladie, ImportFacturesAssuranceMaladie, PaiementAssuranceMaladie,
} from './types'

/** Une lecture telle que l'écran l'a faite : `complete` faux, rien ne se calcule. `LectureComplete` s'y range. */
export interface LectureDuDu<T> { readonly lignes: readonly T[]; readonly complete: boolean }

export type CoteDuDu = 'facture' | 'paye'

export interface EntreesDuDu {
  facture: {
    imports: LectureDuDu<Pick<ImportFacturesAssuranceMaladie, 'premier_lot_le' | 'dernier_lot_le'>>
    totaux: LectureDuDu<Pick<FactureAssuranceMaladie, 'date_creation_lot' | 'part' | 'regime' | 'caisse' | 'montant_centimes' | 'nombre_de_factures'>>
  }
  paye: {
    imports: LectureDuDu<Pick<ImportAssuranceMaladie, 'periode_du' | 'periode_au'>>
    paiements: LectureDuDu<Pick<PaiementAssuranceMaladie, 'date_journee_comptable' | 'regime' | 'caisse' | 'part' | 'montant_centimes' | 'regularisations_centimes' | 'nombre_de_factures'>>
  }
  /** Les lots CRÉÉS du `du` au `au` compris (AAAA-MM-JJ), et les journées comptables des mêmes jours. */
  fenetre: { du: string; au: string }
  /** Le jour de Paris, que l'appelant lit. */
  aujourdHui: string
}

export type TrancheDuReste = 'sept_jours_au_plus' | 'de_8_a_30_jours' | 'de_31_a_90_jours' | 'plus_de_90_jours'
export const TRANCHES_DU_RESTE: readonly TrancheDuReste[] = ['sept_jours_au_plus', 'de_8_a_30_jours', 'de_31_a_90_jours', 'plus_de_90_jours']

export interface LigneComparee {
  part: 'obligatoire'
  regime: number
  caisse: number
  /** Les deux côtés portent cet organisme dans le compte courant, ou un seul — un fait sur les imports, jamais une dette. */
  enFace: 'les_deux' | 'facture_seul' | 'paye_seul'
  /** Les lots créés dans la fenêtre (un fait). */
  factureCentimes: number
  /** Le brut des paiements des journées comptables de la fenêtre (un fait). */
  payeDesJourneesCentimes: number
  /** Ce que la règle d'imputation range sur les lots de la fenêtre, d'où qu'il vienne jusqu'à la situation (une estimation). */
  payeImputeCentimes: number
  /** `factureCentimes - payeImputeCentimes`, positif ou nul (une estimation). */
  resteEstimeCentimes: number
  tranches: Record<TrancheDuReste, number>
  /** Le plus ancien lot de la fenêtre dont la règle laisse une part ouverte, ou nul. */
  plusAncienLotOuvert: string | null
  /** Le brut des journées de la fenêtre qu'aucun lot ouvert n'attendait (un paiement d'un lot non importé, ou d'avant l'origine). */
  payeSansLotEnFaceCentimes: number
  /** Des ordres de grandeur, jamais soustraits. */
  facturesFacturees: number
  facturesPayees: number
}

export interface LigneNonComparable {
  part: 'obligatoire' | 'complementaire'
  /** Nuls pour la part complémentaire, et pour un paiement qui ne les dit pas. */
  regime: number | null
  caisse: number | null
  raison: 'complementaire_non_dite' | 'avoir_dans_le_facture' | 'organisme_du_paiement_non_dit'
  /** Les lots créés dans la fenêtre (un fait), nul quand ce côté n'a rien à dire sous cette raison. */
  factureCentimes: number | null
  /** Le brut des journées de la fenêtre (un fait). */
  payeDesJourneesCentimes: number
}

export type DuContrePaye =
  | { etat: 'lecture_partielle'; cotes: CoteDuDu[] }
  | { etat: 'donnee_illisible'; cote: CoteDuDu | 'parametres' }
  | { etat: 'fenetre_invalide'; raison: 'a_l_envers' | 'a_venir' }
  | { etat: 'rien_importe'; cotes: CoteDuDu[] }
  | {
    etat: 'non_couvert'
    /** Les côtés dont l'étendue ne contient pas la fenêtre. */
    cotes: CoteDuDu[]
    etendues: Record<CoteDuDu, { du: string; au: string }>
  }
  | {
    etat: 'compte'
    fenetre: { du: string; au: string }
    /** Le début du compte courant : le plus tardif des deux premiers jours importés. */
    origine: string
    /** La dernière journée comptable importée (au plus le jour) : les anciennetés s'y mesurent. */
    situationAu: string
    joursDepuisLaSituation: number
    lignes: LigneComparee[]
    total: { factureCentimes: number; payeDesJourneesCentimes: number; resteEstimeCentimes: number; payeSansLotEnFaceCentimes: number }
    nonComparables: LigneNonComparable[]
    /** Des journées de la fenêtre, sans facturé en face : les forfaits (positifs) et les régularisations (négatives ou nulles). */
    horsFacture: { forfaitsCentimes: number; regularisationsCentimes: number }
    /** Les mois (AAAA-MM) de la fenêtre sans aucun lot importé, ou sans aucune journée comptable importée. */
    moisSansLot: string[]
    moisSansPaiement: string[]
  }

// ── Le calendrier civil, en entiers (l'algorithme « days from civil » de H. Hinnant) : aucune horloge, aucun fuseau. ──

const bissextile = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
const JOURS_DES_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Le rang d'une date civile AAAA-MM-JJ (jours depuis le 1er janvier 1970), ou nul si ce n'en est pas une. */
export function rangDuJour(date: unknown): number | null {
  if (typeof date !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (m === null) return null
  const annee = Number(m[1]); const mois = Number(m[2]); const jour = Number(m[3])
  if (mois < 1 || mois > 12 || jour < 1) return null
  if (jour > (mois === 2 && bissextile(annee) ? 29 : JOURS_DES_MOIS[mois - 1])) return null
  const a = mois <= 2 ? annee - 1 : annee
  const ere = Math.floor(a / 400)
  const anDeLEre = a - ere * 400
  const jourDeLAn = Math.floor((153 * ((mois + 9) % 12) + 2) / 5) + jour - 1
  const jourDeLEre = anDeLEre * 365 + Math.floor(anDeLEre / 4) - Math.floor(anDeLEre / 100) + jourDeLAn
  return ere * 146097 + jourDeLEre - 719468
}

const entier = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n)

function trancheDe(age: number): TrancheDuReste {
  if (age <= 7) return 'sept_jours_au_plus'
  if (age <= 30) return 'de_8_a_30_jours'
  if (age <= 90) return 'de_31_a_90_jours'
  return 'plus_de_90_jours'
}

/** Les mois (AAAA-MM) qui touchent la fenêtre, dans l'ordre. */
function moisDeLaFenetre(du: string, au: string): string[] {
  const mois: string[] = []
  let annee = Number(du.slice(0, 4)); let m = Number(du.slice(5, 7))
  const fin = au.slice(0, 7)
  for (;;) {
    const cle = `${annee}-${String(m).padStart(2, '0')}`
    mois.push(cle)
    if (cle >= fin) return mois
    m += 1
    if (m > 12) { m = 1; annee += 1 }
  }
}

const cleDOrganisme = (regime: number, caisse: number) => `${regime}|${caisse}`

interface CompteDUnOrganisme {
  regime: number
  caisse: number
  /** Facturé par date de création, sommé sur les imports. */
  lots: Map<string, number>
  facturesFacturees: number
  /** Le brut par journée comptable. */
  paiements: Map<string, number>
  facturesPayees: number
}

/** Le facturé confronté au payé, par organisme et par part, sur une fenêtre (voir l'en-tête). */
export function duContrePaye(entrees: EntreesDuDu): DuContrePaye {
  const { facture, paye, fenetre, aujourdHui } = entrees

  const partielles = ([['facture', facture.imports.complete && facture.totaux.complete], ['paye', paye.imports.complete && paye.paiements.complete]] as const)
    .filter(([, complete]) => !complete).map(([cote]) => cote)
  if (partielles.length > 0) return { etat: 'lecture_partielle', cotes: partielles }

  const jour = rangDuJour(aujourdHui); const du = rangDuJour(fenetre.du); const au = rangDuJour(fenetre.au)
  if (jour === null || du === null || au === null) return { etat: 'donnee_illisible', cote: 'parametres' }
  if (du > au) return { etat: 'fenetre_invalide', raison: 'a_l_envers' }
  if (au > jour) return { etat: 'fenetre_invalide', raison: 'a_venir' }

  const vides = ([['facture', facture.imports.lignes.length], ['paye', paye.imports.lignes.length]] as const)
    .filter(([, n]) => n === 0).map(([cote]) => cote)
  if (vides.length > 0) return { etat: 'rien_importe', cotes: vides }

  // Les étendues, et la forme de chaque ligne : une donnée illisible tait tout, jamais une ligne écartée en silence.
  const factureLisible = facture.imports.lignes.every((i) => rangDuJour(i.premier_lot_le) !== null && rangDuJour(i.dernier_lot_le) !== null)
    && facture.totaux.lignes.every((t) => rangDuJour(t.date_creation_lot) !== null && entier(t.montant_centimes) && entier(t.nombre_de_factures)
      && (t.part === 'complementaire' || (t.part === 'obligatoire' && entier(t.regime) && entier(t.caisse))))
  if (!factureLisible) return { etat: 'donnee_illisible', cote: 'facture' }
  const payeLisible = paye.imports.lignes.every((i) => rangDuJour(i.periode_du) !== null && rangDuJour(i.periode_au) !== null)
    && paye.paiements.lignes.every((p) => rangDuJour(p.date_journee_comptable) !== null && entier(p.montant_centimes)
      && entier(p.regularisations_centimes) && p.regularisations_centimes <= 0 && entier(p.nombre_de_factures)
      && (p.part === 'obligatoire' || p.part === 'complementaire' || p.part === 'forfait'))
  if (!payeLisible) return { etat: 'donnee_illisible', cote: 'paye' }

  const plusPetite = (dates: string[]) => dates.reduce((a, b) => (b < a ? b : a))
  const plusGrande = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a))
  const etendues: Record<CoteDuDu, { du: string; au: string }> = {
    facture: { du: plusPetite(facture.imports.lignes.map((i) => i.premier_lot_le)), au: plusGrande(facture.imports.lignes.map((i) => i.dernier_lot_le)) },
    paye: { du: plusPetite(paye.imports.lignes.map((i) => i.periode_du)), au: plusGrande(paye.imports.lignes.map((i) => i.periode_au)) },
  }
  const horsEtendue = (['facture', 'paye'] as const).filter((c) => fenetre.du < etendues[c].du || fenetre.au > etendues[c].au)
  if (horsEtendue.length > 0) return { etat: 'non_couvert', cotes: horsEtendue, etendues }

  const origine = etendues.facture.du > etendues.paye.du ? etendues.facture.du : etendues.paye.du
  const situationAu = etendues.paye.au < aujourdHui ? etendues.paye.au : aujourdHui
  const rangSituation = rangDuJour(situationAu) as number
  const dansLaFenetre = (d: string) => d >= fenetre.du && d <= fenetre.au
  const dansLeCompte = (d: string) => d >= origine && d <= situationAu

  // Les organismes de la part obligatoire, et ce qui ne se compare pas.
  const organismes = new Map<string, CompteDUnOrganisme>()
  const organisme = (regime: number, caisse: number): CompteDUnOrganisme => {
    const cle = cleDOrganisme(regime, caisse)
    let o = organismes.get(cle)
    if (o === undefined) {
      o = { regime, caisse, lots: new Map(), facturesFacturees: 0, paiements: new Map(), facturesPayees: 0 }
      organismes.set(cle, o)
    }
    return o
  }
  const complementaire = { factureCentimes: 0, payeDesJourneesCentimes: 0 }
  const sansOrganisme = new Map<string, LigneNonComparable>()
  const horsFacture = { forfaitsCentimes: 0, regularisationsCentimes: 0 }

  for (const t of facture.totaux.lignes) {
    if (t.part === 'complementaire') {
      if (dansLaFenetre(t.date_creation_lot)) complementaire.factureCentimes += t.montant_centimes
      continue
    }
    if (t.date_creation_lot < origine) continue
    const o = organisme(t.regime as number, t.caisse as number)
    o.lots.set(t.date_creation_lot, (o.lots.get(t.date_creation_lot) ?? 0) + t.montant_centimes)
    if (dansLaFenetre(t.date_creation_lot)) o.facturesFacturees += t.nombre_de_factures
  }
  for (const p of paye.paiements.lignes) {
    const d = p.date_journee_comptable
    const brut = p.montant_centimes - p.regularisations_centimes
    if (dansLaFenetre(d)) horsFacture.regularisationsCentimes += p.regularisations_centimes
    if (p.part === 'forfait') {
      if (dansLaFenetre(d)) horsFacture.forfaitsCentimes += brut
      continue
    }
    if (p.part === 'complementaire') {
      if (dansLaFenetre(d)) complementaire.payeDesJourneesCentimes += brut
      continue
    }
    if (!entier(p.regime) || !entier(p.caisse)) {
      if (!dansLaFenetre(d)) continue
      const cle = `${p.regime ?? '-'}|${p.caisse ?? '-'}`
      const ligne: LigneNonComparable = sansOrganisme.get(cle) ?? {
        part: 'obligatoire', regime: p.regime, caisse: p.caisse, raison: 'organisme_du_paiement_non_dit', factureCentimes: null, payeDesJourneesCentimes: 0,
      }
      ligne.payeDesJourneesCentimes += brut
      sansOrganisme.set(cle, ligne)
      continue
    }
    if (!dansLeCompte(d)) continue
    const o = organisme(p.regime, p.caisse)
    o.paiements.set(d, (o.paiements.get(d) ?? 0) + brut)
    if (dansLaFenetre(d)) o.facturesPayees += p.nombre_de_factures
  }

  const lignes: LigneComparee[] = []
  const nonComparables: LigneNonComparable[] = []
  const ordonnes = [...organismes.values()].sort((a, b) => a.regime - b.regime || a.caisse - b.caisse)
  for (const o of ordonnes) {
    const lotsDuCompte = [...o.lots.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const sommeFenetre = (m: Map<string, number>) => [...m.entries()].filter(([d]) => dansLaFenetre(d)).reduce((s, [, v]) => s + v, 0)
    const factureCentimes = sommeFenetre(o.lots)
    const payeDesJourneesCentimes = sommeFenetre(o.paiements)
    if (lotsDuCompte.some(([, montant]) => montant < 0)) {
      nonComparables.push({ part: 'obligatoire', regime: o.regime, caisse: o.caisse, raison: 'avoir_dans_le_facture', factureCentimes, payeDesJourneesCentimes })
      continue
    }
    // L'imputation : chaque journée, dans l'ordre, paie les lots ouverts les plus anciens créés au plus tard ce jour-là.
    const ouverts = lotsDuCompte.map(([date, montant]) => ({ date, reste: montant }))
    let payeSansLotEnFaceCentimes = 0
    for (const [journee, brut] of [...o.paiements.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      let aImputer = brut
      for (const lot of ouverts) {
        if (aImputer === 0 || lot.date > journee) break
        const pris = Math.min(lot.reste, aImputer)
        lot.reste -= pris
        aImputer -= pris
      }
      if (dansLaFenetre(journee)) payeSansLotEnFaceCentimes += aImputer
    }
    const tranches: Record<TrancheDuReste, number> = { sept_jours_au_plus: 0, de_8_a_30_jours: 0, de_31_a_90_jours: 0, plus_de_90_jours: 0 }
    let resteEstimeCentimes = 0
    let plusAncienLotOuvert: string | null = null
    for (const lot of ouverts) {
      if (!dansLaFenetre(lot.date) || lot.reste === 0) continue
      resteEstimeCentimes += lot.reste
      tranches[trancheDe(rangSituation - (rangDuJour(lot.date) as number))] += lot.reste
      plusAncienLotOuvert ??= lot.date
    }
    if (factureCentimes === 0 && payeDesJourneesCentimes === 0 && o.facturesFacturees === 0 && o.facturesPayees === 0) continue
    lignes.push({
      part: 'obligatoire', regime: o.regime, caisse: o.caisse,
      enFace: o.lots.size === 0 ? 'paye_seul' : o.paiements.size === 0 ? 'facture_seul' : 'les_deux',
      factureCentimes, payeDesJourneesCentimes, payeImputeCentimes: factureCentimes - resteEstimeCentimes, resteEstimeCentimes,
      tranches, plusAncienLotOuvert, payeSansLotEnFaceCentimes, facturesFacturees: o.facturesFacturees, facturesPayees: o.facturesPayees,
    })
  }
  nonComparables.push(...[...sansOrganisme.values()])
  if (complementaire.factureCentimes !== 0 || complementaire.payeDesJourneesCentimes !== 0) {
    nonComparables.push({ part: 'complementaire', regime: null, caisse: null, raison: 'complementaire_non_dite', ...complementaire })
  }

  const auMois = (d: string) => d.slice(0, 7)
  const moisAvecLot = new Set(facture.totaux.lignes.filter((t) => dansLaFenetre(t.date_creation_lot)).map((t) => auMois(t.date_creation_lot)))
  const moisAvecPaiement = new Set(paye.paiements.lignes.filter((p) => dansLaFenetre(p.date_journee_comptable)).map((p) => auMois(p.date_journee_comptable)))
  const mois = moisDeLaFenetre(fenetre.du, fenetre.au)

  const somme = (cle: 'factureCentimes' | 'payeDesJourneesCentimes' | 'resteEstimeCentimes' | 'payeSansLotEnFaceCentimes') =>
    lignes.reduce((s, l) => s + l[cle], 0)
  return {
    etat: 'compte', fenetre: { du: fenetre.du, au: fenetre.au }, origine, situationAu, joursDepuisLaSituation: jour - rangSituation,
    lignes,
    total: {
      factureCentimes: somme('factureCentimes'), payeDesJourneesCentimes: somme('payeDesJourneesCentimes'),
      resteEstimeCentimes: somme('resteEstimeCentimes'), payeSansLotEnFaceCentimes: somme('payeSansLotEnFaceCentimes'),
    },
    nonComparables, horsFacture,
    moisSansLot: mois.filter((m) => !moisAvecLot.has(m)),
    moisSansPaiement: mois.filter((m) => !moisAvecPaiement.has(m)),
  }
}
