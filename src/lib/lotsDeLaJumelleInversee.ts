import {
  refusDeLaValidationDUneVente, refusDuLienDeLExemplaire, verdictDuPontDeLaPiece, type FacturePourMarquer, type PieceMarquable,
} from './exemplairesDesFactures'
import { facturesSourcesDe, type FacturesSources } from './facturesSources'
import type { LectureComplete } from './lectureComplete'
import {
  jumellesDuDossier, type FacturePourJumelle, type JumellesDuDossier, type PiecePourJumelle, type TransmissionPourJumelle,
} from './ventesJumelles'

// LES LOTS ET LE RELEVÉ DEVANT LA JUMELLE INVERSÉE (ligne 28.65, chantier EC-Q3, étape VF6d ; conception : HISTORIQUE.md,
// « VF6, LA JUMELLE INVERSÉE : LA CONCEPTION », § 5, puce VF6d). La migration `jumelle_inversee` (VF6b, appliquée le
// 24/10/2026) a posé deux gardes que les gestes EN LOT ne connaissaient pas :
//   - G3, `garder_vente_d_un_dossier_bascule` : dans un dossier dont les factures sont la source de leurs ventes, une pièce de
//     vente qui DEVIENT validée est l'exemplaire de la facture que le pont prouve, ou désignée, ou déclarée vente hors des
//     factures de l'application — sinon refusée. « Valider la sélection » (Justificatifs) envoie UNE mise à jour pour toute la
//     sélection : une seule pièce refusée la ferait échouer EN ENTIER. « Valider et rapprocher » (Banque) valide pièce par
//     pièce : la pièce refusée y finissait parmi les échecs, dits APRÈS le clic.
//   - G4, `garder_exemplaire_d_une_source` : l'exemplaire d'une facture SOURCE n'est ni rapproché d'un mouvement, ni réglé par
//     une part d'un virement groupé, ni écrit, ni lettré — la vente se règle et s'écrit par sa facture et ses encaissements.
//     Les plans du relevé (lib/appariementBanque.ts, lib/reglesAffectation.ts) et la fiche d'un mouvement le proposaient
//     comme une pièce à rapprocher.
// Ce module dit, AVANT le clic et sous les mots de la base, ce que chacune refuserait ; il ne recopie aucune règle : G3 et
// G4 sont redites par lib/exemplairesDesFactures.ts, confronté au texte exporté de la migration et à son essai. Il ne lit
// rien, n'appelle personne.
//
// SANS DOSSIER BASCULÉ, RIEN NE CHANGE : G3 ne juge qu'une pièce d'un dossier basculé, G4 que l'exemplaire d'une facture
// source, et la base refuse qu'une facture soit source dans un dossier qui n'a pas basculé (`fixer_source_de_la_vente`).

// ══ G3 : LA VALIDATION D'UNE PIÈCE DANS UN LOT ═════════════════════════════════════════════════════════════════════════

/**
 * Le pont de l'application calculé SANS la désignation des pièces : c'est ce que G3 et les fonctions de la base jugent
 * (`factures_du_pont`, le jumeau en base ; `verdictDuPontDeLaPiece`, lib/exemplairesDesFactures.ts). La désignation est la
 * marque que G3 compare à ce verdict : comptée comme une preuve, elle ferait passer pour sa jumelle une pièce que le pont
 * rattache à une AUTRE facture.
 */
export function pontSansLaDesignation(
  factures: readonly FacturePourJumelle[],
  transmissions: readonly TransmissionPourJumelle[],
  pieces: readonly PiecePourJumelle[],
): JumellesDuDossier {
  return jumellesDuDossier(factures, transmissions, pieces.map((p) => ({ ...p, facture_id: null })))
}

/** Ce que l'écran sait pour juger la validation d'une pièce de vente (G3). */
export type JugeDeLaValidation =
  // Le dossier n'a pas basculé : G3 ne juge rien, la validation est celle d'hier.
  | { etat: 'dormante' }
  // Les factures émises validées du dossier et le pont, lus EN ENTIER.
  | { etat: 'jugee'; factures: readonly FacturePourMarquer[]; pont: JumellesDuDossier }
  // Le dossier a basculé, et les factures ou le pont ne sont pas lus en entier (`motif`) — ou pas encore revenus (nul).
  | { etat: 'non_lue'; motif: string | null }

