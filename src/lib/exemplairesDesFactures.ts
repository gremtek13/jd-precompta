import { remplirModele } from './encaissementsFactures'
import type { FactureEmise, Piece, TypePiece } from './types'

// L'EXEMPLAIRE D'UNE FACTURE ÉMISE (ligne 28.6, chantier EC-Q3, étape VF1a ; décision du cabinet du 17/10/2026, 28.6-Q1 ;
// conception : HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 8 et § 14). Un module PUR — il
// ne lit rien en base, n'appelle personne — que les écrans de l'étape VF1b liront : ce que la base refuserait quand le
// cabinet DÉSIGNE une pièce de vente exemplaire d'une facture émise (l'original revenu de la plateforme, ou le PDF qu'il a
// déposé), quand il DÉFAIT cette désignation, et quand il modifie une pièce désignée — dit AVANT le clic, dans l'ordre de
// la base et sous ses mots, sauf l'accès, que l'écran ne peut pas dire.
//
// CE QUE LA BASE TIENT (migration `exemplaires_des_factures`) : `pieces.facture_id`, une facture VALIDÉE du MÊME dossier,
// sur une pièce de VENTE — un avoir comme une facture ; plusieurs pièces peuvent être exemplaires d'une même facture.
// Seules `designer_exemplaire_facture` et `defaire_exemplaire_facture`, du cabinet seul, l'écrivent ; la garde
// `garder_exemplaire_facture` refuse toute autre écriture (sauf la restauration par le super-administrateur) et qu'une
// pièce désignée change de dossier ou de nature ; le gel de la pièce fige la désignation. Ce que la désignation CHANGE :
// le pont (lib/ventesJumelles.ts) en fait sa quatrième preuve. Ce qu'elle ne change pas : ce qui se compte.
//
// LA RÉFÉRENCE. Le texte même des deux fonctions et de la garde, que l'export (supabase/schema) porte depuis l'application
// de la migration (18/10/2026, sur l'accord du cabinet, VF1A-Q1), et l'essai `supabase/essais/exemplairesDesFactures.sql`,
// joué sur une réplique puis en production, dont chaque contrôle exige de la base un code ET des mots.
// exemplairesDesFactures.test.ts confronte le module au premier — messages, codes, valeurs, ordre —, exige que chaque refus
// du module soit exigé par le second de la fonction qui le lève, et rejoue dans le module, appel par appel, ce que l'essai
// a demandé à la base.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `exemplaires_des_factures`, présentée au cabinet, a été appliquée sur son accord (VF1A-Q1), et l'export
// (supabase/schema) la porte. Ce drapeau est donc levé : la lecture du pont (lib/ventesJumellesLecture.ts) nomme la colonne
// `facture_id`, le plan de sauvegarde connaît sa clé, et exemplairesDesFactures.test.ts confronte le module au texte même
// des deux fonctions et de la garde, en plus de l'essai. Un retour arrière de la migration — DESTRUCTIF : il perd les
// désignations — ne viendrait qu'APRÈS le drapeau rebaissé en ligne : sinon la lecture du pont échouerait, et le dirait.
export const EXEMPLAIRES_DES_FACTURES_EXPORTES: boolean = true

// ── Les refus ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les refus de `designer_exemplaire_facture`, dans son ordre et sous ses mots ; « % » : une valeur. */
export const REFUS_DESIGNATION = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'pas_une_vente', modele: "Seule une pièce de vente est l'exemplaire d'une facture émise.", code: '22023' },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa désignation ne change plus.", code: '22023' },
  { cle: 'deja_cette_facture', modele: "Cette pièce est déjà l'exemplaire de la facture %.", code: '22023' },
  {
    cle: 'deja_une_autre',
    modele: "Cette pièce est déjà l'exemplaire de la facture % : défaire cette désignation avant d'en faire une autre.",
    code: '22023',
  },
  { cle: 'facture_introuvable', modele: 'Facture introuvable dans ce dossier.', code: 'P0002' },
  {
    cle: 'facture_brouillon',
    modele: "Seule une facture validée a un exemplaire : un brouillon n'est pas encore une facture émise.",
    code: '22023',
  },
] as const

export type CleRefusDesignation = (typeof REFUS_DESIGNATION)[number]['cle']

/** Les refus de `defaire_exemplaire_facture`, dans son ordre et sous ses mots. */
export const REFUS_RETRAIT_DESIGNATION = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'pas_designee', modele: "Cette pièce n'est l'exemplaire d'aucune facture.", code: '22023' },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa désignation ne change plus.", code: '22023' },
] as const

