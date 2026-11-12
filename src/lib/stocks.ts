import type { Controle2033 } from './liasse2033'
import { formatMoney } from './format'
import type { DefinitionRoleComptable } from './planComptable'

// LES STOCKS DE CLÔTURE (ligne 36, lot LIA2 ; conception docs/conceptions/37-liasse-2033.md, § 4.2, § 4.5 à 4.9 et § 5).
//
// L'inventaire est PHYSIQUE et SAISI : l'application ne tient aucun inventaire permanent (aucune quantité ; `articles` est le
// catalogue de vente du client). Le cabinet saisit, par compte de stock du plan, la valeur HORS TAXES au 31 décembre
// (notice 2033-NOT-SD, cases 050 et 060), la méthode et la feuille d'inventaire déposée (LIA-Q3, recommandation (C) : une
// valeur par compte maintenant, le détail article par article plus tard). Zéro est une saisie « néant », explicite.
//
// L'ÉCRITURE (LIA-Q2, recommandation (A)) : l'annulation du stock initial — le solde d'OUVERTURE du compte, lu en base dans
// les à-nouveaux et les soldes reportés — au débit de la variation et au crédit du stock, puis la constatation du stock
// final au débit du stock et au crédit de la variation (PCG, art. 946-60 et 947-71). Contrepartie : 6031 pour 31, 6032 pour
// 32, 6037 pour 37, 713 pour 33, 34 et 35, chacune au compte que le plan du dossier donne à son rôle. Datée du 31 décembre,
// sans pièce ni autre source. La base la RECOMPOSE en entiers et la compare en multiensemble
// (`enregistrer_stock_de_cloture`, migration `stocks_de_cloture`, supabase/preparees/) : ce module compose ce qu'elle
// vérifiera, et dit ses refus avant le clic, aux mêmes mots (`REFUS_DES_STOCKS`, confrontés au texte de la migration).
//
// LE BNC EN TRÉSORERIE N'EST JAMAIS TOUCHÉ : la composition se refuse hors de l'engagement, comme la base ; la 2035 ne lit
// rien d'ici.
//
// LE DRAPEAU, BAISSÉ : `STOCKS_PREVUS` (la table en base : le plan de sauvegarde la lit). Il ne se lève qu'APRÈS la
// migration, et avec la sorte « stock » de la numérotation (LIA5) : sans elle, la validation d'un exercice qui porte une
// écriture de stock se refuserait (« la numérotation proposée ne couvre pas exactement… »).
export const STOCKS_PREVUS: boolean = false

export const TABLES_DES_STOCKS = ['stocks_de_cloture'] as const

// Les dix rôles du catalogue (conception 37, § 4.6), aux libellés du PCG et aux rangs 500 à 590 de la migration ; la
// lecture du plan les ignore tant que rien ne les lit (comme tout rôle qu'elle ne connaît pas).
export const ROLES_DES_STOCKS = [
  { role: 'stocks_matieres', racines: ['31'], compteDefaut: '310000', libelleDefaut: 'Matières premières (et fournitures)', prefixeAuxiliaireDefaut: null, ordre: 500 },
  { role: 'stocks_autres_approvisionnements', racines: ['32'], compteDefaut: '320000', libelleDefaut: 'Autres approvisionnements', prefixeAuxiliaireDefaut: null, ordre: 510 },
  { role: 'en_cours_biens', racines: ['33'], compteDefaut: '330000', libelleDefaut: 'En-cours de production de biens', prefixeAuxiliaireDefaut: null, ordre: 520 },
  { role: 'en_cours_services', racines: ['34'], compteDefaut: '340000', libelleDefaut: 'En-cours de production de services', prefixeAuxiliaireDefaut: null, ordre: 530 },
  { role: 'stocks_produits', racines: ['35'], compteDefaut: '355000', libelleDefaut: 'Produits finis', prefixeAuxiliaireDefaut: null, ordre: 540 },
  { role: 'stocks_marchandises', racines: ['37'], compteDefaut: '370000', libelleDefaut: 'Stocks de marchandises', prefixeAuxiliaireDefaut: null, ordre: 550 },
  { role: 'variation_stocks_matieres', racines: ['6031'], compteDefaut: '603100', libelleDefaut: 'Variation des stocks de matières premières (et fournitures)', prefixeAuxiliaireDefaut: null, ordre: 560 },
  { role: 'variation_stocks_approvisionnements', racines: ['6032'], compteDefaut: '603200', libelleDefaut: 'Variation des stocks des autres approvisionnements', prefixeAuxiliaireDefaut: null, ordre: 570 },
  { role: 'variation_stocks_marchandises', racines: ['6037'], compteDefaut: '603700', libelleDefaut: 'Variation des stocks de marchandises', prefixeAuxiliaireDefaut: null, ordre: 580 },
  { role: 'production_stockee', racines: ['713'], compteDefaut: '713000', libelleDefaut: 'Variation des stocks (en-cours de production, produits)', prefixeAuxiliaireDefaut: null, ordre: 590 },
] as const satisfies readonly DefinitionRoleComptable[]

