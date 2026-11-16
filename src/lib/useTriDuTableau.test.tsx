import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTriDuTableau } from './useTriDuTableau'

describe('useTriDuTableau', () => {
  it('suit le cycle au clic, et revient à l’ordre d’origine au changement de dossier', () => {
    const { result, rerender } = renderHook(({ dossier }) => useTriDuTableau(dossier), { initialProps: { dossier: 'd1' } })
    expect(result.current.tri).toBeNull()
    act(() => result.current.trierPar('date'))
    expect(result.current.tri).toEqual({ colonne: 'date', sens: 'croissant' })
    act(() => result.current.trierPar('date'))
    expect(result.current.tri).toEqual({ colonne: 'date', sens: 'decroissant' })
    rerender({ dossier: 'd2' })
    expect(result.current.tri).toBeNull()
    act(() => result.current.trierPar('date'))
    expect(result.current.tri).toEqual({ colonne: 'date', sens: 'croissant' })
    act(() => result.current.choisirTri(null))
    expect(result.current.tri).toBeNull()
  })
})
