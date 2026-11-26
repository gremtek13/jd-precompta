import { describe, expect, it } from 'vitest'
import { prealablesPourLaRevision } from './prealablesDeLaRevision'
import type { EtatDeValidation, PrealableDeValidation } from './prealablesValidation'
import { exerciceValide } from '../test/exerciceValide'

// LES PRÉALABLES MONTRÉS DANS L'ONGLET RÉVISION (ligne 41) : rien avant la lecture revenue, rien sur une lecture partielle,
// rien de plus à un exercice validé ; sinon les préalables mêmes de la validation, bloquants et attentions à part, dans leur
// ordre. Le calcul des préalables est éprouvé par prealablesValidation.test.ts ; ici, le tri et les silences.

function prealable(o: Partial<PrealableDeValidation>): PrealableDeValidation {
  return { id: 'p', nb: null, message: 'Un préalable.', cible: 'pieces', bloquant: true, ...o }
}

function etat(prealables: PrealableDeValidation[]): EtatDeValidation {
  return { prealables, numerotation: null, report: null, validable: !prealables.some((p) => p.bloquant), fecSansChampsBnc: false }
}

const VALIDE = exerciceValide(2025)

describe('prealablesPourLaRevision', () => {
  const lus = etat([
    prealable({ id: 'a', bloquant: true }), prealable({ id: 'b', bloquant: false }), prealable({ id: 'c', bloquant: true }),
  ])

  it('ne dit rien tant qu’une lecture n’est pas revenue, même avec un état déjà calculé', () => {
    expect(prealablesPourLaRevision({ enCours: true, motif: null, validation: { valide: null, etat: lus } })).toEqual({ etat: 'en_cours' })
    expect(prealablesPourLaRevision({ enCours: false, motif: null, validation: null })).toEqual({ etat: 'en_cours' })
    expect(prealablesPourLaRevision({ enCours: false, motif: null, validation: { valide: null, etat: null } })).toEqual({ etat: 'en_cours' })
  })

  it('une lecture partielle rend son motif, et aucun préalable', () => {
    expect(prealablesPourLaRevision({ enCours: false, motif: 'permission denied', validation: { valide: null, etat: lus } }))
      .toEqual({ etat: 'incomplete', motif: 'permission denied' })
  })

  it('un exercice validé ne dit plus de préalable', () => {
    expect(prealablesPourLaRevision({ enCours: false, motif: null, validation: { valide: VALIDE, etat: null } })).toEqual({ etat: 'valide' })
  })

  it('range les bloquants et les attentions à part, dans l’ordre de la validation', () => {
    const r = prealablesPourLaRevision({ enCours: false, motif: null, validation: { valide: null, etat: lus } })
    expect(r.etat === 'lus' && [r.bloquants.map((p) => p.id), r.attentions.map((p) => p.id)]).toEqual([['a', 'c'], ['b']])
  })

  it('rien qui retienne : deux listes vides', () => {
    expect(prealablesPourLaRevision({ enCours: false, motif: null, validation: { valide: null, etat: etat([]) } }))
      .toEqual({ etat: 'lus', bloquants: [], attentions: [] })
  })
})
