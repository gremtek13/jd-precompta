import { beforeEach, describe, expect, it, vi } from 'vitest'

// LA LECTURE DES MODULES OUVERTS (conception 56, OPT3) : le drapeau baissé, AUCUN appel ; levé, la table du cabinet en entier
// ou la fonction du dossier, et tout échec du côté FERMÉ.

const appels = { from: 0, rpc: 0 }
let reponseTable: { data: unknown; error: unknown; count: number | null } = { data: [], error: null, count: 0 }
let reponseRpc: { data: unknown; error: unknown } = { data: [], error: null }
const filtres: string[] = []

vi.mock('./supabase', () => {
  const requete = {
    select: () => requete,
    eq: (colonne: string, valeur: string) => { filtres.push(`${colonne}=${valeur}`); return requete },
    order: () => requete,
    range: () => Promise.resolve(reponseTable),
  }
  return {
    supabase: {
      from: (table: string) => { appels.from += 1; filtres.push(`from:${table}`); return requete },
      rpc: (nom: string, args: unknown) => { appels.rpc += 1; filtres.push(`rpc:${nom}:${JSON.stringify(args)}`); return Promise.resolve(reponseRpc) },
    },
  }
})

const { lireLesModulesDuCabinet, lireLesModulesDuDossier } = await import('./optionsDuCabinetLecture')
const { OPTIONS_DES_CABINETS_PREVUES, TOUS_LES_MODULES } = await import('./modulesDuCabinet')

beforeEach(() => {
  appels.from = 0
  appels.rpc = 0
  filtres.length = 0
  reponseTable = { data: [], error: null, count: 0 }
  reponseRpc = { data: [], error: null }
})

const ligne = (module: string, ouverte: boolean, cabinet = 'c1') => ({ cabinet_id: cabinet, module, ouverte })

describe('le drapeau baissé : tout ouvert, sans aucun appel', () => {
  it('le drapeau est baissé aujourd’hui (la migration OPT1 n’est pas appliquée)', () => {
    expect(OPTIONS_DES_CABINETS_PREVUES).toBe(false)
  })

  it('côté cabinet et côté client, par le défaut comme explicitement : aucun appel, tous les modules', async () => {
    for (const lu of [await lireLesModulesDuCabinet('c1'), await lireLesModulesDuCabinet('c1', false),
      await lireLesModulesDuDossier('d1'), await lireLesModulesDuDossier('d1', false)]) {
      expect(lu.etat).toBe('lus')
      expect(lu.etat === 'lus' ? lu.ouverts : null).toEqual(TOUS_LES_MODULES)
    }
    expect(appels).toEqual({ from: 0, rpc: 0 })
  })
})

describe('le drapeau levé, côté cabinet : la table du cabinet, en entier', () => {
  it('lit la table du seul cabinet, et rend les modules ouverts dans l’ordre de la liste fermée', async () => {
    reponseTable = { data: [ligne('tenue', true), ligne('assistant', false), ligne('facturation', true)], error: null, count: 3 }
    const lu = await lireLesModulesDuCabinet('c1', true)
    expect(lu).toEqual({ etat: 'lus', cle: 'c1', ouverts: ['tenue', 'facturation'] })
    expect(filtres).toEqual(['from:options_des_cabinets', 'cabinet_id=c1'])
    expect(appels).toEqual({ from: 1, rpc: 0 })
  })

  it('aucune ligne : le socle seul (un cabinet neuf, OPT-Q3)', async () => {
    expect(await lireLesModulesDuCabinet('c1', true)).toEqual({ etat: 'lus', cle: 'c1', ouverts: [] })
  })

  it('tombe du côté fermé sur un refus, une lecture partielle, une ligne d’un autre cabinet, un module inconnu, un doublon', async () => {
    const cas: (typeof reponseTable)[] = [
      { data: null, error: { message: 'refusé' }, count: null },
      { data: [ligne('tenue', true)], error: null, count: 2 },
      { data: [ligne('tenue', true, 'c2')], error: null, count: 1 },
      { data: [ligne('paie', true)], error: null, count: 1 },
      { data: [ligne('tenue', 'oui' as unknown as boolean)], error: null, count: 1 },
      { data: [ligne('tenue', true), ligne('tenue', true)], error: null, count: 2 },
    ]
    for (const reponse of cas) {
      reponseTable = reponse
      const lu = await lireLesModulesDuCabinet('c1', true)
      expect(lu.etat, JSON.stringify(reponse)).toBe('illisibles')
    }
  })
})

describe('le drapeau levé, côté client : modules_ouverts_du_dossier', () => {
  it('appelle la fonction pour le dossier affiché, rien d’autre', async () => {
    reponseRpc = { data: ['espace_client', 'tenue'], error: null }
    expect(await lireLesModulesDuDossier('d1', true)).toEqual({ etat: 'lus', cle: 'd1', ouverts: ['tenue', 'espace_client'] })
    expect(filtres).toEqual(['rpc:modules_ouverts_du_dossier:{"p_dossier_id":"d1"}'])
    expect(appels).toEqual({ from: 0, rpc: 1 })
  })

  it('tombe du côté fermé sur un refus et sur toute forme inconnue', async () => {
    for (const reponse of [
      { data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } },
      { data: null, error: null },
      { data: ['tenue', 'paie'], error: null },
      { data: 'tenue', error: null },
    ]) {
      reponseRpc = reponse
      expect((await lireLesModulesDuDossier('d1', true)).etat, JSON.stringify(reponse)).toBe('illisibles')
    }
  })
})
