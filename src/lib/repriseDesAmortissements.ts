import { amortissementCumuleCentimes, compteAmortissement, rang360 } from './amortissements'
import { compteQueLApplicationEcrit } from './aNouveaux'
import { anneeDe, formatDate, formatMoney } from './format'
import type { PlanComptable } from './planComptable'
import type { ANouveau, Immobilisation, NatureImmobilisation } from './types'

// LA REPRISE CONFRONTÉE AU REGISTRE (IMMO-Q1, relecture des immobilisations du 03/11/2026, D5 ; écrite sur la recommandation le
// 04/11/2026). L'application calcule chaque dotation depuis le registre SEUL — linéaire, 30/360, depuis la mise en service
// (lib/amortissements.ts) — et le compte 28 de la balance reprise n'entre dans aucun calcul. Quand l'ancien logiciel comptait
// en jours réels, ou que la valeur, la mise en service ou la durée saisies ne sont pas celles de l'ancien tableau, le cumul du
// registre au jour de la reprise n'est pas celui que la balance porte : l'écart demeure chaque année, le 28 ne rejoint jamais
// le 21 en fin de plan, et une durée de six ans saisie pour cinq fait 800 € en case CH au lieu de 960. Rien ne le disait, hors
// de la preuve de la Révision (`biens-repris`).
//
// Ce module compare, COMPTE PAR COMPTE, le cumul des amortissements au 31 décembre de l'année qui précède l'ouverture, tel
// que le registre le calcule (`amortissementCumuleCentimes`, le calcul même de la base), au compte 28 de la balance reprise.
// Le registre se range par compte d'amortissement : le 28 + le compte de la nature du bien (`compteAmortissement`, 218300 →
// 281830). Pur : la Vue d'ensemble en fait un point « attention » (lib/pointsDeLaChecklist.ts).
//
// CE QU'IL NE PREND PAS POUR UN ÉCART :
// - un compte de la reprise sous un autre numéro que celui que l'application écrit (un 28183 de la balance pour le 281830 du
//   registre — `compteQueLApplicationEcrit`, la règle de l'import de la balance) : il se dit à part, ses deux cumuls donnés,
//   car comparer le registre à un compte que l'application n'écrira jamais n'aurait pas de sens ;
// - moins d'un euro (`SEUIL_ECART_REPRISE_CENTIMES`) : l'arrondi d'un autre logiciel, le seuil de la relecture.
//
// IL SE TAIT : sans balance reprise (rien à confronter), et dès qu'un exercice de la reprise ou d'après est validé — chaque
// bien porte alors une dotation validée et ne se modifie plus (`garder_bien_valide`) : un point que rien ne lève resterait pour
// toujours. L'appelant le tait aussi sur une lecture partielle du registre, des natures ou de la reprise.
//
// PLUS TARD, PAS ICI (IMMO-Q1) : une colonne « amortissement antérieur » au registre, si la répétition générale montre des
// écarts de plus de quelques euros — une migration.

/** En dessous d'un euro, un écart est l'arrondi d'un autre logiciel. */
export const SEUIL_ECART_REPRISE_CENTIMES = 100

export interface EcartDeLaReprise {
  /** Le compte d'amortissement, tel que l'application l'écrit. */
  compte: string
  /** Le cumul des biens du registre rangés sous ce compte, au 31 décembre qui précède l'ouverture. */
  registreCentimes: number
  /** Le solde créditeur de ce compte dans la balance reprise. */
  repriseCentimes: number
  /** Le registre moins la reprise. */
  ecartCentimes: number
}

export interface AmortissementRepriseSousUnAutreNumero {
  /** Le numéro lu dans la balance (28183). */
  compteReprise: string
  /** Le compte que l'application écrit (281830). */
  compte: string
  repriseCentimes: number
  /** Le cumul du registre sous le compte de l'application. */
  registreCentimes: number
}

export interface ConfrontationDesAmortissementsRepris {
  /** Le 31 décembre confronté : la veille de l'ouverture. */
  date: string
  ecarts: EcartDeLaReprise[]
  sousUnAutreNumero: AmortissementRepriseSousUnAutreNumero[]
  /** Les biens amortis à cette date dont la nature manque ou n'est pas lue : leur cumul n'est rangé sous aucun compte. */
  biensSansCompte: Immobilisation[]
}

const ajouter = (carte: Map<string, number>, cle: string, centimes: number) => carte.set(cle, (carte.get(cle) ?? 0) + centimes)

