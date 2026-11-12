// Les exercices d'un dossier : leurs bornes, l'exercice d'une date, la suite proposée, leur nom, leur libellé,
// leur durée en 30/360, et les refus d'une liste d'exercices déclarés (ligne 42, lot EXD1). Module PUR : il ne
// lit ni la base ni l'horloge ; il sera le jumeau de `bornes_de_l_exercice` et `exercice_de_la_date` (EXD2),
// confronté au texte exporté — conception : docs/conceptions/42-exercices-decales.md, §§ 3 et 4.
//
// Deux régimes, une seule source :
//   - un dossier en TRÉSORERIE (BNC, 2035) suit l'année civile PAR LA LOI (CGI art. 12 et 93) : ses exercices
//     se calculent, ne se déclarent jamais (EXD-Q2 (A)), et rendent EXACTEMENT ce que l'application suppose
//     aujourd'hui — du 1er janvier au 31 décembre, nom = l'année (`exercices.test.ts` le vérifie) ;
//   - un dossier en ENGAGEMENT a des exercices DÉCLARÉS (début, fin, nature), jamais déduits du calendrier.
//
// Le nom d'un exercice est le MILLÉSIME DE SA CLÔTURE (EXD-Q1 (A)) : l'exercice clos le 30/06/2027 est « 2027 »,
// et deux exercices qui se clôturent la même année civile se refusent.
//
// Toute date est une date civile `AAAA-MM-JJ`, lue sur ses composantes, jamais par un `Date` en fuseau local
// (`lib/format.ts`). Les choix qui dépendent d'une réponse du cabinet encore ouverte (EXD-Q3, EXD-Q4) sont des
// paramètres obligatoires, sans défaut (`ChoixDesExercices`).

import { rang360 } from './amortissements'
import { ajouterJours, ajouterMois, anneeDe, formatDate, jourDe, moisDe } from './format'
import type { ModeComptable } from './types'

/** `civil` : l'exercice d'un dossier en trésorerie, calculé ; les trois autres se déclarent (la table d'EXD2). */
export type NatureExercice = 'civil' | 'premier' | 'ordinaire' | 'transition'
export type NatureDeclaree = Exclude<NatureExercice, 'civil'>

export interface Exercice {
  debut: string
  fin: string
  nature: NatureExercice
}

/** Une ligne de la future table `exercices` (§ 4.1), réduite à ce qui se juge. */
export interface ExerciceDeclare {
  debut: string
  fin: string
  nature: NatureDeclaree
  /** La décision qui change la date de clôture : obligatoire pour une transition, interdite sinon. */
  decision: string | null
  decision_le: string | null
}

// LA MIGRATION `exercices_du_dossier` (lot EXD2, PRÉPARÉE le 12/11/2026, supabase/preparees/) : la table `exercices`, sa
// garde, ses fonctions de déclaration et les deux lectures dont ce module est le jumeau. Baissé tant qu'elle n'est pas dans
// l'export : le plan de sauvegarde ne lit pas une table absente (exercicesDuDossier.test.ts, sauvegardeExercices.test.ts).
export const EXERCICES_DECALES_PREVUS: boolean = false
export const TABLES_DES_EXERCICES = ['exercices'] as const

/**
 * Le régime d'un dossier, tel que la base le lit (`bornes_de_l_exercice`, `exercice_de_la_date`) : en trésorerie rien ne
 * se lit ; en engagement la liste déclarée, et la fin du dernier exercice validé (`frontiere_validation`, nulle sans
 * validation). Un dossier en engagement qui n'a RIEN déclaré suit l'année civile, exactement comme aujourd'hui ; dès qu'il
 * déclare, ses exercices sont les déclarés, précédés des années civiles que ses validations ont figées (la garde fait
 * commencer le premier déclaré le lendemain de la dernière d'entre elles).
 */
export type RegimeDesExercices =
  | { mode: 'tresorerie' }
  | { mode: 'engagement'; exercices: readonly ExerciceDeclare[]; finDuDernierValide: string | null }

/**
 * Les choix que le cabinet n'a pas encore tranchés. Aucun défaut : l'appelant les nomme.
 * - EXD-Q3 : jusqu'où va le premier exercice — (A) au 31 décembre de l'année qui suit son début (la tolérance du
 *   BOFiP pour une entreprise nouvelle, BOI-BIC-BASE-10-10), (B) vingt-quatre mois au plus.
 * - EXD-Q4 : la durée d'un exercice de transition — (A) d'un jour à vingt-trois mois, (B) douze mois au plus ; la
 *   décision datée est exigée dans les deux cas.
 */
