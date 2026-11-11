import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientBanque from './ClientBanque'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { MouvementDuClient } from '../lib/banqueClient'
import type { CompteDuClient } from '../lib/banqueClientParCompte'
import type { ControleReleveBancaire } from '../lib/types'

// « MA BANQUE » POUR PLUSIEURS COMPTES BANCAIRES (ligne 26.6, MCB7), sous les deux états de `COMPTES_BANCAIRES_PREVUS` joués
// par un accesseur. Ce que ces cas gardent :
//  1. baissé : ni la table des comptes ni la colonne `compte_bancaire_id` ne se demandent, et l'écran est celui d'hier ;
//  2. levé, un seul compte : l'écran d'hier, son nom tu ;
//  3. levé, deux comptes : chaque compte nommé, son solde LU à SES relevés, la fin de son numéro, ses mois sans mouvement
//     nommés sous lui ; le filtre et la colonne du compte ; jamais son compte du plan ;
//  4. levé, les comptes lus en partie, ou un mouvement d'un compte non rendu : l'écran le dit, et n'offre aucun geste.
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Une table dont la lecture s'arrête après N lignes, son compte annoncé entier : une lecture partielle.
  muetApres: {} as Record<string, number>,
  droits: { cabinet: false, membre: true, ventes: false, banque: true } as unknown,
  lectures: [] as string[],
  selects: [] as string[],
  ecritures: [] as string[],
  rpcs: [] as string[],
  drapeau: true,
}))

