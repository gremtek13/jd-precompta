import { libelleDuResultat } from './aNouveaux'
import { COMPTE_CAPITAL_INDIVIDUEL, COMPTE_EXPLOITANT, COMPTE_RESULTAT_BENEFICE, COMPTE_RESULTAT_PERTE } from './comptes'
import type { ModeleComptable } from './engagement'
import type { NumerotationFec } from './fec'
import { anneeDe } from './format'
import type { ANouveau, EcritureBrouillon, SensEcriture, SoldeReporte } from './types'
import { compteDuDirigeant } from './virementPersonnel'

// LE REPORT DES SOLDES D'UN EXERCICE SUR L'AUTRE (ligne 34 de la feuille de route). Jusqu'au 07/10/2026, seule une
// balance reprise d'un autre logiciel ouvrait un exercice (lib/aNouveaux.ts) : l'exercice qui suit un exercice validé
// dans l'application n'avait pas d'ouverture, son FEC commençait sans à-nouveaux, et chaque compte de bilan y paraissait
// sortir de nulle part.
//
// Décisions du cabinet le 06/10/2026 : les à-nouveaux de l'exercice suivant s'écrivent À LA VALIDATION d'un exercice,
// dans le même clic, et reprennent exactement ses soldes figés ; tant qu'un exercice n'est pas validé, le suivant n'a
// pas d'ouverture, et l'écran le dit. Pour une entreprise individuelle, le compte de l'exploitant (108) et le résultat
// passent au capital individuel (101), comme le prévoit le plan comptable (art. 1211-10, version du 1er janvier 2026 ;
// la migration, figée, le cite sous son ancien numéro, 941-10) : le nouvel exercice repart d'un 108 vide. Une société
// garde son résultat en 120 ou 129, en attente d'affectation.
//
// LA BASE ÉCRIT, L'APPLICATION MONTRE. `valider_exercice` calcule les soldes par `soldes_a_reporter` et les écrit dans
// `soldes_reportes` (supabase/schema/20261007052231_report_des_soldes.sql, éprouvé par
// supabase/essais/reportDesSoldes.sql). Ce module en est le JUMEAU, au centime et au libellé près, pour montrer
// l'ouverture de l'exercice suivant AVANT le clic — une validation ne se défait pas — et dire ce que la base refuserait.
// `reportDesSoldes.test.ts` le confronte à une table relevée sur la fonction de la base et aux littéraux de la
// migration : deux calculs de la même chose finissent par diverger, et ici rien ne le montrerait — l'écran annoncerait
// une ouverture, la base en écrirait une autre.
//
// IL CALCULE SUR LA NUMÉROTATION DE L'EXERCICE (`mouvementsDeCloture`), celle que la validation envoie : la base exige
// qu'elle couvre exactement les écritures et l'ouverture de l'exercice, et fige les libellés qu'elle propose — ceux que
// le report reprend. Ce que la numérotation laisserait de côté (une écriture que rien ne rattache) fait de toute façon
// refuser la validation.

/** Le libellé du 101000 quand l'exercice ne lui en donne aucun : celui de la base, mot pour mot. */
export const LIBELLE_CAPITAL_INDIVIDUEL = 'Capital individuel'
/**
 * Le libellé du résultat d'une société quand il s'ajoute, sur son compte, à un résultat antérieur encore en attente
 * d'affectation : la ligne ne porte plus le résultat d'un seul exercice, et dire « l'exercice 2026 » serait faux.
 */
export const LIBELLE_RESULTATS_EN_ATTENTE = 'Résultats en attente d’affectation'

/** La pièce des soldes reportés dans le FEC de l'exercice qu'ils ouvrent (`source_nom`). */
export function sourceDuReport(exercice: number): string {
  return `Exercice ${exercice} validé`
}

// UNE ENTREPRISE INDIVIDUELLE est un dossier dont le compte du dirigeant est le compte de l'exploitant : tout dossier
// en trésorerie (un BNC est une entreprise individuelle), et un dossier en engagement qui a choisi le 108 pour son
// dirigeant. La base fait le même choix (`mode_comptable = 'tresorerie' or compte_notes_de_frais = '108000'`).
export function exploitantIndividuel(modele: ModeleComptable): boolean {
  return compteDuDirigeant(modele) === COMPTE_EXPLOITANT
}

