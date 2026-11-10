import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmerLaFin, leverLesTrous, lireLaNumerotation, lireLesModelesDeNumerotation, poserLeModele } from './numerotationContinueLecture'

// CE QUE LA CARTE « NUMÉROTATION DES FACTURES » LIT ET ÉCRIT (ligne 51.5, étape A9b) : l'état des quatre séries par la fonction
// de la base, puis les paroles du cabinet et les modèles posés EN ENTIER — jamais un rejet : un refus, une forme inattendue, une
// lecture tronquée ou une requête qui lève rendent une lecture illisible, avec son motif. Les gestes rendent une issue, jamais
// une exception. Le faux client APPLIQUE les filtres (un autre dossier ne répond pas) et annonce un compte, qu'il peut mentir.
// Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  etat: null as unknown,
  erreurs: {} as Record<string, { message: string } | undefined>,
  levees: {} as Record<string, unknown>,
  comptesMentis: {} as Record<string, number | undefined>,
  appels: [] as { nom: string; parametres: unknown }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: async (nom: string, parametres: unknown) => {
        faux.appels.push({ nom, parametres })
        if (faux.levees[nom]) throw faux.levees[nom]
        const erreur = faux.erreurs[nom]
        if (erreur) return { data: null, error: erreur }
        return { data: nom === 'etat_de_la_numerotation' ? faux.etat : 1, error: null }
      },
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        const c = {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: async (debut: number, fin: number) => {
            faux.appels.push({ nom: `from ${table}`, parametres: null })
            if (faux.levees[table]) throw faux.levees[table]
            const erreur = faux.erreurs[table]
            if (erreur) return { data: null, error: erreur, count: null }
            const lignes = filtrer(faux.tables[table] ?? [], predicats)
            return { data: lignes.slice(debut, fin + 1), error: null, count: faux.comptesMentis[table] ?? lignes.length }
          },
        }
        return c
      },
    },
  }
})

function ligne(nature: string, emetteur: string, modele: string, surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nature, emetteur, modele, annuel: true, depuis: null, modele_par_defaut: true, premier: 1, emis: null, importes: 0, valides: 0,
    fin: null, trous: [], refus: null, prochain_numero: 'F2026-0001', ...surcharge,
  }
}

beforeEach(() => {
  faux.etat = [
    ligne('facture', 'client', 'F{AAAA}-{N:4}', { importes: 3, emis: 3, fin: 5, trous: [[4, 4]] }),
    ligne('avoir', 'client', 'A{AAAA}-{N:4}'),
    ligne('facture', 'mandataire', 'M{AAAA}-{N:4}'),
    ligne('avoir', 'mandataire', 'MA{AAAA}-{N:4}'),
  ]
  faux.tables = {
    continuite_des_series: [
      { id: 'p1', dossier_id: 'd1', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'fin', premier: 5, dernier: 5, motif: 'Fin du relevé', pose_le: '2026-11-10T10:00:00+00:00' },
      { id: 'p2', dossier_id: 'd2', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'fin', premier: 9, dernier: 9, motif: 'Un autre dossier', pose_le: '2026-11-10T10:00:00+00:00' },
    ],
    modeles_numerotation: [
      { id: 'm1', dossier_id: 'd1', nature: 'facture', emetteur: 'client', modele: 'F{AAAA}-{N:4}', annuel: true, depuis: 2026, premier_numero: 1, pose_le: '2026-11-09T10:00:00+00:00' },
    ],
  }
  faux.erreurs = {}
  faux.levees = {}
  faux.comptesMentis = {}
  faux.appels = []
})

