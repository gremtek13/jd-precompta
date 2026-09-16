import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Piece } from './types'

// Client Supabase et extraction simulés (même motif que depot.test.ts). Le journal enregistre ce qui
// part réellement en base : c'est le seul moyen de vérifier la garantie qui rend cette action sûre —
// seule `date_piece` est écrite, jamais un montant ni un statut relus et corrigés à la main.
const etat = {
  extractions: new Map<string, Record<string, unknown> | Error>(),
  telechargementsEnEchec: new Set<string>(),
  erreurEcriture: null as Error | null,
  // Mesure de concurrence : le faux `extractPiece` compte combien d'appels sont en vol en même temps.
  delaiMs: 0,
  enVol: 0,
  maxEnVol: 0,
}
const journal: { action: string; cible: string; charge?: Record<string, unknown> }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      update: (ligne: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          journal.push({ action: 'update', cible: id, charge: ligne })
          return Promise.resolve({ error: etat.erreurEcriture })
        },
      }),
    }),
    storage: {
      from: () => ({
        download: (chemin: string) => {
          journal.push({ action: 'download', cible: chemin })
          return Promise.resolve(
            etat.telechargementsEnEchec.has(chemin)
              ? { data: null, error: { message: 'Object not found' } }
              : { data: new Blob(['pdf']), error: null },
          )
        },
      }),
    },
  },
}))

vi.mock('./extraction', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./extraction')>()
  return {
    ...reel,
    extractPiece: async (_source: Blob, nom: string) => {
      journal.push({ action: 'extract', cible: nom })
      etat.enVol += 1
      etat.maxEnVol = Math.max(etat.maxEnVol, etat.enVol)
      try {
        if (etat.delaiMs > 0) await new Promise((r) => setTimeout(r, etat.delaiMs))
        const prevu = etat.extractions.get(nom)
        if (prevu instanceof Error) throw prevu
        return prevu ?? { date_piece: null }
      } finally {
        etat.enVol -= 1
      }
    },
  }
})

const { reextraireDates, piecesADater } = await import('./reextractionDates')

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'facture.pdf', storage_path: 'd1/facture.pdf',
  statut: 'validee', type_piece: 'achat', date_piece: null,
  montant_ht: 100, montant_tva: 20, montant_ttc: 120, tiers: 'Transmedical', categorie_id: 'c1',
  ...o,
} as Piece)

beforeEach(() => {
  etat.extractions = new Map()
  etat.telechargementsEnEchec = new Set()
  etat.erreurEcriture = null
  etat.delaiMs = 0
  etat.enVol = 0
  etat.maxEnVol = 0
  journal.length = 0
})

describe('piecesADater', () => {
  it('ne retient que les pièces sans date et pourvues d’un fichier', () => {
    const retenues = piecesADater([
      piece({ id: 'a', date_piece: null }),
      piece({ id: 'b', date_piece: '2023-01-31' }),
      piece({ id: 'c', date_piece: null, storage_path: '' }),
    ])
    expect(retenues.map((p) => p.id)).toEqual(['a'])
  })
})

