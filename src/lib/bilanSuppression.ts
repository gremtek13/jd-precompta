// Ce qu'une suppression de PLUSIEURS documents dit à l'écran une fois finie.
//
// POURQUOI CE MODULE. `DocumentsTab.supprimerSelection` supprimait document par document et, sur un
// refus, passait au suivant sans rien garder — ni le compte, ni la raison. La liste relue faisait
// reparaître le document refusé au milieu des autres, sans un mot, sur un geste que l'opérateur venait
// de CONFIRMER et croyait donc accompli. Un bilan muet sur l'échec est un bilan qui prétend un succès
// entier ; celui-ci compte ce qui est parti, ce qui ne l'est pas, et pourquoi.
//
// Ni nom de fichier ni identifiant : des comptes et des raisons. Les raisons sont dites UNE fois
// chacune — un refus de la base (session expirée, droit refusé) frappe tous les documents de la même
// façon, et le répéter autant de fois qu'il y a de documents noierait le compte.
//
// Le même bilan sert la sélection de PIÈCES (`PiecesTab.deleteSelection`, 09/10/2026) : elle disait
// déjà ses refus, mais retirait les fichiers d'une pièce sur la seule absence d'erreur. Seuls les mots
// changent — le nom, l'accord, et « ses fichiers » : une facture reçue en XML en a deux.

/**
 * La raison d'un document que la base n'a PAS supprimé sans pour autant lever d'erreur.
 *
 * PostgREST rend une suppression qui ne touche aucune ligne comme un succès : la policy a écarté la
 * ligne, ou un autre onglet l'a déjà retirée. Ce n'est pas un document supprimé par ce geste, et son
 * fichier ne doit pas partir — il est peut-être encore désigné par sa ligne.
 */
export const AUCUNE_LIGNE_SUPPRIMEE =
  'la base n’a supprimé aucune ligne (document déjà retiré ailleurs, ou suppression refusée sans erreur)'

export interface BilanSuppression {
  /** Combien de documents la sélection demandait de supprimer. */
  demandes: number
  /** Combien la base a RÉELLEMENT supprimés — une ligne rendue par la suppression. */
  supprimes: number
  /** La raison de chaque document resté, une entrée par document, répétitions comprises. */
  motifs: readonly string[]
}

/** La raison d'une PIÈCE que la base n'a pas supprimée sans lever d'erreur (voir ci-dessus). */
export const AUCUNE_PIECE_SUPPRIMEE =
  'la base n’a supprimé aucune ligne (pièce déjà retirée ailleurs, ou suppression refusée sans erreur)'

/** Les mots d'un bilan : ce qu'on supprime, son accord, et ce qu'on dit de ses fichiers. */
interface Mots {
  /** « Le document » / « La pièce ». */
  le: string
  un: string
  des: string
  /** Le participe accordé : « supprimé » / « supprimée ». */
  supprime: string
  aucun: string
  /** Ce qu'on dit des fichiers d'UN objet resté, puis de PLUSIEURS. */
  fichierDeUn: string
  fichierDePlusieurs: string
}

const MOTS_DOCUMENT: Mots = {
  le: 'Le document', un: 'document', des: 'documents', supprime: 'supprimé', aucun: 'Aucun',
  fichierDeUn: 'son fichier n’a pas été touché', fichierDePlusieurs: 'leur fichier n’a pas été touché',
}

const MOTS_PIECE: Mots = {
  le: 'La pièce', un: 'pièce', des: 'pièces', supprime: 'supprimée', aucun: 'Aucune',
  fichierDeUn: 'aucun de ses fichiers n’a été touché', fichierDePlusieurs: 'aucun de leurs fichiers n’a été touché',
}

/**
 * Le message à montrer, ou `null` quand tout ce qui était demandé est parti — la liste relue le
 * montre, il n'y a rien à ajouter.
 *
 * Le nombre de documents restés est `demandes − supprimes`, pas le nombre de motifs : c'est le compte
 * de la BASE qui fait foi, et un document resté sans motif enregistré resterait quand même compté.
 */
function messageBilan(mots: Mots, bilan: BilanSuppression): string | null {
  const restes = bilan.demandes - bilan.supprimes
  if (restes <= 0) return null
  const raisons = [...new Set(bilan.motifs)]
  const pourquoi = raisons.length > 0 ? ` : ${raisons.join(' ; ')}.` : '.'
  // « Leur fichier n'a pas été touché » est vrai dans TOUS les cas — refus comme suppression sans
  // effet : le fichier ne part qu'après sa ligne. « Ils sont toujours dans la liste » ne le serait
  // pas d'un document qu'un autre onglet a déjà retiré.
  if (bilan.supprimes === 0) {
    if (bilan.demandes === 1) return `${mots.le} n’a pas pu être ${mots.supprime}, et ${mots.fichierDeUn}${pourquoi}`
    return `${mots.aucun} des ${bilan.demandes} ${mots.des} n’a pu être ${mots.supprime}, et ${mots.fichierDePlusieurs}${pourquoi}`
  }
  const partis = bilan.supprimes === 1 ? `1 ${mots.un} ${mots.supprime}` : `${bilan.supprimes} ${mots.des} ${mots.supprime}s`
  const restesDits = restes === 1
    ? `1 n’a pas pu l’être, et ${mots.fichierDeUn}`
    : `${restes} n’ont pas pu l’être, et ${mots.fichierDePlusieurs}`
  return `${partis} sur ${bilan.demandes}. ${restesDits}${pourquoi}`
}

/** Le bilan d'une suppression de documents (`DocumentsTab`). */
export function messageBilanSuppression(bilan: BilanSuppression): string | null {
  return messageBilan(MOTS_DOCUMENT, bilan)
}

/** Le bilan d'une suppression de pièces (`PiecesTab.deleteSelection`). */
export function messageBilanSuppressionPieces(bilan: BilanSuppression): string | null {
  return messageBilan(MOTS_PIECE, bilan)
}

function documents(n: number): string {
  return n === 1 ? '1 document' : `${n} documents`
}

/** La confirmation, qui nomme ce qui part avec les documents (CLAUDE.md : une suppression se confirme). */
export function confirmationSuppression(nombre: number): string {
  // Le texte lu et les précisions échangées avec le client partent EN CASCADE avec la ligne
  // (`piece_textes_ocr.document_id`, `piece_commentaires.document_id`, tous deux `on delete cascade`),
  // et le fichier ensuite : rien de tout cela ne se retrouve après.
  const leur = nombre === 1 ? 'Son fichier, son texte lu' : 'Leur fichier, leur texte lu'
  const sujet = nombre === 1 ? 'à son sujet partent avec lui' : 'à leur sujet partent avec eux'
  return `Supprimer définitivement ${documents(nombre)} ? Cette action est irréversible.\n\n`
    + `${leur} et les précisions échangées ${sujet}.`
}
