// LA RÉGULARISATION DES COTISATIONS D'UN PRATICIEN BNC (ligne 27, TNS-Q2), PRÉPARÉE le 07/11/2026, tranchée par le cabinet
// le même jour (TNS-Q2 : « appliquez-la » ; TNS-Q2-B : (B), une colonne pour la part). La migration
// `regularisation_des_cotisations` (supabase/preparees/20261107170000_regularisation_des_cotisations.sql) pose quatre
// colonnes de `cotisations_declarees` : l'organisme qui appelle, l'année payée, la nature, et la part de l'appel qui
// régularise l'année d'avant. Elle n'est PAS appliquée : `REGULARISATION_DES_COTISATIONS_EXPORTEE` reste baissé, l'onglet
// Cotisations ne les montre ni ne les écrit, et la carte du volet social n'estime rien.
//
// LA RÈGLE (code de la sécurité sociale, art. L. 131-6-2) : les cotisations d'un indépendant sont dues annuellement,
// calculées « à titre provisionnel » sur le revenu d'une année antérieure, puis régularisées quand le revenu de l'année au
// titre de laquelle elles sont dues est définitivement connu. La régularisation ESTIMÉE de l'année N est donc :
//   les cotisations définitives estimées sur le revenu réel de N — celles de `estimerCotisationsUrssaf`
//   (lib/voletSocialPamc.ts), le calcul éprouvé contre le moteur de l'Urssaf, jamais recopié ici ; l'Urssaf seule, la
//   retraite étant appelée par la caisse ;
//   moins ce que l'Urssaf a appelé AU TITRE DE N : les échéances décrites « Urssaf, N, provisionnelle » et
//   « Urssaf, N, acompte » (un acompte à valoir sur N paie N comme une provisionnelle ; l'omettre gonflerait la
//   régularisation), leur montant APPELÉ moins la part qui régularise N − 1 (`part_regularisation`, signée : un complément
//   de N − 1 compris dans l'appel s'en retire, un trop-versé de N − 1 imputé sur lui s'y rajoute — reste la provisionnelle
//   de N que l'échéance paie) ;
//   due (positive) ou remboursée (négative) en N + 1, l'année où l'Urssaf la calcule, après la déclaration du revenu de N.
// Une échéance de N qui paie la régularisation de N − 1 n'y entre pas : c'est ce qu'une soustraction des échéances de
// l'année aurait compté à tort.
//
// CE QU'ELLE NE SAIT PAS, ELLE LE DIT, sans rien deviner — et alors elle ne rend AUCUN chiffre :
//   - le revenu de N n'est pas arrêté tant que l'année n'est pas finie (ni ses appels : l'Urssaf ajuste les provisionnelles
//     de N après la déclaration du revenu de N − 1) ;
//   - les cotisations définitives ne s'estiment pas (le motif du moteur : profession, plafond, relevé SNIR…) ;
//   - une échéance qui POURRAIT payer N à l'Urssaf ne dit pas tout ce qu'il faut pour en juger : dite de l'année N, ou,
//     sans année dite, d'une date que la base laisserait payer N — de N − 1 (un appel de décembre ouvre l'année suivante)
//     à N + 5 (la régularisation de N, appelée en N + 1, ou reportée par un échéancier), sous les bornes de
//     `cotisations_declarees_annee_payee_bornes`, une régularisation jamais avant son année —, sans organisme, ou de
//     l'Urssaf sans son année ou sa nature. Une échéance d'une caisse de retraite, elle, se juge à son seul organisme ;
//     une échéance que ces bornes écartent de N ne se lit pas ;
//   - un appel manque : aucune provisionnelle ni aucun acompte de l'Urssaf pour N, ou l'un d'eux encore « prévisionnel »
//     (l'estimation du cabinet d'un appel à venir — rien à voir avec une provisionnelle, que l'Urssaf appelle).
// Et ce qu'elle sait mais qui peut bouger se dit À CÔTÉ du chiffre : une 2035 de N pas encore validée (l'estimation suit
// ses chiffres du jour), la régularisation de N déjà saisie comme appelée (le montant de l'Urssaf l'emporte).
//
// UN PRÉLÈVEMENT QUI PAIE À LA FOIS UNE PROVISIONNELLE ET LA RÉGULARISATION DE L'ANNÉE D'AVANT (TNS-Q2-B, le choix (B) du
// cabinet) : UNE échéance, décrite « provisionnelle » (ou « acompte ») de son année, qui porte la part de son appel qui
// régularise N − 1 — le relevé la rapproche d'un seul tenant. Cette part compte dans la régularisation de N − 1 (« déjà
// appelée », à côté du chiffre de N − 1 : l'avis de l'Urssaf l'emporte) et se retire de la provisionnelle de N. Elle se
// borne comme en base : dite d'une provisionnelle ou d'un acompte et de son année, jamais zéro, jamais plus que l'appelé
// en valeur absolue — un crédit plus fort que l'appel se dit comme hier, l'appelé de la provisionnelle et le versé payé.
// « Réunir » (lib/gestesDesEcheances.ts) garde la somme des parts quand les deux disent la même nature et la même année ;
// sinon la réunie, mêlée, perd sa part avec sa description, et la confirmation le nomme.

