import { formatMoney } from './format'
import { validationEnLot, type JugeDeLaValidation, type ValidationEnLot } from './lotsDeLaJumelleInversee'
import type { PiecePourDoublon } from './doublonsProbables'
import type { Piece } from './types'

// « VALIDER LA SÉLECTION » DIT TOUT CE QUI PART, ET TOUT CE QUI NE PART PAS (relecture du 04/11/2026, D7). Le bouton annonçait
// la sélection entière — « Valider la sélection (4) » — et n'en envoyait que trois : la pièce sans montant était filtrée en
// silence, la sélection se vidait, et elle restait « à valider » sans un mot. Les trois autres partaient sans un regard, celle
// dont la lecture n'a rendu aucune date et celle de confiance basse à 4 120 € comprises. La base n'y met aucun filet : elle
// accepte une pièce validée sans date, sans montant ni catégorie (l'essai de la relecture).
//
// DÉSORMAIS, UNE SEULE RÈGLE, AVANT LE CLIC :
//   - le nombre du bouton est celui qui part (`aValider`) ;
//   - une pièce ÉCARTÉE se nomme avec sa raison, dans la liste que l'écran montre déjà pour la garde G3 (étape VF6d) : sans
//     montant lu, puis ce que G3 refuserait. Elle reste sélectionnée, à valider ;
//   - une pièce qui part mais mérite un regard — sans date, de confiance basse, en doublon probable (D1) — se dit dans la
//     CONFIRMATION, qui la nomme : rien de ce qui part n'est tu. Annuler ne valide rien.
// Ce qui ne mérite aucun regard part comme hier, sans confirmation. Une pièce déjà validée ne change pas d'état : elle ne se
// signale pas.

/** La raison d'une pièce écartée faute de montant : la validation en lot ne compte que ce qui a été lu. */
export const RAISON_SANS_MONTANT = 'aucun montant lu : elle se valide dans sa fiche, une fois son montant saisi.'

export interface PieceASignaler<P> {
  piece: P
  /** Ce qui mérite un regard, dans l'ordre : la date, la confiance, le doublon probable. */
  motifs: string[]
}

export interface SelectionDeLaValidation<P> extends ValidationEnLot<P> {
  /** Parmi `aValider`, les pièces que la confirmation nomme avant l'envoi. */
  aSignaler: PieceASignaler<P>[]
}

/**
 * La sélection telle que « Valider la sélection » l'enverra. `selection` : les pièces sélectionnées, lues, dans l'ordre de la
 * sélection ; `juge` : la garde G3 (lib/lotsDeLaJumelleInversee.ts) ; `doublons` : pour chaque pièce, les autres pièces qui la
 * doublent probablement (lib/doublonsProbables.ts, `parPiece`). Rien n'a de valeur par défaut.
 */
export function selectionDeLaValidation<P extends Piece>(
  selection: readonly P[], juge: JugeDeLaValidation, doublons: ReadonlyMap<string, readonly PiecePourDoublon[]>,
): SelectionDeLaValidation<P> {
  const sansMontant = selection.filter((p) => p.montant_ttc == null)
  const lot = validationEnLot(selection.filter((p) => p.montant_ttc != null), juge)
  const aSignaler = lot.aValider.flatMap((piece) => {
    if (piece.statut !== 'a_valider') return []
    const motifs: string[] = []
    if (!piece.date_piece) motifs.push('sans date : elle n’entre dans aucun exercice tant qu’elle n’en a pas')
    if (piece.confiance === 'basse') motifs.push(`confiance basse de la lecture (${formatMoney(piece.montant_ttc)}) : un champ est peut-être faux`)
    const autres = doublons.get(piece.id) ?? []
    if (autres.length > 0) motifs.push(`doublon probable de ${autres.map((a) => `« ${a.nom_fichier} »`).join(', ')}`)
    return motifs.length === 0 ? [] : [{ piece, motifs }]
  })
  return {
    aValider: lot.aValider,
    ecartees: [...sansMontant.map((piece) => ({ piece, raison: RAISON_SANS_MONTANT })), ...lot.ecartees],
    aSignaler,
  }
}

/** Le texte de la confirmation, qui nomme ce qui mérite un regard ; nul quand rien ne le mérite — l'envoi part comme hier. */
export function confirmationDeLaSelection<P extends Pick<Piece, 'nom_fichier'>>(
  nbAValider: number, aSignaler: readonly PieceASignaler<P>[],
): string | null {
  if (aSignaler.length === 0) return null
  const tete = aSignaler.length === 1 ? 'L’une d’elles mérite un regard' : `${aSignaler.length} d’entre elles méritent un regard`
  const lignes = aSignaler.slice(0, 10).map((s) => `• ${s.piece.nom_fichier} — ${s.motifs.join(' ; ')}`)
  return `Valider ${nbAValider} pièce${nbAValider > 1 ? 's' : ''} ?\n\n${tete} avant :\n${lignes.join('\n')}`
    + (aSignaler.length > 10 ? `\n… et ${aSignaler.length - 10} autre(s)` : '')
    + '\n\nOK valide toute la sélection ; Annuler ne valide rien, pour les ouvrir une à une.'
}
