import { cleFournisseur, normalizeTiers } from './format'
import type { TiersCategorie, TiersCategorieCabinet } from './types'

// Résout la catégorie suggérée pour un tiers donné — règle du dossier en priorité (plus spécifique,
// voir tiers_categories, apprise pièce par pièce dans PieceFormModal), sinon règle cabinet partagée
// entre tous les dossiers (tiers_categories_cabinet). Un seul endroit pour cette résolution : utilisé
// aussi bien pour l'auto-suggestion à l'ouverture d'une pièce que pour l'aperçu et l'application en
// masse dans la liste "à valider" (PiecesTab).
//
// **Deux clés, dans cet ordre.** D'abord le nom complet normalisé — c'est la correspondance la plus
// sûre, et c'est sous cette forme que les règles d'avant existent en base. Ensuite la clé
// d'identité du fournisseur (voir `cleFournisseur`), qui retrouve le même fournisseur à travers les
// graphies de l'OCR : sans elle, une règle apprise sur « Transmedical » ne s'applique pas à une
// pièce dont le tiers a été lu « Transmedical et soigner redevient ».
//
// L'ordre n'est pas décoratif : une règle posée sur le nom exact doit l'emporter sur une règle
// posée sur la clé, sinon un arbitrage précis serait écrasé par un arbitrage plus large.
export function suggererCategorie(
  tiers: string,
  reglesDossier: TiersCategorie[],
  reglesCabinet: TiersCategorieCabinet[],
): string | null {
  if (!tiers.trim()) return null
  const normalise = normalizeTiers(tiers)
  const cle = cleFournisseur(tiers)

  const parNomExact = (r: { tiers_normalise: string }) => r.tiers_normalise === normalise
  const parCle = (r: { tiers_normalise: string }) =>
    cle !== null && (r.tiers_normalise === cle || cleFournisseur(r.tiers_normalise) === cle)

  return (
    reglesDossier.find(parNomExact)?.categorie_id
    ?? reglesCabinet.find(parNomExact)?.categorie_id
    ?? reglesDossier.find(parCle)?.categorie_id
    ?? reglesCabinet.find(parCle)?.categorie_id
    ?? null
  )
}
