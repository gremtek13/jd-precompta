import { supabase } from './supabase'

// Le texte lu par l'OCR sur une pièce, conservé et relu.
//
// Il était déjà calculé à chaque extraction — c'est lui qui sert à classer le document, à retrouver
// une date, à rattraper une TVA — mais il était jeté aussitôt. L'opérateur qui arbitre
// « BOULANGER MARSEILLE, 199,99 € » n'avait donc aucun moyen de savoir ce qui avait été acheté, alors
// que la réponse (« FOUR MICRO-ONDES ») était sous ses yeux à l'extraction.
//
// C'est la réponse la moins chère au problème du « pourquoi » : zéro saisie, pour personne. Le
// commentaire du client (voir lib/commentaires.ts) la complète — l'OCR dit CE QUI a été acheté, le
// client dit POURQUOI — mais il ne la remplace pas, et l'inverse non plus.
//
// Stocké dans une table à part et non sur `pieces` : plusieurs écrans font `select('*')` sur les
// pièces d'un dossier, et rapatrier des kilo-octets de texte par ligne à chaque ouverture d'onglet
// se paierait sur un écran que le cabinet ouvre toute la journée et que le client ouvre au
// téléphone. Ici, le texte ne se charge que lorsqu'on le demande.

// Un texte vide n'est pas un texte : Textract n'a rien lu (photo floue, page blanche, PDF d'images
// sans couche texte). L'enregistrer ferait croire à l'écran que le document a été lu et qu'il ne
// contient rien, alors que le vrai message est « la lecture a échoué ».
export function texteOcrExploitable(texte: string | null | undefined): string | null {
  const propre = (texte ?? '').trim()
  return propre.length > 0 ? propre : null
}

// Enregistre le texte lu pour une pièce. Ne remonte PAS l'erreur à l'appelant et ne la fait pas
// échouer : ce texte est un confort de relecture, pas une donnée comptable. Un dépôt qui échouerait
// parce que l'OCR n'a pas pu être archivé ferait perdre au client un document — une perte sans
// commune mesure avec le service rendu.
export async function enregistrerTexteOcr(
  dossierId: string,
  pieceId: string,
  texte: string | null | undefined,
): Promise<void> {
  const propre = texteOcrExploitable(texte)
  if (!propre) return
  // `upsert` et non `insert` : une pièce relue (voir lib/relectureDocuments.ts) doit remplacer son
  // texte, pas en accumuler un second — la clé primaire est `piece_id`.
  await supabase
    .from('piece_textes_ocr')
    .upsert({ dossier_id: dossierId, piece_id: pieceId, texte: propre, updated_at: new Date().toISOString() })
}

// Les pièces d'un dossier dont on a le texte. Volontairement les identifiants SEULS : c'est ce qui
// permet à la liste d'afficher « voir le texte lu » sans rapatrier les textes eux-mêmes.
export async function piecesAvecTexteOcr(dossierId: string): Promise<Set<string>> {
  const { data } = await supabase.from('piece_textes_ocr').select('piece_id').eq('dossier_id', dossierId)
  return new Set((data ?? []).map((l) => l.piece_id as string))
}

// Le texte d'une seule pièce, chargé à la demande. Null quand il n'a jamais été enregistré — cas
// normal pour toute pièce déposée avant que ce texte ne soit conservé.
export async function texteOcrDeLaPiece(pieceId: string): Promise<string | null> {
  const { data } = await supabase.from('piece_textes_ocr').select('texte').eq('piece_id', pieceId).maybeSingle()
  return texteOcrExploitable(data?.texte)
}
