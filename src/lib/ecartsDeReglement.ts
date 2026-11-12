import { paiementNet, seuilAlignement } from './alignementBanque'
import { DEVISE_PIVOT, ECART_CHANGE_TOLERE } from './devises'
import { compteDeTiers, lignesEngagementPourPiece, lignesReglementEngagement } from './engagement'
import { ECARTS_DE_REGLEMENT_PREVUS } from './rolesDuChange'
import type { BanquesDuDossier } from './banqueDuMouvement'
import type { CibleComptable, LigneAGenerer } from './ecritures'
import type { PlanComptable } from './planComptable'
import type { CompteNotesDeFrais, LigneBancaire, ModeComptable, Piece } from './types'

// LE CHANGE ET LES FRAIS BANCAIRES À PART, EN ENGAGEMENT (ligne 31, 31-changeFrais ; 12/11/2026, derrière
// `ECARTS_DE_REGLEMENT_PREVUS`, lib/rolesDuChange.ts).
//
// Hier, le rapprochement réglait la pièce sur la banque (lib/reglementBanque.ts) — toujours en devise, sous le seuil
// min(2 %, 5 €) en euros — et réécrivait donc, en engagement, le montant de la FACTURE : la dette naît au cours du jour de
// la facture et ne se réévalue pas au paiement (PCG, art. 420-5). Le drapeau levé, une facture d'achat ou de vente en
// engagement garde son montant, et le règlement qui la SOLDE solde le compte de tiers (401, 404, 411) au montant de la
// facture ; l'écart avec la banque s'écrit à part, dans la même écriture (même mouvement, même date, même libellé) :
//
//   - une pièce en DEVISE : tout l'écart est de change — une perte au débit (`pertes_de_change`, 656 par défaut), un gain
//     au crédit (`gains_de_change`, 756) —, sans seuil, comme le règlement en devise d'hier (décision du 23/09/2026) : la
//     devise de la pièce est le signal lu. Ce qui, dans cet écart, serait un frais prélevé par la banque sur le virement,
//     rien ne le dit : CHG-Q2 ;
//   - une pièce en EUROS : aucun change possible. L'écart qui coûte à l'entreprise (un achat payé plus, une vente reçue
//     moins), sous le seuil des frais, va au 627 (`services_bancaires`) — la règle que tient déjà le mouvement des ventes
//     facturées (lib/ecrituresVentesFacturees.ts). Au-delà du seuil, c'est un paiement partiel ou groupé, et l'écart en
//     faveur de l'entreprise n'est pas un frais : l'un et l'autre restent au compte de tiers, comme hier (CHG-Q3).
//
// L'ÉCART SE JUGE SUR LE TOTAL des paiements de la pièce par le relevé (leur somme SIGNÉE, `paiementNet` : un rejet défait
// le paiement qu'il suit), et s'écrit sur le DERNIER (par date, puis identifiant), celui qui la solde ; les autres
// règlements s'écrivent comme hier. Une note de frais (le compte du dirigeant n'est pas une dette commerciale) et une
// pièce « autre » ne changent pas.
//
// La trésorerie (BNC, 2035) n'entre jamais ici : `lignesPourPiece` n'appelle ce module que pour un dossier en engagement.

type Mouvement = Pick<LigneBancaire, 'id' | 'date' | 'montant'>

export type NatureDeLEcart = 'frais_bancaires' | 'perte_de_change' | 'gain_de_change'

export interface EcartDuReglement {
  /** Le mouvement qui solde la pièce : le dernier de ses paiements par le relevé. */
  mouvementId: string
  /** En centimes, au sens du débit : positif, une charge (au débit) ; négatif, un produit (au crédit). Jamais nul. */
  centimes: number
  nature: NatureDeLEcart
}

const parDateEtIdentifiant = (a: Mouvement, b: Mouvement) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

/** Une facture d'achat ou de vente : la seule pièce dont un règlement porte un écart à part. */
function estUneFacture(piece: Pick<Piece, 'type_piece'>): boolean {
  return piece.type_piece === 'achat' || piece.type_piece === 'vente'
}

/**
 * Vrai quand le rapprochement ne doit plus régler la pièce sur la banque (lib/reglementBanque.ts) : le drapeau levé, une
 * facture d'un dossier en engagement — son écart s'écrit à part. Faux en trésorerie, toujours.
 */
export function seRegleSansReecriture(piece: Pick<Piece, 'type_piece'>, mode: ModeComptable): boolean {
  return ECARTS_DE_REGLEMENT_PREVUS && mode === 'engagement' && estUneFacture(piece)
}