export interface ChoixDesExercices {
  premierExercice: 'jusqu-au-31-decembre-de-l-annee-suivante' | 'vingt-quatre-mois-au-plus'
  transition: 'un-jour-a-vingt-trois-mois' | 'douze-mois-au-plus'
}

/** Les recommandations de la conception (EXD-Q3 (A), EXD-Q4 (A)), NON TRANCHÉES : un nom, pas un défaut. */
export const CHOIX_RECOMMANDES: Readonly<ChoixDesExercices> = {
  premierExercice: 'jusqu-au-31-decembre-de-l-annee-suivante',
  transition: 'un-jour-a-vingt-trois-mois',
}

export type CodeDeRefus =
  | 'date-invalide'
  | 'fin-avant-debut'
  | 'tresorerie-non-civile'
  | 'tresorerie-se-calcule'
  | 'nature-inconnue'
  | 'premier-trop-long'
  | 'premier-hors-de-tete'
  | 'ordinaire-pas-douze-mois'
  | 'transition-trop-longue'
  | 'transition-sans-decision'
  | 'decision-hors-transition'
  | 'chevauchement'
  | 'trou'
  | 'meme-millesime'

export interface RefusDExercice {
  code: CodeDeRefus
  message: string
}

// ── Les dates civiles ─────────────────────────────────────────────────────────────────────────────────────

const FORME_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// L'arithmétique de `format.ts` passe par `Date.UTC`, qui lit une année de 0 à 99 comme 1900 à 1999 : les
// années hors de 1000 à 9999 se refusent ici plutôt que de se calculer de travers.
const ANNEE_MIN = 1000
const ANNEE_MAX = 9999

function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
}

