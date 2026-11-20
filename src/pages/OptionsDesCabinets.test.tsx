import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CABINET_NEUF } from '../lib/optionsDuCabinetVue'
import SuperAdminPage from './SuperAdminPage'

// LES MODULES DES CABINETS, À L'ÉCRAN DU SUPER-ADMINISTRATEUR (conception 56, OPT4). Le drapeau de la migration d'OPT1 joué
// dans ses deux états par un accesseur : baissé, rien n'apparaît et rien ne lit la table ; levé, les huit cases par cabinet,
// lues en entier, un cabinet neuf dit, le refus de la base dit avant le clic, un clic confirmé qui ne part qu'une fois même
// cliqué deux fois dans le même rendu, l'échec dit dans la fenêtre, et une lecture partielle qui n'offre aucun geste.

const faux = vi.hoisted(() => ({
  prevues: false,
  tables: {} as Record<string, Record<string, unknown>[]>,
  /** Une table dont la lecture annonce plus de lignes qu'elle n'en rend : lue en partie. */
  tronquee: null as string | null,
  lectures: [] as string[],
  reglages: [] as Record<string, unknown>[],
  porte: null as Promise<void> | null,
  erreurDuReglage: null as { message: string; code: string } | null,
}))

vi.mock('../lib/modulesDuCabinet', async (original) => {
  const m = await original<typeof import('../lib/modulesDuCabinet')>()
  return { ...m, get OPTIONS_DES_CABINETS_PREVUES() { return faux.prevues } }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Le faux client applique le seul filtre que ces lectures posent (`eq`) et la tranche demandée, et annonce son compte.
    from: (table: string) => {
      faux.lectures.push(table)
      const filtres: [string, unknown][] = []
      let tranche: [number, number] = [0, Number.MAX_SAFE_INTEGER]
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: (colonne: string, valeur: unknown) => { filtres.push([colonne, valeur]); return chaine },
        order: () => chaine,
        range: (debut: number, fin: number) => { tranche = [debut, fin]; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const lignes = (faux.tables[table] ?? []).filter((l) => filtres.every(([c, v]) => l[c] === v))
          return Promise.resolve({
            data: lignes.slice(tranche[0], tranche[1] + 1), error: null, count: lignes.length + (faux.tronquee === table ? 1 : 0),
          }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string, params: Record<string, unknown>) => {
      // Les plafonds de l'assistant (OPT1-Q3, en production depuis le 20/11/2026), que l'écran des cabinets lit au chargement :
      // une lecture paginée, hors des réglages que ces tests comptent ; aucun plafond posé.
      if (nom === 'plafonds_de_l_assistant') {
        const lignes = (faux.tables.cabinets ?? []).map((c) => ({ cabinet_id: c.id, limite_ia_alerte_usd: null, limite_ia_blocage_usd: null }))
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          order: () => chaine,
          range: () => chaine,
          then: (suite: (r: unknown) => unknown) => Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite),
        })
        return chaine
      }
      return (async () => {
        faux.reglages.push({ nom, ...params })
        await faux.porte
        return faux.erreurDuReglage ? { data: null, error: faux.erreurDuReglage } : { data: [], error: null }
      })()
    },
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  },
}))

vi.mock('./RestaurationCard', () => ({ default: () => null }))

const TOUS = ['tenue', 'facturation', 'facture_electronique', 'assurance_maladie', 'espace_client', 'assistant', 'honoraires', 'connexion_bancaire']

beforeEach(() => {
  faux.prevues = true
  faux.tronquee = null
  faux.lectures = []
  faux.reglages = []
  faux.porte = null
  faux.erreurDuReglage = null
  faux.tables = {
    cabinets: [
      { id: 'c1', nom: 'Cabinet Fictif', created_at: '2026-01-01T00:00:00Z' },
      { id: 'c2', nom: 'Cabinet Neuf', created_at: '2026-11-19T00:00:00Z' },
    ],
    // Le premier cabinet a tout ouvert, sauf la connexion bancaire (une ligne fermée) ; le second n'a aucune ligne.
    options_des_cabinets: TOUS.map((module) => ({ cabinet_id: 'c1', module, ouverte: module !== 'connexion_bancaire' })),
    dossiers: [{ id: 'd1', cabinet_id: 'c1', nom: 'Dossier Envoyé', ventes_par_les_factures: false }],
    transmissions_factures: [{ id: 't1', dossier_id: 'd1', etat: 'envoi' }, { id: 't2', dossier_id: 'autre', etat: 'accepte' }],
    transmissions_encaissements: [],
  }
})

function retenirLeReglage(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porte = null
    await act(async () => { ouvrir() })
  }
}

async function afficher() {
  await act(async () => { render(<SuperAdminPage />) })
}

const cabinet = (nom: string) => within(screen.getByRole('group', { name: nom }))
const caseDe = (nom: string, module: string) => cabinet(nom).getByLabelText(module) as HTMLInputElement

