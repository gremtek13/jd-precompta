import { describe, expect, it } from 'vitest'
import {
  CE_QUE_L_ESTIMATION_NE_FAIT_PAS, PHRASE_DE_LA_CAISSE, caisseDe, cumulDeLEntree, demandeLeCumul, estimerLaRetraiteAffichee,
  hypothesesDeLaRetraite, lignesDeLaRetraite, titreDeLaRetraite,
} from './retraiteAffichee'
import type { EstimationRetraite } from './retraiteDesLiberaux'
import type { EntreeEstimation } from './voletSocialPamc'
import type { ProfessionPamc } from './types'

const entree = (profession: ProfessionPamc | null, o: Partial<EntreeEstimation> = {}): EntreeEstimation => ({
  annee: 2026, profession, remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true, recettesBrutes: 80_000,
  honorairesConventionnes: 80_000, depassements: 0, parametres: { tenus: true, debutActivite: '2010-01-01', acre: false, tauxDentiste: 0.5 },
  ...o,
})
const formater = (c: number) => `${(c / 100).toFixed(2)} €`
const estimation = (o: Partial<EstimationRetraite> = {}): EstimationRetraite => ({
  caisse: 'carpimko', assiette: 5_000_000, assietteMinimale: 0, retraiteDeBase: 500_000, priseEnChargeRetraiteDeBase: 0,
  retraiteComplementaire: 400_000, invaliditeDeces: 102_200, pcv: 40_000, priseEnChargePcv: 30_000, total: 1_042_200, hypotheses: [], ...o,
})

describe('la retraite affichée', () => {
  it('désigne la caisse par la profession, et les trois sans profession', () => {
    expect(caisseDe(null)).toBeNull()
    expect(caisseDe('auxiliaire_medical')).toBe('carpimko')
    expect(caisseDe('medecin_secteur_2')).toBe('carmf')
    expect(caisseDe('sage_femme')).toBe('carcdsf')
    expect(titreDeLaRetraite(null)).toBe('Retraite (caisse : CARPIMKO, CARMF ou CARCDSF selon la profession)')
    expect(titreDeLaRetraite('chirurgien_dentiste')).toBe('Retraite (caisse : CARCDSF)')
  })

  it('ne demande le cumul qu’à un médecin, et ne le devine jamais', () => {
    expect(demandeLeCumul('medecin_secteur_1')).toBe(true)
    expect(demandeLeCumul('auxiliaire_medical')).toBe(false)
    expect(demandeLeCumul(null)).toBe(false)
    expect(cumulDeLEntree('medecin_secteur_1', 'non_renseigne')).toBeNull()
    expect(cumulDeLEntree('medecin_secteur_1', 'oui')).toBe(true)
    expect(cumulDeLEntree('medecin_secteur_1', 'non')).toBe(false)
    // Un choix resté d'un médecin ne passe pas à une infirmière.
    expect(cumulDeLEntree('auxiliaire_medical', 'oui')).toBeNull()
  })

  it('un médecin qui n’a pas dit son cumul n’a aucune estimation, et le motif le dit', () => {
    const r = estimerLaRetraiteAffichee(entree('medecin_secteur_1'), 'non_renseigne')
    expect(r.disponible).toBe(false)
    if (!r.disponible) expect(r.motif).toMatch(/cumule sa retraite et son activité/)
    expect(estimerLaRetraiteAffichee(entree('medecin_secteur_1'), 'non').disponible).toBe(true)
  })

  it('le cumul retire l’invalidité-décès du médecin, et seulement lui', () => {
    const invalidite = (choix: 'oui' | 'non') => {
      const r = estimerLaRetraiteAffichee(entree('medecin_secteur_2'), choix)
      if (!r.disponible) throw new Error(r.motif)
      return r.estimation.invaliditeDeces
    }
    expect(invalidite('oui')).toBe(0)
    expect(invalidite('non')).toBeGreaterThan(0)
    const infirmiere = estimerLaRetraiteAffichee(entree('auxiliaire_medical'), 'oui')
    expect(infirmiere.disponible && infirmiere.estimation.invaliditeDeces).toBe(102_200)
  })

  it('refuse sans barème, par le motif du volet de l’Urssaf, jamais un zéro', () => {
    const r = estimerLaRetraiteAffichee(entree('auxiliaire_medical', { annee: 2027 }), 'non_renseigne')
    expect(r.disponible).toBe(false)
    if (!r.disponible) expect(r.motif).toMatch(/2027/)
  })

  it('range les lignes : quatre cotisations, la prise en charge, le total', () => {
    const lignes = lignesDeLaRetraite(estimation(), formater)
    expect(lignes.map((l) => l.cle)).toEqual(['base', 'complementaire', 'invalidite-deces', 'pcv', 'prise-en-charge', 'total'])
    expect(lignes[3].libelle).toBe('Régime des praticiens conventionnés (PCV), moins la prise en charge par l’Assurance maladie (300.00 €)')
    expect(lignes[4].centimes).toBe(30_000)
    expect(lignes[5]).toMatchObject({ libelle: 'Total de la retraite à la charge du praticien', centimes: 1_042_200 })
  })

  it('additionne les deux prises en charge, et n’en nomme aucune à zéro', () => {
    const deux = lignesDeLaRetraite(estimation({ priseEnChargeRetraiteDeBase: 100_000 }), formater)
    expect(deux[0].libelle).toContain('moins la prise en charge par l’Assurance maladie (1000.00 €)')
    expect(deux.find((l) => l.cle === 'prise-en-charge')?.centimes).toBe(130_000)
    const aucune = lignesDeLaRetraite(estimation({ priseEnChargePcv: 0 }), formater)
    expect(aucune.map((l) => l.cle)).not.toContain('prise-en-charge')
    expect(aucune[0].libelle).toBe('Régime de base (CNAVPL)')
    expect(aucune[3].libelle).toBe('Régime des praticiens conventionnés (PCV)')
  })

  it('dit chaque hypothèse du module, puis le cumul', () => {
    expect(hypothesesDeLaRetraite(estimation(), null)).toEqual([])
    const tout = hypothesesDeLaRetraite(estimation({
      hypotheses: ['carcdsf-reduction-du-forfait-supposee-demandee', 'carcdsf-exoneration-des-pcv-supposee-demandee', 'carmf-debut-d-activite-complementaire-suppose-du'],
    }), true)
    expect(tout).toHaveLength(4)
    expect(tout[0]).toMatch(/85 %.*sur demande/)
    expect(tout[1]).toMatch(/exonérés des PCV.*sur demande/)
    expect(tout[2]).toMatch(/quarante ans.*dû/)
    expect(tout[3]).toMatch(/Cumul emploi-retraite/)
    expect(hypothesesDeLaRetraite(estimation(), false)).toEqual([])
  })

  it('garde ses deux phrases fixes', () => {
    expect(PHRASE_DE_LA_CAISSE).toBe('La caisse appelle ces cotisations sur un revenu antérieur, puis régularise : ce n’est pas l’échéancier de l’année.')
    expect(CE_QUE_L_ESTIMATION_NE_FAIT_PAS).toMatch(/CIPAV/)
  })
})
