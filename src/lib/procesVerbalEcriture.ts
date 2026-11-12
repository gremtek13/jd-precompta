import { preparerProcesVerbal } from './bornesStockage'
import { cheminDuDossier } from './cheminDuDossier'
import { empreinteSha256, estUnDoublonDuStockage } from './logoDesFactures'
import { messageErreur } from './messageErreur'
import { cheminDuProcesVerbal } from './procesVerbalDAffectation'
import { retirerFichiers } from './stockage'
import { supabase } from './supabase'

// LE DÉPÔT DU PROCÈS-VERBAL SIGNÉ (ligne 45, lot AFF5). Deux gestes, qui ne font pas une transaction : le fichier d'abord, dans
// le seau des dossiers (`pieces`), au chemin que la base exige (`<dossier>/affectations/<décision>.pdf`) ; puis
// `joindre_document_affectation`, la SEULE porte d'écriture du document, qui garde ce chemin et l'empreinte SHA-256. Dans
// l'autre ordre, une décision dirait un document joint que le stockage n'aurait pas.
//
// Le fichier est REJUGÉ ici, à l'instant du dépôt (`preparerProcesVerbal` : un PDF lu à sa signature, 20 Mio au plus), et son
// empreinte RECALCULÉE : celle que la confirmation a nommée, ou rien ne part. Un chemin déjà pris (un essai précédent dont la
// fonction a échoué après le dépôt) n'est pas une faute : le fichier qui y est est RELU, son empreinte recalculée — le même,
// il est joint sans nouveau dépôt ; autre chose, rien n'est joint et l'écran le dit. Quand la fonction refuse, le fichier
// déposé PAR CET APPEL se retire (aucune décision ne le désigne) ; un fichier trouvé là reste, il peut être celui qu'une
// autre session vient de joindre.

export type IssueDuProcesVerbal = { ok: true } | { ok: false; message: string }

export async function joindreLeProcesVerbal(
  dossierId: string, decisionId: string, fichier: Blob, empreinteAttendue: string,
): Promise<IssueDuProcesVerbal> {
  const chemin = cheminDuProcesVerbal(dossierId, decisionId)
  if (!cheminDuDossier(chemin, dossierId)) return { ok: false, message: 'Le chemin du document n’est pas dans ce dossier : rien n’est joint.' }
  try {
    const pret = await preparerProcesVerbal(fichier)
    if ('refus' in pret) return { ok: false, message: `Ce document n’est pas pris : ${pret.refus.message}.` }
    const empreinte = await empreinteSha256(pret.corps)
    if (empreinte !== empreinteAttendue) return { ok: false, message: 'Le fichier choisi a changé depuis son choix : il faut le choisir de nouveau.' }

    let dejaLa = false
    const depot = await supabase.storage.from('pieces').upload(chemin, pret.corps, { contentType: pret.type, upsert: false })
    if (depot.error) {
      if (!estUnDoublonDuStockage(depot.error)) return { ok: false, message: messageErreur(depot.error, 'Le document n’a pas pu être déposé.') }
      const present = await supabase.storage.from('pieces').download(chemin)
      if (present.error || !present.data) {
        return { ok: false, message: 'Un fichier est déjà au chemin de cette décision et n’a pas pu être relu pour le vérifier : rien n’est joint.' }
      }
      if (await empreinteSha256(present.data) !== empreinte) {
        return { ok: false, message: 'Un autre fichier est déjà au chemin de cette décision (son empreinte diffère) : rien n’est joint.' }
      }
      dejaLa = true
    }

    const { error } = await supabase.rpc('joindre_document_affectation',
      { p_affectation_id: decisionId, p_chemin: chemin, p_empreinte: empreinte })
    if (error) {
      if (!dejaLa) await retirerFichiers('pieces', [chemin], 'procès-verbal d’affectation refusé', dossierId)
      return { ok: false, message: messageErreur(error, 'Le document n’a pas pu être joint à la décision.') }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'Le document n’a pas pu être joint à la décision.') }
  }
}
