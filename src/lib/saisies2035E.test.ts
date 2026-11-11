import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculer2035E, SAISIES_2035E_ABSENTES } from './declaration2035E'
import {
  annexe2035EAvecSaisie, changementsDeLaSaisie2035E, lireSaisie2035E, MONTANTS_SAISIS_2035E, parametresDeLEnregistrement2035E,
  refusDeLaSaisie2035E, SAISIE_2035E_VIDE, saisie2035EDeLExercice, SAISIES_2035E_EXPORTEES, SAISIES_2035E_PREVUES, versLaBase,
} from './saisies2035E'
import type { Saisie2035E } from './saisies2035E'

// LES SAISIES DE L'ANNEXE 2035-E (ligne 48). Le module redit la migration préparée : ses huit clés, ses bornes, l'effectif
// sous le cadre coché ; et l'annexe reçoit la saisie en paramètre obligatoire, muette (`null`) sur ce qui reste à saisir.

const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261111240000_saisies_2035e.sql', import.meta.url), 'utf8')

// Une infirmière à 179 200 € d'honoraires (le cas de declaration2035E.test.ts) : 12 000 € de loyers et locations.
const cases = new Map([['AD', 179_200], ['BA', 3_000], ['BF', 9_000], ['BG', 3_000], ['BH', 2_500], ['BJ', 4_000], ['BM', 1_200]])
const ENTREE = { annee: 2025, cases, formulaire: cases, forfaitKilometrique: 1_500 }
const PLEINE: Saisie2035E = {
  loyersDeductibles: 3_000, plusValues: 0, variationDeStock: -200, taxesSurLeChiffreDAffaires: 0,
  dotationsBiensMisADisposition: 0, moinsValues: 0, monoEtablissement: true, effectif: 1,
}

describe('les drapeaux', () => {
  it('baissés tous deux : la table n’est pas en base, l’écran ne la lit pas', () => {
    expect(SAISIES_2035E_PREVUES).toBe(false)
    expect(SAISIES_2035E_EXPORTEES).toBe(false)
  })
})

describe('la saisie, confrontée à la migration', () => {
  it('les huit clés que la fonction exige, ni plus ni moins, dans l’ordre de son tableau', () => {
    const cles = /v_cles constant text\[\] := array\[([^\]]+)\]/.exec(MIGRATION)![1].match(/'(\w+)'/g)!.map((c) => c.slice(1, -1))
    expect(Object.keys(versLaBase(SAISIE_2035E_VIDE)).sort()).toEqual(cles)
    for (const m of MONTANTS_SAISIS_2035E) expect(MIGRATION).toContain(`${m.colonne} bigint,`)
  })

  it('EK seule est signée, comme la contrainte des montants', () => {
    for (const m of MONTANTS_SAISIS_2035E) {
      const borne = m.signe ? `coalesce(${m.colonne}, 0) between -999999999999` : `coalesce(${m.colonne}, 0) between 0`
      expect(MIGRATION, m.code).toContain(borne)
    }
    expect(MONTANTS_SAISIS_2035E.filter((m) => m.signe).map((m) => m.code)).toEqual(['EK'])
  })

  it('refuse avant le clic ce que la base refuserait, et rien d’autre', () => {
    expect(refusDeLaSaisie2035E(PLEINE, false, 2025)).toBeNull()
    expect(refusDeLaSaisie2035E(SAISIE_2035E_VIDE, false, 2025)).toBeNull()
    expect(refusDeLaSaisie2035E(PLEINE, true, 2025)).toMatch(/figé/)
    expect(refusDeLaSaisie2035E({ ...PLEINE, loyersDeductibles: -1 }, false, 2025)).toMatch(/^EM ne peut pas être négative/)
    expect(refusDeLaSaisie2035E({ ...PLEINE, plusValues: 12.5 }, false, 2025)).toMatch(/^EN se saisit en euros entiers/)
    expect(refusDeLaSaisie2035E({ ...PLEINE, monoEtablissement: false }, false, 2025)).toMatch(/cadre des mono-établissements est coché/)
    expect(refusDeLaSaisie2035E({ ...PLEINE, monoEtablissement: null }, false, 2025)).toMatch(/cadre des mono-établissements est coché/)
    expect(refusDeLaSaisie2035E({ ...PLEINE, effectif: 1_000_001 }, false, 2025)).toMatch(/nombre entier de salariés/)
  })

  it('se relit comme la base la garde ; une ligne qui ne se croit pas rend null', () => {
    const ligne = { annee: 2025, loyers_deductibles: 3000, plus_values: null, variation_de_stock: '-200', taxes_sur_le_chiffre_d_affaires: 0,
      dotations_biens_mis_a_disposition: null, moins_values: null, mono_etablissement: true, effectif: 1 }
    expect(lireSaisie2035E(ligne)).toEqual({ annee: 2025, loyersDeductibles: 3000, plusValues: null, variationDeStock: -200,
      taxesSurLeChiffreDAffaires: 0, dotationsBiensMisADisposition: null, moinsValues: null, monoEtablissement: true, effectif: 1 })
    expect(lireSaisie2035E({ ...ligne, loyers_deductibles: -1 })).toBeNull()
    expect(lireSaisie2035E({ ...ligne, plus_values: 1.5 })).toBeNull()
    expect(lireSaisie2035E({ ...ligne, mono_etablissement: false })).toBeNull()
    expect(lireSaisie2035E({ ...ligne, mono_etablissement: 'oui' })).toBeNull()
  })

  it('une lecture partielle ne rend aucune saisie ; un exercice sans ligne rend la saisie vide, jamais des zéros', () => {
    expect(saisie2035EDeLExercice(null, 2025)).toBeNull()
    expect(saisie2035EDeLExercice({ dossierId: 'd', etat: 'incompletes', motif: 'x' }, 2025)).toBeNull()
    expect(saisie2035EDeLExercice({ dossierId: 'd', etat: 'absentes' }, 2025)).toBeNull()
    expect(saisie2035EDeLExercice({ dossierId: 'd', etat: 'lues', saisies: [] }, 2025)).toEqual(SAISIE_2035E_VIDE)
    expect(saisie2035EDeLExercice({ dossierId: 'd', etat: 'lues', saisies: [{ ...PLEINE, annee: 2025 }] }, 2025)).toEqual(PLEINE)
  })

  it('part entière contre la saisie lue, et la confirmation nomme ce qui change', () => {
    const p = parametresDeLEnregistrement2035E('d', 2025, SAISIE_2035E_VIDE, PLEINE)
    expect(p.p_lue.loyers_deductibles).toBeNull()
    expect(p.p_saisie).toMatchObject({ loyers_deductibles: 3000, variation_de_stock: -200, mono_etablissement: true, effectif: 1 })
    expect(changementsDeLaSaisie2035E(SAISIE_2035E_VIDE, PLEINE)).toEqual([
      'EN : à saisir → 0 €', 'EK : à saisir → -200 €', 'EM : à saisir → 3000 €', 'ER : à saisir → 0 €', 'EU : à saisir → 0 €',
      'EV : à saisir → 0 €', 'AH (mono-établissement) : à saisir → oui', 'BK (effectif) : à saisir → 1',
    ])
    expect(changementsDeLaSaisie2035E(PLEINE, PLEINE)).toEqual([])
  })
})

