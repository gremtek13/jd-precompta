import { describe, expect, it } from 'vitest'
import { calculerRatiosBancaires } from './ratiosBancaires'
import { POSTE_AMORTISSEMENTS } from './situationIntermediaire'
import type { SituationIntermediaire } from './situationIntermediaire'

const situation = (resultat: number, amortissements = 0): SituationIntermediaire => ({
  periodeDebut: '2026-01-01',
  periodeFin: '2026-06-30',
  resultat,
  // Les dotations sont stockées négatives (voir situationIntermediaire.ts).
  totauxParPoste: amortissements ? [[POSTE_AMORTISSEMENTS, -amortissements]] : [],
} as SituationIntermediaire)

describe('calculerRatiosBancaires', () => {
  it('annualise le résultat au prorata des mois écoulés', () => {
    // 30 000 € sur 6 mois → 60 000 € sur l'année.
    expect(calculerRatiosBancaires(situation(30000), 6, 0, 0, 0).cafAnnuelleEstimee).toBe(60000)
  })

  it('ne compte pas deux fois la dotation aux amortissements', () => {
    // CAF = résultat + dotations. La dotation est déjà comptée pour l'année entière : la retirer du
    // résultat *avant* de reproratiser donne directement la CAF annuelle. Reproratiser le résultat
    // brut puis rajouter la dotation la compterait une fois et demie ici (12/6 × 4 000 = 8 000).
    const ratios = calculerRatiosBancaires(situation(26000, 4000), 6, 0, 0, 0)
    expect(ratios.cafAnnuelleEstimee).toBe(60000) // (26 000 + 4 000) × 12/6
  })

  it('divise la dette par la CAF pour la capacité de remboursement', () => {
    // 120 000 € de capital restant dû pour 60 000 € de CAF : deux ans.
    expect(calculerRatiosBancaires(situation(30000), 6, 120000, 0, 0).capaciteRemboursementAnnees).toBe(2)
  })

  it('rend le taux d’endettement en pourcentage, à la décimale', () => {
    expect(calculerRatiosBancaires(situation(30000), 6, 0, 1250, 5000).tauxEndettementMensuel).toBe(25)
    expect(calculerRatiosBancaires(situation(30000), 6, 0, 1234, 5000).tauxEndettementMensuel).toBe(24.7)
  })

  it('rend null plutôt qu’un ratio qui n’a pas de sens à montrer', () => {
    // Une CAF nulle ou négative donnerait l'infini ou un nombre d'années négatif ; une moyenne
    // d'encaissements absente (pas assez d'historique bancaire) donnerait l'infini aussi.
    expect(calculerRatiosBancaires(situation(-10000), 6, 120000, 0, 0).capaciteRemboursementAnnees).toBeNull()
    expect(calculerRatiosBancaires(situation(0), 6, 120000, 0, 0).capaciteRemboursementAnnees).toBeNull()
    expect(calculerRatiosBancaires(situation(30000), 6, 0, 1250, 0).tauxEndettementMensuel).toBeNull()
  })

  it('rend une CAF nulle quand aucun mois n’est écoulé, sans diviser par zéro', () => {
    const ratios = calculerRatiosBancaires(situation(30000), 0, 120000, 1250, 5000)
    expect(ratios.cafAnnuelleEstimee).toBe(0)
    expect(ratios.capaciteRemboursementAnnees).toBeNull()
  })

  // L'INVARIANT QUI REMPLACE UN COMMENTAIRE DEVENU FAUX.
  //
  // Il était écrit dans `ratiosBancaires.ts` que la dotation est « déjà comptée pour l'année
  // entière » — vrai à l'époque, et faux depuis que `situationIntermediaire` rapporte la dotation à
  // la période (22/09/2026). La CAF, elle, n'a pas bougé d'un centime, et ce n'est pas une chance :
  // `resultat - posteAmortissements` est INVARIANT quand les deux se déplacent du même écart, ce
  // qui est exactement ce que change une convention de dotation.
  //
  // Une phrase dans un commentaire ne peut pas voir sa prémisse disparaître ; ce test, si.
  it('rend la même CAF quelle que soit la convention de dotation', () => {
    // Le MÊME semestre, vu par les deux conventions : 12 000 € sur 5 ans, six mois écoulés.
    // Ancienne — dotation annuelle entière : résultat 8 800 − 2 400 = 6 400, poste −2 400.
    // Actuelle — dotation du semestre : résultat 8 800 − 1 200 = 7 600, poste −1 200.
    const ancienneConvention = calculerRatiosBancaires(situation(6400, 2400), 6, 0, 0, 0)
    const conventionActuelle = calculerRatiosBancaires(situation(7600, 1200), 6, 0, 0, 0)
    expect(conventionActuelle.cafAnnuelleEstimee).toBe(ancienneConvention.cafAnnuelleEstimee)
    expect(conventionActuelle.cafAnnuelleEstimee).toBe(17600)   // (7 600 + 1 200) × 12/6
  })

  it('retrouve le poste amortissements sous le nom que lui donne la situation', () => {
    // Le contrat qui rendait ce calcul fragile : `ratiosBancaires` cherchait le poste par une chaîne
    // écrite de son côté. Le libellé vient désormais de `situationIntermediaire`, et ce test échoue
    // si les deux se désynchronisent.
    const avecDotation = calculerRatiosBancaires(situation(26000, 4000), 12, 0, 0, 0).cafAnnuelleEstimee
    const sansDotation = calculerRatiosBancaires(situation(26000), 12, 0, 0, 0).cafAnnuelleEstimee
    expect(avecDotation - sansDotation).toBe(4000)
  })
})
