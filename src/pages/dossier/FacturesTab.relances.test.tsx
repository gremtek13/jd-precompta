import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import { NON_BASCULE } from '../../test/factures'

// LA RELANCE D'UNE FACTURE EN RETARD DANS L'ONGLET DES FACTURES (étape C5), `RELANCES_EXPORTEES` levé le 08/11/2026 : avec
// le VRAI onglet et un faux client qui applique les filtres. Le drapeau se joue dans ses DEUX états par un accesseur
// (CLAUDE.md, Tests : un drapeau levé garde son état d'avant éprouvé tant que son code existe). Baissé : le journal des
// relances n'est jamais lu, ni pastille « En retard » ni bouton « Relancer ». Levé : le journal lu, la pastille et le bouton
// sur une facture en retard, « Relancée le … » quand le journal la cite, et rien d'offert quand le journal est refusé ou
// quand la facture n'est pas en retard. Données FICTIVES ; « aujourd'hui » est le 4 novembre 2026.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as string[],
  refusee: null as string | null,
  relances: true,
}))

vi.mock('../../lib/relances', async (original) => ({
  ...(await original<typeof import('../../lib/relances')>()),
  get RELANCES_EXPORTEES() { return faux.relances },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string) => ({ data: null, error: { message: `Appel non attendu : ${nom}` } }),
      functions: {
        invoke: async (nom: string, options: { body: Record<string, unknown> }) => {
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') return { data: { connexion: null }, error: null }
          if (nom === 'superpdp-credentials' && options.body.action === 'status') return { data: { configured: false }, error: null }
          throw new Error(`Appel non attendu : ${nom}`)
        },
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const partir = () => {
          faux.lectures.push(table)
          if (faux.refusee === table) return { data: null, error: { message: 'permission denied' }, count: null }
          const toutes = filtrer(faux.tables[table], predicats)
          return { data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => {
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => Promise.resolve().then(partir).then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(partir).then(suite, echec),
        })
        return c
      },
    },
  }
})

