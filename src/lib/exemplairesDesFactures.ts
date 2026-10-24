import { remplirModele } from './encaissementsFactures'
import type { FactureEmise, GesteDuJournal, Piece, TypePiece } from './types'
import type { JumellesDuDossier } from './ventesJumelles'

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
// de la migration (18/10/2026, sur l'accord du cabinet, VF1A-Q1) : exemplairesDesFactures.test.ts confronte le module au
// texte de CETTE migration — messages, codes, valeurs, ordre —, et à leurs cas. L'essai `supabase/essais/
// exemplairesDesFactures.sql`, que l'étape VF6b a étendu à la migration `jumelle_inversee`, se rejoue désormais dans le bloc
// de la jumelle inversée (plus bas) : il n'exige plus le refus d'hier d'une désignation à une autre facture, qui se
// remplace.

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

// ══ LA JUMELLE INVERSÉE (chantier EC-Q3, étape VF6b) ════════════════════════════════════════════════════════════════════
//
// Dans un dossier dont les factures sont la source de leurs ventes (étape VF2), la vente se compte par la facture validée et
// ses encaissements ; la pièce qui revient de la plateforme, ou le PDF que le cabinet dépose, n'en est qu'un EXEMPLAIRE, qui
// ne compte plus rien. La migration `jumelle_inversee` (conception : HISTORIQUE.md, « VF6, LA JUMELLE INVERSÉE : LA
// CONCEPTION », § 3 ; décisions VF6-Q1 à VF6-Q3, VF6-Q5, et VF5H-Q1 sur la recommandation) ferme le double compte en base :
//   - la DÉCLARATION, `pieces.vente_hors_des_factures` : aucune facture validée de l'application n'est la facture de cette
//     vente — posée et retirée par `declarer_vente_hors_des_factures` et `retirer_declaration_hors_des_factures`, jamais
//     avec une désignation ;
//   - la désignation qui REMPLACE (VF6-Q1) : `designer_exemplaire_facture` remplace une désignation à une autre facture, ou
//     une déclaration, d'un seul geste ; `defaire_exemplaire_facture` ne défait plus une pièce validée d'un dossier basculé ;
//   - G3 : une pièce de vente qui DEVIENT validée dans un dossier basculé est l'exemplaire de la facture que le pont prouve,
//     ou désignée, ou déclarée — jamais née validée, jamais aux preuves contraires (VF6-Q5) ;
//   - G4 : l'exemplaire d'une facture SOURCE n'est ni rapproché, ni réglé par une part d'un virement groupé, ni écrit, ni
//     lettré — et l'autre côté : une pièce liée ne se désigne pas à une facture source ;
//   - le virement mixte (VF5H-Q1) : la désignation qui date l'exemplaire d'une facture d'avant ne change pas sous un
//     mouvement classé qui compte son encaissement ;
//   - le JOURNAL, `designations_des_pieces` (VF6-Q3) : qui a fait quel geste, et quand ; au cabinet seul.
// Ce bloc redit chaque refus neuf, dans l'ordre de la base et sous ses mots, pour les écrans de VF6c et VF6d. Les fonctions
// d'avant (plus haut) restent celles de la production tant que la migration n'y est pas : la fiche d'une pièce (VF1b) les
// lit, et sur un dossier qui n'a pas basculé elles disent la même chose que celles-ci d'une pièce que rien ne désigne.
// exemplairesDesFactures.test.ts confronte ce bloc à l'essai (supabase/essais/exemplairesDesFactures.sql, joué sur une
// réplique égale à la production plus les migrations de VF5h et de VF6b), qu'il rejoue appel par appel, et — le drapeau
// levé — au texte exporté de la migration.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `jumelle_inversee` est APPLIQUÉE (24/10/2026, sur l'accord du cabinet, version `20261024052424`) et l'export
// la porte : ce drapeau est levé. Baissé, rien ne nommait la déclaration ni le journal — la sauvegarde ne lisait pas la
// table (`auPlanAujourdHui`, lib/sauvegarde.ts), et les fonctions neuves ne s'appelaient pas —, état que les tests
// éprouvent encore tant que son code existe ; exemplairesDesFactures.test.ts confronte le drapeau à l'export.
export const JUMELLE_INVERSEE_EXPORTEE: boolean = true

