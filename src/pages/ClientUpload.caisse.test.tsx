import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { JourDeLaCaisseDuClient, OperationDuClient } from '../lib/caisseClient'
import type { Piece } from '../lib/types'

// « MES PIÈCES » ET LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (espace client, ligne 26.6, étape C12b ; CAISSE2-Q4, (A)). Ce que ces
// cas gardent, et qu'aucun calcul pur ne voit :
//  1. sans la case « Caisse », « Mes pièces » est celle d'hier : rien de la caisse ne se lit ni ne s'affiche ;
//  2. avec elle, rien n'est offert avant le retour de la caisse, ni sur une caisse lue en partie, ni sur des pièces lues en
//     partie ; la case relue à la base sans « Caisse » ne montre rien ;
//  3. le montant de la pièce ne s'affiche JAMAIS ; le sens des espèces vient de la pièce ; les refus se disent avant le clic ;
//  4. le paiement par sa fonction seule, après une confirmation qui nomme ce qui part, sous UN verrou relâché après la
//     relecture : deux clics dans le même `act`, un seul appel ; le refus de la base, aux mots du client, après le clic ;
//  5. « par toi » sur ses seules saisies, « Retirer » sur elles seules ;
//  5b. UN verrou pour « Mes pièces » entière : tant qu'un paiement n'est pas relu, le geste d'une autre pièce est retenu (bouton
//     désactivé, clic sans effet même avant le rendu), et un seul appel part ; un paiement plus ancien que la caisse lue dit
//     au praticien de s'adresser au cabinet au lieu d'un faux motif ;
//  6. aucune forme du cabinet dans ce qui s'affiche (`motsDuCabinet`).
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const MOI = 'u-client'

const faux = vi.hoisted(() => ({
  avecCaisse: true,
  droits: {} as unknown,
  pieces: [] as Record<string, unknown>[],
  operations: [] as Record<string, unknown>[],
  jours: {} as Record<number, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  retenirCaisse: false,
  caisseEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
  refusRpc: null as string | null,
  ecritures: [] as { nom: string; args: Record<string, unknown> }[],
  lectures: [] as string[],
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    dossierActifId: 'd1',
    session: { user: { id: 'u-client' }, access_token: 'jeton-fictif' },
    droitsParDossier: { d1: { ventes: false, banque: false, caisse: faux.avecCaisse } },
  }),
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  const { couvertureDe } = await import('../test/couvertureDuReleve')
  const LECTURES_DE_LA_CAISSE = new Set(['droits_sur_le_dossier', 'caisse_du_client', 'operations_caisse', 'dossiers-caisse'])
  const attendre = (nom: string) => (faux.retenirCaisse && LECTURES_DE_LA_CAISSE.has(nom)
    ? new Promise<void>((r) => { faux.caisseEnAttente.push(r) }) : Promise.resolve())
  function chaine(nom: string, lignes: () => Record<string, unknown>[]) {
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    let colonnes = ''
    const reponse = () => {
      faux.lectures.push(nom)
      const toutes = filtrer(lignes(), predicats)
      return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[nom] ?? Infinity)), error: null, count: toutes.length }
    }
    const c: Record<string, unknown> = {
      select: (cols?: string) => { colonnes = cols ?? ''; return c },
      eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
      in: (col: string, v: unknown[]) => { predicats.push(predicatIn(col, v)); return c },
      not: () => c, gte: () => c, lte: () => c, is: () => c,
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => {
        // Le dossier de la caisse (ses colonnes de la caisse) se retient avec elle ; l'adresse de collecte, non.
        const cle = nom === 'dossiers' && colonnes.includes('statut_tva') ? 'dossiers-caisse' : nom
        return attendre(cle).then(() => ({ data: reponse().data[0] ?? null, error: null }))
      },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => attendre(nom).then(reponse).then(suite, echec),
    }
    return c
  }
  const DOSSIER = { id: 'd1', code_email: null, statut_tva: 'exonere', mode_comptable: 'tresorerie', assujetti_tva: false, categorie_recettes_client: null }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        if (nom === 'droits_sur_le_dossier') {
          faux.lectures.push(nom)
          return attendre(nom).then(() => ({ data: faux.droits, error: null }))
        }
        if (nom === 'caisse_du_client') return chaine('caisse_du_client', () => faux.jours[args.p_annee as number] ?? [])
        if (nom === 'couverture_du_releve') return Promise.resolve({ data: couvertureDe([]), error: null })
        if (nom === 'pieces_jointes_ecartees_du_client') return Promise.resolve({ data: [], error: null })
        faux.ecritures.push({ nom, args })
        const repondre = () => (faux.refusRpc ? { data: null, error: { message: faux.refusRpc, code: '22023' } } : { data: { id: 'neuf' }, error: null })
        if (faux.retenirRpc) return new Promise((r) => { faux.rpcEnAttente.push(() => r(repondre())) })
        return Promise.resolve(repondre())
      },
      from: (table: string) => {
        if (table === 'dossiers') return chaine(table, () => [DOSSIER])
        if (table === 'pieces') return chaine(table, () => faux.pieces)
        if (table === 'operations_caisse') return chaine(table, () => faux.operations)
        return chaine(table, () => [])
      },
    },
  }
})

