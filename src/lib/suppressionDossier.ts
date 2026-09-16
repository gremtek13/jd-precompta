import { supabase } from './supabase'

// Retire au mieux tous les fichiers de stockage d'un dossier (pièces + packs) avant de supprimer sa
// ligne — la suppression de `dossiers` fait cascader toutes les autres tables (voir migration
// informations_dossier_cascade_suppression, la seule qui manquait), mais Storage n'est pas lié par une
// contrainte de base : sans ce nettoyage explicite, les fichiers resteraient orphelins indéfiniment.
// Best-effort (même logique que le retrait d'une pièce individuelle dans PiecesTab) : un échec ici ne
// doit jamais empêcher la suppression du dossier lui-même, seulement laisser quelques fichiers
// orphelins — un dossier supprimé sans ses pièces vaut mieux qu'un dossier qui refuse de se supprimer
// à cause d'un fichier de stockage récalcitrant.
// `list()` du client Storage plafonne à 100 entrées par défaut, sans le dire : au-delà, le reste
// serait resté en place indéfiniment. On pagine donc explicitement jusqu'à épuisement.
const TAILLE_PAGE = 100

async function listerTout(bucket: 'pieces' | 'packs', chemin: string) {
  const tout: { name: string; id: string | null }[] = []
  for (let offset = 0; ; offset += TAILLE_PAGE) {
    const { data } = await supabase.storage.from(bucket).list(chemin, { limit: TAILLE_PAGE, offset })
    if (!data || data.length === 0) return tout
    tout.push(...data)
    if (data.length < TAILLE_PAGE) return tout
  }
}

async function viderDossierDuStockage(bucket: 'pieces' | 'packs', dossierId: string): Promise<void> {
  try {
    const entrees = await listerTout(bucket, dossierId)
    if (entrees.length === 0) return
    const chemins: string[] = []
    for (const entree of entrees) {
      // Un id null signale un sous-dossier (convention Supabase Storage) — un pack range son
      // ZIP/Excel sous `dossierId/période-timestamp/`, jamais directement sous `dossierId/` (voir
      // packGenerator.ts) ; une pièce, elle, est toujours un fichier direct.
      if (entree.id === null) {
        const sousEntrees = await listerTout(bucket, `${dossierId}/${entree.name}`)
        for (const sousEntree of sousEntrees) chemins.push(`${dossierId}/${entree.name}/${sousEntree.name}`)
      } else {
        chemins.push(`${dossierId}/${entree.name}`)
      }
    }
    // Suppression par lots, pour la même raison : une liste trop longue passée d'un coup peut être
    // refusée côté serveur, et l'échec serait avalé par le `catch` ci-dessous.
    for (let i = 0; i < chemins.length; i += TAILLE_PAGE) {
      await supabase.storage.from(bucket).remove(chemins.slice(i, i + TAILLE_PAGE))
    }
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