// ── Les refus ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const MOTS_DU_VIREMENT_MIXTE = "Un encaissement de la facture % est compté par un mouvement classé par ses encaissements, qui "
  + "date son exemplaire : retirer d'abord ce classement."

/** Les refus de `designer_exemplaire_facture` telle que la migration `jumelle_inversee` la remplace, dans son ordre et sous
 * ses mots : le rang 5 ne refuse plus que la MÊME facture (une autre se remplace, VF6-Q1) ; huit rangs suivent le 7. */
export const REFUS_DESIGNATION_JUMELLE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'pas_une_vente', modele: "Seule une pièce de vente est l'exemplaire d'une facture émise.", code: '22023' },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa désignation ne change plus.", code: '22023' },
  { cle: 'deja_cette_facture', modele: "Cette pièce est déjà l'exemplaire de la facture %.", code: '22023' },
  { cle: 'facture_introuvable', modele: 'Facture introuvable dans ce dossier.', code: 'P0002' },
  {
    cle: 'facture_brouillon',
    modele: "Seule une facture validée a un exemplaire : un brouillon n'est pas encore une facture émise.",
    code: '22023',
  },
  {
    cle: 'pont_autre_facture',
    modele: "Cette pièce est la facture % émise dans l'application, revenue comme pièce : elle n'est l'exemplaire que de celle-ci.",
    code: '22023',
  },
  {
    cle: 'preuves_contraires',
    modele: 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la '
      + 'facture que son numéro désigne : vérifiez-la sur la plateforme avant de la désigner.',
    code: '22023',
  },
  {
    cle: 'rapprochee',
    modele: "Cette pièce est rapprochée d'un mouvement du relevé : l'exemplaire de la facture %, source de sa vente, ne justifie "
      + "aucun mouvement — annuler d'abord ce rapprochement.",
    code: '22023',
  },
  {
    cle: 'reglee',
    modele: "Cette pièce est réglée par une part d'un virement groupé : l'exemplaire de la facture %, source de sa vente, n'en "
      + "reçoit aucune — retirer d'abord cette part.",
    code: '22023',
  },
  {
    cle: 'ecrite',
    modele: "Cette pièce porte une écriture : l'exemplaire de la facture %, source de sa vente, ne s'écrit pas — retirer d'abord "
      + 'cette écriture.',
    code: '22023',
  },
  {
    cle: 'lettree',
    modele: "Cette pièce est lettrée : l'exemplaire de la facture %, source de sa vente, ne se lettre pas — défaire d'abord ce "
      + 'lettrage.',
    code: '22023',
  },
  { cle: 'virement_mixte_quittee', modele: MOTS_DU_VIREMENT_MIXTE, code: '22023' },
  { cle: 'virement_mixte', modele: MOTS_DU_VIREMENT_MIXTE, code: '22023' },
] as const

export type CleRefusDesignationJumelle = (typeof REFUS_DESIGNATION_JUMELLE)[number]['cle']

/** Les refus de `defaire_exemplaire_facture` telle que la migration `jumelle_inversee` la remplace. */
export const REFUS_RETRAIT_DESIGNATION_JUMELLE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'pas_designee', modele: "Cette pièce n'est l'exemplaire d'aucune facture.", code: '22023' },
  {
    cle: 'validee_dans_un_dossier_bascule',
    modele: 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa '
      + "désignation — désignez l'autre facture, ou déclarez-la vente hors des factures de l'application.",
    code: '22023',
  },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa désignation ne change plus.", code: '22023' },
  { cle: 'virement_mixte', modele: MOTS_DU_VIREMENT_MIXTE, code: '22023' },
] as const

export type CleRefusRetraitDesignationJumelle = (typeof REFUS_RETRAIT_DESIGNATION_JUMELLE)[number]['cle']

