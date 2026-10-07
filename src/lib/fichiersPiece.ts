import type { Piece } from './types'

// LES FICHIERS D'UNE PIÈCE. Une pièce déposée n'en a qu'un. Une facture reçue de la plateforme agréée du client (ligne
// 28.5 de la feuille de route) en a DEUX quand son original est un XML (CII ou UBL) : l'original, que l'empreinte prouve
// (`storage_path`), et la version lisible que la plateforme en rend (`lisible_path`, un PDF). Deux règles en sortent,
// et chacune a un seul endroit :
//   - ce qui RETIRE une pièce retire ses deux fichiers : la version lisible laissée seule resterait dans le seau, plus
//     rien ne la désignant, jusqu'à la suppression du dossier entier ;
//   - ce qui MONTRE une pièce montre sa version lisible : un XML ne se lit pas, et c'est le PDF que le cabinet regarde
//     avant de valider ou de rapprocher. L'original reste à portée d'un lien.

type FichiersDeLaPiece = Pick<Piece, 'storage_path' | 'lisible_path'>

/** Les fichiers d'une pièce dans le seau, l'original d'abord — ce qu'un retrait doit emporter. */
export function fichiersDeLaPiece(piece: FichiersDeLaPiece): string[] {
  return [piece.storage_path, piece.lisible_path].filter((chemin): chemin is string => !!chemin)
}

/** Le fichier qu'on montre d'une pièce : sa version lisible quand elle en a une, sinon son original. */
export function fichierAMontrer(piece: FichiersDeLaPiece): { chemin: string; lisible: boolean } {
  return piece.lisible_path
    ? { chemin: piece.lisible_path, lisible: true }
    : { chemin: piece.storage_path, lisible: false }
}
