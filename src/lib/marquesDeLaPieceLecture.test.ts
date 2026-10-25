import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireCeQueLaPieceEst, relireLesMarquesDeLaPiece, type PieceALire } from './marquesDeLaPieceLecture'

// CE QUE LA FICHE D'UNE PIÈCE LIT POUR DIRE CE QU'ELLE EST (lib/marquesDeLaPieceLecture.ts, étape VF6c) : la bascule ; dans un
// dossier basculé seulement, le pont, les liens de G4 et le virement mixte — tout ou rien ; le journal sous la policy de
// chaque ligne et les dossiers où il est resté ; l'équipe, quand il y a quelqu'un à nommer ; et, depuis l'étape VF7e, les
// exercices validés d'un dossier basculé, qui figent la désignation d'une facture source. Le faux client APPLIQUE les
// filtres (src/test/filtresPostgrest.ts), ne rend que les colonnes demandées, annonce un compte. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  leve: null as string | null,
  demandes: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leve) throw new Error(faux.leve)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let colonnes: string[] | null = null
        const lignes = () => filtrer(faux.tables[table] ?? [], predicats)
          .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
        const q: Record<string, unknown> = {
          select: (liste: string) => {
            colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim())
            faux.demandes.push(table)
            return q
          },
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          in: (c: string, v: unknown[]) => { predicats.push(predicatIn(c, v)); return q },
          order: () => q,
          range: (debut: number, fin: number) => {
            if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null })
            const toutes = lignes()
            const rendu = toutes.slice(debut, Math.min(fin + 1, faux.muetApres[table] ?? Infinity))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length })
          },
          maybeSingle: () => {
            if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] } })
            return Promise.resolve({ data: lignes()[0] ?? null, error: null })
          },
        }
        return q
      },
    },
  }
})

const D = 'd1'
const PIECE: PieceALire = {
  id: 'p1', dossier_id: D, flux_hote: null, flux_id: null, superpdp_invoice_id: null,
  identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
}

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.leve = null
  faux.demandes = []
  faux.tables = {
    dossiers: [{ id: D, nom: 'Dossier fictif', ventes_par_les_factures: true }, { id: 'ancien', nom: 'Ancien dossier' }],
    factures_emises: [
      { id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14', emetteur_siret: '12345678900012', superpdp_invoice_id: 4242 },
    ],
    transmissions_factures: [],
    lignes_bancaires: [
      { id: 'm1', dossier_id: D, piece_id: null, encaissements_de_factures: true },
      { id: 'm2', dossier_id: D, piece_id: 'p1', encaissements_de_factures: false },
    ],
    reglements_groupes: [],
    ecritures_brouillon: [{ id: 'e1', dossier_id: D, piece_id: 'p1' }],
    lettrages_manuels: [],
    encaissements_factures: [
      { id: 'n1', dossier_id: D, facture_id: 'f1', montant: 100, ligne_bancaire_id: 'm1', annule_id: null, retire_le: null },
    ],
    designations_des_pieces: [],
    cabinet_admins: [{ user_id: 'u2', email: 'collegue@cabinet-fictif.fr' }, { user_id: 'u3', email: null }],
    // Ceux du dossier, et un d'un autre dossier que le filtre écarte.
    exercices_valides: [{ dossier_id: D, annee: 2024 }, { dossier_id: D, annee: 2025 }, { dossier_id: 'ancien', annee: 2023 }],
  }
})

const ligneDuJournal = (o: Record<string, unknown>) => ({
  id: 'j1', dossier_id: D, piece_id: 'p1', geste: 'designation', facture_id: 'f1', auteur_id: 'u2', fait_le: '2026-10-24T09:00:00Z', ...o,
})

