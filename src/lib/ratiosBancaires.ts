import type { SituationIntermediaire } from './situationIntermediaire'

export interface RatiosBancaires {
  cafAnnuelleEstimee: number
  // null si la CAF n'est pas positive — un ratio dettes/CAF négatif ou infini n'a pas de sens à afficher.
  capaciteRemboursementAnnees: number | null
  // null si aucune moyenne d'encaissements disponible (pas assez d'historique bancaire).
  tauxEndettementMensuel: number | null
}

// Troisième brique du "dossier bancaire automatisé" (voir CLAUDE.md) — deux ratios usuels demandés
// par une banque, calculés à partir de données déjà produites ailleurs dans cet onglet (situation
// intermédiaire, plan de trésorerie), rien de nouveau à charger. Indicatifs, pas un calcul officiel :
// les seuils couramment cités (capacité de remboursement ≤ 3-4 ans, par exemple) varient d'un
// établissement à l'autre et ne sont jamais appliqués ici comme une règle dure, juste rappelés à
// titre de repère dans l'interface.
export function calculerRatiosBancaires(
  situationAnnee: SituationIntermediaire, moisEcoules: number, capitalRestantDuTotal: number,
  mensualiteTotale: number, moyenneEncaissements: number,
): RatiosBancaires {
  const posteAmortissements = situationAnnee.totauxParPoste.find(([poste]) => poste === 'Amortissements')?.[1] ?? 0
  // CAF = résultat + dotations aux amortissements (charge non décaissée). `posteAmortissements` est
  // déjà négatif et déjà compté pour l'année entière (voir situationIntermediaire.ts) — le retirer du
  // résultat avant de reproratiser au nombre de mois écoulés donne directement la CAF annualisée,
  // sans compter deux fois l'effet de la dotation (une reproratisation du résultat brut la doublerait).
  const resultatHorsAmortissement = situationAnnee.resultat - posteAmortissements
  const cafAnnuelleEstimee = moisEcoules > 0 ? Math.round((resultatHorsAmortissement * 12 / moisEcoules) * 100) / 100 : 0

  return {
    cafAnnuelleEstimee,
    capaciteRemboursementAnnees: cafAnnuelleEstimee > 0 ? Math.round((capitalRestantDuTotal / cafAnnuelleEstimee) * 100) / 100 : null,
    tauxEndettementMensuel: moyenneEncaissements > 0 ? Math.round((mensualiteTotale / moyenneEncaissements) * 1000) / 10 : null,
  }
}