vi.mock('../lib/comptesBancaires', async (original) => {
  const reel = await original<typeof import('../lib/comptesBancaires')>()
  return { ...reel, get COMPTES_BANCAIRES_PREVUS() { return faux.drapeau } }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', session: { user: { id: 'u-client' }, access_token: 'jeton-fictif' } }),
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string) => {
        if (nom === 'droits_sur_le_dossier') return Promise.resolve({ data: faux.droits, error: null })
        faux.rpcs.push(nom)
        return Promise.resolve({ data: { id: 'neuf' }, error: null })
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        const c: Record<string, unknown> = {}
        const ecrire = (op: string) => () => { faux.ecritures.push(`${table} ${op}`); return c }
        Object.assign(c, {
          select: (liste?: string) => {
            faux.selects.push(`${table}: ${liste ?? '*'}`)
            colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim())
            return c
          },
          eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          insert: ecrire('insert'), update: ecrire('update'), delete: ecrire('delete'), upsert: ecrire('upsert'),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(() => {
            faux.lectures.push(table)
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
              .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
            return { data: rendu, error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ─────────────────────────────────────────────────────────────────────────────────────────────────
const mouvement = (o: Partial<MouvementDuClient>): MouvementDuClient => ({
  id: 'l0', dossier_id: 'd1', date: '2026-09-15', libelle: 'PRLV FICTIF', montant: -10, statut: 'non_rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
  declaration_tva_id: null, prelevement_personnel: false, encaissements_de_factures: false, created_at: '2026-09-20T08:00:00Z',
  compte_bancaire_id: 'P', ...o,
})
const controle = (o: Partial<ControleReleveBancaire>): ControleReleveBancaire => ({
  id: 'c0', dossier_id: 'd1', source_fichier: null, solde_initial: 0, solde_final: 0, somme_mouvements: 0, ecart: 0,
  coherent: true, periode_debut: '2026-08-01', periode_fin: '2026-08-31', created_at: '2026-09-02T08:00:00Z', compte_bancaire_id: 'P', ...o,
})
// Le compte tel que la base le tient : son 512 aussi, que l'écran ne demande pas.
const compte = (o: Partial<CompteDuClient & { dossier_id: string; compte: string | null; compte_propre_depuis: string | null }>) => ({
  id: 'P', dossier_id: 'd1', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, ouvert_le: null, clos_le: null,
  compte: null, compte_propre_depuis: null, ...o,
})
const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

function poser() {
  faux.tables = {
    lignes_bancaires: nues([
      mouvement({ id: 'l1', date: '2026-07-05', libelle: 'PRLV FICTIF TELECOM JUILLET', montant: -39.99 }),
      mouvement({ id: 'l2', date: '2026-08-05', libelle: 'PRLV FICTIF TELECOM AOUT', montant: -39.99 }),
      mouvement({ id: 'l3', date: '2026-09-05', libelle: 'PRLV FICTIF TELECOM SEPTEMBRE', montant: -39.99 }),
      mouvement({ id: 'l4', date: '2026-07-20', libelle: 'INTERETS FICTIFS LIVRET', montant: 12.5, compte_bancaire_id: 'B' }),
      mouvement({ id: 'l5', date: '2026-09-21', libelle: 'VIR FICTIF VERS LIVRET', montant: 500, compte_bancaire_id: 'B' }),
      mouvement({ id: 'lx', dossier_id: 'd2', date: '2026-09-30', libelle: 'AUTRE SOCIETE FICTIVE', montant: -1, compte_bancaire_id: 'Z' }),
    ]),
    justificatifs_proposes: [],
    precisions_mouvements: [],
    reglements_groupes: [],
    pieces: [],
    controles_releves_bancaires: nues([
      controle({ id: 'c1', solde_final: 1234.56, periode_fin: '2026-08-31' }),
      controle({ id: 'c2', solde_final: 8765.43, periode_fin: '2026-09-30', compte_bancaire_id: 'B' }),
    ]),
    comptes_bancaires: nues([
      compte({}),
      compte({ id: 'B', libelle: 'Livret fictif', principal: false, fin_d_identifiant: '4821', compte: '512100', compte_propre_depuis: '2026-01-01' }),
      compte({ id: 'Z', dossier_id: 'd2', libelle: 'Compte d’une autre société', principal: true }),
    ]),
    factures_emises: [],
    encaissements_factures: [],
  }
}

beforeEach(() => {
  poser()
  Object.assign(faux, {
    muetApres: {}, droits: { cabinet: false, membre: true, ventes: false, banque: true },
    lectures: [], selects: [], ecritures: [], rpcs: [], drapeau: true,
  })
})
afterEach(() => {
  expect(faux.ecritures, 'aucune écriture directe d’une table').toEqual([])
  expect(faux.rpcs, 'aucun geste').toEqual([])
})

async function monter() {
  render(<MemoryRouter><ClientBanque /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Ma banque' })
  await act(async () => {})
}
const BLANCS_INSECABLES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const espaces = (t: string | null | undefined) => (t ?? '').replace(BLANCS_INSECABLES, ' ')
const texte = () => espaces(document.body.textContent)
const ligne = (libelle: string) => screen.getByText(libelle).closest('tr') as HTMLElement
const libelles = () => [...document.querySelectorAll('tbody tr td[data-libelle="Libellé"]')].map((t) => t.textContent)
const section = (nom: string) => screen.getByRole('region', { name: `Compte « ${nom} »` })

describe('le drapeau baissé : l’écran d’hier', () => {
  it('ni la table des comptes ni le compte d’un mouvement ne se demandent ; le solde du dernier relevé, tous comptes mêlés', async () => {
    faux.drapeau = false
    await monter()
    expect(faux.lectures).not.toContain('comptes_bancaires')
    expect(faux.selects.join(' | ')).not.toContain('compte_bancaire_id')
    expect(screen.getByRole('heading', { name: 'Ton compte' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Tes comptes' })).toBeNull()
    expect(screen.queryByLabelText('Compte')).toBeNull()
    expect(texte()).toContain('Solde au relevé du 30/09/2026')
    expect(texte()).not.toMatch(/Livret fictif|4821/)
  })
})

describe('le drapeau levé', () => {
  it('un seul compte : l’écran d’hier, son nom tu', async () => {
    faux.tables.lignes_bancaires = faux.tables.lignes_bancaires.filter((l) => l.compte_bancaire_id !== 'B')
    faux.tables.controles_releves_bancaires = faux.tables.controles_releves_bancaires.filter((l) => l.compte_bancaire_id !== 'B')
    faux.tables.comptes_bancaires = faux.tables.comptes_bancaires.filter((l) => l.id !== 'B')
    await monter()
    expect(faux.selects).toContain('comptes_bancaires: id, libelle, principal, fin_d_identifiant, ouvert_le, clos_le')
    expect(screen.getByRole('heading', { name: 'Ton compte' })).toBeTruthy()
    expect(screen.queryByLabelText('Compte')).toBeNull()
    expect(texte()).toContain('Solde au relevé du 31/08/2026')
    expect(texte()).not.toContain('Compte principal')
  })

  it('deux comptes : chacun nommé, son solde LU à ses relevés, la fin de son numéro, ses mois nommés sous lui ; jamais son 512', async () => {
    await monter()
    expect(screen.getByRole('heading', { name: 'Tes comptes' })).toBeTruthy()
    const principal = espaces(section('Compte principal').textContent)
    expect(principal).toContain('Solde au relevé du 31/08/2026')
    expect(principal).toContain('1 234,56')
    expect(principal).not.toMatch(/Mois sans aucun mouvement/)
    const livret = espaces(section('Livret fictif').textContent)
    expect(livret).toContain('Numéro se terminant par 4821')
    expect(livret).toContain('Solde au relevé du 30/09/2026')
    expect(livret).toContain('8 765,43')
    expect(livret).toContain('Mouvements du 20/07/2026 au 21/09/2026.')
    expect(livret).toContain('Mois sans aucun mouvement sur ce compte : août 2026.')
    expect(texte()).not.toMatch(/512|Compte d’une autre société/)
    expect(motsDuCabinet(texte())).toEqual([])
  })

  it('les mouvements se filtrent par compte, la colonne le nomme, et le résumé le dit', async () => {
    await monter()
    expect(within(ligne('INTERETS FICTIFS LIVRET')).getByText('Livret fictif')).toBeTruthy()
    expect(libelles()).toHaveLength(5)
    await act(async () => { fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'B' } }) })
    expect([...libelles()].sort()).toEqual(['INTERETS FICTIFS LIVRET', 'VIR FICTIF VERS LIVRET'])
    expect(texte()).toContain('Sur 2026 sur le compte « Livret fictif »')
    await act(async () => { fireEvent.change(screen.getByLabelText('Compte'), { target: { value: 'tous' } }) })
    expect(libelles()).toHaveLength(5)
  })

  it('les comptes lus en partie : l’écran le dit, ni solde ni mois, et aucun geste', async () => {
    faux.muetApres = { comptes_bancaires: 1 }
    await monter()
    expect(texte()).toMatch(/Tes comptes bancaires n.ont pas pu être affichés en entier/)
    expect(texte()).toContain('Ni le solde ni les mois de tes comptes ne s’affichent')
    expect(texte()).not.toMatch(/Solde au relevé|Mois sans aucun mouvement/)
    expect(screen.queryByLabelText('Compte')).toBeNull()
    await act(async () => { fireEvent.click(within(ligne('VIR FICTIF VERS LIVRET')).getByRole('button', { name: 'Ouvrir' })) })
    const envoyer = screen.getByRole('button', { name: 'Envoyer la précision' }) as HTMLButtonElement
    expect(envoyer.disabled).toBe(true)
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).disabled).toBe(true)
    // Le bouton forcé, une précision saisie : le gestionnaire se retient aussi (l'après-test exige aucun appel).
    await act(async () => { fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: 'Virement vers mon livret' } }) })
    envoyer.disabled = false
    await act(async () => { fireEvent.click(envoyer) })
  })

  it('un mouvement d’un compte que la lecture n’a pas rendu : retenue de même', async () => {
    faux.tables.lignes_bancaires.push(...nues([mouvement({ id: 'l9', date: '2026-09-25', libelle: 'VIR FICTIF INCONNU', compte_bancaire_id: 'Y' })]))
    await monter()
    expect(texte()).toContain('Ni le solde ni les mois de tes comptes ne s’affichent')
    expect(texte()).not.toMatch(/Solde au relevé/)
  })
})
