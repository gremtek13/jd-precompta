// LE CHEMIN D'UNE LIGNE, VÉRIFIÉ AVANT TOUT APPEL AU STOCKAGE (CFCS-Q1, défense en profondeur, 12/11/2026).
//
// La base ne liait pas le premier segment de `pieces.storage_path`, `pieces.lisible_path` ni
// `documents_divers.storage_path` au dossier de la ligne, et un client en insère : une pièce de son dossier peut nommer
// le fichier d'un AUTRE dossier du cabinet (relecture de sécurité du 12/11/2026, sondée). Un lecteur qui télécharge
// avec les droits du cabinet — le pack, le paquet d'archive, la relecture OCR qui écrit ensuite sur la pièce ce
// qu'elle a lu, la fiche d'une pièce — lirait alors ce fichier pour le compte du mauvais dossier. Chaque lecteur
// appelle donc `cheminDuDossier` AVANT le stockage ; un chemin hors du dossier n'est pas demandé, il se compte
// manquant ou en erreur selon le lecteur, et se dit sans recopier le chemin (`MOTIF_CHEMIN_HORS_DU_DOSSIER`).
// Le scanner `cheminsDuStockage.test.ts` part de tout appel au stockage de `src/` et l'exige.

// Les caractères que l'adresse d'un fichier réécrit : le client du stockage place le chemin TEL QUEL dans l'adresse du
// téléchargement et de la signature (`@supabase/storage-js`, `StorageFileApi`), et l'analyseur d'adresses (WHATWG URL
// Standard, « path state ») y lit la barre oblique inverse comme une barre, « %2e » comme un point, retire tabulations et
// sauts de ligne, et coupe le chemin à « ? » ou « # ». Sans eux, « <dossier>/..<barre inverse><autre>/f.pdf » ou
// « <dossier>/%2e%2e/<autre>/f.pdf » passeraient la règle des segments et désigneraient le fichier d'un autre dossier.
// La base tient la même règle (migration `chemin_dans_son_dossier`, CFCS-Q1), un peu plus stricte sur les contrôles
// Unicode (`[:cntrl:]`) : un chemin que l'application compose n'en porte jamais.
const CARACTERES_REECRITS = /[\\%?#\x00-\x1f\x7f-\x9f]/

/** Le chemin est-il dans ce dossier : son premier segment est le dossier, aucun segment n'est vide, « . » ni « .. », et
 * aucun caractère ne s'y lit que l'adresse d'un fichier réécrirait (barre oblique inverse, « % », « ? », « # », contrôle). */
export function cheminDuDossier(chemin: string, dossierId: string): boolean {
  const segments = chemin.split('/')
  return segments.length >= 2 && segments[0] === dossierId && segments.every((x) => x !== '' && x !== '.' && x !== '..')
    && !CARACTERES_REECRITS.test(chemin)
}

/** Ce qu'un lecteur dit d'un chemin hors du dossier : jamais le chemin ni le nom du fichier. */
export const MOTIF_CHEMIN_HORS_DU_DOSSIER = 'son chemin de stockage n’est pas dans ce dossier : fichier non lu, à signaler'
