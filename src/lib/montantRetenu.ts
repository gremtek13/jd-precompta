import type { Piece } from './types'

// QUEL MONTANT D'UNE PIÈCE COMPTE — HT OU TTC — ET CE N'EST PAS UN CHOIX DE PRÉSENTATION.
//
// Un professionnel NON assujetti à la TVA (exonéré, comme les soins des auxiliaires médicaux, ou en
// franchise en base) ne récupère pas la TVA qu'il paie : elle « constitue un élément du prix de
// revient » et se déduit AVEC la dépense (BOI-BNC-BASE-40-60-20 § 90). Sa dépense est le TTC. La
// comptabilité hors taxes, elle, est une OPTION réservée aux contribuables ASSUJETTIS
// (BOI-BNC-BASE-20-10-30 § 60) : c'est celle que l'application applique à un dossier assujetti, la
// TVA passant alors par les comptes 445660 (déductible) et 445710 (collectée).
//
// TOUTE L'APPLICATION RETENAIT LE HT DÈS QU'IL ÉTAIT LU, sans regarder le dossier — la 2035, la
// situation intermédiaire, l'estimation, et la génération des écritures, qui ventilait la TVA en
// 445660 pour un dossier exonéré. Mesuré le 28/09/2026 sur le dossier `test`, une infirmière
// exonérée : ses 10 achats validés de 2025 comptaient 852,00 € de dépenses pour 1 022,40 € payés, soit
// 170,40 € de TVA non récupérable absents de la 2035 — un bénéfice surévalué d'autant, sur une
// déclaration signée, et un revenu brut social trop haut pour l'estimation des cotisations. La règle
// était pourtant écrite, dans un commentaire de la Checklist : « sur un dossier non assujetti c'est
// le TTC — donc la charge ».
//
// Deux fonctions, un seul endroit : ce qu'on retient (`montantRetenu`) et la part qui passe par les
// comptes de TVA (`tvaVentilee`). Pour une pièce cohérente (HT + TVA = TTC), leur somme est ce que la
// pièce a coûté ou rapporté, pour les deux statuts : c'est ce qui garde une écriture équilibrée face
// au mouvement bancaire.
//
// POUR UN ASSUJETTI, LA RÈGLE EST CELLE D'AVANT, À L'IDENTIQUE : le HT dès qu'il est lu, sinon le TTC
// moins la TVA. Ce correctif ne change que le dossier exonéré. Une pièce d'assujetti dont le HT et le
// TTC diffèrent sans TVA lue est incohérente ; ce n'est pas ici qu'on la devine, c'est la Checklist
// qui la signale (`piecesSansTva`).

type Montants = Pick<Piece, 'montant_ht' | 'montant_tva' | 'montant_ttc'>

const auCentime = (montant: number) => Math.round(montant * 100) / 100

// La TVA qui passe par les comptes de TVA : celle de la pièce pour un assujetti, rien pour un
// dossier exonéré — il ne la collecte pas et ne la récupère pas.
export function tvaVentilee(piece: Montants, assujettiTva: boolean): number {
  return assujettiTva ? piece.montant_tva ?? 0 : 0
}

// Le montant qui entre en recette ou en dépense. Null quand on ne peut pas le connaître : un TTC
// absent sur un dossier exonéré ne se remplace pas par le HT, ce serait retirer la TVA qu'on paie.
export function montantRetenu(piece: Montants, assujettiTva: boolean): number | null {
  const { montant_ht: ht, montant_tva: tva, montant_ttc: ttc } = piece
  if (!assujettiTva) {
    if (ttc != null) return ttc
    return ht != null && tva != null ? auCentime(ht + tva) : null
  }
  if (ht != null) return ht
  return ttc != null ? auCentime(ttc - (tva ?? 0)) : null
}