// Les trois motifs de la base, à l'identique : ce qui fait le résultat, ce qui passe au capital individuel, et ce qui
// peut s'ouvrir (classes 1 à 5, au moins trois chiffres — la contrainte de `soldes_reportes`). Exportés pour que
// `reportDesSoldes.test.ts` les retrouve dans la migration.
export const MOTIFS_DU_REPORT = {
  resultat: /^[67]/,
  capitauxDeLExploitant: /^(101|108|12)/,
  reportable: /^[1-5][0-9]{2,}$/,
} as const
const COMPTE_DE_RESULTAT = MOTIFS_DU_REPORT.resultat
const CAPITAUX_DE_L_EXPLOITANT = MOTIFS_DU_REPORT.capitauxDeLExploitant
const COMPTE_REPORTABLE = MOTIFS_DU_REPORT.reportable

/** Une ligne de l'exercice, telle que le report la lit : une écriture ou un à-nouveau, et le libellé de son compte. */
export interface MouvementDeCloture {
  compte: string
  compteLib: string
  sens: SensEcriture
  montant: number
}

/**
 * Les lignes d'un exercice telles que sa validation les fige : ses écritures et son ouverture — reprise ou reportée —,
 * chacune avec le libellé de compte que la numérotation lui donne, celui que la base posera.
 */
export function mouvementsDeCloture(n: Pick<NumerotationFec, 'lignes' | 'aNouveaux'>): MouvementDeCloture[] {
  return [
    ...n.lignes.map((l) => ({ compte: l.ecriture.compte, compteLib: l.compteLib, sens: l.ecriture.sens, montant: l.ecriture.montant })),
    ...n.aNouveaux.map((a) => ({ compte: a.aNouveau.compte, compteLib: a.compteLib, sens: a.aNouveau.sens, montant: a.aNouveau.montant })),
  ]
}

/** Un solde de fin d'exercice, tel qu'il ouvrira le suivant. */
export interface SoldeAReporter {
  compte: string
  libelle: string
  sens: SensEcriture
  montant: number
}

export interface ReportDesSoldes {
  /** L'exercice qui se clôt. */
  exercice: number
  /** Le 1er janvier de l'exercice que ces soldes ouvriront. */
  date: string
  /** Leur pièce dans le FEC de cet exercice : « Exercice AAAA validé ». */
  source: string
  /** Entreprise individuelle : le 108, le 101, le 12 et le résultat passent au 101000. */
  individuel: boolean
  /** Le résultat de l'exercice, en euros : positif un bénéfice, négatif une perte. */
  resultat: number
  /** Ce qui sera écrit, un compte par ligne, dans l'ordre des comptes. */
  soldes: SoldeAReporter[]
  /**
   * Les comptes qui portent un solde sans être de bilan ni de résultat (classe 8, un numéro hors du plan) : il ne se
   * reporterait pas, et la base refuse la validation. Dans l'ordre des comptes.
   */
  horsClasses: string[]
  /** Débit − crédit de l'ouverture qui s'écrirait, en centimes : non nul, la base refuse la validation. */
  ecartCentimes: number
  totalDebit: number
  totalCredit: number
}

