import type { Piece } from './types'

// L'EMPREINTE DE DÉPÔT D'UNE PIÈCE (`pieces.storage_hash`) : le SHA-256 de son fichier, calculé au dépôt (lib/depot.ts).
// Une pièce déposée avant que le dépôt le calcule n'en a pas : la forme 2 de l'empreinte d'un exercice validé ne scelle
// alors pas son fichier, et le paquet d'archive l'inclut marquée « non vérifiée » (INAL3-Q1). Deux réponses du cabinet du
// 11/11/2026 en découlent : le paquet la prend (lib/paquetDArchive.ts), et la validation la SIGNALE avant le clic, en
// attention, sans bloquer (INAL12-Q2 : le préalable et le point de la Checklist `pieces-sans-empreinte`). Une seule règle de
// l'absence, ici, pour les trois.

/** L'empreinte de dépôt d'une pièce, en minuscules ; nulle quand la pièce n'en porte pas (nulle, vide ou blanche). */
export function empreinteDeDepot(piece: Pick<Piece, 'storage_hash'>): string | null {
  const e = (piece.storage_hash ?? '').trim().toLowerCase()
  return e === '' ? null : e
}

/** Vrai quand la pièce n'a pas d'empreinte de dépôt. Une valeur d'une autre forme qu'un SHA-256 n'est pas une absence. */
export function sansEmpreinteDeDepot(piece: Pick<Piece, 'storage_hash'>): boolean {
  return empreinteDeDepot(piece) === null
}

/** Le message commun du préalable et du point de la Checklist, après leur nombre. */
export const MESSAGE_PIECES_SANS_EMPREINTE = 'pièce(s) validée(s) sans empreinte de fichier — déposée(s) avant que '
  + 'l’application la calcule : l’empreinte de l’exercice ne scellera pas leur fichier, et le paquet d’archive les '
  + 'marquera « non vérifiée ». Rien ne bloque la validation.'
