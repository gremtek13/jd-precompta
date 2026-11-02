import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JourDeLaCaisseDuClient, OperationDuClient } from './caisseClient'

// CE QUE « MA CAISSE » LIT (ligne 26.6, étape C12a) : la case relue à la base avant tout, le dossier, la nature, les
// opérations en entier, et la caisse jour par jour de l'année affichée ET des suivantes. Ce que ces cas gardent : rien n'est
// rendu sans la case ; une lecture partielle, refusée, illisible ou d'une autre société se dit, jamais une liste vide ; la
// lecture ne rejette jamais. Le faux client APPLIQUE les filtres. Données FICTIVES.

const faux = vi.hoisted(() => ({
  droits: { caisse: true } as unknown,
  refusDroits: null as string | null,
  dossier: null as Record<string, unknown> | null,
  refusDossier: null as string | null,
  categories: [] as Record<string, unknown>[],
  refusCategorie: null as string | null,
  operations: [] as Record<string, unknown>[],
  // Une collection dont la lecture s'arrête après N lignes, son compte annoncé entier.
  muetApres: {} as Record<string, number>,
  jours: {} as Record<number, Record<string, unknown>[]>,
  refusJours: null as string | null,
  appels: [] as string[],
  lever: false,
  // Une base qui rend des lignes hors du filtre : ce que la garde du dossier attrape.
  ignorerFiltres: false,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  function chaine(lignes: () => Record<string, unknown>[], nom: string, refus: () => string | null) {
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const reponse = () => {
      const toutes = faux.ignorerFiltres ? lignes() : filtrer(lignes(), predicats)
      const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[nom] ?? Infinity))
      return refus() ? { data: null, error: { message: refus() }, count: null } : { data: rendu, error: null, count: toutes.length }
    }
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: async () => {
        const r = reponse()
        return r.error ? r : { data: r.data?.[0] ?? null, error: null }
      },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(reponse).then(suite, echec),
    }
    return c
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appels.push(`${nom} ${JSON.stringify(args)}`)
        if (nom === 'droits_sur_le_dossier') {
          return Promise.resolve(faux.refusDroits ? { data: null, error: { message: faux.refusDroits } } : { data: faux.droits, error: null })
        }
        if (nom === 'caisse_du_client') return chaine(() => faux.jours[args.p_annee as number] ?? [], 'jours', () => faux.refusJours)
        throw new Error(`fonction inattendue : ${nom}`)
      },
      from: (table: string) => {
        if (faux.lever) throw new Error('le client a levé')
        faux.appels.push(table)
        if (table === 'dossiers') return chaine(() => (faux.dossier ? [faux.dossier] : []), table, () => faux.refusDossier)
        if (table === 'categories') return chaine(() => faux.categories, table, () => faux.refusCategorie)
        if (table === 'operations_caisse') return chaine(() => faux.operations, table, () => null)
        throw new Error(`table inattendue : ${table}`)
      },
    },
  }
})

const { lireLaCaisseDuClient, lireLeDroitCaisse } = await import('./caisseClientLecture')

const op = (o: Partial<OperationDuClient>): Record<string, unknown> => ({
  id: 'o1', dossier_id: 'd1', genre: 'recette', date: '2026-03-12', montant: 100, categorie_id: 'n1', taux_tva: null,
  encaissements_du_jour: [], piece_id: null, origine: 'client', remplace_id: null, cree_le: '2026-03-12T18:00:00Z', cree_par: 'u1',
  retire_le: null, ...o,
})
const jour = (o: Partial<JourDeLaCaisseDuClient>): Record<string, unknown> => ({
  jour: '2026-03-12', report: 0, ouverture: 0, operations: 100, releve: 0, especes_des_factures: 0, encaissements_du_jour: [],
  solde: 100, fige: false, ...o,
})

beforeEach(() => {
  faux.droits = { cabinet: false, membre: true, ventes: false, banque: false, caisse: true }
  faux.refusDroits = null
  faux.dossier = { id: 'd1', statut_tva: 'exonere', mode_comptable: 'tresorerie', assujetti_tva: false, categorie_recettes_client: 'n1' }
  faux.refusDossier = null
  faux.categories = [{ id: 'n1', dossier_id: null, compte_comptable: '706000' }, { id: 'n2', dossier_id: null, compte_comptable: '706000' }]
  faux.refusCategorie = null
  faux.operations = [op({}), op({ id: 'o-autre', dossier_id: 'd2' })]
  faux.muetApres = {}
  faux.jours = { 2025: [jour({ jour: '2025-06-01', operations: 0, ouverture: 10, solde: 10 })], 2026: [jour({})] }
  faux.refusJours = null
  faux.appels = []
  faux.lever = false
  faux.ignorerFiltres = false
})

describe('la case, relue à la base', () => {
  it('rend la caisse avec la case, et rien sans elle', async () => {
    const l = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(l).toMatchObject({ dossierId: 'd1', annee: 2026, etat: 'lue' })
    faux.droits = { ...faux.droits as object, caisse: false }
    expect(await lireLaCaisseDuClient('d1', 2026, 2026)).toEqual({ dossierId: 'd1', annee: 2026, etat: 'sans_caisse' })
  })

  it('tombe du côté fermé sur un refus, une réponse d’une autre forme, une requête qui lève', async () => {
    expect(await lireLeDroitCaisse(Promise.resolve({ data: { caisse: 'oui' }, error: null }))).toEqual({ caisse: false, motif: null })
    expect(await lireLeDroitCaisse(Promise.resolve({ data: [], error: null }))).toEqual({ caisse: null, motif: 'droits illisibles' })
    expect(await lireLeDroitCaisse(Promise.reject(new Error('rompue')))).toEqual({ caisse: null, motif: 'rompue' })
    faux.refusDroits = 'refusé'
    expect(await lireLaCaisseDuClient('d1', 2026, 2026)).toMatchObject({ etat: 'echec', motif: 'ton accès à ta caisse n’a pas pu être vérifié (refusé)' })
  })
})