const piece = (o: Partial<Piece>): Record<string, unknown> => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'facture-fournisseur.pdf', type_piece: 'achat', statut: 'a_valider', montant_ttc: 123.45,
  devise: 'EUR', facture_id: null, created_at: '2026-03-05T09:00:00Z', ...o,
})
const operation = (o: Partial<OperationDuClient>): Record<string, unknown> => ({
  id: 'o1', dossier_id: 'd1', genre: 'paiement', date: '2026-03-12', montant: -80, categorie_id: null, taux_tva: null,
  encaissements_du_jour: null, piece_id: 'p1', origine: 'client', remplace_id: null, cree_le: '2026-03-12T10:00:00Z',
  cree_par: MOI, retire_le: null, ...o,
})
const jour = (o: Partial<JourDeLaCaisseDuClient>): Record<string, unknown> => ({
  jour: '2025-01-01', report: 0, ouverture: 0, operations: 0, releve: 0, especes_des_factures: 0, encaissements_du_jour: [],
  solde: 0, fige: false, ...o,
})

// Trois pièces : un achat (sans paiement), une vente, une note de frais ; une caisse de 100 € reportés au 1er janvier 2025.
function poser() {
  faux.avecCaisse = true
  faux.droits = { cabinet: false, membre: true, ventes: false, banque: false, caisse: true }
  faux.pieces = [
    piece({}),
    piece({ id: 'p2', nom_fichier: 'note-honoraires.pdf', type_piece: 'vente', montant_ttc: 67.89, created_at: '2026-03-04T09:00:00Z' }),
    piece({ id: 'p3', nom_fichier: 'ticket.jpg', type_piece: 'note_frais', created_at: '2026-03-03T09:00:00Z' }),
  ]
  faux.operations = []
  faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [] }
  faux.muetApres = {}
  faux.retenirCaisse = false
  faux.caisseEnAttente = []
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

const ligneDe = (fichier: string) => screen.getByText(fichier).closest('tr') as HTMLElement
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom })
const sansBouton = (nom: string | RegExp) => expect(screen.queryByRole('button', { name: nom })).toBeNull()

async function monter() {
  render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByText('facture-fournisseur.pdf')
}

async function ouvrirEtRemplir(geste: string, date: string, montant: string) {
  fireEvent.click(await within(ligneDe('facture-fournisseur.pdf')).findByRole('button', { name: geste }))
  fireEvent.change(screen.getByLabelText('Jour où tu as payé'), { target: { value: date } })
  fireEvent.change(screen.getByLabelText('Montant de tes espèces (€)'), { target: { value: montant } })
}

describe('sans la case « Caisse »', () => {
  it('« Mes pièces » est celle d’hier : rien de la caisse ne se lit ni ne s’affiche', async () => {
    faux.avecCaisse = false
    await monter()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Fichier', 'Déposé le', 'Statut', 'Précisions'])
    expect(screen.queryByText(/espèces/i)).toBeNull()
    expect(faux.lectures.filter((l) => ['droits_sur_le_dossier', 'caisse_du_client', 'operations_caisse'].includes(l))).toEqual([])
    expect(screen.getAllByRole('button', { name: '+ Préciser' })).toHaveLength(3)
  })
})