function joursDuMois(annee: number, mois: number): number {
  if (mois === 2) return estBissextile(annee) ? 29 : 28
  return [4, 6, 9, 11].includes(mois) ? 30 : 31
}

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe (le 30 février non, le 29 février d'une année bissextile oui). */
export function estDateCivile(valeur: string): boolean {
  const m = FORME_DATE.exec(valeur)
  if (!m) return false
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (annee < ANNEE_MIN || annee > ANNEE_MAX) return false
  if (mois < 1 || mois > 12) return false
  return jour >= 1 && jour <= joursDuMois(annee, mois)
}

const veille = (date: string) => ajouterJours(date, -1)
const lendemain = (date: string) => ajouterJours(date, 1)
const estFinDeMois = (date: string) => jourDe(date) === joursDuMois(anneeDe(date), moisDe(date))
const jjmm = (date: string) => formatDate(date).slice(0, 5)
const bornes = (ex: Pick<Exercice, 'debut' | 'fin'>) => `du ${formatDate(ex.debut)} au ${formatDate(ex.fin)}`

// ── Le régime civil ───────────────────────────────────────────────────────────────────────────────────────

/** L'exercice civil d'une année : du 1er janvier au 31 décembre — ce que l'application suppose aujourd'hui. */
export function exerciceCivil(annee: number): Exercice {
  if (!Number.isInteger(annee) || annee < ANNEE_MIN || annee > ANNEE_MAX) {
    throw new RangeError(`Année d'exercice hors du calendrier lu par l'application : ${annee}.`)
  }
  return { debut: `${annee}-01-01`, fin: `${annee}-12-31`, nature: 'civil' }
}

/** Vrai quand les bornes sont celles d'une année civile entière, quelle que soit la nature déclarée. */
export function couvreUneAnneeCivile(ex: Pick<Exercice, 'debut' | 'fin'>): boolean {
  return ex.debut.endsWith('-01-01') && ex.fin === `${ex.debut.slice(0, 4)}-12-31`
}

// ── Le nom, le libellé, la durée ──────────────────────────────────────────────────────────────────────────

/** Le nom d'un exercice : le millésime de sa clôture (EXD-Q1 (A)). */
export function millesimeDe(ex: Pick<Exercice, 'fin'>): number {
  return anneeDe(ex.fin)
}

/**
 * Le libellé court (EXD-Q7 (A)) : « 2027 » pour une année civile entière, « 2027 (clos le 30/06) » sinon — un
 * premier exercice du 15/03 au 31/12 compris, puisque ses bornes ne sont pas celles d'une année.
 */
export function libelleDeLExercice(ex: Pick<Exercice, 'debut' | 'fin'>): string {
  const millesime = String(millesimeDe(ex))
  return couvreUneAnneeCivile(ex) ? millesime : `${millesime} (clos le ${jjmm(ex.fin)})`
}

/** Le libellé des états (EXD-Q7 (A)) : « du 01/07/2026 au 30/06/2027 ». */
export function libelleDesBornes(ex: Pick<Exercice, 'debut' | 'fin'>): string {
  return bornes(ex)
}

/**
 * La durée d'un exercice en jours 30/360 (EXD-Q5 (A)), sur la convention de `rang_360` en base : l'écart des
 * rangs de sa fin et de la VEILLE de son début, comme une dotation est l'écart de deux cumuls de clôture. Une
 * année civile vaut 360, dix-huit mois 540. La convention de la base saute le 29 et le 30 février : un exercice
 * de douze mois clos fin février vaut 359, 360 ou 361 selon les années bissextiles qu'il touche (la somme des
 * exercices successifs reste exacte).
 */
export function joursEn360(ex: Pick<Exercice, 'debut' | 'fin'>): number {
  return rang360(ex.fin) - rang360(veille(ex.debut))
}

// ── Les bornes d'un millésime, l'exercice d'une date, la suite proposée ───────────────────────────────────

const enExercice = (d: ExerciceDeclare): Exercice => ({ debut: d.debut, fin: d.fin, nature: d.nature })

/**
 * Les bornes de l'exercice d'un millésime — le jumeau de `bornes_de_l_exercice` : civiles en trésorerie, lues
 * dans la liste déclarée en engagement ; `null` si aucun exercice déclaré ne se clôt cette année-là.
 */
export function exerciceDuMillesime(regime: RegimeDesExercices, annee: number): Exercice | null {
  // L'année civile : la trésorerie, ou l'engagement qui n'a rien déclaré.
  if (regime.mode === 'tresorerie' || regime.exercices.length === 0) return exerciceCivil(annee)
  const trouves = regime.exercices.filter((e) => millesimeDe(e) === annee)
  if (trouves.length === 1) return enExercice(trouves[0])
  // Une année civile que les validations ont figée, quand aucun exercice déclaré ne s'y clôt.
  const fige = trouves.length === 0 && regime.finDuDernierValide !== null && annee <= anneeDe(regime.finDuDernierValide)
  return fige ? exerciceCivil(annee) : null
}

export type ExerciceDUneDate =
  | { statut: 'dans'; exercice: Exercice }
  | { statut: 'hors'; motif: string }

/**
 * L'exercice d'une date — le jumeau de `exercice_de_la_date` : l'UNIQUE exercice qui la contient, ou « hors des
 * exercices déclarés » (une date que deux exercices contiennent est hors, elle aussi : la liste est fautive).
 */
export function exerciceDeLaDate(regime: RegimeDesExercices, date: string): ExerciceDUneDate {
  if (!estDateCivile(date)) return { statut: 'hors', motif: `La date « ${date} » n'existe pas au calendrier.` }
  if (regime.mode === 'tresorerie' || regime.exercices.length === 0) {
    return { statut: 'dans', exercice: exerciceCivil(anneeDe(date)) }
  }
  const contenants = regime.exercices.filter((e) => e.debut <= date && date <= e.fin)
  if (contenants.length === 1) return { statut: 'dans', exercice: enExercice(contenants[0]) }
  if (contenants.length > 1) {
    return {
      statut: 'hors',
      motif: `Le ${formatDate(date)} appartient à plusieurs exercices déclarés, qui se chevauchent : la liste est à corriger.`,
    }
  }
  // Une date que les validations ont figée, hors des exercices déclarés : son année civile.
  if (regime.finDuDernierValide !== null && date <= regime.finDuDernierValide) {
    return { statut: 'dans', exercice: exerciceCivil(anneeDe(date)) }
  }
  const connus = [...regime.exercices].sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0))
  const etendue = `les exercices déclarés vont du ${formatDate(connus[0].debut)} au ${formatDate(connus[connus.length - 1].fin)}`
  return { statut: 'hors', motif: `Le ${formatDate(date)} est hors des exercices déclarés : ${etendue}.` }
}