/** Les refus de `declarer_vente_hors_des_factures`, dans son ordre et sous ses mots. */
export const REFUS_DECLARATION = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'pas_une_vente', modele: "Seule une pièce de vente se déclare vente hors des factures de l'application.", code: '22023' },
  {
    cle: 'dossier_non_bascule',
    modele: "Une vente ne se déclare hors des factures de l'application que dans un dossier dont les factures sont la source de "
      + 'leurs ventes.',
    code: '22023',
  },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa déclaration ne change plus.", code: '22023' },
  { cle: 'deja_declaree', modele: "Cette pièce est déjà déclarée vente hors des factures de l'application.", code: '22023' },
  {
    cle: 'pont_une_facture',
    modele: "Cette pièce est la facture % émise dans l'application, revenue comme pièce : elle se désigne exemplaire de cette "
      + "facture, et ne se déclare pas hors des factures de l'application.",
    code: '22023',
  },
  {
    cle: 'preuves_contraires',
    modele: 'Les preuves de cette pièce se contredisent — elle porte plusieurs factures émises, ou une autre nature que la '
      + 'facture que son numéro désigne : vérifiez-la sur la plateforme avant de la déclarer.',
    code: '22023',
  },
  { cle: 'virement_mixte', modele: MOTS_DU_VIREMENT_MIXTE, code: '22023' },
] as const

export type CleRefusDeclaration = (typeof REFUS_DECLARATION)[number]['cle']

/** Les refus de `retirer_declaration_hors_des_factures`, dans son ordre et sous ses mots. */
export const REFUS_RETRAIT_DECLARATION = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'pas_declaree', modele: "Cette pièce n'est pas déclarée vente hors des factures de l'application.", code: '22023' },
  {
    cle: 'validee_dans_un_dossier_bascule',
    modele: 'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa '
      + "déclaration — désignez-la exemplaire de sa facture, ou remettez-la d'abord à valider.",
    code: '22023',
  },
  { cle: 'piece_figee', modele: "Cette pièce porte une écriture validée de l'exercice % : sa déclaration ne change plus.", code: '22023' },
] as const

export type CleRefusRetraitDeclaration = (typeof REFUS_RETRAIT_DECLARATION)[number]['cle']

/**
 * Les refus de la garde `garder_exemplaire_facture` telle que la migration `jumelle_inversee` l'étend à la déclaration :
 * celles d'avant, et l'écriture de la déclaration hors des deux fonctions, une pièce déclarée qui changerait de dossier ou
 * de nature, les deux marques ensemble, une déclaration qui se pose — par la restauration — sur une pièce qui n'est pas une
 * vente.
 */
export const REFUS_GARDE_JUMELLE = [
  { cle: 'hors_des_fonctions', modele: "Une pièce ne se désigne exemplaire d'une facture, et ne cesse de l'être, que par l'application.", code: '42501' },
  {
    cle: 'declaration_hors_des_fonctions',
    modele: "Une pièce ne se déclare vente hors des factures de l'application, et ne cesse de l'être, que par l'application.",
    code: '42501',
  },
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
  {
    cle: 'declaree_change_de_dossier',
    modele: "Cette pièce est déclarée vente hors des factures de l'application : elle ne change plus de dossier — retirer "
      + "d'abord la déclaration.",
    code: '23514',
  },
  {
    cle: 'declaree_change_de_nature',
    modele: "Cette pièce est déclarée vente hors des factures de l'application : elle reste une pièce de vente — retirer "
      + "d'abord la déclaration.",
    code: '23514',
  },
  {
    cle: 'designee_et_declaree',
    modele: "Une pièce n'est pas à la fois l'exemplaire d'une facture et une vente hors des factures de l'application.",
    code: '23514',
  },
  { cle: 'facture_d_un_autre_dossier', modele: "Une pièce n'est l'exemplaire que d'une facture de son dossier.", code: '23514' },
  { cle: 'facture_non_validee', modele: 'Seule une facture validée a un exemplaire.', code: '23514' },
  { cle: 'pas_une_vente', modele: "Seule une pièce de vente est l'exemplaire d'une facture émise.", code: '23514' },
  { cle: 'declaration_pas_une_vente', modele: "Seule une pièce de vente se déclare vente hors des factures de l'application.", code: '23514' },
] as const

export type CleRefusGardeJumelle = (typeof REFUS_GARDE_JUMELLE)[number]['cle']

/** L'ordre des `raise exception` dans le texte de la garde étendue : ses deux premiers refus y paraissent deux fois
 *  (l'insertion, puis la mise à jour). */
