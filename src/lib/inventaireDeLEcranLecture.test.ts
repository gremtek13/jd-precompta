import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVENTAIRE_EXPORTE, INVENTAIRE_PREVU } from './inventaire'
import {
  COLONNES_DES_DECLARATIONS, COLONNES_DES_ECRITURES, COLONNES_DES_OPERATIONS, COLONNES_DES_PROVISIONS, lireLInventaireDuDossier,
  lireLInventaireDuDossierSelon,
} from './inventaireDeLEcranLecture'

// LA LECTURE DE L'ONGLET INVENTAIRE (ligne 35, INV5 ; lib/inventaireDeLEcranLecture.ts). Ce que ces cas gardent : drapeau baissé,
// AUCUN appel — l'état est « absente » ; levé, les quatre collections DU dossier demandé, leurs colonnes nommées, lues jusqu'au
// bout de ce que la base annonce sous un tri total terminé par la clé primaire, le plan par `plan_du_dossier`, l'année des premiers
// à-nouveaux ; une lecture en partie, refusée, qui lève, d'un autre dossier ou une ligne illisible se dit (un motif), jamais un
// inventaire vide qui laisserait croire qu'il n'y a rien à régulariser. Des données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  plan: { data: [] as unknown, error: null as null | { message: string } },
  mode: 'entier' as 'entier' | 'muet' | 'refus' | 'leve' | 'ouverture-refusee',
  // Un serveur qui rend aussi les lignes des autres dossiers : le filtre du faux client est alors ignoré.
  sansFiltre: false,
  demandes: [] as { table: string; colonnes: string; dossier: unknown; tri: string[]; filtres: string[] }[],
  rpcs: [] as { nom: string; args: unknown }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatNot } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, args: unknown) => {
        faux.rpcs.push({ nom, args })
        return Promise.resolve({ data: faux.plan.data, error: faux.plan.error })
      },
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const demande = { table, colonnes: '', dossier: null as unknown, tri: [] as string[], filtres: [] as string[] }
        faux.demandes.push(demande)
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let un = false
        const tris: string[] = []
        const c: Record<string, unknown> = {}
        const executer = () => {
          if (faux.mode === 'leve') return Promise.reject(new Error('réseau coupé'))
          if (faux.mode === 'refus' && table === 'provisions') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null })
          if (faux.mode === 'ouverture-refusee' && table === 'a_nouveaux') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null })
          // Le tri demandé s'applique, colonne après colonne : le faux client ne rend pas l'ordre de sa table.
          const toutes = filtrer(faux.tables[table] ?? [], faux.sansFiltre ? [] : predicats).sort((a, b) => {
            for (const t of tris) { const x = String(a[t]); const y = String(b[t]); if (x !== y) return x < y ? -1 : 1 }
            return 0
          })
          const jusqua = faux.mode === 'muet' && table === 'inventaires_declares' ? Math.min(fin + 1, 1) : fin + 1
          if (un) return Promise.resolve({ data: toutes[0] ?? null, error: null })
          return Promise.resolve({ data: toutes.slice(debut, jusqua), error: null, count: toutes.length })
        }
        Object.assign(c, {
          select: (colonnes: string) => { demande.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { if (colonne === 'dossier_id') demande.dossier = valeur; predicats.push(predicatEq(colonne, valeur)); return c },
          not: (colonne: string, operateur: string, valeur: unknown) => { demande.filtres.push(`not ${colonne} ${operateur}`); predicats.push(predicatNot(colonne, operateur, valeur)); return c },
          order: (colonne: string) => { demande.tri.push(colonne); tris.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          limit: () => c,
          maybeSingle: () => { un = true; return executer() },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => executer().then(suite, echec),
        })
        return c
      },
    },
  }
})

const operation = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486100', montant_centimes: 60000,
  tva_centimes: 0, periode_debut: null, periode_fin: null, objet: 'Assurance', piece_citee_id: null, provision_id: null, version: 1,
  cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...o,
})
const provision = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, genre: 'risque', compte_provision: '151110', objet: 'Litige', facture_id: null, piece_citee_id: null, ouverte_en: 2025,
  reprise_centimes: null, version: 1, cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...o,
})
const declaration = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, exercice: 2025, declare_par: 'u', declare_le: '2026-11-11T10:00:00Z', retire_par: null, retire_le: null, ...o,
})
const ecriture = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, date: '2025-12-31', compte: '486100', sens: 'debit', montant: 600, operation_inventaire_id: 'o1', ...o,
})

beforeEach(() => {
  faux.mode = 'entier'
  faux.sansFiltre = false
  faux.demandes = []
  faux.rpcs = []
  faux.plan = {
    data: [
      { role: 'banque', compte: '512000', libelle: 'Banque', prefixe_auxiliaire: null },
      { role: 'charges_constatees_avance', compte: '486100', libelle: null, prefixe_auxiliaire: null },
      { role: 'provisions_risques', compte: '151110', libelle: null, prefixe_auxiliaire: null },
    ],
    error: null,
  }
  faux.tables = {
    operations_inventaire: [operation('o1', 'd1'), operation('o2', 'd2')],
    provisions: [provision('p1', 'd1'), provision('p2', 'd2')],
    inventaires_declares: [declaration('i1', 'd1'), declaration('i1b', 'd1', { exercice: 2024 }), declaration('i2', 'd2')],
    ecritures_brouillon: [ecriture('e1', 'd1'), ecriture('e2', 'd1', { operation_inventaire_id: null }), ecriture('e3', 'd2')],
    a_nouveaux: [{ id: 'a2', dossier_id: 'd1', date: '2025-01-01' }, { id: 'a1', dossier_id: 'd1', date: '2024-01-01' }, { id: 'a3', dossier_id: 'd2', date: '2020-01-01' }],
  }
})

