import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentDivers, Piece } from './types'

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
    from: (table: string) => ({
      update: (ligne: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          journal.push({ action: 'update', cible: id, charge: ligne })
          return Promise.resolve({ error: etat.erreurEcriture })
        },
      }),
      // Le texte OCR s'archive par upsert sur `piece_textes_ocr` (clé primaire piece_id) : une pièce
      // relue remplace son texte au lieu d'en accumuler un second.
      upsert: (ligne: Record<string, unknown>) => {
        // La cible est `piece_id` OU `document_id` (la table porte l'un XOR l'autre) : la journaliser
        // telle qu'elle vient, sinon un texte de document s'enregistrerait sous « undefined » et le
        // test le laisserait passer.
        const cible = String(ligne.piece_id ?? ligne.document_id)
        journal.push({ action: `upsert:${table}`, cible, charge: ligne })
        return Promise.resolve({ error: null })
      },
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

const { relireDocuments, piecesADater, piecesARelire, documentsARelire, relireTextesDocuments } =
  await import('./relectureDocuments')

// Aucune pièce n'a de texte archivé, sauf mention contraire : c'est l'état d'un dossier existant au
// moment où ce texte commence à être conservé.
const AUCUN_TEXTE = new Set<string>()

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

describe('relireDocuments', () => {
  it('écrit la date trouvée sur les pièces qui en manquaient', async () => {
    etat.extractions.set('51310.pdf', { date_piece: '2025-06-30' })
    const r = await relireDocuments([piece({ id: 'p1', nom_fichier: '51310.pdf', storage_path: 'd1/51310.pdf' })], AUCUN_TEXTE)

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
    await relireDocuments([piece({ id: 'p1', nom_fichier: '51310.pdf', storage_path: 'd1/51310.pdf' })], AUCUN_TEXTE)

    const ecriture = journal.find((j) => j.action === 'update')
    expect(Object.keys(ecriture!.charge!)).toEqual(['date_piece'])
    expect(ecriture!.charge).toEqual({ date_piece: '2025-06-30' })
  })

  it('ne réécrit jamais la date d’une pièce qui en a déjà une', async () => {
    // Elle est bien relue — son texte manque — mais sa date, corrigée à la main le cas échéant, ne
    // doit pas être remplacée par ce que l'OCR croit lire.
    etat.extractions.set('facture.pdf', { date_piece: '2099-12-31', texte_ocr: 'FOUR MICRO-ONDES' })
    const r = await relireDocuments([piece({ id: 'p1', date_piece: '2023-01-31' })], AUCUN_TEXTE)
    expect(journal.some((j) => j.action === 'update')).toBe(false)
    expect(r.datees).toEqual([])
    expect(r.textesArchives).toEqual(['facture.pdf'])
  })

  it('recense les pièces restées sans date, avec ce que la lecture a vu', async () => {
    // C'est ce diagnostic qui permet d'ajuster la lecture sur un document réel : sans lui, un échec
    // ne dit rien de plus que « ça n'a pas marché ».
    etat.extractions.set('880222.pdf', { date_piece: null, _diag_dates: ['2025-06-30', '2025-07-31'] })
    const r = await relireDocuments([piece({ id: 'p1', nom_fichier: '880222.pdf', storage_path: 'd1/880222.pdf' })], AUCUN_TEXTE)

    expect(r.sansDate).toEqual([{ nomFichier: '880222.pdf', datesVues: ['2025-06-30', '2025-07-31'] }])
    expect(journal.some((j) => j.action === 'update')).toBe(false)
  })

  it('poursuit le lot quand une pièce échoue, au lieu de tout interrompre', async () => {
    // Une seule pièce illisible ne doit pas priver les autres de leur date — sur un lot de vingt,
    // repartir de zéro coûte autant d'appels Textract que le lot entier.
    etat.extractions.set('a.pdf', { date_piece: '2025-01-31' })
    etat.extractions.set('b.pdf', new Error('Textract indisponible'))
    etat.extractions.set('c.pdf', { date_piece: '2025-03-31' })
    const r = await relireDocuments([
      piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' }),
      piece({ id: '2', nom_fichier: 'b.pdf', storage_path: 'd1/b.pdf' }),
      piece({ id: '3', nom_fichier: 'c.pdf', storage_path: 'd1/c.pdf' }),
    ], AUCUN_TEXTE)

    expect(r.datees.map((d) => d.nomFichier)).toEqual(['a.pdf', 'c.pdf'])
    expect(r.echecs).toEqual([{ nomFichier: 'b.pdf', message: 'Textract indisponible' }])
  })

  it('compte en échec un fichier introuvable dans le stockage', async () => {
    etat.telechargementsEnEchec.add('d1/perdue.pdf')
    const r = await relireDocuments([piece({ id: 'p1', nom_fichier: 'perdue.pdf', storage_path: 'd1/perdue.pdf' })], AUCUN_TEXTE)

    expect(r.echecs).toEqual([{ nomFichier: 'perdue.pdf', message: 'Object not found' }])
    expect(journal.some((j) => j.action === 'extract')).toBe(false)
  })

  it('ne compte pas comme datée une pièce dont l’écriture a été refusée', async () => {
    // Le piège habituel : sans vérifier l'erreur, l'écran annoncerait « 1 pièce datée » sur une ligne
    // restée vide en base — et le pack continuerait de l'ignorer.
    etat.extractions.set('51310.pdf', { date_piece: '2025-06-30' })
    etat.erreurEcriture = new Error('permission denied')
    const r = await relireDocuments([piece({ id: 'p1', nom_fichier: '51310.pdf', storage_path: 'd1/51310.pdf' })], AUCUN_TEXTE)

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

    await relireDocuments([
      piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' }),
      piece({ id: '2', nom_fichier: 'b.pdf', storage_path: 'd1/b.pdf' }),
      piece({ id: '3', nom_fichier: 'c.pdf', storage_path: 'd1/c.pdf' }),
    ], AUCUN_TEXTE)
    expect(etat.maxEnVol).toBe(1)
  })

  it('rend compte de l’avancement, fichier par fichier', async () => {
    etat.extractions.set('a.pdf', { date_piece: '2025-01-31' })
    etat.extractions.set('b.pdf', { date_piece: '2025-02-28' })
    const vues: string[] = []
    await relireDocuments(
      [
        piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' }),
        piece({ id: '2', nom_fichier: 'b.pdf', storage_path: 'd1/b.pdf' }),
      ],
      AUCUN_TEXTE,
      (fait, total, nom) => vues.push(`${fait}/${total} ${nom}`),
    )
    expect(vues).toEqual(['0/2 a.pdf', '1/2 b.pdf', '2/2 '])
  })

  it('ne fait aucun appel quand tout est déjà daté ET lu', async () => {
    const dejaFaite = piece({ id: 'p1', date_piece: '2023-01-31' })
    const r = await relireDocuments([dejaFaite], new Set(['p1']))
    expect(r).toEqual({ datees: [], sansDate: [], textesArchives: [], echecs: [] })
    expect(journal).toEqual([])
  })
})

