import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Piece } from './types'

// LES SCÉNARIOS DU DÉPÔT DE LA RELECTURE DU 04/11/2026 (`outils/relecture-pieces/depot.scenarios.test.ts`), changés en gardes du
// comportement corrigé : D2, la date déduite qui ne se perd plus au dépôt (PIECES-Q1, option (A), sans migration), et D1, le
// même ticket déposé deux fois, que le doublon probable dit désormais. Côté client (lib/depot.ts) et côté cabinet
// (lib/importFichiers.ts). Ni Textract, ni Bedrock, ni Edge Function : l'extraction est simulée. Données FICTIVES.

const etat = { extraction: null as Record<string, unknown> | null }
const inserees: { table: string; ligne: Record<string, unknown> }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: () => Promise.resolve({ error: null }),
      insert: (ligne: Record<string, unknown>) => {
        inserees.push({ table, ligne })
        return { select: () => ({ single: () => Promise.resolve({ data: { id: `id-${inserees.length}` }, error: null }) }) }
      },
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({ error: null }) }) },
  },
}))

vi.mock('./extraction', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./extraction')>()
  return {
    ...reel,
    hashFichier: async (f: Blob) => `h-${await f.text()}`,
    fichierDejaPresent: async () => false,
    extractPiece: async () => etat.extraction,
  }
})

const { deposerFichier } = await import('./depot')
const { importerFichierDossier } = await import('./importFichiers')
const { confianceDeLExtraction, dateDeduite, DATE_DEDUITE_A_VERIFIER } = await import('./dateDeduite')
const { doublonsProbables } = await import('./doublonsProbables')

const pdf = (nom: string, contenu = nom) => new File([`%PDF-1.4 ${contenu}`], nom, { type: 'application/pdf' })
const photo = (nom: string, contenu = nom) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), contenu], nom, { type: 'image/jpeg' })
const pieceEcrite = (rang = 0) => inserees.filter((i) => i.table === 'pieces')[rang].ligne

beforeEach(() => {
  inserees.length = 0
  etat.extraction = { classification: 'facture', date_piece: '2025-03-10', tiers: 'PHARMACIE DU PORT', montant_ttc: 38.4, confiance: 'haute' }
})

describe('la règle de la date déduite (lib/dateDeduite.ts)', () => {
  it('plafonne « haute » à « moyenne » quand la date est déduite, et ne touche à rien d’autre', () => {
    expect(confianceDeLExtraction({ confiance: 'haute', date_piece: '2023-05-15', _date_deduite: true })).toBe('moyenne')
    expect(confianceDeLExtraction({ confiance: 'moyenne', date_piece: '2023-05-15', _date_deduite: true })).toBe('moyenne')
    // Une confiance plus basse le reste : le plafond ne remonte jamais rien.
    expect(confianceDeLExtraction({ confiance: 'basse', date_piece: '2023-05-15', _date_deduite: true })).toBe('basse')
    expect(confianceDeLExtraction({ confiance: 'haute', date_piece: '2023-05-15' })).toBe('haute')
    // Une marque sans date rendue ne dit rien d'une date.
    expect(dateDeduite({ date_piece: null, _date_deduite: true })).toBe(false)
    expect(confianceDeLExtraction({ confiance: 'haute', date_piece: null, _date_deduite: true })).toBe('haute')
  })
})

describe('D2 — la date « déduite » (règle de la première date) ne se perd plus au dépôt', () => {
  // L'avis d'échéance d'une assurance : la ligne « échéance » écartée, c'est la date du contrat qui reste.
  const extractionDeduite = {
    classification: 'facture', tiers: 'ASSUREUR FICTIF', montant_ttc: 412.5, confiance: 'haute', date_piece: '2023-05-15', _date_deduite: true,
  }

  it('client (« Mes pièces ») : la pièce s’écrit de confiance « moyenne », plus « haute »', async () => {
    etat.extraction = extractionDeduite
    expect((await deposerFichier('d1', pdf('avis.pdf'), new Set())).statut).toBe('ok')
    expect(pieceEcrite()).toMatchObject({ date_piece: '2023-05-15', confiance: 'moyenne' })
  })

  it('cabinet (Justificatifs) : de même, et le message dit la date à vérifier', async () => {
    etat.extraction = extractionDeduite
    const r = await importerFichierDossier({ dossierId: 'd1', file: pdf('avis.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r).toEqual({ statut: 'ok', message: `Classé « Facture » → Pièces — ${DATE_DEDUITE_A_VERIFIER}` })
    expect(pieceEcrite()).toMatchObject({ date_piece: '2023-05-15', confiance: 'moyenne' })
  })

  it('témoin : une date lue sur un libellé garde sa confiance et son message', async () => {
    const r = await importerFichierDossier({ dossierId: 'd1', file: pdf('ticket.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r).toEqual({ statut: 'ok', message: 'Classé « Facture » → Pièces' })
    expect(pieceEcrite().confiance).toBe('haute')
    await deposerFichier('d1', pdf('ticket2.pdf'), new Set())
    expect(pieceEcrite(1).confiance).toBe('haute')
  })

  it('les trois chemins qui écrivent une extraction passent par la même règle (lecture du source)', () => {
    const racine = new URL('../', import.meta.url).pathname
    for (const f of ['lib/depot.ts', 'lib/importFichiers.ts', 'pages/dossier/FichePiece.tsx']) {
      const source = readFileSync(racine + f, 'utf8')
      expect(source, f).toMatch(/confianceDeLExtraction\(/)
      // Aucun ne recopie plus la confiance rendue telle quelle.
      expect(source, f).not.toMatch(/confiance: extraction\?\.confiance/)
      expect(source, f).not.toMatch(/setConfiance\(result\.confiance\)/)
    }
  })
})

describe('D1 — le même ticket photographié deux fois, ou la facture en PDF et en photo', () => {
  // Ce que la base relit des lignes écrites : la règle du doublon probable n'en lit que les champs de la pièce.
  const relues = (): Piece[] => inserees.filter((i) => i.table === 'pieces').map((i, n) => ({
    ...(i.ligne as unknown as Piece), id: `p${n}`,
  }))

  it('deux photos du même ticket : deux pièces à valider, que le doublon probable rapproche', async () => {
    const enVol = new Set<string>()
    const a = await deposerFichier('d1', photo('IMG_2001.jpg', 'ticket pris une fois'), enVol)
    const b = await deposerFichier('d1', photo('IMG_2002.jpg', 'ticket pris deux fois'), enVol)
    expect([a.statut, b.statut]).toEqual(['ok', 'ok'])
    const pieces = relues()
    expect(pieces).toHaveLength(2)
    expect(doublonsProbables(pieces, false, null).paires.map((p) => [p.a.nom_fichier, p.b.nom_fichier])).toEqual([['IMG_2001.jpg', 'IMG_2002.jpg']])
  })

  it('la facture en PDF (cabinet) puis en photo (client), le nom lu autrement : la même paire', async () => {
    await importerFichierDossier({ dossierId: 'd1', file: pdf('facture.pdf', 'pdf du fournisseur'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    etat.extraction = { ...etat.extraction, tiers: 'Pharmacie du Port SARL', date_piece: '2025-03-11' }
    await deposerFichier('d1', photo('IMG_3001.jpg', 'photo de la même facture'), new Set())
    const r = doublonsProbables(relues(), false, null)
    expect(r.paires).toHaveLength(1)
    expect(r.paires[0]).toMatchObject({ montant: 38.4, jours: 1, fournisseurLu: true })
  })
})
