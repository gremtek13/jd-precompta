import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocieteClient } from '../context/AuthContext'

// LA CHARTE DE L'ESPACE CLIENT SUIT LA SOCIÉTÉ AFFICHÉE (ligne 23.21). Un client a deux sociétés, tenues par deux
// cabinets : la charte change avec la société affichée ; rien d'un cabinet ne s'affiche avant que SA lecture revienne ;
// la réponse tardive d'une société quittée ne s'applique pas ; une lecture en échec reste sur la charte de l'application
// (`null`), jamais sur celle de l'autre cabinet.

const faux = vi.hoisted(() => ({
  auth: {
    role: 'client' as 'cabinet' | 'client' | null,
    monCabinetId: null as string | null,
    mesSocietes: [] as SocieteClient[],
    dossierActifId: null as string | null,
  },
  lectures: [] as { id: string; rendre: (r: { data: unknown; error: unknown }) => void }[],
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => faux.auth }))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'cabinets') throw new Error(`table inattendue : ${table}`)
      return {
        select: () => ({
          eq: (colonne: string, id: string) => {
            if (colonne !== 'id') throw new Error(`filtre inattendu : ${colonne}`)
            return {
              maybeSingle: () => new Promise((rendre) => { faux.lectures.push({ id, rendre }) }),
            }
          },
        }),
      }
    },
    storage: { from: () => ({ getPublicUrl: (chemin: string) => ({ data: { publicUrl: `https://logos/${chemin}` } }) }) },
  },
}))

import { useCabinetBranding } from './branding'

const SOCIETES: SocieteClient[] = [
  { id: 'd1', nom: 'Société Un', cabinetId: 'cab-A' },
  { id: 'd2', nom: 'Société Deux', cabinetId: 'cab-B' },
]
const ligne = (nom: string, couleur: string) => ({ nom, couleur_primaire: couleur, police_google_font: null, logo_storage_path: null })

function rendre(id: string, reponse: { data: unknown; error: unknown }) {
  const lecture = faux.lectures.find((l) => l.id === id)
  if (!lecture) throw new Error(`aucune lecture du cabinet ${id}`)
  lecture.rendre(reponse)
}

afterEach(() => {
  faux.auth = { role: 'client', monCabinetId: null, mesSocietes: [], dossierActifId: null }
  faux.lectures = []
  document.documentElement.style.removeProperty('--color-primary')
})

describe('useCabinetBranding, un client chez deux cabinets', () => {
  it('la charte suit la société affichée, et ne s’affiche qu’une fois SA lecture revenue', async () => {
    faux.auth = { ...faux.auth, mesSocietes: SOCIETES, dossierActifId: 'd1' }
    const { result, rerender } = renderHook(() => useCabinetBranding())
    expect(result.current).toBeNull()
    expect(faux.lectures.map((l) => l.id)).toEqual(['cab-A'])
    await act(async () => { rendre('cab-A', { data: ligne('Cabinet A', '#112233'), error: null }) })
    expect(result.current?.nom).toBe('Cabinet A')
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#112233')

    faux.auth = { ...faux.auth, dossierActifId: 'd2' }
    rerender()
    // L'autre société ne s'affiche jamais sous la charte du cabinet A, même le temps d'une lecture.
    expect(result.current).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('')
    await act(async () => { rendre('cab-B', { data: ligne('Cabinet B', '#445566'), error: null }) })
    expect(result.current?.nom).toBe('Cabinet B')
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('#445566')
  })

  it('la réponse tardive d’une société quittée ne s’applique pas', async () => {
    faux.auth = { ...faux.auth, mesSocietes: SOCIETES, dossierActifId: 'd1' }
    const { result, rerender } = renderHook(() => useCabinetBranding())
    faux.auth = { ...faux.auth, dossierActifId: 'd2' }
    rerender()
    await act(async () => { rendre('cab-B', { data: ligne('Cabinet B', '#445566'), error: null }) })
    await act(async () => { rendre('cab-A', { data: ligne('Cabinet A', '#112233'), error: null }) })
    expect(result.current?.nom).toBe('Cabinet B')
  })

  it('une lecture en échec reste sur la charte de l’application, jamais celle de l’autre cabinet', async () => {
    faux.auth = { ...faux.auth, mesSocietes: SOCIETES, dossierActifId: 'd1' }
    const { result, rerender } = renderHook(() => useCabinetBranding())
    await act(async () => { rendre('cab-A', { data: ligne('Cabinet A', '#112233'), error: null }) })
    faux.auth = { ...faux.auth, dossierActifId: 'd2' }
    rerender()
    await act(async () => { rendre('cab-B', { data: null, error: { message: 'permission denied', code: '42501' } }) })
    expect(result.current).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('')
  })

  it('une société dont le cabinet n’a pas été lu (liste des sociétés en échec) : aucune lecture, la charte par défaut', () => {
    faux.auth = { ...faux.auth, mesSocietes: [], dossierActifId: 'd1' }
    const { result } = renderHook(() => useCabinetBranding())
    expect(result.current).toBeNull()
    expect(faux.lectures).toEqual([])
  })
})

describe('useCabinetBranding, un compte du cabinet', () => {
  it('prend la charte de son cabinet, quelle que soit la société', async () => {
    faux.auth = { role: 'cabinet', monCabinetId: 'cab-A', mesSocietes: [], dossierActifId: null }
    const { result } = renderHook(() => useCabinetBranding())
    expect(faux.lectures.map((l) => l.id)).toEqual(['cab-A'])
    await act(async () => { rendre('cab-A', { data: ligne('Cabinet A', '#112233'), error: null }) })
    expect(result.current?.nom).toBe('Cabinet A')
  })
})
