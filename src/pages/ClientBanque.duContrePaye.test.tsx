import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientBanque from './ClientBanque'
import { motsDuCabinet } from '../lib/espaceVentes'
import { PRESENTATION_DU_DU_AU_CLIENT, TITRE_DU_DU_AU_CLIENT } from '../lib/duContrePayeVue'
import type { FactureLu } from '../lib/factureAssuranceMaladieLecture'
import type { PaiementsLus } from '../lib/paiementsAssuranceMaladieLecture'
import type { EspaceVentes } from '../lib/espaceVentes'
import type { MouvementDuClient } from '../lib/banqueClient'
import type {
  FactureAssuranceMaladie as Total, ImportAssuranceMaladie, ImportFacturesAssuranceMaladie, PaiementAssuranceMaladie,
} from '../lib/types'

// « CE QUE L'ASSURANCE MALADIE TE DOIT » DANS « MA BANQUE » (DU-Q3 (A), décision du cabinet du 21/11/2026 : « avec les mots du
// client, sans geste »), sous les deux états de `DU_CONTRE_PAYE_PREVU` joués par un accesseur. Ce que ces cas gardent :
//  1. baissé : ni le facturé ni les paiements ne se lisent pour la section, rien ne se monte ;
//  2. levé : la section, aux mots du client (aucune forme du cabinet), les deux lectures en espace client, la période commune
//     DITE, et AUCUN bouton ni champ ;
//  3. levé, une lecture partielle : dite, aucun chiffre, aucun tableau ;
//  4. levé, sur un code NAF hors de la santé sans import lu : rien ne se dit au client (la règle d'offre des sections voisines).
// Les deux sections voisines (NOE4, BOR4) sont remplacées par un vide : elles ont leurs propres tests. Données FICTIVES.

const faux = vi.hoisted(() => ({
  drapeau: false,
  codeNaf: '86.90E' as string | null | undefined,
  facture: null as FactureLu | null,
  paye: null as PaiementsLus | null,
  lectures: [] as string[],
  ecritures: [] as string[],
  rpcs: [] as string[],
  tables: {} as Record<string, Record<string, unknown>[]>,
}))

