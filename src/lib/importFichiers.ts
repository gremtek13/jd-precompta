import { supabase } from './supabase'
import { slugify } from './format'
import { extractPiece, hashFichier, LABEL_CLASSIFICATION } from './extraction'
import type { CategorieDocument } from './types'

// Logique de dépôt de fichier(s) dans un dossier, partagée entre l'import en masse d'une arborescence
// (ImportDossierModal) et l'ajout ponctuel d'un ou plusieurs fichiers (AjouterDocumentsModal) : même
// détection de format supporté, même déduplication par contenu, même tri automatique facture (→
// Pièces) / relevé-cotisation-attestation (→ Documents). Seule la résolution du sous-dossier diffère
// selon l'appelant (structure de dossiers importée, ou un sous-dossier unique choisi pour tout le lot).

const EXTENSIONS_SUPPORTEES = ['pdf', 'jpg', 'jpeg', 'png', 'csv']

export function extensionDe(nom: string): string {
  return nom.toLowerCase().split('.').pop() ?? ''
}

// Un fichier réel (export sans suffixe, renommage manuel...) peut ne pas avoir d'extension du tout —
// dans ce cas .split('.').pop() renvoie le nom entier, qui ne matche jamais la liste supportée et le
// fichier serait ignoré à tort même si c'est bien un PDF/JPEG/PNG valide. On regarde la signature des
// premiers octets avant de rejeter, plutôt que de se fier uniquement au nom.
async function sniffeSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const estPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
  const estJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const estPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  return estPdf || estJpeg || estPng
}

export async function estFichierSupporte(file: File): Promise<boolean> {
  if (EXTENSIONS_SUPPORTEES.includes(extensionDe(file.name))) return true
  return sniffeSignature(file)
}

// Empreintes déjà présentes dans ce dossier (Pièces + Documents) — sert à ignorer un fichier déjà
// importé plutôt que de le dupliquer. Comparaison par contenu, pas par nom de fichier : un nom peut se
// répéter sans être le même document (ou l'inverse, après un renommage).
export async function chargerHashsExistants(dossierId: string): Promise<Set<string>> {
  const [{ data: piecesHash }, { data: documentsHash }] = await Promise.all([
    supabase.from('pieces').select('storage_hash').eq('dossier_id', dossierId).not('storage_hash', 'is', null),
    supabase.from('documents_divers').select('storage_hash').eq('dossier_id', dossierId).not('storage_hash', 'is', null),
  ])
  const hashs = new Set<string>()
  for (const p of piecesHash ?? []) if (p.storage_hash) hashs.add(p.storage_hash)
  for (const d of documentsHash ?? []) if (d.storage_hash) hashs.add(d.storage_hash)
  return hashs
}

export type StatutImportFichier = 'ok' | 'doublon' | 'erreur'

export interface ResultatImportFichier {
  statut: StatutImportFichier
  message?: string
}

// Traite un fichier : déduplication, upload, puis extraction + tri automatique. hashsConnus est muté
// (le hash du fichier traité y est ajouté avant de continuer) — à réutiliser tel quel entre plusieurs
// appels successifs du même lot pour repérer aussi un doublon entre deux fichiers identiques déposés
// ensemble. onProgress est appelé juste avant chaque étape lente (upload, puis extraction), pour
// afficher une progression sans que l'appelant ait à deviner le déroulé interne.
export async function importerFichierDossier(params: {
  dossierId: string
  file: File
  sousDossierId: string | null
  hashsConnus: Set<string>
  userId: string
  onProgress?: (phase: 'upload' | 'extraction') => void
}): Promise<ResultatImportFichier> {
  const { dossierId, file, sousDossierId, hashsConnus, userId, onProgress } = params

  const hash = await hashFichier(file)
  if (hashsConnus.has(hash)) {
    return { statut: 'doublon', message: 'Déjà présent dans ce dossier — ignoré' }
  }
  hashsConnus.add(hash)

  onProgress?.('upload')
  const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
  const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
  if (uploadError) throw uploadError

  // Un CSV n'est ni un PDF ni une image : Textract ne peut pas l'analyser, donc pas d'extraction à
  // tenter. Dans ce contexte, un CSV est presque toujours un export de relevé bancaire — classé
  // directement sur la foi de l'extension plutôt que laissé de côté comme "format non pris en charge".
  if (extensionDe(file.name) === 'csv') {
    const { error: insertError } = await supabase.from('documents_divers').insert({
      dossier_id: dossierId,
      sous_dossier_id: sousDossierId,
      storage_path: path,
      storage_hash: hash,
      nom_fichier: file.name,
      categorie: 'releve_bancaire',
    })
    if (insertError) throw insertError
    return { statut: 'ok', message: `Classé « ${LABEL_CLASSIFICATION.releve_bancaire} » → Documents` }
  }

  onProgress?.('extraction')
  // L'extraction peut échouer pièce par pièce (page illisible, format refusé...) sans faire échouer
  // l'import : le fichier est quand même archivé, à compléter à la main ensuite. Sans extraction, on
  // ne peut pas savoir si c'est une facture ou autre chose — on part du principe que c'en est une
  // (même repli par défaut que côté extract-piece).
  const extraction = await extractPiece(file, file.name).catch(() => null)

  if (extraction && extraction.classification !== 'facture') {
    // Pas une facture : relevé bancaire, appel de cotisation ou attestation — archivé dans Documents
    // plutôt que dans Pièces, faute de montant HT/TVA/TTC à faire vérifier.
    const { error: insertError } = await supabase.from('documents_divers').insert({
      dossier_id: dossierId,
      sous_dossier_id: sousDossierId,
      storage_path: path,
      storage_hash: hash,
      nom_fichier: file.name,
      categorie: extraction.classification as CategorieDocument,
    })
    if (insertError) throw insertError
    return { statut: 'ok', message: `Classé « ${LABEL_CLASSIFICATION[extraction.classification]} » → Documents` }
  }

  const { error: insertError } = await supabase.from('pieces').insert({
    dossier_id: dossierId,
    uploaded_by: userId,
    storage_path: path,
    storage_hash: hash,
    nom_fichier: file.name,
    sous_dossier_id: sousDossierId,
    type_piece: 'achat',
    statut: 'a_valider',
    date_piece: extraction?.date_piece ?? null,
    tiers: extraction?.tiers ?? null,
    montant_ht: extraction?.montant_ht ?? null,
    montant_tva: extraction?.montant_tva ?? null,
    montant_ttc: extraction?.montant_ttc ?? null,
    confiance: extraction?.confiance ?? null,
  })
  if (insertError) throw insertError
  return {
    statut: 'ok',
    message: extraction ? 'Classé « Facture » → Pièces' : 'Importé — extraction à refaire à la main',
  }
}