describe('avec la case « Caisse »', () => {
  it('rien n’est offert avant le retour de la caisse ; puis le geste, sur un achat et une vente, jamais sur une note de frais', async () => {
    faux.retenirCaisse = true
    await monter()
    sansBouton(/espèces/)
    faux.retenirCaisse = false
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await within(ligneDe('facture-fournisseur.pdf')).findByRole('button', { name: 'Payée en espèces de ta caisse' })
    expect(within(ligneDe('note-honoraires.pdf')).getByRole('button', { name: 'Encaissée en espèces dans ta caisse' })).toBeTruthy()
    expect(within(ligneDe('ticket.jpg')).queryByRole('button', { name: /espèces/ })).toBeNull()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Fichier', 'Déposé le', 'Statut', 'Gestes'])
  })

  it('la case relue à la base sans « Caisse » : la phrase, aucun geste', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: false, caisse: false }
    await monter()
    await screen.findByText(/Ton accès ne porte plus « Caisse » sur cette société/)
    sansBouton(/espèces/)
  })

  it('une caisse lue en partie : la phrase, ni paiement dit ni geste', async () => {
    faux.operations = [operation({})]
    faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [jour({ jour: '2026-03-12', operations: -80, solde: 20 })] }
    faux.muetApres = { operations_caisse: 0 }
    await monter()
    await screen.findByText(/Ta caisse n’a pas pu être lue en entier/)
    sansBouton(/espèces/)
    expect(screen.queryByText(/Payée en espèces le/)).toBeNull()
  })

  it('des pièces lues en partie : la raison, aucun geste', async () => {
    faux.muetApres = { pieces: 2 }
    render(<MemoryRouter><ClientUpload /></MemoryRouter>)
    await screen.findByText(/Tes pièces n’ont pas pu être lues en entier : aucun paiement en espèces ne t’est proposé/)
    sansBouton(/espèces/)
  })

  it('paie un achat : la confirmation nomme ce qui part, un seul appel pour deux clics, puis la relecture ; jamais le montant de la pièce', async () => {
    await monter()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await ouvrirEtRemplir('Payée en espèces de ta caisse', '2026-03-12', '80')
    const lecturesAvant = faux.lectures.filter((l) => l === 'operations_caisse').length
    faux.retenirRpc = true
    await act(async () => {
      fireEvent.click(bouton('Enregistrer'))
      fireEvent.click(bouton('Enregistrer'))
    })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toMatch(/^Payer en espèces de ta caisse la pièce déposée le 05\/03\/2026 : 80,00\s€ sortis le 12\/03\/2026 \? Ta caisse du 12\/03\/2026 passera à 20,00\s€\./)
    expect(faux.ecritures).toEqual([{
      nom: 'regler_piece_par_la_caisse', args: { p_dossier_id: 'd1', p_piece_id: 'p1', p_date: '2026-03-12', p_montant: -80 },
    }])
    // Pendant l'écriture, le bouton est retenu ; le verrou ne se relâche qu'après la relecture.
    expect((screen.getByRole('button', { name: 'Écriture…' }) as HTMLButtonElement).disabled).toBe(true)
    faux.operations = [operation({})]
    faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [jour({ jour: '2026-03-12', operations: -80, solde: 20 })] }
    // La base a écrit ; la relecture est retenue : le verrou tient tant qu'elle n'est pas revenue.
    faux.retenirCaisse = true
    await act(async () => { for (const r of faux.rpcEnAttente.splice(0)) r() })
    await screen.findByText(/^Enregistré : la pièce déposée le 05\/03\/2026, payée en espèces le 12\/03\/2026, 80,00\s€\.$/)
    expect((screen.getByRole('button', { name: 'Écriture…' }) as HTMLButtonElement).disabled).toBe(true)
    faux.retenirCaisse = false
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await screen.findByRole('button', { name: 'Enregistrer' })
    expect(faux.lectures.filter((l) => l === 'operations_caisse').length).toBe(lecturesAvant + 1)
    await waitFor(() => expect(within(ligneDe('facture-fournisseur.pdf')).getByText(/Payée en espèces le 12\/03\/2026, 80,00\s€ \(par toi\)/)).toBeTruthy())
    const texte = document.body.textContent ?? ''
    expect(texte).not.toMatch(/123,45|67,89/)
    for (const appel of confirmer.mock.calls) expect(String(appel[0])).not.toMatch(/123,45|67,89/)
    expect(motsDuCabinet(texte)).toEqual([])
  })

  it('encaisse une vente : le montant part positif', async () => {
    await monter()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await within(ligneDe('note-honoraires.pdf')).findByRole('button', { name: 'Encaissée en espèces dans ta caisse' }))
    fireEvent.change(screen.getByLabelText('Jour où tu as reçu les espèces'), { target: { value: '2026-03-12' } })
    fireEvent.change(screen.getByLabelText('Montant de tes espèces (€)'), { target: { value: '45,50' } })
    await act(async () => { fireEvent.click(bouton('Enregistrer')) })
    expect(faux.ecritures).toEqual([{
      nom: 'regler_piece_par_la_caisse', args: { p_dossier_id: 'd1', p_piece_id: 'p2', p_date: '2026-03-12', p_montant: 45.5 },
    }])
  })

  it('ne part pas sans la confirmation', async () => {
    await monter()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await ouvrirEtRemplir('Payée en espèces de ta caisse', '2026-03-12', '80')
    await act(async () => { fireEvent.click(bouton('Enregistrer')) })
    expect(faux.ecritures).toEqual([])
  })

  it('les refus avant le clic : la caisse qui passerait sous zéro, un montant signé, une date d’avant la caisse lue', async () => {
    await monter()
    await ouvrirEtRemplir('Payée en espèces de ta caisse', '2026-03-12', '150')
    expect(screen.getByRole('alert').textContent).toMatch(/^Ce paiement de 150,00 € rendrait la caisse négative le 12\/03\/2026 \(−50,00 €\)/)
    expect((bouton('Enregistrer') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Montant de tes espèces (€)'), { target: { value: '-10' } })
    expect(screen.getByRole('alert').textContent).toBe('Écris le montant sans signe : ta caisse sait déjà si ces espèces sortent ou entrent.')
    fireEvent.change(screen.getByLabelText('Montant de tes espèces (€)'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Jour où tu as payé'), { target: { value: '2024-12-31' } })
    expect(screen.getByRole('alert').textContent).toBe('Ta caisse est lue ici depuis le 01/01/2025 : pour un paiement plus ancien, demande à ton cabinet.')
    expect((bouton('Enregistrer') as HTMLButtonElement).disabled).toBe(true)
  })

  it('le refus de la base après le clic, sous ses mots', async () => {
    await monter()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refusRpc = 'Ce paiement ne règle pas exactement cette pièce : à quelques centimes près, son écriture ne s\'équilibrerait pas. Vérifie le montant de tes espèces, ou demande à ton cabinet.'
    await ouvrirEtRemplir('Payée en espèces de ta caisse', '2026-03-12', '80')
    await act(async () => { fireEvent.click(bouton('Enregistrer')) })
    expect((await screen.findByRole('alert')).textContent).toBe(`Ton paiement n’a pas été enregistré : ${faux.refusRpc}`)
  })

  it('« par toi » sur ses saisies seules, « Retirer » sur elles seules, confirmé, sous le verrou', async () => {
    faux.pieces = [piece({}), piece({ id: 'p4', nom_fichier: 'autre-facture.pdf', created_at: '2026-03-01T09:00:00Z' })]
    faux.operations = [
      operation({}),
      operation({ id: 'o2', piece_id: 'p4', date: '2026-03-01', montant: -10, origine: 'cabinet', cree_par: 'u-cabinet', cree_le: '2026-03-01T10:00:00Z' }),
    ]
    faux.jours = {
      2025: [jour({ report: 100, solde: 100 })],
      2026: [jour({ jour: '2026-03-01', operations: -10, solde: 90 }), jour({ jour: '2026-03-12', operations: -80, solde: 10 })],
    }
    await monter()
    await within(ligneDe('facture-fournisseur.pdf')).findByText(/Payée en espèces le 12\/03\/2026, 80,00\s€ \(par toi\)/)
    expect(within(ligneDe('autre-facture.pdf')).getByText(/Payée en espèces le 01\/03\/2026, 10,00\s€ \(par ton cabinet\)/)).toBeTruthy()
    expect(within(ligneDe('autre-facture.pdf')).queryByText(/par toi/)).toBeNull()
    // Le paiement du cabinet : dit, sans « Retirer ».
    fireEvent.click(within(ligneDe('autre-facture.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    sansBouton('Retirer')
    // Le sien : « Retirer », confirmé, un seul appel pour deux clics.
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirRpc = true
    await act(async () => {
      fireEvent.click(bouton('Retirer'))
      fireEvent.click(bouton('Retirer'))
    })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toMatch(/^Retirer le paiement en espèces du 12\/03\/2026, 80,00\s€, de la pièce déposée le 05\/03\/2026 \? .*passera à 90,00\s€\./)
    expect(faux.ecritures).toEqual([{ nom: 'retirer_operation_caisse', args: { p_dossier_id: 'd1', p_operation_id: 'o1' } }])
    await act(async () => { for (const r of faux.rpcEnAttente.splice(0)) r() })
    await screen.findByText(/^Retiré : le paiement en espèces du 12\/03\/2026, 80,00\s€\.$/)
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('un paiement en vol retient le geste des autres pièces, même avant le rendu, jusqu’à la relecture', async () => {
    await monter()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await ouvrirEtRemplir('Payée en espèces de ta caisse', '2026-03-12', '80')
    const geste = 'Encaissée en espèces dans ta caisse'
    faux.retenirRpc = true
    // Le clic sur la pièce B suit celui du paiement dans le MÊME `act` : le rendu qui la désactive n'a pas eu lieu.
    await act(async () => {
      fireEvent.click(bouton('Enregistrer'))
      fireEvent.click(within(ligneDe('note-honoraires.pdf')).getByRole('button', { name: geste }))
    })
    expect(screen.queryByLabelText('Jour où tu as reçu les espèces')).toBeNull()
    expect(screen.getByLabelText('Jour où tu as payé')).toBeTruthy()
    // Une fois rendu : B est désactivé, le clic n'ouvre rien, et un seul appel est parti.
    const boutonB = within(ligneDe('note-honoraires.pdf')).getByRole('button', { name: geste }) as HTMLButtonElement
    expect(boutonB.disabled).toBe(true)
    fireEvent.click(boutonB)
    expect(screen.queryByLabelText('Jour où tu as reçu les espèces')).toBeNull()
    expect((within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Payée en espèces de ta caisse' }) as HTMLButtonElement).disabled).toBe(true)
    expect(faux.ecritures.map((e) => e.nom)).toEqual(['regler_piece_par_la_caisse'])
    // La base a écrit, la relecture est retenue : le verrou tient encore.
    faux.operations = [operation({})]
    faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [jour({ jour: '2026-03-12', operations: -80, solde: 20 })] }
    faux.retenirCaisse = true
    await act(async () => { for (const r of faux.rpcEnAttente.splice(0)) r() })
    await screen.findByText(/^Enregistré : la pièce déposée le 05\/03\/2026/)
    expect((within(ligneDe('note-honoraires.pdf')).getByRole('button', { name: geste }) as HTMLButtonElement).disabled).toBe(true)
    // La relecture revenue, le bouton se réactive et ouvre son formulaire.
    faux.retenirCaisse = false
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await waitFor(() => expect((within(ligneDe('note-honoraires.pdf')).getByRole('button', { name: geste }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(ligneDe('note-honoraires.pdf')).getByRole('button', { name: geste }))
    expect(screen.getByLabelText('Jour où tu as reçu les espèces')).toBeTruthy()
    expect(faux.ecritures).toHaveLength(1)
  })

  it('le paiement d’avant la première année lue : « Retirer » grisé sous la phrase qui renvoie au cabinet, jamais « relis ta caisse »', async () => {
    faux.operations = [operation({ date: '2024-11-20', cree_le: '2024-11-20T10:00:00Z' })]
    await monter()
    fireEvent.click(await within(ligneDe('facture-fournisseur.pdf')).findByRole('button', { name: 'Espèces de ta caisse' }))
    expect((bouton('Retirer') as HTMLButtonElement).disabled).toBe(true)
    const phrase = 'Ta caisse est lue ici depuis le 01/01/2025 : pour un paiement plus ancien, demande à ton cabinet.'
    expect(screen.getAllByText(phrase).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/relis ta caisse/)
  })
})