vi.mock('../lib/duContrePayeVue', async (original) => ({
  ...await original<typeof import('../lib/duContrePayeVue')>(),
  get DU_CONTRE_PAYE_PREVU() { return faux.drapeau },
}))
vi.mock('../lib/factureAssuranceMaladieLecture', () => ({
  lireLeFactureAssuranceMaladie: (_d: string, espace: EspaceVentes) => {
    faux.lectures.push(`facture ${espace}`)
    return faux.facture ? Promise.resolve(faux.facture) : new Promise(() => {})
  },
}))
vi.mock('../lib/paiementsAssuranceMaladieLecture', () => ({
  lireLesPaiementsAssuranceMaladie: (_d: string, espace: EspaceVentes) => {
    faux.lectures.push(`paye ${espace}`)
    return faux.paye ? Promise.resolve(faux.paye) : new Promise(() => {})
  },
}))
vi.mock('../components/PaiementsAssuranceMaladie', () => ({ default: () => null }))
vi.mock('../components/FactureAssuranceMaladie', () => ({ default: () => null }))
vi.mock('../lib/codeNafDuDossierLecture', () => ({ useCodeNafDuDossier: () => faux.codeNaf }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', session: { user: { id: 'u-client' }, access_token: 'jeton-fictif' } }),
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string) => {
        if (nom === 'droits_sur_le_dossier') {
          return Promise.resolve({ data: { cabinet: false, membre: true, ventes: false, banque: true }, error: null })
        }
        faux.rpcs.push(nom)
        return Promise.resolve({ data: null, error: null })
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        const ecrire = (op: string) => () => { faux.ecritures.push(`${table} ${op}`); return c }
        Object.assign(c, {
          select: () => c,
          eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          insert: ecrire('insert'), update: ecrire('update'), delete: ecrire('delete'), upsert: ecrire('upsert'),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(() => {
            const toutes = filtrer(faux.tables[table], predicats)
            return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length)), error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ─────────────────────────────────────────────────────────────────────────────────────────────────
const mouvement = (o: Partial<MouvementDuClient>): MouvementDuClient => ({
  id: 'l0', dossier_id: 'd1', date: '2026-03-15', libelle: 'VIR FICTIF CPAM', montant: 100, statut: 'non_rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
  declaration_tva_id: null, prelevement_personnel: false, encaissements_de_factures: false, created_at: '2026-03-20T08:00:00Z',
  compte_bancaire_id: 'P', ...o,
})
const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const importFacture = (premier: string, dernier: string): ImportFacturesAssuranceMaladie => ({
  id: `if-${premier}`, dossier_id: 'd1', premier_lot_le: premier, dernier_lot_le: dernier, nombre_de_lots: 1, nombre_de_factures: 3,
  importe_par: 'u-client', importe_le: '2026-04-16T09:00:00Z',
})
const total = (date: string, montant: number): Total => ({
  id: `t-${date}`, dossier_id: 'd1', import_id: 'if-x', date_creation_lot: date, part: 'obligatoire', regime: 1, caisse: 349,
  organisme_complementaire: null, montant_centimes: montant, nombre_de_lots: 1, nombre_de_factures: 3,
})
const importPaye = (du: string, au: string): ImportAssuranceMaladie => ({
  id: `ip-${du}`, dossier_id: 'd1', periode_du: du, periode_au: au, nombre_de_rejets: null, montant_rejete_centimes: null,
  importe_par: 'u-client', importe_le: '2026-04-16T09:00:00Z',
})
const paiement = (date: string, montant: number): PaiementAssuranceMaladie => ({
  id: `p-${date}`, dossier_id: 'd1', import_id: 'ip-x', date_journee_comptable: date, regime: 1, caisse: 349, organisme_complementaire: null,
  part: 'obligatoire', montant_centimes: montant, regularisations_centimes: 0, nombre_de_factures: 2,
})
const factureLue = (complete = true): FactureLu => ({
  dossierId: 'd1', etat: 'lus', imports: lue([importFacture('2026-03-02', '2026-03-30')]),
  totaux: lue([total('2026-03-02', 10_000), total('2026-03-30', 4_000)], complete),
})
const payeLu = (): PaiementsLus => ({
  dossierId: 'd1', etat: 'lus', imports: lue([importPaye('2026-03-05', '2026-04-10')]), paiements: lue([paiement('2026-03-09', 10_000)]),
  associations: null, remplacements: null,
})

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-04-20T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  Object.assign(faux, { drapeau: false, codeNaf: '86.90E', facture: null, paye: null, lectures: [], ecritures: [], rpcs: [] })
  faux.tables = {
    lignes_bancaires: [{ ...mouvement({ id: 'l1' }) }],
    justificatifs_proposes: [], precisions_mouvements: [], reglements_groupes: [], pieces: [],
    controles_releves_bancaires: [], factures_emises: [], encaissements_factures: [],
  }
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
const texteDe = (e: HTMLElement) => (e.textContent ?? '').replace(BLANCS_INSECABLES, ' ')

describe('« Ma banque » : ce que l’assurance maladie te doit (DU-Q3)', () => {
  it('drapeau baissé : rien n’est lu pour la section, rien ne se monte', async () => {
    faux.facture = factureLue(); faux.paye = payeLu()
    await monter()
    expect(faux.lectures).toEqual([])
    expect(screen.queryByRole('region', { name: TITRE_DU_DU_AU_CLIENT })).toBeNull()
    expect(document.body.textContent).not.toMatch(/assurance maladie/)
  })

  it('drapeau levé : la section aux mots du client, lue en espace client, la période commune dite, sans bouton ni champ', async () => {
    faux.drapeau = true; faux.facture = factureLue(); faux.paye = payeLu()
    await monter()
    expect([...faux.lectures].sort()).toEqual(['facture client', 'paye client'])
    const section = await screen.findByRole('region', { name: TITRE_DU_DU_AU_CLIENT })
    const t = texteDe(section)
    expect(t).toContain(PRESENTATION_DU_DU_AU_CLIENT)
    expect(t).toContain('Lots créés du 05/03/2026 au 30/03/2026, la période que tes bordereaux et tes paiements importés couvrent ensemble.')
    expect(within(section).getByRole('table').textContent).toContain('CPAM, caisse 349')
    expect(t).toMatch(/40,00 €/)
    expect(within(section).queryAllByRole('button')).toEqual([])
    expect(section.querySelectorAll('input, select, textarea')).toHaveLength(0)
    expect(motsDuCabinet(t)).toEqual([])
    expect(t).not.toMatch(/impay|praticien/i)
  })

  it('drapeau levé, une lecture partielle : dite, aucun chiffre, aucun tableau', async () => {
    faux.drapeau = true; faux.facture = factureLue(false); faux.paye = payeLu()
    await monter()
    const section = await screen.findByRole('region', { name: TITRE_DU_DU_AU_CLIENT })
    expect(texteDe(section)).toContain('Rien n’est confronté : les bordereaux n’ont pas pu être lus en entier.')
    expect(within(section).queryByRole('table')).toBeNull()
    expect(texteDe(section)).not.toMatch(/€/)
    expect(within(section).queryAllByRole('button')).toEqual([])
  })

  it('drapeau levé, un code hors de la santé et aucun import lu : rien ne se dit au client', async () => {
    faux.drapeau = true; faux.codeNaf = '62.01Z'
    faux.facture = { dossierId: 'd1', etat: 'lus', imports: lue([]), totaux: lue([]) }
    faux.paye = { dossierId: 'd1', etat: 'lus', imports: lue([]), paiements: lue([]), associations: null, remplacements: null }
    await monter()
    expect(screen.queryByRole('region', { name: TITRE_DU_DU_AU_CLIENT })).toBeNull()
  })
})