// LE CALCUL DE `soldes_a_reporter`, en centimes entiers — la base somme des numeric, et une somme de flottants y
// laisserait un écart de 1e-13 qu'elle ne voit pas, ou en masquerait un.
//   - Le solde de chaque compte : ses lignes, débit moins crédit, et son libellé (un seul, la validation le garantit :
//     un compte qui en porterait deux ferait refuser la numérotation ; la base prend le plus grand, ce module aussi).
//   - Les classes 6 et 7 font le résultat : au 101000 pour une entreprise individuelle, sinon au 120000 pour un bénéfice
//     (crédit) ou au 129000 pour une perte ou un résultat nul.
//   - Pour une entreprise individuelle, le 101, le 108 et le 12 passent au 101000.
//   - Le libellé d'un compte reporté est celui que l'exercice lui a figé ; le 101000 qui n'en a pas s'appelle « Capital
//     individuel » ; le résultat d'une société porte son exercice, ou « Résultats en attente d'affectation » quand son
//     compte portait déjà un solde.
//   - Un compte soldé ne s'écrit pas.
export function soldesAReporter(
  mouvements: readonly MouvementDeCloture[],
  modele: ModeleComptable,
  exercice: number,
): ReportDesSoldes {
  const individuel = exploitantIndividuel(modele)
  const parCompte = new Map<string, { libelle: string | null; net: number }>()
  for (const m of mouvements) {
    const s = parCompte.get(m.compte) ?? { libelle: null, net: 0 }
    s.net += (m.sens === 'debit' ? 1 : -1) * Math.round(m.montant * 100)
    if (s.libelle === null || m.compteLib > s.libelle) s.libelle = m.compteLib
    parCompte.set(m.compte, s)
  }

  // Débit − crédit des comptes de résultat : négatif, un bénéfice.
  let resultat = 0
  for (const [compte, s] of parCompte) if (COMPTE_DE_RESULTAT.test(compte)) resultat += s.net
  const compteDuResultat = individuel
    ? COMPTE_CAPITAL_INDIVIDUEL
    : resultat < 0 ? COMPTE_RESULTAT_BENEFICE : COMPTE_RESULTAT_PERTE
  const cibleDe = (compte: string) =>
    COMPTE_DE_RESULTAT.test(compte) ? compteDuResultat
      : individuel && CAPITAUX_DE_L_EXPLOITANT.test(compte) ? COMPTE_CAPITAL_INDIVIDUEL
        : compte

  const parCible = new Map<string, { net: number; libelle: string | null; soldeAnterieur: boolean }>()
  for (const [compte, s] of parCompte) {
    const cible = cibleDe(compte)
    const g = parCible.get(cible) ?? { net: 0, libelle: null, soldeAnterieur: false }
    g.net += s.net
    // Le libellé du compte même qui reçoit : celui d'un compte qui s'y verse (le 108 dans le 101000) ne le nomme pas.
    if (compte === cible && s.libelle !== null && (g.libelle === null || s.libelle > g.libelle)) g.libelle = s.libelle
    // Un compte qui n'est pas de résultat et porte un solde : sur le compte du résultat d'une société, c'est un
    // résultat antérieur encore en attente d'affectation.
    if (!COMPTE_DE_RESULTAT.test(compte) && s.net !== 0) g.soldeAnterieur = true
    parCible.set(cible, g)
  }

  const soldes: SoldeAReporter[] = []
  const horsClasses: string[] = []
  let ecartCentimes = 0
  let debit = 0
  let credit = 0
  for (const [compte, g] of parCible) {
    if (g.net === 0) continue
    const libelle = !individuel && resultat !== 0 && compte === compteDuResultat
      ? (g.soldeAnterieur ? LIBELLE_RESULTATS_EN_ATTENTE : libelleDuResultat(exercice, resultat < 0))
      // Le numéro du compte, en dernier recours : un compte qui reçoit un solde a toujours un libellé dans la
      // numérotation (`libellesDesComptes`, lib/fec.ts) — la base, elle, refuserait d'écrire un solde sans libellé.
      : g.libelle ?? (compte === COMPTE_CAPITAL_INDIVIDUEL ? LIBELLE_CAPITAL_INDIVIDUEL : compte)
    soldes.push({ compte, libelle, sens: g.net > 0 ? 'debit' : 'credit', montant: Math.abs(g.net) / 100 })
    if (!COMPTE_REPORTABLE.test(compte)) horsClasses.push(compte)
    ecartCentimes += g.net
    if (g.net > 0) debit += g.net
    else credit -= g.net
  }
  const parNumero = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return {
    exercice,
    date: `${exercice + 1}-01-01`,
    source: sourceDuReport(exercice),
    individuel,
    resultat: -resultat / 100,
    soldes: soldes.sort((a, b) => parNumero(a.compte, b.compte)),
    horsClasses: horsClasses.sort(parNumero),
    ecartCentimes,
    totalDebit: debit / 100,
    totalCredit: credit / 100,
  }
}

