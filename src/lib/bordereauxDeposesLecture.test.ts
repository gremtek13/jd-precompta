import { beforeEach, describe, expect, it, vi } from 'vitest'

// LA RECHERCHE DES BORDEREAUX DÉJÀ DÉPOSÉS (BOR6T-Q2 (A)) : le tri en base, le jugement dans le navigateur, la date de dépôt
// des seuls reconnus ; muette (« incomplete ») sur toute lecture partielle, et rien du texte dans ce qu'elle rend.

type Reponse = { data: unknown[]; error: { message: string } | null; count: number | null }
const etat = {
  demandes: [] as string[],
  reponses: new Map<string, Reponse>(),
  leve: false,
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      etat.demandes.push(`from ${table}`)
      const c: Record<string, unknown> = {}
      const noter = (nom: string) => (...args: unknown[]) => { etat.demandes.push(`${nom} ${args.map((a) => (Array.isArray(a) ? a.join('|') : String(a))).join(' ')}`); return c }
      Object.assign(c, {
        select: noter('select'), eq: noter('eq'), in: noter('in'), or: noter('or'), order: noter('order'),
        range: (debut: number) => {
          if (etat.leve) throw new Error('réseau coupé')
          const r = etat.reponses.get(table) ?? { data: [], error: null, count: 0 }
          return Promise.resolve(debut === 0 ? r : { data: [], error: null, count: r.count })
        },
      })
      return c
    },
  },
}))

const { chercherLesBordereauxDeposes } = await import('./bordereauxDeposesLecture')

const TEXTE_FICTIF = 'Bordereau de Teletransmission\nLot 7\n001 PATIENT FICTIF 01/01/1970 25,00'

beforeEach(() => {
  etat.demandes = []
  etat.reponses = new Map()
  etat.leve = false
})

describe('chercherLesBordereauxDeposes', () => {
  it('trie en base, juge ici, et ne rend que des identifiants et des dates de dépôt', async () => {
    etat.reponses.set('piece_textes_ocr', {
      data: [
        { id: 't1', piece_id: 'p1', document_id: null, texte: TEXTE_FICTIF },
        { id: 't2', piece_id: 'p2', document_id: null, texte: 'Bordereau de remise de chèques' },
        { id: 't3', piece_id: null, document_id: 'd1', texte: TEXTE_FICTIF },
      ],
      error: null, count: 3,
    })
    etat.reponses.set('pieces', { data: [{ id: 'p1', created_at: '2026-02-01T09:00:00Z' }], error: null, count: 1 })
    etat.reponses.set('documents_divers', { data: [{ id: 'd1', created_at: '2026-01-05T09:00:00Z' }], error: null, count: 1 })
    const r = await chercherLesBordereauxDeposes('dos')
    expect(r).toEqual({
      etat: 'trouves', dossierId: 'dos',
      bordereaux: [
        { type: 'document', id: 'd1', deposeLe: '2026-01-05T09:00:00Z' },
        { type: 'piece', id: 'p1', deposeLe: '2026-02-01T09:00:00Z' },
      ],
    })
    expect(JSON.stringify(r)).not.toMatch(/PATIENT|Bordereau/)
    expect(etat.demandes).toContain('or texte.ilike.*bordereau*,texte.ilike.*naissance*')
    expect(etat.demandes).toContain('eq dossier_id dos')
    expect(etat.demandes).toContain('in id p1')
    expect(etat.demandes).toContain('in id d1')
  })

  it('une lecture des textes partielle ne dit rien, ni la date d’aucune pièce', async () => {
    etat.reponses.set('piece_textes_ocr', { data: [{ id: 't1', piece_id: 'p1', document_id: null, texte: TEXTE_FICTIF }], error: null, count: 2 })
    const r = await chercherLesBordereauxDeposes('dos')
    expect(r.etat).toBe('incomplete')
    expect(etat.demandes).not.toContain('from pieces')
  })

  it('une date de dépôt illisible rend la recherche incomplète', async () => {
    etat.reponses.set('piece_textes_ocr', { data: [{ id: 't1', piece_id: 'p1', document_id: null, texte: TEXTE_FICTIF }], error: null, count: 1 })
    etat.reponses.set('pieces', { data: [], error: { message: 'refusée' }, count: null })
    expect((await chercherLesBordereauxDeposes('dos')).etat).toBe('incomplete')
  })

  it('aucun candidat : aucune seconde lecture, et « aucun » d’une lecture entière', async () => {
    etat.reponses.set('piece_textes_ocr', { data: [], error: null, count: 0 })
    expect(await chercherLesBordereauxDeposes('dos')).toEqual({ etat: 'trouves', dossierId: 'dos', bordereaux: [] })
    expect(etat.demandes.filter((d) => d.startsWith('from '))).toEqual(['from piece_textes_ocr'])
  })

  it('ne rejette jamais', async () => {
    etat.leve = true
    expect((await chercherLesBordereauxDeposes('dos')).etat).toBe('incomplete')
  })
})
