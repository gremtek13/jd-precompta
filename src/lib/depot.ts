import { supabase } from './supabase'
import { extractPiece, fichierDejaPresent, hashFichier, type ExtractionResult } from './extraction'
import { slugify } from './format'

export type ResultatDepot = { statut: 'ok' } | { statut: 'doublon' } | { statut: 'erreur'; message: string }

// Dépose un seul fichier pour un dossier client : hash anti-doublon, upload storage, extraction
// automatique (sauf CSV, classé direct en relevé bancaire), puis insertion en pieces ou
// documents_divers selon le résultat. Extrait de ClientUpload pour être partagé avec la prise de
// photo directe sur l'accueil (ClientHome) — un seul endroit à faire évoluer si le pipeline change,
// peu importe d'où vient le fichier (glisser-déposer, sélecteur, appareil photo).
//
// Comme dans ClientUpload, l'extraction se fait AVANT l'écriture en base, jamais en correction après
// coup : le client n'a pas le droit de modifier une pièce une fois déposée, donc le classement et les
// montants lus doivent être connus dès l'unique insertion.
export async function deposerFichier(dossierId: string, file: File): Promise<ResultatDepot> {
  try {
    const hash = await hashFichier(file)
    if (await fichierDejaPresent(dossierId, hash)) return { statut: 'doublon' }

    const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
    const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
    if (uploadError) throw uploadError

    const estCsv = file.name.toLowerCase().endsWith('.csv')
    if (estCsv) {
      const { error: insertError } = await supabase.from('documents_divers').insert({
        dossier_id: dossierId, storage_path: path, storage_hash: hash, nom_fichier: file.name, categorie: 'releve_bancaire',
      })
      if (insertError) throw insertError
      return { statut: 'ok' }
    }

    let extraction: ExtractionResult | null = null
    try {
      extraction = await extractPiece(file, file.name)
    } catch {
      extraction = null // best-effort : atterrit en Pièces à compléter par le cabinet si l'extraction échoue
    }

    if (extraction && extraction.classification !== 'facture') {
      const { error: insertError } = await supabase.from('documents_divers').insert({
        dossier_id: dossierId, storage_path: path, storage_hash: hash, nom_fichier: file.name,
        categorie: extraction.classification,
      })
      if (insertError) throw insertError
    } else {
      const { data: userData } = await supabase.auth.getUser()
      const { error: insertError } = await supabase.from('pieces').insert({
        dossier_id: dossierId, uploaded_by: userData.user!.id, storage_path: path, storage_hash: hash,
        nom_fichier: file.name, type_piece: 'achat', statut: 'a_valider',
        date_piece: extraction?.date_piece ?? null,
        tiers: extraction?.tiers ?? null,
        montant_ht: extraction?.montant_ht ?? null,
        montant_tva: extraction?.montant_tva ?? null,
        montant_ttc: extraction?.montant_ttc ?? null,
        confiance: extraction?.confiance ?? null,
      })
      if (insertError) throw insertError
    }
    return { statut: 'ok' }
  } catch (err) {
    return { statut: 'erreur', message: err instanceof Error ? err.message : "l'envoi a échoué" }
  }
}
