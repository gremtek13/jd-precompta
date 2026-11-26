import type { EtatDeValidation, PrealableDeValidation } from './prealablesValidation'
import type { ExerciceValide } from './types'

// LES PRÉALABLES DE LA VALIDATION, MONTRÉS DANS L'ONGLET RÉVISION (ligne 41). La conception de la révision (§ 4.2) veut que
// l'onglet RANGE les contrôles existants sans les refaire : il montre donc, en lecture seule, les préalables de l'exercice
// tels que la carte « Valider l'exercice » de Clôture les reçoit — le même module (lib/prealablesValidation.ts), la même
// lecture (pages/dossier/useClotureDuDossier.ts). Jamais une règle recopiée ; aucun geste de validation ici. R6 (la révision
// RETIENT la validation) reste à faire : la révision n'ajoute ici aucun préalable à elle.
//
// Rien ne se dit avant que la lecture soit revenue, ni sur une lecture partielle : la carte de Clôture dirait alors « une
// lecture incomplète », et la révision, qui ne dit rien d'une lecture incomplète, le dit à sa manière (`incomplete`). Un
// module PUR.

export type PrealablesDeLaRevision =
  // Pas encore revenue : « Chargement… », rien d'affirmé.
  | { etat: 'en_cours' }
  // Lue en partie : le motif, et aucun préalable — une liste tirée d'une partie des entrées tairait ce qui manque.
  | { etat: 'incomplete'; motif: string }
  // L'exercice est validé : plus rien ne le retient.
  | { etat: 'valide' }
  | { etat: 'lus'; bloquants: PrealableDeValidation[]; attentions: PrealableDeValidation[] }

export function prealablesPourLaRevision({ enCours, motif, validation }: {
  // Vrai tant qu'une lecture n'est pas revenue pour ce dossier.
  enCours: boolean
  // Le motif d'une lecture partielle, ou rien.
  motif: string | null
  // Ce que Clôture donne à la carte de l'exercice (`validationDe`) ; nul quand elle n'en donne pas encore — en trésorerie, tant
  // que la 2035 de l'exercice ne se calcule pas.
  validation: { valide: ExerciceValide | null; etat: EtatDeValidation | null } | null
}): PrealablesDeLaRevision {
  if (enCours) return { etat: 'en_cours' }
  if (motif !== null) return { etat: 'incomplete', motif }
  if (validation === null) return { etat: 'en_cours' }
  if (validation.valide !== null) return { etat: 'valide' }
  if (validation.etat === null) return { etat: 'en_cours' }
  return {
    etat: 'lus',
    bloquants: validation.etat.prealables.filter((p) => p.bloquant),
    attentions: validation.etat.prealables.filter((p) => !p.bloquant),
  }
}
