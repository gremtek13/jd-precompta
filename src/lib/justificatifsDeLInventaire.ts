import { formatDate, formatMoney } from './format'
import type { GenreDeProvision } from './inventaire'
import { correspondALaRecherche } from './recherche'
import type { FactureEmise, Piece, TypePiece } from './types'

// CE QU'UNE ÉCRITURE D'INVENTAIRE CITE (ligne 35, INV5-Q1 (B) : « tout de suite ») : la pièce qui fonde une régularisation — la
// facture d'assurance d'une charge constatée d'avance, la facture de janvier d'une charge à payer —, et ce qui fonde une provision
// — une pièce du dossier pour un risque ; pour la dépréciation d'une créance, la facture émise dépréciée ou une pièce de vente.
// Un module PUR : l'onglet (pages/dossier/InventaireTab.tsx) lit les pièces et les factures EN ENTIER
// (lib/justificatifsDeLInventaireLecture.ts) et les lui donne ; ici se décident ce qui se PROPOSE, le refus dit avant le clic, et
// les mots qui nomment le choix.
//
// CE QUE LA BASE ACCEPTE, ET RIEN DE PLUS LARGE (supabase/preparees/20261112190000_operations_d_inventaire.sql, étape 10 ;
// 20261112230000_provisions.sql, étape 6) :
//  - une régularisation cite une pièce de CE dossier, quels que soient son sens et son statut — la facture de janvier d'une charge
//    à payer est souvent encore « à valider » à la clôture ; le module n'écarte donc aucune pièce du dossier ;
//  - une provision pour risques, une pièce de ce dossier ; la dépréciation d'une créance, une pièce de VENTE de ce dossier, ou une
//    facture émise VALIDÉE de ce dossier — jamais les deux. L'écran est plus strict que la base sur un point : un avoir validé ne se
//    propose pas comme la créance dépréciée (un avoir n'est pas une créance) ;
//  - le refus que la base lèverait se dit AVANT le clic, aux mots de la migration (`MOTS_DES_JUSTIFICATIFS`, confrontés à son
//    texte par justificatifsDeLInventaire.test.ts).

/** Les colonnes d'une pièce que le choix montre et juge. */
export type PieceACiter = Pick<Piece, 'id' | 'dossier_id' | 'nom_fichier' | 'date_piece' | 'tiers' | 'montant_ttc' | 'type_piece' | 'statut'>
/** Les colonnes d'une facture émise que le choix montre et juge. */
export type FactureACiter = Pick<FactureEmise, 'id' | 'dossier_id' | 'numero' | 'statut' | 'type' | 'date_emission' | 'tiers_nom' | 'montant_ttc'>

/** Les pièces et les factures émises du dossier, lues EN ENTIER. */
export interface JustificatifsDuDossier {
  pieces: readonly PieceACiter[]
  factures: readonly FactureACiter[]
}

/** Ce qu'une provision cite : une pièce, ou la facture émise dépréciée. Une régularisation ne cite qu'une pièce. */
export type Citation = { genre: 'piece'; id: string } | { genre: 'facture'; id: string }

/** Les refus que les deux fonctions de la base lèvent sur ce qui est cité, à leur mot. */
export const MOTS_DES_JUSTIFICATIFS = {
  pieceHorsDuDossier: 'La pièce citée n’est pas une pièce de ce dossier.',
  pieceHorsDesVentes: 'La pièce citée n’est pas une pièce de vente de ce dossier.',
  factureHorsDeLaDepreciation: 'Seule la dépréciation d’une créance cite une facture.',
  factureNonValidee: 'La facture citée n’est pas une facture validée de ce dossier.',
} as const

const LIBELLES_DES_TYPES: Readonly<Record<TypePiece, string>> = {
  achat: 'Dépense', vente: 'Recette', note_frais: 'Note de frais', autre: 'Autre pièce',
}

// ── Ce qui se propose ────────────────────────────────────────────────────────────────────────────────────────────────────