export const ORDRE_DES_REFUS_DE_LA_GARDE_JUMELLE: readonly CleRefusGardeJumelle[] = [
  'hors_des_fonctions', 'declaration_hors_des_fonctions', 'hors_des_fonctions', 'declaration_hors_des_fonctions',
  'change_de_dossier', 'change_de_nature', 'declaree_change_de_dossier', 'declaree_change_de_nature', 'designee_et_declaree',
  'facture_d_un_autre_dossier', 'facture_non_validee', 'pas_une_vente', 'declaration_pas_une_vente',
]

/** Les refus de G3, `garder_vente_d_un_dossier_bascule`, dans son ordre et sous ses mots ; « % » : le nom du fichier, puis
 *  le numéro de la facture. */
export const REFUS_VALIDATION_D_UNE_VENTE = [
  {
    cle: 'nee_validee',
    modele: 'Une pièce de vente naît à valider dans un dossier dont les factures sont la source de leurs ventes.',
    code: '23514',
  },
  {
    cle: 'pont_une_facture',
    modele: "La pièce « % » est la facture % émise dans l'application, revenue comme pièce : désignez-la exemplaire de cette "
      + 'facture avant de la valider.',
    code: '23514',
  },
  {
    cle: 'preuves_contraires',
    modele: 'Les preuves de la pièce « % » se contredisent — elle porte plusieurs factures émises, ou une autre nature que la '
      + 'facture que son numéro désigne : vérifiez-la sur la plateforme avant de la valider.',
    code: '23514',
  },
  {
    cle: 'ni_designee_ni_declaree',
    modele: "Désignez la pièce « % » exemplaire de sa facture, ou déclarez-la vente hors des factures de l'application, avant de "
      + 'la valider : les factures de ce dossier sont la source de leurs ventes.',
    code: '23514',
  },
] as const

export type CleRefusValidationDUneVente = (typeof REFUS_VALIDATION_D_UNE_VENTE)[number]['cle']

/** Le refus de G4, `garder_exemplaire_d_une_source`, sur le rapprochement, la part d'un virement groupé, l'écriture et le
 *  lettrage ; « % » : le nom du fichier, puis le numéro de la facture. */
export const REFUS_EXEMPLAIRE_D_UNE_SOURCE = [
  {
    cle: 'exemplaire_d_une_source',
    modele: "La pièce « % » est l'exemplaire de la facture %, source de sa vente : la vente se règle et s'écrit par sa facture "
      + 'et ses encaissements.',
    code: '23514',
  },
] as const

/** Les refus de la garde du journal, `garder_designation_des_pieces`, sous ses mots. */
export const REFUS_JOURNAL = [
  {
    cle: 'reecriture',
    modele: "Le journal des désignations ne se réécrit pas : une ligne ne part qu'avec sa pièce ou son dossier.",
    code: '23514',
  },
  {
    cle: 'hors_des_fonctions',
    modele: "Le journal des désignations ne s'écrit que par les fonctions qui désignent et déclarent une pièce.",
    code: '42501',
  },
  {
    cle: 'piece_ou_facture_d_un_autre_dossier',
    modele: 'Une ligne du journal des désignations cite une pièce et une facture de son dossier.',
    code: '23514',
  },
] as const

export type CleRefusJournal = (typeof REFUS_JOURNAL)[number]['cle']

/** L'ordre des `raise exception` dans le texte de la garde du journal : la réécriture y paraît deux fois (la suppression,
 *  puis la mise à jour). */
export const ORDRE_DES_REFUS_DU_JOURNAL: readonly CleRefusJournal[] = [
  'reecriture', 'reecriture', 'hors_des_fonctions', 'piece_ou_facture_d_un_autre_dossier',
]

/** Les gestes que le journal garde, dans l'ordre de sa contrainte. */
export const GESTES_DU_JOURNAL = ['designation', 'retrait_designation', 'declaration', 'retrait_declaration'] as const satisfies
  readonly GesteDuJournal[]

// ── Ce que l'écran sait ───────────────────────────────────────────────────────────────────────────────────────────────

/** La pièce, telle que les refus de la jumelle inversée la lisent. `facture_id` et `vente_hors_des_factures` absents : la
 *  colonne n'a pas été lue — ni désignée, ni déclarée. */
export type PieceMarquable = Pick<Piece, 'id' | 'dossier_id' | 'type_piece' | 'statut' | 'nom_fichier'> & {
  facture_id?: string | null
  vente_hors_des_factures?: boolean
}

