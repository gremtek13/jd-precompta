import { supabase } from './supabase'

// Retire au mieux tous les fichiers de stockage d'un dossier (pièces + packs) avant de supprimer sa
// ligne — la suppression de `dossiers` fait cascader toutes les autres tables (voir migration
// informations_dossier_cascade_suppression, la seule qui manquait), mais Storage n'est pas lié par une
// contrainte de base : sans ce nettoyage explicite, les fichiers resteraient orphelins indéfiniment.
// Best-effort (même logique que le retrait d'une pièce individuelle dans PiecesTab) : un échec ici ne
// doit jamais empêcher la suppression du dossier lui-même, seulement laisser quelques fichiers
// orphelins — un dossier supprimé sans ses pièces vaut mieux qu'un dossier qui refuse de se supprimer
// à cause d'un fichier de stockage récalcitrant.
async function viderDossierDuStockage(bucket: 'pieces' | 'packs', dossierId: string): Promise<void> {
  try {
    const { data: entrees } = await supabase.storage.from(bucket).list(dossierId)
    if (!entrees || entrees.length === 0) return
    const chemins: string[] = []
    for (const entree of entrees) {
      // Un id null signale un sous-dossier (convention Supabase Storage) — un pack range son
      // ZIP/Excel sous `dossierId/période-timestamp/`, jamais directement sous `dossierId/` (voir
      // packGenerator.ts) ; une pièce, elle, est toujours un fichier direct.
      if (entree.id === null) {
        const { data: sousEntrees } = await supabase.storage.from(bucket).list(`${dossierId}/${entree.name}`)
        for (const sousEntree of sousEntrees ?? []) chemins.push(`${dossierId}/${entree.name}/${sousEntree.name}`)
      } else {
        chemins.push(`${dossierId}/${entree.name}`)
      }
    }
    if (chemins.length > 0) await supabase.storage.from(bucket).remove(chemins)
  } catch {
    // Best-effort, voir plus haut.
  }
}

// Supprime définitivement un dossier et tout ce qui lui est rattaché — pièces, écritures,
// immobilisations, accès clients, factures, etc. (cascade en base) — plus ses fichiers de stockage.
// Irréversible : voir ConfirmationSuppression, qui impose de taper le nom du dossier avant d'appeler
// cette fonction. La ligne `dossiers` elle-même reste protégée par RLS (dossiers_delete =
// est_chef_du_cabinet) : un appelant qui n'est pas chef du cabinet propriétaire reçoit une erreur ici,
// jamais une suppression partielle.
export async function supprimerDossierDefinitivement(dossierId: string): Promise<void> {
  await Promise.all([
    viderDossierDuStockage('pieces', dossierId),
    viderDossierDuStockage('packs', dossierId),
  ])
  const { error } = await supabase.from('dossiers').delete().eq('id', dossierId)
  if (error) throw error
}
