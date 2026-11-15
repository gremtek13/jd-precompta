import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLaPrevisionDuClient, lireLesPrevisionsDuCabinet } from './previsionsPublieesLecture'

// CE QUE LES ÉCRANS LISENT DE LA PRÉVISION PUBLIÉE (C8-Q2). Côté client, la case « Banque » relue à la base dans la même vague
// que les lignes : sans elle, rien de ce qui a été lu n'est rendu (une lecture que la RLS refuse rend zéro ligne sans
// erreur) ; des droits illisibles, un échec. Une ligne d'un autre dossier ne se croit pas. Rien ne rejette.

const faux = vi.hoisted(() => ({
  droits: { data: { banque: true } as unknown, error: null as { message: string } | null },
  lignes: [] as Record<string, unknown>[],
  compte: null as number | null,
  colonnes: [] as string[],
  leve: false,
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve(faux.droits),
    from: () => {
      if (faux.leve) throw new Error('constructeur cassé')
      const chaine: Record<string, unknown> = {
        select: (colonnes: string) => { faux.colonnes.push(colonnes); return chaine },
        eq: () => chaine,
        order: () => chaine,
        range: (debut: number, fin: number) => Promise.resolve({
          data: faux.lignes.slice(debut, fin + 1), error: null, count: faux.compte ?? faux.lignes.length,
        }),
      }
      return chaine
    },
  },
}))

afterEach(() => {
  faux.droits = { data: { banque: true }, error: null }
  faux.lignes = []
  faux.compte = null
  faux.colonnes = []
  faux.leve = false
})

const ligne = (o: Record<string, unknown> = {}) => ({
  id: 'p1', dossier_id: 'd1', geste: 'publication', contenu: {}, remplace_id: null, publiee_le: '2026-11-15T08:00:00Z', ...o,
})

describe('la lecture du client', () => {
  it('« Banque » en base : les lignes du dossier, lues en entier, sans l’auteur', async () => {
    faux.lignes = [ligne()]
    const l = await lireLaPrevisionDuClient('d1')
    expect(l).toEqual({ dossierId: 'd1', etat: 'lue', previsions: { lignes: [ligne()], complete: true, motif: null } })
    expect(faux.colonnes.every((c) => !c.includes('auteur'))).toBe(true)
  })

  it('sans « Banque » en base, rien de ce qui a été lu n’est rendu ; seul « vrai » accorde', async () => {
    faux.lignes = [ligne()]
    for (const banque of [false, null, 'true', 1]) {
      faux.droits = { data: { banque }, error: null }
      expect(await lireLaPrevisionDuClient('d1')).toEqual({ dossierId: 'd1', etat: 'sans_banque' })
    }
  })

  it('des droits illisibles ou refusés, un constructeur qui lève : un échec, jamais une liste vide', async () => {
    faux.droits = { data: null, error: { message: 'JWT expired' } }
    expect((await lireLaPrevisionDuClient('d1')).etat).toBe('echec')
    faux.droits = { data: [true], error: null }
    expect((await lireLaPrevisionDuClient('d1')).etat).toBe('echec')
    faux.droits = { data: { banque: true }, error: null }
    faux.leve = true
    expect((await lireLaPrevisionDuClient('d1')).etat).toBe('echec')
  })

  it('une ligne d’un autre dossier ne se croit pas ; une lecture tronquée le dit', async () => {
    faux.lignes = [ligne({ dossier_id: 'd2' })]
    const autre = await lireLaPrevisionDuClient('d1')
    expect(autre.etat === 'lue' && autre.previsions.complete).toBe(false)
    faux.lignes = [ligne()]
    faux.compte = 3
    const tronquee = await lireLaPrevisionDuClient('d1')
    expect(tronquee.etat === 'lue' && tronquee.previsions.complete).toBe(false)
  })
})

describe('la lecture du cabinet', () => {
  it('les lignes du dossier, ou un motif ; rien ne rejette', async () => {
    faux.lignes = [ligne(), ligne({ id: 'r1', geste: 'retrait', contenu: null, remplace_id: 'p1' })]
    expect((await lireLesPrevisionsDuCabinet('d1')).previsions.lignes).toHaveLength(2)
    faux.lignes = [ligne({ dossier_id: 'd2' })]
    expect((await lireLesPrevisionsDuCabinet('d1')).previsions.complete).toBe(false)
    faux.leve = true
    const echec = await lireLesPrevisionsDuCabinet('d1')
    expect(echec.previsions).toMatchObject({ lignes: [], complete: false })
  })
})