import { anneeDe, formatDate, formatMoney } from './format'
import type { ResultatEstimation } from './voletSocialPamc'
import type { CotisationDeclaree, NatureCotisation, OrganismeCotisation } from './types'

/** La migration `regularisation_des_cotisations` est-elle en base ? Baissé : rien des trois colonnes ne se lit ni ne s'écrit. */
export const REGULARISATION_DES_COTISATIONS_EXPORTEE = false

/** La liste fermée de la base (`cotisations_declarees_organisme_liste`), dans son ordre. */
export const ORGANISMES: readonly OrganismeCotisation[] = [
  'urssaf', 'carmf', 'carcdsf', 'carpimko', 'cavp', 'carpv', 'cavec', 'cavom', 'cavamac', 'cipav', 'cprn', 'cnbf',
]

export const LIBELLES_ORGANISME: Readonly<Record<OrganismeCotisation, string>> = {
  urssaf: 'Urssaf',
  carmf: 'CARMF (médecins)',
  carcdsf: 'CARCDSF (chirurgiens-dentistes, sages-femmes)',
  carpimko: 'CARPIMKO (auxiliaires médicaux)',
  cavp: 'CAVP (pharmaciens)',
  carpv: 'CARPV (vétérinaires)',
  cavec: 'CAVEC (experts-comptables, commissaires aux comptes)',
  cavom: 'CAVOM (officiers ministériels)',
  cavamac: 'CAVAMAC (agents généraux d’assurance)',
  cipav: 'CIPAV',
  cprn: 'CPRN (notaires)',
  cnbf: 'CNBF (avocats)',
}

/** La liste fermée de la base (`cotisations_declarees_nature_liste`). */
export const NATURES: readonly NatureCotisation[] = ['provisionnelle', 'regularisation', 'acompte']

export const LIBELLES_NATURE: Readonly<Record<NatureCotisation, string>> = {
  provisionnelle: 'Provisionnelle (calculée sur un revenu antérieur)',
  regularisation: 'Régularisation (sur le revenu réel de son année)',
  acompte: 'Acompte à valoir sur l’année',
}

// ── La saisie des trois champs ─────────────────────────────────────────────────────────────────

/** Les quatre champs tels que tapés ; le vide : « non dit ». */
export interface SaisieDeLaDescription {
  organisme: string
  annee: string
  nature: string
  // La part de l'appel qui régularise l'année d'avant (TNS-Q2-B), signée, au centime ; vide : aucune.
  part: string
}

export type DescriptionDeLEcheance = Pick<CotisationDeclaree, 'organisme' | 'annee_payee' | 'nature' | 'part_regularisation'>

/** La saisie pré-remplie d'une échéance : une colonne absente de la lecture (la migration pas appliquée) se dit vide. */
export function saisieDeLaDescription(c: Partial<DescriptionDeLEcheance>): SaisieDeLaDescription {
  return {
    organisme: c.organisme ?? '', annee: c.annee_payee == null ? '' : String(c.annee_payee), nature: c.nature ?? '',
    part: c.part_regularisation == null ? '' : String(c.part_regularisation),
  }
}

/** Les natures qui portent une part (`cotisations_declarees_part_regularisation_nature`). */
export const NATURES_A_PART: readonly NatureCotisation[] = ['provisionnelle', 'acompte']

/**
 * Les années qu'une échéance de cette date peut payer, sous les bornes de la base (`cotisations_declarees_annee_payee_bornes`) :
 * de cinq ans avant l'année de son échéance à un an après. Une régularisation ne va pas au-delà de l'année de son échéance
 * (`cotisations_declarees_regularisation_apres_son_annee`).
 */
