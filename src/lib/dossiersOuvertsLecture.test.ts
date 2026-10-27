import { beforeEach, describe, expect, it, vi } from 'vitest'
import { garderLesDossiersOuverts, lireLesAccesDuCompte, lireLOuverture } from './dossiersOuvertsLecture'

// LES LECTURES DE LA LISTE D'UN MEMBRE DE L'ÉQUIPE (23Q2Q2Q1-Q1) : ses accès client, lus EN ENTIER et filtrés sur lui — un chef lit
// aussi ceux des clients de ses dossiers —, et l'ouverture d'un dossier par `admin_du_dossier`, un booléen ou rien. Aucune ne
// rejette : un refus, une réponse illisible ou une requête qui lève rendent une lecture ratée, avec son motif. Le faux client
// APPLIQUE le filtre et la tranche demandée, et annonce le total. Données FICTIVES.
const faux = vi.hoisted(() => ({
  acces: [] as Record<string, unknown>[],
  // Un serveur qui CESSE de rendre des lignes au-delà de N tout en annonçant le vrai total : une lecture incomplète.
  muetApres: null as number | null,
  erreurAcces: null as { message: string } | null,
  leveAcces: null as unknown,
  requetes: [] as string[],
  ouvertures: {} as Record<string, unknown>,
  erreursOuverture: {} as Record<string, { message: string }>,
  leveOuverture: null as unknown,
  appels: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leveAcces) throw faux.leveAcces
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const etapes: string[] = [table]
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string, options?: { count?: string }) => { etapes.push(`select ${colonnes} ${options?.count ?? ''}`.trim()); return c },
          eq: (colonne: string, valeur: unknown) => { etapes.push(`eq ${colonne}`); predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { etapes.push(`order ${colonne}`); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            faux.requetes.push(etapes.join(' · '))
            if (faux.erreurAcces) return Promise.resolve({ data: null, error: faux.erreurAcces, count: null }).then(suite)
            const lignes = filtrer(faux.acces, predicats)
            const servies = faux.muetApres === null ? lignes : lignes.slice(0, faux.muetApres)
            return Promise.resolve({ data: servies.slice(debut, fin + 1), error: null, count: lignes.length }).then(suite)
          },
        })
        return c
      },
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appels.push(`${nom} ${JSON.stringify(args)}`)
        if (faux.leveOuverture) throw faux.leveOuverture
        const id = String(args.p_dossier_id)
        if (faux.erreursOuverture[id]) return Promise.resolve({ data: null, error: faux.erreursOuverture[id] })
        return Promise.resolve({ data: faux.ouvertures[id], error: null })
      },
    },
  }
})

beforeEach(() => {
  faux.acces = [
    { id: 'm1', user_id: 'u-equipe', dossier_id: 'd1' },
    { id: 'm2', user_id: 'u-client', dossier_id: 'd2' },
    { id: 'm3', user_id: 'u-equipe', dossier_id: 'd3' },
  ]
  faux.muetApres = null
  faux.erreurAcces = null
  faux.leveAcces = null
  faux.requetes = []
  faux.ouvertures = {}
  faux.erreursOuverture = {}
  faux.leveOuverture = null
  faux.appels = []
})

