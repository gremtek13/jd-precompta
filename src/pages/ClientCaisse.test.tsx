import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientCaisse from './ClientCaisse'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { JourDeLaCaisseDuClient, OperationDuClient } from '../lib/caisseClient'

// « MA CAISSE » (espace client, ligne 26.6, étape C12a) : l'écran du praticien qui porte la case « Caisse ». Ce que ces cas
// gardent :
//  1. « Chargement… » d'abord, rien d'offert ; la case relue à la BASE : absente ou illisible, rien n'est montré ;
//  2. la caisse lue en entier : le mois jour par jour, le solde LU, ses saisies à lui avec leurs gestes, celles de son
//     cabinet sans geste ;
//  3. une lecture partielle, une caisse qui ne se recompose pas, une année figée, un dossier qui n'est plus exonéré ni en
//     franchise, une nature absente : l'écran le dit et n'offre AUCUN geste ;
//  4. les refus de la base dits AVANT le clic, sur la saisie telle qu'elle part ;
//  5. chaque geste par sa fonction seule, après une confirmation qui nomme ce qui part, sous UN verrou relâché après la
//     relecture : deux clics dans le même `act`, un seul appel ; le refus de la base dit après le clic ;
//  6. aucune forme du cabinet dans ce qui s'affiche (`motsDuCabinet`).
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const MOI = 'u-client'

const faux = vi.hoisted(() => ({
  droits: {} as unknown,
  dossier: {} as Record<string, unknown>,
  categories: [] as Record<string, unknown>[],
  operations: [] as Record<string, unknown>[],
  jours: {} as Record<number, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  retenirLectures: false,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
  refusRpc: null as string | null,
  ecritures: [] as { nom: string; args: Record<string, unknown> }[],
  lectures: [] as string[],
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', session: { user: { id: 'u-client' }, access_token: 'jeton-fictif' } }),
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  const attendreLecture = () => (faux.retenirLectures ? new Promise<void>((r) => { faux.lecturesEnAttente.push(r) }) : Promise.resolve())
  function chaine(nom: string, lignes: () => Record<string, unknown>[]) {
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const reponse = () => {
      faux.lectures.push(nom)
      const toutes = filtrer(lignes(), predicats)
      return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[nom] ?? Infinity)), error: null, count: toutes.length }
    }
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => attendreLecture().then(() => {
        const r = reponse()
        return { data: r.data[0] ?? null, error: null }
      }),
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => attendreLecture().then(reponse).then(suite, echec),
    }
    return c
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        if (nom === 'droits_sur_le_dossier') return attendreLecture().then(() => ({ data: faux.droits, error: null }))
        if (nom === 'caisse_du_client') return chaine('caisse_du_client', () => faux.jours[args.p_annee as number] ?? [])
        faux.ecritures.push({ nom, args })
        const repondre = () => (faux.refusRpc ? { data: null, error: { message: faux.refusRpc, code: '22023' } } : { data: { id: 'neuf' }, error: null })
        if (faux.retenirRpc) return new Promise((r) => { faux.rpcEnAttente.push(() => r(repondre())) })
        return Promise.resolve(repondre())
      },
      from: (table: string) => {
        if (table === 'dossiers') return chaine(table, () => [faux.dossier])
        if (table === 'categories') return chaine(table, () => faux.categories)
        if (table === 'operations_caisse') return chaine(table, () => faux.operations)
        throw new Error(`Table non attendue : ${table}`)
      },
    },
  }
})

const operation = (o: Partial<OperationDuClient>): Record<string, unknown> => ({
  id: 'o0', dossier_id: 'd1', genre: 'recette', date: '2026-11-01', montant: 100, categorie_id: 'n1', taux_tva: null,
  encaissements_du_jour: [], piece_id: null, origine: 'client', remplace_id: null, cree_le: '2026-11-01T18:00:00Z',
  cree_par: MOI, retire_le: null, ...o,
})
const jour = (o: Partial<JourDeLaCaisseDuClient>): Record<string, unknown> => ({
  jour: '2026-11-01', report: 0, ouverture: 0, operations: 0, releve: 0, especes_des_factures: 0, encaissements_du_jour: [],
  solde: 0, fige: false, ...o,
})

