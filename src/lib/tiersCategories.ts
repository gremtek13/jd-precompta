import { normalizeTiers } from './format'
import type { TiersCategorie, TiersCategorieCabinet } from './types'

// Résout la catégorie suggérée pour un tiers donné — règle du dossier en priorité (plus spécifique,
// voir tiers_categories, apprise pièce par pièce dans PieceFormModal), sinon règle cabinet partagée
// entre tous les dossiers (tiers_categories_cabinet). Un seul endroit pour cette résolution : utilisé
// aussi bien pour l'auto-suggestion à l'ouverture d'une pièce que pour l'aperçu et l'application en
// masse dans la liste "à valider" (PiecesTab).
export function suggererCategorie(
  tiers: string,
  reglesDossier: TiersCategorie[],
  reglesCabinet: TiersCategorieCabinet[],
): string | null {
  if (!tiers.trim()) return null
  const normalise = normalizeTiers(tiers)
  return (
    reglesDossier.find((r) => r.tiers_normalise === normalise)?.categorie_id
    ?? reglesCabinet.find((r) => r.tiers_normalise === normalise)?.categorie_id
    ?? null
  )
}
