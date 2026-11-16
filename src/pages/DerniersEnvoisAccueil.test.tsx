import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DerniersEnvoisAccueil, { type EnvoiDeLAccueil } from './DerniersEnvoisAccueil'
import { FICHIER_INDISPONIBLE, FICHIER_INTROUVABLE, fichierDeLaPiece } from '../lib/ouvertureDeMesPieces'

// « MES DERNIERS ENVOIS » DE L'ACCUEIL (16/11/2026) : chaque ligne ouvre son fichier, par le vrai `ouvrirApercu` devant un
// faux stockage. Que l'accueil y passe ses envois : ClientHome.test.tsx.
const faux = vi.hoisted(() => ({
  signatures: [] as string[],
  erreur: null as { message: string } | null,
  retenir: false,
  enAttente: [] as (() => void)[],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: async (chemin: string) => {
          faux.signatures.push(chemin)
          if (faux.retenir) await new Promise<void>((r) => faux.enAttente.push(r))
          return faux.erreur ? { data: null, error: faux.erreur } : { data: { signedUrl: `https://exemple/${chemin}` }, error: null }
        },
      }),
    },
  },
}))

const envoi = (id: string, chemin: string): EnvoiDeLAccueil => ({
  id, nomFichier: `${id}.pdf`, createdAt: '2026-09-10T09:00:00Z', label: 'Facture traitée',
  fichier: fichierDeLaPiece({ storage_path: chemin, lisible_path: null, dossier_id: 'd1' }),
})

let ouvertures: string[] = []
beforeEach(() => {
  faux.signatures = []
  faux.erreur = null
  faux.retenir = false
  faux.enAttente = []
  ouvertures = []
  vi.spyOn(window, 'open').mockImplementation((url?: string | URL) => {
    ouvertures.push(String(url))
    return { opener: window } as unknown as Window
  })
})
afterEach(() => { vi.restoreAllMocks() })

const ligne = (id: string) => screen.getByRole('button', { name: `Voir le fichier ${id}.pdf (Facture traitée)` })

describe('« Mes derniers envois » ouvre le fichier de chaque ligne', () => {
  it('le toucher ouvre le fichier par son adresse signée', async () => {
    render(<DerniersEnvoisAccueil envois={[envoi('a', 'd1/a.pdf'), envoi('b', 'd1/b.pdf')]} />)
    await act(async () => { fireEvent.click(ligne('b')) })
    expect(faux.signatures).toEqual(['d1/b.pdf'])
    expect(ouvertures).toEqual(['https://exemple/d1/b.pdf'])
  })

  it('un chemin d’un autre dossier ne part pas au stockage ; un fichier introuvable se dit', async () => {
    render(<DerniersEnvoisAccueil envois={[envoi('a', 'd2/a.pdf'), envoi('b', 'd1/b.pdf')]} />)
    await act(async () => { fireEvent.click(ligne('a')) })
    expect(faux.signatures).toEqual([])
    expect(screen.getByRole('alert').textContent).toBe(FICHIER_INTROUVABLE)
    faux.erreur = { message: 'Object not found' }
    await act(async () => { fireEvent.click(ligne('b')) })
    expect(screen.getByRole('alert').textContent).toBe(FICHIER_INDISPONIBLE)
    expect(ouvertures).toEqual([])
  })

  it('deux touchers dans le même rendu n’ouvrent qu’une fenêtre', async () => {
    faux.retenir = true
    render(<DerniersEnvoisAccueil envois={[envoi('a', 'd1/a.pdf'), envoi('b', 'd1/b.pdf')]} />)
    await act(async () => {
      fireEvent.click(ligne('a'))
      fireEvent.click(ligne('b'))
    })
    expect(faux.signatures).toEqual(['d1/a.pdf'])
    await act(async () => { for (const r of faux.enAttente.splice(0)) r() })
    expect(ouvertures).toEqual(['https://exemple/d1/a.pdf'])
  })
})
