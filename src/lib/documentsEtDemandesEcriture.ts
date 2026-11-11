import {
  cheminDUnDocumentDuCabinet, preparerDocumentDuCabinet, TYPES_DES_DOCUMENTS_DU_CABINET, type TypeDUnDocumentDuCabinet,
} from './bornesStockage'
import { refusDeLaPublication } from './documentsEtDemandes'
import { empreinteSha256 } from './logoDesFactures'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { DocumentDuCabinet } from './documentsEtDemandesVue'

// DÉPOSER PUIS PUBLIER UN DOCUMENT DU CABINET (espace client, ligne 51.5, étape B3a ; la base : B2). Deux temps, que la
// base exige dans cet ordre : le fichier dans le seau privé `documents-cabinet`, sous `<dossier>/<document>/<empreinte>.<ext>`
// (le nom d'origine n'y va jamais), puis `publier_document_du_cabinet`, qui lit son type et son poids DANS le stockage et
// écrit la ligne. L'identifiant du document se tire ici : le chemin le porte, et la fonction le reprend.
//
// Le fichier est jugé AVANT tout envoi (`preparerDocumentDuCabinet` : la signature, jamais le nom ni le type du navigateur ;
// 20 Mio) et la saisie aussi (`refusDeLaPublication`, les mots de la base). Si la publication échoue après le dépôt, le
// fichier reste dans le seau sans ligne : on ne le retire pas — une réponse perdue après une écriture réussie ferait
// retirer le fichier d'un document publié. Il n'apparaît nulle part et part avec le dossier. L'appelant tient le verrou.

/** Le type que le préparateur a décidé, relu dans la liste fermée du seau : le chemin en tire son extension. */
const estUnTypeDeDocument = (type: string): type is TypeDUnDocumentDuCabinet =>
  (TYPES_DES_DOCUMENTS_DU_CABINET as readonly string[]).includes(type)

export type IssueDeLaPublication =
  | { ok: true; document: DocumentDuCabinet }
  | { ok: false; message: string }

export async function deposerEtPublierUnDocument(
  dossierId: string, saisie: { titre: string; nature: string; exercice: number | null }, fichier: File,
): Promise<IssueDeLaPublication> {
  const refus = refusDeLaPublication({ ...saisie, nomFichier: fichier.name })
  if (refus !== null) return { ok: false, message: refus }
  const pret = await preparerDocumentDuCabinet(fichier)
  if ('refus' in pret) return { ok: false, message: `Le fichier n’est pas déposé : ${pret.refus.message}.` }
  const documentId = crypto.randomUUID()
  const type = pret.type
  const chemin = estUnTypeDeDocument(type) ? cheminDUnDocumentDuCabinet(dossierId, documentId, await empreinteSha256(pret.corps), type) : null
  if (chemin === null) return { ok: false, message: 'Le chemin du fichier n’a pas pu se composer : rien n’est déposé.' }
  const { error: erreurDuDepot } = await supabase.storage.from('documents-cabinet').upload(chemin, pret.corps, {
    upsert: false, contentType: pret.type,
  })
  if (erreurDuDepot) {
    return { ok: false, message: `Le fichier n’est pas déposé : ${messageErreur(erreurDuDepot, 'refus du stockage')}.` }
  }
  const { data, error } = await supabase.rpc('publier_document_du_cabinet', {
    p_dossier_id: dossierId, p_document_id: documentId, p_titre: saisie.titre, p_nature: saisie.nature,
    p_exercice: saisie.exercice, p_nom_fichier: fichier.name, p_chemin: chemin,
  })
  if (error) {
    return { ok: false, message: `Le fichier est déposé, mais le document n’est pas publié : ${messageErreur(error, 'refus de la base')}` }
  }
  return { ok: true, document: data as DocumentDuCabinet }
}
