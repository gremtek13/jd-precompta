import { beforeEach, describe, expect, it, vi } from 'vitest'

// Un faux client minimal : chaque table rend ses lignes et un compte annoncé (qu'un essai fausse pour une lecture
// partielle) ; `verifier_exercice_valide` rend ce que l'essai décide ; le stockage compte ses téléchargements.
const monde = vi.hoisted(() => ({
  verification: true as unknown,
  tables: {} as Record<string, { lignes: unknown[]; compte: number | null }>,
  exercice: null as unknown,
  telechargements: [] as string[],
  lues: [] as string[],
}))

vi.mock('./supabase', () => {
  const requete = (table: string) => {
    monde.lues.push(table)
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

import { INVENTAIRE_PREVU } from './inventaire'
import { lireLePaquet, lireLePaquetSelon } from './paquetDArchiveLecture'

beforeEach(() => {
  monde.verification = true
  monde.exercice = { dossier_id: 'd1', annee: 2025, forme_empreinte: 2 }
  monde.telechargements = []
  monde.lues = []
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

  // INV3-Q1 (A) : les pièces que l'inventaire de l'exercice scelle entrent au paquet, derrière `INVENTAIRE_PREVU`.
  describe('les pièces de l’inventaire', () => {
    beforeEach(() => {
      monde.tables.pieces.lignes.push({ id: 'p4', storage_path: 'd1/d.pdf' }, { id: 'p5', storage_path: 'd1/e.pdf' })
      monde.tables.pieces.compte = 5
      monde.tables.operations_inventaire = {
        lignes: [
          { id: 'o1', dossier_id: 'd1', exercice: 2025, reprise: false, piece_citee_id: 'p3', provision_id: null },
          { id: 'o2', dossier_id: 'd1', exercice: 2024, reprise: true, piece_citee_id: 'p4', provision_id: null },
          { id: 'o3', dossier_id: 'd1', exercice: 2025, reprise: false, piece_citee_id: null, provision_id: 'v1' },
        ],
        compte: 3,
      }
      monde.tables.provisions = { lignes: [{ id: 'v1', dossier_id: 'd1', piece_citee_id: 'p5' }], compte: 1 }
    })

    it('le drapeau baissé : le paquet d’hier, l’inventaire jamais lu', async () => {
      expect(INVENTAIRE_PREVU).toBe(false)
      const lecture = await lireLePaquet('d1', 2025)
      expect(lecture).toMatchObject({ etat: 'lue', piecesCitees: ['p1', 'p2'] })
      expect(monde.telechargements).toEqual(['d1/a.pdf', 'd1/b.pdf'])
      expect(monde.lues).not.toContain('operations_inventaire')
      expect(monde.lues).not.toContain('provisions')
    })

    it('levé : la pièce d’une régularisation, d’une reprise par l’exercice de son extourne, et d’une provision évaluée', async () => {
      const lecture = await lireLePaquetSelon('d1', 2025, true)
      expect(lecture).toMatchObject({ etat: 'lue', piecesCitees: ['p1', 'p2', 'p3', 'p4', 'p5'] })
      expect(monde.telechargements).toEqual(['d1/a.pdf', 'd1/b.pdf', 'd1/c.pdf', 'd1/d.pdf', 'd1/e.pdf'])
    })

    it('levé, des régularisations ou des provisions lues en partie, ou d’un autre dossier : aucun paquet', async () => {
      monde.tables.operations_inventaire.compte = 9
      expect(await lireLePaquetSelon('d1', 2025, true)).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('régularisations d’inventaire') })
      monde.tables.operations_inventaire.compte = 3
      monde.tables.provisions.compte = null
      expect(await lireLePaquetSelon('d1', 2025, true)).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('provisions') })
      monde.tables.provisions = { lignes: [{ id: 'v1', dossier_id: 'd2', piece_citee_id: 'p5' }], compte: 1 }
      expect(await lireLePaquetSelon('d1', 2025, true)).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('pas de ce dossier') })
      expect(monde.telechargements).toEqual([])
    })
  })

  it('une empreinte qui ne se vérifie pas refuse avant toute autre lecture', async () => {
    monde.verification = false
    expect(await lireLePaquet('d1', 2025)).toMatchObject({ etat: 'refusee', motif: expect.stringContaining('ne correspond plus') })
    monde.verification = null
    expect(await lireLePaquet('d1', 2025)).toMatchObject({ etat: 'refusee' })
    expect(monde.telechargements).toEqual([])
  })
})
