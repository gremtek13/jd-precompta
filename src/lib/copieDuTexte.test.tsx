import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DUREE_DU_COPIE_MS, useCopieDuTexte } from './copieDuTexte'

// « COPIER » UN TEXTE (ligne 22.93) : le crochet que l'onglet Accès du cabinet et « Mes pièces » du client partagent. Les
// écrans éprouvent le geste (AccesTab.test.tsx, ClientUpload.adresse.test.tsx) ; ce fichier garde ce qu'eux ne voient pas :
// l'état suit le TEXTE copié (un autre texte ne montre pas le « copié ✓ » du précédent), et rien ne se copie sans texte.

let ecrire: ReturnType<typeof vi.fn>

beforeEach(() => {
  ecrire = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: ecrire } })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => { vi.useRealTimers() })

describe('useCopieDuTexte', () => {
  it('copie le texte, le dit pendant DUREE_DU_COPIE_MS, puis l’efface', async () => {
    const { result } = renderHook(() => useCopieDuTexte('a@b.fr'))
    expect(result.current).toMatchObject({ copie: false, refusee: false })
    await act(async () => { await result.current.copier() })
    expect(ecrire).toHaveBeenCalledWith('a@b.fr')
    expect(result.current.copie).toBe(true)
    expect(DUREE_DU_COPIE_MS).toBe(2000)
    await act(async () => { vi.advanceTimersByTime(DUREE_DU_COPIE_MS - 1) })
    expect(result.current.copie).toBe(true)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(result.current.copie).toBe(false)
  })

  it('un autre texte ne montre pas le « copié ✓ » du précédent', async () => {
    const { result, rerender } = renderHook(({ texte }) => useCopieDuTexte(texte), { initialProps: { texte: 'a@b.fr' as string | null } })
    await act(async () => { await result.current.copier() })
    expect(result.current.copie).toBe(true)
    rerender({ texte: 'c@d.fr' })
    expect(result.current.copie).toBe(false)
    // Et il ne le montre pas non plus au retour du premier tant que le minuteur n'a pas parlé : c'est le même texte.
    rerender({ texte: 'a@b.fr' })
    expect(result.current.copie).toBe(true)
  })

  it('un refus se garde avec son texte, et une copie réussie de ce texte l’efface', async () => {
    ecrire.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { result, rerender } = renderHook(({ texte }) => useCopieDuTexte(texte), { initialProps: { texte: 'a@b.fr' as string | null } })
    await act(async () => { await result.current.copier() })
    expect(result.current).toMatchObject({ copie: false, refusee: true })
    rerender({ texte: 'c@d.fr' })
    expect(result.current.refusee).toBe(false)
    rerender({ texte: 'a@b.fr' })
    await act(async () => { await result.current.copier() })
    expect(result.current).toMatchObject({ copie: true, refusee: false })
  })

  it('sans texte, rien ne se copie, rien ne se dit', async () => {
    const { result } = renderHook(() => useCopieDuTexte(null))
    await act(async () => { await result.current.copier() })
    expect(ecrire).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ copie: false, refusee: false })
    expect(vi.getTimerCount()).toBe(0)
  })
})