/** L'écart qu'écrit le règlement qui solde la pièce, ou `null` : aucun, ou un écart qui reste au compte de tiers. */
export function ecartDuReglement(
  piece: Pick<Piece, 'type_piece' | 'devise' | 'montant_ttc'>, mouvements: readonly Mouvement[],
): EcartDuReglement | null {
  if (!estUneFacture(piece) || piece.montant_ttc == null) return null
  const payes = mouvements.filter((m) => m.montant !== 0)
  if (payes.length === 0 || paiementNet(payes).sens === 0) return null
  const ttc = Math.round(piece.montant_ttc * 100)
  // Ce que la facture porte au compte de tiers, au sens du débit : le 411 au débit d'une vente, le 401 au crédit d'un
  // achat (un avoir l'inverse) ; chaque règlement y porte l'opposé de son mouvement.
  const factureAuTiers = piece.type_piece === 'vente' ? ttc : -ttc
  const somme = payes.reduce((s, m) => s + Math.round(m.montant * 100), 0)
  // Des paiements qui ne vont pas dans le sens qui règle la facture (un remboursement rangé sur un achat) ne la soldent
  // pas : rien à part.
  if (ttc === 0 || Math.sign(somme) !== Math.sign(factureAuTiers)) return null
  const solde = factureAuTiers - somme
  if (solde === 0) return null
  const mouvementId = [...payes].sort(parDateEtIdentifiant).at(-1)!.id
  if (piece.devise && piece.devise !== DEVISE_PIVOT) {
    return { mouvementId, centimes: solde, nature: solde > 0 ? 'perte_de_change' : 'gain_de_change' }
  }
  if (solde < 0 || solde > Math.round(seuilAlignement(piece.montant_ttc) * 100)) return null
  return { mouvementId, centimes: solde, nature: 'frais_bancaires' }
}

/** Le compte de l'écart, au plan du dossier ; `undefined` pour un rôle du change que le plan lu ne porte pas. */
export function compteDeLEcart(nature: NatureDeLEcart, plan: PlanComptable): string | undefined {
  if (nature === 'frais_bancaires') return plan.services_bancaires
  return nature === 'perte_de_change' ? plan.pertes_de_change : plan.gains_de_change
}

// Le règlement du mouvement qui solde la pièce, son écart à part : la ligne de tiers perd l'écart, une ligne de l'écart
// le porte — l'écriture reste équilibrée, et la banque fait toujours exactement le montant du mouvement. `null` quand le
// plan ne porte pas le compte de l'écart.
function ajusterLeReglement(
  reglement: readonly LigneAGenerer[], ecart: EcartDuReglement, tiers: string, plan: PlanComptable,
): LigneAGenerer[] | null {
  const compte = compteDeLEcart(ecart.nature, plan)
  const ligneTiers = reglement.find((l) => l.compte === tiers)
  if (compte === undefined || ligneTiers === undefined) return null
  const tiersSigne = Math.round(ligneTiers.montant * 100) * (ligneTiers.sens === 'debit' ? 1 : -1) - ecart.centimes
  const { compte: _compte, sens: _sens, montant: _montant, ...base } = ligneTiers
  const ligneDeLEcart: LigneAGenerer = {
    ...base, compte, sens: ecart.centimes > 0 ? 'debit' : 'credit', montant: Math.abs(ecart.centimes) / 100,
  }
  return [
    ...reglement.flatMap((l): LigneAGenerer[] => {
      if (l !== ligneTiers) return [l]
      if (tiersSigne === 0) return []
      return [{ ...l, sens: tiersSigne > 0 ? 'debit' : 'credit', montant: Math.abs(tiersSigne) / 100 }]
    }),
    ligneDeLEcart,
  ]
}

/**
 * Tout ce qu'une pièce produit en engagement, le drapeau levé : `lignesEngagementPourPiece` (lib/engagement.ts), dont le
 * règlement qui solde la pièce porte son écart à part. Un compte de l'écart que le plan ne porte pas retient la pièce
 * entière (une liste vide), comme une banque qui ne se sait pas.
 */
