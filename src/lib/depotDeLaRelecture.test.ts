import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Piece } from './types'

// LES SCÉNARIOS DU DÉPÔT DE LA RELECTURE DU 04/11/2026 (`outils/relecture-pieces/depot.scenarios.test.ts`), changés en gardes du
// comportement corrigé : D2, la date déduite qui ne se perd plus au dépôt (PIECES-Q1, option (A), sans migration), et D1, le
// même ticket déposé deux fois, que le doublon probable dit désormais. Côté client (lib/depot.ts) et côté cabinet
// (lib/importFichiers.ts). Ni Textract, ni Bedrock, ni Edge Function : l'extraction est simulée. Données FICTIVES.

const etat = {
  extraction: null as Record<string, unknown> | null,
  // D5 et D6 (lot suivant, même jour) : une lecture qui lève, et le compte des lectures en vol.
  extractionLeve: null as string | null,
  delaiMs: 0,
  appels: 0,
  enCours: 0,
  maxEnCours: 0,
}
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
    extractPiece: async () => {
      etat.appels += 1
      etat.enCours += 1
      etat.maxEnCours = Math.max(etat.maxEnCours, etat.enCours)
      try {
        if (etat.delaiMs > 0) await new Promise((r) => setTimeout(r, etat.delaiMs))
        if (etat.extractionLeve) throw new Error(etat.extractionLeve)
        return etat.extraction
      } finally {
        etat.enCours -= 1
      }
    },
  }
})

const { deposerFichier } = await import('./depot')
const { importerFichierDossier } = await import('./importFichiers')
const { confianceDeLExtraction, dateDeduite, DATE_DEDUITE_A_VERIFIER } = await import('./dateDeduite')
const { doublonsProbables } = await import('./doublonsProbables')
const { creerReservoir } = await import('./reservoir')
const { DEPOTS_LUS_A_LA_FOIS, LECTURE_RATEE_CABINET, PDF_NON_LU_CABINET } = await import('./lectureDesPieces')

const pdf = (nom: string, contenu = nom) => new File([`%PDF-1.4 ${contenu}`], nom, { type: 'application/pdf' })
const photo = (nom: string, contenu = nom) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), contenu], nom, { type: 'image/jpeg' })
const pieceEcrite = (rang = 0) => inserees.filter((i) => i.table === 'pieces')[rang].ligne

