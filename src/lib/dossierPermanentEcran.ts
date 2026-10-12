import type { EtatDeLaCitation } from './revision'
import {
  LIBELLES_DES_NATURES, NATURES_DU_DOSSIER_PERMANENT, type EntreeDuDossierPermanent,
} from './dossierPermanent'
import { formatDate } from './format'
import type { NatureDossierPermanent } from './types'
import type { Pastille } from './revisionLibelles'

// LES MOTS ET LE RANGEMENT DE L'ÉCRAN DU DOSSIER PERMANENT (ligne 41, étape R7, phase C ; pur). Le module
// (lib/dossierPermanent.ts) lit les chaînes de versions, dit les refus et ce qu'une citation prouve encore ; ce fichier ne
// fait que RANGER et DIRE ce qu'il rend, pour que la section de l'onglet Révision et son volet disent la même chose de la
// même entrée. Il ne lit rien, ne lit pas l'horloge, et n'écrit aucune règle de la base.

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
 * « peut contenir » ces éléments, elle ne les impose pas — ni le texte ni le bouton n'en font une faute.
 */
export function informationSurUnElementSansEntree(nature: NatureDossierPermanent, annee: number): string {
  switch (nature) {
    case 'lettre_mission': return `Aucune lettre de mission n’est en vigueur en ${annee}.`
    case 'description': return `Aucune description de l’entité et de son activité n’est en vigueur en ${annee}.`
    case 'organisation_comptable': return `Aucune présentation de l’organisation comptable n’est en vigueur en ${annee}.`
    default: return `Aucun élément de nature « ${LIBELLES_DES_NATURES[nature]} » n’est en vigueur en ${annee}.`
  }
}
