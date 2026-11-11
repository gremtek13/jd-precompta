import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fixerLaDateDeReprise, importerLeLot, lireLEtatDeLImport, retirerLImport } from './importDesFacturesLecture'
import type { LotPret } from './importDesFacturesVue'

// CE QUE L'ÉCRAN D'IMPORT DES FACTURES REPRISES LIT ET ÉCRIT (A8d2b). Ce que ces cas gardent : l'état de SON dossier, ses
// factures, ses lots et leurs factures reprises lus EN ENTIER (une lecture partielle, refusée, d'un autre dossier ou qui
// lève tombe « illisible », sans jamais rejeter) ; les gestes passent par leurs fonctions seules, sans original quand les
// originaux ne se déposent pas, et rendent le refus de la base. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  refus: null as string | null,
  leve: false,
  muetApres: Infinity,
  rpc: [] as { nom: string; args: Record<string, unknown> }[],
  rendu: { data: null as unknown, error: null as { message: string } | null },
  depots: [] as string[],
  retires: [] as string[][],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => { faux.rpc.push({ nom, args }); return Promise.resolve(faux.rendu) },
      storage: { from: () => ({ upload: (chemin: string) => { faux.depots.push(chemin); return Promise.resolve({ error: null }) }, remove: (chemins: string[]) => { faux.retires.push(chemins); return Promise.resolve({ error: null }) } }) },
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const lignes = () => filtrer(faux.tables[table] ?? [], predicats)
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (k: string, v: unknown) => { predicats.push(predicatEq(k, v)); return c },
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
  faux.rpc = []
  faux.depots = []
  faux.retires = []
  faux.rendu = { data: null, error: null }
  faux.tables = {
    dossiers: [
      { id: 'd1', siret: '12345678200017', mode_comptable: 'tresorerie', ventes_par_les_factures: true,
        ventes_par_les_factures_depuis: '2026-11-04T23:30:00Z', reprise_des_factures_le: '2026-11-01' },
      { id: 'd2', siret: null, mode_comptable: 'tresorerie', ventes_par_les_factures: false, ventes_par_les_factures_depuis: null, reprise_des_factures_le: null },
    ],
    factures_emises: [
      { id: 'f1', dossier_id: 'd1', numero: 'FA-1', statut: 'importee', type: 'facture', date_emission: '2025-10-01' },
      { id: 'f2', dossier_id: 'd1', numero: 'F2026-000000001', statut: 'validee', type: 'facture', date_emission: '2026-11-06' },
      { id: 'f3', dossier_id: 'd1', numero: null, statut: 'brouillon', type: 'facture', date_emission: null },
      { id: 'f9', dossier_id: 'd2', numero: 'FA-1', statut: 'importee', type: 'facture', date_emission: '2025-10-01' },
    ],
    imports_factures: [{ id: 'l1', dossier_id: 'd1', format: 'cii', fichier_sha256: null, importe_le: '2026-11-10T10:00:00Z', nombre_factures: 1 }],
    factures_importees: [{ facture_id: 'f1', dossier_id: 'd1', import_id: 'l1', rang: 1, fichier_sha256: 'a'.repeat(64), fichier_chemin: 'chemin' }],
  }
})

describe('la lecture de l’état', () => {
  it('rend l’état de SON dossier : la bascule au jour de Paris, le SIREN, les numéros, les reprises, les empreintes, les lots', async () => {
    const l = await lireLEtatDeLImport('d1')
    expect(l).toEqual({ etat: 'lue', lue: {
      dossierId: 'd1', modeComptable: 'tresorerie', bascule: true, basculeLe: '2026-11-05', repriseLe: '2026-11-01', siren: '123456782',
      numeros: ['FA-1', 'F2026-000000001'], reprises: [{ numero: 'FA-1', type: 'facture', date_emission: '2025-10-01' }],
      empreintes: ['a'.repeat(64)],
      lots: [{ id: 'l1', format: 'cii', importe_le: '2026-11-10T10:00:00Z', nombre_factures: 1,
        factures: [{ facture_id: 'f1', numero: 'FA-1', rang: 1, fichier_chemin: 'chemin' }] }],
    } })
  })
  it('sans bascule, aucun jour de bascule ; sans SIRET, aucun SIREN', async () => {
    const l = await lireLEtatDeLImport('d2')
    expect(l.etat === 'lue' && [l.lue.bascule, l.lue.basculeLe, l.lue.siren, l.lue.lots]).toEqual([false, null, null, []])
  })
  it('tombe « illisible » sans jamais rejeter : refus, réseau, lecture partielle, lot incomplet', async () => {
    faux.refus = 'permission denied'
    expect(await lireLEtatDeLImport('d1')).toMatchObject({ etat: 'illisible', dossierId: 'd1' })
    faux.refus = null
    faux.leve = true
    expect(await lireLEtatDeLImport('d1')).toMatchObject({ etat: 'illisible' })
    faux.leve = false
    faux.muetApres = 1
    expect(await lireLEtatDeLImport('d1')).toMatchObject({ etat: 'illisible', motif: expect.stringMatching(/^les factures du dossier/) })
    faux.muetApres = Infinity
    faux.tables.imports_factures[0].nombre_factures = 2
    expect(await lireLEtatDeLImport('d1')).toMatchObject({ etat: 'illisible', motif: 'un import n’a pas rendu toutes ses factures' })
  })
})

