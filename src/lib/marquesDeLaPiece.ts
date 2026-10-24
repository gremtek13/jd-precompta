import { justifieSonMouvement, type EncaissementLu } from './encaissementsFactures'
import type { LiensDeLaPiece, VerdictDuPont } from './exemplairesDesFactures'
import type { DesignationDeLaPiece, GesteDuJournal, Piece } from './types'

// CE QU'UNE PIÈCE DE VENTE EST, ET CE QUE SA FICHE EN SAIT (chantier EC-Q3, étape VF6c ; conception : HISTORIQUE.md, « VF6, LA
// JUMELLE INVERSÉE : LA CONCEPTION », § 3 g ; la base : « LA JUMELLE INVERSÉE, EN BASE »). Un module PUR — il ne lit rien,
// n'appelle personne — entre la lecture (lib/marquesDeLaPieceLecture.ts) et l'écran (pages/dossier/ExemplaireDeLaFacture.tsx,
// la section « Ce que cette pièce est » de la fiche d'une pièce) :
//   - ce que les refus de la jumelle inversée reçoivent (lib/exemplairesDesFactures.ts, `ContexteDesMarques`) et que l'écran
//     d'aujourd'hui n'avait pas : la bascule du dossier, le pont de la pièce sans sa désignation, ses liens au relevé et au
//     brouillon (G4), les factures d'un virement mixte classé (VF5H-Q1) — tout ou rien : une seule lecture partielle et le
//     contexte est « incomplet », et aucun geste ne s'offre ;
//   - le JOURNAL de la pièce (`designations_des_pieces`, VF6-Q3) : les gestes de ce dossier, dans l'ordre où ils ont été
//     faits, et ceux qui sont restés dans un autre dossier quand la pièce en vient (VF6B-Q1, tranchée le 24/10/2026 :
//     « les laisser, et le dire ») ; qui les a faits, nommé seulement d'après ce qui a été lu.

/** La marque de la pièce, telle que la fiche la relit après un geste : ce que les fonctions de la base changent. */
export type MarquesDeLaPiece = Pick<Piece,
  'id' | 'dossier_id' | 'type_piece' | 'statut' | 'nom_fichier' | 'facture_id' | 'vente_hors_des_factures' | 'updated_at'>

/** Les colonnes de cette relecture, chaîne pour chaîne celles de `MarquesDeLaPiece`. */
export const COLONNES_DES_MARQUES =
  'id, dossier_id, type_piece, statut, nom_fichier, facture_id, vente_hors_des_factures, updated_at'

/**
 * La pièce que la fiche montre : celle que l'écran appelant lui a donnée, ou — quand la fiche l'a relue elle-même après un
 * geste, et que cette relecture n'est pas plus ancienne — sa marque relue. L'écran appelant ne recopiait que la désignation
 * dans sa fiche ouverte (PiecesTab, `relirePiece`) ; il recopie aussi la déclaration depuis l'étape VF6e, et cette relecture
 * reste la garde de tout autre appelant.
 */
export function pieceAJour<P extends MarquesDeLaPiece>(piece: P, relue: MarquesDeLaPiece | null): P {
  if (relue === null || relue.id !== piece.id || relue.updated_at < piece.updated_at) return piece
  return { ...piece, ...relue }
}

/** Ce que la fiche a lu pour juger un geste de la jumelle inversée, en plus des factures et du gel que l'onglet lui donne. */
export interface ContexteLu {
  /** `dossiers.ventes_par_les_factures` : les factures du dossier sont la source de leurs ventes (étape VF2). */
  dossierBascule: boolean
  /** Le pont de la pièce SANS sa désignation (lib/ventesJumelles.ts), dans un dossier basculé ; « aucune » ailleurs, où
   *  aucun refus ne le lit (les rangs 8 et 9 de la désignation, la déclaration et G3 ne jugent qu'un dossier basculé). */
  pont: VerdictDuPont
  /** Ce qui lie la pièce au relevé et au brouillon (G4) ; tout faux hors d'un dossier basculé, où aucune facture n'est
   *  source — un dossier qui a une facture source ne revient plus en arrière (`garder_ventes_par_les_factures`). */
  liens: LiensDeLaPiece
  /** Les factures dont un encaissement vivant, qui justifie son mouvement, est compté par un mouvement classé par ses
   *  encaissements : vide hors d'un dossier basculé, où aucun mouvement ne se classe ainsi. */
  facturesDuVirementMixte: ReadonlySet<string>
}

export type LectureDuContexte = { etat: 'lu'; contexte: ContexteLu } | { etat: 'incomplet'; motif: string }

/** Hors d'un dossier basculé, rien d'autre ne se lit : ce que les refus en reçoivent ne change aucun verdict. */
export const CONTEXTE_D_UN_DOSSIER_NON_BASCULE: ContexteLu = {
  dossierBascule: false,
  pont: { genre: 'aucune' },
  liens: { rapprochee: false, reglee: false, ecrite: false, lettree: false },
  facturesDuVirementMixte: new Set(),
}

/**
 * LES FACTURES D'UN VIREMENT MIXTE CLASSÉ, comme les rangs 14 et 15 de `designer_exemplaire_facture` les cherchent : celles
 * dont un encaissement du dossier, non retiré, cite un mouvement classé par ses encaissements et le justifie (aucune
 * contre-passation sans mouvement ne l'annule, `justifieSonMouvement`). Sources ou non : le module (`datee`) ne retient que
 * celles qui ne le sont pas. `encaissements` : le registre ENTIER du dossier, contre-passations comprises.
 */