/** Ce que le pont lit : les factures émises validées du dossier et leurs transmissions (lib/ventesJumellesLecture.ts). */
export interface LectureDuPont {
  factures: readonly FacturePourJumelle[]
  transmissions: readonly TransmissionPourJumelle[]
  /** Non nul quand l'une des deux lectures est partielle. */
  motif: string | null
}

/**
 * Le juge de G3, tiré de ce que l'écran a lu. `dossierBascule` : le réglage du dossier (`dossiers.ventes_par_les_factures`) ;
 * `factures` : ses factures émises validées, avec leur source — nulles tant qu'elles ne sont pas revenues ; `pont` : ce que
 * lit le pont — nul de même ; `pieces` : les pièces lues, dont le pont ne regarde que chacune pour elle-même. Rien n'a de
 * valeur par défaut : un appelant qui oublierait la bascule validerait comme hier ce que la base refuse.
 */
export function jugeDeLaValidation(
  dossierBascule: boolean,
  factures: LectureComplete<FacturePourMarquer> | null,
  pont: LectureDuPont | null,
  pieces: readonly PiecePourJumelle[],
): JugeDeLaValidation {
  if (!dossierBascule) return { etat: 'dormante' }
  if (factures === null || pont === null) return { etat: 'non_lue', motif: null }
  if (!factures.complete) return { etat: 'non_lue', motif: factures.motif ?? 'lecture incomplète' }
  if (pont.motif !== null) return { etat: 'non_lue', motif: pont.motif }
  return { etat: 'jugee', factures: factures.lignes, pont: pontSansLaDesignation(pont.factures, pont.transmissions, pieces) }
}

/** Ce que l'écran dit d'une pièce de vente dont la validation ne se juge pas : les factures ou le pont ne sont pas lus. */
export function raisonNonLue(motif: string | null): string {
  return motif === null
    ? 'Les factures émises du dossier ne sont pas encore lues : la validation d’une pièce de vente attend leur lecture.'
    : `Les factures émises du dossier ne sont pas lues en entier (${motif}) : la validation d’une pièce de vente ne se juge `
      + 'pas — recharge la page.'
}

/**
 * POURQUOI LA BASE REFUSERAIT DE VALIDER CETTE PIÈCE (G3), sous ses mots — nul : elle l'accepterait. La validation ne change
 * que le statut : G3 la juge comme son PASSAGE à « validée » (une pièce déjà validée ne se rejuge pas, EC3-Q1). Sur des
 * lectures qui manquent, la pièce que G3 jugerait n'est pas validée à l'aveugle : le jugement est rendu au pire des ponts
 * (des preuves contraires, que G3 refuse toujours quand elle juge), et la raison dit la lecture qui manque.
 */
export function refusDeValiderEnLot(piece: PieceMarquable, juge: JugeDeLaValidation): string | null {
  const apres: PieceMarquable = { ...piece, statut: 'validee' }
  switch (juge.etat) {
    case 'dormante':
      return refusDeLaValidationDUneVente(piece, apres, { factures: [], basculeDuDossier: false, pont: { genre: 'aucune' } })?.message ?? null
    case 'non_lue':
      return refusDeLaValidationDUneVente(piece, apres, { factures: [], basculeDuDossier: true, pont: { genre: 'contraires' } }) === null
        ? null : raisonNonLue(juge.motif)
    case 'jugee':
      return refusDeLaValidationDUneVente(piece, apres, {
        factures: juge.factures, basculeDuDossier: true, pont: verdictDuPontDeLaPiece(juge.pont, piece.id),
      })?.message ?? null
  }
}

/** Aucune pièce dont la validation serait refusée : le fait d'un dossier qui n'a pas basculé (G3 dormante). */
export const AUCUN_REFUS_DE_VALIDATION: ReadonlyMap<string, string> = new Map()

