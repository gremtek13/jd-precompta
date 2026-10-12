import type { EtatDeLaCitation } from './revision'
import {
  ELEMENTS_PROPOSES_PAR_A9, LIBELLES_DES_NATURES, NATURES_DU_DOSSIER_PERMANENT, elementsSansEntree, vautPourLExercice,
  type EntreeDuDossierPermanent, type EntreesLues,
} from './dossierPermanent'
import { anneeDe, formatDate } from './format'
import type { NatureDossierPermanent } from './types'
import type { Pastille } from './revisionLibelles'

// LES MOTS ET LE RANGEMENT DE L'ÉCRAN DU DOSSIER PERMANENT (ligne 41, étape R7, phase C ; pur). Le module
// (lib/dossierPermanent.ts) lit les chaînes de versions, dit les refus et ce qu'une citation prouve encore ; ce fichier ne
// fait que RANGER et DIRE ce qu'il rend, pour que la section de l'onglet Révision et son volet disent la même chose de la
// même entrée. Il ne lit rien, ne lit pas l'horloge (le jour d'aujourd'hui lui est DONNÉ, lu au rendu par l'écran), et n'écrit
// aucune règle de la base.

/** Ce qu'une citation prouve encore, en mots : le texte garde sa couleur, l'état se lit à la pastille. */
export const PASTILLE_DE_LA_CITATION: Readonly<Record<EtatDeLaCitation, Pastille>> = {
  intacte: { mot: 'empreinte intacte', classe: 'badge-ok' },
  changee: { mot: 'fichier changé depuis la citation', classe: 'badge-warning' },
  disparue: { mot: 'empreinte disparue', classe: 'badge-warning' },
  'sans-empreinte': { mot: 'sans empreinte', classe: 'badge-neutral' },
  introuvable: { mot: 'introuvable dans ce qui a été lu', classe: 'badge-neutral' },
}

/** Ce que l'état veut dire, une phrase : ce que la citation établit, ou ne peut établir. */
export const EXPLICATION_DE_LA_CITATION: Readonly<Record<EtatDeLaCitation, string>> = {
  intacte: 'Le fichier cité porte encore l’empreinte relevée le jour de la citation.',
  changee: 'Le fichier cité n’est plus celui qui a été cité : son empreinte a changé depuis.',
  disparue: 'Le fichier cité n’a plus d’empreinte : rien ne dit qu’il est resté le même.',
  'sans-empreinte': 'Le fichier n’avait pas d’empreinte le jour de la citation : rien ne se vérifie.',
  introuvable: 'Le fichier cité n’est pas dans ce que l’écran a lu : il a pu être retiré du dossier.',
}

/** « Lettre de mission », « Autre document » : le libellé de la nature, en tête de phrase. */
export function libelleDeLaNature(nature: NatureDossierPermanent): string {
  const l = LIBELLES_DES_NATURES[nature]
  return l.charAt(0).toUpperCase() + l.slice(1)
}

/** La période de validité d'une version, en mots ; les bornes sont comprises, une borne nulle ne borne rien. */
export function validiteEnMots(v: { valable_du: string | null; valable_jusqu_au: string | null }): string {
  if (v.valable_du === null && v.valable_jusqu_au === null) return 'valable depuis toujours, sans terme'
  if (v.valable_du !== null && v.valable_jusqu_au !== null) {
    return `valable du ${formatDate(v.valable_du)} au ${formatDate(v.valable_jusqu_au)} (bornes comprises)`
  }
  return v.valable_du !== null ? `valable depuis le ${formatDate(v.valable_du)}, sans terme` : `valable jusqu’au ${formatDate(v.valable_jusqu_au as string)}`
}

export interface GroupeDeNature {
  nature: NatureDossierPermanent
  libelle: string
  entrees: EntreeDuDossierPermanent[]
}

/**
 * Les entrées COURANTES (non retirées), rangées dans l'ordre de A9 (`NATURES_DU_DOSSIER_PERMANENT`) ; dans une nature, dans
 * l'ordre où le module les rend (leur première version). Une nature sans entrée n'a pas de groupe. La nature est celle de la
 * version COURANTE : une nouvelle version peut la changer (R7-Q2).
 */
export function entreesParNature(entrees: readonly EntreeDuDossierPermanent[]): GroupeDeNature[] {
  return NATURES_DU_DOSSIER_PERMANENT
    .map((nature) => ({
      nature, libelle: libelleDeLaNature(nature),
      entrees: entrees.filter((e) => !e.retiree && e.courante.nature === nature),
    }))
    .filter((g) => g.entrees.length > 0)
}