export function anneesPayables(echeance: string, nature: NatureCotisation | null = null): { de: number; a: number } {
  const an = anneeDe(echeance)
  return { de: an - 5, a: nature === 'regularisation' ? an : an + 1 }
}

const estOrganisme = (v: string): v is OrganismeCotisation => (ORGANISMES as readonly string[]).includes(v)
const estNature = (v: string): v is NatureCotisation => (NATURES as readonly string[]).includes(v)

/**
 * Les quatre champs lus, ou ce que la base refuserait, sous la règle de ses six contraintes : un organisme et une nature
 * de leur liste, une année payée de cinq ans avant l'année de l'échéance à un an après, une régularisation jamais d'une
 * année postérieure à son échéance ; la part (TNS-Q2-B), dite d'une provisionnelle ou d'un acompte et de son année, jamais
 * zéro, jamais plus que le montant appelé en valeur absolue. Les trois premiers peuvent rester vides : rien ne les exige
 * ensemble. Le montant appelé est celui que la saisie porte (nul : illisible, et la borne attend la saisie, qui se refuse
 * d'elle-même plus haut).
 */
export function lireLaDescription(
  s: SaisieDeLaDescription, echeance: string, montantAppele: number | null,
): { valeurs: Required<DescriptionDeLEcheance> } | { refus: string } {
  const organisme = s.organisme.trim()
  const nature = s.nature.trim()
  const annee = s.annee.trim()
  if (organisme !== '' && !estOrganisme(organisme)) return { refus: 'L’organisme n’est pas de la liste.' }
  if (nature !== '' && !estNature(nature)) return { refus: 'La nature n’est pas de la liste.' }
  let anneePayee: number | null = null
  if (annee !== '') {
    if (!/^\d{4}$/.test(annee)) return { refus: 'L’année payée s’écrit en quatre chiffres.' }
    anneePayee = Number(annee)
    // Sans date d'échéance lisible, les bornes attendent : la date se refuse d'elle-même, plus haut dans la saisie.
    const an = /^\d{4}-\d{2}-\d{2}$/.test(echeance) ? anneeDe(echeance) : null
    const bornes = an === null ? null : anneesPayables(echeance)
    if (an !== null && bornes !== null && (anneePayee < bornes.de || anneePayee > bornes.a)) {
      return { refus: `L’année payée d’une échéance de ${an} va de ${bornes.de} à ${bornes.a}.` }
    }
    if (an !== null && nature === 'regularisation' && anneePayee > anneesPayables(echeance, 'regularisation').a) {
      return { refus: `Une régularisation de ${anneePayee} ne s’appelle pas en ${an} : elle suit son année.` }
    }
  }
  const part = lireLaPart(s.part, nature === '' ? null : (nature as NatureCotisation), anneePayee, montantAppele)
  if ('refus' in part) return part
  return {
    valeurs: {
      organisme: organisme === '' ? null : (organisme as OrganismeCotisation),
      annee_payee: anneePayee,
      nature: nature === '' ? null : (nature as NatureCotisation),
      part_regularisation: part.valeur,
    },
  }
}

// La part tapée, sous les deux contraintes de la base (`cotisations_declarees_part_regularisation_nature` et
// `…_bornee`) : vide, aucune ; sinon un montant signé au centime, la virgule admise, jamais arrondi en silence.
function lireLaPart(
  texte: string, nature: NatureCotisation | null, anneePayee: number | null, montantAppele: number | null,
): { valeur: number | null } | { refus: string } {
  const t = texte.trim().replace(',', '.')
  if (t === '') return { valeur: null }
  if (!MONTANT_SIGNE.test(t) || !Number.isFinite(Number(t))) return { refus: 'La part de régularisation n’est pas un montant.' }
  const part = Number(t)
  if (Math.abs(part * 100 - Math.round(part * 100)) >= 1e-6) return { refus: 'La part de régularisation n’est pas au centime.' }
  if (centimes(part) === 0) return { refus: 'Une part de régularisation de zéro ne se dit pas : laisse le champ vide.' }
  if (nature === null || !NATURES_A_PART.includes(nature)) {
    return { refus: 'La part de régularisation ne se dit que d’une provisionnelle ou d’un acompte : choisis sa nature.' }
  }
  if (anneePayee === null) {
    return { refus: 'La part de régularisation régularise l’année d’avant l’année payée : dis l’année payée.' }
  }
  if (montantAppele !== null && Math.abs(centimes(part)) > Math.abs(centimes(montantAppele))) {
    return {
      refus: part > 0
        ? `La part de régularisation (${formatMoney(part)}) dépasse le montant appelé (${formatMoney(Math.abs(montantAppele))}) : elle n’en est qu’une part.`
        : `Le trop-versé imputé (${formatMoney(-part)}) dépasse le montant appelé (${formatMoney(Math.abs(montantAppele))}) : un crédit plus fort que l’appel se dit par le versé — l’appelé de la provisionnelle, et le versé de ce que le prélèvement a payé.`,
    }
  }
  return { valeur: part }
}

