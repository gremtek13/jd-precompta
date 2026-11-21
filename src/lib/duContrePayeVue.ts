import { formatDate, formatMoney } from './format'
import { regimeChoisi } from './regimesAssuranceMaladie'
import type { EspaceVentes } from './espaceVentes'
import type { CoteDuDu, DuContrePaye, LigneComparee, LigneNonComparable, TrancheDuReste } from './duContrePaye'

// CE QUE L'ASSURANCE MALADIE DOIT, À L'ÉCRAN : LES MOTS ET LA FENÊTRE PROPOSÉE (conception 59, lot BOR5 ; le calcul :
// lib/duContrePaye.ts). Une section des deux espaces, EN LECTURE SEULE, sous `DU_CONTRE_PAYE_PREVU` baissé jusqu'à ce que le
// cabinet ait vu un premier import réel des deux côtés (DU-Q1) : l'onglet Banque du cabinet, et « Ma banque » du praticien sous
// « Banque » (DU-Q3 (A), décision du cabinet du 21/11/2026 : « avec les mots du client, sans geste »). Des mots neutres : « reste
// estimé », « à vérifier dans ton logiciel de télétransmission », jamais « impayé », jamais un conseil. Les phrases du client
// le tutoient et ne nomment aucun onglet (`MOTS_DU_CABINET`, lib/espaceVentes.ts, confronté par le test) ; celles qui ne
// changent pas d'un espace à l'autre (les états muets, les avis, les organismes) sont neutres, confrontées de même.

/** Baissé : la section ne se monte pas. Le lever est une décision du cabinet (DU-Q1), après un premier import réel des deux côtés. */
export const DU_CONTRE_PAYE_PREVU = false

export const TITRE_DU_DU = 'Ce que l’assurance maladie doit (estimé)'
export const TITRE_DU_DU_AU_CLIENT = 'Ce que l’assurance maladie te doit (estimé)'

export const PRESENTATION_DU_DU = 'Le facturé des bordereaux importés, confronté aux paiements NOEMIE importés, par organisme et par '
  + 'part, en compte courant : chaque paiement s’impute aux lots les plus anciens qu’il peut payer. Le reste est une ESTIMATION, à '
  + 'vérifier dans le logiciel de télétransmission du praticien : un rejet, un paiement d’un lot non importé, une facture refaite '
  + 'sous un autre lot le déplacent. Rien de ce qui suit ne compte dans la 2035, la CA3 ni le FEC.'

export const PRESENTATION_DU_DU_AU_CLIENT = 'Ce que tu as facturé (tes bordereaux importés), confronté à ce que l’assurance '
  + 'maladie t’a payé (tes paiements NOEMIE importés), par organisme et par part, en compte courant : chaque paiement s’impute '
  + 'aux lots les plus anciens qu’il peut payer. Le reste est une ESTIMATION, à vérifier dans ton logiciel de télétransmission : '
  + 'un rejet, un paiement d’un lot que tu n’as pas importé, une facture refaite sous un autre lot le déplacent. Rien de ce qui '
  + 'suit ne compte dans tes recettes.'

export const RESERVE_DES_CAISSES = 'Le rapprochement suppose que le code de caisse imprimé sur le bordereau est celui que porte le '
  + 'paiement NOEMIE de la même caisse : ce n’est pas encore vérifié sur un fichier réel. Un organisme d’un seul côté le dit.'

export const RESERVE_DES_CAISSES_AU_CLIENT = 'Le rapprochement suppose que le code de caisse imprimé sur ton bordereau est celui '
  + 'que porte le paiement NOEMIE de la même caisse : ce n’est pas encore vérifié sur un fichier réel. Un organisme d’un seul '
  + 'côté le dit.'

/** Le client ne choisit pas la fenêtre (aucun geste, DU-Q3 (A)) : elle se dit, la période que ses deux côtés couvrent ensemble. */
export const fenetreDuClientDite = (f: { du: string; au: string }) => `Lots créés du ${formatDate(f.du)} au ${formatDate(f.au)}, `
  + 'la période que tes bordereaux et tes paiements importés couvrent ensemble.'

/** Sans « Relire » côté client : un import fait plus haut dans la page compte à sa prochaine ouverture. */
export const RELECTURE_DU_CLIENT = 'Un import que tu fais plus haut compte ici à ta prochaine ouverture de cette page.'

/** Ce qui ne se confronte pas faute de lecture : la case « Banque » retirée, ou le motif d'une lecture en échec. */
export function phraseSansLecture(
  espace: EspaceVentes,
  lus: readonly ({ etat: 'echec'; motif: string } | { etat: 'sans_banque' } | { etat: 'lus' })[],
): string {
  if (lus.some((l) => l.etat === 'sans_banque')) {
    return espace === 'client'
      ? 'Ton accès ne porte plus « Banque » sur cette société : ce que l’assurance maladie te doit ne s’affiche pas ici.'
      : 'Rien n’est confronté : l’accès ne porte pas « Banque ».'
  }
  const motif = lus.map((l) => (l.etat === 'echec' ? l.motif : null)).filter((m) => m !== null).join(' ; ')
  return `Rien n’est confronté : ${motif || 'la lecture n’a pas abouti'}.`
}

/** Les mots qui changent d'un espace à l'autre ; les autres sont neutres et servent les deux. */
export function motsDuDu(espace: EspaceVentes): { titre: string; presentation: string; reserve: string } {
  return espace === 'client'
    ? { titre: TITRE_DU_DU_AU_CLIENT, presentation: PRESENTATION_DU_DU_AU_CLIENT, reserve: RESERVE_DES_CAISSES_AU_CLIENT }
    : { titre: TITRE_DU_DU, presentation: PRESENTATION_DU_DU, reserve: RESERVE_DES_CAISSES }
}

