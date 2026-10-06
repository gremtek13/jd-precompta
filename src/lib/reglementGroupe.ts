import { seuilAlignement } from './alignementBanque'
import { refusEcritSurUnCompteDeBilan } from './classementsDuMouvement'
import type { MouvementBancaire } from './affectationBanque'
import { DEVISE_PIVOT } from './devises'
import { formatMoney } from './format'
import type { PaiementDePiece, PaiementsDesPieces, PartReglee } from './rattachement'
import type { LigneBancaire, Piece } from './types'

// UN MOUVEMENT QUI RÈGLE PLUSIEURS PIÈCES — ligne 26 de la feuille de route. Un virement fournisseur qui
// solde trois factures, un règlement client qui en paie deux, un avoir déduit d'un paiement : un mouvement
// ne se rapprochait que d'UNE pièce, et les autres restaient sans paiement — comptées à leur date de facture
// dans la 2035, dans AUCUNE déclaration de TVA, et « à rapprocher » partout.
//
// LE GESTE EST MANUEL : l'opérateur choisit les pièces et la part de chacune, et leur somme est le
// mouvement. Aucun moteur ne propose de regroupement : mesuré le 19 puis le 30/09/2026, aucun mouvement des
// quatre dossiers ne vaut la somme de deux ou trois pièces sans paiement, donc rien sur quoi régler un tel
// moteur.
//
// UNE PART EST UN PAIEMENT DE SA PIÈCE (lib/rattachement.ts, `paiementsDesPieces`) : la 2035, la TVA et les
// écritures la lisent comme un rapprochement simple. Ici vivent les règles du geste lui-même : ce que la base
// refuserait, dit avant le clic ; le sens de chaque part ; ce qu'il reste à régler d'une pièce ; et les écarts
// qu'un autre chemin que la transaction de la base aurait pu laisser.

/** Le refus qu'un mouvement réglé en groupe oppose aux autres classements : affectation, virement
 *  personnel, échéance d'emprunt, ventilation. La base le tient par ses contraintes. */
export const REFUS_REGLE_EN_GROUPE = 'Ce mouvement règle plusieurs pièces : annule d’abord ce règlement groupé.'

/** Une part telle qu'elle part à la base : la pièce, et son montant SIGNÉ comme le relevé. */
export interface PartReglement {
  piece_id: string
  montant: number
}

type PieceReglable = Pick<Piece, 'id' | 'type_piece' | 'montant_ttc' | 'tiers' | 'nom_fichier' | 'devise' | 'montant_devise'>

const centimes = (euros: number) => Math.round(euros * 100)
const auCentime = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

// Le nom d'une pièce dans un message, comme la base l'écrit : son tiers, les blancs réduits, sinon son fichier.
export function nomDeLaPiece(piece: Pick<Piece, 'tiers' | 'nom_fichier'>): string {
  return piece.tiers?.trim().replace(/\s+/g, ' ') || piece.nom_fichier
}

// LE SENS QUI RÈGLE UNE PIÈCE : une entrée pour une facture de vente, une sortie pour une dépense — et
// l'inverse pour un avoir, dont le montant est négatif. C'est ce qui permet de déduire un avoir d'un
// paiement : sa part va dans l'autre sens que celle de la facture qu'il diminue. Zéro pour une pièce dont le
// montant n'a pas été lu : rien ne dit alors comment la régler.
export function signeReglant(piece: Pick<Piece, 'type_piece' | 'montant_ttc'>): -1 | 0 | 1 {
  const signe = Math.sign(piece.montant_ttc ?? 0)
  if (signe === 0) return 0
  return (piece.type_piece === 'vente' ? signe : -signe) as -1 | 1
}

// L'écran fait saisir chaque part POSITIVE, dans le sens qui règle sa pièce ; la base la reçoit signée comme
// le relevé. La conversion ne s'écrit qu'ici, dans les deux sens.
export function partSigneeDe(piece: Pick<Piece, 'type_piece' | 'montant_ttc'>, saisie: number): number {
  return saisie * signeReglant(piece)
}

export function partSaisieDe(piece: Pick<Piece, 'type_piece' | 'montant_ttc'>, montant: number): number {
  const signe = signeReglant(piece)
  return signe === 0 ? Math.abs(montant) : montant * signe
}

