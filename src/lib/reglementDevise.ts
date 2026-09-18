import { supabase } from './supabase'
import { DEVISE_PIVOT, reglerSurMontantReel } from './devises'
import type { LigneBancaire, Piece } from './types'

// Règle définitivement une pièce en devise étrangère sur le mouvement bancaire qui la paie.
//
// C'est l'aboutissement de la conversion, et ce qui rend le cours du jour facultatif : la valeur
// posée au dépôt au taux BCE n'est qu'un provisoire, le chiffre juste est celui que la banque a
// réellement débité. En BNC la dépense déductible est ce qui a quitté le compte — spread et frais de
// change compris — là où le taux de référence n'en est qu'une approximation à quelques pourcents.
//
// Appelée au rapprochement, avant la contrepartie comptable : celle-ci reprend les montants de la
// pièce, et les écrirait donc avec la valeur provisoire si l'ordre était inversé.
//
// Ne touche à rien d'autre qu'une pièce en devise déjà rapprochée d'un mouvement : une pièce en euros
// n'a pas de conversion à régler, et une pièce dont le montant d'origine n'a pas été lu n'a rien à
// partir de quoi déduire un taux.
export async function reglerPieceSurBanque(piece: Piece, ligne: LigneBancaire): Promise<Piece> {
  if (piece.devise === DEVISE_PIVOT || !piece.devise) return piece
  if (piece.montant_devise == null) return piece

  const regle = reglerSurMontantReel(piece, piece.montant_devise, ligne.montant)
  if (!regle) return piece

  const { error } = await supabase
    .from('pieces')
    .update({
      montant_ht: regle.montant_ht,
      montant_tva: regle.montant_tva,
      montant_ttc: regle.montant_ttc,
      taux_change: regle.taux_change,
      conversion_source: 'banque',
    })
    .eq('id', piece.id)

  // Échoue sans faire échouer le rapprochement, qui lui est déjà écrit : la pièce garde sa valeur
  // provisoire, ce qui est faux de quelques centimes, là où remonter l'erreur ici déferait un
  // rapprochement correct. L'écart reste visible — la pièce est toujours marquée « provisoire ».
  if (error) {
    console.error('Règlement de la pièce sur le montant bancaire échoué:', error)
    return piece
  }

  return { ...piece, ...regle, conversion_source: 'banque' }
}