describe('ce qui se lit', () => {
  it('lit le dossier, la nature, les opérations du dossier, et les jours de l’année et des suivantes', async () => {
    faux.operations = [op({})]
    const l = await lireLaCaisseDuClient('d1', 2025, 2026)
    if (l.etat !== 'lue') throw new Error(l.etat)
    expect(l.dossier.categorie_recettes_client).toBe('n1')
    expect(l.nature).toEqual({ etat: 'lue', categorie: { id: 'n1', dossier_id: null, compte_comptable: '706000' } })
    expect(l.operations).toMatchObject({ complete: true, lignes: [{ id: 'o1' }] })
    expect(l.jours.complete).toBe(true)
    expect(l.jours.lignes.map((j) => j.jour)).toEqual(['2025-06-01', '2026-03-12'])
    expect(faux.appels.filter((a) => a.startsWith('caisse_du_client'))).toEqual([
      'caisse_du_client {"p_dossier_id":"d1","p_annee":2025}', 'caisse_du_client {"p_dossier_id":"d1","p_annee":2026}',
    ])
  })

  it('ne lit aucune nature quand le cabinet n’en a fixé aucune, et dit une nature illisible', async () => {
    faux.dossier = { ...faux.dossier!, categorie_recettes_client: null }
    const sans = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(sans.etat === 'lue' && sans.nature).toEqual({ etat: 'lue', categorie: null })
    expect(faux.appels).not.toContain('categories')
    faux.dossier = { ...faux.dossier!, categorie_recettes_client: 'n1' }
    faux.refusCategorie = 'refusée'
    const illisible = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(illisible.etat === 'lue' && illisible.nature).toEqual({ etat: 'illisible', motif: 'refusée' })
  })
})

describe('une lecture qui manque se dit, jamais une liste vide', () => {
  it('les opérations lues en partie, ou d’une autre société', async () => {
    faux.operations = [op({}), op({ id: 'o2' })]
    faux.muetApres = { operations_caisse: 1 }
    const partielle = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(partielle.etat === 'lue' && partielle.operations.complete).toBe(false)
    faux.muetApres = {}
    faux.operations = [op({}), op({ id: 'o-autre', dossier_id: 'd2' })]
    faux.ignorerFiltres = true
    faux.categories = [{ id: 'n1', dossier_id: null, compte_comptable: '706000' }]
    const etrangere = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(etrangere.etat === 'lue' && etrangere.operations).toEqual({ lignes: [], complete: false, motif: 'une opération rendue n’est pas de ta société' })
  })

  it('les jours lus en partie, refusés, ou illisibles', async () => {
    faux.operations = [op({})]
    faux.jours = { 2026: [jour({}), jour({ jour: '2026-03-13' })] }
    faux.muetApres = { jours: 1 }
    const partielle = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(partielle.etat === 'lue' && partielle.jours.complete).toBe(false)
    faux.muetApres = {}
    faux.refusJours = 'Accès refusé à ce dossier.'
    const refusee = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(refusee.etat === 'lue' && refusee.jours).toMatchObject({ lignes: [], complete: false })
    expect(refusee.etat === 'lue' && refusee.jours.motif).toContain('Accès refusé à ce dossier.')
    faux.refusJours = null
    faux.jours = { 2026: [jour({ solde: 'beaucoup' as unknown as number })] }
    const illisible = await lireLaCaisseDuClient('d1', 2026, 2026)
    expect(illisible.etat === 'lue' && illisible.jours.complete).toBe(false)
    expect(illisible.etat === 'lue' && illisible.jours.motif).toContain('une ligne de ta caisse est illisible')
    // Une année suivante qui manque rend toute la lecture des jours incomplète.
    faux.jours = { 2025: [jour({ jour: '2025-06-01' })], 2026: [jour({}), jour({ jour: '2026-03-13' })] }
    faux.muetApres = { jours: 1 }
    const suivante = await lireLaCaisseDuClient('d1', 2025, 2026)
    expect(suivante.etat === 'lue' && suivante.jours).toMatchObject({ lignes: [], complete: false })
  })

  it('le dossier refusé ou absent, et une requête qui lève : un échec, jamais un rejet', async () => {
    faux.refusDossier = 'refusé'
    expect(await lireLaCaisseDuClient('d1', 2026, 2026)).toMatchObject({ etat: 'echec', motif: 'refusé' })
    faux.refusDossier = null
    faux.dossier = null
    expect(await lireLaCaisseDuClient('d1', 2026, 2026)).toMatchObject({ etat: 'echec', motif: 'ta société n’a pas pu être lue' })
    faux.lever = true
    await expect(lireLaCaisseDuClient('d1', 2026, 2026)).resolves.toMatchObject({ etat: 'echec', motif: 'le client a levé' })
  })
})