/**
 * L'exercice proposé après un autre : il commence le lendemain de sa clôture et se clôt à la même date l'année
 * suivante (un 29 février devient le 28) — un exercice civil est suivi du civil, tout autre d'un ordinaire. Une
 * proposition : le clic du cabinet le déclare (§ 3.1).
 */
export function exerciceSuivantPropose(ex: Exercice): Exercice {
  if (ex.nature === 'civil') return exerciceCivil(anneeDe(ex.fin) + 1)
  return { debut: lendemain(ex.fin), fin: ajouterMois(ex.fin, 12), nature: 'ordinaire' }
}

// ── Les refus ─────────────────────────────────────────────────────────────────────────────────────────────

// Un ordinaire dure douze mois : sa clôture est celle de l'exercice précédent un an plus tard (la veille de son
// début + douze mois), ou, quand cette veille est une fin de mois, la fin du même mois un an plus tard — une
// clôture « fin février » tombe le 28 ou le 29 selon l'année.
function dureDouzeMois(debut: string, fin: string): boolean {
  const cloturePrecedente = veille(debut)
  if (fin === ajouterMois(cloturePrecedente, 12)) return true
  return estFinDeMois(cloturePrecedente) && estFinDeMois(fin)
    && fin.slice(0, 7) === ajouterMois(cloturePrecedente, 12).slice(0, 7)
}

const NATURES_DECLAREES: readonly string[] = ['premier', 'ordinaire', 'transition']

/** Les refus d'un exercice déclaré pris seul : ses dates, sa nature, sa durée, sa décision. */
export function refusDUnExercice(ex: ExerciceDeclare, choix: ChoixDesExercices): RefusDExercice[] {
  const refus: RefusDExercice[] = []
  for (const [nom, valeur] of [['début', ex.debut], ['fin', ex.fin]] as const) {
    if (!estDateCivile(valeur)) {
      refus.push({ code: 'date-invalide', message: `La date de ${nom} « ${valeur} » n'existe pas au calendrier.` })
    }
  }
  if (refus.length > 0) return refus
  if (ex.fin < ex.debut) {
    return [{ code: 'fin-avant-debut', message: `L'exercice se clôt le ${formatDate(ex.fin)}, avant son début, le ${formatDate(ex.debut)}.` }]
  }
  if (!NATURES_DECLAREES.includes(ex.nature)) {
    return [{ code: 'nature-inconnue', message: `Un exercice déclaré est un premier exercice, un exercice ordinaire ou un exercice de transition (« ${String(ex.nature)} » ne l'est pas).` }]
  }

  if (ex.nature === 'premier') {
    const limite = choix.premierExercice === 'jusqu-au-31-decembre-de-l-annee-suivante'
      ? `${anneeDe(ex.debut) + 1}-12-31`
      : veille(ajouterMois(ex.debut, 24))
    if (ex.fin > limite) {
      const regle = choix.premierExercice === 'jusqu-au-31-decembre-de-l-annee-suivante'
        ? `au plus tard le 31 décembre de l'année qui suit son début, soit le ${formatDate(limite)}`
        : `au plus tard vingt-quatre mois après son début, soit le ${formatDate(limite)}`
      refus.push({ code: 'premier-trop-long', message: `Le premier exercice (${bornes(ex)}) se clôt ${regle}.` })
    }
  }

  if (ex.nature === 'ordinaire' && !dureDouzeMois(ex.debut, ex.fin)) {
    refus.push({
      code: 'ordinaire-pas-douze-mois',
      message: `Un exercice ordinaire dure douze mois : commencé le ${formatDate(ex.debut)}, il se clôt le ${formatDate(ajouterMois(veille(ex.debut), 12))}. Un exercice d'une autre durée est un premier exercice ou un exercice de transition.`,
    })
  }

  if (ex.nature === 'transition') {
    const mois = choix.transition === 'un-jour-a-vingt-trois-mois' ? 23 : 12
    const limite = veille(ajouterMois(ex.debut, mois))
    if (ex.fin > limite) {
      refus.push({
        code: 'transition-trop-longue',
        message: `Un exercice de transition dure ${mois === 23 ? "d'un jour à vingt-trois mois" : 'douze mois au plus'} : commencé le ${formatDate(ex.debut)}, il se clôt au plus tard le ${formatDate(limite)}.`,
      })
    }
    const decisionDite = ex.decision !== null && ex.decision.trim() !== ''
    const decisionDatee = ex.decision_le !== null && estDateCivile(ex.decision_le)
    if (!decisionDite || !decisionDatee) {
      refus.push({
        code: 'transition-sans-decision',
        message: 'Un exercice de transition cite la décision qui change la date de clôture (l\'assemblée qui modifie les statuts, ou celle de l\'exploitant) et sa date.',
      })
    }
  } else if (ex.decision !== null || ex.decision_le !== null) {
    refus.push({
      code: 'decision-hors-transition',
      message: 'Seul un exercice de transition cite une décision de changement de la date de clôture.',
    })
  }
  return refus
}