/** Une facture émise, telle que ces refus la lisent : sa source compte (G4, le virement mixte). */
export type FacturePourMarquer = FacturePourExemplaire & Pick<FactureEmise, 'source_de_la_vente'>

/**
 * Ce que le pont prouve d'une pièce SANS sa désignation — le verdict du jumeau en base, `factures_du_pont` : aucune facture,
 * une seule (de sa nature), ou des preuves qui se contredisent (plusieurs factures, ou une identité de l'autre nature).
 */
export type VerdictDuPont = { genre: 'aucune' } | { genre: 'une'; factureId: string } | { genre: 'contraires' }

/** Le verdict que les fonctions et G3 tirent des lignes de `factures_du_pont` : une ligne par facture, sa nature contraire. */
export function verdictDuPont(lignes: readonly { facture_id: string; nature_contraire: boolean }[]): VerdictDuPont {
  if (lignes.length === 0) return { genre: 'aucune' }
  if (lignes.length > 1 || lignes.some((l) => l.nature_contraire)) return { genre: 'contraires' }
  return { genre: 'une', factureId: lignes[0].facture_id }
}

/** Le même verdict, tiré du pont de l'application (lib/ventesJumelles.ts) calculé sur des pièces lues SANS leur
 *  désignation — ventesJumellesJumeau.test.ts confronte les deux sur le jeu de l'essai. */
export function verdictDuPontDeLaPiece(jumelles: JumellesDuDossier, pieceId: string): VerdictDuPont {
  if (jumelles.incoherentes.some((i) => i.pieceId === pieceId)) return { genre: 'contraires' }
  const jumelle = jumelles.parPiece.get(pieceId)
  return jumelle === undefined ? { genre: 'aucune' } : { genre: 'une', factureId: jumelle.factureId }
}

/** Ce qui lie la pièce au relevé et au brouillon (G4) : rapprochée d'un mouvement, réglée par une part d'un virement
 *  groupé, écrite, lettrée. */
export interface LiensDeLaPiece {
  rapprochee: boolean
  reglee: boolean
  ecrite: boolean
  lettree: boolean
}

/** Ce que l'écran sait quand il propose un geste de la jumelle inversée. */
export interface ContexteDesMarques {
  /** Le dossier ANNONCÉ à la fonction. */
  dossierId: string
  /** L'exercice qui fige la pièce (`exercice_figeant_la_piece`), nul si rien ne la fige. */
  anneeFigeante: number | null
  /** Les factures émises du dossier, lues EN ENTIER. */
  factures: readonly FacturePourMarquer[]
  /** Le dossier annoncé a basculé : ses factures sont la source de leurs ventes (`dossiers.ventes_par_les_factures`). */
  dossierBascule: boolean
  /** Ce que le pont prouve de la pièce, sans sa désignation. */
  pont: VerdictDuPont
  liens: LiensDeLaPiece
  /** Les factures dont un encaissement vivant, qui justifie son mouvement, est compté par un mouvement classé par ses
   *  encaissements (le virement mixte, étape VF5h) — sources ou non : seules celles qui ne le sont pas retiennent un geste. */
  facturesDuVirementMixte: ReadonlySet<string>
}

function factureDe(factures: readonly FacturePourMarquer[], id: string | null | undefined): FacturePourMarquer | undefined {
  return id == null ? undefined : factures.find((f) => f.id === id)
}

/** La facture qui n'est pas source et dont un encaissement est compté par le virement mixte : le geste attend le retrait
 *  de ce classement. */
function datee(contexte: Pick<ContexteDesMarques, 'factures' | 'facturesDuVirementMixte'>, id: string | null | undefined): string | null {
  const facture = factureDe(contexte.factures, id)
  return facture !== undefined && !facture.source_de_la_vente && contexte.facturesDuVirementMixte.has(facture.id)
    ? facture.numero ?? SANS_NUMERO : null
}

// ── Désigner, ou remplacer ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POURQUOI CETTE PIÈCE NE SE DÉSIGNERAIT PAS EXEMPLAIRE DE CETTE FACTURE — ou ne la remplacerait pas —, dit avant le clic,
 * dans l'ordre de `designer_exemplaire_facture` (migration `jumelle_inversee`) et sous ses mots, sauf l'accès. Null : la
 * base l'accepterait, et remplacerait ce que la pièce désignait ou sa déclaration.
 */
