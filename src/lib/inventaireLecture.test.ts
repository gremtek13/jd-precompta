import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inventaireDeLaLecture, lireLInventaireDeLaValidation, lireLInventaireDeLaValidationSelon, motifDeLInventaire } from './inventaireLecture'

// LA LECTURE DE L'INVENTAIRE POUR LA VALIDATION (ligne 35, INV3 ; lib/inventaireLecture.ts). Ce que ces cas gardent : drapeau
// baissé, aucun appel — l'inventaire est sans objet ; levé, les trois tables DU DOSSIER demandé, leurs colonnes nommées, lues
// jusqu'au bout de ce que la base annonce (`lireTout`) sous un tri total terminé par la clé primaire ; une lecture en partie,
// refusée, qui LÈVE, ou une ligne que les juges ne croiraient pas se dit (un motif), jamais un inventaire vide qui laisserait
// valider un exercice sans lui. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  mode: 'entier' as 'entier' | 'muet' | 'refus' | 'leve',
  demandes: [] as { table: string; colonnes: string; dossier: unknown; tri: string[] }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const demande = { table, colonnes: '', dossier: null as unknown, tri: [] as string[] }
        faux.demandes.push(demande)
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string) => { demande.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { demande.dossier = valeur; predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { demande.tri.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.mode === 'leve') return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            if (faux.mode === 'refus' && table === 'provisions') {
              return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
            }
            const toutes = filtrer(faux.tables[table] ?? [], predicats)
            const jusqua = faux.mode === 'muet' && table === 'inventaires_declares' ? Math.min(fin + 1, 1) : fin + 1
            return Promise.resolve({ data: toutes.slice(debut, jusqua), error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const operation = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486000',
  montant_centimes: 120000, tva_centimes: 0, objet: 'Assurance 2026', provision_id: null, reprise: false, ...o,
})
const declaration = (id: string, dossier: string, o: Record<string, unknown> = {}) =>
  ({ id, dossier_id: dossier, exercice: 2025, retire_le: null, ...o })

beforeEach(() => {
  faux.mode = 'entier'
  faux.demandes = []
  faux.tables = {
    operations_inventaire: [operation('o1', 'd1'), operation('o2', 'd2')],
    inventaires_declares: [declaration('i1', 'd1'), declaration('i2', 'd1', { exercice: 2024, retire_le: '2025-02-01T10:00:00Z' }), declaration('i3', 'd2')],
    provisions: [{ id: 'p1', dossier_id: 'd1', compte_provision: '151100', reprise_centimes: 50000 }],
  }
})

describe('lireLInventaireDeLaValidation', () => {
  it('drapeau baissé : sans objet, aucun appel', async () => {
    expect(await lireLInventaireDeLaValidation('d1')).toEqual({ dossierId: 'd1', etat: 'sans_objet' })
    expect(faux.demandes).toEqual([])
  })

  it('levé : les trois tables de CE dossier, lues en entier, leurs colonnes nommées, un tri total terminé par la clé primaire', async () => {
    const lue = await lireLInventaireDeLaValidationSelon('d1', true)
    expect(lue).toEqual({
      dossierId: 'd1', etat: 'lu',
      inventaire: {
        etat: 'lu',
        operations: [{
          id: 'o1', exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486000', montant_centimes: 120000,
          tva_centimes: 0, objet: 'Assurance 2026', provision_id: null, reprise: false,
        }],
        declarations: [{ id: 'i1', exercice: 2025, retire_le: null }, { id: 'i2', exercice: 2024, retire_le: '2025-02-01T10:00:00Z' }],
        provisions: [{ id: 'p1', compte_provision: '151100', reprise_centimes: 50000 }],
      },
    })
    expect(faux.demandes.map((d) => [d.table, d.dossier, d.tri.at(-1)])).toEqual([
      ['operations_inventaire', 'd1', 'id'], ['inventaires_declares', 'd1', 'id'], ['provisions', 'd1', 'id'],
    ])
    expect(faux.demandes.every((d) => !d.colonnes.includes('*'))).toBe(true)
  })

  it('en partie, refusée, ou qui lève : un motif, jamais un inventaire vide', async () => {
    faux.mode = 'muet'
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('les déclarations') })
    faux.mode = 'refus'
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('les provisions') })
    faux.mode = 'leve'
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
  })

  it('une ligne que les juges ne croiraient pas : un montant qui n’est pas un entier, une nature inconnue', async () => {
    faux.tables.operations_inventaire = [operation('o1', 'd1', { montant_centimes: 12.5 })]
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.tables.operations_inventaire = [operation('o1', 'd1', { nature: 'stock' })]
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    // La reprise (INV3-Q2) : un booléen, que la colonne non nulle garantit ; absente, la ligne ne se croit pas.
    faux.tables.operations_inventaire = [operation('o1', 'd1', { reprise: undefined })]
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.tables.operations_inventaire = [operation('o1', 'd1', { reprise: true, exercice: 2024 })]
    expect(await lireLInventaireDeLaValidationSelon('d1', true)).toMatchObject({ etat: 'lu', inventaire: { operations: [{ reprise: true }] } })
  })

  it('ce que la validation reçoit : l’inventaire, sans objet, ou nul tant qu’il n’est pas lu entier — et le motif qui la suspend', async () => {
    expect(inventaireDeLaLecture(null)).toBeNull()
    expect(motifDeLInventaire(null)).toBe('l’inventaire du dossier n’est pas encore lu')
    expect(inventaireDeLaLecture({ dossierId: 'd1', etat: 'sans_objet' })).toEqual({ etat: 'sans_objet' })
    expect(motifDeLInventaire({ dossierId: 'd1', etat: 'sans_objet' })).toBeNull()
    expect(inventaireDeLaLecture({ dossierId: 'd1', etat: 'incomplete', motif: 'coupée' })).toBeNull()
    expect(motifDeLInventaire({ dossierId: 'd1', etat: 'incomplete', motif: 'coupée' })).toBe('l’inventaire du dossier : coupée')
    const lue = await lireLInventaireDeLaValidationSelon('d1', true)
    expect(inventaireDeLaLecture(lue)).toMatchObject({ etat: 'lu' })
    expect(motifDeLInventaire(lue)).toBeNull()
  })
})