// CE QU'IL RESTE À RÉGLER D'UNE PIÈCE, hors ce que CE mouvement en paie déjà — le régler de nouveau
// remplace ses parts. Les paiements comptent en valeur absolue, comme la part de chacun dans
// `partsDesPaiements` (lib/rattachement.ts) : c'est la même question, et deux réponses divergeraient.
export function resteARegler(
  piece: Pick<Piece, 'montant_ttc'>,
  paiements: readonly Pick<PaiementDePiece, 'id' | 'montant'>[],
  saufMouvement: string | null,
): number {
  const paye = paiements.filter((p) => p.id !== saufMouvement).reduce((s, p) => s + Math.abs(p.montant), 0)
  return Math.max(0, centimes(Math.abs(piece.montant_ttc ?? 0) - paye) / 100)
}

// Pourquoi ce mouvement ne peut pas régler ces pièces ainsi, dit AVANT d'écrire. La base refait les mêmes
// refus (`regler_pieces_par_mouvement`), dans le même ordre, plus celui d'une écriture déjà validée, que
// l'écran ne lit pas : l'écran les dit pour qu'on ne clique pas pour rien, la base pour qu'aucun chemin ne
// les contourne. Un mouvement déjà réglé en groupe n'est pas refusé : un nouveau règlement remplace le
// précédent.
//
// UN REFUS DE PLUS QUE LA BASE : une part qui dépasse ce qu'il reste à régler de sa pièce, au-delà de
// l'écart d'alignement (lib/alignementBanque.ts). Une pièce payée deux fois compte UNE fois dans la 2035
// (`partsDesPaiements` plafonne sa part à la pièce), donc l'argent versé en trop n'y serait nulle part —
// et son écriture resterait déséquilibrée. Sous l'écart, c'est un frais, qui ne fait pas compter la pièce
// plus d'une fois.
//
// SAUF UNE PIÈCE EN DEVISE DONT CETTE PART EST LE SEUL PAIEMENT : son montant en euros n'est qu'un
// provisoire au cours de la BCE, que le débit réel dépasse souvent de l'écart de change de la banque, et la
// part DEVIENT son montant — le règlement la règle sur la banque (lib/reglementBanque.ts). La comparer au
// provisoire refuserait un règlement juste. Payée aussi ailleurs, elle garde la comparaison : la part n'en
// est alors qu'une fraction, et rien ne la réaligne.
export function refusReglementGroupe(
  ligne: MouvementBancaire,
  parts: readonly PartReglement[],
  pieces: readonly PieceReglable[],
  paiements: PaiementsDesPieces,
): string | null {
  const surUnCompteDeBilan = refusEcritSurUnCompteDeBilan(ligne)
  if (surUnCompteDeBilan) return surUnCompteDeBilan
  if (ligne.piece_id || ligne.cotisation_id || ligne.categorie_id || ligne.emprunt_id || ligne.ventilee || ligne.prelevement_personnel) {
    return 'Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie, ventilé ou classé en virement personnel : annule d’abord ce classement.'
  }
  if (ligne.montant === 0) return 'Un mouvement de zéro euro ne règle rien.'
  if (parts.length < 2) return 'Un règlement groupé porte au moins deux pièces.'
  for (const p of parts) {
    if (!p.piece_id) return 'Chaque part désigne une pièce.'
    if (!Number.isFinite(p.montant) || p.montant === 0 || !auCentime(p.montant)) {
      return 'Chaque part porte un montant non nul, au centime.'
    }
  }
  if (new Set(parts.map((p) => p.piece_id)).size !== parts.length) {
    return 'La même pièce figure deux fois : réunis ses parts en une.'
  }
  const parId = new Map(pieces.map((p) => [p.id, p]))
  if (parts.some((p) => !parId.has(p.piece_id))) return 'Cette pièce n’existe pas pour ce dossier.'
  // La première pièce fautive dans l'ordre des parts, comme la base.
  const sansMontant = parts.map((p) => parId.get(p.piece_id)!).find((piece) => !piece.montant_ttc)
  if (sansMontant) {
    return `La pièce « ${nomDeLaPiece(sansMontant)} » n’a pas de montant lu : saisis-le avant de la régler avec d’autres.`
  }
  const aContreSens = parts.find((p) => Math.sign(p.montant) !== signeReglant(parId.get(p.piece_id)!))
  if (aContreSens) {
    return `La part de la pièce « ${nomDeLaPiece(parId.get(aContreSens.piece_id)!)} » va dans le mauvais sens : `
      + 'une dépense se règle par une sortie, une recette par une entrée, un avoir à l’inverse.'
  }
  // Les montants dits dans le sens du mouvement, comme l'écran les fait saisir : « 800,00 € au lieu des
  // 900,00 € » d'un paiement, pas « −800,00 € au lieu des −900,00 € ».
  const somme = parts.reduce((s, p) => s + centimes(p.montant), 0)
  if (somme !== centimes(ligne.montant)) {
    return `Les parts font ${formatMoney((somme / 100) * Math.sign(ligne.montant))} au lieu des ${formatMoney(Math.abs(ligne.montant))} du mouvement.`
  }
  for (const p of parts) {
    const piece = parId.get(p.piece_id)!
    const autres = (paiements.get(piece.id) ?? []).filter((m) => m.id !== ligne.id)
    if (seraRegleeSurLaBanque(piece) && autres.length === 0) continue
    const reste = resteARegler(piece, paiements.get(piece.id) ?? [], ligne.id)
    if (centimes(Math.abs(p.montant)) > centimes(reste + seuilAlignement(piece.montant_ttc ?? 0))) {
      return `La part de la pièce « ${nomDeLaPiece(piece)} » dépasse ce qu’il en reste à régler (${formatMoney(reste)}) : `
        + 'une pièce ne se paie pas deux fois.'
    }
  }
  return null
}

