import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAPEAU_DES_MISSIONS_DU_CLIENT, FONCTION_DES_MISSIONS_DU_CLIENT, REFUS_DES_MISSIONS_DU_CLIENT } from './missionsDuClient'
import { lireLesMissionsDuClient } from './lettresDeMissionLecture'

// LA CARTE DES MISSIONS D'UN CLIENT, SES DEUX CHEMINS (ligne 47, LM5 puis LM5-Q2). `MISSIONS_DU_CLIENT_PREVUES` baissé : la
// lecture d'hier, par les tables (le dossier, le cabinet, le dossier du cabinet, les lettres), sans jamais appeler la
// fonction ; levé : la fonction `missions_du_client` seule, et aucune table — son refus se dit refusé, sa valeur reconnue
// entière, une requête qui lève tombe du côté illisible. Données FICTIVES.

const etat = vi.hoisted(() => ({
  rpc: [] as unknown[][],
  tables: [] as string[],
  reponse: { data: null, error: null } as { data: unknown; error: unknown },
  leve: false,
}))
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      etat.rpc.push(args)
      if (etat.leve) throw new TypeError('client rompu')
      return Promise.resolve(etat.reponse)
    },
    from: (table: string) => {
      etat.tables.push(table)
      const requete = {
        select: () => requete,
        eq: () => requete,
        maybeSingle: () => Promise.resolve({ data: null, error: { message: 'lecture coupée' } }),
      }
      return requete
    },
  },
}))

const C = '1b500000-0000-4000-8000-0000000000c1'

beforeEach(() => {
  etat.rpc = []
  etat.tables = []
  etat.reponse = { data: null, error: null }
  etat.leve = false
})
// Levé depuis le 12/11/2026 (la migration en production) : chaque test le pose, et il y revient.
afterEach(() => {
  DRAPEAU_DES_MISSIONS_DU_CLIENT.MISSIONS_DU_CLIENT_PREVUES = true
})

describe('drapeau baissé (l’état d’avant) : la carte d’hier', () => {
  beforeEach(() => {
    DRAPEAU_DES_MISSIONS_DU_CLIENT.MISSIONS_DU_CLIENT_PREVUES = false
  })

  it('lit par les tables, jamais par la fonction', async () => {
    expect(await lireLesMissionsDuClient(C)).toEqual({ etat: 'illisible', dossierClientId: C, motif: 'lecture coupée' })
    expect(etat.tables).toEqual(['dossiers'])
    expect(etat.rpc).toEqual([])
  })
})

describe('drapeau levé : la fonction seule', () => {
  beforeEach(() => {
    DRAPEAU_DES_MISSIONS_DU_CLIENT.MISSIONS_DU_CLIENT_PREVUES = true
  })

  it('appelle la fonction sur le dossier du client, et aucune table', async () => {
    etat.reponse = { data: { dossier_du_cabinet_designe: true, lettres: [] }, error: null }
    expect(await lireLesMissionsDuClient(C)).toEqual({ etat: 'lue', dossierClientId: C, lettres: [] })
    expect(etat.rpc).toEqual([[FONCTION_DES_MISSIONS_DU_CLIENT, { p_dossier_id: C }]])
    expect(etat.tables).toEqual([])
  })

  it('sans dossier du cabinet désigné, le dit', async () => {
    etat.reponse = { data: { dossier_du_cabinet_designe: false, lettres: [] }, error: null }
    expect(await lireLesMissionsDuClient(C)).toEqual({ etat: 'sansDossierDuCabinet', dossierClientId: C })
  })

  it('un refus de la base se dit refusé, à ses mots ; jamais « aucune lettre »', async () => {
    etat.reponse = { data: null, error: { code: REFUS_DES_MISSIONS_DU_CLIENT.code, message: REFUS_DES_MISSIONS_DU_CLIENT.acces } }
    expect(await lireLesMissionsDuClient(C)).toEqual({ etat: 'refusee', dossierClientId: C, motif: REFUS_DES_MISSIONS_DU_CLIENT.acces })
  })

  it('une valeur à clé d’honoraires est illisible ; un client qui lève aussi, sans rejeter', async () => {
    etat.reponse = { data: { dossier_du_cabinet_designe: true, lettres: [], honoraires: [] }, error: null }
    expect((await lireLesMissionsDuClient(C)).etat).toBe('illisible')
    etat.leve = true
    expect((await lireLesMissionsDuClient(C)).etat).toBe('illisible')
  })
})