/** La plus récente d'abord (une pièce sans date à la fin), puis l'identifiant : un ordre total, stable d'une lecture à l'autre. */
const parDate = <T extends { id: string }>(date: (x: T) => string | null) => (a: T, b: T): number => {
  const da = date(a) ?? ''
  const db = date(b) ?? ''
  if (da !== db) return da === '' ? 1 : db === '' ? -1 : da < db ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Les pièces qu'une régularisation peut citer : toutes celles du dossier. */
export function piecesCitablesParUneRegularisation(j: JustificatifsDuDossier): PieceACiter[] {
  return [...j.pieces].sort(parDate((p) => p.date_piece))
}

/** Ce qu'une provision de ce genre peut citer : pour un risque, toute pièce et aucune facture ; pour une créance, les pièces de
 *  vente et les factures émises validées (les avoirs écartés). */
export function citablesParUneProvision(genre: GenreDeProvision, j: JustificatifsDuDossier): JustificatifsDuDossier {
  if (genre === 'risque') return { pieces: piecesCitablesParUneRegularisation(j), factures: [] }
  return {
    pieces: j.pieces.filter((p) => p.type_piece === 'vente').sort(parDate((p) => p.date_piece)),
    factures: j.factures.filter((f) => f.statut === 'validee' && f.type === 'facture').sort(parDate((f) => f.date_emission)),
  }
}

// ── Le refus dit avant le clic ───────────────────────────────────────────────────────────────────────────────────────────

/** Le refus que `enregistrer_operation_inventaire` lèverait sur la pièce citée ; nul quand elle l'accepte, ou quand les pièces
 *  ne sont pas lues (la base jugera seule : la pièce déjà citée d'une régularisation remplacée est, elle, toujours du dossier). */
export function refusDeLaPieceDUneRegularisation(pieceId: string | null, j: JustificatifsDuDossier | null): string | null {
  if (pieceId === null || j === null) return null
  return j.pieces.some((p) => p.id === pieceId) ? null : MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier
}

/** Le refus que `enregistrer_provision` lèverait sur ce qu'elle cite, dans l'ordre de la base (la facture, puis la pièce). */
export function refusDeLaCitationDUneProvision(
  genre: GenreDeProvision, citation: Citation | null, j: JustificatifsDuDossier | null,
): string | null {
  if (citation === null) return null
  if (citation.genre === 'facture') {
    if (genre !== 'depreciation_creance') return MOTS_DES_JUSTIFICATIFS.factureHorsDeLaDepreciation
    if (j === null) return null
    return citablesParUneProvision(genre, j).factures.some((f) => f.id === citation.id) ? null : MOTS_DES_JUSTIFICATIFS.factureNonValidee
  }
  if (j === null) return null
  if (citablesParUneProvision(genre, j).pieces.some((p) => p.id === citation.id)) return null
  return genre === 'risque' ? MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier : MOTS_DES_JUSTIFICATIFS.pieceHorsDesVentes
}

// ── Les mots qui nomment le choix ────────────────────────────────────────────────────────────────────────────────────────

/** Une option de la liste : son titre (le nom du fichier d'une pièce, qui porte `.nom-fichier` à l'écran ; le numéro d'une
 *  facture), ce qui la situe, et ce que la recherche commune lit. */
export interface OptionDeCitation {
  citation: Citation
  titre: string
  /** Vrai : le titre est un nom de fichier. */
  fichier: boolean
  detail: string
  champs: readonly (string | number | null)[]
}

const separes = (morceaux: readonly (string | null)[]): string => morceaux.filter((m): m is string => m !== null && m !== '').join(' · ')

export function optionDeLaPiece(p: PieceACiter): OptionDeCitation {
  const date = p.date_piece === null ? 'sans date' : formatDate(p.date_piece)
  const montant = p.montant_ttc === null ? null : `${formatMoney(p.montant_ttc)} TTC`
  return {
    citation: { genre: 'piece', id: p.id }, titre: p.nom_fichier, fichier: true,
    detail: separes([LIBELLES_DES_TYPES[p.type_piece], date, p.tiers, montant, p.statut === 'a_valider' ? 'à valider' : null]),
    champs: [p.nom_fichier, p.tiers, p.date_piece === null ? null : formatDate(p.date_piece), p.montant_ttc, LIBELLES_DES_TYPES[p.type_piece]],
  }
}

export function optionDeLaFacture(f: FactureACiter): OptionDeCitation {
  return {
    citation: { genre: 'facture', id: f.id }, titre: `Facture ${f.numero ?? 'sans numéro'}`, fichier: false,
    detail: separes(['Facture émise', formatDate(f.date_emission), f.tiers_nom, `${formatMoney(f.montant_ttc)} TTC`]),
    champs: [f.numero, f.tiers_nom, formatDate(f.date_emission), f.montant_ttc],
  }
}

/** Les options, factures d'abord (la créance d'une facture de l'application), puis les pièces, chacune dans son ordre. */
export function optionsDeCitation(j: JustificatifsDuDossier): OptionDeCitation[] {
  return [...j.factures.map(optionDeLaFacture), ...j.pieces.map(optionDeLaPiece)]
}

/** L'option de ce qui est cité, cherchée dans TOUT ce que le dossier porte (même hors des proposées) ; nulle si rien n'est cité,
 *  si rien n'est lu, ou si la citation ne se retrouve pas. */
export function optionCitee(citation: Citation | null, j: JustificatifsDuDossier | null): OptionDeCitation | null {
  if (citation === null || j === null) return null
  if (citation.genre === 'facture') {
    const f = j.factures.find((x) => x.id === citation.id)
    return f === undefined ? null : optionDeLaFacture(f)
  }
  const p = j.pieces.find((x) => x.id === citation.id)
  return p === undefined ? null : optionDeLaPiece(p)
}

/** Combien d'options la liste affiche au plus : au-delà, elle le dit et invite à chercher. */
export const OPTIONS_AFFICHEES_AU_PLUS = 50

/** Les options que la recherche commune garde, plafonnées ; `trouvees` les compte toutes, pour que la liste dise son plafond. */
export function optionsAffichees(
  options: readonly OptionDeCitation[], recherche: string,
): { affichees: OptionDeCitation[]; trouvees: number } {
  const gardees = options.filter((o) => correspondALaRecherche([...o.champs], recherche))
  return { affichees: gardees.slice(0, OPTIONS_AFFICHEES_AU_PLUS), trouvees: gardees.length }
}

/** La ligne de la confirmation qui NOMME ce qui est cité ; une citation que la lecture ne retrouve pas (les pièces pas lues, une
 *  régularisation remplacée) se dit « déjà citée », jamais devinée. */
export function ligneDeLaCitation(citation: Citation | null, j: JustificatifsDuDossier | null): string {
  if (citation === null) return 'Aucune pièce citée.'
  const o = optionCitee(citation, j)
  if (citation.genre === 'facture') return o === null ? 'Facture citée : celle qui était déjà citée.' : `Facture citée : ${o.titre} (${o.detail}).`
  return o === null ? 'Pièce citée : celle qui était déjà citée.' : `Pièce citée : « ${o.titre} » (${o.detail}).`
}
