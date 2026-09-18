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

// Le taux normal français, plafond de tout taux légal (2,1 / 5,5 / 10 / 20).
const TAUX_TVA_MAXIMAL = 0.2
// Les montants sont arrondis au centime : sans cette marge, un arrondi légitime passerait pour une
// erreur. Elle ne masque rien — les écarts constatés se comptent en euros, pas en centimes.
const TOLERANCE_CENTIME = 0.01

export type MotifTvaImpossible = 'arithmetique' | 'taux' | 'signe'

export interface PieceTvaImpossible {
  piece: Piece
  motif: MotifTvaImpossible
}

// Dit CE QUI est démontré faux, pas « anomalie détectée » : le cabinet doit pouvoir trancher sans
// refaire le calcul de tête. Partagé entre les écrans plutôt que réécrit dans chacun.
export const LIBELLE_MOTIF_TVA: Record<MotifTvaImpossible, string> = {
  arithmetique: 'HT + TVA ne fait pas le TTC',
  taux: 'taux supérieur à 20 %, le maximum légal',
  signe: 'TVA de sens contraire au HT',
}

// Une TVA qui ne peut PAS être celle du document, démontrée par le calcul — pas devinée.
//
// `piecesSansTva` ci-dessus vérifie la PRÉSENCE de la TVA, jamais sa valeur. Une TVA absente se voit
// (la case est vide) ; une TVA fausse a l'air remplie, et c'est celle-là qui part en déclaration.
// Constaté en production sur les trois dossiers : « HT 20,00 / TVA 20,60 / TTC 24,00 » (la vraie est
// 4,00), « HT 21,08 / TVA 24,22 » (4,22 avec un chiffre collé devant), une TVA de 188,81 € sur une
// base de 0,00 €, une assurance — exonérée de TVA — lue avec 943,89 € de TVA. Toutes en confiance
// « haute » : l'extraction affirme, et se trompe.
//
// Les trois règles sont des IMPOSSIBILITÉS arithmétiques, pas des heuristiques de vraisemblance.
// C'est la condition pour qu'un contrôle mérite d'interrompre quelqu'un : aucune facture réelle ne
// peut les enfreindre, donc aucun faux positif à trier.
//
//  1. `arithmetique` — HT + TVA ≠ TTC. Identité vraie sur tout document, quels que soient les taux.
//  2. `taux` — |TVA| > 20 % de |HT|. Aucun taux français ne dépasse 20 %, et une facture à plusieurs
//     taux porte la MOYENNE PONDÉRÉE de taux tous ≤ 20 % : elle ne peut pas dépasser 20 % non plus.
//     Couvre au passage la TVA posée sur une base nulle. Quand le HT n'a pas été lu du tout, la même
//     borne s'écrit sur le TTC — TVA ≤ 20 % du HT équivaut à TVA ≤ un sixième du TTC — pour qu'une
//     pièce sans HT ne devienne pas un angle mort.
//  3. `signe` — TVA et HT de sens contraires. Un avoir porte les deux en négatif, jamais l'un contre
//     l'autre. Aucun cas en production : ajoutée parce qu'elle est démontrable, pas parce qu'elle a
//     mordu.
//
// Ce qui est délibérément LAISSÉ PASSER, et qui est le cœur de la règle : un taux implicite compris
// entre 0 et 20 % mais qui n'est aucun taux légal — 13,31 %, 11,96 %, 2,75 € constatés. Un ticket à
// plusieurs taux (restauration, pharmacie) en produit légitimement, et il y en a plus dans un vrai
// dossier que d'erreurs. Le signaler ferait crier au loup, et un contrôle qui crie au loup finit
// ignoré — y compris le jour où il a raison. Ces pièces-là restent invisibles à ce contrôle, et c'est
// assumé : il ne prétend pas trouver toutes les TVA fausses, seulement celles qu'il peut PROUVER.
//
// Toutes les comparaisons se font en valeur absolue. Sur un avoir (montants négatifs), comparer
// directement inverserait les inégalités et signalerait chaque avoir correct.
//
// Ne filtre pas sur le statut, contrairement à `piecesValideesSansCategorie` : une pièce « à valider »
// sans catégorie est la situation normale, une TVA impossible ne l'est à aucun stade. C'est même
// AVANT la validation qu'elle doit se voir — après, le chiffre est figé dans l'écriture.
//
// Une pièce n'apparaît qu'une fois, sous le premier motif rencontré : elle en cumule souvent
// plusieurs (une TVA lue « 239,52 » au lieu de « 79,84 » casse à la fois l'addition et le taux) et la
// lister trois fois ferait passer une erreur pour trois.
export function piecesTvaImpossible(pieces: Piece[]): PieceTvaImpossible[] {
  const anomalies: PieceTvaImpossible[] = []
  for (const piece of pieces) {
    const { montant_ht: ht, montant_tva: tva, montant_ttc: ttc } = piece
    if (tva == null || tva === 0) continue
    if (ht != null && ttc != null && Math.abs(ht + tva - ttc) > TOLERANCE_CENTIME) {
      anomalies.push({ piece, motif: 'arithmetique' })
      continue
    }
    if (ht != null && ht !== 0 && Math.sign(tva) !== Math.sign(ht)) {
      anomalies.push({ piece, motif: 'signe' })
      continue
    }
    const plafond = ht != null
      ? Math.abs(ht) * TAUX_TVA_MAXIMAL
      : ttc != null
        ? Math.abs(ttc) * TAUX_TVA_MAXIMAL / (1 + TAUX_TVA_MAXIMAL)
        : null
    if (plafond != null && Math.abs(tva) > plafond + TOLERANCE_CENTIME) {
      anomalies.push({ piece, motif: 'taux' })
    }
  }
  return anomalies
}