// Une caisse : 50 € reportés de 2025 ; le 1er novembre, une recette du praticien (100 €), un prélèvement de son cabinet
// (30 €), une recette retirée, et des espèces d'une facture (20 €) ; le soir, 140 €.
function poser() {
  faux.droits = { cabinet: false, membre: true, ventes: false, banque: false, caisse: true }
  faux.dossier = { id: 'd1', statut_tva: 'exonere', mode_comptable: 'tresorerie', assujetti_tva: false, categorie_recettes_client: 'n1' }
  faux.categories = [{ id: 'n1', dossier_id: null, compte_comptable: '706000' }]
  faux.operations = [
    operation({ id: 'o2' }),
    operation({ id: 'o3', genre: 'prelevement', montant: 30, categorie_id: null, origine: 'cabinet', cree_par: 'u-cabinet', cree_le: '2026-11-01T19:00:00Z' }),
    operation({ id: 'o4', montant: 60, retire_le: '2026-11-01T20:00:00Z' }),
  ]
  faux.jours = {
    2026: [
      jour({ jour: '2026-01-01', report: 50, solde: 50 }),
      jour({ jour: '2026-11-01', operations: 70, especes_des_factures: 20, encaissements_du_jour: ['e1'], solde: 140 }),
    ],
  }
  faux.muetApres = {}
  faux.retenirLectures = false
  faux.lecturesEnAttente = []
  faux.retenirRpc = false
  faux.rpcEnAttente = []
  faux.refusRpc = null
  faux.ecritures = []
  faux.lectures = []
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
  poser()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function monter() {
  render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
  await screen.findByText(/Novembre 2026/)
}

const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom })
const sansBouton = (nom: string | RegExp) => expect(screen.queryByRole('button', { name: nom })).toBeNull()
function remplir(genre: string, date: string, montant: string) {
  fireEvent.change(screen.getByLabelText('Quoi'), { target: { value: genre } })
  fireEvent.change(screen.getByLabelText('Jour'), { target: { value: date } })
  fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: montant } })
}

describe('avant la lecture, et la case relue à la base', () => {
  it('dit « Chargement… » et n’offre rien tant que rien n’est revenu', async () => {
    faux.retenirLectures = true
    render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    sansBouton('Enregistrer')
    faux.retenirLectures = false
    await act(async () => { for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await screen.findByText(/Novembre 2026/)
  })

  it('sans la case « Caisse » à la base, ne montre ni n’offre rien', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: false, caisse: false }
    render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
    await screen.findByText(/Ton accès ne porte plus « Caisse »/)
    expect(screen.queryByRole('table')).toBeNull()
    sansBouton('Enregistrer')
  })

  it('des droits illisibles ferment l’écran, avec leur motif', async () => {
    faux.droits = []
    render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
    await screen.findByText(/Ta caisse ne s’affiche pas : ton accès à ta caisse n’a pas pu être vérifié \(droits illisibles\)/)
    sansBouton('Enregistrer')
  })
})