describe('dates déduites', () => {
  it('distingue une date déduite de la mise en page d’une date lue sur un libellé', async () => {
    // Ce qui permet de garder la règle de dernier recours sans deviner en silence : l'écran annonce
    // les déduites à part, avec leur valeur, et l'utilisateur les vérifie d'un coup d'œil.
    etat.extractions.set('lue.pdf', { date_piece: '2023-01-31' })
    etat.extractions.set('deduite.pdf', { date_piece: '2023-02-28', _date_deduite: true })
    const r = await relireDocuments([
      piece({ id: '1', nom_fichier: 'lue.pdf', storage_path: 'd1/lue.pdf' }),
      piece({ id: '2', nom_fichier: 'deduite.pdf', storage_path: 'd1/deduite.pdf' }),
    ], AUCUN_TEXTE)

    expect(r.datees).toEqual([
      { nomFichier: 'lue.pdf', date: '2023-01-31', deduite: false },
      { nomFichier: 'deduite.pdf', date: '2023-02-28', deduite: true },
    ])
  })

  it('n’invente pas une déduction quand le drapeau est absent', async () => {
    etat.extractions.set('a.pdf', { date_piece: '2023-01-31' })
    const r = await relireDocuments([piece({ id: '1', nom_fichier: 'a.pdf', storage_path: 'd1/a.pdf' })], AUCUN_TEXTE)
    expect(r.datees[0].deduite).toBe(false)
  })
})

