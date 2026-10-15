import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesContacts } from './contactsLecture'
import { contact } from '../test/contacts'

// LA LECTURE DES CONTACTS (espace client, étape A4b1). Ce que ces cas gardent : la table et le filtre de SON dossier (jamais
// ceux d'un autre) ; toutes les colonnes, retirés ET effacés compris (la liste lue en entier est celle qui juge l'unicité d'un
// SIRET : c'est l'écran qui ne montre pas un effacé, jamais la lecture) ; un tri total terminé par la clé primaire ; le compte
// annoncé, donc la lecture jusqu'au bout et `complete` faux dès qu'il en manque ; une requête qui lève rejette (jamais une
// liste vide).

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  muetApres: Infinity,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][] }[],
  leve: false,
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
        Object.assign(c, {
          select: (colonnes: string, options: unknown) => { requete.colonnes = colonnes; requete.options = options; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { requete.ordres.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.leve) return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            const toutes = filtrer(faux.lignes, predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.lignes = [
    contact({ id: 'c1' }),
    contact({ id: 'c2', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x' }),
    contact({ id: 'c3', efface_le: '2027-10-06T08:00:00Z', efface_par: 'u-x', nom: 'Contact effacé le 06/10/2027', type_client: null, adresse: null, siren: null, siret: null, delai_paiement_jours: null }),
    contact({ id: 'c4', dossier_id: 'd2' }),
  ].map((c) => ({ ...c }))
  faux.muetApres = Infinity
  faux.requetes = []
  faux.leve = false
})

describe('lireLesContacts', () => {
  it('les contacts de SON dossier, retirés et effacés compris, lus en entier', async () => {
    const lu = await lireLesContacts('d1')
    expect(lu.lignes.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(lu).toMatchObject({ complete: true, motif: null })
  })

  it('toutes les colonnes, le compte annoncé, le filtre du dossier, un tri terminé par la clé primaire', async () => {
    await lireLesContacts('d1')
    const [r] = faux.requetes
    expect(r.table).toBe('contacts')
    expect(r.colonnes).toBe('*')
    expect(r.options).toEqual({ count: 'exact' })
    expect(r.filtres).toEqual([['dossier_id', 'd1']])
    expect(r.ordres.at(-1)).toBe('id')
    expect(r.ordres.length).toBeGreaterThan(1)
  })

  it('un dossier sans contact : lu en entier, vide — le vide est une affirmation que seule une lecture complète permet', async () => {
    const lu = await lireLesContacts('d9')
    expect(lu).toEqual({ lignes: [], complete: true, motif: null })
  })

  it('lue en partie : `complete` faux, son motif, et ce qui est revenu', async () => {
    faux.muetApres = 1
    const lu = await lireLesContacts('d1')
    expect(lu.complete).toBe(false)
    expect(lu.motif).toBe('1 ligne(s) lue(s) sur 3 annoncée(s)')
    expect(lu.lignes).toHaveLength(1)
  })

  it('une requête qui lève rejette : jamais une liste vide', async () => {
    faux.leve = true
    await expect(lireLesContacts('d1')).rejects.toThrow('réseau coupé')
  })
})
