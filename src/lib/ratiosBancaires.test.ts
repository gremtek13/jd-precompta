import { describe, expect, it } from 'vitest'
import { calculerRatiosBancaires } from './ratiosBancaires'
import { POSTE_AMORTISSEMENTS } from './situationIntermediaire'
import type { SituationIntermediaire } from './situationIntermediaire'

const situation = (resultat: number, amortissements = 0): SituationIntermediaire => ({
  periodeDebut: '2026-01-01',
  periodeFin: '2026-06-30',
  resultat,
  // Les dotations sont stockées négatives et pour l'année entière (voir situationIntermediaire.ts).
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

  it('retrouve le poste amortissements sous le nom que lui donne la situation', () => {
    // Le contrat qui rendait ce calcul fragile : `ratiosBancaires` cherchait le poste par une chaîne
    // écrite de son côté. Le libellé vient désormais de `situationIntermediaire`, et ce test échoue
    // si les deux se désynchronisent.
    const avecDotation = calculerRatiosBancaires(situation(26000, 4000), 12, 0, 0, 0).cafAnnuelleEstimee
    const sansDotation = calculerRatiosBancaires(situation(26000), 12, 0, 0, 0).cafAnnuelleEstimee
    expect(avecDotation - sansDotation).toBe(4000)
  })
})