export type CleRoleDesStocks = (typeof ROLES_DES_STOCKS)[number]['role']

/** Les comptes des dix rôles, lus au plan du dossier (`plan_du_dossier`) : jamais un défaut supposé. */
export type ComptesDesStocks = Readonly<Record<CleRoleDesStocks, string>>

export type MethodeDEvaluation = 'cmup' | 'peps' | 'cout_specifique'

export const METHODES_D_EVALUATION: Readonly<Record<MethodeDEvaluation, string>> = {
  cmup: 'Coût moyen pondéré',
  peps: 'Premier entré, premier sorti',
  cout_specifique: 'Coût spécifique',
}

type RoleDeStock = 'stocks_matieres' | 'stocks_autres_approvisionnements' | 'en_cours_biens' | 'en_cours_services'
  | 'stocks_produits' | 'stocks_marchandises'
type RoleDeVariation = 'variation_stocks_matieres' | 'variation_stocks_approvisionnements' | 'variation_stocks_marchandises'
  | 'production_stockee'

/** La forme d'un compte de stock que la base accepte : six chiffres, sous 31 à 35 ou 37. */
export const FORME_COMPTE_DE_STOCK = /^3[1-57][0-9]{4}$/

/** Le rôle d'un compte de stock et celui de sa variation (§ 4.2) ; nul hors de la forme. */
export function rolesDuCompteDeStock(compte: string): { stock: RoleDeStock; variation: RoleDeVariation } | null {
  if (!FORME_COMPTE_DE_STOCK.test(compte)) return null
  switch (compte.slice(0, 2)) {
    case '31': return { stock: 'stocks_matieres', variation: 'variation_stocks_matieres' }
    case '32': return { stock: 'stocks_autres_approvisionnements', variation: 'variation_stocks_approvisionnements' }
    case '33': return { stock: 'en_cours_biens', variation: 'production_stockee' }
    case '34': return { stock: 'en_cours_services', variation: 'production_stockee' }
    case '35': return { stock: 'stocks_produits', variation: 'production_stockee' }
    default: return { stock: 'stocks_marchandises', variation: 'variation_stocks_marchandises' }
  }
}

// Les mots des refus, ceux de la base quand elle refuse la même chose (stocks.test.ts les confronte au texte de la
// migration, à leurs paramètres près).
export const REFUS_DES_STOCKS = {
  tresorerie: 'Un dossier en trésorerie ne tient pas de stock de clôture : la 2035 n’en connaît pas.',
  exercice: 'L’exercice du stock de clôture est illisible.',
  compte: 'Un stock de clôture se tient sur un compte de stock à six chiffres, sous 31, 32, 33, 34, 35 ou 37.',
  montant: 'Le stock final est un montant hors taxes en centimes entiers, positif ou nul.',
  methode: 'La méthode d’évaluation du stock est hors de sa liste : coût moyen pondéré, premier entré premier sorti, ou coût spécifique.',
  objet: 'L’objet du stock de clôture tient en 1 à 200 caractères, sans espace au début ni à la fin.',
  ouverture: 'Le solde d’ouverture du compte est illisible : il se lit en centimes entiers.',
} as const

export interface SaisieDuStock {
  exercice: number
  compteStock: string
  /** Le stock final HORS TAXES, en centimes entiers ; zéro, la saisie « néant ». */
  montantCentimes: number
  methode: MethodeDEvaluation
  objet: string
  pieceCiteeId: string | null
}