export function facturesDuVirementMixte(
  dossierId: string, encaissements: readonly EncaissementLu[], mouvementsClasses: ReadonlySet<string>,
): Set<string> {
  return new Set(encaissements
    .filter((e) => e.dossier_id === dossierId && e.retire_le == null && e.ligne_bancaire_id != null
      && mouvementsClasses.has(e.ligne_bancaire_id) && justifieSonMouvement(e, encaissements))
    .map((e) => e.facture_id))
}

// ── Le journal ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne du journal, telle que la fiche la lit : la table entière, rien d'autre. */
export type LigneDuJournal = Pick<DesignationDeLaPiece, 'id' | 'dossier_id' | 'piece_id' | 'geste' | 'facture_id' | 'auteur_id' | 'fait_le'>

export const COLONNES_DU_JOURNAL = 'id, dossier_id, piece_id, geste, facture_id, auteur_id, fait_le'

/**
 * Le journal lu : ses lignes — celles que la base ouvre, sous `admin_du_dossier` du dossier de CHAQUE ligne —, et le nom des
 * autres dossiers où des lignes sont restées (nul quand ces noms n'ont pas pu être lus en entier : la fiche dit alors « un
 * autre dossier », sans en inventer un). Ou « incomplet » : la fiche le dit, et n'affirme rien du journal.
 */
export type LectureDuJournal =
  | { etat: 'lu'; lignes: readonly LigneDuJournal[]; nomsDesAutresDossiers: ReadonlyMap<string, string> | null }
  | { etat: 'incomplet'; motif: string }

// À un même instant, un remplacement écrit le retrait AVANT le geste qui le remplace (`designer_exemplaire_facture`) :
// l'ordre de la lecture (l'instant, puis l'identifiant, tiré au hasard) ne le dit pas.
const RANG_DU_GESTE: Record<GesteDuJournal, number> = {
  retrait_designation: 0, retrait_declaration: 1, designation: 2, declaration: 3,
}

export interface JournalDeLaPiece {
  /** Les gestes de ce dossier, du plus ancien au plus récent. */
  ici: LigneDuJournal[]
  /** Les gestes restés dans un autre dossier (VF6B-Q1), comptés par dossier, dans l'ordre de leur premier geste. */
  ailleurs: { dossierId: string; gestes: number }[]
}

/** Le journal de CETTE pièce : ses lignes de ce dossier, ordonnées, et celles qui sont restées ailleurs. */
export function journalDeLaPiece(lignes: readonly LigneDuJournal[], dossierId: string, pieceId: string): JournalDeLaPiece {
  const siennes = lignes.filter((l) => l.piece_id === pieceId)
    .slice()
    .sort((a, b) => (a.fait_le < b.fait_le ? -1 : a.fait_le > b.fait_le ? 1 : 0)
      || RANG_DU_GESTE[a.geste] - RANG_DU_GESTE[b.geste] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ailleurs = new Map<string, number>()
  for (const l of siennes) {
    if (l.dossier_id !== dossierId) ailleurs.set(l.dossier_id, (ailleurs.get(l.dossier_id) ?? 0) + 1)
  }
  return {
    ici: siennes.filter((l) => l.dossier_id === dossierId),
    ailleurs: [...ailleurs].map(([id, gestes]) => ({ dossierId: id, gestes })),
  }
}

// ── Qui a fait le geste ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les membres de l'équipe que la base laisse lire (`cabinet_admins` : sa propre ligne, toute l'équipe pour un chef du
 * cabinet, tout pour le super-administrateur), et leur adresse ; ou « incomplète ». Seuls les quatre gestes du CABINET
 * écrivent le journal (`admin_du_dossier`) : son auteur est un membre d'un cabinet ou le super-administrateur, jamais le
 * client — que lib/auteursVentes.ts reconnaît, et qu'aucune ligne de ce journal ne peut nommer.
 */
export type EquipeLue = { etat: 'lue'; courriels: ReadonlyMap<string, string> } | { etat: 'incomplete'; motif: string }

/**
 * L'auteur d'un geste, tel que la fiche peut le nommer : « vous » pour le compte connecté ; l'adresse d'un membre de l'équipe
 * lue en entier ; sinon « un autre compte » — un membre que ce compte ne voit pas, un accès retiré depuis, un compte effacé
 * (`auteur_id` n'a pas de clé : l'histoire reste). Jamais un nom deviné.
 */
export function auteurDuGeste(auteurId: string, moi: string | null, equipe: EquipeLue | null): string {
  if (moi !== null && auteurId === moi) return 'vous'
  if (equipe !== null && equipe.etat === 'lue') {
    const courriel = equipe.courriels.get(auteurId)
    if (courriel !== undefined && courriel.trim() !== '') return courriel
  }
  return 'un autre compte'
}

/** Ce que la fiche a lu pour dire ce que la pièce est, gardé avec la pièce pour laquelle il a été lu. */
export interface LectureDeCeQueLaPieceEst {
  /** La pièce de la lecture ; nulle pour une pièce en cours de création (seule la bascule du dossier se lit alors). */
  pour: string | null
  contexte: LectureDuContexte
  /** Nul pour une pièce en cours de création : elle n'a pas encore de journal. */
  journal: LectureDuJournal | null
  /** Nulle quand le journal de ce dossier est vide : il n'y a personne à nommer, rien n'est lu. */
  equipe: EquipeLue | null
}