describe('lireLInventaireDuDossier', () => {
  it('drapeau baissé : « absente », aucun appel au réseau', async () => {
    expect(INVENTAIRE_EXPORTE).toBe(false)
    expect(await lireLInventaireDuDossier('d1')).toEqual({ dossierId: 'd1', etat: 'absente' })
    expect(await lireLInventaireDuDossierSelon('d1', false)).toEqual({ dossierId: 'd1', etat: 'absente' })
    expect(faux.demandes).toEqual([])
    expect(faux.rpcs).toEqual([])
  })

  it('levé : les collections de CE dossier, lues en entier, leurs colonnes nommées, un tri total terminé par la clé primaire', async () => {
    const lue = await lireLInventaireDuDossierSelon('d1', true)
    if (lue.etat !== 'lue') throw new Error(JSON.stringify(lue))
    expect(lue.donnees.operations.map((o) => o.id)).toEqual(['o1'])
    expect(lue.donnees.provisions.map((p) => p.id)).toEqual(['p1'])
    expect(lue.donnees.declarations.map((d) => d.id)).toEqual(['i1b', 'i1'])
    // Seules les lignes que des régularisations citent, celles de ce dossier.
    expect(lue.donnees.lignes.map((l) => l.operation_inventaire_id)).toEqual(['o1'])
    expect(lue.donnees.premierExercice).toBe(2024)
    const lectures = faux.demandes.filter((d) => d.table !== 'a_nouveaux')
    expect(lectures.map((d) => [d.table, d.dossier, d.tri.at(-1)])).toEqual([
      ['operations_inventaire', 'd1', 'id'], ['provisions', 'd1', 'id'], ['inventaires_declares', 'd1', 'id'], ['ecritures_brouillon', 'd1', 'id'],
    ])
    expect(lectures.every((d) => !d.colonnes.includes('*'))).toBe(true)
    expect(lectures.map((d) => d.colonnes)).toEqual([COLONNES_DES_OPERATIONS, COLONNES_DES_PROVISIONS, COLONNES_DES_DECLARATIONS, COLONNES_DES_ECRITURES])
    expect(lectures[3].filtres).toEqual(['not operation_inventaire_id is'])
    expect(faux.rpcs).toEqual([{ nom: 'plan_du_dossier', args: { p_dossier_id: 'd1' } }])
  })

  it('les comptes des douze rôles seulement, tels que le plan les rend ; un rôle absent manque, sans faire échouer la lecture', async () => {
    const lue = await lireLInventaireDuDossierSelon('d1', true)
    if (lue.etat !== 'lue') throw new Error('lecture attendue')
    expect(lue.donnees.comptes).toEqual({ charges_constatees_avance: '486100', provisions_risques: '151110' })
  })

  it('sans à-nouveaux, aucun premier exercice : aucune borne basse', async () => {
    faux.tables.a_nouveaux = []
    const lue = await lireLInventaireDuDossierSelon('d1', true)
    if (lue.etat !== 'lue') throw new Error('lecture attendue')
    expect(lue.donnees.premierExercice).toBeNull()
  })

  it('en partie, refusée, ou qui lève : un motif, jamais un inventaire vide', async () => {
    faux.mode = 'muet'
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('les déclarations') })
    faux.mode = 'refus'
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('les provisions') })
    faux.mode = 'leve'
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.mode = 'ouverture-refusee'
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('l’ouverture du dossier') })
  })

  it('un plan refusé ou illisible se dit : l’écran ne proposerait aucun compte', async () => {
    faux.plan = { data: null, error: { message: 'accès refusé' } }
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('le plan du dossier') })
    faux.plan = { data: { role: 'banque' }, error: null }
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: 'le plan du dossier : réponse illisible' })
    faux.plan = { data: [{ role: 'banque' }], error: null }
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: 'le plan du dossier : réponse illisible' })
  })

  it('une ligne rendue qui n’est pas de ce dossier, ou qu’on ne croirait pas, rend la lecture incomplète', async () => {
    faux.sansFiltre = true
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('une ligne rendue n’est pas de ce dossier') })
    faux.sansFiltre = false
    faux.tables.operations_inventaire = [operation('o1', 'd1', { montant_centimes: 12.5 })]
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: 'une ligne de l’inventaire lue ne se croit pas' })
    faux.tables.operations_inventaire = [operation('o1', 'd1', { nature: 'stock' })]
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.tables.operations_inventaire = [operation('o1', 'd1')]
    faux.tables.provisions = [provision('p1', 'd1', { genre: 'autre' })]
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.tables.provisions = [provision('p1', 'd1')]
    faux.tables.inventaires_declares = [declaration('i1', 'd1', { exercice: '2025' })]
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.tables.inventaires_declares = [declaration('i1', 'd1')]
    faux.tables.ecritures_brouillon = [ecriture('e1', 'd1', { sens: 'autre' })]
    expect(await lireLInventaireDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
  })
})

describe('le drapeau de l’écran et celui de la base', () => {
  it('l’onglet ne se lève qu’avec les migrations : INVENTAIRE_EXPORTE implique INVENTAIRE_PREVU', () => {
    expect(!INVENTAIRE_EXPORTE || INVENTAIRE_PREVU).toBe(true)
  })
})
