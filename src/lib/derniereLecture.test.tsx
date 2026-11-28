import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { creerDerniereLecture, useDerniereLecture } from './derniereLecture'

// LE NUMÉRO DE LECTURE (audit des courses du 28/11/2026). Ce que les écrans en attendent : la lecture partie la dernière
// reste courante, toute autre ne l'est plus — quel que soit l'ordre des réponses —, et le démontage les périme toutes.
describe('creerDerniereLecture', () => {
  it('seule la lecture partie la dernière est courante, et le reste', () => {
    const c = creerDerniereLecture()
    const premiere = c.commencer()
    expect(premiere()).toBe(true)
    const seconde = c.commencer()
    expect(premiere()).toBe(false)
    expect(seconde()).toBe(true)
    // Rien ne la rend courante de nouveau : ni une autre question, ni le temps.
    expect(premiere()).toBe(false)
    expect(seconde()).toBe(true)
  })

  it('périmer les périme toutes, et une lecture partie après est courante', () => {
    const c = creerDerniereLecture()
    const enVol = c.commencer()
    c.perimer()
    expect(enVol()).toBe(false)
    expect(c.commencer()()).toBe(true)
  })

  it('deux compteurs ne se périment pas l’un l’autre', () => {
    const a = creerDerniereLecture()
    const b = creerDerniereLecture()
    const deA = a.commencer()
    b.commencer()
    expect(deA()).toBe(true)
  })
})

describe('useDerniereLecture', () => {
  it('rend la même fonction d’un rendu à l’autre, et le démontage périme la lecture en vol', () => {
    const { result, rerender, unmount } = renderHook(() => useDerniereLecture())
    const commencer = result.current
    const enVol = commencer()
    rerender()
    // Stable : un effet qui la porte en dépendance ne repart pas à chaque rendu.
    expect(result.current).toBe(commencer)
    expect(enVol()).toBe(true)
    unmount()
    expect(enVol()).toBe(false)
  })
})