// LE SECOND PAIEMENT D'UNE PIÈCE PAYÉE EN PARTIE — un acompte, puis le solde par un autre virement qui ne paie qu'elle.
// La fiche d'un mouvement l'offre au choix pour son reste (`restesAReglerDesPieces`, lib/controles.ts) ; ce qui
// refuserait une part de règlement groupé le refuse ici aussi, dit avant le clic : un mouvement qui va dans le mauvais
// sens, ou qui dépasse ce qu'il reste à régler au-delà de l'écart d'alignement — une pièce ne se paie pas deux fois, et
// l'argent versé en trop ne compterait nulle part. Un virement qui règle aussi d'autres pièces se répartit par le
// règlement groupé.
export function refusSecondPaiement(
  ligne: Pick<LigneBancaire, 'id' | 'montant'>,
  piece: Pick<Piece, 'type_piece' | 'montant_ttc' | 'tiers' | 'nom_fichier'>,
  paiementsDeLaPiece: readonly Pick<PaiementDePiece, 'id' | 'montant'>[],
): string | null {
  if (Math.sign(ligne.montant) !== signeReglant(piece)) {
    return `Ce mouvement va dans le mauvais sens pour la pièce « ${nomDeLaPiece(piece)} » : `
      + 'une dépense se règle par une sortie, une recette par une entrée, un avoir à l’inverse.'
  }
  const reste = resteARegler(piece, paiementsDeLaPiece, ligne.id)
  if (centimes(Math.abs(ligne.montant)) > centimes(reste + seuilAlignement(piece.montant_ttc ?? 0))) {
    return `Ce mouvement dépasse ce qu’il reste à régler de la pièce « ${nomDeLaPiece(piece)} » (${formatMoney(reste)}) : `
      + 'une pièce ne se paie pas deux fois. Un virement qui en règle aussi d’autres se répartit par « Régler plusieurs pièces ».'
  }
  return null
}

// Une pièce en devise dont on connaît le montant d'origine : le paiement qui la règle seul remplace son
// provisoire en euros par le débit réel (`reglerPieceSurBanque`). Sans montant d'origine, rien ne la
// réaligne, et elle reste jugée sur ses euros.
function seraRegleeSurLaBanque(piece: Pick<Piece, 'devise' | 'montant_devise'>): boolean {
  return !!piece.devise && piece.devise !== DEVISE_PIVOT && piece.montant_devise != null
}

// Ce qu'il reste à répartir entre les parts, dans le sens du mouvement : positif tant que les parts ne font
// pas le mouvement, négatif quand elles le dépassent. L'écran le montre à chaque frappe.
export function resteARepartir(ligne: Pick<LigneBancaire, 'montant'>, parts: readonly PartReglement[]): number {
  const somme = parts.reduce((s, p) => s + centimes(p.montant), 0)
  const reste = ((centimes(ligne.montant) - somme) / 100) * (Math.sign(ligne.montant) || 1)
  // Jamais « −0,00 € » à l'écran : un reste nul l'est dans les deux sens.
  return reste === 0 ? 0 : reste
}

export type RaisonIncoherenceGroupe = 'part_sans_piece' | 'somme_differente' | 'parts_sans_reglement'

