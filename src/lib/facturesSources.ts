import { estUneVente } from './facturesReprises'
import type { FactureEmise, Piece } from './types'

// L'EXEMPLAIRE D'UNE FACTURE SOURCE NE COMPTE NULLE PART (ligne 28.65, chantier EC-Q3 ; étape VF6a). Désignée exemplaire
// d'une facture ou d'un avoir SOURCE de sa vente (`pieces.facture_id`, étape VF1 ; `factures_emises.source_de_la_vente`,
// étape VF2), une pièce prouve la vente et ne la compte plus : c'est la facture qui la compte, par ses encaissements en
// trésorerie, par elle-même en engagement — et ses écritures sont celles de la vente facturée (VF4). Les moteurs de la
// 2035, de la CA3, de la situation et de l'estimation l'écartent depuis VF3b (lib/ventesFacturees.ts) ; le brouillon, ses
// contrôles et les préalables de la validation l'écartent depuis VF6a, par le même prédicat — une seule règle.
//
// Une pièce désignée à une facture qui N'EST PAS source compte comme hier, partout : le pont (lib/ventesJumelles.ts) dit
// seulement quand elle double sa jumelle.
//
// LES FACTURES SOURCES SE LISENT, ELLES NE SE SUPPOSENT PAS. Chaque fonction qui juge une pièce les reçoit en paramètre
// OBLIGATOIRE, sans valeur par défaut : un appelant qui les oublierait écrirait au brouillon la vente d'un exemplaire à
// côté de celle de sa facture, et la compterait deux fois au FEC, à la balance et au bilan. Un ensemble vide est une
// affirmation (« ce dossier n'a aucune facture source »), qui ne se dit que d'une lecture faite en entier.
//
// LES FACTURES REPRISES (étape A8c3 ; A8-Q1, A8-Q5). Une facture reprise de l'ancien logiciel (l'état « importee »),
// qu'`importer_factures` marque source, est une facture source, le drapeau `FACTURES_IMPORTEES_PREVUES` levé : ses
// encaissements d'après la date de reprise la comptent, par son registre (A8b) — l'ensemble est celui des moteurs
// (`VentesFacturees.sources`, lib/ventesFacturees.ts). Elle n'a jamais d'EXEMPLAIRE : la désignation ne vise qu'une facture
// validée de l'application (`designer_exemplaire_facture`). La pièce déjà au dossier qu'elle cite pour ORIGINAL
// (`pieces_des_factures_reprises`, A8-Q5) n'en est pas un : elle garde ce qu'elle a compté avant la date de reprise — ses
// paiements d'avant sont l'encaissé avant la reprise, dont la règle du cumul part sans le recompter —, et la base refuse
// qu'elle se règle à la date de reprise ou après (`garder_reglement_d_une_piece_reprise`). L'écarter tout entière ôterait de
// la 2035 une recette encaissée avant la reprise. RESTE OUVERT (le défaut confirmé le 10/11/2026, HISTORIQUE.md, « A8C3 ») :
// en trésorerie, son reste IMPAYÉ compte encore à la date de la pièce (`sans_paiement`) alors que le registre de la reprise
// compte l'encaissement d'après — la règle à poser ici : une pièce citée par un lien ACTIF ne compte que ses paiements.

/** Les identifiants des factures et avoirs validés SOURCES de leur vente (`VentesFacturees.sources`, lus en entier). */
export type FacturesSources = ReadonlySet<string>

/** La pièce est-elle l'exemplaire désigné d'une facture source ? */
export function exemplaireDUneSource(piece: Pick<Piece, 'facture_id'>, sources: FacturesSources): boolean {
  return piece.facture_id != null && sources.has(piece.facture_id)
}

/** Les pièces qui comptent : toutes, moins les exemplaires des factures sources. */
export function horsDesExemplairesDesSources<P extends Pick<Piece, 'facture_id'>>(
  pieces: readonly P[], sources: FacturesSources,
): P[] {
  return pieces.filter((p) => !exemplaireDUneSource(p, sources))
}

/**
 * Les pièces, par identifiant, qui sont l'exemplaire d'une facture source : pour un contrôle qui part de l'ÉCRITURE et ne
 * connaît que la pièce qu'elle cite (`analyserEcritures`).
 */
export function exemplairesDesSources(pieces: readonly Pick<Piece, 'id' | 'facture_id'>[], sources: FacturesSources): ReadonlySet<string> {
  return new Set(pieces.filter((p) => exemplaireDUneSource(p, sources)).map((p) => p.id))
}

/**
 * Les factures sources parmi des factures émises lues EN ENTIER : validées — ou, le drapeau levé, reprises (A8c3) —, et
 * source de leur vente. Le filtre est celui de la base (`factures_emises_source_d_une_facture_validee` : un brouillon n'est
 * jamais source), refait ici pour qu'une lecture plus large que l'appelant ne l'a voulu ne compte pas une facture qui ne
 * l'est pas.
 */
export function facturesSourcesDe(
  factures: readonly Pick<FactureEmise, 'id' | 'statut' | 'source_de_la_vente'>[],
): FacturesSources {
  return new Set(factures.filter((f) => estUneVente(f) && f.source_de_la_vente === true).map((f) => f.id))
}

/**
 * Aucune facture source : le fait d'un dossier qui n'a pas basculé — la base y refuse toute facture source
 * (`fixer_source_de_la_vente`). Jamais pour des factures qui ne sont pas encore lues : ce vide est une affirmation.
 */
export const AUCUNE_FACTURE_SOURCE: FacturesSources = new Set()
