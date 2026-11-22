import { describe, expect, it } from 'vitest'
import { ECRITURES_LIBRES_ABSENTES } from './ecrituresLibresDesExports'
import { refusDeLEcritureLibre } from './ecritureLibre'
import {
  centimesDuMontant, confirmationDeLEcriture, confirmationDuRetrait, ecritureLibreDeLaLigne, ecrituresLibresPourLesMoteurs,
  effetSurLa2035, equilibreDeLaSaisie, formulaireDeLEcriture, formulaireVide, motifDesEcrituresLibres, saisieDuFormulaire,
  simulationTaitLesEcrituresLibres, type FormulaireDEcritureLibre,
} from './ecrituresLibresVue'

const formulaire = (o: Partial<FormulaireDEcritureLibre> = {}): FormulaireDEcritureLibre => ({
  ...formulaireVide('2025-06-30'), libelle: 'Part privée du téléphone', motif: 'Usage mixte, 30 %',
  lignes: [
    { compte: '108', sens: 'debit', montant: '120', poste: '', compteLib: '' },
    { compte: '6262', sens: 'credit', montant: '120,00', poste: 'Fournitures de bureau', compteLib: '' },
  ],
  ...o,
})
const CONTEXTE = { mode: 'tresorerie' as const, frontiere: null, ouverture: null, aujourdhui: '2025-11-22' }

describe('la saisie telle qu’elle part (EL5)', () => {
  it('les comptes lus comme l’application les lit, les montants au centime, le poste vide hors de la 2035', () => {
    const s = saisieDuFormulaire(formulaire())
    expect(s.lignes.map((l) => [l.compte, l.centimes, l.poste2035])).toEqual([['108000', 12000, null], ['626200', 12000, 'Fournitures de bureau']])
    expect(refusDeLEcritureLibre(s, CONTEXTE)).toEqual([])
    expect(equilibreDeLaSaisie(s)).toEqual({ debit: 12000, credit: 12000, ecart: 0, lisible: true })
  })

  it('un montant qui n’est pas au centime ne s’arrondit pas : le module le refuse', () => {
    expect(centimesDuMontant('12,345')).toBeNaN()
    expect(centimesDuMontant('-3')).toBeNaN()
    expect(centimesDuMontant('1 200,5')).toBe(120050)
    const s = saisieDuFormulaire(formulaire({ lignes: [{ compte: '108', sens: 'debit', montant: '12,345', poste: '', compteLib: '' }, formulaire().lignes[1]] }))
    expect(refusDeLEcritureLibre(s, CONTEXTE).map((r) => r.cle)).toContain('montant')
  })

  it('l’effet sur la 2035 : compté sous son poste, l’écart déclaré à part ; rien en engagement', () => {
    const s = saisieDuFormulaire(formulaire())
    expect(effetSurLa2035(s, 'tresorerie')).toEqual({ depensesComptees: -12000, recettesComptees: 0, depensesHors: 0, recettesHors: 0 })
    expect(effetSurLa2035(s, 'engagement').depensesComptees).toBe(0)
  })

  it('la confirmation nomme chaque ligne, les totaux et l’effet sur la 2035 ; un remplacement dit la version perdue', () => {
    const texte = confirmationDeLEcriture(formulaire(), 'tresorerie', ['Un avertissement'])
    expect(texte).toContain('108000')
    expect(texte).toContain('626200')
    expect(texte).toContain('2035 : Fournitures de bureau')
    expect(texte).toContain('Total : débit')
    expect(texte).toContain('Effet sur la 2035')
    expect(texte).toContain('Attention : Un avertissement')
    expect(confirmationDeLEcriture(formulaire({ id: 'e1', versionLue: 3 }), 'tresorerie', [])).toContain('version 3')
  })
})

describe('la lecture relue et passée aux moteurs (EL5)', () => {
  const brute = {
    id: 'e1', dossier_id: 'd1', exercice: 2025, numero: 2, date: '2025-12-31', libelle: 'Charge à payer', motif: 'Facture de janvier',
    lignes: [{ compte: '606100', sens: 'debit', centimes: 5000, poste_2035: null, compte_lib: null }, { compte: '408000', sens: 'credit', centimes: 5000, poste_2035: null, compte_lib: null }],
    avec_extourne: true, piece_citee_id: null, version: 2, cree_par: 'u1', cree_le: '2026-01-05T09:00:00Z', modifie_par: 'u2', modifie_le: '2026-01-06T09:00:00Z',
  }

  it('une ligne de la base se relit ; d’une autre forme, ou d’un autre dossier, elle ne se relit pas', () => {
    const e = ecritureLibreDeLaLigne(brute, 'd1')
    expect(e?.lignes).toHaveLength(2)
    expect(ecritureLibreDeLaLigne(brute, 'd2')).toBeNull()
    expect(ecritureLibreDeLaLigne({ ...brute, exercice: 2024 }, 'd1')).toBeNull()
    expect(ecritureLibreDeLaLigne({ ...brute, lignes: [brute.lignes[0]] }, 'd1')).toBeNull()
    expect(ecritureLibreDeLaLigne({ ...brute, lignes: [{ ...brute.lignes[0], sens: 'autre' }, brute.lignes[1]] }, 'd1')).toBeNull()
    expect(formulaireDeLEcriture(e!)).toMatchObject({ id: 'e1', versionLue: 2, avecExtourne: true })
    expect(confirmationDuRetrait(e!)).toContain('EL2025-0002')
  })

  it('le drapeau baissé : l’absence, avant même que la lecture revienne (le défaut, et l’état passé à la main)', () => {
    expect(ecrituresLibresPourLesMoteurs(null, 'd1')).toBe(ECRITURES_LIBRES_ABSENTES)
    expect(ecrituresLibresPourLesMoteurs(null, 'd1', false)).toBe(ECRITURES_LIBRES_ABSENTES)
  })

  it('levé : rien tant que la lecture n’est pas revenue pour CE dossier, ni quand elle est illisible', () => {
    expect(ecrituresLibresPourLesMoteurs(null, 'd1', true)).toBeNull()
    expect(ecrituresLibresPourLesMoteurs({ dossierId: 'd2', etat: 'absentes' }, 'd1', true)).toBeNull()
    expect(ecrituresLibresPourLesMoteurs({ dossierId: 'd1', etat: 'illisibles', motif: 'refusée' }, 'd1', true)).toBeNull()
    expect(motifDesEcrituresLibres({ dossierId: 'd1', etat: 'illisibles', motif: 'refusée' })).toContain('refusée')
    expect(motifDesEcrituresLibres(null)).toBeNull()
  })

  it('« Ma simulation » le dit le drapeau levé, en trésorerie seulement (EL5-Q1) ; le défaut est le drapeau baissé', () => {
    expect(simulationTaitLesEcrituresLibres('tresorerie')).toBe(false)
    expect(simulationTaitLesEcrituresLibres('tresorerie', true)).toBe(true)
    expect(simulationTaitLesEcrituresLibres('engagement', true)).toBe(false)
  })
})
