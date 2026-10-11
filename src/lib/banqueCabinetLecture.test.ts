import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesAccesDuReleve, lireLesEnvoisDuClient } from './banqueCabinetLecture'

// CE QUE LE CLIENT A ENVOYÉ, LU PAR L'ONGLET BANQUE DU CABINET (espace client, étape P9b). Ce que ces cas gardent : les
// deux registres et les accès DU DOSSIER demandé et d'aucun autre, lus jusqu'au bout de ce que la base annonce
// (`lireTout`, tri total terminé par la clé primaire) ; une lecture en partie, refusée, ou qui LÈVE ne dit rien — jamais
// une liste vide qui affirmerait « rien de proposé ».

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Par table : 'entier', 'muet' (un seul rendu, le vrai total annoncé), 'refus', 'leve'.
  modes: {} as Record<string, 'entier' | 'muet' | 'refus' | 'leve'>,
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
            const mode = faux.modes[table] ?? 'entier'
            if (mode === 'leve') return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            if (mode === 'refus') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
            const toutes = filtrer(faux.tables[table] ?? [], predicats)
            const jusqua = mode === 'muet' ? Math.min(fin + 1, 1) : fin + 1
            return Promise.resolve({ data: toutes.slice(debut, jusqua), error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const proposition = (id: string, dossier: string) => ({
  id, dossier_id: dossier, ligne_bancaire_id: 'l1', piece_id: 'p1', auteur_id: 'u1', origine: 'client',
  created_at: '2026-06-05T10:00:00Z', retire_le: null, retire_par: null,
})
const precision = (id: string, dossier: string) => ({
  id, dossier_id: dossier, ligne_bancaire_id: 'l1', auteur_id: 'c1', origine: 'cabinet', texte: 'Question fictive', created_at: '2026-06-06T10:00:00Z',
})

beforeEach(() => {
  faux.modes = {}
  faux.demandes = []
  faux.tables = {
    justificatifs_proposes: [proposition('a', 'd1'), proposition('b', 'd1'), proposition('c', 'd2')],
    precisions_mouvements: [precision('q1', 'd1'), precision('q2', 'd2')],
    memberships: [
      { id: 'm1', dossier_id: 'd1', user_id: 'u1', droit_banque: true },
      { id: 'm2', dossier_id: 'd1', user_id: 'u2', droit_banque: false },
      { id: 'm3', dossier_id: 'd2', user_id: 'u3', droit_banque: true },
    ],
  }
})

describe('lireLesEnvoisDuClient', () => {
  it('les propositions et le fil de CE dossier, lus en entier', async () => {
    const lu = await lireLesEnvoisDuClient('d1')
    expect(lu.etat).toBe('lus')
    if (lu.etat !== 'lus') return
    expect(lu.propositions.map((p) => p.id)).toEqual(['a', 'b'])
    expect(lu.precisions.map((q) => q.id)).toEqual(['q1'])
  })

  it('demande les deux registres, toutes colonnes, le dossier, un tri total terminé par la clé primaire', async () => {
    await lireLesEnvoisDuClient('d1')
    expect(faux.demandes).toEqual([
      { table: 'justificatifs_proposes', colonnes: '*', dossier: 'd1', tri: ['created_at', 'id'] },
      { table: 'precisions_mouvements', colonnes: '*', dossier: 'd1', tri: ['created_at', 'id'] },
    ])
  })

  it('l’un des registres en partie, refusé, ou qui lève : rien n’est dit, le motif l’est', async () => {
    faux.modes = { justificatifs_proposes: 'muet' }
    const muet = await lireLesEnvoisDuClient('d1')
    expect(muet.etat === 'incomplets' && muet.motif).toMatch(/^les pièces proposées n’ont pas été lues en entier/)
    faux.modes = { precisions_mouvements: 'refus' }
    const refus = await lireLesEnvoisDuClient('d1')
    expect(refus.etat === 'incomplets' && refus.motif).toMatch(/^le fil des mouvements n’a pas été lu en entier \(.*accès refusé/)
    faux.modes = { justificatifs_proposes: 'leve' }
    expect(await lireLesEnvoisDuClient('d1')).toEqual({ etat: 'incomplets', motif: 'réseau coupé' })
  })
})

describe('lireLesAccesDuReleve', () => {
  it('les comptes des accès de CE dossier et le nombre de cases « Banque »', async () => {
    expect(await lireLesAccesDuReleve('d1')).toEqual({ acces: { etat: 'lus', comptes: ['u1', 'u2'] }, avecBanque: 1 })
    expect(faux.demandes[0]).toEqual({ table: 'memberships', colonnes: 'id, user_id, droit_banque', dossier: 'd1', tri: ['created_at', 'id'] })
    expect(await lireLesAccesDuReleve('d3')).toEqual({ acces: { etat: 'lus', comptes: [] }, avecBanque: 0 })
  })

  it('en partie, refusée ou levée : aucun compte reconnu, aucun nombre', async () => {
    for (const mode of ['muet', 'refus', 'leve'] as const) {
      faux.modes = { memberships: mode }
      const lu = await lireLesAccesDuReleve('d1')
      expect(lu.acces.etat).toBe('incomplets')
      expect(lu.avecBanque).toBeNull()
    }
  })
})
