import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase simulé (même motif que contrepartieBanque.test.ts) : cette fonction n'est qu'une
// paire de lectures, il n'y a pas de calcul pur à extraire.
const reponses: Record<string, { count: number | null; error: { message: string } | null }> = {
  pieces: { count: 0, error: null },
  documents_divers: { count: 0, error: null },
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const chaine = {
          eq: () => chaine,
          then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(reponses[table])),
        }
        return chaine
      },
    }),
  },
}))

const { fichierDejaPresent } = await import('./extraction')

beforeEach(() => {
  reponses.pieces = { count: 0, error: null }
  reponses.documents_divers = { count: 0, error: null }
})

describe('fichierDejaPresent', () => {
  it('repère le doublon dans les pièces comme dans les documents', async () => {
    reponses.pieces = { count: 1, error: null }
    expect(await fichierDejaPresent('d1', 'abc')).toBe(true)

    reponses.pieces = { count: 0, error: null }
    reponses.documents_divers = { count: 2, error: null }
    expect(await fichierDejaPresent('d1', 'abc')).toBe(true)
  })

  it('rend false quand le fichier est réellement nouveau', async () => {
    expect(await fichierDejaPresent('d1', 'abc')).toBe(false)
  })

  it('lève quand une lecture échoue, au lieu de répondre « nouveau »', async () => {
    // Le piège : un `count` nul est indiscernable d'un « aucun doublon ». Une lecture refusée
    // faisait donc répondre « ce fichier est nouveau » avec assurance, et créait précisément la
    // ligne en double que cette fonction existe pour empêcher.
    reponses.pieces = { count: null, error: { message: 'permission denied' } }
    await expect(fichierDejaPresent('d1', 'abc')).rejects.toThrow('Vérification des doublons impossible')

    reponses.pieces = { count: 0, error: null }
    reponses.documents_divers = { count: null, error: { message: 'réseau indisponible' } }
    await expect(fichierDejaPresent('d1', 'abc')).rejects.toThrow('réseau indisponible')
  })
})
