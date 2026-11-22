import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ECRITURES_LIBRES_PREVUES } from './ecritureLibre'
import { lireLesEcrituresLibres, lireLesEcrituresLibresSelon } from './ecrituresLibresLecture'
import { ecrituresLibresPourLesMoteurs } from './ecrituresLibresVue'

// LA LECTURE DES ÉCRITURES LIBRES (EL5). Drapeau baissé : AUCUN appel au réseau, l'absence. Levé : la table et SON dossier, le
// compte annoncé, un tri total terminé par la clé primaire, la lecture jusqu'au bout ; lue en partie, refusée ou levée, une ligne
// d'une autre forme : `illisibles`, jamais une liste vide ; les adresses des auteurs sous la session, leur échec ne retenant rien.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][] }[],
  refus: {} as Record<string, string>,
  leve: false,
  muetApres: Infinity,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const requete = { table, colonnes: '', options: undefined as unknown, ordres: [] as string[], filtres: [] as [string, unknown][] }
        faux.requetes.push(requete)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        const repondre = () => {
          if (faux.leve) return Promise.reject(new Error('réseau coupé'))
          if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null })
          const toutes = filtrer(faux.tables[table] ?? [], predicats)
          return Promise.resolve({ data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length })
        }
        Object.assign(c, {
          select: (colonnes: string, options: unknown) => { requete.colonnes = colonnes; requete.options = options; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          in: (colonne: string, valeurs: unknown[]) => { requete.filtres.push([colonne, valeurs]); predicats.push((l) => valeurs.includes(l[colonne])); return c },
          order: (colonne: string) => { requete.ordres.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre().then(suite, echec),
        })
        return c
      },
    },
  }
})

const ligne = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'e1', dossier_id: 'd1', exercice: 2025, numero: 1, date: '2025-06-30', libelle: 'Part privée', motif: 'Usage mixte',
  lignes: [
    { compte: '108000', sens: 'debit', centimes: 12000, poste_2035: null, compte_lib: null },
    { compte: '606100', sens: 'credit', centimes: 12000, poste_2035: 'Achats', compte_lib: null },
  ],
  avec_extourne: false, piece_citee_id: null, version: 1, cree_par: 'u1', cree_le: '2025-07-01T10:00:00Z', modifie_par: null,
  modifie_le: null, ...o,
})

beforeEach(() => {
  faux.tables = { ecritures_libres: [ligne(), ligne({ id: 'e9', dossier_id: 'd2' })], cabinet_admins: [{ user_id: 'u1', email: 'expert@exemple.fr' }] }
  faux.requetes = []
  faux.refus = {}
  faux.leve = false
  faux.muetApres = Infinity
})

describe('lireLesEcrituresLibres', () => {
  it('le drapeau baissé : l’absence, sans aucune requête', async () => {
    expect(await lireLesEcrituresLibresSelon('d1', false)).toEqual({ dossierId: 'd1', etat: 'absentes' })
    expect(faux.requetes).toEqual([])
  })

  // L'état du dépôt : la lecture suit le drapeau, qui suit la migration rangée dans l'export (ecritureLibre.test.ts) ; joué
  // ainsi, le test passe la migration préparée comme rangée, sans supposer l'un des deux états.
  it('l’état du dépôt : la lecture suit le drapeau, rien de lu tant qu’il est baissé', async () => {
    const attendu = await lireLesEcrituresLibresSelon('d1', ECRITURES_LIBRES_PREVUES)
    faux.requetes = []
    expect(await lireLesEcrituresLibres('d1')).toEqual(attendu)
    expect(faux.requetes.length > 0).toBe(ECRITURES_LIBRES_PREVUES)
  })

  it('levé : les écritures de SON dossier, en entier, puis les adresses de leurs auteurs', async () => {
    const lu = await lireLesEcrituresLibresSelon('d1', true)
    expect(lu.etat).toBe('lues')
    if (lu.etat !== 'lues') return
    expect(lu.ecritures.map((e) => e.id)).toEqual(['e1'])
    expect(lu.ecritures[0].motif).toBe('Usage mixte')
    expect(lu.auteurs.get('u1')).toBe('expert@exemple.fr')
    const [table, equipe] = faux.requetes
    expect(table).toMatchObject({ table: 'ecritures_libres', options: { count: 'exact' }, filtres: [['dossier_id', 'd1']] })
    expect(table.ordres.at(-1)).toBe('id')
    expect(equipe).toMatchObject({ table: 'cabinet_admins', filtres: [['user_id', ['u1']]] })
    // Les moteurs la reçoivent sans le motif.
    const pourLesMoteurs = ecrituresLibresPourLesMoteurs(lu, 'd1', true)
    expect(pourLesMoteurs?.etat === 'lues' && 'motif' in pourLesMoteurs.ecritures[0]).toBe(false)
  })

  it('lue en partie, refusée, levée, ou d’une autre forme : illisible, jamais vide', async () => {
    faux.muetApres = 0
    expect((await lireLesEcrituresLibresSelon('d1', true)).etat).toBe('illisibles')
    faux.muetApres = Infinity
    faux.refus = { ecritures_libres: 'permission denied' }
    expect(await lireLesEcrituresLibresSelon('d1', true)).toMatchObject({ etat: 'illisibles' })
    faux.refus = {}
    faux.leve = true
    expect(await lireLesEcrituresLibresSelon('d1', true)).toMatchObject({ etat: 'illisibles' })
    faux.leve = false
    faux.tables.ecritures_libres = [ligne({ lignes: [{ compte: '606100', sens: 'debit', centimes: 1.5 }] })]
    expect(await lireLesEcrituresLibresSelon('d1', true)).toMatchObject({ etat: 'illisibles' })
    expect(ecrituresLibresPourLesMoteurs({ dossierId: 'd1', etat: 'illisibles', motif: 'x' }, 'd1', true)).toBeNull()
  })

  it('les adresses refusées ne retiennent rien : « le cabinet », et leur motif', async () => {
    faux.refus = { cabinet_admins: 'permission denied' }
    const lu = await lireLesEcrituresLibresSelon('d1', true)
    expect(lu).toMatchObject({ etat: 'lues' })
    if (lu.etat === 'lues') {
      expect(lu.auteurs.size).toBe(0)
      expect(lu.motifDesAuteurs).toContain('l’équipe')
    }
  })
})
