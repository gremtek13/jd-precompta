import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesAccesDuDossier } from './auteursVentesLecture'

// LA LECTURE DES ACCÈS D'UN DOSSIER, pour reconnaître le client (espace client, étape P4c). Ce que ces cas gardent : tous les
// accès DU DOSSIER demandé et d'aucun autre, lus jusqu'au bout de ce que la base annonce (`lireTout`) ; une lecture en partie
// ou refusée ne reconnaît personne et dit son motif ; une requête qui LÈVE tombe du même côté, jamais une liste vide.

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  mode: 'entier' as 'entier' | 'muet' | 'refus' | 'leve',
  muetApres: 1,
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
            if (faux.mode === 'refus') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
            const toutes = filtrer(faux.lignes, predicats)
            const jusqua = faux.mode === 'muet' ? Math.min(fin + 1, faux.muetApres) : fin + 1
            return Promise.resolve({ data: toutes.slice(debut, jusqua), error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const acces = (id: string, dossier: string, user: string) => ({ id, dossier_id: dossier, user_id: user })

beforeEach(() => {
  faux.mode = 'entier'
  faux.demandes = []
  faux.lignes = [acces('m1', 'd1', 'u-client'), acces('m2', 'd1', 'u-second'), acces('m3', 'd2', 'u-autre')]
})

describe('lireLesAccesDuDossier', () => {
  it('rend les comptes des accès de CE dossier, lus en entier', async () => {
    expect(await lireLesAccesDuDossier('d1')).toEqual({ etat: 'lus', comptes: ['u-client', 'u-second'] })
    expect(await lireLesAccesDuDossier('d2')).toEqual({ etat: 'lus', comptes: ['u-autre'] })
  })

  it('un dossier sans accès : une liste lue, vide', async () => {
    expect(await lireLesAccesDuDossier('d3')).toEqual({ etat: 'lus', comptes: [] })
  })

  it('demande la table des accès, deux colonnes, le dossier, un tri total terminé par la clé primaire', async () => {
    await lireLesAccesDuDossier('d1')
    expect(faux.demandes[0]).toEqual({ table: 'memberships', colonnes: 'id, user_id', dossier: 'd1', tri: ['created_at', 'id'] })
  })

  it('en partie : aucun compte reconnu, le motif dit', async () => {
    faux.mode = 'muet'
    const lu = await lireLesAccesDuDossier('d1')
    expect(lu.etat).toBe('incomplets')
    expect(lu.etat === 'incomplets' && lu.motif).toContain('1')
  })

  it('refusée : le motif de la base', async () => {
    faux.mode = 'refus'
    const lu = await lireLesAccesDuDossier('d1')
    expect(lu.etat).toBe('incomplets')
    expect(lu.etat === 'incomplets' && lu.motif).toContain('accès refusé')
  })

  it('une requête qui lève tombe du côté signalé, jamais une liste vide', async () => {
    faux.mode = 'leve'
    expect(await lireLesAccesDuDossier('d1')).toEqual({ etat: 'incomplets', motif: 'réseau coupé' })
  })
})
