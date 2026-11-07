// LA RÉGULARISATION DES COTISATIONS D'UN PRATICIEN BNC (ligne 27, TNS-Q2), PRÉPARÉE le 07/11/2026 sur la recommandation
// d'une relecture que le cabinet n'a pas encore tranchée. La migration `regularisation_des_cotisations`
// (supabase/preparees/20261107170000_regularisation_des_cotisations.sql) pose trois colonnes de `cotisations_declarees` :
// l'organisme qui appelle, l'année payée, la nature. Elle n'est PAS appliquée : `REGULARISATION_DES_COTISATIONS_EXPORTEE`
// reste baissé, l'onglet Cotisations ne les montre ni ne les écrit, et la carte du volet social n'estime rien.
//
// LA RÈGLE (code de la sécurité sociale, art. L. 131-6-2) : les cotisations d'un indépendant sont dues annuellement,
// calculées « à titre provisionnel » sur le revenu d'une année antérieure, puis régularisées quand le revenu de l'année au
// titre de laquelle elles sont dues est définitivement connu. La régularisation ESTIMÉE de l'année N est donc :
//   les cotisations définitives estimées sur le revenu réel de N — celles de `estimerCotisationsUrssaf`
//   (lib/voletSocialPamc.ts), le calcul éprouvé contre le moteur de l'Urssaf, jamais recopié ici ; l'Urssaf seule, la
//   retraite étant appelée par la caisse ;
//   moins ce que l'Urssaf a appelé AU TITRE DE N : les échéances décrites « Urssaf, N, provisionnelle » et
//   « Urssaf, N, acompte » (un acompte à valoir sur N paie N comme une provisionnelle ; l'omettre gonflerait la
//   régularisation), leur montant APPELÉ ;
//   due (positive) ou remboursée (négative) en N + 1, l'année où l'Urssaf la calcule, après la déclaration du revenu de N.
// Une échéance de N qui paie la régularisation de N − 1 n'y entre pas : c'est ce qu'une soustraction des échéances de
// l'année aurait compté à tort.
//
// CE QU'ELLE NE SAIT PAS, ELLE LE DIT, sans rien deviner — et alors elle ne rend AUCUN chiffre :
//   - le revenu de N n'est pas arrêté tant que l'année n'est pas finie (ni ses appels : l'Urssaf ajuste les provisionnelles
//     de N après la déclaration du revenu de N − 1) ;
//   - les cotisations définitives ne s'estiment pas (le motif du moteur : profession, plafond, relevé SNIR…) ;
//   - une échéance qui POURRAIT payer N à l'Urssaf ne dit pas tout ce qu'il faut pour en juger : datée de N ou dite de
//     l'année N, sans organisme, ou de l'Urssaf sans son année ou sa nature. Une échéance d'une caisse de retraite, elle,
//     se juge à son seul organisme ; une échéance d'une autre année que rien ne rattache à N ne se lit pas ;
//   - un appel manque : aucune provisionnelle ni aucun acompte de l'Urssaf pour N, ou l'un d'eux encore « prévisionnel »
//     (l'estimation du cabinet d'un appel à venir — rien à voir avec une provisionnelle, que l'Urssaf appelle).
// Et ce qu'elle sait mais qui peut bouger se dit À CÔTÉ du chiffre : une 2035 de N pas encore validée (l'estimation suit
// ses chiffres du jour), la régularisation de N déjà saisie comme appelée (le montant de l'Urssaf l'emporte).
//
// UN PRÉLÈVEMENT QUI PAIE À LA FOIS UNE PROVISIONNELLE ET LA RÉGULARISATION DE L'ANNÉE D'AVANT ne se décrit pas d'une
// seule nature : il se saisit en deux échéances, que le relevé ne rapproche aujourd'hui que d'une (TNS-Q2-B, au cabinet).
// « Réunir » (lib/gestesDesEcheances.ts) n'en garde que la description commune : l'échéance réunie, mêlée, se dit alors
// non décrite ici.

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

/** Les trois champs tels que tapés ; le vide : « non dit ». */
export interface SaisieDeLaDescription {
  organisme: string
  annee: string
  nature: string
}

export type DescriptionDeLEcheance = Pick<CotisationDeclaree, 'organisme' | 'annee_payee' | 'nature'>

/** La saisie pré-remplie d'une échéance : une colonne absente de la lecture (la migration pas appliquée) se dit vide. */
export function saisieDeLaDescription(c: Partial<DescriptionDeLEcheance>): SaisieDeLaDescription {
  return { organisme: c.organisme ?? '', annee: c.annee_payee == null ? '' : String(c.annee_payee), nature: c.nature ?? '' }
}

