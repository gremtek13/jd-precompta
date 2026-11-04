import { describe, expect, it } from 'vitest'
import {
  confronterLesAmortissementsRepris, detailDesAmortissementsSousUnAutreNumero, detailDesEcartsDeLaReprise, SEUIL_ECART_REPRISE_CENTIMES,
} from './repriseDesAmortissements'
import { formatMoney } from './format'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { ANouveau, Immobilisation, NatureImmobilisation } from './types'
import { A_NOUVEAU_NON_VALIDE } from '../test/ecritures'

// LA REPRISE CONFRONTÉE AU REGISTRE (IMMO-Q1, relecture des immobilisations du 03/11/2026, D5). Les trois biens de la
// relecture, au 31/12/2024 : le registre (30/360) les cumule à 2 682,67 €, 1 350,00 € et 501,19 € ; un logiciel en jours
// réels sur 365, à 2 690,63 €, 1 352,05 € et 502,54 €. Typés sans `as` : le compilateur confronte chaque champ à la table.

const MEDICAL: NatureImmobilisation = {
  id: 'n-med', dossier_id: null, libelle: 'Matériel médical', duree_annees_defaut: 5, ordre: 1, compte_immobilisation: '215400',
}
const INFO: NatureImmobilisation = {
  id: 'n-info', dossier_id: null, libelle: 'Matériel informatique', duree_annees_defaut: 3, ordre: 2, compte_immobilisation: '218300',
}

const bien = (id: string, o: Partial<Immobilisation> = {}): Immobilisation => ({
  id, dossier_id: 'd1', piece_id: null, nature_id: 'n-med', libelle: `Bien fictif ${id}`, valeur: 4800,
  date_acquisition: '2022-03-15', date_mise_en_service: null, duree_annees: 5, created_at: '2025-01-10T09:00:00Z', ...o,
})
const FAUTEUIL = bien('fauteuil')
const ECRAN = bien('ecran', { nature_id: 'n-info', valeur: 1500, date_acquisition: '2020-07-01' })
const PORTABLE = bien('portable', { nature_id: 'n-info', valeur: 2999.99, date_acquisition: '2023-10-31', duree_annees: 7 })

const aNouveau = (id: string, compte: string, sens: 'debit' | 'credit', montant: number): ANouveau => ({
  id, dossier_id: 'd1', date: '2025-01-01', compte, compte_origine: compte, libelle: `Compte ${compte}`, sens, montant,
  source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2025-01-05T09:00:00Z',
})

const confronter = (biens: Immobilisation[], reprise: ANouveau[], anneesValidees: number[] = []) =>
  confronterLesAmortissementsRepris(biens, [MEDICAL, INFO], reprise, anneesValidees, PLAN_PAR_DEFAUT)

describe('confronterLesAmortissementsRepris — compte par compte, au 31 décembre qui précède l’ouverture', () => {
  it('nomme chaque écart : le compte, les deux cumuls, l’écart — un compte de la reprise sans bien au registre compris', () => {
    const c = confronter([FAUTEUIL, ECRAN, PORTABLE], [
      aNouveau('a1', '281540', 'credit', 2690.63),
      aNouveau('a2', '281830', 'credit', 1851.19),
      aNouveau('a3', '281840', 'credit', 1200),
      aNouveau('a4', '512000', 'debit', 5741.82),
    ])
    expect(c?.date).toBe('2024-12-31')
    expect(c?.ecarts).toEqual([
      { compte: '281540', registreCentimes: 268267, repriseCentimes: 269063, ecartCentimes: -796 },
      // Le mobilier que l'ancien logiciel amortissait, et que le registre n'a pas : sa dotation manque en case CH.
      { compte: '281840', registreCentimes: 0, repriseCentimes: 120000, ecartCentimes: -120000 },
    ])
    expect(c?.sousUnAutreNumero).toEqual([])
  })

  it('se tait sous un euro : l’arrondi d’un autre logiciel', () => {
    expect(SEUIL_ECART_REPRISE_CENTIMES).toBe(100)
    expect(confronter([FAUTEUIL], [aNouveau('a1', '281540', 'credit', 2683.66)])?.ecarts).toEqual([])
    expect(confronter([FAUTEUIL], [aNouveau('a1', '281540', 'credit', 2683.67)])?.ecarts.map((e) => e.ecartCentimes)).toEqual([-100])
  })

  it('dit à part un compte de la reprise sous un autre numéro, sans le prendre pour un écart', () => {
    const c = confronter([ECRAN, PORTABLE], [aNouveau('a1', '28183', 'credit', 1854.59)])
    expect(c?.ecarts).toEqual([])
    expect(c?.sousUnAutreNumero).toEqual([{ compteReprise: '28183', compte: '281830', repriseCentimes: 185459, registreCentimes: 185119 }])
  })

  it('compte au crédit, un débit en moins', () => {
    const c = confronter([FAUTEUIL], [aNouveau('a1', '281540', 'credit', 3000), aNouveau('a2', '281540', 'debit', 317.33)])
    expect(c?.ecarts).toEqual([])
  })

  it('ne compte que ce que le registre amortit avant l’ouverture, et dit le bien sans nature', () => {
    const neuf = bien('neuf', { date_acquisition: '2025-02-01' })
    const sansNature = bien('sans-nature', { nature_id: null })
    const c = confronter([FAUTEUIL, neuf, sansNature], [aNouveau('a1', '281540', 'credit', 2682.67)])
    expect(c?.ecarts).toEqual([])
    expect(c?.biensSansCompte.map((b) => b.id)).toEqual(['sans-nature'])
  })

  it('se tait sans balance reprise, et dès qu’un exercice de la reprise ou d’après est validé', () => {
    expect(confronter([FAUTEUIL], [])).toBeNull()
    const reprise = [aNouveau('a1', '281540', 'credit', 1000)]
    expect(confronter([FAUTEUIL], reprise, [2025])).toBeNull()
    expect(confronter([FAUTEUIL], reprise, [2026])).toBeNull()
    expect(confronter([FAUTEUIL], reprise)?.ecarts).toHaveLength(1)
  })

  it('le détail nomme les comptes et les montants, dans les mots de l’écran', () => {
    const c = confronter([FAUTEUIL, ECRAN, PORTABLE], [aNouveau('a1', '281540', 'credit', 2690.63), aNouveau('a2', '28183', 'credit', 1854.59)])!
    expect(detailDesEcartsDeLaReprise(c)).toContain(
      `281540 : registre ${formatMoney(2682.67)}, balance reprise ${formatMoney(2690.63)}, écart ${formatMoney(7.96)} (le registre en dessous)`)
    expect(detailDesEcartsDeLaReprise(c)).toMatch(/^Cumuls au 31\/12\/2024 — /)
    expect(detailDesAmortissementsSousUnAutreNumero(c)).toContain(
      `28183 dans la balance reprise (${formatMoney(1854.59)}), 281830 au registre (${formatMoney(1851.19)})`)
  })
})
