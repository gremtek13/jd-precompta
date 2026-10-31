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
export function ecartAvecBanque(piece: Piece, ligne: Pick<LigneBancaire, 'montant'>): EcartBanque | null {
  if (piece.devise && piece.devise !== DEVISE_PIVOT) return null
  if (piece.montant_ttc == null) return null
  if (!ligne.montant) return null

  const montantPiece = Math.abs(piece.montant_ttc)
  const montantBanque = Math.abs(ligne.montant)
  const ecart = Math.round(Math.abs(montantBanque - montantPiece) * 100) / 100
  const seuil = seuilAlignement(montantPiece)
  return { montantPiece, montantBanque, ecart, seuil, alignable: ecart > 0 && ecart <= seuil }
}

// CE QU'ONT PAYÉ, ENSEMBLE, LES PAIEMENTS D'UNE PIÈCE : leur somme SIGNÉE, en centimes, et le sens dans lequel elle la
// règle. Une seule réponse pour la 2035, la CA3, les écritures (`partsDesPaiements`, lib/rattachement.ts), ce qu'il
// reste à régler (`resteARegler`), la pièce payée de trop (`piecesPayeesEnTrop`, lib/reglementGroupe.ts) et le solde
// ci-dessous — la même question, et deux réponses divergeraient.
//
// SIGNÉE, ET NON PLUS EN VALEUR ABSOLUE (relecture du 31/10/2026). Un prélèvement de 1 200 € rejeté puis repris — le
// débit du 20/12, le crédit du rejet le 28/12, le débit du 05/01, tous rapprochés de la même prime — était « payé »
// 3 600 € : chaque mouvement portait un tiers de la pièce, 800 € comptaient en 2025 pour 400 € en 2026, et la pièce
// passait pour payée de 2 400 € de trop. Signée, la pièce est payée 1 200 € ; le rejet DÉFAIT le prélèvement qu'il
// suit, au lieu de la payer une fois de plus.
//
// LE SENS EST CELUI DE LA SOMME, pas celui que le type de la pièce attend (`signeReglant`) : des paiements tous dans le
// même sens rendent exactement ce que rendait la valeur absolue, quel que soit ce sens — un remboursement fournisseur
// rangé en achat, une note de frais réglée par un crédit restent ce qu'ils étaient. Seuls des paiements de SENS
// CONTRAIRES changent : chacun compte alors, dans `partsDesPaiements`, pour son montant rapporté à ce sens — négatif pour
// le mouvement qui défait. Une somme nulle (un prélèvement rejeté et pas encore repris) ne paie rien : sens 0, la pièce
// n'a pas de paiement net.
export interface PaiementNet {
  centimes: number
  sens: -1 | 0 | 1
}

export function paiementNet(paiements: readonly { montant: number }[]): PaiementNet {
  // En centimes entiers : sommés en flottants, −1 200 + 1 200 − 1 200 resterait juste, mais trois paiements de 0,10 €
  // ne feraient pas 0,30 €.
  const net = paiements.reduce((s, p) => s + Math.round(p.montant * 100), 0)
  return { centimes: Math.abs(net), sens: Math.sign(net) as -1 | 0 | 1 }
}

// CE QUE LES PAIEMENTS D'UNE PIÈCE LAISSENT À PAYER, ou ont payé de trop. L'écart se juge sur le TOTAL des
// paiements de la pièce — ses mouvements rapprochés et les parts des virements groupés qui la règlent
// (`paiementsDesPieces`) —, jamais mouvement par mouvement : une facture de 1 000 € réglée par un acompte de
// 500 € puis par la part d'un virement n'a aucun écart, alors que chacun de ses deux paiements en a un de
// 500 €. Comparer chaque mouvement à la pièce criait deux fois sur une pièce réglée, et refusait la validation
// de son exercice.
export interface SoldeDesPaiements {
  montantPiece: number
  paye: number
  // Au centime et signé : positif, ce qui reste à payer ; négatif, ce qui a été payé de trop.
  reste: number
  seuil: number
}

// `null` quand la question ne se pose pas : une pièce en devise (son montant en euros n'est qu'un provisoire au
// cours de la BCE, et l'écart de change ferait passer un règlement complet pour partiel — la règle de
// `ecartAvecBanque`), un montant non lu, ou aucun paiement : la pièce n'est pas payée en partie, elle n'est pas
// payée du tout, ce que disent d'autres contrôles.
export function soldeDesPaiements(
  piece: Pick<Piece, 'devise' | 'montant_ttc'>,
  paiements: readonly { montant: number }[],
): SoldeDesPaiements | null {
  if (piece.devise && piece.devise !== DEVISE_PIVOT) return null
  if (piece.montant_ttc == null) return null
  // La somme SIGNÉE (`paiementNet`) : un prélèvement rejeté puis repris n'a payé la pièce qu'une fois. Nette nulle — un
  // rejet qui n'a pas encore été repris —, la pièce n'est pas payée : rien à dire ici, et la 2035 la date à sa facture,
  // en le disant (`sans_paiement`).
  const payeCentimes = paiementNet(paiements).centimes
  if (payeCentimes === 0) return null
  const pieceCentimes = Math.round(Math.abs(piece.montant_ttc) * 100)
  return {
    montantPiece: pieceCentimes / 100,
    paye: payeCentimes / 100,
    reste: (pieceCentimes - payeCentimes) / 100,
    seuil: seuilAlignement(piece.montant_ttc),
  }
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