describe('reextraireDates', () => {
  it('écrit la date trouvée sur les pièces qui en manquaient', async () => {
    etat.extractions.set('51310.pdf', { date_piece: '2025-06-30' })
    const r = await reextraireDates([piece({ id: 'p1', nom_fichier: '51310.pdf', storage_path: 'd1/51310.pdf' })])

    expect(r.datees).toEqual([{ nomFichier: '51310.pdf', date: '2025-06-30', deduite: false }])
    expect(journal.map((j) => j.action)).toEqual(['download', 'extract', 'update'])
  })

  it('n’écrit QUE la date, jamais le tiers, les montants ni le statut', async () => {
    // La garantie centrale. Ces pièces sont déjà validées, donc relues et parfois corrigées à la main
    // par le comptable — réécrire un montant corrigé avec ce que l'OCR croit lire détruirait ce
    // travail sans que rien ne le signale. L'OCR renvoie ici des valeurs volontairement différentes.
    etat.extractions.set('51310.pdf', {
      date_piece: '2025-06-30', tiers: 'TRANSMEDICAL SA', montant_ttc: 999.99,
      montant_ht: 833.32, montant_tva: 166.67, confiance: 'basse',
    })
    await reextraireDates([piece({ id: 'p1', nom_fichier: '51310.pdf', storage_path: 'd1/51310.pdf' })])

    const ecriture = journal.find((j) => j.action === 'update')
    expect(Object.keys(ecriture!.charge!)).toEqual(['date_piece'])
    expect(ecriture!.charge).toEqual({ date_piece: '2025-06-30' })
  })

  it('ne touche pas aux pièces qui ont déjà une date', async () => {
    await reextraireDates([piece({ id: 'p1', date_piece: '2023-01-31' })])
    expect(journal).toEqual([])
  })

  it('recense les pièces restées sans date, avec ce que la lecture a vu', async () => {
    // C'est ce diagnostic qui permet d'ajuster la lecture sur un document réel : sans lui, un échec
    // ne dit rien de plus que « ça n'a pas marché ».
    etat.extractions.set('880222.pdf', { date_piece: null, _diag_dates: ['2025-06-30', '2025-07-31'] })
    const r = await reextraireDates([piece({ id: 'p1', nom_fichier: '880222.pdf', storage_path: 'd1/880222.pdf' })])

    expect(r.sansDate).toEqual([{ nomFichier: '880222.pdf', datesVues: ['2025-06-30', '2025-07-31'] }])
    expect(journal.some((j) => j.action === 'update')).toBe(false)
  })

  it('poursuit le lot quand une pièce échoue, au lieu de tout interrompre', async () => {
    // Une seule pièce illisible ne doit pas priver les autres de leur date — sur un lot de vingt,
    // repartir de zéro coûte autant d'appels Textract que le lot entier.
    etat.extractions.set('a.pdf', { date_piece: '2025-01-31' })
    etat.extractions.set('b.pdf', new Error('Textract indisponible'))
    etat.extractions.set('c.pdf', { date_piece: '2025-03-31' })
    const r = await reextraireDates([
      piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' }),
      piece({ id: '2', nom_fichier: 'b.pdf', storage_path: 'd1/b.pdf' }),
      piece({ id: '3', nom_fichier: 'c.pdf', storage_path: 'd1/c.pdf' }),
    ])

    expect(r.datees.map((d) => d.nomFichier)).toEqual(['a.pdf', 'c.pdf'])
    expect(r.echecs).toEqual([{ nomFichier: 'b.pdf', message: 'Textract indisponible' }])
  })

  it('compte en échec un fichier introuvable dans le stockage', async () => {
    etat.telechargementsEnEchec.add('d1/perdue.pdf')
    const r = await reextraireDates([piece({ id: 'p1', nom_fichier: 'perdue.pdf', storage_path: 'd1/perdue.pdf' })])

    expect(r.echecs).toEqual([{ nomFichier: 'perdue.pdf', message: 'Object not found' }])
    expect(journal.some((j) => j.action === 'extract')).toBe(false)
  })

  it('ne compte pas comme datée une pièce dont l’écriture a été refusée', async () => {
    // Le piège habituel : sans vérifier l'erreur, l'écran annoncerait « 1 pièce datée » sur une ligne
    // restée vide en base — et le pack continuerait de l'ignorer.
    etat.extractions.set('51310.pdf', { date_piece: '2025-06-30' })
    etat.erreurEcriture = new Error('permission denied')
    const r = await reextraireDates([piece({ id: 'p1', nom_fichier: '51310.pdf', storage_path: 'd1/51310.pdf' })])

    expect(r.datees).toEqual([])
    expect(r.echecs).toEqual([{ nomFichier: '51310.pdf', message: 'permission denied' }])
  })

  it('traite les pièces une par une, jamais en parallèle', async () => {
    // Chaque PDF passe par le chemin asynchrone de Textract (dépôt S3 + sondage jusqu'à 50 s) :
    // vingt analyses lancées d'un coup multiplient le coût au même instant et risquent le throttling.
    // Le délai est nécessaire pour que des appels concurrents se chevauchent réellement — sans lui,
    // chacun se résoudrait avant le suivant et le test passerait même sur un `Promise.all`.
    etat.delaiMs = 5
    for (const nom of ['a.pdf', 'b.pdf', 'c.pdf']) etat.extractions.set(nom, { date_piece: '2025-06-30' })

    await reextraireDates([
      piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' }),
      piece({ id: '2', nom_fichier: 'b.pdf', storage_path: 'd1/b.pdf' }),
      piece({ id: '3', nom_fichier: 'c.pdf', storage_path: 'd1/c.pdf' }),
    ])
    expect(etat.maxEnVol).toBe(1)
  })

  it('rend compte de l’avancement, fichier par fichier', async () => {
    etat.extractions.set('a.pdf', { date_piece: '2025-01-31' })
    etat.extractions.set('b.pdf', { date_piece: '2025-02-28' })
    const vues: string[] = []
    await reextraireDates(
      [
        piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' }),
        piece({ id: '2', nom_fichier: 'b.pdf', storage_path: 'd1/b.pdf' }),
      ],
      (fait, total, nom) => vues.push(`${fait}/${total} ${nom}`),
    )
    expect(vues).toEqual(['0/2 a.pdf', '1/2 b.pdf', '2/2 '])
  })

  it('ne fait aucun appel quand il n’y a rien à dater', async () => {
    const r = await reextraireDates([piece({ date_piece: '2023-01-31' })])
    expect(r).toEqual({ datees: [], sansDate: [], echecs: [] })
    expect(journal).toEqual([])
  })
})

describe('dates déduites', () => {
  it('distingue une date déduite de la mise en page d’une date lue sur un libellé', async () => {
    // Ce qui permet de garder la règle de dernier recours sans deviner en silence : l'écran annonce
    // les déduites à part, avec leur valeur, et l'utilisateur les vérifie d'un coup d'œil.
    etat.extractions.set('lue.pdf', { date_piece: '2023-01-31' })
    etat.extractions.set('deduite.pdf', { date_piece: '2023-02-28', _date_deduite: true })
    const r = await reextraireDates([
      piece({ id: '1', nom_fichier: 'lue.pdf', storage_path: 'd1/lue.pdf' }),
      piece({ id: '2', nom_fichier: 'deduite.pdf', storage_path: 'd1/deduite.pdf' }),
    ])

    expect(r.datees).toEqual([
      { nomFichier: 'lue.pdf', date: '2023-01-31', deduite: false },
      { nomFichier: 'deduite.pdf', date: '2023-02-28', deduite: true },
    ])
  })

  it('n’invente pas une déduction quand le drapeau est absent', async () => {
    etat.extractions.set('a.pdf', { date_piece: '2023-01-31' })
    const r = await reextraireDates([piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' })])
    expect(r.datees[0].deduite).toBe(false)
  })
})
