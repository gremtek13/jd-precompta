import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatMoney } from '../lib/format'
import { COURBE_A_VENIR, SOLDE_ILLISIBLE, SOLDE_MUET, SOLDE_SANS_RELEVE, TITRE_DU_SOLDE } from '../lib/soldeDeLAccueil'
import ClientHome from './ClientHome'

// LE SOLDE DU COMPTE SUR L'ACCUEIL DU CLIENT (demande du cabinet du 16/11/2026) : avec « Banque » sur la société affichée, le
// solde LU au dernier relevé contrôlé, sa date, la courbe des relevés et le lien vers « Ma banque » ; sans « Banque » (à la
// connexion ou à la base), aucune carte ; lue en partie, refusée ou pas revenue, ni montant ni courbe, et une ligne qui le dit.
// La règle : soldeDeLAccueil.test.ts. Données FICTIVES.

const faux = vi.hoisted(() => ({
  droitBanque: true,
  baseBanque: true as boolean | 'refus',
  controles: [] as unknown[],
  // Le total annoncé des relevés : plus grand que les lignes rendues, la lecture est partielle.
  annonce: null as number | null,
  // La réponse des droits attend que le test la libère : l'écran se regarde PENDANT la lecture.
  porte: null as Promise<void> | null,
  demandees: [] as string[],
  rpcs: [] as string[],
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))
// Les cartes voisines ont leurs tests : ici, le solde seul.
vi.mock('./AccueilVentesClient', () => ({ default: () => null }))
vi.mock('./EcheancierAccueil', () => ({ default: () => null }))
vi.mock('../components/CarteEtatDuDossier', () => ({ default: () => null }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: table === 'dossiers' ? { id: 'd-a', nom: 'Atelier fictif' } : null, error: null }),
        then: (suite: (r: unknown) => unknown) => {
          faux.demandees.push(table)
          const toutes = table === 'controles_releves_bancaires' ? faux.controles : []
          const count = table === 'controles_releves_bancaires' && faux.annonce !== null ? faux.annonce : toutes.length
          return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string) => {
      faux.rpcs.push(nom)
      const reponse = async () => {
        if (nom === 'droits_sur_le_dossier') {
          await faux.porte
          if (faux.baseBanque === 'refus') return { data: null, error: { message: 'refusé' }, count: null, status: 400, statusText: '' }
          return { data: { ventes: false, banque: faux.baseBanque }, error: null, count: null, status: 200, statusText: '' }
        }
        if (nom === 'dernier_changement_de_rib') return { data: { changement: null }, error: null, count: null, status: 200, statusText: '' }
        return { data: [], error: null, count: null, status: 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    dossierActifId: 'd-a', prenom: null, mesSocietes: [],
    droitsParDossier: { 'd-a': { ventes: false, banque: faux.droitBanque } },
  }),
}))

const ctl = (id: string, periode_fin: string, solde_final: number) => ({
  id, solde_final, coherent: true, periode_fin, created_at: `${periode_fin}T08:00:00Z`,
})
const TROIS_RELEVES = [ctl('c1', '2026-06-30', 11215.8), ctl('c2', '2026-07-31', 10640.55), ctl('c3', '2026-08-31', 12480.35)]

const carte = () => screen.queryByRole('heading', { name: TITRE_DU_SOLDE })?.closest('section') ?? null
const texteDeLaCarte = () => (carte()?.textContent ?? '').replace(/\s+/g, ' ')

function poser(o: Partial<typeof faux> = {}) {
  Object.assign(faux, { droitBanque: true, baseBanque: true, controles: TROIS_RELEVES, annonce: null, porte: null, demandees: [], rpcs: [] }, o)
}

function monter() {
  return render(<MemoryRouter><ClientHome /></MemoryRouter>)
}

beforeEach(() => poser())

describe('ClientHome — le solde du compte', () => {
  it('avec « Banque » : le solde LU au dernier relevé contrôlé, sa date, la courbe et le lien vers « Ma banque »', async () => {
    monter()
    await screen.findByRole('heading', { name: TITRE_DU_SOLDE })
    await waitFor(() => expect(carte()?.textContent).toContain(formatMoney(12480.35)))
    expect(texteDeLaCarte()).toContain('au relevé du 31/08/2026')
    expect(texteDeLaCarte()).toContain('Tes 3 derniers relevés, du 30/06/2026 au 31/08/2026')
    expect(carte()?.querySelector('svg.sparkline')).not.toBeNull()
    expect(carte()?.querySelector('a[href="/ma-banque"]')?.textContent).toBe('Voir ma banque')
    // La case relue à la base, dans la même vague que les relevés.
    expect(faux.rpcs).toContain('droits_sur_le_dossier')
    expect(faux.demandees).toContain('controles_releves_bancaires')
    // Jamais un solde calculé : aucun mouvement n'est lu.
    expect(faux.demandees).not.toContain('lignes_bancaires')
  })

  it('sans « Banque » sur la société affichée : aucune carte, et rien n’est lu pour elle', async () => {
    poser({ droitBanque: false })
    monter()
    await screen.findByText("Ce qu'il reste à envoyer")
    expect(carte()).toBeNull()
    expect(faux.rpcs).not.toContain('droits_sur_le_dossier')
    expect(faux.demandees).not.toContain('controles_releves_bancaires')
  })

  it('la base ne voit plus la case « Banque » : la carte disparaît, sans montant', async () => {
    poser({ baseBanque: false })
    monter()
    await waitFor(() => expect(faux.rpcs).toContain('droits_sur_le_dossier'))
    await waitFor(() => expect(screen.queryByLabelText('Chargement de ton solde')).toBeNull())
    expect(carte()).toBeNull()
    expect(document.body.textContent).not.toContain(formatMoney(12480.35))
  })

  it('pendant la lecture : un squelette, aucun montant', async () => {
    let ouvrir = () => {}
    poser({ porte: new Promise<void>((r) => { ouvrir = r }) })
    monter()
    expect(await screen.findByLabelText('Chargement de ton solde')).toBeTruthy()
    expect(carte()).toBeNull()
    ouvrir()
    await waitFor(() => expect(carte()?.textContent).toContain(formatMoney(12480.35)))
  })

  it('lue en partie : la ligne qui le dit, ni montant ni courbe', async () => {
    poser({ annonce: 5 })
    monter()
    await waitFor(() => expect(texteDeLaCarte()).toContain(SOLDE_MUET))
    expect(texteDeLaCarte()).not.toContain('€')
    expect(carte()?.querySelector('svg.sparkline')).toBeNull()
  })

  it('les droits illisibles : la ligne qui le dit, aucun montant', async () => {
    poser({ baseBanque: 'refus' })
    monter()
    await waitFor(() => expect(texteDeLaCarte()).toContain(SOLDE_ILLISIBLE))
    expect(texteDeLaCarte()).not.toContain('€')
  })

  it('un seul relevé : le montant, pas de courbe, et la phrase qui l’annonce', async () => {
    poser({ controles: [ctl('c3', '2026-08-31', 12480.35)] })
    monter()
    await waitFor(() => expect(carte()?.textContent).toContain(formatMoney(12480.35)))
    expect(carte()?.querySelector('svg.sparkline')).toBeNull()
    expect(texteDeLaCarte()).toContain(COURBE_A_VENIR)
  })

  it('aucun relevé contrôlé : dit, jamais « 0,00 € »', async () => {
    poser({ controles: [] })
    monter()
    await waitFor(() => expect(texteDeLaCarte()).toContain(SOLDE_SANS_RELEVE))
    expect(texteDeLaCarte()).not.toContain('€')
  })
})
