import type { Categorie, Piece } from './types'

// Contrôles transverses partagés entre plusieurs onglets — extraits pour n'avoir qu'un seul endroit
// où ces règles vivent, utilisés à la fois là où ils bloquent une action (Écritures, Clôture) et dans
// la vue d'ensemble de la Checklist (voir ChecklistTab).

// Catégories utilisées par au moins une pièce validée mais sans compte comptable associé — impossible
// de générer l'écriture correspondante tant que ce n'est pas renseigné (voir EcrituresTab).
export function categoriesSansCompte(categories: Categorie[], pieces: Piece[]): Categorie[] {
  return categories.filter((c) => !c.compte_comptable && pieces.some((p) => p.categorie_id === c.id))
}

// Même logique côté poste de la 2035 (voir ClotureTab) — une pièce dont la catégorie n'a pas de poste
// associé n'est comptée dans aucun total de clôture.
export function categoriesSansPoste(categories: Categorie[], pieces: Piece[]): Categorie[] {
  return categories.filter((c) => !c.poste_2035 && pieces.some((p) => p.categorie_id === c.id))
}

// Sur un dossier assujetti, une pièce validée sans TVA renseignée est plus probablement un oubli de
// saisie qu'une vraie absence de TVA — signalé pour vérification, jamais corrigé tout seul.
export function piecesSansTva(pieces: Piece[], assujettiTva: boolean): Piece[] {
  if (!assujettiTva) return []
  return pieces.filter((p) => p.montant_ttc != null && !p.montant_tva)
}