describe('OptionsDesCabinets — le drapeau', () => {
  it('baissé : ni la section ni aucune lecture des options, des dossiers par nom ou des transmissions', async () => {
    faux.prevues = false
    await afficher()
    expect(screen.queryByRole('heading', { name: 'Modules des cabinets' })).toBeNull()
    expect(faux.lectures).not.toContain('options_des_cabinets')
    expect(faux.lectures).not.toContain('transmissions_factures')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('OptionsDesCabinets — levé', () => {
  it('les huit cases par cabinet, lues ; un cabinet neuf dit son socle seul ; les refus de la base dits avant le clic', async () => {
    await afficher()
    expect(screen.getByRole('heading', { name: 'Modules des cabinets' })).toBeTruthy()
    expect(cabinet('Cabinet Fictif').getAllByRole('checkbox')).toHaveLength(8)
    expect(caseDe('Cabinet Fictif', 'Tenue et déclarations').checked).toBe(true)
    expect(caseDe('Cabinet Fictif', 'Connexion bancaire').checked).toBe(false)
    // La facturation, que les honoraires supposent : la case ne s'offre pas, le refus est dit sous elle.
    const facturation = caseDe('Cabinet Fictif', 'Facturation')
    expect(facturation.disabled).toBe(true)
    expect(document.getElementById(facturation.getAttribute('aria-describedby')!)?.textContent)
      .toContain('ne se ferme pas tant qu\'un module qui le suppose est ouvert : « Honoraires du cabinet »')
    // La facture électronique : un envoi sans issue connue de son dossier, nommé.
    const electronique = caseDe('Cabinet Fictif', 'Facture électronique')
    expect(electronique.disabled).toBe(true)
    expect(document.getElementById(electronique.getAttribute('aria-describedby')!)?.textContent)
      .toContain('« Dossier Envoyé »')
    // Le cabinet neuf : tout fermé, dit, chaque case offerte.
    expect(cabinet('Cabinet Neuf').getByText(CABINET_NEUF)).toBeTruthy()
    const neuves = cabinet('Cabinet Neuf').getAllByRole('checkbox') as HTMLInputElement[]
    expect(neuves.every((c) => !c.checked && !c.disabled)).toBe(true)
    expect(faux.reglages).toEqual([])
  })

  it('un clic ouvre une confirmation qui nomme le cabinet et le module ; deux clics du même rendu ne règlent qu’une fois, puis l’écran relit', async () => {
    await afficher()
    await act(async () => { fireEvent.click(caseDe('Cabinet Fictif', 'Connexion bancaire')) })
    const fenetre = within(screen.getByRole('dialog'))
    expect(fenetre.getByRole('heading', { name: 'Ouvrir le module « Connexion bancaire » au cabinet « Cabinet Fictif » ?' })).toBeTruthy()
    expect(faux.reglages).toEqual([])
    const lecturesAvant = faux.lectures.filter((t) => t === 'options_des_cabinets').length
    const liberer = retenirLeReglage()
    const bouton = fenetre.getByRole('button', { name: 'Ouvrir le module' })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.reglages).toEqual([{ nom: 'regler_option_du_cabinet', p_cabinet_id: 'c1', p_module: 'connexion_bancaire', p_ouverte: true }])
    // La base a ouvert le module : la relecture le montre coché, la fenêtre se ferme.
    faux.tables.options_des_cabinets = TOUS.map((module) => ({ cabinet_id: 'c1', module, ouverte: true }))
    await liberer()
    expect(faux.lectures.filter((t) => t === 'options_des_cabinets').length).toBe(lecturesAvant + 1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(caseDe('Cabinet Fictif', 'Connexion bancaire').checked).toBe(true)
  })

  it('le cas à trois clics : un seul réglage', async () => {
    await afficher()
    await act(async () => { fireEvent.click(caseDe('Cabinet Neuf', 'Assistant IA')) })
    const liberer = retenirLeReglage()
    const bouton = screen.getByRole('button', { name: 'Ouvrir le module' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.reglages).toHaveLength(1)
    await liberer()
  })

  it('le refus de la base se dit dans la fenêtre, aux mots de la base, et le verrou se relâche', async () => {
    faux.erreurDuReglage = { message: 'Seul le super-administrateur règle les options d\'un cabinet.', code: '42501' }
    await afficher()
    await act(async () => { fireEvent.click(caseDe('Cabinet Fictif', 'Tenue et déclarations')) })
    expect(screen.getByRole('heading', { name: 'Fermer le module « Tenue et déclarations » au cabinet « Cabinet Fictif » ?' })).toBeTruthy()
    expect(screen.getByText(/Rien n’est supprimé/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Fermer le module' }).click() })
    expect(within(screen.getByRole('dialog')).getByText('Seul le super-administrateur règle les options d\'un cabinet.')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Fermer le module' }).click() })
    expect(faux.reglages).toHaveLength(2)
    expect(faux.reglages[0]).toMatchObject({ p_module: 'tenue', p_ouverte: false })
  })

  it('une lecture partielle se dit, et l’écran n’offre aucune case', async () => {
    faux.tronquee = 'transmissions_factures'
    await afficher()
    expect(screen.getByText(/Les cabinets, leurs options et ce qui retient une fermeture n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('un cabinet aux options illisibles le dit, sans case ; les autres gardent les leurs', async () => {
    faux.tables.options_des_cabinets = [{ cabinet_id: 'c1', module: 'compta', ouverte: true }]
    await afficher()
    expect(cabinet('Cabinet Fictif').getByText(/Les options de ce cabinet ne sont pas lisibles/)).toBeTruthy()
    expect(cabinet('Cabinet Fictif').queryAllByRole('checkbox')).toHaveLength(0)
    expect(cabinet('Cabinet Neuf').getAllByRole('checkbox')).toHaveLength(8)
  })
})
