import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import { versionParametres } from '../../test/parametresFacturation'
import type { FactureEmise } from '../../lib/types'
import { NON_BASCULE } from '../../test/factures'

// LA VUE « PARAMÈTRES » DANS L'ONGLET FACTURES (espace client, étape A5b1), avec la VRAIE vue et son faux client. Ce que ces cas
// gardent : le sélecteur nomme « Paramètres » à la suite de « Factures », « Règlements », « Articles » et « Clients », au cabinet
// et au client « Ventes » ; la vue par défaut reste « Factures » ; la table des paramètres n'est lue que sur le clic ; le drapeau
// d'export (`PARAMETRES_FACTURATION_EXPORTES`) décide si la vue existe — rebaissé, aucun onglet « Paramètres » et aucune lecture
// de la table ; le cabinet y reconnaît « par le client » sur les accès de l'onglet, le client n'en lit aucun. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as string[],
  drapeau: true,
}))

// Le drapeau se joue dans ses DEUX états par un accesseur, lu à chaque accès (CLAUDE.md, « Tests »).
vi.mock('../../lib/parametresFacturation', async (original) => ({
  ...(await original<typeof import('../../lib/parametresFacturation')>()),
  get PARAMETRES_FACTURATION_EXPORTES() { return faux.drapeau },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: () => Promise.resolve({ data: {}, error: null }),
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
        let colonnes: string[] | null = null
        const partir = () => {
          faux.lectures.push(table)
          const toutes = filtrer(faux.tables[table], predicats)
          const rendu = toutes.slice(debut, fin + 1).map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
          return { data: rendu, error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste?: string) => {
            colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('('))
            return c
          },
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
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(partir).then(suite, echec),
        })
        return c
      },
    },
  }
})

const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }
const FACTURE: FactureEmise = factureCii([LIGNE], {
  id: 'f1', numero: 'F2027-0001', date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, tiers_nom: 'ALPHA FICTIVE SAS',
})

beforeEach(() => {
  faux.drapeau = true
  faux.lectures = []
  faux.tables = {
    factures_emises: [{ ...FACTURE }],
    facture_lignes: [{ ...LIGNE, id: 'l0', facture_id: 'f1' }],
    transmissions_factures: [],
    facture_superpdp_events: [],
    encaissements_factures: [],
    encaissements_factures_taux: [],
    transmissions_encaissements: [],
    statuts_factures_recus: [],
    lignes_bancaires: [],
    reglements_groupes: [],
    pieces: [],
    memberships: [{ id: 'ms0', user_id: 'u-client', dossier_id: 'd1', created_at: '2027-01-01T00:00:00Z' }],
    contacts: [],
    articles: [],
    parametres_facturation: [
      { ...versionParametres({ id: 'v1', auteur: 'u-cabinet' }) },
      { ...versionParametres({ id: 'v2', remplace_id: 'v1', delai_paiement_jours: 45, auteur: 'u-client', cree_le: '2027-10-02T09:00:00Z' }) },
    ],
  }
})

afterEach(() => {
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
  await screen.findByText('F2027-0001')
}

const vers = (nom: string) => fireEvent.click(screen.getByRole('tab', { name: nom }))

describe.each(['cabinet', 'client'] as const)('Paramètres dans l’onglet Factures — %s', (espace) => {
  it('le sélecteur nomme les cinq vues, « Factures » reste la vue par défaut, et la table des paramètres n’est pas lue', async () => {
    await monter(espace)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Factures', 'Règlements', 'Articles', 'Clients', 'Paramètres'])
    expect(screen.getByRole('tab', { name: 'Factures' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Paramètres' }).getAttribute('aria-selected')).toBe('false')
    expect(faux.lectures).not.toContain('parametres_facturation')
    expect(screen.queryByText('Paramètres en cours')).toBeNull()
  })

  it('« Paramètres » montre la courante du dossier, « Factures » la rend', async () => {
    await monter(espace)
    vers('Paramètres')
    expect(await screen.findByText('Paramètres en cours')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Paramètres' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('F2027-0001')).toBeNull()
    expect(faux.lectures).toContain('parametres_facturation')
    vers('Factures')
    expect(await screen.findByText('F2027-0001')).toBeTruthy()
    expect(screen.queryByText('Paramètres en cours')).toBeNull()
  })

  it('le drapeau d’export rebaissé : aucun onglet « Paramètres », aucune lecture de la table', async () => {
    faux.drapeau = false
    await monter(espace)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Factures', 'Règlements', 'Articles', 'Clients'])
    expect(faux.lectures).not.toContain('parametres_facturation')
  })
})

describe('Paramètres dans l’onglet Factures — qui est le client', () => {
  it('au cabinet : « par le client » sur les accès que l’onglet a lus', async () => {
    await monter('cabinet')
    vers('Paramètres')
    const carte = (await screen.findByText('Paramètres en cours')).closest('.card') as HTMLElement
    await vi.waitFor(() => expect(within(carte).queryByText('par le client')).not.toBeNull())
    expect(faux.lectures).toContain('memberships')
  })

  it('au client : les accès ne sont pas lus, rien n’est dit « par le client »', async () => {
    await monter('client')
    vers('Paramètres')
    await screen.findByText('Paramètres en cours')
    expect(screen.queryByText('par le client')).toBeNull()
    expect(faux.lectures).not.toContain('memberships')
  })
})