describe('l’annexe reçoit la saisie', () => {
  it('pleine, elle vaut le calcul d’hier nourri des mêmes montants, et rien ne reste à saisir', () => {
    const { annexe, lignes, aSaisir, cadre } = annexe2035EAvecSaisie(ENTREE, PLEINE)
    const hier = calculer2035E({ ...ENTREE, saisies: { ...SAISIES_2035E_ABSENTES, loyersDeductibles: 3000, variationDeStock: -200 } })
    expect([...lignes]).toEqual([...hier.lignes])
    expect(annexe.lignes.get('EM')).toBe(3000)
    expect(aSaisir).toEqual([])
    expect(cadre).toEqual({ etat: 'coche', chiffreDeReference: 179_200, du: '2025-01-01', au: '2025-12-31', effectif: 1 })
  })

  it('vide, chaque ligne saisie et chaque total qui en dépend sont « à saisir » ; l’obligation se dit toujours', () => {
    const { annexe, lignes, aSaisir, cadre } = annexe2035EAvecSaisie(ENTREE, SAISIE_2035E_VIDE)
    for (const code of ['EN', 'EK', 'EM', 'ER', 'EU', 'EV', 'EI', 'EW', 'EX', 'JU']) expect(lignes.get(code), code).toBeNull()
    expect(lignes.get('EF')).toBe(179_200)
    expect(lignes.get('EJ')).toBe(3_000)
    expect(annexe.obligatoire).toBe(true)
    expect(aSaisir).toEqual(['EN', 'EK', 'EM', 'ER', 'EU', 'EV', 'AH'])
    expect(cadre).toEqual({ etat: 'a_dire' })
  })

  it('une seule charge manquante tait TOTAL 2 et la valeur ajoutée, pas TOTAL 1 ; le cadre coché sans effectif le réclame', () => {
    const { lignes, aSaisir } = annexe2035EAvecSaisie(ENTREE, { ...PLEINE, moinsValues: null, effectif: null })
    expect(lignes.get('EI')).not.toBeNull()
    expect(lignes.get('EW')).toBeNull()
    expect(lignes.get('JU')).toBeNull()
    expect(aSaisir).toEqual(['EV', 'BK'])
  })

  it('une plus-value manquante tait TOTAL 1 et la valeur ajoutée ; le cadre non coché ne réclame rien', () => {
    const { lignes, aSaisir, cadre } = annexe2035EAvecSaisie(ENTREE, { ...PLEINE, plusValues: null, monoEtablissement: false, effectif: null })
    expect(lignes.get('EI')).toBeNull()
    expect(lignes.get('EW')).not.toBeNull()
    expect(lignes.get('EX')).toBeNull()
    expect(aSaisir).toEqual(['EN'])
    expect(cadre).toEqual({ etat: 'non' })
  })
})