export interface LigneDuStock {
  compte: string
  sens: 'debit' | 'credit'
  centimes: number
  libelle: string
}

/** Toutes les entrées sont obligatoires : rien n'est supposé à la place de ce que la base lira. */
export interface EntreesDuStock {
  mode: 'engagement' | 'tresorerie'
  saisie: SaisieDuStock
  /** Le solde d'OUVERTURE du compte (`ouvertureDuCompte`), en centimes, le débit positif. */
  ouvertureCentimes: number
  comptes: ComptesDesStocks
  /** Le dernier exercice validé du dossier, nul s'il n'y en a aucun. */
  derniereValidee: number | null
  /** L'année en cours, au jour de Paris (la base la lit de même). */
  anneeEnCours: number
}

export type CompositionDuStock =
  | { ok: true; lignes: LigneDuStock[]; ouvertureCentimes: number; contrepartie: string }
  | { ok: false; refus: string }

const centimesEntiers = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max

/**
 * La composition de l'écriture de clôture d'un compte de stock — l'annulation du stock initial, la constatation du stock
 * final, quatre lignes au plus, deux par mouvement — ou le refus, dans l'ordre où la base les dit. Les refus que seule la
 * base peut juger (la version lue, la feuille citée d'un autre dossier) restent les siens.
 */
export function composerLeStock(e: EntreesDuStock): CompositionDuStock {
  const { saisie: s } = e
  if (e.mode !== 'engagement') return { ok: false, refus: REFUS_DES_STOCKS.tresorerie }
  if (!Number.isInteger(s.exercice) || s.exercice < 2000 || s.exercice > 2100) return { ok: false, refus: REFUS_DES_STOCKS.exercice }
  const roles = rolesDuCompteDeStock(s.compteStock)
  if (!roles) return { ok: false, refus: REFUS_DES_STOCKS.compte }
  if (!centimesEntiers(s.montantCentimes, 999_999_999_999)) return { ok: false, refus: REFUS_DES_STOCKS.montant }
  if (!(s.methode in METHODES_D_EVALUATION)) return { ok: false, refus: REFUS_DES_STOCKS.methode }
  if (s.objet.length < 1 || [...s.objet].length > 200 || s.objet !== s.objet.trim()) return { ok: false, refus: REFUS_DES_STOCKS.objet }
  if (e.derniereValidee !== null && s.exercice <= e.derniereValidee) {
    return { ok: false, refus: `L’exercice ${s.exercice} est validé : son stock de clôture ne change plus.` }
  }
  if (s.exercice > e.anneeEnCours) {
    return { ok: false, refus: `L’exercice ${s.exercice} n’est pas commencé : son stock de clôture ne se saisit pas encore.` }
  }
  const auPlan = e.comptes[roles.stock]
  if (auPlan !== s.compteStock) {
    return { ok: false, refus: `Le compte ${s.compteStock} n’est pas le compte de ce stock au plan du dossier (${auPlan}).` }
  }
  if (!Number.isSafeInteger(e.ouvertureCentimes)) return { ok: false, refus: REFUS_DES_STOCKS.ouverture }
  if (e.ouvertureCentimes < 0) {
    return {
      ok: false,
      refus: `Le compte ${s.compteStock} s’ouvre au crédit (${-e.ouvertureCentimes} centimes) : un stock ne s’ouvre pas au crédit — `
        + 'relire la balance reprise ou les soldes reportés.',
    }
  }
  const contrepartie = e.comptes[roles.variation]
  const lignes: LigneDuStock[] = []
  if (e.ouvertureCentimes > 0) {
    const libelle = `Annulation du stock initial ${s.exercice} (${s.compteStock})`
    lignes.push({ compte: contrepartie, sens: 'debit', centimes: e.ouvertureCentimes, libelle },
      { compte: s.compteStock, sens: 'credit', centimes: e.ouvertureCentimes, libelle })
  }
  if (s.montantCentimes > 0) {
    const libelle = `Stock final au 31/12/${s.exercice} (${s.compteStock})`
    lignes.push({ compte: s.compteStock, sens: 'debit', centimes: s.montantCentimes, libelle },
      { compte: contrepartie, sens: 'credit', centimes: s.montantCentimes, libelle })
  }
  return { ok: true, lignes, ouvertureCentimes: e.ouvertureCentimes, contrepartie }
}

