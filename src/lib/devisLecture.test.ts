import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesDevis } from './devisLecture'
import { devis, lienDevisFacture } from '../test/devis'

// LES DEVIS D'UN DOSSIER ET LEURS LIENS, LUS EN ENTIER (étape P6a1). Les deux listes jusqu'au bout, compte annoncé ; jamais
// un rejet ; lues en partie, refusées, rompues ou porteuses d'une ligne d'un autre dossier : partielles ou en échec, avec leur
// motif. Le faux client APPLIQUE `.eq` et la tranche, et annonce un compte. Données fictives.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  manquantes: {} as Record<string, number>,
  erreur: null as { message: string } | null,
  leve: null as unknown,
  sansFiltre: false,
  demandes: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let unique = false
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste: string, options?: { count?: string }) => { faux.demandes.push(`${table} ${liste} ${options?.count ?? ''}`); return c },
          eq: (colonne: string, valeur: unknown) => { if (!faux.sansFiltre) predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          // Une ligne par sa clé (l'identité du dossier) : la première, ou nulle.
          maybeSingle: () => { unique = true; return c },
          then: (suite: (r: unknown) => unknown, rejet?: (e: unknown) => unknown) => {
            if (faux.leve) return Promise.reject(faux.leve).then(suite, rejet)
            if (faux.erreur) return Promise.resolve({ data: null, error: faux.erreur, count: null }).then(suite)
            const lignes = filtrer(faux.tables[table] ?? [], predicats)
            if (unique) return Promise.resolve({ data: lignes[0] ?? null, error: null, count: null }).then(suite, rejet)
            return Promise.resolve({
              data: lignes.slice(debut, fin + 1), error: null, count: lignes.length + (faux.manquantes[table] ?? 0),
            }).then(suite, rejet)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.tables = {
    // Le dossier, lu avec les devis : l'émetteur que la base posera (A7).
    dossiers: [{ id: 'd1', nom: 'Atelier fictif', siret: '12345678200010', adresse: '1 rue Fictive', forme_juridique: '5710', denomination_imprimee: 'Atelier fictif SAS' }],
    devis: [devis({ id: 'dv1' }), devis({ id: 'dv2', statut: 'emis', numero: 'D2026-0001' }), devis({ id: 'dv9', dossier_id: 'd2' })]
      .map((d) => ({ ...d })),
    devis_factures: [lienDevisFacture({ devis_id: 'dv2' }), lienDevisFacture({ id: 'df9', dossier_id: 'd2' })].map((l) => ({ ...l })),
    // Les factures du dossier, leurs numéros seuls : celle que le devis dv2 a tirée (étape P6a2).
    factures_emises: [{ id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', statut: 'validee' }, { id: 'f9', dossier_id: 'd2', numero: null, statut: 'brouillon' }],
  }
  faux.manquantes = {}
  faux.erreur = null
  faux.leve = null
  faux.sansFiltre = false
  faux.demandes = []
})

describe('lireLesDevis', () => {
  it('lit les devis et les liens du dossier, en entier, compte annoncé, et rend le dossier lu', async () => {
    const lu = await lireLesDevis('d1')
    expect(lu.etat).toBe('lue')
    if (lu.etat !== 'lue') return
    expect(lu.dossierId).toBe('d1')
    expect(lu.complete).toBe(true)
    expect(lu.motif).toBeNull()
    expect(lu.devis.map((d) => d.id)).toEqual(['dv1', 'dv2'])
    expect(lu.liens.map((l) => l.devis_id)).toEqual(['dv2'])
    expect(lu.factures).toEqual([{ id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', statut: 'validee' }])
    expect(faux.demandes).toEqual([
      'devis * exact', 'devis_factures * exact', 'factures_emises id, dossier_id, numero, statut exact',
      'dossiers nom, siret, adresse, forme_juridique, denomination_imprimee ',
    ])
  })

  it('un lien dont la facture n’est pas revenue rend la lecture partielle : le devis ne dirait pas sa facture', async () => {
    faux.tables.factures_emises = []
    const lu = await lireLesDevis('d1')
    expect(lu.etat === 'lue' && !lu.complete && lu.motif).toBe('la facture tirée d’un devis n’a pas été lue')
  })

  it.each(['devis', 'devis_factures', 'factures_emises'])('un compte annoncé plus grand que ce que rend « %s » : partielle', async (table) => {
    faux.manquantes[table] = 1
    const lu = await lireLesDevis('d1')
    expect(lu.etat).toBe('lue')
    if (lu.etat === 'lue') {
      expect(lu.complete).toBe(false)
      expect(lu.motif).not.toBeNull()
    }
  })

  it('une ligne d’un autre dossier rend la lecture partielle', async () => {
    faux.sansFiltre = true
    const lu = await lireLesDevis('d1')
    expect(lu.etat === 'lue' && !lu.complete && lu.motif).toBe('une ligne rendue n’est pas de ce dossier')
  })

  it('refusée par la base : partielle, avec son motif — jamais « aucun devis »', async () => {
    faux.erreur = { message: 'permission denied for table devis' }
    const lu = await lireLesDevis('d1')
    expect(lu.etat === 'lue' && lu.complete).toBe(false)
  })

  it('une requête qui lève ne rejette pas : l’échec se dit avec son motif', async () => {
    faux.leve = new Error('réseau rompu')
    const lu = await lireLesDevis('d1')
    expect(lu).toEqual({ dossierId: 'd1', etat: 'echec', motif: 'réseau rompu' })
  })
})