/** La description d'une échéance en mots, ou « non décrite ». */
export function descriptionDite(c: Partial<DescriptionDeLEcheance>): string {
  const morceaux = [
    c.organisme ? LIBELLES_ORGANISME[c.organisme].split(' (')[0] : null,
    c.nature ? { provisionnelle: 'provisionnelle', regularisation: 'régularisation', acompte: 'acompte' }[c.nature] : null,
    c.annee_payee != null ? String(c.annee_payee) : null,
    c.part_regularisation != null ? partDite(c.part_regularisation, c.annee_payee ?? null) : null,
  ].filter((m): m is string => m !== null)
  return morceaux.length === 0 ? 'non décrite' : morceaux.join(', ')
}

/** La part dite en mots : un complément compris dans l'appel, ou un trop-versé imputé sur lui. */
export function partDite(part: number, anneePayee: number | null): string {
  const annee = anneePayee === null ? 'l’année d’avant' : String(anneePayee - 1)
  return part > 0
    ? `dont ${formatMoney(part)} de régularisation de ${annee}`
    : `après ${formatMoney(-part)} de trop-versé de ${annee} imputé`
}

// ── L'estimation ───────────────────────────────────────────────────────────────────────────────

export interface EntreeRegularisation {
  annee: number
  /** Le résultat de `estimerCotisationsUrssaf` pour N, tel que la carte du volet social le calcule. */
  definitives: ResultatEstimation
  /** Les échéances du dossier, LUES EN ENTIER (toutes années) : sur une lecture partielle, l'écran n'appelle pas. */
  echeances: readonly CotisationDeclaree[]
  /** L'exercice N est-il validé (sa 2035 figée) ? */
  exerciceValide: boolean
  /** Le jour civil de Paris, « AAAA-MM-JJ » : jamais lu ici. */
  aujourdhui: string
}

export type RegularisationEstimee =
  | {
    etat: 'estimee'
    annee: number
    definitives: number
    /** Ce que l'Urssaf a appelé au titre de N : provisionnelles et acomptes, leurs parts de régularisation de N − 1 retirées. */
    appelees: number
    /** La somme signée de ces parts, retirées de l'appelé (positive : des compléments de N − 1 ; négative : des trop-versés imputés). */
    partsDeLAnneeDAvant: number
    /** Les échéances comptées, dans l'ordre de leurs dates. */
    comptees: CotisationDeclaree[]
    /** Définitives − appelées : positive, due ; négative, remboursée. */
    regularisation: number
    sens: 'due' | 'remboursee' | 'nulle'
    payableEn: number
    /**
     * La régularisation de N déjà saisie comme appelée par l'Urssaf — ses échéances « régularisation » de N, et la part de
     * N que portent ses prélèvements de N + 1 —, signée ; nul : rien de saisi.
     */
    dejaAppelee: number | null
    reserves: string[]
  }
  | { etat: 'inconnue'; annee: number; manques: string[] }

const centimes = (n: number) => Math.round(n * 100)
const MONTANT_SIGNE = /^-?[0-9]+([.][0-9]+)?$/
const decrite = (c: CotisationDeclaree) => c.organisme != null && c.annee_payee != null && c.nature != null
// La provisionnelle de son année qu'une échéance paie : son appelé, moins la part qui régularise l'année d'avant.
const provisionnelleEnCentimes = (c: CotisationDeclaree) => centimes(c.montant_appele) - centimes(c.part_regularisation ?? 0)
const parOrdre = (a: CotisationDeclaree, b: CotisationDeclaree) =>
  a.echeance < b.echeance ? -1 : a.echeance > b.echeance ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/**
 * Une échéance qui pourrait payer N à l'Urssaf, d'aucun autre organisme connu : dite de N, ou, sans année dite, d'une date
 * dont la base admettrait qu'elle paie N (`anneesPayables`) — jamais seulement datée de N : la régularisation de N se paie
 * en N + 1, et un appel de décembre N − 1 peut ouvrir N.
 */
