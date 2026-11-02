import { TAUX_ADMIS } from '../lib/factureCii'
import { entierTire, tirage } from './encaissementsBatterie'

// LA BATTERIE DES LIGNES DE FACTURE (correction de la facture, 31/10/2026 ; migration `facture_dates_centimes_mention_tva`,
// PRÉPARÉE dans supabase/preparees/). Le HT et la TVA d'une ligne se calculent deux fois : dans l'application
// (`calculerLigne`, src/lib/montantsFacture.ts), qui écrit l'en-tête de la facture et ce que la facture électronique
// transmet, et dans la base (`centimes_ligne_facture`), qui recompte chaque facture par taux pour plafonner ses
// encaissements, en écrire la vente et valider l'exercice. Les deux doivent rendre le MÊME centime sur toute ligne
// qu'on peut saisir : sinon la base refuse les encaissements d'une facture juste (« Les montants enregistrés de la facture
// ne se retrouvent pas dans ses lignes »). Cette batterie tire, d'une graine fixe, des milliers de lignes de toutes les
// formes qu'une ligne prend — quantités entières, au quart, au millième, au dix-millième ; prix au centime, au
// demi-centime, au dix-millième, au millionième (un article admet six décimales), entiers ; des avoirs et des remises
// (signes négatifs) ; chacun des taux admis — ; montantsFactureBatterie.test.ts en fige l'empreinte et celle que la base
// a rendue sur les mêmes lignes, et supabase/essais/batterieDesLignes.mjs la fait juger par une base.

/** La graine du tirage, et le nombre de lignes. */
export const GRAINE_DES_LIGNES = 20261031
export const NOMBRE_DE_LIGNES = 10000

export interface LigneTiree {
  quantite: number
  prix: number
  taux: number
}

/** Les trois lignes que la relecture a trouvées : la virgule flottante les arrondissait d'un centime vers zéro. */
export const LIGNES_NOMMEES: readonly LigneTiree[] = [
  { quantite: 0.5, prix: 32.05, taux: 20 }, { quantite: 0.5, prix: 2.01, taux: 20 }, { quantite: 1.5, prix: 0.15, taux: 20 },
]

/**
 * Les lignes de la batterie : les trois lignes nommées, leurs avoirs, puis des lignes tirées. Un nombre se fabrique en
 * divisant un entier par une puissance de dix : son écriture décimale la plus courte (celle de `String`, celle que JSON
 * envoie à la base) est le décimal voulu.
 */
export function lignesTirees(graine = GRAINE_DES_LIGNES, nombre = NOMBRE_DE_LIGNES): LigneTiree[] {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const quantite = (): number => {
    switch (entier(4)) {
      case 0: return 1 + entier(20)
      case 1: return (1 + entier(80)) / 4
      case 2: return (1 + entier(20000)) / 1000
      default: return (1 + entier(99999)) / 10000
    }
  }
  const prix = (): number => {
    switch (entier(5)) {
      case 0: return (1 + entier(999999)) / 100
      // Au demi-centime : x,xx5 €.
      case 1: return (10 * entier(100000) + 5) / 1000
      case 2: return (1 + entier(999999)) / 10000
      case 3: return (1 + entier(999999999)) / 1000000
      default: return 1 + entier(5000)
    }
  }
  const lignes: LigneTiree[] = [...LIGNES_NOMMEES, ...LIGNES_NOMMEES.map((l) => ({ ...l, quantite: -l.quantite }))]
  while (lignes.length < nombre) {
    const q = quantite()
    const p = prix()
    // Un avoir (quantité négative) une fois sur cinq, une remise (prix négatif) une fois sur dix.
    lignes.push({ quantite: entier(5) === 0 ? -q : q, prix: entier(10) === 0 ? -p : p, taux: TAUX_ADMIS[entier(TAUX_ADMIS.length)] })
  }
  return lignes
}

/** Une ligne écrite comme la base la reçoit : chaque nombre sous son écriture décimale la plus courte. */
export const ligneEcrite = (l: LigneTiree): string => `${l.quantite}|${l.prix}|${l.taux}`
