import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FONCTION_DES_LETTRES_DU_CLIENT, PARAMETRE_DES_LETTRES_DU_CLIENT, REFUS_DES_LETTRES_DU_CLIENT } from './lettresDuClient'
import { lireLesLettresDuClient } from './lettresDuClientLecture'

// LA LECTURE DE « MES LETTRES DE MISSION » (ligne 47, LM6) : la fonction `lettres_de_mission_du_client` seule, appelée sous
// son nom en toutes lettres (les gardes du dépôt ne reconnaissent que lui), confronté ici à la constante que la migration
// définit (lettresDuClient.test.ts) ; son refus (42501) se dit refusé ; toute autre erreur, une valeur qu'on ne reconnaît
// pas entière ou un client qui lève, illisible — jamais « aucune lettre ». Données FICTIVES.

const etat = vi.hoisted(() => ({
  rpc: [] as unknown[][],
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
  },
}))

const D = '1b500000-0000-4000-8000-0000000000d6'

beforeEach(() => {
  etat.rpc = []
  etat.reponse = { data: null, error: null }
  etat.leve = false
})

describe('la lecture des lettres de mission du client', () => {
  it('appelle la fonction de la migration, sous son nom, avec le seul dossier affiché', async () => {
    etat.reponse = { data: { dossier_du_cabinet_designe: false, lettres: [] }, error: null }
    expect(await lireLesLettresDuClient(D)).toEqual({ etat: 'lue', dossierId: D, dossierDuCabinetDesigne: false, lettres: [] })
    expect(etat.rpc).toEqual([[FONCTION_DES_LETTRES_DU_CLIENT, { [PARAMETRE_DES_LETTRES_DU_CLIENT]: D }]])
  })

  it('un refus de la base se dit refusé ; toute autre erreur, une valeur méconnue ou un client rompu, illisible', async () => {
    etat.reponse = { data: null, error: { code: REFUS_DES_LETTRES_DU_CLIENT.code, message: REFUS_DES_LETTRES_DU_CLIENT.acces } }
    expect(await lireLesLettresDuClient(D)).toEqual({ etat: 'refusee', dossierId: D, motif: REFUS_DES_LETTRES_DU_CLIENT.acces })
    etat.reponse = { data: null, error: { code: '57014', message: 'délai dépassé' } }
    expect((await lireLesLettresDuClient(D)).etat).toBe('illisible')
    etat.reponse = { data: null, error: null }
    expect((await lireLesLettresDuClient(D)).etat).toBe('illisible')
    etat.reponse = { data: { dossier_du_cabinet_designe: false, lettres: [], auteur: 'x' }, error: null }
    expect((await lireLesLettresDuClient(D)).etat).toBe('illisible')
    etat.leve = true
    expect((await lireLesLettresDuClient(D)).etat).toBe('illisible')
  })
})