describe('lireLesAccesDuCompte', () => {
  it('lit les accès du compte seul, en entier, triés par la clé', async () => {
    const lu = await lireLesAccesDuCompte('u-equipe')
    expect(lu).toEqual({ dossiers: new Set(['d1', 'd3']) })
    expect(faux.requetes).toEqual(['memberships · select dossier_id exact · eq user_id · order id'])
  })

  it('aucun accès : un ensemble vide, qui est une affirmation', async () => {
    expect(await lireLesAccesDuCompte('u-sans-acces')).toEqual({ dossiers: new Set() })
  })

  it('lus en partie : illisibles, jamais un ensemble plus court', async () => {
    faux.muetApres = 1
    expect(await lireLesAccesDuCompte('u-equipe')).toEqual({ illisibles: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
  })

  it('un refus : illisibles, avec le message de la base', async () => {
    faux.erreurAcces = { message: 'permission denied for table memberships' }
    expect(await lireLesAccesDuCompte('u-equipe'))
      .toEqual({ illisibles: 'lecture interrompue après 0 ligne(s) : permission denied for table memberships' })
  })

  it('une requête qui lève tombe du même côté, sans rejeter', async () => {
    faux.leveAcces = new Error('Failed to fetch')
    expect(await lireLesAccesDuCompte('u-equipe')).toEqual({ illisibles: 'Failed to fetch' })
  })
})

describe('lireLOuverture', () => {
  it('demande admin_du_dossier pour ce dossier, et lit le booléen', async () => {
    faux.ouvertures = { d1: true, d3: false }
    expect(await lireLOuverture('d1')).toEqual({ ouvert: true })
    expect(await lireLOuverture('d3')).toEqual({ ouvert: false })
    expect(faux.appels).toEqual(['admin_du_dossier {"p_dossier_id":"d1"}', 'admin_du_dossier {"p_dossier_id":"d3"}'])
  })

  it('une réponse qui n’est pas un booléen est illisible, jamais « fermé » ni « ouvert »', async () => {
    for (const valeur of [null, undefined, 'true', 1, [true], {}]) {
      faux.ouvertures = { d1: valeur }
      expect(await lireLOuverture('d1')).toEqual({ illisible: 'réponse illisible de la base' })
    }
  })

  it('un refus se dit par son message', async () => {
    faux.erreursOuverture = { d1: { message: 'canceling statement due to statement timeout' } }
    expect(await lireLOuverture('d1')).toEqual({ illisible: 'canceling statement due to statement timeout' })
  })

  it('un refus sans message prend le repli', async () => {
    faux.erreursOuverture = { d1: { message: '' } }
    expect(await lireLOuverture('d1')).toEqual({ illisible: 'refus de la base' })
  })

  it('une requête qui lève tombe du même côté, sans rejeter', async () => {
    faux.leveOuverture = new Error('Failed to fetch')
    expect(await lireLOuverture('d1')).toEqual({ illisible: 'Failed to fetch' })
  })
})

describe('garderLesDossiersOuverts', () => {
  const dossiers = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }, { id: 'd4' }]

  it('ne demande que l’ouverture des dossiers où le compte a un accès client, et garde ceux que le cabinet lui ouvre', async () => {
    faux.ouvertures = { d1: true, d3: false }
    const r = await garderLesDossiersOuverts(dossiers, { dossiers: new Set(['d1', 'd3']) })
    expect(r).toEqual({ dossiers: [{ id: 'd1' }, { id: 'd2' }, { id: 'd4' }], motif: null })
    expect(faux.appels).toEqual(['admin_du_dossier {"p_dossier_id":"d1"}', 'admin_du_dossier {"p_dossier_id":"d3"}'])
  })

  it('une ouverture illisible : ce dossier manque, et le motif le dit', async () => {
    faux.ouvertures = { d1: true }
    faux.erreursOuverture = { d3: { message: 'refus simulé' } }
    const r = await garderLesDossiersOuverts(dossiers, { dossiers: new Set(['d1', 'd3']) })
    expect(r.dossiers).toEqual([{ id: 'd1' }, { id: 'd2' }, { id: 'd4' }])
    expect(r.motif).toMatch(/l’ouverture d’un dossier à ce compte n’a pas pu être vérifiée \(refus simulé\)/)
  })

  it('des accès illisibles : rien de demandé, aucun dossier, le motif le dit', async () => {
    const r = await garderLesDossiersOuverts(dossiers, { illisibles: 'refus simulé' })
    expect(r.dossiers).toEqual([])
    expect(r.motif).toMatch(/les accès client de ce compte n’ont pas pu être lus en entier \(refus simulé\)/)
    expect(faux.appels).toEqual([])
  })
})
