import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import { contact } from '../../test/contacts'
import type { ArticleExoneration, FactureEmise } from '../../lib/types'

// LA VUE « CLIENTS » DANS L'ONGLET FACTURES (espace client, étape A4b1), avec la VRAIE vue et son faux client. Ce que ces cas
// gardent : le sélecteur nomme « Clients » à la suite de « Factures », « Règlements » et « Articles », au cabinet et au client
// « Ventes » ; la vue par défaut reste « Factures » ; la vue ne lit la table des contacts que sur le clic ; le drapeau d'export
// (`CONTACTS_EXPORTES`) décide si la vue existe — rebaissé, aucun onglet « Clients » et aucune lecture de la table ; le cabinet y
// reconnaît « par le client » sur les accès de l'onglet, le client n'en lit aucun ; l'article d'exonération du dossier, que
// l'onglet reçoit, arrive à la vue (un dossier de soins dit sa règle). Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as string[],
  drapeau: true,
}))

// Le drapeau se joue dans ses DEUX états par un accesseur, lu à chaque accès (CLAUDE.md, « Tests »).
vi.mock('../../lib/contacts', async (original) => ({
  ...(await original<typeof import('../../lib/contacts')>()),
  get CONTACTS_EXPORTES() { return faux.drapeau },
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
    contacts: [
      { ...contact({ id: 'c1', nom: 'Société Essai' }) },
      { ...contact({ id: 'c2', nom: 'Commune de Démoville', siren: '100000207', siret: '10000020700017', type_client: 'organisme_public', cree_par: 'u-client' }) },
    ],
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function monter(espace: 'cabinet' | 'client', articleExoneration: ArticleExoneration | null = null) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Atelier fictif', dossierSiret: SIRET_VENDEUR, dossierAdresse: '1 rue Fictive',
    statutTva: 'redevable' as const, articleExoneration, numeroTvaAttribue: false, tvaSurDebits: false,
  }
  render(espace === 'client'
    ? <FacturesTab espace="client" banque={false} {...commun} />
    : <FacturesTab espace="cabinet" onAdresseUpdated={() => {}} {...commun} />)
  await screen.findByText('F2027-0001')
}

const vers = (nom: string) => fireEvent.click(screen.getByRole('tab', { name: nom }))

describe.each(['cabinet', 'client'] as const)('Clients dans l’onglet Factures — %s', (espace) => {
  it('le sélecteur nomme les cinq vues, « Factures » reste la vue par défaut, et la table des contacts n’est pas lue', async () => {
    await monter(espace)
    const onglets = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(onglets).toEqual(['Factures', 'Règlements', 'Articles', 'Clients', 'Paramètres'])
    expect(screen.getByRole('tab', { name: 'Factures' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Clients' }).getAttribute('aria-selected')).toBe('false')
    // Rien ne part vers la table des contacts avant le clic : ni lecture, ni liste.
    expect(faux.lectures).not.toContain('contacts')
    expect(screen.queryByRole('table', { name: 'Clients' })).toBeNull()
  })

  it('« Clients » montre la liste du dossier, « Factures » la rend', async () => {
    await monter(espace)
    vers('Clients')
    const tableau = await screen.findByRole('table', { name: 'Clients' })
    expect(within(tableau).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'Clients' }).getAttribute('aria-selected')).toBe('true')
    // La liste des factures cède la place : sa suite légale n'est pas sous les clients.
    expect(screen.queryByText('F2027-0001')).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Nouvelle facture' })).toBeNull()
    expect(faux.lectures).toContain('contacts')
    vers('Factures')
    expect(await screen.findByText('F2027-0001')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Clients' })).toBeNull()
  })

  it('le drapeau d’export rebaissé : aucun onglet « Clients », aucune lecture de la table', async () => {
    faux.drapeau = false
    await monter(espace)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Factures', 'Règlements', 'Articles', 'Paramètres'])
    expect(screen.queryByRole('tab', { name: 'Clients' })).toBeNull()
    expect(faux.lectures).not.toContain('contacts')
  })

  it('l’article d’exonération du dossier arrive à la vue : un dossier de soins dit sa règle, un autre non', async () => {
    await monter(espace, 'cgi_261_4_1')
    vers('Clients')
    await screen.findByRole('table', { name: 'Clients' })
    expect(screen.getByText(/soins exonérés \(art\. 261, 4, 1° du CGI\)/)).toBeTruthy()
  })

  it('un dossier hors des soins ne dit rien de la règle', async () => {
    await monter(espace)
    vers('Clients')
    await screen.findByRole('table', { name: 'Clients' })
    expect(screen.queryByText(/soins exonérés/)).toBeNull()
  })
})

describe('Clients dans l’onglet Factures — qui est le client', () => {
  it('au cabinet : « par le client » sur les accès que l’onglet a lus', async () => {
    await monter('cabinet')
    vers('Clients')
    const commune = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Commune de Démoville')) as HTMLElement
    await vi.waitFor(() => expect(within(commune).queryByText('par le client')).not.toBeNull())
    const societe = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Société Essai')) as HTMLElement
    expect(within(societe).queryByText('par le client')).toBeNull()
    expect(faux.lectures).toContain('memberships')
  })

  it('au client : les accès ne sont pas lus, rien n’est dit « par le client »', async () => {
    await monter('client')
    vers('Clients')
    await screen.findByRole('table', { name: 'Clients' })
    expect(screen.queryByText('par le client')).toBeNull()
    expect(faux.lectures).not.toContain('memberships')
  })
})