describe('lireLaNumerotation', () => {
  it('lit l’état des quatre séries, les paroles et les modèles du seul dossier, pour l’exercice', async () => {
    const lecture = await lireLaNumerotation('d1', 2026)
    expect(lecture).toMatchObject({ dossierId: 'd1', annee: 2026, etat: 'lue' })
    if (lecture.etat !== 'lue') return
    expect(lecture.series).toHaveLength(4)
    expect(lecture.paroles.map((p) => p.id)).toEqual(['p1'])
    expect(lecture.modeles.map((m) => m.id)).toEqual(['m1'])
    expect(faux.appels.find((a) => a.nom === 'etat_de_la_numerotation')?.parametres).toEqual({ p_dossier_id: 'd1', p_annee: 2026 })
  })

  it('une base qui refuse l’état : illisible, avec le refus dit', async () => {
    faux.erreurs.etat_de_la_numerotation = { message: 'Accès refusé à ce dossier.' }
    const lecture = await lireLaNumerotation('d1', 2026)
    expect(lecture).toMatchObject({ etat: 'illisible' })
    expect(lecture.etat === 'illisible' && lecture.motif).toContain('Accès refusé à ce dossier.')
  })

  it('un état d’une autre forme (trois lignes, un modèle qui ne se lit pas) : illisible', async () => {
    faux.etat = (faux.etat as unknown[]).slice(0, 3)
    expect((await lireLaNumerotation('d1', 2026)).etat).toBe('illisible')
    faux.etat = [ligne('facture', 'client', 'F{AAAA}'), ligne('avoir', 'client', 'A{AAAA}-{N:4}'), ligne('facture', 'mandataire', 'M{AAAA}-{N:4}'), ligne('avoir', 'mandataire', 'MA{AAAA}-{N:4}')]
    expect((await lireLaNumerotation('d1', 2026)).etat).toBe('illisible')
  })

  it('une liste de paroles ou de modèles lue en partie (un plafond qui tronque sans le dire) : illisible', async () => {
    faux.comptesMentis.continuite_des_series = 5
    const paroles = await lireLaNumerotation('d1', 2026)
    expect(paroles.etat).toBe('illisible')
    expect(paroles.etat === 'illisible' && paroles.motif).toMatch(/fins confirmées/)
    faux.comptesMentis = { modeles_numerotation: 9 }
    const modeles = await lireLaNumerotation('d1', 2026)
    expect(modeles.etat === 'illisible' && modeles.motif).toMatch(/modèles posés/)
  })

  it('une parole ou un modèle d’une autre forme : illisible', async () => {
    faux.tables.continuite_des_series = [{ id: 'p1', dossier_id: 'd1', modele: 'x', annuel: true, annee: 2026, geste: 'fin', premier: 5, dernier: 6, motif: 'm', pose_le: 't' }]
    expect((await lireLaNumerotation('d1', 2026)).etat).toBe('illisible')
    faux.tables.continuite_des_series = []
    faux.tables.modeles_numerotation = [{ id: 'm1', dossier_id: 'd1', nature: 'facture', emetteur: 'client', modele: 'F{AAAA}-{N:4}', annuel: true, depuis: 1999, premier_numero: 1 }]
    expect((await lireLaNumerotation('d1', 2026)).etat).toBe('illisible')
  })

  it('une requête qui lève ne rejette jamais', async () => {
    faux.levees.continuite_des_series = new Error('réseau coupé')
    expect(await lireLaNumerotation('d1', 2026)).toMatchObject({ etat: 'illisible' })
    faux.levees = { etat_de_la_numerotation: { message: 'rompu' } }
    expect(await lireLaNumerotation('d1', 2026)).toMatchObject({ etat: 'illisible' })
  })
})

describe('les trois gestes : la fonction SQL seule, une issue, jamais une exception', () => {
  it.each([
    ['poserLeModele', 'fixer_modele_numerotation', () => poserLeModele({ p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_modele: 'F{AAAA}-{N:4}', p_annuel: true, p_depuis: 2026, p_premier_numero: 1 })],
    ['confirmerLaFin', 'confirmer_fin_de_serie', () => confirmerLaFin({ p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_annee: 2026, p_dernier: 5, p_motif: 'm' })],
    ['leverLesTrous', 'lever_trous_de_numerotation', () => leverLesTrous({ p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_annee: 2026, p_premier: 4, p_dernier: 4, p_motif: 'm' })],
  ])('%s appelle %s, dit son succès, son refus, et sa rupture', async (_nom, fonction, geste) => {
    expect(await geste()).toEqual({ ok: true })
    expect(faux.appels.map((a) => a.nom)).toEqual([fonction])
    faux.erreurs[fonction] = { message: 'Seul le chef du cabinet pose le modèle de numéro d\'un dossier.' }
    expect(await geste()).toEqual({ ok: false, message: 'Seul le chef du cabinet pose le modèle de numéro d\'un dossier.' })
    delete faux.erreurs[fonction]
    faux.levees[fonction] = new Error('réseau coupé')
    const rompu = await geste()
    expect(rompu.ok).toBe(false)
  })
})

// LES MODÈLES QUE L'ONGLET FACTURES LIT (jour J du 10/11/2026) : ceux du seul dossier, en entier, sous leur forme ; sinon null.
describe('lireLesModelesDeNumerotation', () => {
  it('rend les modèles du seul dossier, tels que la base les rend', async () => {
    expect(await lireLesModelesDeNumerotation('d1')).toEqual([{ id: 'm1', nature: 'facture', emetteur: 'client',
      modele: 'F{AAAA}-{N:4}', annuel: true, depuis: 2026, pose_le: '2026-11-09T10:00:00+00:00' }])
    expect(await lireLesModelesDeNumerotation('d2')).toEqual([])
  })

  it('une lecture partielle, refusée ou qui lève, une ligne d’une autre forme : null, sans rejeter', async () => {
    faux.comptesMentis = { modeles_numerotation: 2 }
    expect(await lireLesModelesDeNumerotation('d1')).toBeNull()
    faux.comptesMentis = {}
    faux.erreurs = { modeles_numerotation: { message: 'refus' } }
    expect(await lireLesModelesDeNumerotation('d1')).toBeNull()
    faux.erreurs = {}
    faux.levees = { modeles_numerotation: new Error('rompue') }
    expect(await lireLesModelesDeNumerotation('d1')).toBeNull()
    faux.levees = {}
    faux.tables.modeles_numerotation = [{ ...faux.tables.modeles_numerotation[0], depuis: '2026' }]
    expect(await lireLesModelesDeNumerotation('d1')).toBeNull()
  })
})