const PRET: LotPret = { format: 'cii', factures: [{ cle: 'a', facture: {
  numero: 'FA-2', type: 'facture', date_emission: '2025-10-02', tiers_nom: 'Société fictive', type_client: 'assujetti',
  nature_operation: 'services', option_debits: false, montant_ht: 100, montant_tva: 20, montant_ttc: 120,
  lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }], encaisse_avant_reprise: 0, transmise_par: 'pdf',
} }], noms: ['fa2.xml'] }

const LOT = { id: 'l1', format: 'cii', importe_le: '2026-11-10T10:00:00Z', nombre_factures: 1,
  factures: [{ facture_id: 'f1', numero: 'FA-1', rang: 1, fichier_chemin: 'd1/imports/l1/a.xml' }] }

describe('les gestes', () => {
  it('retirer, originaux prévus : les lignes d’abord, puis l’original — au chef seul ; refusé, rien ne part du stockage', async () => {
    faux.rendu = { data: 1, error: null }
    expect(await retirerLImport('d1', LOT, true, true)).toEqual({ ok: true, message: expect.stringMatching(/^Import retiré : 1 document quitte le dossier\. Son original quitte le stockage/) })
    expect(faux.retires).toEqual([['d1/imports/l1/a.xml']])
    expect(await retirerLImport('d1', LOT, true, false)).toEqual({ ok: true, message: expect.stringMatching(/Son original reste dans le stockage/) })
    expect(faux.retires).toHaveLength(1)
    faux.rendu = { data: null, error: { message: 'La facture reprise FA-1 a un encaissement : son import ne se retire plus.' } }
    expect(await retirerLImport('d1', LOT, true, true)).toEqual({ ok: false, erreur: 'La facture reprise FA-1 a un encaissement : son import ne se retire plus.' })
    expect(faux.retires).toHaveLength(1)
  })

  it('importer : la fonction seule, le lot sans fichier ni identifiant quand les originaux ne se déposent pas', async () => {
    faux.rendu = { data: '0b5d0d2e-0000-4000-8000-000000000001', error: null }
    expect(await importerLeLot('d1', PRET, [], false)).toEqual({ ok: true, message: '1 document repris de l’ancien logiciel.' })
    expect(faux.rpc).toEqual([{ nom: 'importer_factures', args: { p_dossier_id: 'd1', p_lot: { format: 'cii' }, p_factures: [PRET.factures[0].facture] } }])
    expect(faux.depots).toEqual([])
  })
  it('importer : le refus de la base est rendu tel quel', async () => {
    faux.rendu = { data: null, error: { message: 'Rang 1 du lot : le numéro FA-2 est déjà celui d’une facture de ce dossier.' } }
    expect(await importerLeLot('d1', PRET, [], false)).toEqual({ ok: false, erreur: 'Rang 1 du lot : le numéro FA-2 est déjà celui d’une facture de ce dossier.' })
  })
  it('retirer et poser la date : leurs fonctions, leurs rendus vérifiés', async () => {
    faux.rendu = { data: 3, error: null }
    expect(await retirerLImport('d1', LOT, false, true)).toEqual({ ok: true, message: 'Import retiré : 3 documents quittent le dossier.' })
    expect(faux.retires).toEqual([])
    faux.rendu = { data: '2026-10-01', error: null }
    expect(await fixerLaDateDeReprise('d1', '2026-10-01')).toEqual({ ok: true, message: 'Date de reprise posée.' })
    faux.rendu = { data: null, error: null }
    expect(await fixerLaDateDeReprise('d1', '2026-10-01')).toMatchObject({ ok: false })
    expect(faux.rpc.map((r) => r.nom)).toEqual(['retirer_import', 'fixer_reprise_des_factures', 'fixer_reprise_des_factures'])
  })
})
