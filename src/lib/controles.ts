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

// Pièces VALIDÉES sans aucune catégorie. C'est le trou que les deux contrôles ci-dessus ne voient
// pas : ils partent d'une catégorie et cherchent ce qui lui manque, donc une pièce dont
// `categorie_id` est nul leur est invisible — il n'y a pas de catégorie à inspecter. Le résultat est
// pourtant exactement le même : aucune écriture générée (`lignesChargeProduitPourPiece` exige un
// compte, donc une catégorie) et aucune ligne dans les totaux de Clôture ni dans la 2035.
//
// C'est la première des « trois portes » (voir CLAUDE.md) et la seule qui n'était pas gardée. Elle
// est aussi la plus coûteuse, parce que la pièce a l'air traitée : le cabinet a écrit « validée »
// dessus, donc plus personne ne la regarde. Constaté en production sur deux dossiers — 11 pièces
// validées sans catégorie, le travail fait et invisible.
//
// Seulement les validées, délibérément. Une pièce « à valider » sans catégorie est la situation
// NORMALE — c'est la corbeille d'arrivée — et la signaler noierait le vrai signal : le même dossier
// en portait 30 d'un coup.
export function piecesValideesSansCategorie(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => p.statut === 'validee' && !p.categorie_id)
}

// Sur un dossier assujetti, une pièce validée sans TVA renseignée est plus probablement un oubli de
// saisie qu'une vraie absence de TVA — signalé pour vérification, jamais corrigé tout seul.
export function piecesSansTva(pieces: Piece[], assujettiTva: boolean): Piece[] {
  if (!assujettiTva) return []
  return pieces.filter((p) => p.montant_ttc != null && !p.montant_tva)
}
