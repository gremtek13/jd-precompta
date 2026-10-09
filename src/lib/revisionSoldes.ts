import { etatDeLOuverture, ouvertureDeLExercice } from './reportDesSoldes'
import type { ANouveau, EcritureBrouillon, SoldeReporte } from './types'

// LA RÉVISION DES SOLDES, CE QUE LA BASE VÉRIFIE AU CLIC (ligne 41, étape R1 ; migration revision_des_soldes).
//
// Une décision de la révision porte le solde qu'elle justifie, et `justifier_solde` refuse une décision dont le solde
// n'est plus celui des écritures (refus 9), ou dont l'exercice n'a pas encore d'ouverture définitive (refus 6 et 7). Ce
// module calcule les deux COMME la base, pour que l'écran (étapes R2 et R3) montre le solde que la base acceptera et
// dise avant le clic ce qu'elle refuserait : deux calculs de la même chose finissent par diverger, et rien d'autre ne le
// montrerait — l'écran proposerait un solde, la base le refuserait. `revisionSoldes.test.ts` les confronte à une table
// relevée sur la fonction de la base, et aux littéraux de la migration.
//
// Le reste de la révision — les cycles, les états déduits, les preuves proposées, les refus avant le clic, la mémoire
// d'un exercice à l'autre — est l'étape R2.

/** Les comptes qui se justifient par leur solde : classes 1 à 5, au moins trois chiffres (le motif de `soldes_reportes`). */
export const MOTIF_COMPTE_DE_BILAN = /^[1-5][0-9]{2,}$/

/** Ce qu'une décision dit d'un solde : justifié par des pièces, accepté sur motif (hypothèse Q3 du cabinet), anomalie. */
export const ETATS_DE_DECISION = ['justifie', 'accepte', 'anomalie'] as const
/** Une justification vaut pour l'exercice, ou de façon permanente : elle se propose alors à l'exercice suivant. */
export const PORTEES_DE_DECISION = ['exercice', 'permanente'] as const

/** Ce que la base ôte d'un texte avant de juger qu'il dit quelque chose : espaces, tabulations, retours à la ligne. */
export const BLANCS_D_UN_TEXTE = ' \t\n\r'
/** Les longueurs que la base admet, en caractères (et non en unités UTF-16) ; l'instantané, en octets de son texte JSON. */
export const LONGUEUR_MAX_MOTIF = 4000
export const LONGUEUR_MAX_PRECISION = 500
export const TAILLE_MAX_PREUVE_APPLICATION = 65536

/** Les centimes d'une ligne tels que l'application les compte partout — et que `solde_du_compte` refait en base. */
function centimes(montant: number): number {
  return Math.round(montant * 100)
}

// LE SOLDE D'UN COMPTE À LA FIN D'UN EXERCICE, en centimes entiers, débit positif : les écritures du brouillon datées de
// l'exercice — proposées comme validées — et son ouverture (`ouvertureDeLExercice` : la reprise datée de l'exercice, les
// soldes reportés au 1er janvier). Chaque ligne compte pour Math.round(montant × 100) : une écriture n'est pas contrainte
// au centime en base, et `solde_du_compte` refait exactement ce calcul, en double précision, sur le nombre que le
// navigateur lit. `calculerBalance` (lib/ecritures.ts) somme les mêmes lignes en euros : le solde d'une balance de
// l'exercice et celui-ci ne diffèrent que de l'arrondi flottant.
export function soldeDuCompteCentimes(
  compte: string,
  exercice: number,
  d: {
    // Tout le brouillon du dossier : le filtre de l'exercice est ici, comme dans la base.
    ecritures: readonly Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant'>[]
    reprise: readonly ANouveau[]
    reportes: readonly SoldeReporte[]
  },
): number {
  const debut = `${exercice}-01-01`
  const fin = `${exercice}-12-31`
  let solde = 0
  for (const e of d.ecritures) {
    if (e.compte !== compte || e.date < debut || e.date > fin) continue
    solde += (e.sens === 'debit' ? 1 : -1) * centimes(e.montant)
  }
  for (const a of ouvertureDeLExercice(d.reprise, d.reportes, exercice)) {
    if (a.compte !== compte) continue
    solde += (a.sens === 'debit' ? 1 : -1) * centimes(a.montant)
  }
  return solde
}

// CE QUE LA BASE DIT DE L'OUVERTURE D'UN EXERCICE AVANT D'Y LAISSER JUSTIFIER UN SOLDE, dans l'ordre de ses refus :
//   6. un exercice qui finit avant la reprise du dossier est dans les comptes repris — rien à y justifier ;
//   7. un exercice dont l'ouverture attend la validation du précédent (`etatDeLOuverture`, « en-attente ») : ses soldes
//      de bilan ne sont pas encore définitifs.
// Sinon, rien : l'exercice de la reprise, celui qui suit un exercice validé, et le premier d'une activité que rien ne
// précède.
export type RefusDeLOuverture = 'anterieur-a-la-reprise' | 'en-attente'

export function refusDeLOuverture(
  exercice: number,
  d: Parameters<typeof etatDeLOuverture>[1],
): RefusDeLOuverture | null {
  const dateReprise = d.reprise.length > 0 ? d.reprise.map((a) => a.date).sort()[0] : null
  if (dateReprise !== null && `${exercice}-12-31` < dateReprise) return 'anterieur-a-la-reprise'
  return etatDeLOuverture(exercice, d).type === 'en-attente' ? 'en-attente' : null
}