export type CleRefusRetraitDesignation = (typeof REFUS_RETRAIT_DESIGNATION)[number]['cle']

/**
 * Les refus de la garde `garder_exemplaire_facture`, sous ses mots : l'écriture de la désignation hors des deux fonctions
 * (à l'insertion d'une pièce comme à sa mise à jour) ; une pièce désignée qui changerait de dossier ou de nature ; une
 * désignation qui se pose — par la restauration — sur une facture d'un autre dossier, un brouillon, ou une pièce qui
 * n'est pas une vente.
 */
export const REFUS_GARDE_EXEMPLAIRE = [
  { cle: 'hors_des_fonctions', modele: "Une pièce ne se désigne exemplaire d'une facture, et ne cesse de l'être, que par l'application.", code: '42501' },
  {
    cle: 'change_de_dossier',
    modele: "Cette pièce est l'exemplaire de la facture % : elle ne change plus de dossier — défaire d'abord la désignation.",
    code: '23514',
  },
  {
    cle: 'change_de_nature',
    modele: "Cette pièce est l'exemplaire de la facture % : elle reste une pièce de vente — défaire d'abord la désignation.",
    code: '23514',
  },
  { cle: 'facture_d_un_autre_dossier', modele: "Une pièce n'est l'exemplaire que d'une facture de son dossier.", code: '23514' },
  { cle: 'facture_non_validee', modele: 'Seule une facture validée a un exemplaire.', code: '23514' },
  { cle: 'pas_une_vente', modele: "Seule une pièce de vente est l'exemplaire d'une facture émise.", code: '23514' },
] as const

export type CleRefusGardeExemplaire = (typeof REFUS_GARDE_EXEMPLAIRE)[number]['cle']

/** L'ordre des `raise exception` dans le texte de la garde : son premier refus y paraît deux fois (insertion, mise à jour). */
export const ORDRE_DES_REFUS_DE_LA_GARDE: readonly CleRefusGardeExemplaire[] = [
  'hors_des_fonctions', 'hors_des_fonctions', 'change_de_dossier', 'change_de_nature', 'facture_d_un_autre_dossier',
  'facture_non_validee', 'pas_une_vente',
]

/** Un refus dit avant le clic : sa clé, et le message de la base, valeurs remplies. */
export interface RefusExemplaire<C extends string> {
  cle: C
  message: string
}

type Refus = { readonly cle: string; readonly modele: string }

function dire<C extends string>(liste: readonly Refus[], cle: C, ...valeurs: string[]): RefusExemplaire<C> {
  return { cle, message: remplirModele((liste.find((r) => r.cle === cle) as Refus).modele, valeurs) }
}

// ── Ce que l'écran sait ───────────────────────────────────────────────────────────────────────────────────────────────

/** La pièce, telle que les refus la lisent. `facture_id` absent : la colonne n'a pas été lue — aucune désignation. */
export type PieceDesignable = Pick<Piece, 'id' | 'dossier_id' | 'type_piece'> & { facture_id?: string | null }

/** Une facture émise, telle que les refus la lisent. */
export type FacturePourExemplaire = Pick<FactureEmise, 'id' | 'dossier_id' | 'statut' | 'numero'>

/** Ce que l'écran sait quand il propose de désigner ou de défaire. */
export interface ContexteDesignation {
  /** Le dossier ANNONCÉ à la fonction. */
  dossierId: string
  /** L'exercice qui fige la pièce — sa première écriture validée, ou celle du bien qu'elle justifie (`piecesFigees`, le
   * critère de `exercice_figeant_la_piece`) —, nul si rien ne la fige. */
  anneeFigeante: number | null
  /** Les factures émises du dossier, lues EN ENTIER : celles que l'écran propose, et celle que la pièce désigne déjà. */
  factures: readonly FacturePourExemplaire[]
}

// Le numéro d'une facture tel que la base l'écrit dans ses messages : une facture validée porte toujours le sien (la base le
// donne à la validation) ; son absence ne se verrait que sur des données lues de travers, et se dit comme la base la dit.
const SANS_NUMERO = '(sans numéro)'

function numeroDe(factures: readonly FacturePourExemplaire[], id: string): string {
  return factures.find((f) => f.id === id)?.numero ?? SANS_NUMERO
}

// ── Désigner ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POURQUOI CETTE PIÈCE NE SE DÉSIGNERAIT PAS EXEMPLAIRE DE CETTE FACTURE, dit avant le clic, dans l'ordre de
 * `designer_exemplaire_facture` et sous ses mots — sauf l'accès, que l'écran ne peut pas dire. Null : la base l'accepterait.
 * `piece` nulle : aucune pièce de ce dossier ; `factureId` nul : aucune facture choisie.
 */
