import type { LigneBancaire, Piece } from './types'
import { DEVISE_PIVOT, type MontantsPiece } from './devises'

// Alignement d'une pièce EN EUROS sur le mouvement bancaire qui la paie.
//
// Décision du cabinet (23/09/2026, « Décisions en attente ») : la banque fait foi, mais SOUS UN
// SEUIL seulement. Ce n'est pas une prudence de forme, c'est ce qui sépare deux situations que les
// données ne distinguent pas :
//
//   - un ÉCART FAIBLE (frais bancaire, arrondi, escompte de règlement) — la banque a raison, et la
//     dépense déductible en BNC est ce qui a quitté le compte ;
//   - un ÉCART LARGE — c'est presque toujours un PAIEMENT PARTIEL ou un règlement GROUPÉ, et
//     aligner reviendrait à enregistrer une facture de 1 000 € comme une dépense de 500 €, sur une
//     pièce le plus souvent déjà validée, sans rien pour le rattraper ensuite.
//
// Le cas de la DEVISE reste à part et sans seuil (voir reglementBanque.ts) : là, le montant en euros
// n'a jamais été qu'un provisoire au taux BCE, donc le débit réel est indéniablement meilleur. Ici la
// pièce porte déjà un montant que quelqu'un a lu sur un document.
//
// LE SEUIL EST RELATIF ET PLAFONNÉ. Relatif parce qu'un centime sur 12 € et un centime sur 12 000 €
// ne disent pas la même chose ; plafonné parce que 2 % d'une grosse facture (100 € sur 5 000 €) est
// largement de quoi couvrir un acompte, ce que le seuil ne doit jamais absorber.
// Pas de PLANCHER, et c'est mesuré plutôt que supposé : 2 % couvre déjà un centime dès 0,50 €, et
// aucune facture réelle n'est en dessous.
export const SEUIL_ALIGNEMENT_RELATIF = 0.02
export const SEUIL_ALIGNEMENT_PLAFOND_EUR = 5

export function seuilAlignement(montantPiece: number): number {
  return Math.min(Math.abs(montantPiece) * SEUIL_ALIGNEMENT_RELATIF, SEUIL_ALIGNEMENT_PLAFOND_EUR)
}

export interface EcartBanque {
  montantPiece: number
  montantBanque: number
  // Toujours positif — c'est une distance, pas un solde. Le SENS n'est pas une information ici :
  // une pièce d'achat est positive et son mouvement négatif, un avoir l'inverse (voir
  // reglerSurMontantReel), donc comparer les valeurs absolues est la seule forme qui vaille des
  // deux côtés.
  ecart: number
  seuil: number
  alignable: boolean
}

// Rend `null` quand la question ne se pose pas : pièce en devise (traitée à part, sans seuil),
// montant non lu (rien à comparer), ou mouvement à zéro.
export function ecartAvecBanque(piece: Piece, ligne: LigneBancaire): EcartBanque | null {
  if (piece.devise && piece.devise !== DEVISE_PIVOT) return null
  if (piece.montant_ttc == null) return null
  if (!ligne.montant) return null

  const montantPiece = Math.abs(piece.montant_ttc)
  const montantBanque = Math.abs(ligne.montant)
  const ecart = Math.round(Math.abs(montantBanque - montantPiece) * 100) / 100
  const seuil = seuilAlignement(montantPiece)
  return { montantPiece, montantBanque, ecart, seuil, alignable: ecart > 0 && ecart <= seuil }
}

// Réécrit les trois montants sur le débit réel, en conservant la PROPORTION de TVA que le document
// annonce — même règle que `reglerSurMontantReel` pour les devises, et pour la même raison : c'est
// le taux lu sur la facture qui est juste, pas un taux qu'on recalculerait depuis un montant arrondi.
//
// Le SIGNE reste celui de la pièce : un achat est positif sur la pièce et négatif au relevé. Le
// reprendre de la ligne retournerait chaque montant.
export function alignerMontantsSurBanque(montants: MontantsPiece, montantBanque: number): MontantsPiece {
  const signe = Math.sign(montants.montant_ttc ?? 1) || 1
  const ttc = Math.round(Math.abs(montantBanque) * 100) / 100 * signe

  const proportionTva = montants.montant_tva != null && montants.montant_ttc
    ? montants.montant_tva / montants.montant_ttc
    : null
  if (proportionTva == null) {
    return { montant_ht: montants.montant_ht, montant_tva: montants.montant_tva, montant_ttc: ttc }
  }
  const tva = Math.round(ttc * proportionTva * 100) / 100
  return { montant_ht: Math.round((ttc - tva) * 100) / 100, montant_tva: tva, montant_ttc: ttc }
}
