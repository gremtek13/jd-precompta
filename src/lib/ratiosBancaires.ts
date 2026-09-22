import { POSTE_AMORTISSEMENTS, type SituationIntermediaire } from './situationIntermediaire'

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
  // Poste importé, jamais réécrit : une chaîne littérale recopiée ici se serait désynchronisée d'un
  // renommage côté situationIntermediaire.ts, et le `find` aurait rendu 0 en silence.
  const posteAmortissements = situationAnnee.totauxParPoste.find(([poste]) => poste === POSTE_AMORTISSEMENTS)?.[1] ?? 0
  // CAF = résultat + dotations aux amortissements (charge non décaissée). `posteAmortissements` est
  // déjà négatif : le RETIRER du résultat donne le résultat avant amortissement sur la période, qu'on
  // annualise ensuite — c'est bien la CAF annuelle, et la dotation n'y est jamais comptée deux fois.
  //
  // CE CALCUL EST INSENSIBLE À LA CONVENTION DE DOTATION, et c'est ce qui l'a laissé juste quand
  // `situationIntermediaire` a cessé de compter l'année entière pour suivre la période (22/09/2026) :
  // `resultat - posteAmortissements` est invariant, les deux bougeant du même écart. Le commentaire
  // qui vivait ici disait « déjà compté pour l'année entière » — vrai à l'époque, devenu faux sans
  // que rien ne le signale, et c'est exactement le piège que ce dépôt nomme sous « une contrainte
  // justifiée par un appelant ». Un test fige désormais l'invariance plutôt qu'une phrase.
  const resultatHorsAmortissement = situationAnnee.resultat - posteAmortissements
  // AU MOINS UN MOIS D'OBSERVATION, sinon on ne rend pas de ratio du tout. Annualiser dix jours
  // revient à multiplier par 36 : le chiffre bouge alors d'un facteur dix à chaque facture saisie,
  // et c'est une capacité de remboursement montrée à une banque. L'écran affiche déjà « — » quand
  // la CAF ne se calcule pas — dire qu'on ne sait pas encore vaut mieux qu'un nombre qui n'a de
  // stable que son apparence.
  const cafAnnuelleEstimee = moisEcoules >= 1 ? Math.round((resultatHorsAmortissement * 12 / moisEcoules) * 100) / 100 : 0

  return {
    cafAnnuelleEstimee,
    capaciteRemboursementAnnees: cafAnnuelleEstimee > 0 ? Math.round((capitalRestantDuTotal / cafAnnuelleEstimee) * 100) / 100 : null,
    tauxEndettementMensuel: moyenneEncaissements > 0 ? Math.round((mensualiteTotale / moyenneEncaissements) * 1000) / 10 : null,
  }
}