/** Les pièces dont la validation serait refusée, chacune avec sa raison : pièce → raison. */
export function refusDeValidationDesPieces(
  pieces: readonly PieceMarquable[], juge: JugeDeLaValidation,
): ReadonlyMap<string, string> {
  const refus = new Map<string, string>()
  if (juge.etat === 'dormante') return refus
  for (const p of pieces) {
    const r = refusDeValiderEnLot(p, juge)
    if (r !== null) refus.set(p.id, r)
  }
  return refus
}

export interface ValidationEnLot<P> {
  /** Ce que « Valider la sélection » envoie. */
  aValider: P[]
  /** Ce qu'elle écarte, et pourquoi : chaque pièce reste à valider. */
  ecartees: { piece: P; raison: string }[]
}

/** « Valider la sélection » : la sélection, moins les pièces que G3 refuserait — une seule ferait échouer l'envoi entier. */
export function validationEnLot<P extends PieceMarquable>(selection: readonly P[], juge: JugeDeLaValidation): ValidationEnLot<P> {
  const lot: ValidationEnLot<P> = { aValider: [], ecartees: [] }
  for (const piece of selection) {
    const raison = refusDeValiderEnLot(piece, juge)
    if (raison === null) lot.aValider.push(piece)
    else lot.ecartees.push({ piece, raison })
  }
  return lot
}

/** Ce que la sélection dit de ce qu'elle écarte, en une phrase : combien. Nul : elle n'écarte rien. */
export function resumeDeLaSelection(nbEcartees: number): string | null {
  if (nbEcartees === 0) return null
  return nbEcartees === 1
    ? '1 pièce de la sélection ne se valide pas en lot : elle reste à valider.'
    : `${nbEcartees} pièces de la sélection ne se valident pas en lot : elles restent à valider.`
}

/** Ce que la carte « Valider et rapprocher » dit des paires qu'elle écarte parce que la pièce ne se validerait pas. */
export function resumeDesPairesEcartees(nbEcartees: number): string | null {
  if (nbEcartees === 0) return null
  return nbEcartees === 1
    ? '1 pièce écartée : elle ne se valide pas en lot.'
    : `${nbEcartees} pièces écartées : elles ne se valident pas en lot.`
}

// ══ G4 : L'EXEMPLAIRE D'UNE FACTURE SOURCE NE JUSTIFIE AUCUN MOUVEMENT ═════════════════════════════════════════════════

/**
 * Ce que le relevé sait des exemplaires des factures sources : les factures sources (ce que les plans écartent, par
 * `exemplaireDUneSource`, lib/facturesSources.ts) et, pour chaque exemplaire parmi les pièces lues, les mots de G4 (ce que la
 * fiche dit d'une proposition du client, ce que le règlement groupé refuse).
 */
export interface ExemplairesDesSources {
  sources: FacturesSources
  raisons: ReadonlyMap<string, string>
}

/**
 * Aucun exemplaire de facture source : un dossier qui n'a pas basculé — la base y refuse toute facture source. Jamais pour
 * des ventes facturées pas encore lues : l'onglet Banque retient alors ses lots et ses gestes (`retenueDuReleve`).
 */
export const AUCUN_EXEMPLAIRE_DE_SOURCE: ExemplairesDesSources = { sources: new Set(), raisons: new Map() }

/** Les exemplaires des factures sources parmi des pièces lues, sur les factures émises du dossier lues EN ENTIER. */
export function exemplairesDesSourcesDe(
  pieces: readonly PieceMarquable[], factures: readonly FacturePourMarquer[],
): ExemplairesDesSources {
  const raisons = new Map<string, string>()
  for (const p of pieces) {
    const refus = refusDuLienDeLExemplaire(p, factures)
    if (refus !== null) raisons.set(p.id, refus.message)
  }
  return { sources: facturesSourcesDe(factures), raisons }
}

/** Ce que la fiche d'un mouvement ajoute aux mots de G4, d'une pièce que le client a proposée. */
export const NE_S_ASSOCIE_PAS = 'Elle ne s’associe pas à ce mouvement.'