// Une facture de 500 € HT validée, échue le 15/10/2026 (20 jours de retard au 04/11) ; une seconde échue le 15/12/2026.
const base = (id: string, numero: string, echeance: string) => ({
  ...factureCii([{ ordre: 0, designation: 'x', taux_tva: 20, quantite: 1, prix_unitaire_ht: 500 }], {
    id, numero, date_emission: '2026-09-15', date_echeance: echeance, emetteur_nom: 'Atelier fictif',
    emetteur_adresse: '1 rue Fictive', tiers_nom: 'Client Fictif SAS', tiers_email: 'client@exemple.test',
  }),
  acompte: false, date_versement_acompte: null, contact_id: null,
})
const EN_RETARD = () => base('f1', 'F2026-0001', '2026-10-15')
const A_JOUR = () => base('f2', 'F2026-0002', '2026-12-15')
const ligne = (id: string, factureId: string) => ({
  id, facture_id: factureId, ordre: 0, designation: 'Conseil fictif', quantite: 1, prix_unitaire_ht: 500, taux_tva: 20,
  unite: 'C62', reference: null, article_id: null, nature: null, reprise_facture_id: null,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // 10 h UTC : le 4 novembre dans les quatre fuseaux de `test:fuseaux`.
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
  faux.relances = true
  faux.lectures = []
  faux.refusee = null
  faux.tables = {
    dossiers: [{
      id: 'd1', cabinet_id: 'c1', siret: SIRET_VENDEUR, adresse: '1 rue Fictive', statut_tva: 'redevable', article_exoneration: null,
      numero_tva_attribue: false, denomination_imprimee: 'Atelier fictif SAS', forme_juridique: '5710', capital: null,
      rcs_ville: null, mentions_identite: null, mode_comptable: 'tresorerie',
    }],
    cabinets: [{ id: 'c1', nom: 'Cabinet Fictif' }],
    factures_emises: [EN_RETARD(), A_JOUR()],
    facture_lignes: [ligne('l1', 'f1'), ligne('l2', 'f2')],
    emails_envoyes: [],
    devis: [],
    devis_factures: [],
    transmissions_factures: [],
    facture_superpdp_events: [],
    encaissements_factures: [],
    encaissements_factures_taux: [],
    transmissions_encaissements: [],
    statuts_factures_recus: [],
    lignes_bancaires: [],
    reglements_groupes: [],
    pieces: [],
    memberships: [],
    articles: [],
    contacts: [],
    parametres_facturation: [],
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function monter(espace: 'cabinet' | 'client') {
  const commun = {
    dossierId: 'd1', dossierNom: 'Atelier fictif', dossierSiret: SIRET_VENDEUR, dossierAdresse: '1 rue Fictive',
    statutTva: 'redevable' as const, articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false,
  }
  render(espace === 'client'
    ? <FacturesTab reglageDesVentes={NON_BASCULE} espace="client" banque={false} {...commun} />
    : <FacturesTab reglageDesVentes={NON_BASCULE} espace="cabinet" compteCaisse="530000" onAdresseUpdated={() => {}} {...commun} />)
  await screen.findByText('F2026-0001')
  await vi.waitFor(() => expect(screen.queryByText(/Chargement…/)).toBeNull())
}

const ligneDe = (texte: string) => screen.getAllByRole('row').find((r) => r.textContent?.includes(texte)) as HTMLElement
const boutonsRelancer = () => screen.queryAllByRole('button', { name: 'Relancer' })

describe.each(['cabinet', 'client'] as const)('la relance d’une facture en retard — %s', (espace) => {
  it('drapeau baissé : le journal des relances n’est jamais lu, ni pastille « En retard » ni bouton « Relancer »', async () => {
    faux.relances = false
    faux.tables.emails_envoyes = [{ id: 'e1', dossier_id: 'd1', type: 'relance_facture', facture_id: 'f1', created_at: '2026-10-30T09:00:00Z' }]
    await monter(espace)
    expect(faux.lectures).not.toContain('emails_envoyes')
    expect(boutonsRelancer()).toEqual([])
    expect(screen.queryByText(/En retard/)).toBeNull()
    expect(screen.queryByText(/Relancée le/)).toBeNull()
    expect(screen.queryByText(/relances déjà envoyées/)).toBeNull()
  })

  it('drapeau levé : le journal lu, la pastille et le bouton sur la facture en retard seulement', async () => {
    await monter(espace)
    expect(faux.lectures).toContain('emails_envoyes')
    expect(boutonsRelancer()).toHaveLength(1)
    expect(ligneDe('F2026-0001').textContent).toContain('En retard — 20 j')
    expect(ligneDe('F2026-0001').textContent).not.toContain('Relancée le')
    expect(within(ligneDe('F2026-0001')).getByRole('button', { name: 'Relancer' })).toBeTruthy()
    expect(ligneDe('F2026-0002').textContent).not.toContain('En retard')
    expect(ligneDe('F2026-0002').textContent).not.toContain('Relancer')
  })

  it('drapeau levé : une relance du journal se dit « Relancée le … » sur sa facture, au jour de Paris', async () => {
    faux.tables.emails_envoyes = [
      { id: 'e1', dossier_id: 'd1', type: 'relance_facture', facture_id: 'f1', created_at: '2026-10-30T09:00:00Z' },
      // Un autre type d'e-mail, de la même facture : ce n'est pas une relance.
      { id: 'e2', dossier_id: 'd1', type: 'facture', facture_id: 'f1', created_at: '2026-11-02T09:00:00Z' },
    ]
    await monter(espace)
    expect(ligneDe('F2026-0001').textContent).toContain('Relancée le 30/10/2026')
    expect(boutonsRelancer()).toHaveLength(1)
  })

  it('drapeau levé, journal refusé : ni « Relancée le … » ni « Relancer », et l’écran le dit', async () => {
    faux.refusee = 'emails_envoyes'
    await monter(espace)
    expect(faux.lectures).toContain('emails_envoyes')
    expect(boutonsRelancer()).toEqual([])
    expect(screen.getByText(/Les relances déjà envoyées n’ont pas pu être lues/)).toBeTruthy()
  })
})