describe('piecesARelire — ne repayer Textract que pour ce qui manque', () => {
  it('retient une pièce sans date, et une pièce sans texte lu', () => {
    const retenues = piecesARelire([
      piece({ id: 'sans-date', date_piece: null }),
      piece({ id: 'sans-texte', date_piece: '2023-01-31' }),
      piece({ id: 'complete', date_piece: '2023-01-31' }),
      piece({ id: 'sans-fichier', date_piece: null, storage_path: '' }),
    ], new Set(['sans-date', 'complete']))
    expect(retenues.map((p) => p.id)).toEqual(['sans-date', 'sans-texte'])
  })

  it('ne retient rien quand tout est daté et lu', () => {
    // Chaque relecture est un appel Textract facturé : relire un dossier déjà complet serait payer
    // deux fois la même lecture.
    expect(piecesARelire([piece({ id: 'a', date_piece: '2023-01-31' })], new Set(['a']))).toEqual([])
  })

  // Une pièce dans un format que Textract refuse n'obtiendra JAMAIS de texte : sans ce filtre elle
  // reste éligible à chaque lancement, et le compte affiché sur le bouton ne descend jamais.
  it("écarte un format que Textract ne sait pas lire, qui resterait éligible à vie", () => {
    const retenues = piecesARelire([
      piece({ id: 'lisible', nom_fichier: 'facture.pdf', date_piece: '2023-01-31' }),
      piece({ id: 'csv', nom_fichier: 'releve.csv', date_piece: '2023-01-31' }),
    ], AUCUN_TEXTE)
    expect(retenues.map((p) => p.id)).toEqual(['lisible'])
  })
})

describe('texte lu — ce qui manquait à l’arbitrage', () => {
  it('archive le texte sous la pièce, dans son dossier', async () => {
    etat.extractions.set('boulanger.pdf', { date_piece: '2025-03-04', texte_ocr: 'BOULANGER\nFOUR MICRO-ONDES\n199,99' })
    const r = await relireDocuments(
      [piece({ id: 'p9', dossier_id: 'd7', nom_fichier: 'boulanger.pdf', storage_path: 'd1/boulanger.pdf' })],
      AUCUN_TEXTE,
    )

    const archive = journal.find((j) => j.action === 'upsert:piece_textes_ocr')
    expect(archive?.charge).toMatchObject({
      piece_id: 'p9', dossier_id: 'd7', texte: 'BOULANGER\nFOUR MICRO-ONDES\n199,99',
    })
    expect(r.textesArchives).toEqual(['boulanger.pdf'])
  })

  it('archive le texte même quand aucune date n’est trouvée', async () => {
    // C'est justement la pièce indatable dont l'opérateur a le plus besoin de savoir ce qu'elle
    // contient : la priver de son texte parce que sa date manque serait exactement à l'envers.
    etat.extractions.set('illisible.pdf', { date_piece: null, texte_ocr: 'FOUR MICRO-ONDES' })
    const r = await relireDocuments(
      [piece({ id: 'p1', nom_fichier: 'illisible.pdf', storage_path: 'd1/illisible.pdf' })],
      AUCUN_TEXTE,
    )
    expect(r.textesArchives).toEqual(['illisible.pdf'])
    expect(r.sansDate.map((s) => s.nomFichier)).toEqual(['illisible.pdf'])
  })

  it('n’archive rien quand Textract n’a rien lu', async () => {
    // Un texte vide ferait croire à l'écran que le document a été lu et qu'il ne contient rien,
    // alors que le vrai message est « la lecture a échoué ».
    etat.extractions.set('floue.jpg', { date_piece: '2025-01-31', texte_ocr: '   ' })
    const r = await relireDocuments(
      [piece({ id: 'p1', nom_fichier: 'floue.jpg', storage_path: 'd1/floue.jpg' })],
      AUCUN_TEXTE,
    )
    expect(journal.some((j) => j.action === 'upsert:piece_textes_ocr')).toBe(false)
    expect(r.textesArchives).toEqual([])
  })

  it('n’archive rien quand la fonction déployée ne rend pas encore ce champ', async () => {
    // L'application et l'Edge Function se déploient séparément : pendant quelques minutes, l'une peut
    // attendre un champ que l'autre n'envoie pas encore. Cela ne doit rien casser.
    etat.extractions.set('ancienne.pdf', { date_piece: '2025-01-31' })
    const r = await relireDocuments(
      [piece({ id: 'p1', nom_fichier: 'ancienne.pdf', storage_path: 'd1/ancienne.pdf' })],
      AUCUN_TEXTE,
    )
    expect(r.textesArchives).toEqual([])
    expect(r.datees).toHaveLength(1)
  })
})


