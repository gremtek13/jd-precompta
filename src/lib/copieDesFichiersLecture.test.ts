import { beforeEach, describe, expect, it, vi } from 'vitest'

// L'ORCHESTRATION DE LA COPIE DES FICHIERS (INAL6) devant un faux client : une lecture partielle d'un inventaire, et AUCUN
// ZIP ne part, rien ne s'enregistre ; sinon un ZIP au moins par dossier, un fichier que le stockage ne rend pas compté
// manquant, l'enregistrement qui reçoit les comptes et une empreinte de manifeste par ZIP.

const monde = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  partielle: null as string | null,
  fichiers: {} as Record<string, string>,
  rpc: [] as { nom: string; args: Record<string, unknown> }[],
  rpcErreur: null as { message: string } | null,
}))

vi.mock('./supabase', () => {
  function requete(table: string) {
    const filtres: [string, unknown][] = []
    const r = {
      select: () => r,
      eq: (col: string, val: unknown) => { filtres.push([col, val]); return r },
      order: () => r,
      range: (debut: number, fin: number) => {
        const lignes = (monde.tables[table] ?? []).filter((l) => filtres.every(([c, v]) => (l as Record<string, unknown>)[c] === v))
        const tranche = lignes.slice(debut, fin + 1)
        // Une lecture partielle : la base annonce une ligne de plus qu'elle n'en rend.
        return Promise.resolve({ data: tranche, error: null, count: lignes.length + (monde.partielle === table ? 1 : 0) })
      },
    }
    return r
  }
  return {
    supabase: {
      from: requete,
      storage: {
        from: () => ({
          download: (chemin: string) => Promise.resolve(chemin in monde.fichiers
            ? { data: new Blob([monde.fichiers[chemin]]), error: null }
            : { data: null, error: { message: 'Object not found' } }),
        }),
      },
      rpc: (nom: string, args: Record<string, unknown>) => {
        monde.rpc.push({ nom, args })
        return Promise.resolve({ data: 'id', error: monde.rpcErreur })
      },
    },
  }
})

import { copierLesFichiersDuCabinet } from './copieDesFichiersLecture'

const CAB = 'cab-1'
const DA = 'aaaaaaaa-0000-4000-8000-00000000000a'
const DB = 'bbbbbbbb-0000-4000-8000-00000000000b'

beforeEach(() => {
  monde.partielle = null
  monde.rpc = []
  monde.rpcErreur = null
  monde.fichiers = { [`${DA}/1-Dupont.pdf`]: 'pièce' }
  monde.tables = {
    dossiers: [{ id: DA, nom: 'A', siret: null, cabinet_id: CAB }, { id: DB, nom: 'B', siret: null, cabinet_id: CAB }],
    pieces: [
      { id: 'p1', dossier_id: DA, date_piece: '2026-02-01', created_at: '2026-02-01T09:00:00Z', storage_path: `${DA}/1-Dupont.pdf`, storage_hash: null, lisible_path: null },
      { id: 'p2', dossier_id: DA, date_piece: '2026-02-02', created_at: '2026-02-02T09:00:00Z', storage_path: `${DA}/2-perdu.pdf`, storage_hash: null, lisible_path: null },
    ],
    documents_divers: [], imports_factures: [], factures_importees: [],
  }
})

function dependances() {
  const zips: string[] = []
  return { zips, dep: { telecharger: (nom: string) => { zips.push(nom) }, maintenant: () => new Date('2026-11-12T10:00:00Z') } }
}

describe('la copie des fichiers d’un cabinet', () => {
  it('une lecture partielle d’un inventaire : aucun ZIP, rien d’enregistré, le motif dit', async () => {
    monde.partielle = 'documents_divers'
    const { zips, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(issue).toMatchObject({ ok: false, message: expect.stringContaining('Aucune copie, aucun ZIP : les documents n’ont pas pu être lus en entier') })
    expect(zips).toEqual([])
    expect(monde.rpc).toEqual([])
  })

  it('la liste des dossiers lue en partie : aucun ZIP non plus', async () => {
    monde.partielle = 'dossiers'
    const { zips, dep } = dependances()
    expect((await copierLesFichiersDuCabinet(CAB, dep)).ok).toBe(false)
    expect(zips).toEqual([])
  })

  it('un ZIP par dossier, le vide compris ; le fichier que le stockage ne rend pas, manquant ; l’enregistrement reçoit les comptes', async () => {
    const { zips, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(zips).toEqual(['copie-2026-11-12-SANS_SIREN-aaaaaaaa-lot1.zip', 'copie-2026-11-12-SANS_SIREN-bbbbbbbb-lot1.zip'])
    expect(issue).toMatchObject({ ok: true, bilan: { dossiers: 2, lots: 2, fichiers: 2, manquants: 1, nonVerifies: 1, enregistrementRefuse: null } })
    expect(monde.rpc).toHaveLength(1)
    expect(monde.rpc[0].nom).toBe('enregistrer_copie_des_fichiers')
    expect(monde.rpc[0].args).toMatchObject({ p_cabinet_id: CAB, p_nb_dossiers: 2, p_nb_fichiers: 2, p_nb_manquants: 1, p_nb_ecarts: 0 })
    expect(monde.rpc[0].args.p_empreintes_des_manifestes).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), expect.stringMatching(/^[0-9a-f]{64}$/)])
  })

  it('un refus de la base se dit, les ZIP partis', async () => {
    monde.rpcErreur = { message: 'La copie porte 2 dossier(s), le cabinet en a 3' }
    const { zips, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(zips).toHaveLength(2)
    expect(issue).toMatchObject({ ok: true, bilan: { enregistrementRefuse: expect.stringContaining('le cabinet en a 3') } })
  })

  it('un cabinet sans dossier : aucune copie', async () => {
    monde.tables.dossiers = []
    const { zips, dep } = dependances()
    expect(await copierLesFichiersDuCabinet(CAB, dep)).toEqual({ ok: false, message: 'Aucune copie : le cabinet n’a aucun dossier.' })
    expect(zips).toEqual([])
  })
})
