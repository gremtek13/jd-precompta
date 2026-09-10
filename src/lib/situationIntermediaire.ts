import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from './types'

const POSTE_AMORTISSEMENTS = 'Amortissements'
const POSTE_COTISATIONS = 'Cotisations sociales personnelles'

export interface SituationIntermediaire {
  periodeDebut: string
  periodeFin: string
  totauxParPoste: [string, number][]
  recettes: number
  charges: number
  resultat: number
}

// Situation intermédiaire — première brique du "dossier bancaire automatisé" (voir CLAUDE.md) :
// même logique de regroupement par poste 2035 que ClotureTab (recettes, achats, charges sociales,
// amortissements...), mais sur une période libre (du 1er janvier de l'exercice jusqu'à une date
// choisie) plutôt qu'une année civile entière — pour produire un état "à ce jour" sans attendre la
// clôture. Simplification assumée, comme dans ClotureTab : la dotation d'amortissement d'un bien est
// comptée en entier dès que la date de fin tombe dans son année d'acquisition ou une année suivante
// couverte par sa durée, jamais proratisée au nombre de mois déjà écoulés dans l'année en cours.
export function calculerSituationIntermediaire(
  pieces: Piece[], categories: Categorie[], immobilisations: Immobilisation[], cotisations: CotisationDeclaree[],
  periodeDebut: string, periodeFin: string,
): SituationIntermediaire {
  const categorieById = new Map(categories.map((c) => [c.id, c]))
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id))
  const anneeFin = new Date(periodeFin).getFullYear()

  const totauxParPoste = new Map<string, number>()
  for (const p of pieces) {
    if (p.statut !== 'validee') continue
    if (immobilisationPieceIds.has(p.id)) continue
    if (!p.date_piece || p.date_piece < periodeDebut || p.date_piece > periodeFin) continue
    const cat = p.categorie_id ? categorieById.get(p.categorie_id) : null
    if (!cat?.poste_2035) continue
    const montant = p.montant_ht ?? p.montant_ttc ?? 0
    const signe = p.type_piece === 'vente' ? 1 : -1
    totauxParPoste.set(cat.poste_2035, (totauxParPoste.get(cat.poste_2035) ?? 0) + signe * montant)
  }

  // Même règle que ClotureTab : la dotation compte pour chaque année de la durée d'amortissement,
  // pas seulement l'année d'achat.
  const totalAmortissements = immobilisations.reduce((sum, i) => {
    const anneeAcquisition = new Date(i.date_acquisition).getFullYear()
    const dansLaDuree = anneeFin >= anneeAcquisition && anneeFin < anneeAcquisition + i.duree_annees
    return dansLaDuree ? sum + i.valeur / i.duree_annees : sum
  }, 0)
  if (totalAmortissements > 0) totauxParPoste.set(POSTE_AMORTISSEMENTS, -totalAmortissements)

  const totalCotisations = cotisations.reduce((sum, c) => {
    if (c.echeance < periodeDebut || c.echeance > periodeFin) return sum
    return sum + (c.montant_verse ?? c.montant_appele)
  }, 0)
  if (totalCotisations > 0) totauxParPoste.set(POSTE_COTISATIONS, -totalCotisations)

  const entries = [...totauxParPoste.entries()].sort((a, b) => b[1] - a[1])
  // Résultat = simple somme des postes signés (produits positifs, charges déjà négatives) — pas
  // besoin de reséparer recettes/charges pour l'obtenir ; recettes/charges ci-dessous ne servent
  // qu'à l'affichage (deux totaux positifs plutôt qu'un mélange de signes).
  const recettes = entries.filter(([, m]) => m > 0).reduce((s, [, m]) => s + m, 0)
  const charges = entries.filter(([, m]) => m < 0).reduce((s, [, m]) => s - m, 0)

  return { periodeDebut, periodeFin, totauxParPoste: entries, recettes, charges, resultat: recettes - charges }
}