function pourraitPayerNALUrssaf(c: CotisationDeclaree, annee: number): boolean {
  if (c.organisme != null && c.organisme !== 'urssaf') return false
  if (c.annee_payee != null) return c.annee_payee === annee
  const { de, a } = anneesPayables(c.echeance, c.nature)
  return annee >= de && annee <= a
}

export function estimerLaRegularisation(e: EntreeRegularisation): RegularisationEstimee {
  const { annee } = e
  const manques: string[] = []
  if (e.aujourdhui <= `${annee}-12-31`) {
    manques.push(`L’année ${annee} n’est pas finie : ni son revenu ni les appels de l’Urssaf pour ${annee} ne sont arrêtés.`)
  }
  if (!e.definitives.disponible) manques.push(`Les cotisations définitives ne s’estiment pas : ${e.definitives.motif}`)

  const candidates = e.echeances.filter((c) => pourraitPayerNALUrssaf(c, annee)).sort(parOrdre)
  for (const c of candidates.filter((x) => !decrite(x))) {
    manques.push(
      `L’échéance du ${formatDate(c.echeance)} (${formatMoney(c.montant_appele)}) ne dit pas `
      + (c.organisme == null ? 'qui l’appelle' : c.annee_payee == null ? 'l’année qu’elle paie' : 'sa nature')
      + ' : décris-la dans l’onglet Cotisations.',
    )
  }
  const comptees = candidates.filter((c) => decrite(c) && c.nature !== 'regularisation')
  if (comptees.length === 0 && candidates.every(decrite)) {
    manques.push(`Aucune provisionnelle de l’Urssaf n’est saisie pour ${annee} : l’appelé manque.`)
  }
  for (const c of comptees.filter((x) => x.previsionnel)) {
    manques.push(`L’échéance du ${formatDate(c.echeance)} est encore prévisionnelle : l’appel de l’Urssaf n’est pas là.`)
  }
  if (manques.length > 0 || !e.definitives.disponible) return { etat: 'inconnue', annee, manques }

  const definitives = e.definitives.estimation.total
  const appeleesCentimes = comptees.reduce((s, c) => s + provisionnelleEnCentimes(c), 0)
  const partsCentimes = comptees.reduce((s, c) => s + centimes(c.part_regularisation ?? 0), 0)
  const regularisationCentimes = centimes(definitives) - appeleesCentimes
  const regularisations = candidates.filter((c) => c.nature === 'regularisation' && c.annee_payee === annee)
  // La part de N que portent les prélèvements de l'Urssaf de N + 1 (TNS-Q2-B) : déjà appelée, ou déjà imputée.
  const parts = e.echeances.filter((c) => c.organisme === 'urssaf' && c.annee_payee === annee + 1 && c.part_regularisation != null
    && c.nature != null && NATURES_A_PART.includes(c.nature))
  const reserves: string[] = []
  if (!e.exerciceValide) {
    reserves.push(`La 2035 de ${annee} n’est pas validée : l’estimation suit ses chiffres d’aujourd’hui.`)
  }
  const dejaAppelee = regularisations.length === 0 && parts.length === 0
    ? null
    : (regularisations.reduce((s, c) => s + centimes(c.montant_appele), 0)
      + parts.reduce((s, c) => s + centimes(c.part_regularisation ?? 0), 0)) / 100
  if (dejaAppelee !== null) {
    reserves.push(dejaAppelee >= 0
      ? `L’Urssaf a déjà appelé ${formatMoney(dejaAppelee)} de régularisation de ${annee} : son avis l’emporte sur l’estimation.`
      : `L’Urssaf a déjà remboursé ou imputé ${formatMoney(-dejaAppelee)} de trop-versé de ${annee} : son avis l’emporte sur l’estimation.`)
  }
  return {
    etat: 'estimee',
    annee,
    definitives,
    appelees: appeleesCentimes / 100,
    partsDeLAnneeDAvant: partsCentimes / 100,
    comptees,
    regularisation: regularisationCentimes / 100,
    sens: regularisationCentimes > 0 ? 'due' : regularisationCentimes < 0 ? 'remboursee' : 'nulle',
    payableEn: annee + 1,
    dejaAppelee,
    reserves,
  }
}