export function lignesEngagementAvecEcarts(
  dossierId: string, piece: Piece, cible: CibleComptable, assujettiTva: boolean, compteNotesDeFrais: CompteNotesDeFrais,
  mouvements: readonly (Mouvement & { compte_bancaire_id?: string | null })[], plan: PlanComptable, banques: BanquesDuDossier,
): LigneAGenerer[] {
  const lignes = lignesEngagementPourPiece(dossierId, piece, cible, assujettiTva, compteNotesDeFrais, mouvements, plan, banques)
  const ecart = lignes.length === 0 ? null : ecartDuReglement(piece, mouvements)
  if (ecart === null) return lignes
  const tiers = compteDeTiers(piece, compteNotesDeFrais, cible.immobilisation, plan)
  const ajuste = ajusterLeReglement(lignes.filter((l) => l.ligne_bancaire_id === ecart.mouvementId), ecart, tiers, plan)
  if (ajuste === null) return []
  const premiere = lignes.findIndex((l) => l.ligne_bancaire_id === ecart.mouvementId)
  const autres = lignes.filter((l) => l.ligne_bancaire_id !== ecart.mouvementId)
  return [...autres.slice(0, premiere), ...ajuste, ...autres.slice(premiere)]
}

/**
 * Le règlement d'UN mouvement que le rapprochement écrit (lib/contrepartieBanque.ts), le drapeau levé : celui d'hier, son
 * écart à part s'il est le dernier des paiements de la pièce. `autres` : ses autres paiements par le relevé, lus aux
 * lignes de banque des règlements déjà écrits (`autresPaiementsDesReglements`). Un règlement écrit avant un paiement plus
 * récent garde l'écart qu'il portait : le contrôle des écritures le dit « à régénérer », et « Régénérer » le déplace.
 */
export function reglementDuMouvementAvecEcart(
  dossierId: string, piece: Piece, mouvement: Mouvement, autres: readonly Mouvement[], compteNotesDeFrais: CompteNotesDeFrais,
  immobilisation: boolean, plan: PlanComptable,
): LigneAGenerer[] {
  const reglement = lignesReglementEngagement(dossierId, piece, mouvement, compteNotesDeFrais, immobilisation, plan)
  if (reglement.length === 0) return reglement
  const ecart = ecartDuReglement(piece, [...autres.filter((a) => a.id !== mouvement.id), mouvement])
  if (ecart === null || ecart.mouvementId !== mouvement.id) return reglement
  return ajusterLeReglement(reglement, ecart, compteDeTiers(piece, compteNotesDeFrais, immobilisation, plan), plan) ?? []
}

/** Les autres paiements d'une pièce, lus aux lignes de banque de ses règlements déjà écrits : le débit d'une entrée
 *  d'argent, le crédit d'une sortie (lib/engagement.ts). */
export function autresPaiementsDesReglements(
  lignes: readonly { compte: string; ligne_bancaire_id: string | null; sens?: string; montant?: number; date?: string }[],
  comptesDeBanque: ReadonlySet<string>, paiementId: string,
): Mouvement[] {
  return lignes.flatMap((l) => (l.ligne_bancaire_id && l.ligne_bancaire_id !== paiementId && comptesDeBanque.has(l.compte)
    && (l.sens === 'debit' || l.sens === 'credit') && typeof l.montant === 'number' && typeof l.date === 'string'
    ? [{ id: l.ligne_bancaire_id, date: l.date, montant: l.sens === 'debit' ? l.montant : -l.montant }]
    : []))
}

/**
 * LA PIÈCE « PAYÉE EN TROP » QUE LE CHANGE EXPLIQUE (Checklist, préalables de la validation, Banque). Hier, le rapprochement
 * réalignait une pièce en devise sur son débit réel : payée une fois, elle ne l'était jamais plus que son montant. Le
 * drapeau levé, une facture en engagement garde le montant du jour de la facture (PCG, art. 420-5) et l'écart de change
 * s'écrit au 656 ou au 756 : la dire « payée plus que son montant — un paiement en double ? », en erreur, retiendrait la
 * validation d'un exercice juste. Elle se retire donc tant que l'excédent tient dans l'écart de change vraisemblable
 * (`ECART_CHANGE_TOLERE`, 5 %) ; au-delà — un vrai paiement en double —, elle reste dite. Baissé, en trésorerie, pour une
 * pièce en euros ou une note de frais : la liste telle quelle.
 */
export function sansLesEcartsDeChange<T extends { piece: Pick<Piece, 'type_piece' | 'devise' | 'montant_ttc'>; enTrop: number }>(
  liste: readonly T[], mode: ModeComptable,
): T[] {
  return liste.filter(({ piece, enTrop }) => !(seRegleSansReecriture(piece, mode) && piece.devise && piece.devise !== DEVISE_PIVOT
    && piece.montant_ttc != null && Math.round(enTrop * 100) <= Math.round(Math.abs(piece.montant_ttc) * ECART_CHANGE_TOLERE * 100)))
}
