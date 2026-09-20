import { supabase } from './supabase'
import { lireTout } from './lectureComplete'

// Le texte lu par l'OCR sur une pièce OU sur un document, conservé et relu.
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
//
// **Il couvre les DOCUMENTS autant que les pièces, et ce n'était pas le cas.** Textract tourne sur
// tous les fichiers déposés ; le texte revenait donc aussi pour les relevés bancaires, les appels de
// cotisation, les attestations et les relevés d'activité — et il était jeté pour chacun d'eux, après
// avoir été payé. Soixante-sept documents en production, dont les SNIR qui portent les honoraires de
// l'année, c'est-à-dire précisément le document qu'un cabinet veut pouvoir relire.
//
// Pire : déplacer une pièce vers Documents supprimait la ligne `pieces`, et le texte partait en
// cascade. La table porte encore le nom `piece_textes_ocr` pour ne pas casser le code existant, mais
// elle accepte désormais `piece_id` XOR `document_id` — même motif que `lignes_bancaires`.

// Ce à quoi un texte se rattache. Un type somme plutôt que deux paramètres optionnels : « exactement
// une cible » est une contrainte de la base (CHECK), autant que le compilateur la fasse respecter ici.
export type CibleTexteOcr = { type: 'piece'; id: string } | { type: 'document'; id: string }

const colonneDe = (cible: CibleTexteOcr) => (cible.type === 'piece' ? 'piece_id' : 'document_id')

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
  cible: CibleTexteOcr,
  texte: string | null | undefined,
): Promise<void> {
  const propre = texteOcrExploitable(texte)
  if (!propre) return

  // `upsert` et non `insert` : une pièce relue (voir lib/relectureDocuments.ts) doit REMPLACER son
  // texte, pas en accumuler un second.
  //
  // **`onConflict` est explicite, et c'est indispensable.** La clé primaire est désormais un `id` de
  // substitution — il a bien fallu, `piece_id` devant pouvoir être nul. Sans cette mention, l'upsert
  // porterait sur cette clé de substitution, ne trouverait jamais de conflit et empilerait un
  // doublon à chaque relecture. C'est la famille de panne que ce projet connaît déjà : un
  // `onConflict` qui ne correspond à rien, et une écriture qui rate en silence.
  const { error } = await supabase
    .from('piece_textes_ocr')
    .upsert(
      { dossier_id: dossierId, [colonneDe(cible)]: cible.id, texte: propre, updated_at: new Date().toISOString() },
      { onConflict: colonneDe(cible) },
    )

  // Non bloquant, mais journalisé : une écriture best-effort n'est jamais avalée en silence.
  if (error) console.error('Enregistrement du texte OCR échoué:', error)
}

// Qui, dans ce dossier, a déjà un texte lu — et si on a pu le savoir.
//
// **L'erreur est rendue, et ce n'est pas du zèle.** Une lecture qui échoue donnerait un ensemble
// VIDE, indiscernable de « aucun texte en base » : l'écran proposerait alors « Retrouver le texte
// lu (N) » sur tout le dossier, et chaque relecture est un appel Textract FACTURÉ sur des documents
// dont le texte est peut-être déjà là. C'est la famille de panne que ce projet connaît — une lecture
// dont l'échec ressemble à un résultat vide — appliquée à la seule liste dont dépend une dépense.
export interface PresenceTexteOcr {
  avecTexte: Set<string>
  erreur: string | null
}

// Les pièces d'un dossier dont on a le texte. Volontairement les identifiants SEULS : c'est ce qui
// permet à la liste d'afficher « voir le texte lu » sans rapatrier les textes eux-mêmes.
export async function piecesAvecTexteOcr(dossierId: string): Promise<PresenceTexteOcr> {
  return presenceTexteOcr(dossierId, 'piece_id')
}

// Le pendant côté Documents — même usage : savoir quelles lignes peuvent proposer « voir le texte
// lu » sans rapatrier les textes eux-mêmes.
export async function documentsAvecTexteOcr(dossierId: string): Promise<PresenceTexteOcr> {
  return presenceTexteOcr(dossierId, 'document_id')
}

async function presenceTexteOcr(
  dossierId: string,
  colonne: 'piece_id' | 'document_id',
): Promise<PresenceTexteOcr> {
  // Lue par tranches : une ligne par pièce et par document, donc cette table suit la taille du
  // dossier. Tronquée, elle ferait passer pour « sans texte » des documents déjà lus — et chaque
  // relecture est un appel Textract FACTURÉ. Une lecture incomplète vaut donc erreur ici, au même
  // titre qu'un refus : dans les deux cas on ne sait pas, et ne pas savoir interdit de relancer.
  const { lignes, complete, motif } = await lireTout<Record<string, unknown>>((debut, fin) =>
    supabase.from('piece_textes_ocr').select(colonne, { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  return {
    avecTexte: new Set(
      lignes.map((l) => l[colonne] as string | null).filter((id): id is string => !!id),
    ),
    erreur: complete ? null : motif,
  }
}

// Le texte d'une seule pièce, chargé à la demande. Null quand il n'a jamais été enregistré — cas
// normal pour toute pièce déposée avant que ce texte ne soit conservé.
export async function texteOcrDeLaPiece(pieceId: string): Promise<string | null> {
  return texteOcrDe({ type: 'piece', id: pieceId })
}

export async function texteOcrDuDocument(documentId: string): Promise<string | null> {
  return (await lireTexteOcrDuDocument(documentId)).texte
}

// Même lecture, mais qui DIT si elle a échoué. Les deux cas rendent `texte: null` et sont pourtant
// opposés : « ce document n'a pas de texte » est normal, « la lecture a été refusée » veut dire que
// le texte existe peut-être et qu'on ne l'a pas. L'appelant qui s'apprête à SUPPRIMER le document
// (voir DocumentsTab.convertirEnPiece) doit pouvoir faire la différence : confondre les deux
// détruirait le texte au moment précis où le code prend soin de ne pas le perdre.
export async function lireTexteOcrDuDocument(
  documentId: string,
): Promise<{ texte: string | null; erreur: string | null }> {
  const { data, error } = await supabase
    .from('piece_textes_ocr')
    .select('texte')
    .eq('document_id', documentId)
    .maybeSingle()
  return { texte: texteOcrExploitable(data?.texte), erreur: error?.message ?? null }
}

async function texteOcrDe(cible: CibleTexteOcr): Promise<string | null> {
  const { data } = await supabase
    .from('piece_textes_ocr')
    .select('texte')
    .eq(colonneDe(cible), cible.id)
    .maybeSingle()
  return texteOcrExploitable(data?.texte)
}
