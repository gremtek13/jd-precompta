import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fixerLaNatureDesRecettes, lireLesCategoriesDeLaNature } from './natureDesRecettesLecture'

// LA LECTURE ET L'ÉCRITURE DE LA NATURE DES RECETTES DU CLIENT (ligne 26.6, étape C11). La lecture : les catégories du dossier
// et les communes, en entier, jamais un rejet, gardées avec le dossier ; l'écriture : la ligne du dossier rendue, ou rien
// d'écrit, dit. Le faux client APPLIQUE `.eq`, `.or` et la tranche, et annonce un compte. Données fictives.
const faux = vi.hoisted(() => ({
  categories: [] as Record<string, unknown>[],
  compteAnnonce: null as number | null,
  erreurLecture: null as { message: string } | null,
  leveLecture: null as unknown,
  // Un serveur qui rendrait une catégorie d’un autre dossier malgré le filtre : la lecture ne la prend pas pour la sienne.
  sansFiltreOr: false,
  // L'écriture : ce qu'elle rend, et ce qu'on lui a demandé.
  ecritures: [] as { table: string; valeurs: unknown; filtres: string[]; colonnes: string }[],
  reponseEcriture: { data: { categorie_recettes_client: 'honoraires' } as unknown, error: null as unknown },
  leveEcriture: null as unknown,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatOr } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        const filtres: string[] = []
        let valeurs: unknown = undefined
        let colonnes = ''
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste: string) => { colonnes = liste; return c },
          update: (v: unknown) => { valeurs = v; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); filtres.push(`${colonne}=${String(valeur)}`); return c },
          or: (expression: string) => { if (!faux.sansFiltreOr) predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: async () => {
            faux.ecritures.push({ table, valeurs, filtres, colonnes })
            if (faux.leveEcriture) throw faux.leveEcriture
            return faux.reponseEcriture
          },
          then: (suite: (r: unknown) => unknown, rejet?: (e: unknown) => unknown) => {
            if (faux.leveLecture) return Promise.reject(faux.leveLecture).then(suite, rejet)
            if (faux.erreurLecture) return Promise.resolve({ data: null, error: faux.erreurLecture, count: null }).then(suite)
            const lignes = filtrer(faux.categories, predicats)
            return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: faux.compteAnnonce ?? lignes.length }).then(suite)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.categories = [
    { id: 'honoraires', dossier_id: 'd1', libelle: 'Honoraires', compte_comptable: '706000', ordre: 1 },
    { id: 'commune', dossier_id: null, libelle: 'Commune', compte_comptable: '758000', ordre: 2 },
    { id: 'ailleurs', dossier_id: 'd2', libelle: 'Ailleurs', compte_comptable: '706000', ordre: 3 },
  ]
  faux.compteAnnonce = null
  faux.erreurLecture = null
  faux.leveLecture = null
  faux.sansFiltreOr = false
  faux.ecritures = []
  faux.reponseEcriture = { data: { categorie_recettes_client: 'honoraires' }, error: null }
  faux.leveEcriture = null
})

describe('lireLesCategoriesDeLaNature', () => {
  it('lit celles du dossier et les communes, en entier, et rend le dossier lu', async () => {
    expect(await lireLesCategoriesDeLaNature('d1')).toEqual({
      dossierId: 'd1', etat: 'lues',
      categories: [
        { id: 'honoraires', dossier_id: 'd1', libelle: 'Honoraires', compte_comptable: '706000' },
        { id: 'commune', dossier_id: null, libelle: 'Commune', compte_comptable: '758000' },
      ],
    })
  })

  it('une catégorie d’un autre dossier rendue malgré le filtre : la lecture n’est pas celle de ce dossier', async () => {
    faux.sansFiltreOr = true
    expect(await lireLesCategoriesDeLaNature('d1'))
      .toEqual({ dossierId: 'd1', etat: 'incompletes', motif: 'une catégorie rendue n’est pas de ce dossier' })
  })

  it('lue en partie, refusée, ou rompue : incomplète, avec son motif — jamais une liste vide', async () => {
    faux.compteAnnonce = 9
    expect((await lireLesCategoriesDeLaNature('d1')).etat).toBe('incompletes')
    faux.compteAnnonce = null
    faux.erreurLecture = { message: 'permission denied' }
    const refusee = await lireLesCategoriesDeLaNature('d1')
    expect(refusee.etat === 'incompletes' && refusee.motif).toMatch(/permission/)
    faux.erreurLecture = null
    faux.leveLecture = new Error('Failed to fetch')
    const rompue = await lireLesCategoriesDeLaNature('d1')
    expect(rompue).toMatchObject({ dossierId: 'd1', etat: 'incompletes' })
  })
})

describe('fixerLaNatureDesRecettes', () => {
  it('écrit la colonne seule, sur le dossier demandé, et rend ce que la base a gardé', async () => {
    expect(await fixerLaNatureDesRecettes('d1', 'honoraires')).toEqual({ ecrite: true, categorieId: 'honoraires' })
    expect(faux.ecritures).toEqual([{
      table: 'dossiers', valeurs: { categorie_recettes_client: 'honoraires' }, filtres: ['id=d1'], colonnes: 'categorie_recettes_client',
    }])
    faux.reponseEcriture = { data: { categorie_recettes_client: null }, error: null }
    expect(await fixerLaNatureDesRecettes('d1', null)).toEqual({ ecrite: true, categorieId: null })
  })

  it('un refus de la base se dit par ses mots ; aucune ligne rendue n’est pas un succès ; une exception ne rejette pas', async () => {
    faux.reponseEcriture = { data: null, error: { message: 'La nature des recettes en espèces du client est une catégorie de produit…', code: '23514' } }
    expect(await fixerLaNatureDesRecettes('d1', 'x')).toEqual({ ecrite: false, refus: 'La nature des recettes en espèces du client est une catégorie de produit…' })
    faux.reponseEcriture = { data: null, error: null }
    expect(await fixerLaNatureDesRecettes('d1', 'honoraires')).toEqual({ ecrite: false, refus: null })
    faux.leveEcriture = new Error('Failed to fetch')
    const rompue = await fixerLaNatureDesRecettes('d1', 'honoraires')
    expect(rompue.ecrite).toBe(false)
  })
})