export const LIBELLES_DES_TRANCHES: Readonly<Record<TrancheDuReste, string>> = {
  sept_jours_au_plus: '7 jours au plus',
  de_8_a_30_jours: 'de 8 à 30 jours',
  de_31_a_90_jours: 'de 31 à 90 jours',
  plus_de_90_jours: 'plus de 90 jours',
}

export const montantDuDu = (centimes: number) => formatMoney(centimes / 100)

const COTES: Readonly<Record<CoteDuDu, string>> = { facture: 'les bordereaux', paye: 'les paiements NOEMIE' }
const cotesDites = (cotes: readonly CoteDuDu[]) => cotes.map((c) => COTES[c]).join(' et ')

/** Ce que l'écran dit quand il ne compte pas : jamais 0, jamais un vide qui passerait pour un fait. */
export function phraseSansCompte(r: Exclude<DuContrePaye, { etat: 'compte' }>): string {
  switch (r.etat) {
    case 'lecture_partielle':
      return `Rien n’est confronté : ${cotesDites(r.cotes)} n’ont pas pu être lus en entier.`
    case 'donnee_illisible':
      return r.cote === 'parametres'
        ? 'Rien n’est confronté : la fenêtre choisie n’est pas faite de dates.'
        : `Rien n’est confronté : une ligne de ${COTES[r.cote]} n’a pas pu être lue.`
    case 'fenetre_invalide':
      return r.raison === 'a_l_envers' ? 'La fenêtre commence après sa fin.' : 'La fenêtre ne peut pas finir après aujourd’hui.'
    case 'rien_importe':
      return `Rien n’est confronté : aucun import pour ${cotesDites(r.cotes)}.`
    case 'non_couvert':
      return `Rien n’est confronté sur cette fenêtre : ${cotesDites(r.cotes)} ne la couvrent pas. Les bordereaux importés vont du `
        + `${formatDate(r.etendues.facture.du)} au ${formatDate(r.etendues.facture.au)}, les paiements du `
        + `${formatDate(r.etendues.paye.du)} au ${formatDate(r.etendues.paye.au)}.`
  }
}

/** La fenêtre que les deux côtés couvrent ensemble, au plus jusqu'au jour ; nulle quand ils ne se recouvrent pas. */
export function fenetreProposee(
  facture: readonly { premier_lot_le: string; dernier_lot_le: string }[],
  paye: readonly { periode_du: string; periode_au: string }[],
  aujourdHui: string,
): { du: string; au: string } | null {
  if (facture.length === 0 || paye.length === 0) return null
  const min = (d: string[]) => d.reduce((a, b) => (b < a ? b : a))
  const max = (d: string[]) => d.reduce((a, b) => (b > a ? b : a))
  const du = max([min(facture.map((i) => i.premier_lot_le)), min(paye.map((i) => i.periode_du))])
  const au = min([max(facture.map((i) => i.dernier_lot_le)), max(paye.map((i) => i.periode_au)), aujourdHui])
  return du <= au ? { du, au } : null
}

/** L'organisme d'une ligne : le régime de la liste fermée quand il y est, la caisse à trois chiffres. */
export function organismeDuDuDit(l: Pick<LigneComparee | LigneNonComparable, 'part' | 'regime' | 'caisse'>): string {
  if (l.part === 'complementaire') return 'Part complémentaire, tous organismes'
  const regime = l.regime === null ? null : regimeChoisi(l.regime)
  const deRegime = l.regime === null ? 'régime non dit' : regime ? regime.intitule : `régime ${l.regime}`
  return `${deRegime}, ${l.caisse === null ? 'caisse non dite' : `caisse ${String(l.caisse).padStart(3, '0')}`}`
}

export const EN_FACE_DIT: Readonly<Record<LigneComparee['enFace'], string | null>> = {
  les_deux: null,
  facture_seul: 'aucun paiement importé sous cet organisme',
  paye_seul: 'aucun lot importé sous cet organisme',
}

export const RAISONS_NON_COMPARABLES: Readonly<Record<LigneNonComparable['raison'], string>> = {
  complementaire_non_dite: 'le bordereau ne nomme pas l’organisme complémentaire : aucun reste ne s’en déduit',
  avoir_dans_le_facture: 'un lot d’avoirs : la règle d’imputation ne sait pas à quel lot il se rapporte',
  organisme_du_paiement_non_dit: 'le paiement ne dit pas son régime ou sa caisse',
}

const moisDit = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`

/** Les faits sur les imports qui pèsent sur le reste : la situation, les mois sans lot ou sans paiement importé. */
export function avisDuCompte(r: Extract<DuContrePaye, { etat: 'compte' }>): string[] {
  const avis = [`Situation au ${formatDate(r.situationAu)}, la dernière journée comptable importée`
    + (r.joursDepuisLaSituation > 0 ? ` (il y a ${r.joursDepuisLaSituation} jour${r.joursDepuisLaSituation > 1 ? 's' : ''}).` : '.')]
  if (r.moisSansLot.length > 0) avis.push(`Aucun lot importé pour : ${r.moisSansLot.map(moisDit).join(', ')}.`)
  if (r.moisSansPaiement.length > 0) avis.push(`Aucun paiement importé pour : ${r.moisSansPaiement.map(moisDit).join(', ')}.`)
  if (r.horsFacture.forfaitsCentimes !== 0 || r.horsFacture.regularisationsCentimes !== 0) {
    avis.push(`Hors du facturé, sur la fenêtre : ${montantDuDu(r.horsFacture.forfaitsCentimes)} de forfaits et d’aides, `
      + `${montantDuDu(r.horsFacture.regularisationsCentimes)} de régularisations.`)
  }
  return avis
}