export function refusDeLaDesignationMarquee(
  piece: PieceMarquable | null,
  factureId: string | null,
  contexte: ContexteDesMarques,
): RefusExemplaire<CleRefusDesignationJumelle> | null {
  const non = (cle: CleRefusDesignationJumelle, ...valeurs: string[]) => dire(REFUS_DESIGNATION_JUMELLE, cle, ...valeurs)
  // 2. La pièce, dans le dossier annoncé ; 3. une vente ; 4. le gel.
  if (piece == null || piece.dossier_id !== contexte.dossierId) return non('piece_introuvable')
  if (piece.type_piece !== 'vente') return non('pas_une_vente')
  if (contexte.anneeFigeante != null) return non('piece_figee', String(contexte.anneeFigeante))
  // 5. Déjà l'exemplaire de CETTE facture ; d'une autre, elle la remplace.
  const designee = piece.facture_id ?? null
  if (designee !== null && designee === factureId) return non('deja_cette_facture', numeroDe(contexte.factures, designee))
  // 6. La facture, dans le dossier annoncé ; 7. validée.
  const facture = contexte.factures.find((f) => f.id === factureId && f.dossier_id === contexte.dossierId)
  if (factureId == null || facture === undefined) return non('facture_introuvable')
  if (facture.statut !== 'validee') return non('facture_brouillon')
  // 8. et 9. Dans un dossier basculé, le pont.
  if (contexte.dossierBascule) {
    if (contexte.pont.genre === 'une' && contexte.pont.factureId !== factureId) {
      return non('pont_autre_facture', numeroDe(contexte.factures, contexte.pont.factureId))
    }
    if (contexte.pont.genre === 'contraires') return non('preuves_contraires')
  }
  // 10. à 13. L'exemplaire d'une facture source ne règle ni n'écrit rien : ce qui lie la pièce se retire d'abord.
  if (facture.source_de_la_vente) {
    const numero = facture.numero ?? SANS_NUMERO
    if (contexte.liens.rapprochee) return non('rapprochee', numero)
    if (contexte.liens.reglee) return non('reglee', numero)
    if (contexte.liens.ecrite) return non('ecrite', numero)
    if (contexte.liens.lettree) return non('lettree', numero)
  }
  // 14. et 15. Le virement mixte classé : ni la facture qu'elle quitte, ni celle qu'elle prend.
  const quittee = datee(contexte, designee)
  if (quittee !== null) return non('virement_mixte_quittee', quittee)
  const prise = datee(contexte, factureId)
  if (prise !== null) return non('virement_mixte', prise)
  return null
}

// ── Défaire ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** POURQUOI CETTE DÉSIGNATION NE SE DÉFERAIT PAS, dans l'ordre de `defaire_exemplaire_facture` (migration
 *  `jumelle_inversee`) et sous ses mots, sauf l'accès. Null : la base l'accepterait. */
export function refusDuRetraitMarque(
  piece: PieceMarquable | null,
  contexte: Pick<ContexteDesMarques, 'dossierId' | 'anneeFigeante' | 'factures' | 'dossierBascule' | 'facturesDuVirementMixte'>,
): RefusExemplaire<CleRefusRetraitDesignationJumelle> | null {
  const non = (cle: CleRefusRetraitDesignationJumelle, ...valeurs: string[]) => dire(REFUS_RETRAIT_DESIGNATION_JUMELLE, cle, ...valeurs)
  if (piece == null || piece.dossier_id !== contexte.dossierId) return non('piece_introuvable')
  const designee = piece.facture_id ?? null
  if (designee === null) return non('pas_designee')
  // 4. Validée dans un dossier basculé, elle se remplace (VF6-Q1).
  if (piece.statut === 'validee' && contexte.dossierBascule) return non('validee_dans_un_dossier_bascule')
  if (contexte.anneeFigeante != null) return non('piece_figee', String(contexte.anneeFigeante))
  const quittee = datee(contexte, designee)
  if (quittee !== null) return non('virement_mixte', quittee)
  return null
}

// ── Déclarer une vente hors des factures de l'application ─────────────────────────────────────────────────────────────