export interface ReglementGroupeIncoherent {
  ligne: MouvementBancaire
  raison: RaisonIncoherenceGroupe
  // La somme en cause, signée comme le relevé : ce que les parts sans pièce payaient, l'écart entre le
  // mouvement et ses parts, ou ce que portent des parts sans règlement.
  montant: number
}

// UN RÈGLEMENT GROUPÉ QUE SES PARTS NE JUSTIFIENT PLUS.
//
// LE CAS RÉEL EST UNE PIÈCE SUPPRIMÉE DEPUIS : sa part reste (`on delete set null`) avec son montant, et
// cette somme du virement ne justifie plus rien — la forme groupée de `mouvementRapprocheSansObjet`, qui la
// dit pour un rapprochement simple. Supprimer une pièce reste possible, comme pour un rapprochement simple.
//
// Les deux autres sont défensifs : la transaction de la base écrit le drapeau et les parts ensemble et
// vérifie la somme, donc une somme différente, ou des parts sur un mouvement qui ne règle plus en groupe,
// ne viennent que d'un autre chemin. À ne regarder que sur des lectures COMPLÈTES des mouvements et des
// parts — une part non lue passerait pour une part manquante —, et une part dont le mouvement n'a pas été
// lu n'est jugée sur rien : ce serait l'artefact de filtrage que `rupturesPisteAudit` refuse déjà de
// prendre pour une rupture.
export function reglementsGroupesIncoherents(
  lignes: readonly MouvementBancaire[],
  reglements: readonly PartReglee[],
): ReglementGroupeIncoherent[] {
  const parLigne = new Map<string, PartReglee[]>()
  for (const r of reglements) parLigne.set(r.ligne_bancaire_id, [...(parLigne.get(r.ligne_bancaire_id) ?? []), r])
  const incoherents: ReglementGroupeIncoherent[] = []
  for (const ligne of lignes) {
    const parts = parLigne.get(ligne.id) ?? []
    if (ligne.reglement_groupe && ligne.statut === 'rapprochee') {
      const sansPiece = parts.filter((p) => !p.piece_id)
      if (sansPiece.length > 0) {
        incoherents.push({ ligne, raison: 'part_sans_piece', montant: sansPiece.reduce((s, p) => s + centimes(p.montant), 0) / 100 })
      }
      const somme = parts.reduce((s, p) => s + centimes(p.montant), 0)
      if (somme !== centimes(ligne.montant)) {
        incoherents.push({ ligne, raison: 'somme_differente', montant: (centimes(ligne.montant) - somme) / 100 })
      }
    } else if (parts.length > 0) {
      incoherents.push({ ligne, raison: 'parts_sans_reglement', montant: parts.reduce((s, p) => s + centimes(p.montant), 0) / 100 })
    }
  }
  return incoherents
}

export interface PiecePayeeEnTrop {
  piece: Pick<Piece, 'id' | 'tiers' | 'nom_fichier' | 'montant_ttc'>
  paye: number
  enTrop: number
}

// UNE PIÈCE PAYÉE PLUS QUE SON MONTANT, au-delà de l'écart d'alignement : deux rapprochements, ou un
// rapprochement et la part d'un virement groupé, sur la même facture. La 2035 la compte UNE fois
// (`partsDesPaiements` plafonne sa part à la pièce), donc l'argent versé en trop n'y est nulle part, et
// son écriture reste déséquilibrée. L'écran de règlement groupé le refuse ; ceci dit ce qu'un autre
// chemin aurait laissé passer. Seules les pièces FOURNIES sont examinées.
export function piecesPayeesEnTrop<P extends Pick<Piece, 'id' | 'tiers' | 'nom_fichier' | 'montant_ttc'>>(
  pieces: readonly P[],
  paiements: PaiementsDesPieces,
): (PiecePayeeEnTrop & { piece: P })[] {
  const resultat: (PiecePayeeEnTrop & { piece: P })[] = []
  for (const piece of pieces) {
    if (piece.montant_ttc == null) continue
    const paye = centimes((paiements.get(piece.id) ?? []).reduce((s, p) => s + Math.abs(p.montant), 0))
    const du = centimes(Math.abs(piece.montant_ttc))
    const enTrop = paye - du
    if (enTrop > centimes(seuilAlignement(piece.montant_ttc))) resultat.push({ piece, paye: paye / 100, enTrop: enTrop / 100 })
  }
  return resultat
}
