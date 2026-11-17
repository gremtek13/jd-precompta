import { afterEach, describe, expect, it, vi } from 'vitest'

// La lecture du code NAF pour « Ma banque » (NOE4-Q1 (C)) : la colonne seule, du dossier demandé ; une erreur, une ligne
// absente ou une requête qui lève laissent le code NON LU (`undefined`) — la section ne s'offre pas, et rien ne rejette.

const faux = vi.hoisted(() => ({
  reponse: { data: null as unknown, error: null as unknown },
  leve: false,
  requetes: [] as string[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (colonnes: string) => ({
        eq: (colonne: string, valeur: string) => ({
          maybeSingle: async () => {
            faux.requetes.push(`${table}|${colonnes}|${colonne}=${valeur}`)
            if (faux.leve) throw new Error('réseau')
            return faux.reponse
          },
        }),
      }),
    }),
  },
}))

const { lireLeCodeNafDuDossier } = await import('./codeNafDuDossierLecture')

afterEach(() => { faux.reponse = { data: null, error: null }; faux.leve = false; faux.requetes = [] })

describe('lireLeCodeNafDuDossier', () => {
  it('la colonne seule, du dossier demandé ; le code tel que la base le rend, nul s’il n’y en a pas', async () => {
    faux.reponse = { data: { code_naf: '86.90D' }, error: null }
    expect(await lireLeCodeNafDuDossier('d1')).toBe('86.90D')
    expect(faux.requetes).toEqual(['dossiers|code_naf|id=d1'])
    faux.reponse = { data: { code_naf: null }, error: null }
    expect(await lireLeCodeNafDuDossier('d1')).toBeNull()
  })

  it('une erreur, une ligne absente, une requête qui lève : non lu, jamais un rejet', async () => {
    faux.reponse = { data: null, error: { message: 'refusé' } }
    expect(await lireLeCodeNafDuDossier('d1')).toBeUndefined()
    faux.reponse = { data: null, error: null }
    expect(await lireLeCodeNafDuDossier('d1')).toBeUndefined()
    faux.leve = true
    expect(await lireLeCodeNafDuDossier('d1')).toBeUndefined()
  })
})
