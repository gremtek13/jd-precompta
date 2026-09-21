import { anneeDe, jourDe, moisDe } from './format'
import { totalIndemnitesKilometriques, vehiculeDuDossier } from './baremeKilometrique'
import type { TotalKilometrique } from './baremeKilometrique'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece, VehiculeDossier } from './types'

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
// Le « total A » du cadre 7 du 2035-B, que le bas du formulaire envoie ligne 23 du 2035-A. Un poste
// à lui, et non un ajout au poste « Frais de véhicules » des pièces : les deux arrivent dans la même
// case BJ mais n'ont pas la même origine, et les confondre rendrait la case impossible à justifier —
// or ce sont précisément les deux montants qui ne doivent pas coexister (voir doublonFraisVehicules).
export const POSTE_INDEMNITES_KM = 'Indemnités kilométriques'

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
  // Le détail du cadre 7 pour cet exercice, ou null quand aucun véhicule n'y est déclaré. Porté à
  // part du poste : `nonCalcules` doit remonter jusqu'à l'écran, sans quoi un véhicule dont le
  // barème manque disparaîtrait de la déclaration sans laisser de trace.
  indemnitesKilometriques: TotalKilometrique | null
}

function arrondi(n: number): number {
  return Number(n.toFixed(2))
}

// Dotation d'une immobilisation pour l'exercice demandé. Elle compte pour CHACUNE des années de la
// durée d'amortissement, pas seulement celle de l'achat : filtrer par égalité d'année exclurait les
// dotations des exercices suivants pour un bien acheté avant.
//
// ELLE EST ENTIÈRE DÈS LA PREMIÈRE ANNÉE, ET CE N'EST PAS CE QUE LA RÈGLE FISCALE DEMANDE.
// L'amortissement linéaire part de la MISE EN SERVICE et sa première annuité est réduite prorata
// temporis ; le reliquat se déduit une année de plus, au-delà de la durée. Ici la dotation est
// pleine dès l'année d'acquisition, donc la première annuité est SURÉVALUÉE pour un bien acquis en
// cours d'année, et la fraction qui devrait tomber l'année suivant la fin n'est jamais déduite.
//
// C'est une simplification ASSUMÉE — le type `Immobilisation` ne porte pas de date de mise en
// service et l'arbitrage reste celui de l'expert-comptable (voir `types.ts`). Ce qui ne l'était pas,
// c'est le SILENCE : la réserve ne vivait que dans un commentaire de source renvoyant à « le
// bandeau », lequel est le rappel générique « Brouillon » affiché sur tous les écrans et ne dit rien
// de tout cela. L'opérateur lisait une colonne « Dotation annuelle » et signait une 2035 dessus.
// `dotationsNonProratisees` rend donc l'écart, et les écrans le montrent.
export function dotationPourAnnee(immo: Immobilisation, annee: number): number {
  const acquisition = anneeDe(immo.date_acquisition)
  if (annee < acquisition || annee >= acquisition + immo.duree_annees) return 0
  return immo.valeur / immo.duree_annees
}

// La phrase qui accompagne l'écart, à un seul endroit : ce qui doit être dit sur deux écrans finit
// par n'être dit nulle part quand chacun le réécrit (même raison que `BandeauLecturePartielle`).
export const RESERVE_PRORATA_TEMPORIS =
  'La dotation est comptée en entier dès l’année d’acquisition. L’amortissement fiscal se calcule '
  + 'prorata temporis depuis la mise en service : la première annuité ci-dessous est donc trop '
  + 'élevée, et le reliquat se déduirait une année de plus, après la fin de la durée. À reprendre à '
  + 'la main avant de signer.'

/** Un bien dont la première annuité diffère de ce que le prorata temporis donnerait. */
export interface DotationNonProratisee {
  libelle: string
  dateAcquisition: string
  /** Ce que l'application compte pour cet exercice. */
  dotationComptee: number
  /** Ce que le prorata temporis retiendrait, à partir de la date d'acquisition. */
  dotationProratisee: number
}

// Convention 30/360 (mois de 30 jours, année de 360), celle des amortissements linéaires.
//
// La date retenue est celle d'ACQUISITION, faute d'une date de mise en service au modèle. Les deux
// coïncident dans le cas courant, et quand elles diffèrent l'acquisition PRÉCÈDE la mise en service
// — la fraction calculée ici est donc la plus généreuse des deux, ce qui va dans le sens qui
// n'invente pas de déduction supplémentaire à côté d'un écart déjà annoncé comme à reprendre.
function fractionPremiereAnnee(dateAcquisition: string): number {
  const joursEcoules = (moisDe(dateAcquisition) - 1) * 30 + Math.min(jourDe(dateAcquisition) - 1, 29)
  return (360 - joursEcoules) / 360
}

// Les biens dont la PREMIÈRE annuité est en cause sur cet exercice, et l'écart chiffré.
//
// Seule l'année d'acquisition est rendue, et c'est un arbitrage écrit plutôt que tu : les annuités
// intermédiaires sont justes des deux côtés (une année pleine est une année pleine), et la seule
// autre qui diffère est celle du reliquat, APRÈS la durée — une déduction manquante, donc dans le
// sens prudent, et qu'un exercice de la liste ne peut de toute façon pas afficher puisque le modèle
// ne la produit jamais. La phrase de `RESERVE_PRORATA_TEMPORIS` la nomme.
//
// Rendue VIDE quand aucun bien n'est concerné — un bien acquis le 1er janvier a bien une première
// annuité pleine, et une mise en garde permanente cesse d'être lue puis emporte ses voisines.
export function dotationsNonProratisees(immobilisations: Immobilisation[], annee: number): DotationNonProratisee[] {
  return immobilisations
    .filter((i) => anneeDe(i.date_acquisition) === annee)
    .map((i) => {
      const comptee = arrondi(i.valeur / i.duree_annees)
      return {
        libelle: i.libelle,
        dateAcquisition: i.date_acquisition,
        dotationComptee: comptee,
        dotationProratisee: arrondi(comptee * fractionPremiereAnnee(i.date_acquisition)),
      }
    })
    .filter((d) => d.dotationProratisee !== d.dotationComptee)
}

export function calculerDeclaration2035(
  annee: number,
  pieces: Piece[],
  categories: Categorie[],
  immobilisations: Immobilisation[],
  cotisations: CotisationDeclaree[],
  // Sans valeur par défaut, volontairement : un appelant qui oublie les véhicules doit s'en rendre
  // compte à la compilation, pas en découvrant une case BJ vide sur un formulaire déjà déposé.
  vehicules: VehiculeDossier[],
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

  // Cadre 7 du 2035-B → ligne 23 du 2035-A. Le kilométrage est propre à un exercice (l'option pour
  // le forfait se prend au 1er janvier et vaut l'année entière, notice renvoi 12), d'où le filtre sur
  // l'année — un véhicule saisi pour 2024 n'a rien à faire dans la déclaration 2025.
  const vehiculesDeLExercice = vehicules.filter((v) => v.annee === annee)
  const indemnitesKilometriques = vehiculesDeLExercice.length > 0
    ? totalIndemnitesKilometriques(vehiculesDeLExercice.map(vehiculeDuDossier), annee)
    : null
  if (indemnitesKilometriques && indemnitesKilometriques.total > 0) {
    ajouter(POSTE_INDEMNITES_KM, 'depense', indemnitesKilometriques.total, 0)
  }

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
    indemnitesKilometriques,
  }
}