export function confronterLesAmortissementsRepris(
  immobilisations: readonly Immobilisation[],
  natures: readonly Pick<NatureImmobilisation, 'id' | 'compte_immobilisation'>[],
  reprise: readonly Pick<ANouveau, 'date' | 'compte' | 'sens' | 'montant'>[],
  // Les exercices validés : un seul, de l'année de l'ouverture ou d'après, et le point se tait.
  anneesValidees: readonly number[],
  plan: PlanComptable,
): ConfrontationDesAmortissementsRepris | null {
  if (reprise.length === 0) return null
  const ouverture = reprise.map((a) => a.date).sort()[0]
  if (anneesValidees.some((a) => a >= anneeDe(ouverture))) return null
  const date = `${anneeDe(ouverture) - 1}-12-31`
  const rang = rang360(date)

  const compteParNature = new Map(natures.map((n) => [n.id, n.compte_immobilisation]))
  const registre = new Map<string, number>()
  const biensSansCompte: Immobilisation[] = []
  for (const bien of immobilisations) {
    const cumul = Number(amortissementCumuleCentimes(bien, rang))
    if (cumul === 0) continue
    const compteDuBien = bien.nature_id ? compteParNature.get(bien.nature_id) : undefined
    if (!compteDuBien) {
      biensSansCompte.push(bien)
      continue
    }
    ajouter(registre, compteAmortissement(compteDuBien), cumul)
  }

  // La reprise : le solde créditeur de chaque compte 28, sous le numéro lu ; à part, ceux que l'application écrit sous un
  // autre numéro.
  const repriseExacte = new Map<string, number>()
  const repriseAutre = new Map<string, Map<string, number>>()
  for (const a of reprise) {
    if (!a.compte.startsWith('28')) continue
    const centimes = Math.round(a.montant * 100) * (a.sens === 'credit' ? 1 : -1)
    const ecrit = compteQueLApplicationEcrit(a.compte, plan)
    if (ecrit === null) {
      ajouter(repriseExacte, a.compte, centimes)
    } else {
      const parNumero = repriseAutre.get(ecrit) ?? new Map<string, number>()
      ajouter(parNumero, a.compte, centimes)
      repriseAutre.set(ecrit, parNumero)
    }
  }

  const comptes = [...new Set([...registre.keys(), ...repriseExacte.keys(), ...repriseAutre.keys()])].sort()
  const ecarts: EcartDeLaReprise[] = []
  const sousUnAutreNumero: AmortissementRepriseSousUnAutreNumero[] = []
  for (const compte of comptes) {
    const registreCentimes = registre.get(compte) ?? 0
    const autres = repriseAutre.get(compte)
    if (autres) {
      for (const [compteReprise, repriseCentimes] of [...autres].sort(([a], [b]) => a.localeCompare(b))) {
        sousUnAutreNumero.push({ compteReprise, compte, repriseCentimes, registreCentimes })
      }
      continue
    }
    const repriseCentimes = repriseExacte.get(compte) ?? 0
    const ecartCentimes = registreCentimes - repriseCentimes
    if (Math.abs(ecartCentimes) >= SEUIL_ECART_REPRISE_CENTIMES) ecarts.push({ compte, registreCentimes, repriseCentimes, ecartCentimes })
  }
  return { date, ecarts, sousUnAutreNumero, biensSansCompte }
}

const euros = (centimes: number) => formatMoney(centimes / 100)

/** Le détail du point des écarts : chaque compte, ses deux cumuls, l'écart ; puis ce que le cabinet y fait. */
export function detailDesEcartsDeLaReprise(c: ConfrontationDesAmortissementsRepris): string {
  const comptes = c.ecarts.map((e) =>
    `${e.compte} : registre ${euros(e.registreCentimes)}, balance reprise ${euros(e.repriseCentimes)}, écart ${euros(Math.abs(e.ecartCentimes))}`
    + ` (le registre ${e.ecartCentimes > 0 ? 'au-dessus' : 'en dessous'})`).join(' ; ')
  const sansCompte = c.biensSansCompte.length === 0 ? ''
    : ` ${c.biensSansCompte.length} bien(s) du registre sans nature : leur cumul n’est rangé sous aucun compte.`
  return `Cumuls au ${formatDate(c.date)} — ${comptes}.${sansCompte} Le registre calcule chaque dotation en 30/360 depuis la mise `
    + 'en service : corriger la valeur, les dates ou la durée d’un bien pour retrouver l’ancien tableau d’amortissement, sinon '
    + 'l’écart demeure chaque année et la case CH compte la dotation du registre.'
}

/** Le détail du point des comptes repris sous un autre numéro : les deux numéros et les deux cumuls, sans écart. */
export function detailDesAmortissementsSousUnAutreNumero(c: ConfrontationDesAmortissementsRepris): string {
  const comptes = c.sousUnAutreNumero.map((s) =>
    `${s.compteReprise} dans la balance reprise (${euros(s.repriseCentimes)}), ${s.compte} au registre (${euros(s.registreCentimes)})`).join(' ; ')
  return `Cumuls au ${formatDate(c.date)} — ${comptes}. L’application écrit les dotations sous son propre numéro : ces comptes `
    + 'ne se confrontent pas au registre, et le compte repris ne se soldera pas. Le ranger est une étape du plan comptable du dossier.'
}