/** POURQUOI CETTE PIÈCE NE SE DÉCLARERAIT PAS VENTE HORS DES FACTURES DE L'APPLICATION, dans l'ordre de
 *  `declarer_vente_hors_des_factures` et sous ses mots, sauf l'accès. Null : la base l'accepterait, et remplacerait sa
 *  désignation. */
export function refusDeLaDeclaration(
  piece: PieceMarquable | null,
  contexte: Pick<ContexteDesMarques, 'dossierId' | 'anneeFigeante' | 'factures' | 'dossierBascule' | 'pont' | 'facturesDuVirementMixte'>,
): RefusExemplaire<CleRefusDeclaration> | null {
  const non = (cle: CleRefusDeclaration, ...valeurs: string[]) => dire(REFUS_DECLARATION, cle, ...valeurs)
  if (piece == null || piece.dossier_id !== contexte.dossierId) return non('piece_introuvable')
  if (piece.type_piece !== 'vente') return non('pas_une_vente')
  if (!contexte.dossierBascule) return non('dossier_non_bascule')
  if (contexte.anneeFigeante != null) return non('piece_figee', String(contexte.anneeFigeante))
  if (piece.vente_hors_des_factures ?? false) return non('deja_declaree')
  // 7. Le pont la rattache à une facture : elle s'en désigne l'exemplaire ; 8. ses preuves se contredisent.
  if (contexte.pont.genre === 'une') return non('pont_une_facture', numeroDe(contexte.factures, contexte.pont.factureId))
  if (contexte.pont.genre === 'contraires') return non('preuves_contraires')
  const quittee = datee(contexte, piece.facture_id)
  if (quittee !== null) return non('virement_mixte', quittee)
  return null
}

/** POURQUOI CETTE DÉCLARATION NE SE RETIRERAIT PAS, dans l'ordre de `retirer_declaration_hors_des_factures` et sous ses
 *  mots, sauf l'accès. Null : la base l'accepterait. */
export function refusDuRetraitDeLaDeclaration(
  piece: PieceMarquable | null,
  contexte: Pick<ContexteDesMarques, 'dossierId' | 'anneeFigeante' | 'dossierBascule'>,
): RefusExemplaire<CleRefusRetraitDeclaration> | null {
  const non = (cle: CleRefusRetraitDeclaration, ...valeurs: string[]) => dire(REFUS_RETRAIT_DECLARATION, cle, ...valeurs)
  if (piece == null || piece.dossier_id !== contexte.dossierId) return non('piece_introuvable')
  if (!(piece.vente_hors_des_factures ?? false)) return non('pas_declaree')
  if (piece.statut === 'validee' && contexte.dossierBascule) return non('validee_dans_un_dossier_bascule')
  if (contexte.anneeFigeante != null) return non('piece_figee', String(contexte.anneeFigeante))
  return null
}

// ── Modifier une pièce : la garde, puis G3 ────────────────────────────────────────────────────────────────────────────

/** Ce qu'une mise à jour de la pièce changerait, que la garde et G3 regardent : son dossier, sa nature, son statut. */
export interface ModificationDeLaPiece {
  dossier_id?: string
  type_piece?: TypePiece
  statut?: Piece['statut']
}

/**
 * POURQUOI CETTE PIÈCE NE CHANGERAIT PAS COMME ON LE DEMANDE, sous les mots des deux gardes que la base passe dans l'ordre
 * de leurs noms : celle de la désignation et de la déclaration (une pièce marquée ne change ni de dossier ni de nature),
 * puis G3 (une pièce de vente qui DEVIENT validée dans un dossier basculé, jugée à ce passage seulement : EC3-Q1). Null :
 * ni l'une ni l'autre ne la refuseraient. `basculeDuDossier` et `pont` sont ceux du dossier où la pièce ARRIVE ; les autres
 * gardes des pièces (le gel, les citations) ne sont pas dites ici.
 */
