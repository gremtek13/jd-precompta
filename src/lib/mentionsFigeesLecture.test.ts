import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireCeQueLaValidationFige } from './mentionsFigeesLecture'
import { COLONNES_DE_L_IDENTITE } from './mentionsFigeesVue'
import { versionParametres } from '../test/parametresFacturation'
import { identiteDuDossier } from '../test/mentionsFigees'

// CE QUE LA VALIDATION D'UNE FACTURE FIGE, LU POUR L'ÉCRAN (étape A7b). Ce que ces cas gardent : la ligne de SON dossier, dans
// les colonnes que la validation lit ; les versions des paramètres lues EN ENTIER ; et qu'elle ne REJETTE jamais — une
// requête qui lève ou qu'on refuse, une colonne absente, des versions lues en partie, tombent du côté signalé, avec leur
// motif, jamais en un dossier sans identité ni en des paramètres vides. Données FICTIVES.

const faux = vi.hoisted(() => ({
  dossier: null as Record<string, unknown> | null,
  versions: [] as Record<string, unknown>[],
  muetApres: Infinity,
  refusDossier: null as string | null,
  leveDossier: false,
  leveParametres: false,
  requetes: [] as { table: string; colonnes: string; filtres: [string, unknown][] }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const requete = { table, colonnes: '', filtres: [] as [string, unknown][] }
        faux.requetes.push(requete)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string) => { requete.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => {
            if (table !== 'dossiers') throw new Error(`maybeSingle non attendu sur ${table}`)
            if (faux.leveDossier) return Promise.reject(new Error('réseau coupé'))
            if (faux.refusDossier) return Promise.resolve({ data: null, error: { message: faux.refusDossier } })
            const lignes = faux.dossier ? filtrer([faux.dossier], predicats) : []
            return Promise.resolve({ data: lignes[0] ?? null, error: null })
          },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (table !== 'parametres_facturation') throw new Error(`Table non attendue dans ce test : ${table}`)
            if (faux.leveParametres) return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            const toutes = filtrer(faux.versions, predicats)
            return Promise.resolve({ data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length })
              .then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.dossier = { id: 'd1', ...identiteDuDossier() }
  faux.versions = [versionParametres({ id: 'v1' }), versionParametres({ id: 'x1', dossier_id: 'd2' })].map((v) => ({ ...v }))
  faux.muetApres = Infinity
  faux.refusDossier = null
  faux.leveDossier = false
  faux.leveParametres = false
  faux.requetes = []
})

describe('lireCeQueLaValidationFige', () => {
  it('lit la ligne de SON dossier dans les colonnes de la validation, et les versions de SON dossier, en entier', async () => {
    const lu = await lireCeQueLaValidationFige('d1')
    expect(lu).toEqual({ etat: 'lu', identite: { id: 'd1', ...identiteDuDossier() }, versions: [expect.objectContaining({ id: 'v1' })] })
    const dossier = faux.requetes.find((r) => r.table === 'dossiers')!
    expect(dossier.colonnes).toBe(COLONNES_DE_L_IDENTITE)
    expect(dossier.filtres).toEqual([['id', 'd1']])
    expect(faux.requetes.find((r) => r.table === 'parametres_facturation')!.filtres).toEqual([['dossier_id', 'd1']])
  })

  it('une colonne qui ne revient pas n’est pas nulle : illisible, et elle est nommée', async () => {
    const sansMentions = { ...faux.dossier! }
    delete sansMentions.mentions_identite
    faux.dossier = sansMentions
    expect(await lireCeQueLaValidationFige('d1')).toEqual({ etat: 'illisible', motif: 'la colonne mentions_identite du dossier n’a pas été rendue' })
  })

  it('le dossier refusé, introuvable, ou qui lève : illisible, avec son motif', async () => {
    faux.refusDossier = 'permission denied'
    expect(await lireCeQueLaValidationFige('d1')).toEqual({ etat: 'illisible', motif: 'permission denied' })
    faux.refusDossier = null
    expect(await lireCeQueLaValidationFige('d9')).toEqual({ etat: 'illisible', motif: 'le dossier n’a pas été trouvé' })
    faux.leveDossier = true
    expect(await lireCeQueLaValidationFige('d1')).toEqual({ etat: 'illisible', motif: 'réseau coupé' })
  })

  it('des versions lues en partie, ou qui lèvent : illisible — jamais « aucun paramètre »', async () => {
    faux.versions = [versionParametres({ id: 'v1' }), versionParametres({ id: 'v2', remplace_id: 'v1' })].map((v) => ({ ...v }))
    faux.muetApres = 1
    const partiel = await lireCeQueLaValidationFige('d1')
    expect(partiel.etat).toBe('illisible')
    expect(partiel.etat === 'illisible' && partiel.motif).toMatch(/^les paramètres de facturation ne sont lus qu’en partie/)
    faux.muetApres = Infinity
    faux.leveParametres = true
    const leve = await lireCeQueLaValidationFige('d1')
    expect(leve.etat === 'illisible' && leve.motif).toMatch(/réseau coupé/)
  })

  it('un dossier sans aucune version : lu, et vide — l’affirmation d’une liste lue en entier', async () => {
    faux.versions = []
    expect(await lireCeQueLaValidationFige('d1')).toMatchObject({ etat: 'lu', versions: [] })
  })
})
