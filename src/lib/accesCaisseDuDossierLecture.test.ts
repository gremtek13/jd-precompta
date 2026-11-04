import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesAccesCaisseDuDossier } from './accesCaisseDuDossierLecture'

// LES ACCÈS DU DOSSIER, LUS PAR LA CARTE DU STATUT DE TVA (C11-Q1). En entier, leur seule case « Caisse », jamais un rejet ;
// lus en partie, refusés, rompus ou d'une forme inattendue : illisibles, avec leur motif — jamais « aucun accès ne la
// porte ». Le faux client APPLIQUE `.eq` et la tranche, annonce un compte, et ne rend que les colonnes demandées. Données
// fictives.
const faux = vi.hoisted(() => ({
  acces: [] as Record<string, unknown>[],
  compteAnnonce: null as number | null,
  erreur: null as { message: string } | null,
  leve: null as unknown,
  // Un serveur qui rendrait un accès d'un autre dossier malgré le filtre.
  sansFiltre: false,
  demandes: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let colonnes: string[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste: string, options?: { count?: string }) => {
            colonnes = liste.split(',').map((x) => x.trim())
            faux.demandes.push(`${table} ${liste} ${options?.count ?? ''}`)
            return c
          },
          eq: (colonne: string, valeur: unknown) => { if (!faux.sansFiltre) predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, rejet?: (e: unknown) => unknown) => {
            if (faux.leve) return Promise.reject(faux.leve).then(suite, rejet)
            if (faux.erreur) return Promise.resolve({ data: null, error: faux.erreur, count: null }).then(suite)
            const lignes = filtrer(faux.acces, predicats)
              .map((l) => Object.fromEntries(colonnes.filter((k) => k in l).map((k) => [k, l[k]])))
            return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: faux.compteAnnonce ?? lignes.length }).then(suite)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.acces = [
    { id: 'm1', dossier_id: 'd1', email: 'client@exemple.fr', droit_caisse: false },
    { id: 'm2', dossier_id: 'd1', email: 'secretariat@exemple.fr', droit_caisse: true },
    { id: 'm3', dossier_id: 'd2', email: 'ailleurs@exemple.fr', droit_caisse: true },
  ]
  faux.compteAnnonce = null
  faux.erreur = null
  faux.leve = null
  faux.sansFiltre = false
  faux.demandes = []
})

describe('lireLesAccesCaisseDuDossier', () => {
  it('compte les accès DU dossier qui portent la case, en entier, sans lire leur adresse', async () => {
    expect(await lireLesAccesCaisseDuDossier('d1')).toEqual({ dossierId: 'd1', etat: 'lus', avecLaCase: 1 })
    expect(faux.demandes).toEqual(['memberships id, dossier_id, droit_caisse exact'])
    faux.acces[1].droit_caisse = false
    expect(await lireLesAccesCaisseDuDossier('d1')).toEqual({ dossierId: 'd1', etat: 'lus', avecLaCase: 0 })
    expect(await lireLesAccesCaisseDuDossier('d3')).toEqual({ dossierId: 'd3', etat: 'lus', avecLaCase: 0 })
  })

  it('lue en partie : illisible, avec son motif — jamais « aucun accès ne la porte »', async () => {
    faux.compteAnnonce = 5
    const lu = await lireLesAccesCaisseDuDossier('d1')
    expect(lu.etat).toBe('illisibles')
    expect(lu.dossierId).toBe('d1')
  })

  it('un refus ou une requête qui lève : illisible, sans rejeter', async () => {
    faux.erreur = { message: 'permission denied for table memberships' }
    const refus = await lireLesAccesCaisseDuDossier('d1')
    expect(refus.etat === 'illisibles' && refus.motif).toMatch(/permission denied/)
    faux.erreur = null
    faux.leve = new Error('Failed to fetch')
    expect((await lireLesAccesCaisseDuDossier('d1')).etat).toBe('illisibles')
  })

  it('un accès d’un autre dossier rendu malgré le filtre, ou une case qui n’est pas un booléen : illisible', async () => {
    faux.sansFiltre = true
    expect(await lireLesAccesCaisseDuDossier('d1'))
      .toEqual({ dossierId: 'd1', etat: 'illisibles', motif: 'un accès rendu n’est pas de ce dossier' })
    faux.sansFiltre = false
    faux.acces = [{ id: 'm1', dossier_id: 'd1', droit_caisse: null }]
    expect(await lireLesAccesCaisseDuDossier('d1'))
      .toEqual({ dossierId: 'd1', etat: 'illisibles', motif: 'la case « Caisse » d’un accès n’est pas lisible' })
    faux.acces = [{ id: 'm1', dossier_id: 'd1' }]
    expect((await lireLesAccesCaisseDuDossier('d1')).etat).toBe('illisibles')
  })
})