export function refusDeLaModificationMarquee(
  piece: PieceMarquable,
  modification: ModificationDeLaPiece,
  contexte: { factures: readonly FacturePourMarquer[]; basculeDuDossier: boolean; pont: VerdictDuPont },
): RefusExemplaire<CleRefusGardeJumelle | CleRefusValidationDUneVente> | null {
  const apres = { ...piece, ...modification }
  const changeDeDossier = apres.dossier_id !== piece.dossier_id
  const designee = piece.facture_id ?? null
  const declaree = piece.vente_hors_des_factures ?? false
  // La garde : une pièce désignée, puis une pièce déclarée, ne change ni de dossier ni de nature.
  if (designee !== null && (changeDeDossier || apres.type_piece !== 'vente')) {
    const numero = numeroDe(contexte.factures, designee)
    return dire(REFUS_GARDE_JUMELLE, changeDeDossier ? 'change_de_dossier' : 'change_de_nature', numero)
  }
  if (designee === null && declaree && (changeDeDossier || apres.type_piece !== 'vente')) {
    return dire(REFUS_GARDE_JUMELLE, changeDeDossier ? 'declaree_change_de_dossier' : 'declaree_change_de_nature')
  }
  return refusDeLaValidationDUneVente(piece, apres, contexte)
}

/**
 * G3, seule : la pièce telle qu'elle était (nulle à l'insertion) et telle qu'elle serait. Une pièce de vente validée d'un
 * dossier basculé, jugée à son PASSAGE — insérée validée, ou devenue validée, devenue une vente, arrivée d'un autre
 * dossier, sa désignation ou sa déclaration changée. La restauration du super-administrateur, que la base laisse passer,
 * n'est pas un geste d'écran.
 */
export function refusDeLaValidationDUneVente(
  avant: PieceMarquable | null,
  apres: PieceMarquable,
  contexte: { factures: readonly FacturePourMarquer[]; basculeDuDossier: boolean; pont: VerdictDuPont },
): RefusExemplaire<CleRefusValidationDUneVente> | null {
  const non = (cle: CleRefusValidationDUneVente, ...valeurs: string[]) => dire(REFUS_VALIDATION_D_UNE_VENTE, cle, ...valeurs)
  if (apres.type_piece !== 'vente' || apres.statut !== 'validee') return null
  const marque = (p: PieceMarquable) => `${p.facture_id ?? ''}|${String(p.vente_hors_des_factures ?? false)}`
  if (avant != null && avant.statut === 'validee' && avant.type_piece === 'vente' && avant.dossier_id === apres.dossier_id
    && marque(avant) === marque(apres)) return null
  if (!contexte.basculeDuDossier) return null
  if (avant == null) return non('nee_validee')
  if (contexte.pont.genre === 'une' && (apres.facture_id ?? null) !== contexte.pont.factureId) {
    return non('pont_une_facture', apres.nom_fichier, numeroDe(contexte.factures, contexte.pont.factureId))
  }
  if (contexte.pont.genre === 'contraires') return non('preuves_contraires', apres.nom_fichier)
  if ((apres.facture_id ?? null) === null && !(apres.vente_hors_des_factures ?? false)) {
    return non('ni_designee_ni_declaree', apres.nom_fichier)
  }
  return null
}

/**
 * G4 : POURQUOI CETTE PIÈCE NE SE RAPPROCHERAIT PAS d'un mouvement, ne recevrait pas une part d'un virement groupé, ne
 * s'écrirait ni ne se lettrerait — l'exemplaire d'une facture SOURCE. Null : G4 la laisserait passer, l'exemplaire d'une
 * facture qui n'est pas source compris. Les factures, lues en entier : une facture absente ne se dit pas.
 */
export function refusDuLienDeLExemplaire(
  piece: PieceMarquable,
  factures: readonly FacturePourMarquer[],
): RefusExemplaire<'exemplaire_d_une_source'> | null {
  const facture = factureDe(factures, piece.facture_id)
  if (facture === undefined || !facture.source_de_la_vente) return null
  return dire(REFUS_EXEMPLAIRE_D_UNE_SOURCE, 'exemplaire_d_une_source', piece.nom_fichier, facture.numero ?? SANS_NUMERO)
}

// ── Les paramètres des deux fonctions neuves, dans l'ordre de leur signature ───────────────────────────────────────────

export function argumentsDeLaDeclaration(dossierId: string, pieceId: string) {
  return { p_dossier_id: dossierId, p_piece_id: pieceId }
}

export function argumentsDuRetraitDeLaDeclaration(dossierId: string, pieceId: string) {
  return { p_dossier_id: dossierId, p_piece_id: pieceId }
}