/** Les entrées retirées, la plus récemment retirée d'abord (puis l'identifiant, pour un ordre total). */
export function entreesRetirees(entrees: readonly EntreeDuDossierPermanent[]): EntreeDuDossierPermanent[] {
  const instant = (e: EntreeDuDossierPermanent) => Date.parse(e.courante.retire_le ?? '')
  return entrees.filter((e) => e.retiree)
    .sort((a, b) => instant(b) - instant(a) || (a.courante.id < b.courante.id ? -1 : a.courante.id > b.courante.id ? 1 : 0))
}

/** Les versions d'une entrée, la plus récente d'abord : l'historique se lit de haut en bas. */
export function versionsDuPlusRecentAuPlusAncien(e: EntreeDuDossierPermanent): EntreeDuDossierPermanent['versions'] {
  return [...e.versions].reverse()
}

/**
 * Ce que A9 propose et qu'aucune entrée ne porte pour l'exercice, dit comme une INFORMATION : la norme dit que le dossier
 * « peut contenir » ces éléments, elle ne les impose pas — ni le texte ni le bouton n'en font une faute. Sans exercice choisi
 * (`annee` nul), la phrase se dit pour aujourd'hui.
 */
export function informationSurUnElementSansEntree(nature: NatureDossierPermanent, annee: number | null): string {
  const quand = annee === null ? 'aujourd’hui' : `en ${annee}`
  switch (nature) {
    case 'lettre_mission': return `Aucune lettre de mission n’est en vigueur ${quand}.`
    case 'description': return `Aucune description de l’entité et de son activité n’est en vigueur ${quand}.`
    case 'organisation_comptable': return `Aucune présentation de l’organisation comptable n’est en vigueur ${quand}.`
    default: return `Aucun élément de nature « ${LIBELLES_DES_NATURES[nature]} » n’est en vigueur ${quand}.`
  }
}

// SANS EXERCICE CHOISI (« toutes », « sans date », ou un dossier neuf dont l'en-tête n'offre aucun exercice), la section regarde
// AUJOURD'HUI : le jour à Paris, que l'écran lit au rendu et donne. La règle d'un exercice reste celle du module
// (`vautPourLExercice`, `elementsSansEntree`) ; ce qui suit ne dit que la même chose pour un JOUR, bornes comprises.

/** Une version vaut-elle le jour donné (AAAA-MM-JJ) ? Les bornes sont comprises, une borne nulle ne borne rien. */
export function vautLeJour(v: { valable_du: string | null; valable_jusqu_au: string | null }, jour: string): boolean {
  return (v.valable_du === null || v.valable_du <= jour) && (v.valable_jusqu_au === null || v.valable_jusqu_au >= jour)
}

/** La version ne couvre-t-elle pas ce que la section regarde : l'exercice choisi, ou — sans exercice — le jour donné ? */
export function horsDuRegard(
  v: { valable_du: string | null; valable_jusqu_au: string | null },
  annee: number | null,
  jour: string,
): boolean {
  return annee === null ? !vautLeJour(v, jour) : !vautPourLExercice(v, annee)
}

/** « ne couvre pas 2025 » ; sans exercice, « ne couvre pas aujourd’hui ». */
export function motNeCouvrePas(annee: number | null): string {
  return annee === null ? 'ne couvre pas aujourd’hui' : `ne couvre pas ${annee}`
}

/**
 * Les éléments que A9 propose et qu'aucune entrée non retirée ne porte pour ce que la section regarde (l'exercice choisi, ou le
 * jour) ; nul quand rien ne s'affirme (lecture partielle, chaîne illisible).
 */
export function elementsSansEntreeAuRegard(
  lues: EntreesLues,
  complete: boolean,
  annee: number | null,
  jour: string,
): NatureDossierPermanent[] | null {
  if (annee !== null) return elementsSansEntree(lues, complete, annee)
  if (!complete || !lues.lisible) return null
  return ELEMENTS_PROPOSES_PAR_A9.filter((n) => !lues.entrees.some((e) => !e.retiree && e.courante.nature === n && vautLeJour(e.courante, jour)))
}

/**
 * Les années où le dossier a de l'activité, de la plus récente à la plus ancienne : celles d'une pièce, d'un mouvement ou d'une
 * écriture datés, et des exercices validés — la liste que l'en-tête du dossier offre en sélecteur. Vide, l'en-tête n'offre aucun
 * exercice à choisir.
 */
export function anneesDActivite(sources: {
  pieces: readonly { date_piece: string | null }[]
  lignes: readonly { date: string }[]
  ecritures: readonly { date: string }[]
  anneesValidees: readonly number[]
}): number[] {
  const annees = new Set<number>(sources.anneesValidees)
  for (const p of sources.pieces) if (p.date_piece) annees.add(anneeDe(p.date_piece))
  for (const l of sources.lignes) annees.add(anneeDe(l.date))
  for (const e of sources.ecritures) annees.add(anneeDe(e.date))
  return [...annees].sort((a, b) => b - a)
}
