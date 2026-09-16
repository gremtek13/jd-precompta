import { anneeDe } from './format'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from './types'

// Moteur de la déclaration 2035 (bénéfices non commerciaux, régime de la déclaration contrôlée).
//
// Produit une structure « poste → montant » que plusieurs sorties consomment : d'abord le
// remplissage du formulaire officiel, plus tard une télétransmission EDI-TDFC. C'est pour ça que le
// calcul vit ici et pas dans l'écran Clôture : une sortie fiscale ne doit pas dépendre de ce qu'un
// composant React se trouve avoir en mémoire, et elle doit être vérifiable par des tests.
//
// **Ce moteur totalise, il ne déclare pas.** Il ne calcule aucun impôt, n'applique aucune option
// fiscale (abattements, exonérations ZFU, frais forfaitaires...) et ne décide pas du sort des
// postes : il regroupe ce qui a été saisi et validé. L'arbitrage reste celui de l'expert-comptable,
// et c'est pour ça que tout ce qui est écarté est remonté plutôt que retiré en silence.

export const POSTE_AMORTISSEMENTS = 'Amortissements'
export const POSTE_COTISATIONS = 'Cotisations sociales personnelles'

// Un poste de la déclaration. `montant` est TOUJOURS positif : c'est `nature` qui porte le sens.
// Mélanger les deux (une charge en négatif) obligerait chaque consommateur — PDF, EDI, écran — à
// refaire la même convention de signe, et une seule erreur suffirait à inverser une ligne.
export interface LigneDeclaration {
  poste: string
  nature: 'recette' | 'depense'
  montant: number
  // Nombre de pièces derrière ce total, pour que le montant se justifie d'un clic.
  nbPieces: number
}

// Ce qui n'a PAS été pris dans le calcul, avec la raison. Sur une déclaration fiscale, une pièce
// écartée en silence est un manquant que personne ne verra jamais : l'ancien calcul, dans
// ClotureTab, faisait un simple `continue`. Ces listes existent pour que l'écran les affiche.
export interface ExclusionsDeclaration {
  // Catégorie sans poste 2035 rattaché : la pièce est validée, son montant est connu, mais il
  // n'irait dans aucune case. C'est le cas le plus grave — un vrai trou dans le total.
  sansPoste: Piece[]
  // Aucune date : impossible de rattacher à un exercice.
  sansDate: Piece[]
  // Aucun montant lisible : rien à additionner.
  sansMontant: Piece[]
}

export interface Declaration2035 {
  annee: number
  recettes: LigneDeclaration[]
  depenses: LigneDeclaration[]
  totalRecettes: number
  totalDepenses: number
  // Positif = bénéfice, négatif = déficit. Nommé « résultat » et non « bénéfice » parce que les deux
  // cas existent et vont dans deux cases différentes du formulaire.
  resultat: number
  exclusions: ExclusionsDeclaration
}

function arrondi(n: number): number {
  return Number(n.toFixed(2))
}

// Dotation d'une immobilisation pour l'exercice demandé. Elle compte pour CHACUNE des années de la
// durée d'amortissement, pas seulement celle de l'achat : filtrer par égalité d'année exclurait les
// dotations des exercices suivants pour un bien acheté avant.
export function dotationPourAnnee(immo: Immobilisation, annee: number): number {
  const acquisition = anneeDe(immo.date_acquisition)
  if (annee < acquisition || annee >= acquisition + immo.duree_annees) return 0
  return immo.valeur / immo.duree_annees
}

export function calculerDeclaration2035(
  annee: number,
  pieces: Piece[],
  categories: Categorie[],
  immobilisations: Immobilisation[],
  cotisations: CotisationDeclaree[],
): Declaration2035 {
  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null

  // Une pièce déjà enregistrée comme immobilisation est représentée par sa dotation annuelle, pas
  // par son montant d'achat : la compter deux fois gonflerait les charges de l'exercice.
  const pieceIdsImmobilisees = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))

  const exclusions: ExclusionsDeclaration = { sansPoste: [], sansDate: [], sansMontant: [] }
  const totaux = new Map<string, { nature: 'recette' | 'depense'; montant: number; nbPieces: number }>()

  const ajouter = (poste: string, nature: 'recette' | 'depense', montant: number, nbPieces: number) => {
    const actuel = totaux.get(poste)
    if (actuel) {
      actuel.montant += montant
      actuel.nbPieces += nbPieces
      return
    }
    totaux.set(poste, { nature, montant, nbPieces })
  }

  for (const piece of pieces) {
    if (piece.statut !== 'validee') continue
    if (pieceIdsImmobilisees.has(piece.id)) continue

    // L'ordre des contrôles porte une intention : une pièce d'un autre exercice n'est pas une
    // anomalie, elle n'a juste rien à faire ici — elle sort avant d'être comptée comme un défaut.
    if (!piece.date_piece) {
      exclusions.sansDate.push(piece)
      continue
    }
    if (anneeDe(piece.date_piece) !== annee) continue

    const montant = piece.montant_ht ?? piece.montant_ttc
    if (montant == null) {
      exclusions.sansMontant.push(piece)
      continue
    }

    const categorie = categorieById(piece.categorie_id)
    if (!categorie?.poste_2035) {
      exclusions.sansPoste.push(piece)
      continue
    }

    // Un montant négatif (avoir, remboursement) ne change pas le poste, il le diminue. Le signe est
    // porté par `nature` au niveau du poste, donc on additionne le montant tel quel ici et on prend
    // la valeur absolue une seule fois, à la sortie.
    ajouter(categorie.poste_2035, piece.type_piece === 'vente' ? 'recette' : 'depense', montant, 1)
  }

  const totalAmortissements = immobilisations.reduce((somme, i) => somme + dotationPourAnnee(i, annee), 0)
  if (totalAmortissements > 0) ajouter(POSTE_AMORTISSEMENTS, 'depense', totalAmortissements, 0)

  // Le montant réellement versé fait foi ; à défaut, l'appel. Une cotisation appelée mais non payée
  // reste une charge de l'exercice en comptabilité d'engagement — et ce dossier suit l'appel tant
  // que le versement n'est pas saisi, plutôt que d'oublier la ligne.
  const totalCotisations = cotisations.reduce((somme, c) => {
    if (anneeDe(c.echeance) !== annee) return somme
    return somme + (c.montant_verse ?? c.montant_appele)
  }, 0)
  if (totalCotisations > 0) ajouter(POSTE_COTISATIONS, 'depense', totalCotisations, 0)

  const lignes = [...totaux.entries()].map(([poste, t]) => ({
    poste,
    nature: t.nature,
    montant: arrondi(Math.abs(t.montant)),
    nbPieces: t.nbPieces,
  }))

  const recettes = lignes.filter((l) => l.nature === 'recette').sort((a, b) => b.montant - a.montant)
  const depenses = lignes.filter((l) => l.nature === 'depense').sort((a, b) => b.montant - a.montant)
  const totalRecettes = arrondi(recettes.reduce((s, l) => s + l.montant, 0))
  const totalDepenses = arrondi(depenses.reduce((s, l) => s + l.montant, 0))

  return {
    annee,
    recettes,
    depenses,
    totalRecettes,
    totalDepenses,
    resultat: arrondi(totalRecettes - totalDepenses),
    exclusions,
  }
}
