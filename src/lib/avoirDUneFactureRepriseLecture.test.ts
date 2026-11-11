import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lireCeQueLAvoirDUneRepriseDemande } from './avoirDUneFactureRepriseLecture'
import { DRAPEAU_DES_REPRISES_AU_CLIENT } from './reprisesAuClient'

// CE QUE L'AVOIR D'UNE FACTURE REPRISE DEMANDE DE LIRE (étape A8c6). Ce que ces cas gardent : la date de reprise de SON dossier ;
// au cabinet seul, ce que les avoirs repris qui citent CETTE facture ont crédité, sommé comme la base (les seuls avoirs) ; pour
// le client, rien de `factures_importees` (la RLS y rendrait zéro ligne) ; et qu'elle ne REJETTE jamais. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  refus: null as string | null,
  leve: false,
  muetApres: Infinity,
  lues: [] as string[],
  appels: [] as { fonction: string; args: unknown }[],
  rendu: null as unknown,
  refusRpc: null as string | null,
  leveRpc: false,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (fonction: string, args: unknown) => {
        faux.appels.push({ fonction, args })
        if (faux.leveRpc) return Promise.reject(new Error('réseau coupé'))
        return Promise.resolve(faux.refusRpc ? { data: null, error: { message: faux.refusRpc } } : { data: faux.rendu, error: null })
      },
      from: (table: string) => {
        faux.lues.push(table)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const lignes = () => filtrer(faux.tables[table] ?? [], predicats)
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (k: string, v: unknown) => { predicats.push(predicatEq(k, v)); return c },
          in: (k: string, v: unknown[]) => { predicats.push(predicatIn(k, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => {
            if (faux.leve) return Promise.reject(new Error('réseau coupé'))
            return Promise.resolve({ data: lignes()[0] ?? null, error: faux.refus ? { message: faux.refus } : null })
          },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            const toutes = lignes()
            return Promise.resolve({ data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length })
              .then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.refus = null
  faux.leve = false
  faux.muetApres = Infinity
  faux.lues = []
  faux.appels = []
  faux.refusRpc = null
  faux.leveRpc = false
  faux.rendu = {
    reprise_le: '2026-11-01', nature_operation: 'services', encaisse_avant_reprise_centimes: 0, encaisse_par_taux: [],
    credite_par_les_repris_centimes: 4010, credite_par_les_repris_par_taux: [{ taux: 20, ttc_centimes: 4010 }],
  }
  faux.tables = {
    dossiers: [{ id: 'd1', reprise_des_factures_le: '2026-11-01' }, { id: 'd2', reprise_des_factures_le: '2020-01-01' }],
    factures_importees: [
      { facture_id: 'ar1', dossier_id: 'd1', origine_id: 'r1' },
      { facture_id: 'ar2', dossier_id: 'd1', origine_id: 'r1' },
      { facture_id: 'ar3', dossier_id: 'd1', origine_id: 'r2' },
    ],
    factures_emises: [
      { id: 'ar1', dossier_id: 'd1', type: 'avoir', statut: 'importee', montant_ttc: -30 },
      { id: 'ar2', dossier_id: 'd1', type: 'avoir', statut: 'importee', montant_ttc: -10.1 },
      { id: 'ar3', dossier_id: 'd1', type: 'avoir', statut: 'importee', montant_ttc: -500 },
    ],
  }
})

describe('lireCeQueLAvoirDUneRepriseDemande', () => {
  it('au cabinet : la date de reprise du dossier et ce que les avoirs repris de CETTE facture ont crédité', async () => {
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'cabinet'))
      .toEqual({ etat: 'lue', factureId: 'r1', repriseLe: '2026-11-01', crediteParLesRepris: 40.1 })
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r9', 'cabinet'))
      .toEqual({ etat: 'lue', factureId: 'r9', repriseLe: '2026-11-01', crediteParLesRepris: 0 })
  })

  it('au client : la date seule, aucune lecture de factures_importees — la base juge du plafond', async () => {
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client'))
      .toEqual({ etat: 'lue', factureId: 'r1', repriseLe: '2026-11-01', crediteParLesRepris: null })
    expect(faux.lues).toEqual(['dossiers'])
  })

  it('ne rejette jamais : refusée, levée, partielle, un avoir cité introuvable, une colonne absente — illisible', async () => {
    faux.refus = 'permission refusée'
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'cabinet')).toMatchObject({ etat: 'illisible', factureId: 'r1', motif: 'permission refusée' })
    faux.refus = null
    faux.leve = true
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'cabinet')).toMatchObject({ etat: 'illisible', motif: 'réseau coupé' })
    faux.leve = false
    faux.muetApres = 1
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'cabinet')).toMatchObject({ etat: 'illisible' })
    faux.muetApres = Infinity
    faux.tables.factures_emises = faux.tables.factures_emises.slice(1)
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'cabinet'))
      .toMatchObject({ etat: 'illisible', motif: 'les montants des avoirs repris : un avoir cité n’a pas été rendu' })
    faux.tables.dossiers = [{ id: 'd1' }]
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client'))
      .toMatchObject({ etat: 'illisible', motif: 'la date de reprise des factures du dossier n’a pas été rendue' })
    faux.tables.dossiers = []
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client')).toMatchObject({ etat: 'illisible', motif: 'le dossier n’a pas été trouvé' })
  })
})