/**
 * Les refus d'une liste d'exercices d'un dossier : vide quand elle est recevable. En trésorerie, toute ligne se
 * refuse (EXD-Q2 (A)) ; en engagement, chaque exercice est jugé seul, puis la suite : ni chevauchement ni trou,
 * un seul exercice clos par année civile (EXD-Q1 (A)), un premier exercice en tête seulement.
 */
export function refusDesExercices(
  mode: ModeComptable,
  exercices: readonly ExerciceDeclare[],
  choix: ChoixDesExercices,
): RefusDExercice[] {
  if (mode === 'tresorerie') {
    return exercices.map((ex) => (
      estDateCivile(ex.debut) && estDateCivile(ex.fin) && couvreUneAnneeCivile(ex)
        ? {
          code: 'tresorerie-se-calcule' as const,
          message: `Un dossier en trésorerie suit l'année civile par la loi (CGI art. 12 et 93) : l'exercice ${anneeDe(ex.fin)} se calcule, il ne se déclare pas.`,
        }
        : {
          code: 'tresorerie-non-civile' as const,
          message: `Un dossier en trésorerie (BNC, 2035) suit l'année civile, du 1er janvier au 31 décembre : un exercice ${bornes(ex)} ne s'y déclare pas.`,
        }
    ))
  }

  const refus = exercices.flatMap((ex) => refusDUnExercice(ex, choix))
  // La suite ne se juge que sur des dates lisibles : une date fausse a déjà son refus.
  const lisibles = exercices.filter((ex) => estDateCivile(ex.debut) && estDateCivile(ex.fin) && ex.debut <= ex.fin)
  const ordonnes = [...lisibles].sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : a.fin < b.fin ? -1 : a.fin > b.fin ? 1 : 0))

  ordonnes.forEach((ex, i) => {
    if (ex.nature === 'premier' && i > 0) {
      refus.push({
        code: 'premier-hors-de-tete',
        message: `L'exercice ${bornes(ex)} est déclaré premier exercice alors qu'un exercice le précède (${bornes(ordonnes[i - 1])}).`,
      })
    }
  })

  for (let i = 1; i < ordonnes.length; i++) {
    const avant = ordonnes[i - 1]
    const apres = ordonnes[i]
    if (apres.debut <= avant.fin) {
      refus.push({
        code: 'chevauchement',
        message: `Les exercices ${bornes(avant)} et ${bornes(apres)} se chevauchent : un jour n'appartient qu'à un exercice.`,
      })
    } else if (apres.debut !== lendemain(avant.fin)) {
      refus.push({
        code: 'trou',
        message: `Entre l'exercice ${bornes(avant)} et l'exercice ${bornes(apres)}, les jours du ${formatDate(lendemain(avant.fin))} au ${formatDate(veille(apres.debut))} n'appartiennent à aucun exercice.`,
      })
    }
  }

  const parMillesime = new Map<number, ExerciceDeclare[]>()
  for (const ex of lisibles) parMillesime.set(millesimeDe(ex), [...(parMillesime.get(millesimeDe(ex)) ?? []), ex])
  for (const [millesime, memes] of [...parMillesime].sort(([a], [b]) => a - b)) {
    if (memes.length < 2) continue
    refus.push({
      code: 'meme-millesime',
      message: `${memes.length} exercices se clôturent en ${millesime} (${memes.map(bornes).join(' ; ')}) : un exercice porte le nom de l'année de sa clôture, deux ne peuvent pas porter le même. Une transition qui avance la clôture dans l'année s'allonge jusqu'à la nouvelle date de l'année suivante.`,
    })
  }
  return refus
}