beforeEach(() => {
  inserees.length = 0
  etat.extractionLeve = null
  etat.delaiMs = 0
  etat.appels = 0
  etat.enCours = 0
  etat.maxEnCours = 0
  etat.extraction ={ classification: 'facture', date_piece: '2025-03-10', tiers: 'PHARMACIE DU PORT', montant_ttc: 38.4, confiance: 'haute' }
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

// D5 (PIECES-Q5) — UNE LECTURE RATÉE OU INCOMPLÈTE SE DIT, au dépôt du praticien comme à celui du cabinet. Les scénarios
// « D4 » du fichier de la relecture (`depot.scenarios.test.ts`), changés en gardes.
describe('D5 — une lecture ratée ou incomplète se dit, sans être confondue avec un succès', () => {
  it('client : Textract refuse → la pièce arrive « à valider », et le dépôt dit que la lecture n’a pas abouti', async () => {
    etat.extractionLeve = 'Rate exceeded'
    expect(await deposerFichier('d1', pdf('ticket.pdf'), new Set())).toEqual({
      statut: 'ok', cible: { type: 'piece', id: 'id-1' }, lectureNonAboutie: true,
    })
    expect(pieceEcrite()).toMatchObject({ statut: 'a_valider', date_piece: null, montant_ttc: null, confiance: null })
  })

  it('client : une lecture sans date ni montant n’est plus un « ok » muet ; une lecture complète, si', async () => {
    etat.extraction = { classification: 'facture', date_piece: null, tiers: null, montant_ttc: null, confiance: 'moyenne' }
    expect((await deposerFichier('d1', pdf('a.pdf'), new Set())) as Record<string, unknown>).toMatchObject({ lectureNonAboutie: true })
    etat.extraction = { classification: 'facture', date_piece: null, tiers: 'X', montant_ttc: 12, confiance: 'moyenne' }
    expect((await deposerFichier('d1', pdf('b.pdf'), new Set())) as Record<string, unknown>).toMatchObject({ lectureNonAboutie: true })
    etat.extraction = { classification: 'facture', date_piece: '2025-03-10', tiers: 'X', montant_ttc: 12, confiance: 'haute' }
    expect(await deposerFichier('d1', pdf('c.pdf'), new Set())).toEqual({ statut: 'ok', cible: { type: 'piece', id: 'id-3' } })
    // Un document rangé dans Documents n'a ni date ni montant à lire : rien à dire.
    etat.extraction = { classification: 'attestation', date_piece: null, montant_ttc: null, confiance: 'haute' }
    expect(await deposerFichier('d1', pdf('d.pdf'), new Set())).toEqual({ statut: 'ok', cible: { type: 'document', id: 'id-4' } })
  })

  it('cabinet : la citation ratée (Bedrock, délai) rend une pièce sans montant — le message le dit, et la compte à compléter', async () => {
    etat.extraction = {
      classification: 'facture', date_piece: '2025-03-10', tiers: null, montant_ttc: null, montant_ht: null, montant_tva: null,
      confiance: 'moyenne', texte_ocr: 'PHARMACIE\nTOTAL 38,40', _citation_erreur: 'délai de la citation dépassé (30 s)',
    }
    const r = await importerFichierDossier({ dossierId: 'd1', file: pdf('ticket.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r).toEqual({ statut: 'ok', message: 'Classé « Facture » → Pièces — montant non lu, à saisir', aCompleter: true })
    etat.extraction = { ...etat.extraction, date_piece: null }
    const r2 = await importerFichierDossier({ dossierId: 'd1', file: pdf('t2.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r2.message).toBe('Classé « Facture » → Pièces — montant et date non lus, à saisir')
    etat.extraction = { ...etat.extraction, montant_ttc: 38.4 }
    const r3 = await importerFichierDossier({ dossierId: 'd1', file: pdf('t3.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r3.message).toBe('Classé « Facture » → Pièces — date non lue, à saisir')
  })

  it('cabinet : l’extraction qui échoue en entier reste dite, et comptée à compléter', async () => {
    etat.extractionLeve = 'Rate exceeded'
    const r = await importerFichierDossier({ dossierId: 'd1', file: pdf('t.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r).toEqual({ statut: 'ok', message: LECTURE_RATEE_CABINET, aCompleter: true })
  })

  it('cabinet : un document rangé par la lecture le dit, avec le geste qui le reprend en facture (D4)', async () => {
    etat.extraction = { classification: 'attestation', confiance: 'haute' }
    const r = await importerFichierDossier({ dossierId: 'd1', file: pdf('a.pdf'), sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r).toEqual({ statut: 'ok', message: 'Classé « Attestation » → Documents par la lecture — une facture se reprend par « C’est une facture »' })
  })

  it('un PDF de 15 Mio, que le seau prend et que la lecture refuse, n’est pas envoyé à la lecture, et se dit des deux côtés', async () => {
    const lourd = pdf('scan-15mo.pdf')
    Object.defineProperty(lourd, 'size', { value: 15 * 1024 * 1024 })
    expect(await deposerFichier('d1', lourd, new Set())).toMatchObject({ statut: 'ok', lectureNonAboutie: true })
    const r = await importerFichierDossier({ dossierId: 'd1', file: lourd, sousDossierId: null, hashsConnus: new Set(), userId: 'u1' })
    expect(r).toEqual({ statut: 'ok', message: PDF_NON_LU_CABINET, aCompleter: true })
    expect(etat.appels).toBe(0)
    expect(inserees.filter((i) => i.table === 'pieces')).toHaveLength(2)
  })
})

// D6 (PIECES-Q4) — LE DÉPÔT PAR PETITS LOTS : le scénario des quarante photos de la relecture, joué avec le réservoir de
// « Mes pièces » au lieu du `Promise.all` d'hier. Trois lectures en vol au plus, partagées entre deux lots, et le même fichier
// déposé deux fois d'un lot à l'autre s'arrête toujours.
describe('D6 — le dépôt du praticien lit au plus trois fichiers à la fois', () => {
  it('quarante photos choisies d’un coup : trois lectures en vol au plus, quarante pièces', async () => {
    etat.delaiMs = 5
    const reservoir = creerReservoir(DEPOTS_LUS_A_LA_FOIS)
    const enVol = new Set<string>()
    const fichiers = Array.from({ length: 40 }, (_, i) => photo(`IMG_${1000 + i}.jpg`, `ticket ${i}`))
    const resultats = await Promise.all(fichiers.map((f) => reservoir.executer(() => deposerFichier('d1', f, enVol))))
    expect(resultats.every((r) => r.statut === 'ok')).toBe(true)
    expect(etat.maxEnCours).toBe(3)
    expect(inserees.filter((i) => i.table === 'pieces')).toHaveLength(40)
  })

  it('deux lots lancés coup sur coup partagent le réservoir et les empreintes : trois en vol, le fichier commun une fois', async () => {
    etat.delaiMs = 5
    const reservoir = creerReservoir(DEPOTS_LUS_A_LA_FOIS)
    const enVol = new Set<string>()
    const lot = (noms: string[]) => Promise.all(noms.map((n) => reservoir.executer(() => deposerFichier('d1', photo(n, n === 'commun.jpg' ? 'même' : n), enVol))))
    const [a, b] = await Promise.all([lot(['a1.jpg', 'a2.jpg', 'commun.jpg']), lot(['b1.jpg', 'commun.jpg', 'b2.jpg'])])
    expect(etat.maxEnCours).toBe(3)
    expect([...a, ...b].filter((r) => r.statut === 'doublon')).toHaveLength(1)
    expect(inserees.filter((i) => i.table === 'pieces')).toHaveLength(5)
  })
})
