// LE CHEMIN D'UNE LIGNE, VÉRIFIÉ AVANT TOUT APPEL AU STOCKAGE (CFCS-Q1, défense en profondeur, 12/11/2026).
//
// La base ne lie pas le premier segment de `pieces.storage_path`, `pieces.lisible_path` ni
// `documents_divers.storage_path` au dossier de la ligne, et un client en insère : une pièce de son dossier peut nommer
// le fichier d'un AUTRE dossier du cabinet (relecture de sécurité du 12/11/2026, sondée). Un lecteur qui télécharge
// avec les droits du cabinet — le pack, le paquet d'archive, la relecture OCR qui écrit ensuite sur la pièce ce
// qu'elle a lu, la fiche d'une pièce — lirait alors ce fichier pour le compte du mauvais dossier. Chaque lecteur
// appelle donc `cheminDuDossier` AVANT le stockage ; un chemin hors du dossier n'est pas demandé, il se compte
// manquant ou en erreur selon le lecteur, et se dit sans recopier le chemin (`MOTIF_CHEMIN_HORS_DU_DOSSIER`).
// Le scanner `cheminsDuStockage.test.ts` part de tout appel au stockage de `src/` et l'exige.

/** Le chemin est-il dans ce dossier : son premier segment est le dossier, et aucun segment n'est vide, « . » ni « .. ». */
export function cheminDuDossier(chemin: string, dossierId: string): boolean {
  const segments = chemin.split('/')
  return segments.length >= 2 && segments[0] === dossierId && segments.every((x) => x !== '' && x !== '.' && x !== '..')
}

/** Ce qu'un lecteur dit d'un chemin hors du dossier : jamais le chemin ni le nom du fichier. */
export const MOTIF_CHEMIN_HORS_DU_DOSSIER = 'son chemin de stockage n’est pas dans ce dossier : fichier non lu, à signaler'
