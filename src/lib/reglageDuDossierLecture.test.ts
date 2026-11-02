import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLeReglageDuDossier, natureDeLaLigne } from './reglageDuDossierLecture'

// CE QUE L'ONGLET ACCÈS LIT DU DOSSIER (chantier EC-Q3, étape VF8d ; ligne 26.6, étape C11) : une ligne du dossier, par sa
// clé — le réglage des ventes, le statut de TVA, la nature des recettes du client —, et jamais un rejet : un refus, une ligne
// absente ou une requête qui lève rendent les trois illisibles avec leur motif. Le faux client APPLIQUE le filtre sur
// l'identifiant, et ne rend que les colonnes DEMANDÉES : une colonne que la lecture oublierait se verrait illisible.
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
            const ligne = filtrer(faux.lignes, predicats)[0]
            if (!ligne) return { data: null, error: null }
            const demandees = colonnes.split(',').map((x) => x.trim())
            return { data: Object.fromEntries(demandees.filter((k) => k in ligne).map((k) => [k, ligne[k]])), error: null }
          },
        }
        return c
      },
    },
  }
})

const COLONNES = 'dossiers ventes_par_les_factures, statut_tva, categorie_recettes_client'

beforeEach(() => {
  faux.lignes = [
    { id: 'd1', ventes_par_les_factures: true, statut_tva: 'exonere', categorie_recettes_client: 'cat-7' },
    { id: 'd2', ventes_par_les_factures: false, statut_tva: 'redevable', categorie_recettes_client: null },
    { id: 'd4', ventes_par_les_factures: false, statut_tva: 'franchise', categorie_recettes_client: null },
    { id: 'd5', ventes_par_les_factures: false, statut_tva: null, categorie_recettes_client: null },
  ]
  faux.erreur = null
  faux.leve = null
  faux.demandes = []
})

describe('lireLeReglageDuDossier', () => {
  it('lit les trois colonnes du dossier demandé, et rend le dossier lu avec chacune', async () => {
    expect(await lireLeReglageDuDossier('d1')).toEqual({
      dossierId: 'd1', reglage: { etat: 'bascule' }, caisse: { etat: 'exclu', statut: 'exonere' },
      nature: { etat: 'lue', categorieId: 'cat-7' },
    })
    expect(await lireLeReglageDuDossier('d2')).toEqual({
      dossierId: 'd2', reglage: { etat: 'non_bascule' }, caisse: { etat: 'tenue_par_le_cabinet', statut: 'redevable' },
      nature: { etat: 'lue', categorieId: null },
    })
    expect(faux.demandes).toEqual([COLONNES, COLONNES])
  })

  it('la franchise ouvre la case comme l’exonération (CAISSE2-Q3) ; un statut à préciser la tient fermée', async () => {
    expect((await lireLeReglageDuDossier('d4')).caisse).toEqual({ etat: 'exclu', statut: 'franchise' })
    expect((await lireLeReglageDuDossier('d5')).caisse).toEqual({ etat: 'tenue_par_le_cabinet', statut: null })
  })

  it('un dossier qu’on ne lit pas est illisible, jamais « pas basculé », jamais « redevable »', async () => {
    const motif = 'le dossier n’a pas été trouvé'
    expect(await lireLeReglageDuDossier('d3')).toEqual({
      dossierId: 'd3', reglage: { etat: 'illisible', motif }, caisse: { etat: 'illisible', motif },
      nature: { etat: 'illisible', motif },
    })
  })

  it('une valeur d’un autre type est illisible, et elle seule', async () => {
    faux.lignes = [{ id: 'd1', ventes_par_les_factures: null, statut_tva: 'exonere', categorie_recettes_client: 7 }]
    const lu = await lireLeReglageDuDossier('d1')
    expect(lu.reglage).toEqual({ etat: 'illisible', motif: 'le réglage n’est pas lisible' })
    expect(lu.caisse).toEqual({ etat: 'exclu', statut: 'exonere' })
    expect(lu.nature).toEqual({ etat: 'illisible', motif: 'la nature des recettes du client n’est pas lisible' })
    faux.lignes = [{ id: 'd1', ventes_par_les_factures: true, statut_tva: 'autre', categorie_recettes_client: null }]
    expect((await lireLeReglageDuDossier('d1')).caisse).toEqual({ etat: 'illisible', motif: 'le statut de TVA n’est pas lisible' })
  })

  it('une colonne absente de la réponse est illisible — jamais nulle', async () => {
    faux.lignes = [{ id: 'd1', ventes_par_les_factures: true }]
    const lu = await lireLeReglageDuDossier('d1')
    expect(lu.caisse).toEqual({ etat: 'illisible', motif: 'le statut de TVA n’a pas été lu' })
    expect(lu.nature.etat).toBe('illisible')
    expect(natureDeLaLigne({})).toEqual({ etat: 'illisible', motif: 'la nature des recettes du client n’est pas lisible' })
    expect(natureDeLaLigne({ categorie_recettes_client: '' }).etat).toBe('illisible')
  })

  it('un refus se dit par son message, sans rejeter, et rend les trois illisibles', async () => {
    faux.erreur = { message: 'permission denied for table dossiers' }
    const lu = await lireLeReglageDuDossier('d1')
    expect(lu.dossierId).toBe('d1')
    for (const etat of [lu.reglage, lu.caisse, lu.nature]) {
      expect(etat.etat).toBe('illisible')
      expect(etat.etat === 'illisible' && etat.motif).toMatch(/permission|refus/i)
    }
  })

  it('une requête qui lève tombe du même côté, sans rejeter', async () => {
    faux.leve = new Error('Failed to fetch')
    const lu = await lireLeReglageDuDossier('d1')
    expect([lu.reglage.etat, lu.caisse.etat, lu.nature.etat]).toEqual(['illisible', 'illisible', 'illisible'])
  })
})