/** Ce que l'appel de la base reçoit : `p_stock` et `p_ecritures` d'`enregistrer_stock_de_cloture`. */
export function argumentsDeLaBase(s: SaisieDuStock, lignes: readonly LigneDuStock[]) {
  return {
    p_stock: {
      exercice: s.exercice, compte_stock: s.compteStock, montant_centimes: s.montantCentimes, methode: s.methode,
      objet: s.objet, piece_citee_id: s.pieceCiteeId,
    },
    p_ecritures: lignes.map((l) => ({ compte: l.compte, sens: l.sens, centimes: l.centimes, libelle: l.libelle })),
  }
}

/** Une ligne d'à-nouveaux ou de soldes reportés, telle que la base la rend (`montant` en euros, deux décimales). */
export interface LigneDOuverture {
  date: string
  compte: string
  sens: 'debit' | 'credit'
  montant: number
}

/**
 * Le solde d'ouverture d'un compte pour un exercice, comme la base le lit : les à-nouveaux datés dans l'exercice, les
 * soldes reportés à son 1er janvier, en centimes, le débit positif.
 */
export function ouvertureDuCompte(
  aNouveaux: readonly LigneDOuverture[], soldesReportes: readonly LigneDOuverture[], compte: string, exercice: number,
): number {
  const signe = (l: LigneDOuverture) => (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100)
  const debut = `${exercice}-01-01`
  const fin = `${exercice}-12-31`
  return aNouveaux.filter((l) => l.compte === compte && l.date >= debut && l.date <= fin).reduce((t, l) => t + signe(l), 0)
    + soldesReportes.filter((l) => l.compte === compte && l.date === debut).reduce((t, l) => t + signe(l), 0)
}

// ── Le contrôle 2 de la liasse (conception 37, § 3.6) ─────────────────────────────────────────────────────────────

/** Un stock saisi, tel que la table le garde. */
export interface StockSaisi {
  compte_stock: string
  montant_centimes: number
}

/**
 * Le contrôle 2 : les stocks bruts du 2033-A (cases 050 et 060 : les soldes des comptes 31 à 38, la dépréciation 39 à
 * part) contre les stocks de clôture saisis, COMPTE PAR COMPTE. Un compte de stock soldé sans saisie, une saisie que le
 * bilan ne porte pas, ou une valeur qui diffère : chacun se dit, et retient la validation.
 */
export function controleDesStocks(
  soldes: readonly { compte: string; centimes: number }[], stocks: readonly StockSaisi[],
): Controle2033[] {
  const auBilan = new Map<string, number>()
  for (const s of soldes) if (/^3[0-8]/.test(s.compte)) auBilan.set(s.compte, (auBilan.get(s.compte) ?? 0) + s.centimes)
  const saisis = new Map<string, number>()
  for (const s of stocks) saisis.set(s.compte_stock, (saisis.get(s.compte_stock) ?? 0) + s.montant_centimes)
  const comptes = [...new Set([...auBilan.keys(), ...saisis.keys()])].sort()
  const echecs: Controle2033[] = []
  for (const compte of comptes) {
    const bilan = auBilan.get(compte) ?? 0
    const saisi = saisis.get(compte)
    if (saisi === undefined) {
      if (bilan === 0) continue
      echecs.push({
        code: 'stocks-au-bilan', numero: 2, ecart: bilan,
        texte: `Le compte ${compte} porte ${euros(bilan)} au bilan, et aucun stock de clôture n’y est saisi.`,
      })
    } else if (bilan !== saisi) {
      echecs.push({
        code: 'stocks-au-bilan', numero: 2, ecart: bilan - saisi,
        texte: `Le compte ${compte} porte ${euros(bilan)} au bilan, le stock de clôture saisi ${euros(saisi)} : son écriture `
          + 'n’est pas à jour, ou une autre écriture touche le compte.',
      })
    }
  }
  return echecs
}

const euros = (centimes: number) => formatMoney(centimes / 100)
