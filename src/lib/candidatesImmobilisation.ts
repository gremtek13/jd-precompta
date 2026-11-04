import { caseDuPoste, clePoste } from './cases2035'
import { montantRetenu } from './montantRetenu'
import type { Categorie, Piece } from './types'

// LES ACHATS À IMMOBILISER (IMMO-Q2, relecture des immobilisations du 03/11/2026, D7 ; écrite sur la recommandation le
// 04/11/2026). La carte « Candidates à l'immobilisation » de l'onglet Immobilisations proposait TOUTE pièce validée de 500 €
// ou plus : un relevé de recettes, un loyer, une prime d'assurance, un prélèvement s'y mêlaient au matériel, et aucun geste
// n'en écartait un — un vrai bien s'y perdait, et partait en charge (un ordinateur de 1 200 € : BJ 1 200 et CH 0, au lieu de
// CH 256,67). Elle ne propose plus que des ACHATS :
// - une pièce d'achat (`type_piece = 'achat'`) : ni une vente, ni une note de frais, ni un document « autre » ;
// - dont la catégorie, quand elle en a une, ne range pas la pièce sous un poste de la 2035 qui ne peut pas être un bien :
//   un loyer, une location, une prime d'assurance, des honoraires, des impôts et taxes, des salaires, des cotisations, des
//   frais financiers. Une pièce sans catégorie, ou d'un poste que le rattachement ne connaît pas, reste proposée : mieux vaut
//   une candidate de trop qu'un bien perdu.
// Le seuil ne change pas : 500 €, sur la valeur qui s'amortit (le hors taxe d'un dossier assujetti, le TTC sinon,
// `montantRetenu`) — une proposition, jamais une décision.

/** Le seuil au-delà duquel une dépense est candidate à l'immobilisation plutôt qu'à la charge courante. */
export const SEUIL_IMMOBILISATION = 500

// Les cases de la 2035 dont aucun poste ne range un bien : les recettes, les salaires et leurs charges, la TVA, les impôts et
// taxes, la CSG, les loyers (BF), les locations (BG), les cotisations sociales personnelles (BK), les frais financiers (BN),
// les pertes diverses (BP) et les amortissements eux-mêmes (CH).
const CASES_SANS_BIEN = new Set(['AA', 'AB', 'AC', 'AE', 'AF', 'BB', 'BC', 'BD', 'JY', 'BS', 'BV', 'BF', 'BG', 'BK', 'BN', 'BP', 'CH'])
// Et, dans les cases groupées BH, les postes qui ne rangent pas un bien — « Entretien et réparations » et « Petit outillage »
// en rangent parfois un, et restent.
const POSTES_SANS_BIEN = ["Primes d'assurance", "Primes d'assurances", 'Assurance', 'Honoraires ne constituant pas des rétrocessions',
  'Personnel intérimaire', 'Chauffage, eau, gaz, électricité']

const CLES_SANS_BIEN = new Set(POSTES_SANS_BIEN.map(clePoste))

/** Le poste de cette catégorie peut-il ranger un bien ? Faux seulement pour un poste qui n'en range jamais. */
export function posteQuiPeutRangerUnBien(poste: string | null): boolean {
  if (poste === null || !poste.trim()) return true
  if (CLES_SANS_BIEN.has(clePoste(poste))) return false
  const code = caseDuPoste(poste)?.code
  return code === undefined || !CASES_SANS_BIEN.has(code)
}

// Les pièces validées à proposer : des achats, au seuil, que le registre n'a pas déjà, et que leur catégorie ne range pas sous
// un poste qui n'est jamais un bien. `categories` : celles que l'écran a lues — une catégorie non lue ne retire rien.
export function achatsAImmobiliser(
  piecesValidees: readonly Piece[],
  categories: readonly Pick<Categorie, 'id' | 'poste_2035'>[],
  assujettiTva: boolean,
  // Les pièces déjà au registre, et celles qu'une écriture validée a figées (la base refuse d'en faire un bien).
  exclues: ReadonlySet<string>,
): Piece[] {
  const posteParCategorie = new Map(categories.map((c) => [c.id, c.poste_2035]))
  return piecesValidees.filter((p) => {
    if (p.type_piece !== 'achat' || exclues.has(p.id)) return false
    const valeur = montantRetenu(p, assujettiTva)
    if (valeur == null || valeur < SEUIL_IMMOBILISATION) return false
    return p.categorie_id === null || posteQuiPeutRangerUnBien(posteParCategorie.get(p.categorie_id) ?? null)
  })
}