export function refusDeLaDesignation(
  piece: PieceDesignable | null,
  factureId: string | null,
  contexte: ContexteDesignation,
): RefusExemplaire<CleRefusDesignation> | null {
  const non = (cle: CleRefusDesignation, ...valeurs: string[]) => dire(REFUS_DESIGNATION, cle, ...valeurs)
  // 2. La pièce, dans le dossier annoncé.
  if (piece == null || piece.dossier_id !== contexte.dossierId) return non('piece_introuvable')
  // 3. Une pièce de vente.
  if (piece.type_piece !== 'vente') return non('pas_une_vente')
  // 4. Le gel de la validation.
  if (contexte.anneeFigeante != null) return non('piece_figee', String(contexte.anneeFigeante))
  // 5. Une pièce déjà désignée : à cette facture, ou à une autre.
  const designee = piece.facture_id ?? null
  if (designee !== null) {
    return non(designee === factureId ? 'deja_cette_facture' : 'deja_une_autre', numeroDe(contexte.factures, designee))
  }
  // 6. La facture, dans le dossier annoncé ; 7. validée.
  const facture = factureId == null ? undefined : contexte.factures.find((f) => f.id === factureId && f.dossier_id === contexte.dossierId)
  if (facture === undefined) return non('facture_introuvable')
  if (facture.statut !== 'validee') return non('facture_brouillon')
  return null
}

// ── Défaire ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POURQUOI CETTE DÉSIGNATION NE SE DÉFERAIT PAS, dans l'ordre de `defaire_exemplaire_facture` et sous ses mots — sauf
 * l'accès. Null : la base l'accepterait.
 */
export function refusDuRetraitDeLaDesignation(
  piece: PieceDesignable | null,
  contexte: Pick<ContexteDesignation, 'dossierId' | 'anneeFigeante'>,
): RefusExemplaire<CleRefusRetraitDesignation> | null {
  const non = (cle: CleRefusRetraitDesignation, ...valeurs: string[]) => dire(REFUS_RETRAIT_DESIGNATION, cle, ...valeurs)
  if (piece == null || piece.dossier_id !== contexte.dossierId) return non('piece_introuvable')
  if ((piece.facture_id ?? null) === null) return non('pas_designee')
  if (contexte.anneeFigeante != null) return non('piece_figee', String(contexte.anneeFigeante))
  return null
}

// ── Modifier une pièce désignée ───────────────────────────────────────────────────────────────────────────────────────

/** Ce qu'une mise à jour de la pièce changerait : son dossier, sa nature — ce que la garde regarde. */
export interface ChangementDeLaPiece {
  dossier_id?: string
  type_piece?: TypePiece
}

/**
 * POURQUOI CETTE PIÈCE DÉSIGNÉE NE CHANGERAIT PAS COMME ON LE DEMANDE, sous les mots de la garde : une pièce désignée ne
 * change pas de dossier — le refus que la garde dit d'abord —, et reste une vente. Null : la garde l'accepterait — une
 * pièce que rien ne désigne change librement. Les autres gardes de `pieces` (le gel, les citations) ne sont pas dites ici.
 */
export function refusDeLaPieceDesignee(
  piece: PieceDesignable,
  changement: ChangementDeLaPiece,
  factures: readonly FacturePourExemplaire[],
): RefusExemplaire<'change_de_dossier' | 'change_de_nature'> | null {
  const designee = piece.facture_id ?? null
  if (designee === null) return null
  const numero = numeroDe(factures, designee)
  if (changement.dossier_id !== undefined && changement.dossier_id !== piece.dossier_id) {
    return dire(REFUS_GARDE_EXEMPLAIRE, 'change_de_dossier', numero)
  }
  if ((changement.type_piece ?? piece.type_piece) !== 'vente') return dire(REFUS_GARDE_EXEMPLAIRE, 'change_de_nature', numero)
  return null
}

// ── Les paramètres des deux fonctions, dans l'ordre de leur signature ──────────────────────────────────────────────────

export function argumentsDeLaDesignation(dossierId: string, pieceId: string, factureId: string) {
  return { p_dossier_id: dossierId, p_piece_id: pieceId, p_facture_id: factureId }
}

export function argumentsDuRetraitDeLaDesignation(dossierId: string, pieceId: string) {
  return { p_dossier_id: dossierId, p_piece_id: pieceId }
}