// A8C6-Q1 (« L'offrir au client aussi ») : le drapeau de la migration `reprises_au_client` levé, le client lit la reprise par
// `reprise_de_la_facture`, et rien d'une table ; baissé, le chemin d'hier (ci-dessus).
describe('au client, la migration reprises_au_client en base (drapeau levé)', () => {
  beforeEach(() => { DRAPEAU_DES_REPRISES_AU_CLIENT.REPRISES_AU_CLIENT_PREVUES = true })
  afterEach(() => { DRAPEAU_DES_REPRISES_AU_CLIENT.REPRISES_AU_CLIENT_PREVUES = false })

  it('lit la date de reprise et ce que les avoirs repris créditent par la fonction, pour CETTE facture, et aucune table', async () => {
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client'))
      .toEqual({ etat: 'lue', factureId: 'r1', repriseLe: '2026-11-01', crediteParLesRepris: 40.1 })
    expect(faux.appels).toEqual([{ fonction: 'reprise_de_la_facture', args: { p_dossier_id: 'd1', p_facture_id: 'r1' } }])
    expect(faux.lues).toEqual([])
  })

  it('le cabinet garde sa lecture du registre : aucun appel de la fonction', async () => {
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'cabinet'))
      .toEqual({ etat: 'lue', factureId: 'r1', repriseLe: '2026-11-01', crediteParLesRepris: 40.1 })
    expect(faux.appels).toEqual([])
  })

  it('refusée, levée, d’une autre forme ou négative : illisible, jamais un plafond deviné', async () => {
    faux.refusRpc = 'Accès refusé à ce dossier.'
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client'))
      .toEqual({ etat: 'illisible', factureId: 'r1', motif: 'Accès refusé à ce dossier.' })
    faux.refusRpc = null
    faux.leveRpc = true
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client')).toMatchObject({ etat: 'illisible', motif: 'réseau coupé' })
    faux.leveRpc = false
    faux.rendu = { ...(faux.rendu as object), en_trop: 1 }
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client')).toMatchObject({ etat: 'illisible', motif: 'valeur illisible' })
    faux.rendu = null
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client')).toMatchObject({ etat: 'illisible', motif: 'valeur illisible' })
    faux.rendu = {
      reprise_le: null, nature_operation: null, encaisse_avant_reprise_centimes: 0, encaisse_par_taux: [],
      credite_par_les_repris_centimes: -1, credite_par_les_repris_par_taux: [],
    }
    expect(await lireCeQueLAvoirDUneRepriseDemande('d1', 'r1', 'client'))
      .toMatchObject({ etat: 'illisible', motif: 'ce que les avoirs repris créditent n’a pas été rendu' })
    expect(faux.lues).toEqual([])
  })
})