const estOrganisme = (v: string): v is OrganismeCotisation => (ORGANISMES as readonly string[]).includes(v)
const estNature = (v: string): v is NatureCotisation => (NATURES as readonly string[]).includes(v)

/**
 * Les trois champs lus, ou ce que la base refuserait, sous la règle de ses quatre contraintes : un organisme et une nature
 * de leur liste, une année payée de cinq ans avant l'année de l'échéance à un an après, une régularisation jamais d'une
 * année postérieure à son échéance. Chacun peut rester vide : rien n'exige les trois ensemble.
 */
export function lireLaDescription(s: SaisieDeLaDescription, echeance: string): { valeurs: Required<DescriptionDeLEcheance> } | { refus: string } {
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
    if (an !== null && (anneePayee < an - 5 || anneePayee > an + 1)) {
      return { refus: `L’année payée d’une échéance de ${an} va de ${an - 5} à ${an + 1}.` }
    }
    if (an !== null && nature === 'regularisation' && anneePayee > an) {
      return { refus: `Une régularisation de ${anneePayee} ne s’appelle pas en ${an} : elle suit son année.` }
    }
  }
  return {
    valeurs: {
      organisme: organisme === '' ? null : (organisme as OrganismeCotisation),
      annee_payee: anneePayee,
      nature: nature === '' ? null : (nature as NatureCotisation),
    },
  }
}

/** La description d'une échéance en mots, ou « non décrite ». */
export function descriptionDite(c: Partial<DescriptionDeLEcheance>): string {
  const morceaux = [
    c.organisme ? LIBELLES_ORGANISME[c.organisme].split(' (')[0] : null,
    c.nature ? { provisionnelle: 'provisionnelle', regularisation: 'régularisation', acompte: 'acompte' }[c.nature] : null,
    c.annee_payee != null ? String(c.annee_payee) : null,
  ].filter((m): m is string => m !== null)
  return morceaux.length === 0 ? 'non décrite' : morceaux.join(', ')
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
    /** Ce que l'Urssaf a appelé au titre de N : provisionnelles et acomptes. */
    appelees: number
    /** Les échéances comptées, dans l'ordre de leurs dates. */
    comptees: CotisationDeclaree[]
    /** Définitives − appelées : positive, due ; négative, remboursée. */
    regularisation: number
    sens: 'due' | 'remboursee' | 'nulle'
    payableEn: number
    /** La régularisation de N déjà saisie comme appelée par l'Urssaf, ou nul. */
    dejaAppelee: number | null
    reserves: string[]
  }
  | { etat: 'inconnue'; annee: number; manques: string[] }

const centimes = (n: number) => Math.round(n * 100)
const decrite = (c: CotisationDeclaree) => c.organisme != null && c.annee_payee != null && c.nature != null
const parOrdre = (a: CotisationDeclaree, b: CotisationDeclaree) =>
  a.echeance < b.echeance ? -1 : a.echeance > b.echeance ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Une échéance qui pourrait payer N à l'Urssaf : datée de N ou dite de N, et d'aucun autre organisme connu. */
function pourraitPayerNALUrssaf(c: CotisationDeclaree, annee: number): boolean {
  if (c.organisme != null && c.organisme !== 'urssaf') return false
  if (c.annee_payee != null) return c.annee_payee === annee
  return anneeDe(c.echeance) === annee
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
  const appeleesCentimes = comptees.reduce((s, c) => s + centimes(c.montant_appele), 0)
  const regularisationCentimes = centimes(definitives) - appeleesCentimes
  const regularisations = candidates.filter((c) => c.nature === 'regularisation' && c.annee_payee === annee)
  const reserves: string[] = []
  if (!e.exerciceValide) {
    reserves.push(`La 2035 de ${annee} n’est pas validée : l’estimation suit ses chiffres d’aujourd’hui.`)
  }
  const dejaAppelee = regularisations.length === 0
    ? null
    : regularisations.reduce((s, c) => s + centimes(c.montant_appele), 0) / 100
  if (dejaAppelee !== null) {
    reserves.push(`L’Urssaf a déjà appelé ${formatMoney(dejaAppelee)} de régularisation de ${annee} : son avis l’emporte sur l’estimation.`)
  }
  return {
    etat: 'estimee',
    annee,
    definitives,
    appelees: appeleesCentimes / 100,
    comptees,
    regularisation: regularisationCentimes / 100,
    sens: regularisationCentimes > 0 ? 'due' : regularisationCentimes < 0 ? 'remboursee' : 'nulle',
    payableEn: annee + 1,
    dejaAppelee,
    reserves,
  }
}