describe('lireCeQueLaPieceEst — le contexte des gestes', () => {
  it('un dossier qui n’a pas basculé : la bascule seule, et rien d’autre ne se lit', async () => {
    faux.tables.dossiers[0].ventes_par_les_factures = false
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.pour).toBe('p1')
    expect(l.contexte).toEqual({
      etat: 'lu',
      contexte: {
        dossierBascule: false, pont: { genre: 'aucune' }, liens: { rapprochee: false, reglee: false, ecrite: false, lettree: false },
        facturesDuVirementMixte: new Set(), exercicesValides: [],
      },
    })
    expect(faux.demandes.filter((t) => t !== 'designations_des_pieces')).toEqual(['dossiers'])
  })

  it('un dossier basculé : le pont sans la désignation, les quatre liens, le virement mixte', async () => {
    const l = await lireCeQueLaPieceEst(D, { ...PIECE, superpdp_invoice_id: 4242 })
    expect(l.contexte).toEqual({
      etat: 'lu',
      contexte: {
        dossierBascule: true, pont: { genre: 'une', factureId: 'f1' },
        liens: { rapprochee: true, reglee: false, ecrite: true, lettree: false },
        facturesDuVirementMixte: new Set(['f1']), exercicesValides: [2024, 2025],
      },
    })
  })

  it('un dossier basculé : ses exercices validés, ceux du dossier seul (le gel des désignations, VF7e)', async () => {
    faux.tables.exercices_valides = []
    const sans = await lireCeQueLaPieceEst(D, PIECE)
    expect(sans.contexte.etat === 'lu' && sans.contexte.contexte.exercicesValides).toEqual([])
    faux.tables.exercices_valides = [{ dossier_id: 'ancien', annee: 2025 }, { dossier_id: D, annee: 2026 }]
    const avec = await lireCeQueLaPieceEst(D, PIECE)
    expect(avec.contexte.etat === 'lu' && avec.contexte.contexte.exercicesValides).toEqual([2026])
  })

  it('un dossier basculé, une pièce que rien ne rattache : aucune facture, aucun lien', async () => {
    faux.tables.lignes_bancaires = faux.tables.lignes_bancaires.filter((m) => m.piece_id === null)
    faux.tables.ecritures_brouillon = []
    faux.tables.reglements_groupes = [{ id: 'r1', dossier_id: D, piece_id: 'p1' }]
    faux.tables.lettrages_manuels = [{ id: 'l1', dossier_id: D, piece_id: 'p1' }]
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.contexte.etat === 'lu' && l.contexte.contexte.pont).toEqual({ genre: 'aucune' })
    expect(l.contexte.etat === 'lu' && l.contexte.contexte.liens).toEqual({ rapprochee: false, reglee: true, ecrite: false, lettree: true })
  })

  it('une pièce en création : la bascule seule, et pas de journal', async () => {
    const l = await lireCeQueLaPieceEst(D, null)
    expect(l.pour).toBeNull()
    expect(l.contexte.etat === 'lu' && l.contexte.contexte.dossierBascule).toBe(true)
    expect(l.journal).toBeNull()
    expect(l.equipe).toBeNull()
    expect(faux.demandes).toEqual(['dossiers'])
  })

  it('le dossier refusé ou introuvable : incomplet, avec son motif', async () => {
    faux.refus = { dossiers: 'accès refusé' }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte).toEqual({ etat: 'incomplet', motif: 'le dossier : accès refusé' })
    faux.refus = {}
    expect((await lireCeQueLaPieceEst('inconnu', PIECE)).contexte).toEqual({ etat: 'incomplet', motif: 'le dossier : introuvable' })
  })

  it('TOUT OU RIEN : une seule collection lue en partie, et le contexte est incomplet, la collection nommée', async () => {
    const cas: [string, string][] = [
      ['factures_emises', 'les factures émises et leurs transmissions'],
      ['ecritures_brouillon', 'les écritures'],
      ['encaissements_factures', 'les encaissements'],
    ]
    for (const [table, nom] of cas) {
      faux.muetApres = { [table]: 0 }
      const l = await lireCeQueLaPieceEst(D, PIECE)
      expect(l.contexte.etat, table).toBe('incomplet')
      expect(l.contexte.etat === 'incomplet' && l.contexte.motif, table).toContain(nom)
    }
    faux.muetApres = {}
    faux.refus = { lettrages_manuels: 'refusé' }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte).toEqual({ etat: 'incomplet', motif: expect.stringContaining('les lettrages') })
    faux.refus = { reglements_groupes: 'refusé' }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte).toEqual({ etat: 'incomplet', motif: expect.stringContaining('les parts des virements groupés') })
    faux.refus = { lignes_bancaires: 'refusé' }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte).toEqual({ etat: 'incomplet', motif: expect.stringContaining('le rapprochement') })
    faux.refus = { transmissions_factures: 'refusé' }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte.etat).toBe('incomplet')
    // Les exercices validés, refusés ou lus en partie : on ne saurait plus ce qui fige une désignation (VF7e).
    faux.refus = { exercices_valides: 'refusé' }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte).toEqual({
      etat: 'incomplet', motif: 'les exercices validés : lecture interrompue après 0 ligne(s) : refusé',
    })
    faux.refus = {}
    faux.muetApres = { exercices_valides: 1 }
    expect((await lireCeQueLaPieceEst(D, PIECE)).contexte).toEqual({ etat: 'incomplet', motif: expect.stringContaining('les exercices validés') })
  })

  it('les mouvements classés lus en partie : incomplet', async () => {
    // Deux lectures de `lignes_bancaires` : le rapprochement (aucune ligne ici, donc entier même muet), les mouvements classés
    // (une ligne annoncée, aucune rendue).
    faux.tables.lignes_bancaires = faux.tables.lignes_bancaires.filter((m) => m.piece_id === null)
    faux.muetApres = { lignes_bancaires: 0 }
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.contexte).toEqual({ etat: 'incomplet', motif: expect.stringContaining('les mouvements classés par leurs encaissements') })
  })

  it('une requête qui lève ne rejette pas : elle tombe du côté signalé', async () => {
    faux.leve = 'client indisponible'
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.contexte).toEqual({ etat: 'incomplet', motif: 'client indisponible' })
    expect(l.journal).toEqual({ etat: 'incomplet', motif: 'client indisponible' })
  })
})

