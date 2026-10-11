import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TAILLE_DES_LOTS, lireLEreporting, piecesADeJuger } from './ereportingLecture'
import { LECTURES_DE_LA_FENETRE, lecturesManquantes } from './ereportingEcran'
import { ecart, encaissement, facture, fiche, ligne, part, piece, regime, taux } from '../test/ereportingEcran'

// CE QUE LA FENÊTRE DE L'E-REPORTING LIT D'UN DOSSIER (lib/ereportingLecture.ts) : chaque source EN ENTIER, filtrée sur le
// dossier, triée sur un ordre TOTAL, ou son drapeau baissé avec son motif. Le faux client APPLIQUE les filtres
// (src/test/filtresPostgrest.ts), annonce le compte, plafonne ce qu'il rend comme PostgREST. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Lecture partielle : la table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  ordres: [] as string[],
  // Les requêtes parties, table par table, avec le nombre de valeurs d'un `.in(...)`.
  requetes: [] as { table: string; in: number | null }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const requete = { table, in: null as number | null }
        faux.requetes.push(requete)
        const q: Record<string, unknown> = {
          select: (liste: string, options: { count?: string }) => {
            if (!liste || options.count !== 'exact') throw new Error(`Sélection inattendue : ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => {
            // La jointure de `facture_lignes` : le dossier de la facture de la ligne.
            if (c === 'factures_emises.dossier_id') {
              predicats.push((l) => faux.tables.factures_emises.find((f) => f.id === l.facture_id)?.dossier_id === v)
            } else predicats.push(predicatEq(c, v))
            return q
          },
          in: (c: string, valeurs: unknown[]) => { requete.in = valeurs.length; predicats.push(predicatIn(c, valeurs)); return q },
          order: (c: string) => { faux.ordres.push(`${table}.${c}`); return q },
          range: (debut: number, fin: number) => {
            if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null })
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, faux.muetApres[table] ?? Infinity))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length })
          },
        }
        return q
      },
    },
  }
})

// Une ligne de la table, telle que le faux client la filtre : un objet à clés quelconques.
const ligneDeTable = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x))

function monde() {
  faux.muetApres = {}
  faux.refus = {}
  faux.ordres = []
  faux.requetes = []
  faux.tables = {
    regimes_ereporting: [regime(), regime({ id: 'r-autre', dossier_id: 'd2' })].map(ligneDeTable),
    pieces_ecartees_ereporting: [ecart(), ecart({ id: 'x-autre', dossier_id: 'd2' })].map(ligneDeTable),
    declarations_ereporting: [],
    declarations_ereporting_sources: [],
    pieces_hors_de_france: [fiche(), fiche({ id: 'f-autre', dossier_id: 'd2' })].map(ligneDeTable),
    pieces_hors_de_france_taux: [taux(), taux({ fiche_id: 'f-autre', dossier_id: 'd2' })].map(ligneDeTable),
    pieces: [
      piece(),
      piece({ id: 'p-autre', dossier_id: 'd2' }),
    ].map(ligneDeTable),
    factures_emises: [facture(), facture({ id: 'v-autre', dossier_id: 'd2' })].map(ligneDeTable),
    facture_lignes: [ligne(), ligne({ facture_id: 'v-autre' })].map(ligneDeTable),
    encaissements_factures: [encaissement(), encaissement({ id: 'e-autre', dossier_id: 'd2' })].map(ligneDeTable),
    encaissements_factures_taux: [part(), part({ encaissement_id: 'e-autre', dossier_id: 'd2' })].map(ligneDeTable),
    piece_textes_ocr: [
      { id: 't1', dossier_id: 'd1', piece_id: piece().id, texte: 'Texte fictif de la pièce.' },
      { id: 't-autre', dossier_id: 'd2', piece_id: 'p-autre', texte: 'Texte d’un autre dossier.' },
    ],
  }
}

beforeEach(monde)

describe('lireLEreporting', () => {
  it('lit les douze sources du dossier, et seulement les siennes, chacune entière', async () => {
    const l = await lireLEreporting('d1')
    for (const { cle } of LECTURES_DE_LA_FENETRE) expect(l[cle].complete, cle).toBe(true)
    expect(l.motif).toBeNull()
    expect(lecturesManquantes(l)).toEqual([])
    expect(l.regimes.lignes.map((r) => r.id)).toEqual([regime().id])
    expect(l.ecarts.lignes.map((e) => e.id)).toEqual([ecart().id])
    expect(l.fiches.lignes.map((f) => f.id)).toEqual([fiche().id])
    expect(l.taux.lignes.map((t) => t.fiche_id)).toEqual([fiche().id])
    expect(l.pieces.lignes.map((p) => p.id)).toEqual([piece().id])
    expect(l.factures.lignes.map((f) => f.id)).toEqual([facture().id])
    // Les lignes d’une facture d’un autre dossier ne sont pas lues : la jointure filtre sur le dossier de la facture.
    expect(l.lignes.lignes.map((x) => x.facture_id)).toEqual([facture().id])
    expect(l.encaissements.lignes.map((e) => e.id)).toEqual([encaissement().id])
    expect(l.parts.lignes.map((p) => p.encaissement_id)).toEqual([encaissement().id])
    expect(l.textes.lignes.map((t) => t.piece_id)).toEqual([piece().id])
  })

  it('trie chaque table sur un ordre TOTAL, qui se termine par sa clé', async () => {
    await lireLEreporting('d1')
    const ordres = new Set(faux.ordres)
    for (const o of [
      'regimes_ereporting.id', 'pieces_ecartees_ereporting.id', 'pieces.id', 'factures_emises.id', 'encaissements_factures.id',
      'encaissements_factures_taux.taux', 'facture_lignes.id', 'piece_textes_ocr.id',
    ]) expect(ordres.has(o), o).toBe(true)
    // La clé primaire d’une ligne de facture est `id`, d’une part d’encaissement (encaissement, taux).
    expect(faux.ordres.filter((o) => o.startsWith('facture_lignes.'))).toEqual(['facture_lignes.facture_id', 'facture_lignes.ordre', 'facture_lignes.id'])
    expect(faux.ordres.filter((o) => o.startsWith('encaissements_factures_taux.'))).toEqual(['encaissements_factures_taux.encaissement_id', 'encaissements_factures_taux.taux'])
  })

  it.each([
    ['regimes', 'regimes_ereporting'],
    ['ecarts', 'pieces_ecartees_ereporting'],
    ['declarations', 'declarations_ereporting'],
    ['sources', 'declarations_ereporting_sources'],
    ['pieces', 'pieces'],
    ['factures', 'factures_emises'],
    ['lignes', 'facture_lignes'],
    ['encaissements', 'encaissements_factures'],
    ['parts', 'encaissements_factures_taux'],
    ['textes', 'piece_textes_ocr'],
  ] as const)('%s : une lecture tronquée baisse son drapeau, avec son motif', async (cle, table) => {
    // Deux lignes de plus, dont une seule se rend : la lecture annonce le total, rend moins.
    const en_trop = (i: number) => ligneDeTable({ id: `x-${i}`, dossier_id: 'd1', piece_id: piece().id, facture_id: facture().id, encaissement_id: encaissement().id, taux: 5 + i })
    faux.tables[table] = [...faux.tables[table], en_trop(1), en_trop(2)]
    faux.muetApres[table] = 1
    const l = await lireLEreporting('d1')
    expect(l[cle].complete, cle).toBe(false)
    expect(l[cle].motif, cle).toMatch(/1 ligne\(s\) lue\(s\) sur \d+ annoncée\(s\)/)
    // Et les autres sont intactes — sauf les textes, que des pièces lues en partie empêchent de choisir.
    expect(lecturesManquantes(l).map((m) => m.motif)).toHaveLength(cle === 'pieces' ? 2 : 1)
  })

  it.each([['fiches', 'pieces_hors_de_france'], ['taux', 'pieces_hors_de_france_taux']] as const)(
    'les fiches « hors de France » : %s tronquée baisse le drapeau de la fiche ET de sa ventilation', async (_cle, table) => {
      faux.tables[table] = [...faux.tables[table], ligneDeTable({ id: 'x-2', fiche_id: 'x', dossier_id: 'd1', code_tva: 'S', taux: 20 })]
      faux.muetApres[table] = 1
      const l = await lireLEreporting('d1')
      expect(l.fiches.complete).toBe(false)
      expect(l.taux.complete).toBe(false)
      expect(l.fiches.motif).toBe(l.taux.motif)
      expect(l.fiches.motif).toMatch(/lue\(s\) sur 2 annoncée\(s\)/)
    },
  )

  it('une lecture refusée par la base baisse son drapeau avec la raison de la base', async () => {
    faux.refus.factures_emises = 'permission refusée'
    const l = await lireLEreporting('d1')
    expect(l.factures.complete).toBe(false)
    expect(l.factures.motif).toContain('permission refusée')
    expect(l.motif).toContain('permission refusée')
  })

  it('le motif global dit la première lecture manquante parmi celles qu’il porte, et reste nul sinon', async () => {
    expect((await lireLEreporting('d1')).motif).toBeNull()
    faux.refus.encaissements_factures = 'refus A'
    faux.refus.encaissements_factures_taux = 'refus B'
    const l = await lireLEreporting('d1')
    expect(l.motif).toContain('refus A')
  })

  describe('les textes', () => {
    it('ne se lisent que pour les pièces d’achat que le contenu peut juger : décrites par une fiche, datées de l’obligation ou sans date', async () => {
      faux.tables.pieces = [
        piece({ id: 'a-recente', date_piece: '2027-10-05' }),
        piece({ id: 'a-sans-date', date_piece: null }),
        piece({ id: 'a-ancienne', date_piece: '2027-08-31' }),
        piece({ id: 'note', type_piece: 'note_frais', date_piece: '2027-09-01' }),
        piece({ id: 'vente', type_piece: 'vente', date_piece: '2027-10-05' }),
        piece({ id: 'autre', type_piece: 'autre', date_piece: '2027-10-05' }),
      ].map(ligneDeTable)
      faux.tables.piece_textes_ocr = faux.tables.pieces.map((p) => ({ id: `t-${String(p.id)}`, dossier_id: 'd1', piece_id: p.id, texte: 'x' }))
      const l = await lireLEreporting('d1')
      expect(l.textes.lignes.map((t) => t.piece_id).sort()).toEqual(['a-recente', 'a-sans-date', 'note'])
    })

    it('partent par lots : un lot de plus quand la liste dépasse la taille des lots', async () => {
      const n = TAILLE_DES_LOTS * 2 + 30
      faux.tables.pieces = Array.from({ length: n }, (_, i) => ligneDeTable(piece({ id: `p-${i}`, date_piece: '2027-10-05' })))
      faux.tables.piece_textes_ocr = faux.tables.pieces.map((p) => ({ id: `t-${String(p.id)}`, dossier_id: 'd1', piece_id: p.id, texte: 'x' }))
      const l = await lireLEreporting('d1')
      const lots = faux.requetes.filter((r) => r.table === 'piece_textes_ocr').map((r) => r.in)
      expect(lots).toEqual([TAILLE_DES_LOTS, TAILLE_DES_LOTS, 30])
      expect(l.textes.lignes).toHaveLength(n)
      expect(l.textes.complete).toBe(true)
    })

    it('un lot illisible baisse le drapeau des textes, avec son motif, sans perdre les autres lots', async () => {
      faux.tables.pieces = Array.from({ length: TAILLE_DES_LOTS + 5 }, (_, i) => ligneDeTable(piece({ id: `p-${i}` })))
      faux.tables.piece_textes_ocr = faux.tables.pieces.map((p) => ({ id: `t-${String(p.id)}`, dossier_id: 'd1', piece_id: p.id, texte: 'x' }))
      faux.muetApres.piece_textes_ocr = 3
      const l = await lireLEreporting('d1')
      expect(l.textes.complete).toBe(false)
      expect(l.textes.motif).toMatch(/lue\(s\) sur/)
      expect(l.textes.lignes.length).toBeGreaterThan(0)
    })

    it('des pièces lues en partie ne laissent pas choisir : aucun texte n’est lu, la lecture des textes le dit', async () => {
      faux.tables.pieces = [...faux.tables.pieces, ligneDeTable(piece({ id: 'p-2' }))]
      faux.muetApres.pieces = 1
      const l = await lireLEreporting('d1')
      expect(l.pieces.complete).toBe(false)
      expect(l.textes.complete).toBe(false)
      expect(l.textes.lignes).toEqual([])
      expect(l.textes.motif).toContain('pièces du dossier n’ont pas été lues en entier')
      expect(faux.requetes.some((r) => r.table === 'piece_textes_ocr')).toBe(false)
    })

    it('un dossier sans pièce à juger ne lit aucun texte', async () => {
      faux.tables.pieces = []
      const l = await lireLEreporting('d1')
      expect(faux.requetes.some((r) => r.table === 'piece_textes_ocr')).toBe(false)
      expect(l.textes).toEqual({ lignes: [], complete: true, motif: null })
    })
  })

  describe('piecesADeJuger', () => {
    it('garde l’achat et la note de frais, daté du 1er septembre 2027 ou sans date', () => {
      const p = (id: string, type_piece: 'achat' | 'vente' | 'note_frais' | 'autre', date_piece: string | null) =>
        piece({ id, type_piece, date_piece })
      expect(piecesADeJuger([
        p('a', 'achat', '2027-09-01'), p('b', 'achat', '2027-08-31'), p('c', 'note_frais', null), p('d', 'vente', '2027-10-01'),
        p('e', 'achat', null), p('f', 'autre', '2027-10-01'),
      ])).toEqual(['a', 'c', 'e'])
    })
  })
})
