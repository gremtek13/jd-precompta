import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLeReglageDuDossier } from './reglageDuDossierLecture'

// CE QUE L'ONGLET ACCÈS LIT DU RÉGLAGE (chantier EC-Q3, étape VF8d) : une ligne du dossier, par sa clé, et jamais un rejet —
// un refus, une ligne absente ou une requête qui lève rendent un réglage illisible avec son motif. Le faux client APPLIQUE
// le filtre sur l'identifiant : un autre dossier ne répond pas pour celui-ci.
const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  erreur: null as { message: string } | null,
  leve: null as unknown,
  demandes: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let colonnes = ''
        const c = {
          select: (liste: string) => { colonnes = liste; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          maybeSingle: async () => {
            faux.demandes.push(`${table} ${colonnes}`)
            if (faux.leve) throw faux.leve
            if (faux.erreur) return { data: null, error: faux.erreur }
            const lignes = filtrer(faux.lignes, predicats)
            return { data: lignes[0] ?? null, error: null }
          },
        }
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.lignes = [
    { id: 'd1', ventes_par_les_factures: true },
    { id: 'd2', ventes_par_les_factures: false },
  ]
  faux.erreur = null
  faux.leve = null
  faux.demandes = []
})

describe('lireLeReglageDuDossier', () => {
  it('lit la colonne seule du dossier demandé, et rend le dossier lu avec son réglage', async () => {
    expect(await lireLeReglageDuDossier('d1')).toEqual({ dossierId: 'd1', reglage: { etat: 'bascule' } })
    expect(await lireLeReglageDuDossier('d2')).toEqual({ dossierId: 'd2', reglage: { etat: 'non_bascule' } })
    expect(faux.demandes).toEqual(['dossiers ventes_par_les_factures', 'dossiers ventes_par_les_factures'])
  })

  it('un dossier qu’on ne lit pas est illisible, jamais « pas basculé »', async () => {
    expect(await lireLeReglageDuDossier('d3'))
      .toEqual({ dossierId: 'd3', reglage: { etat: 'illisible', motif: 'le dossier n’a pas été trouvé' } })
  })

  it('une valeur qui n’est pas un booléen est illisible', async () => {
    faux.lignes = [{ id: 'd1', ventes_par_les_factures: null }]
    expect((await lireLeReglageDuDossier('d1')).reglage).toEqual({ etat: 'illisible', motif: 'le réglage n’est pas lisible' })
  })

  it('un refus se dit par son message, sans rejeter', async () => {
    faux.erreur = { message: 'permission denied for table dossiers' }
    const lu = await lireLeReglageDuDossier('d1')
    expect(lu.dossierId).toBe('d1')
    expect(lu.reglage.etat).toBe('illisible')
    expect(lu.reglage.etat === 'illisible' && lu.reglage.motif).toMatch(/permission|refus/i)
  })

  it('une requête qui lève tombe du même côté, sans rejeter', async () => {
    faux.leve = new Error('Failed to fetch')
    const lu = await lireLeReglageDuDossier('d1')
    expect(lu.reglage.etat).toBe('illisible')
  })
})
