import { beforeEach, describe, expect, it, vi } from 'vitest'

// Un faux client minimal : chaque table rend ses lignes et un compte annoncé (qu'un essai fausse pour une lecture
// partielle) ; `verifier_exercice_valide` rend ce que l'essai décide ; le stockage compte ses téléchargements.
const monde = vi.hoisted(() => ({
  verification: true as unknown,
  tables: {} as Record<string, { lignes: unknown[]; compte: number | null }>,
  exercice: null as unknown,
  telechargements: [] as string[],
}))

vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q,
      range: (debut: number, fin: number) => {
        const t = monde.tables[table] ?? { lignes: [], compte: 0 }
        return Promise.resolve({ data: t.lignes.slice(debut, fin + 1), error: null, count: t.compte })
      },
      maybeSingle: () => Promise.resolve({ data: monde.exercice, error: null }),
    }
    return q
  }
  return {
    supabase: {
      rpc: () => Promise.resolve({ data: monde.verification, error: null }),
      from: requete,
      storage: {
        from: () => ({
          download: (chemin: string) => {
            monde.telechargements.push(chemin)
            return Promise.resolve({ data: new Blob([`octets de ${chemin}`]), error: null })
          },
        }),
      },
    },
  }
})

import { lireLePaquet } from './paquetDArchiveLecture'

beforeEach(() => {
  monde.verification = true
  monde.exercice = { dossier_id: 'd1', annee: 2025, forme_empreinte: 2 }
  monde.telechargements = []
  monde.tables = {
    ecritures_brouillon: {
      lignes: [{ id: 'e1', piece_id: 'p1', immobilisation_id: null }, { id: 'e2', piece_id: null, immobilisation_id: 'i1' }],
      compte: 2,
    },
    immobilisations: { lignes: [{ id: 'i1', piece_id: 'p2' }], compte: 1 },
    pieces: {
      lignes: [
        { id: 'p1', storage_path: 'd1/a.pdf' }, { id: 'p2', storage_path: 'd1/b.pdf' }, { id: 'p3', storage_path: 'd1/c.pdf' },
      ],
      compte: 3,
    },
  }
})

describe('la lecture du paquet d’archive', () => {
  it('lit l’exercice, les pièces qu’il cite (directement ou par leur bien) et leurs seuls originaux', async () => {
    const lecture = await lireLePaquet('d1', 2025)
    expect(lecture.etat).toBe('lue')
    if (lecture.etat !== 'lue') return
    expect(lecture.piecesCitees).toEqual(['p1', 'p2'])
    expect(monde.telechargements).toEqual(['d1/a.pdf', 'd1/b.pdf'])
  })

  it('une lecture partielle des écritures validées refuse, sans rien télécharger', async () => {
    monde.tables.ecritures_brouillon.compte = 5
    const lecture = await lireLePaquet('d1', 2025)
    expect(lecture).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('lues en partie') })
    expect(monde.telechargements).toEqual([])
  })

  it('une lecture partielle des pièces refuse, sans rien télécharger', async () => {
    monde.tables.pieces.compte = null
    expect(await lireLePaquet('d1', 2025)).toMatchObject({ etat: 'refusee' })
    expect(monde.telechargements).toEqual([])
  })

  it('une pièce citée dont le chemin nomme un autre dossier refuse, sans jamais le demander au stockage (CFCS-Q1)', async () => {
    monde.tables.pieces.lignes[1] = { id: 'p2', storage_path: 'd2/vol.pdf' }
    const lecture = await lireLePaquet('d1', 2025)
    expect(lecture).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('pas dans ce dossier') })
    if (lecture.etat === 'refusee') expect(lecture.motif).not.toContain('d2')
    expect(monde.telechargements).toEqual(['d1/a.pdf'])
  })

  it('une pièce citée introuvable refuse', async () => {
    monde.tables.pieces = { lignes: [{ id: 'p1', storage_path: 'd1/a.pdf' }], compte: 1 }
    expect(await lireLePaquet('d1', 2025)).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('introuvables') })
  })

  it('une empreinte qui ne se vérifie pas refuse avant toute autre lecture', async () => {
    monde.verification = false
    expect(await lireLePaquet('d1', 2025)).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('ne correspond plus') })
    monde.verification = null
    expect(await lireLePaquet('d1', 2025)).toMatchObject({ etat: 'refusee' })
    expect(monde.telechargements).toEqual([])
  })
})