describe('la caisse lue en entier', () => {
  it('montre le mois jour par jour, le solde lu, et les gestes sur ses seules saisies', async () => {
    await monter()
    const lignes = screen.getAllByRole('row').slice(1).map((r) => r.textContent?.replace(/\s+/g, ' '))
    expect(lignes).toHaveLength(3)
    expect(lignes[0]).toMatch(/^01\/11\/2026Recettes en espèces · saisie par toi100,00\s€\s*Corriger.*Retirer/)
    expect(lignes[1]).toMatch(/Prélèvement pour toi · saisie par ton cabinet−30,00\s€/)
    expect(lignes[1]).not.toMatch(/Corriger|Retirer/)
    expect(lignes[2]).toMatch(/Espèces de tes factures, déjà dans ta caisse20,00\s€140,00\s€/)
    expect(screen.getByText(/Au 02\/11\/2026/).parentElement?.textContent).toMatch(/140,00\s€/)
    expect(screen.getByText(/Retirées ou remplacées en novembre 2026 \(1\)/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(1)
    expect(bouton('Enregistrer')).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('lue en partie : le bandeau, ni caisse ni geste', async () => {
    faux.muetApres = { operations_caisse: 1 }
    render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
    await screen.findByText(/Tes opérations de caisse n'ont pas pu être affichées en entier/)
    expect(screen.queryByRole('table')).toBeNull()
    sansBouton('Enregistrer')
    sansBouton('Retirer')
  })

  it('les jours lus en partie : le bandeau, ni caisse ni geste', async () => {
    faux.muetApres = { caisse_du_client: 1 }
    render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
    await screen.findByText(/Les jours de ta caisse n'ont pas pu être affichés en entier/)
    expect(screen.queryByRole('table')).toBeNull()
    sansBouton('Enregistrer')
  })

  it('une caisse qui ne se recompose pas : dite, sans geste', async () => {
    faux.jours[2026][1] = { ...faux.jours[2026][1], solde: 141 }
    render(<MemoryRouter><ClientCaisse /></MemoryRouter>)
    await screen.findByText(/Ta caisse ne se recompose pas sur ce qui a été lu \(le solde du 01\/11\/2026 ne se recompose pas\)/)
    sansBouton('Enregistrer')
    sansBouton('Retirer')
  })

  it('un dossier qui n’est plus exonéré ni en franchise : dit, sans geste', async () => {
    faux.dossier = { ...faux.dossier, statut_tva: 'redevable', assujetti_tva: true }
    await monter()
    expect(screen.getByText(/suppose un dossier exonéré de TVA ou en franchise en base : ton cabinet tient ta caisse/)).toBeTruthy()
    sansBouton('Enregistrer')
    sansBouton('Retirer')
    sansBouton('Corriger')
  })

  it('la nature des recettes absente : dite, sans geste', async () => {
    faux.dossier = { ...faux.dossier, categorie_recettes_client: null }
    await monter()
    expect(screen.getByText(/Ton cabinet n'a pas fixé la nature de tes recettes en espèces/)).toBeTruthy()
    sansBouton('Enregistrer')
    sansBouton('Retirer')
  })

  it('une année figée : dite, sans geste', async () => {
    faux.jours[2026] = faux.jours[2026].map((j) => ({ ...j, fige: true }))
    await monter()
    expect(screen.getByText(/Ton cabinet a validé tes comptes de 2026 : ta caisse de cette année ne change plus/)).toBeTruthy()
    sansBouton('Enregistrer')
    sansBouton('Retirer')
  })

  it('une autre année se relit, « Chargement… » d’abord', async () => {
    faux.jours[2025] = [jour({ jour: '2025-12-31', operations: 50, solde: 50 })]
    faux.operations = [...faux.operations, operation({ id: 'o1', date: '2025-12-31', montant: 50 })]
    await monter()
    faux.retenirLectures = true
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2025' } })
    expect(screen.getByText('Chargement…')).toBeTruthy()
    sansBouton('Enregistrer')
    faux.retenirLectures = false
    await act(async () => { for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await act(async () => { for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await screen.findByText(/Décembre 2025/)
    expect(faux.lectures.filter((l) => l === 'caisse_du_client').length).toBeGreaterThanOrEqual(3)
  })
})

describe('les refus de la base, avant le clic', () => {
  it('le prélèvement qui viderait la caisse, la date à venir, le montant au centime, l’année affichée', async () => {
    await monter()
    remplir('prelevement', '2026-11-01', '500')
    expect(screen.getByRole('alert').textContent).toBe('Ce prélèvement de 500,00 € rendrait la caisse négative le 01/11/2026 (−360,00 €) : saisis d\'abord les recettes en espèces qui le précèdent.')
    expect((bouton('Enregistrer') as HTMLButtonElement).disabled).toBe(true)
    remplir('apport', '2026-11-03', '10')
    expect(screen.getByRole('alert').textContent).toBe('Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 02/11/2026.')
    remplir('recette', '2026-11-02', '10,005')
    expect(screen.getByRole('alert').textContent).toBe('Le montant d\'une opération de caisse est au centime.')
    remplir('recette', '2025-11-02', '10')
    expect(screen.getByRole('alert').textContent).toMatch(/^Choisis une date de 2026/)
    expect((bouton('Enregistrer') as HTMLButtonElement).disabled).toBe(true)
    expect(faux.ecritures).toEqual([])
  })
})

describe('les gestes', () => {
  it('saisit une recette : la confirmation nomme ce qui part, un seul appel pour deux clics, puis la relecture', async () => {
    await monter()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    remplir('recette', '2026-11-01', '25,50')
    const lecturesAvant = faux.lectures.filter((l) => l === 'caisse_du_client').length
    faux.retenirRpc = true
    await act(async () => {
      fireEvent.click(bouton('Enregistrer'))
      fireEvent.click(bouton('Enregistrer'))
    })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toMatch(/^Enregistrer une recette du 01\/11\/2026 de 25,50\s€ \? Ta caisse du 01\/11\/2026 passera à 165,50\s€\./)
    expect(faux.ecritures).toEqual([{
      nom: 'enregistrer_operation_caisse',
      args: {
        p_dossier_id: 'd1', p_genre: 'recette', p_date: '2026-11-01', p_montant: 25.5, p_categorie_id: null, p_taux_tva: null,
        p_encaissements_du_jour: ['e1'], p_ecritures: null,
      },
    }])
    // Pendant l'écriture, aucun autre geste n'est offert.
    expect((bouton('Retirer') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { for (const r of faux.rpcEnAttente.splice(0)) r() })
    await screen.findByText(/^Enregistré : une recette du 01\/11\/2026/)
    expect(faux.lectures.filter((l) => l === 'caisse_du_client').length).toBe(lecturesAvant + 1)
  })

  it('ne part pas sans la confirmation', async () => {
    await monter()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    remplir('apport', '2026-11-02', '10')
    await act(async () => { fireEvent.click(bouton('Enregistrer')) })
    expect(faux.ecritures).toEqual([])
  })

  it('retire sa saisie : la confirmation, un seul appel pour deux clics', async () => {
    await monter()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirRpc = true
    await act(async () => {
      fireEvent.click(bouton('Retirer'))
      fireEvent.click(bouton('Retirer'))
    })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toMatch(/^Retirer la recette du 01\/11\/2026 de 100,00\s€ \? .* passera à 40,00\s€\.$/)
    expect(faux.ecritures).toEqual([{ nom: 'retirer_operation_caisse', args: { p_dossier_id: 'd1', p_operation_id: 'o2' } }])
    await act(async () => { for (const r of faux.rpcEnAttente.splice(0)) r() })
    await screen.findByText(/^Retiré : la recette du 01\/11\/2026/)
  })

  it('retient le retrait qui viderait la caisse, avant le clic', async () => {
    faux.operations = [...faux.operations, operation({ id: 'o5', genre: 'prelevement', date: '2026-11-02', montant: 130, categorie_id: null, cree_le: '2026-11-02T08:00:00Z' })]
    faux.jours[2026] = [...faux.jours[2026], jour({ jour: '2026-11-02', operations: -130, solde: 10 })]
    await monter()
    const retirer = screen.getAllByRole('button', { name: 'Retirer' })
    expect((retirer[0] as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/^Retirer cette recette de 100,00 € rendrait la caisse négative le 02\/11\/2026 \(−90,00 €\)/)).toBeTruthy()
  })

  it('corrige sa saisie : le formulaire la reprend, la confirmation nomme l’ancienne et la nouvelle', async () => {
    await monter()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(bouton('Corriger'))
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('100')
    fireEvent.change(screen.getByLabelText('Montant (€)'), { target: { value: '90' } })
    await act(async () => {
      fireEvent.click(bouton('Remplacer'))
      fireEvent.click(bouton('Remplacer'))
    })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toMatch(/^Remplacer la recette du 01\/11\/2026 de 100,00\s€ par une recette du 01\/11\/2026 de 90,00\s€ \?.* passera à 130,00\s€\.$/)
    expect(faux.ecritures).toEqual([{
      nom: 'remplacer_operation_caisse',
      args: {
        p_dossier_id: 'd1', p_operation_id: 'o2', p_genre: 'recette', p_date: '2026-11-01', p_montant: 90, p_categorie_id: null,
        p_taux_tva: null, p_encaissements_du_jour: ['e1'], p_ecritures: null,
      },
    }])
    await screen.findByText(/^Corrigé : une recette du 01\/11\/2026/)
    sansBouton('Remplacer')
  })

  it('dit le refus de la base après le clic, et relit', async () => {
    await monter()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refusRpc = 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.'
    await act(async () => { fireEvent.click(bouton('Retirer')) })
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Ta saisie n’a pas été retirée : Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.')
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })
})
