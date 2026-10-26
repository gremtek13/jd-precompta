import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLaBascule } from './basculeDesVentesLecture'

// CE QUE LA CARTE « SOURCE DES VENTES » LIT (chantier EC-Q3, étape VF8b) : la ligne du dossier par sa clé, et trois listes EN
// ENTIER — jamais un rejet : un refus, une ligne absente ou une requête qui lève rendent un réglage illisible ou des listes
// partielles, avec leur motif. Le faux client APPLIQUE les filtres (un autre dossier, une pièce d'achat ou validée ne
// répondent pas), annonce un compte, et peut le mentir (un plafond du serveur qui tronque sans le dire). Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  erreurs: {} as Record<string, { message: string } | undefined>,
  levees: {} as Record<string, unknown>,
  // Un compte annoncé plus grand que ce que le serveur rend : la lecture se sait tronquée.
  comptesMentis: {} as Record<string, number | undefined>,
  demandes: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let colonnes = ''
        const repondre = () => {
          faux.demandes.push(`${table} ${colonnes}`)
          if (faux.levees[table]) throw faux.levees[table]
          const erreur = faux.erreurs[table]
          if (erreur) return { data: null, error: erreur, count: null }
          const lignes = filtrer(faux.tables[table] ?? [], predicats)
          return { data: lignes, error: null, count: faux.comptesMentis[table] ?? lignes.length }
        }
        const c = {
          select: (liste: string) => { colonnes = liste; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: async (debut: number, fin: number) => {
            const r = repondre()
            return { ...r, data: r.data?.slice(debut, fin + 1) ?? null }
          },
          maybeSingle: async () => {
            const r = repondre()
            return { data: r.data?.[0] ?? null, error: r.error }
          },
        }
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.tables = {
    dossiers: [
      { id: 'd1', ventes_par_les_factures: true, ventes_par_les_factures_depuis: '2026-10-26T09:15:00+00:00' },
      { id: 'd2', ventes_par_les_factures: false, ventes_par_les_factures_depuis: null },
    ],
    factures_emises: [
      { id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', type: 'facture', statut: 'validee', validated_at: '2026-03-01T10:00:00Z', source_de_la_vente: false, date_emission: '2026-03-01' },
      { id: 'f2', dossier_id: 'd2', numero: 'F2026-0001', type: 'facture', statut: 'validee', validated_at: '2026-03-02T10:00:00Z', source_de_la_vente: false, date_emission: '2026-03-02' },
    ],
    memberships: [
      { id: 'm1', dossier_id: 'd1', droit_ventes: true },
      { id: 'm2', dossier_id: 'd2', droit_ventes: false },
    ],
    pieces: [
      { id: 'p1', dossier_id: 'd1', type_piece: 'vente', statut: 'a_valider' },
      { id: 'p2', dossier_id: 'd1', type_piece: 'vente', statut: 'a_valider' },
      { id: 'p3', dossier_id: 'd1', type_piece: 'vente', statut: 'validee' },
      { id: 'p4', dossier_id: 'd1', type_piece: 'achat', statut: 'a_valider' },
      { id: 'p5', dossier_id: 'd2', type_piece: 'vente', statut: 'a_valider' },
    ],
  }
  faux.erreurs = {}
  faux.levees = {}
  faux.comptesMentis = {}
  faux.demandes = []
})

describe('lireLaBascule', () => {
  it('lit le dossier demandé, ses factures, ses accès et ses pièces de vente à valider — aucun autre', async () => {
    expect(await lireLaBascule('d1')).toEqual({
      dossierId: 'd1',
      reglage: { etat: 'bascule' },
      depuis: '2026-10-26T09:15:00+00:00',
      listes: {
        etat: 'lues',
        factures: [faux.tables.factures_emises[0]],
        acces: [faux.tables.memberships[0]],
        piecesDeVenteAValider: 2,
      },
    })
    expect([...faux.demandes].sort()).toEqual([
      'dossiers ventes_par_les_factures, ventes_par_les_factures_depuis',
      'factures_emises id, numero, type, statut, validated_at, source_de_la_vente, date_emission',
      'memberships id, droit_ventes',
      'pieces id',
    ])
    const autre = await lireLaBascule('d2')
    expect(autre.reglage).toEqual({ etat: 'non_bascule' })
    expect(autre.depuis).toBeNull()
    expect(autre.listes.etat === 'lues' && autre.listes.piecesDeVenteAValider).toBe(1)
  })

  it('la colonne de la date absente reste absente, jamais nulle ; le réglage absent est illisible', async () => {
    faux.tables.dossiers = [{ id: 'd1', ventes_par_les_factures: true }]
    const lu = await lireLaBascule('d1')
    expect(lu.reglage).toEqual({ etat: 'bascule' })
    expect('depuis' in lu && lu.depuis).toBeUndefined()
    faux.tables.dossiers = [{ id: 'd1', ventes_par_les_factures_depuis: null }]
    expect((await lireLaBascule('d1')).reglage).toEqual({ etat: 'illisible', motif: 'le réglage n’est pas lisible' })
  })

  it('un dossier qu’on ne lit pas est illisible, jamais « par ses pièces »', async () => {
    expect((await lireLaBascule('d3')).reglage).toEqual({ etat: 'illisible', motif: 'le dossier n’a pas été trouvé' })
  })

  it('un refus de la ligne du dossier se dit par son message ; une requête qui lève, de même, sans rejeter', async () => {
    faux.erreurs.dossiers = { message: 'permission denied for table dossiers' }
    expect((await lireLaBascule('d1')).reglage)
      .toEqual({ etat: 'illisible', motif: 'permission denied for table dossiers' })
    faux.erreurs = {}
    faux.levees.dossiers = new Error('Failed to fetch')
    const lu = await lireLaBascule('d1')
    expect(lu.reglage).toEqual({ etat: 'illisible', motif: 'Failed to fetch' })
    expect(lu.depuis).toBeUndefined()
    expect(lu.listes.etat).toBe('lues')
  })

  it('une liste refusée, rompue ou tronquée : partielles, chaque motif nommé — jamais une liste vide', async () => {
    faux.erreurs.factures_emises = { message: 'refus des factures' }
    faux.levees.memberships = new Error('Failed to fetch')
    faux.comptesMentis.pieces = 9
    const lu = await lireLaBascule('d1')
    expect(lu.reglage).toEqual({ etat: 'bascule' })
    expect(lu.listes.etat).toBe('partielles')
    const motif = lu.listes.etat === 'partielles' ? lu.listes.motif : ''
    expect(motif).toContain('les factures : lecture interrompue après 0 ligne(s) : refus des factures')
    expect(motif).toContain('les accès : Failed to fetch')
    expect(motif).toMatch(/les pièces de vente : .*2.*9/)
  })

  it('une seule liste partielle suffit', async () => {
    for (const table of ['factures_emises', 'memberships', 'pieces']) {
      faux.erreurs = { [table]: { message: 'refus' } }
      expect((await lireLaBascule('d1')).listes.etat, table).toBe('partielles')
    }
  })
})