// ── L'ouverture d'un exercice ───────────────────────────────────────────────────────────────────────────

/** Un solde reporté sous la forme d'un à-nouveau, que le FEC, la balance et la piste d'audit lisent déjà. */
export function aNouveauDuReport(s: SoldeReporte): ANouveau {
  // Pas de numéro d'origine : ce compte vient de l'application elle-même, pas d'une balance lue.
  return { ...s, compte_origine: null }
}

// L'OUVERTURE D'UN EXERCICE : la balance reprise, s'il est celui de la reprise, ou les soldes reportés de l'exercice
// validé qui le précède. Jamais les deux — l'exercice repris se valide le premier, et des à-nouveaux ne se posent plus
// dès qu'un exercice est validé (la base le refuse). C'est ce que lisent le FEC de l'exercice, sa balance, sa piste
// d'audit et sa validation (`an_e` dans `valider_exercice`).
//
// CE QUI NE LA LIT PAS, et ne doit pas la lire : ce qui CUMULE depuis la reprise — la trésorerie (`ouvertureBanque`,
// `soldeBanqueADate`), les comptes de tiers à une date (`comptesDeTiers`) — compterait deux fois les soldes reportés,
// qui sont déjà la somme de ce qu'ils parcourent ; et ce qui lit la DATE DE LA REPRISE — un bien acquis avant elle, une
// dotation ou un forfait que la balance reprise porte, l'exercice qui se valide d'abord — lit `a_nouveaux` seul.
export function ouvertureDeLExercice(
  reprise: readonly ANouveau[],
  reportes: readonly SoldeReporte[],
  exercice: number,
): ANouveau[] {
  const debut = `${exercice}-01-01`
  const fin = `${exercice}-12-31`
  return [
    ...reprise.filter((a) => a.date >= debut && a.date <= fin),
    ...reportes.filter((s) => s.date === debut).map(aNouveauDuReport),
  ]
}

// CE QUE L'ÉCRAN DIT DE L'OUVERTURE D'UN EXERCICE. Tant que l'exercice précédent n'est pas validé, celui-ci n'a pas
// d'ouverture — décision du cabinet —, et c'est ce que l'écran doit dire plutôt que de laisser croire que ses comptes de
// bilan partent de zéro. Un exercice que rien ne précède (le premier d'une activité nouvelle) n'en attend aucune ; un
// exercice antérieur à la reprise est dans les comptes repris.
export type EtatDeLOuverture =
  | { type: 'reprise'; date: string; source: string }
  // `lignes` peut valoir zéro : un exercice validé dont tous les comptes étaient soldés n'a rien reporté, et c'est une
  // ouverture quand même.
  | { type: 'report'; depuis: number; lignes: number }
  // L'exercice dont la validation l'écrira : le précédent.
  | { type: 'en-attente'; exercice: number }
  | { type: 'sans-objet' }

export function etatDeLOuverture(
  exercice: number,
  d: {
    reprise: readonly ANouveau[]
    reportes: readonly SoldeReporte[]
    anneesValidees: readonly number[]
    // Tout le brouillon du dossier : une écriture d'un exercice antérieur dit qu'une activité le précède.
    ecritures: readonly Pick<EcritureBrouillon, 'date'>[]
  },
): EtatDeLOuverture {
  const debut = `${exercice}-01-01`
  const reprise = d.reprise.filter((a) => anneeDe(a.date) === exercice)
  if (reprise.length > 0) return { type: 'reprise', date: reprise[0].date, source: reprise[0].source_nom }
  const dateReprise = d.reprise.length > 0 ? d.reprise.map((a) => a.date).sort()[0] : null
  if (dateReprise !== null && debut < dateReprise) return { type: 'sans-objet' }
  if (d.anneesValidees.includes(exercice - 1)) {
    return { type: 'report', depuis: exercice - 1, lignes: d.reportes.filter((s) => s.date === debut).length }
  }
  const precede = dateReprise !== null || d.anneesValidees.some((a) => a < exercice) || d.ecritures.some((e) => e.date < debut)
  return precede ? { type: 'en-attente', exercice: exercice - 1 } : { type: 'sans-objet' }
}
