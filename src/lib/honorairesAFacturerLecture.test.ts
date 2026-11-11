import { beforeEach, describe, expect, it, vi } from 'vitest'

// « À FACTURER », LU ET ÉCRIT (ligne 47, LM7), devant un faux client : le clic n'appelle que `facturer_honoraires`, avec les
// seuls éléments, le taux et aucune clé de facture ; un refus se dit aux mots de la base ; une réponse sans identifiant ne
// se croit pas. Les quatre lectures se font en entier, chacune triée jusqu'à sa clé ; une seule partielle rend la lecture
// illisible ; seuls les avoirs repris qui citent une facture sont retenus. Données FICTIVES.

const faux = vi.hoisted(() => ({
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  reponse: { data: 'f-neuve' as unknown, error: null as { message: string } | null },
  tables: {} as Record<string, { data: unknown[]; count: number | null; error: { message: string } | null }>,
  tris: {} as Record<string, string[]>,
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      faux.tris[table] = []
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine, eq: () => chaine, neq: () => chaine, range: () => chaine,
        order: (colonne: string) => { faux.tris[table].push(colonne); return chaine },
        then: (suite: (r: unknown) => unknown) => {
          const t = faux.tables[table] ?? { data: [], count: 0, error: null }
          return Promise.resolve({ data: t.error ? null : t.data, error: t.error, count: t.count }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      return Promise.resolve(faux.reponse)
    },
  },
}))

const { facturerLesHonoraires, lireLesHonorairesAFacturer } = await import('./honorairesAFacturerLecture')

const K = 'k0000000-0000-4000-8000-00000000000a'
const element = { lettre_id: 'l1', ligne: 1, periode_debut: '2026-08-01', periode_fin: '2026-08-31' }

beforeEach(() => {
  faux.rpcs = []; faux.reponse = { data: 'f-neuve', error: null }; faux.tables = {}; faux.tris = {}
})

describe('le clic « Facturer »', () => {
  it('appelle la fonction seule, avec les éléments, le taux et aucune clé de facture, et rend le brouillon', async () => {
    const issue = await facturerLesHonoraires(K, [{ ...element, designation: 'ignorée' } as typeof element], 20)
    expect(issue).toEqual({ ok: true, factureId: 'f-neuve' })
    expect(faux.rpcs).toEqual([{ nom: 'facturer_honoraires', args: { p_dossier_id: K, p_elements: [element], p_taux_tva: 20, p_facture: null } }])
  })

  it('un refus se dit aux mots de la base ; une réponse sans identifiant ne se croit pas', async () => {
    faux.reponse = { data: null, error: { message: 'Cette période est déjà facturée : une facture qui n’est pas créditée en entier la couvre.' } }
    expect(await facturerLesHonoraires(K, [element], 20))
      .toEqual({ ok: false, message: 'Cette période est déjà facturée : une facture qui n’est pas créditée en entier la couvre.' })
    faux.reponse = { data: null, error: null }
    expect((await facturerLesHonoraires(K, [element], 20)).ok).toBe(false)
  })
})

describe('les lectures', () => {
  it('lues en entier : les quatre listes, triées jusqu’à leur clé, les avoirs repris qui citent une facture seuls', async () => {
    faux.tables.factures_importees = { data: [{ facture_id: 'a1', origine_id: 'f1' }, { facture_id: 'r2', origine_id: null }], count: 2, error: null }
    faux.tables.dossiers = { data: [{ id: 'c', nom: 'Client fictif' }], count: 1, error: null }
    const lu = await lireLesHonorairesAFacturer(K, 'cab')
    expect(lu).toMatchObject({ etat: 'lue', avoirsRepris: [{ facture_id: 'a1', origine_id: 'f1' }], dossiers: [{ id: 'c', nom: 'Client fictif' }] })
    expect(faux.tris).toEqual({
      lettres_de_mission: ['cree_le', 'id'], honoraires_factures: ['cree_le', 'id'], factures_importees: ['facture_id'], dossiers: ['nom', 'id'],
    })
  })

  it('une seule lecture partielle ou refusée rend la lecture illisible', async () => {
    faux.tables.honoraires_factures = { data: [], count: 3, error: null }
    expect(await lireLesHonorairesAFacturer(K, 'cab')).toMatchObject({ etat: 'illisible', dossierId: K })
    faux.tables.honoraires_factures = { data: [], count: null, error: { message: 'Accès refusé.' } }
    expect(await lireLesHonorairesAFacturer(K, 'cab')).toMatchObject({ etat: 'illisible' })
  })
})