describe('lireCeQueLaPieceEst — le journal et l’équipe', () => {
  it('un journal vide : lu, aucun dossier ailleurs, et personne à nommer — l’équipe ne se lit pas', async () => {
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.journal).toEqual({ etat: 'lu', lignes: [], nomsDesAutresDossiers: new Map() })
    expect(l.equipe).toBeNull()
    expect(faux.demandes).not.toContain('cabinet_admins')
  })

  it('le journal de la pièce, SANS filtre sur le dossier, et l’équipe qui nomme ses auteurs', async () => {
    faux.tables.designations_des_pieces = [ligneDuJournal({}), ligneDuJournal({ id: 'j9', piece_id: 'p2' })]
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.journal?.etat === 'lu' && l.journal.lignes.map((x) => x.id)).toEqual(['j1'])
    expect(l.equipe).toEqual({ etat: 'lue', courriels: new Map([['u2', 'collegue@cabinet-fictif.fr']]) })
  })

  it('des lignes restées dans un autre dossier : leurs noms se lisent ; lus en partie, aucun nom', async () => {
    faux.tables.designations_des_pieces = [ligneDuJournal({ dossier_id: 'ancien' })]
    const l = await lireCeQueLaPieceEst(D, PIECE)
    expect(l.journal).toEqual({ etat: 'lu', lignes: [ligneDuJournal({ dossier_id: 'ancien' })], nomsDesAutresDossiers: new Map([['ancien', 'Ancien dossier']]) })
    // Rien d'ici : personne à nommer.
    expect(l.equipe).toBeNull()
    faux.muetApres = { dossiers: 0 }
    faux.tables.dossiers[0].ventes_par_les_factures = false
    const partiel = await lireCeQueLaPieceEst(D, PIECE)
    expect(partiel.journal?.etat === 'lu' && partiel.journal.nomsDesAutresDossiers).toBeNull()
  })

  it('le journal lu en partie ou refusé : incomplet, avec son motif', async () => {
    faux.tables.designations_des_pieces = [ligneDuJournal({}), ligneDuJournal({ id: 'j2' })]
    faux.muetApres = { designations_des_pieces: 1 }
    expect((await lireCeQueLaPieceEst(D, PIECE)).journal).toEqual({ etat: 'incomplet', motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
    faux.muetApres = {}
    faux.refus = { designations_des_pieces: 'accès refusé' }
    const refuse = await lireCeQueLaPieceEst(D, PIECE)
    expect(refuse.journal?.etat).toBe('incomplet')
    expect(refuse.equipe).toBeNull()
  })

  it('l’équipe lue en partie : incomplète, avec son motif', async () => {
    faux.tables.designations_des_pieces = [ligneDuJournal({})]
    faux.muetApres = { cabinet_admins: 1 }
    expect((await lireCeQueLaPieceEst(D, PIECE)).equipe).toEqual({ etat: 'incomplete', motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
  })
})

describe('relireLesMarquesDeLaPiece — LA pièce, après un geste', () => {
  const marques = {
    id: 'p1', dossier_id: D, type_piece: 'vente', statut: 'a_valider', nom_fichier: 'vente.pdf', facture_id: null,
    vente_hors_des_factures: true, updated_at: '2026-10-24T09:00:00Z',
  }

  it('sa marque, réduite aux colonnes relues, cherchée dans ce dossier', async () => {
    faux.tables.pieces = [{ ...marques, montant_ttc: 1200 }]
    expect(await relireLesMarquesDeLaPiece(D, 'p1')).toEqual({ marques })
    expect(await relireLesMarquesDeLaPiece('d2', 'p1')).toEqual({ motif: 'la pièce n’est plus dans ce dossier' })
  })

  it('refusée, ou levée : le motif, jamais un rejet', async () => {
    faux.tables.pieces = [marques]
    faux.refus = { pieces: 'accès refusé' }
    expect(await relireLesMarquesDeLaPiece(D, 'p1')).toEqual({ motif: 'accès refusé' })
    faux.refus = {}
    faux.leve = 'client indisponible'
    expect(await relireLesMarquesDeLaPiece(D, 'p1')).toEqual({ motif: 'client indisponible' })
  })
})
