import { supabase } from './supabase'
import { DEVISE_PIVOT, reglerSurMontantReel } from './devises'
import { alignerMontantsSurBanque, ecartAvecBanque } from './alignementBanque'
import type { LigneBancaire, Piece } from './types'

// Règle définitivement une pièce sur le mouvement bancaire qui la paie.
//
// DEUX CAS, ET UN SEUL EST SANS SEUIL. En DEVISE, la valeur posée au dépôt au taux BCE n'est qu'un
// provisoire : le débit réel est indéniablement meilleur, quel que soit l'écart. En EUROS, la pièce
// porte déjà un montant lu sur un document, donc on n'aligne que sous le seuil — au-delà c'est
// presque toujours un paiement partiel ou groupé, et `rapprochementsEcartImportant` le SIGNALE
// plutôt que de l'écraser (décision du cabinet, 23/09/2026 ; voir alignementBanque.ts).
//
// Le nom du module a changé avec ce second cas : `reglementDevise` aurait menti sur ce qu'il fait,
// et c'est le piège que ce dépôt nomme sous « un nom qui ment sur son filtre ».
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
  const regle = piece.devise && piece.devise !== DEVISE_PIVOT
    ? reglerPieceEnDevise(piece, ligne)
    : reglerPieceEnEuros(piece, ligne)
  if (!regle) return piece

  const { error } = await supabase
    .from('pieces')
    .update({
      montant_ht: regle.montant_ht,
      montant_tva: regle.montant_tva,
      montant_ttc: regle.montant_ttc,
      // Une pièce en euros n'a AUCUN taux de change à poser, et lui en écrire un la ferait passer
      // pour convertie — donc afficher un cours qui n'a jamais existé sur un document en euros.
      ...(regle.taux_change != null ? { taux_change: regle.taux_change, conversion_source: 'banque' } : {}),
    })
    .eq('id', piece.id)

  // Échoue sans faire échouer le rapprochement, qui lui est déjà écrit : la pièce garde sa valeur
  // provisoire, ce qui est faux de quelques centimes, là où remonter l'erreur ici déferait un
  // rapprochement correct. L'écart reste visible — la pièce est toujours marquée « provisoire ».
  if (error) {
    console.error('Règlement de la pièce sur le montant bancaire échoué:', error)
    return piece
  }

  return regle.taux_change != null
    ? { ...piece, ...regle, conversion_source: 'banque' }
    : { ...piece, montant_ht: regle.montant_ht, montant_tva: regle.montant_tva, montant_ttc: regle.montant_ttc }
}

// Le cas d'origine : un provisoire au taux BCE remplacé par le débit réel, sans seuil.
function reglerPieceEnDevise(piece: Piece, ligne: LigneBancaire) {
  if (piece.montant_devise == null) return null
  return reglerSurMontantReel(piece, piece.montant_devise, ligne.montant)
}

// Le cas ajouté le 23/09/2026 : la banque fait foi SOUS LE SEUIL. Au-delà, on ne touche à rien —
// c'est `rapprochementsEcartImportant` qui le dit, et le montant d'origine reste intact.
function reglerPieceEnEuros(piece: Piece, ligne: LigneBancaire) {
  const ecart = ecartAvecBanque(piece, ligne)
  if (!ecart || !ecart.alignable) return null
  return { ...alignerMontantsSurBanque(piece, ligne.montant), taux_change: null as number | null }
}