const document = (o: Partial<DocumentDivers> = {}): DocumentDivers => ({
  id: 'd1', dossier_id: 'dos1', sous_dossier_id: null, storage_path: 'dos1/snir.pdf',
  storage_hash: null, nom_fichier: 'snir.pdf', categorie: 'autre', attached_to_cotisation_id: null,
  notes: null, created_at: '2026-01-01T00:00:00Z', ...o,
} as DocumentDivers)

describe('documentsARelire — ne repayer Textract que pour ce qui manque', () => {
  it("retient les documents sans texte, écarte ceux qui en ont un", () => {
    const retenus = documentsARelire(
      [document({ id: 'a' }), document({ id: 'b' }), document({ id: 'c' })],
      new Set(['b']),
    )
    expect(retenus.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it("écarte un document sans chemin de stockage — il n'y a rien à relire", () => {
    expect(documentsARelire([document({ id: 'a', storage_path: '' })], new Set())).toEqual([])
  })

  // LE CAS RÉEL, mesuré le 20/09/2026 sur le dossier `test` : 37 documents relus, 36 textes archivés
  // et un relevé bancaire CSV qui rend `UnsupportedDocumentException` (HTTP 400). N'ayant jamais de
  // texte, il repartait à chaque clic — le bouton annonçait « (1) » indéfiniment, et l'écran « 1
  // échec », c'est-à-dire un incident à réessayer.
  it("écarte le relevé CSV, que Textract refuse et qui revenait à chaque relecture", () => {
    const retenus = documentsARelire([
      document({ id: 'snir', nom_fichier: 'snir.pdf' }),
      document({ id: 'releve', nom_fichier: 'T_cpte_02871_du_01-01-2025_au_31-12-2025.csv' }),
    ], new Set())
    expect(retenus.map((d) => d.id)).toEqual(['snir'])
  })
})

describe('relireTextesDocuments', () => {
  it("archive le texte lu sous document_id, jamais sous piece_id", () => {
    // La table porte piece_id XOR document_id : viser la mauvaise colonne ferait échouer le CHECK,
    // ou pire, rattacherait le texte d'un document à une pièce.
    etat.extractions.set('snir.pdf', { texte_ocr: 'RELEVÉ SNIR 2025\nHonoraires 92 340 €' })
    return relireTextesDocuments([document({ id: 'doc-9', nom_fichier: 'snir.pdf' })], new Set()).then((r) => {
      expect(r.textesArchives).toEqual(['snir.pdf'])
      const upsert = journal.find((e) => e.action === 'upsert:piece_textes_ocr')
      expect(upsert?.cible).toBe('doc-9')
      expect(upsert?.charge?.document_id).toBe('doc-9')
      expect(upsert?.charge?.piece_id).toBeUndefined()
    })
  })

  it("n'écrit RIEN d'autre que le texte", async () => {
    // Un document n'a ni date, ni tiers, ni montant, ni statut en base. Cette fonction ne doit donc
    // produire aucun `update` — c'est ce qui la rend sûre à lancer sur un dossier entier.
    etat.extractions.set('attestation.pdf', { texte_ocr: 'ATTESTATION', date_piece: '2025-03-01', tiers: 'URSSAF' })
    await relireTextesDocuments([document({ nom_fichier: 'attestation.pdf' })], new Set())
    expect(journal.filter((e) => e.action === 'update')).toEqual([])
  })

  it("distingue « Textract n'a rien lu » d'un échec", async () => {
    // L'appel a bien eu lieu et a bien été facturé : le redire en « échec » ferait relancer
    // indéfiniment la relecture sur les mêmes fichiers muets.
    etat.extractions.set('scan-vide.pdf', { texte_ocr: '   ' })
    const r = await relireTextesDocuments([document({ nom_fichier: 'scan-vide.pdf' })], new Set())
    expect(r.sansTexte).toEqual(['scan-vide.pdf'])
    expect(r.textesArchives).toEqual([])
    expect(r.echecs).toEqual([])
  })

  it("un échec n'interrompt pas le lot", async () => {
    etat.telechargementsEnEchec.add('dos1/perdu.pdf')
    etat.extractions.set('suivant.pdf', { texte_ocr: 'lisible' })
    const r = await relireTextesDocuments(
      [
        document({ id: 'a', nom_fichier: 'perdu.pdf', storage_path: 'dos1/perdu.pdf' }),
        document({ id: 'b', nom_fichier: 'suivant.pdf', storage_path: 'dos1/suivant.pdf' }),
      ],
      new Set(),
    )
    expect(r.echecs.map((e) => e.nomFichier)).toEqual(['perdu.pdf'])
    expect(r.textesArchives).toEqual(['suivant.pdf'])
  })

  it('ne relit pas un document dont le texte est déjà en base', async () => {
    const r = await relireTextesDocuments([document({ id: 'deja' })], new Set(['deja']))
    expect(journal.filter((e) => e.action === 'extract')).toEqual([])
    expect(r).toEqual({ textesArchives: [], sansTexte: [], echecs: [] })
  })

  it('reste séquentiel — jamais deux analyses Textract en vol', async () => {
    etat.delaiMs = 5
    etat.extractions.set('a.pdf', { texte_ocr: 'a' })
    etat.extractions.set('b.pdf', { texte_ocr: 'b' })
    etat.extractions.set('c.pdf', { texte_ocr: 'c' })
    await relireTextesDocuments(
      [
        document({ id: 'a', nom_fichier: 'a.pdf', storage_path: 'dos1/a.pdf' }),
        document({ id: 'b', nom_fichier: 'b.pdf', storage_path: 'dos1/b.pdf' }),
        document({ id: 'c', nom_fichier: 'c.pdf', storage_path: 'dos1/c.pdf' }),
      ],
      new Set(),
    )
    expect(etat.maxEnVol).toBe(1)
  })

  it('remonte la progression, dernier appel compris', async () => {
    etat.extractions.set('a.pdf', { texte_ocr: 'a' })
    const vues: [number, number][] = []
    await relireTextesDocuments(
      [document({ nom_fichier: 'a.pdf', storage_path: 'dos1/a.pdf' })],
      new Set(),
      (fait, total) => vues.push([fait, total]),
    )
    expect(vues).toEqual([[0, 1], [1, 1]])
  })
})
