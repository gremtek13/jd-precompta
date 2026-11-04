import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { JourDeLaCaisseDuClient, OperationDuClient } from '../lib/caisseClient'
import type { Piece } from '../lib/types'

// « MES PIÈCES » ET LA CORRECTION D'UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE (espace client, C12B-Q1 ; la migration
// `correction_du_paiement_par_la_caisse`, PRÉPARÉE, pas appliquée). Le harnais est celui de ClientUpload.caisse.test.tsx. Ce que
// ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. le drapeau `CORRECTION_DU_PAIEMENT_EXPORTEE` baissé (son état d'aujourd'hui) : « Mes pièces » est celle d'hier, au
//     caractère près — aucun « Corriger », l'aide et la confirmation du retrait d'hier ;
//  2. levé : « Corriger » sur ses propres paiements seuls ; le formulaire s'ouvre sur son jour et ses espèces sans signe ; les
//     refus se disent avant le clic, sur la saisie telle qu'elle part ; la confirmation nomme l'ancien et le nouveau, jamais le
//     montant de la pièce ; la fonction de la base seule, ses arguments ; UN verrou pour « Mes pièces » entière, relâché après
//     la relecture ; le refus de la base, aux mots du client ;
//  3. aucune forme du cabinet dans ce qui s'affiche (`motsDuCabinet`).
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const MOI = 'u-client'

const drapeau = vi.hoisted(() => ({ correction: false as boolean }))
vi.mock('../lib/correctionDuPaiement', async (original) => {
  const module = await original<typeof import('../lib/correctionDuPaiement')>()
  return { ...module, get CORRECTION_DU_PAIEMENT_EXPORTEE() { return drapeau.correction } }
})

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
  drapeau.correction = false
  // Le paiement du praticien (80 € le 12/03/2026, de l'achat p1) et celui de son cabinet (10 € le 01/03/2026, d'un autre achat).
  faux.pieces = [piece({}), piece({ id: 'p4', nom_fichier: 'autre-facture.pdf', created_at: '2026-03-01T09:00:00Z' })]
  faux.operations = [
    operation({}),
    operation({ id: 'o2', piece_id: 'p4', date: '2026-03-01', montant: -10, origine: 'cabinet', cree_par: 'u-cabinet', cree_le: '2026-03-01T10:00:00Z' }),
  ]
  faux.jours = {
    2025: [jour({ report: 100, solde: 100 })],
    2026: [jour({ jour: '2026-03-01', operations: -10, solde: 90 }), jour({ jour: '2026-03-12', operations: -80, solde: 10 })],
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const ligneDe = (fichier: string) => screen.getByText(fichier).closest('tr') as HTMLElement
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom })
const champ = (nom: string) => screen.getByLabelText(nom) as HTMLInputElement
const JOUR = 'Jour où tu as vraiment payé'
const MONTANT = 'Montant exact de tes espèces (€)'

async function monter() {
  render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByText('facture-fournisseur.pdf')
  await within(ligneDe('facture-fournisseur.pdf')).findByText(/Payée en espèces le 12\/03\/2026, 80,00\s€ \(par toi\)/)
}

describe('le drapeau baissé : « Mes pièces » est celle d’hier', () => {
  it('aucun « Corriger », l’aide et la confirmation du retrait d’hier, au caractère près', async () => {
    await monter()
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull()
    expect(screen.getByText('Pour corriger un paiement, retire-le puis enregistre le bon.')).toBeTruthy()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(bouton('Retirer'))
    expect(String(confirmer.mock.calls[0][0])).toMatch(/ Pour le corriger, retire-le puis enregistre le bon\.$/)
    expect(faux.ecritures).toEqual([])
  })
})

describe('le drapeau levé : « Corriger » son paiement d’un seul geste', () => {
  beforeEach(() => { drapeau.correction = true })

  it('sur ses propres paiements seuls ; l’aide le dit ; le formulaire s’ouvre sur son jour et ses espèces, sans signe', async () => {
    await monter()
    fireEvent.click(within(ligneDe('autre-facture.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull()
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    expect(screen.getByText('Pour corriger le jour ou le montant d’un paiement, « Corriger » le remplace d’un seul geste.')).toBeTruthy()
    fireEvent.click(bouton('Corriger'))
    expect(bouton('Corriger').getAttribute('aria-expanded')).toBe('true')
    expect(champ(JOUR).value).toBe('2026-03-12')
    expect(champ(MONTANT).value).toBe('80,00')
    expect(screen.getByRole('alert').textContent).toBe('Rien à corriger : ce sont le jour et le montant de ce paiement.')
    expect((bouton('Enregistrer la correction') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(bouton('Annuler'))
    expect(screen.queryByLabelText(JOUR)).toBeNull()
  })

  it('les refus avant le clic : un montant signé, la caisse qui passerait sous zéro, une date d’avant la caisse lue ; rien ne part', async () => {
    await monter()
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    fireEvent.click(bouton('Corriger'))
    fireEvent.change(champ(MONTANT), { target: { value: '-80' } })
    expect(screen.getByRole('alert').textContent).toBe('Écris le montant sans signe : ta caisse sait déjà si ces espèces sortent ou entrent.')
    // 100 € reportés, 10 € payés par le cabinet le 01/03 : 95 € le 12/03 la vident de 5 €.
    fireEvent.change(champ(MONTANT), { target: { value: '95' } })
    expect(screen.getByRole('alert').textContent).toMatch(/^Ce paiement de 95,00 € rendrait la caisse négative le 12\/03\/2026 \(−5,00 €\)/)
    fireEvent.change(champ(MONTANT), { target: { value: '80' } })
    fireEvent.change(champ(JOUR), { target: { value: '2024-12-31' } })
    expect(screen.getByRole('alert').textContent).toBe('Ta caisse est lue ici depuis le 01/01/2025 : pour un paiement plus ancien, demande à ton cabinet.')
    expect((bouton('Enregistrer la correction') as HTMLButtonElement).disabled).toBe(true)
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton('Enregistrer la correction')) })
    expect(confirmer).not.toHaveBeenCalled()
    expect(faux.ecritures).toEqual([])
  })

  it('la confirmation nomme l’ancien et le nouveau ; la fonction seule, un appel pour deux clics, le verrou jusqu’à la relecture', async () => {
    await monter()
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    fireEvent.click(bouton('Corriger'))
    fireEvent.change(champ(JOUR), { target: { value: '2026-03-10' } })
    fireEvent.change(champ(MONTANT), { target: { value: '75,50' } })
    expect(screen.queryByRole('alert')).toBeNull()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const lecturesAvant = faux.lectures.filter((l) => l === 'operations_caisse').length
    faux.retenirRpc = true
    await act(async () => {
      fireEvent.click(bouton('Enregistrer la correction'))
      fireEvent.click(bouton('Enregistrer la correction'))
    })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(String(confirmer.mock.calls[0][0]).replace(/\u202f|\u00a0/g, ' ')).toBe(
      'Corriger ton paiement en espèces du 12/03/2026, 80,00 €, de la pièce déposée le 05/03/2026 : 75,50 € sortis le '
      + '10/03/2026 à sa place ? L’ancien reste dans l’historique de ta caisse, retiré. Ta caisse du 10/03/2026 passera à '
      + '14,50 €, celle du 12/03/2026 à 14,50 €. Ton cabinet le voit aussitôt.')
    expect(faux.ecritures).toEqual([{
      nom: 'remplacer_paiement_par_la_caisse', args: { p_dossier_id: 'd1', p_operation_id: 'o1', p_date: '2026-03-10', p_montant: -75.5 },
    }])
    // Pendant l'écriture, le verrou de « Mes pièces » retient les gestes des autres pièces.
    expect((within(ligneDe('autre-facture.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }) as HTMLButtonElement).disabled).toBe(true)
    // La base a écrit ; la relecture est retenue : le verrou tient tant qu'elle n'est pas revenue.
    faux.operations = [
      operation({ retire_le: '2026-11-02T10:00:00Z' }),
      operation({ id: 'o3', date: '2026-03-10', montant: -75.5, remplace_id: 'o1', cree_le: '2026-11-02T10:00:00Z' }),
      operation({ id: 'o2', piece_id: 'p4', date: '2026-03-01', montant: -10, origine: 'cabinet', cree_par: 'u-cabinet', cree_le: '2026-03-01T10:00:00Z' }),
    ]
    faux.jours = {
      2025: [jour({ report: 100, solde: 100 })],
      2026: [jour({ jour: '2026-03-01', operations: -10, solde: 90 }), jour({ jour: '2026-03-10', operations: -75.5, solde: 14.5 })],
    }
    faux.retenirCaisse = true
    await act(async () => { for (const r of faux.rpcEnAttente.splice(0)) r() })
    await screen.findByText(/^Corrigé : la pièce déposée le 05\/03\/2026, 75,50\s€ sortis le 10\/03\/2026, à la place de 80,00\s€ sortis le 12\/03\/2026\.$/)
    expect((within(ligneDe('autre-facture.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }) as HTMLButtonElement).disabled).toBe(true)
    faux.retenirCaisse = false
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await act(async () => { for (const r of faux.caisseEnAttente.splice(0)) r() })
    await waitFor(() => expect((within(ligneDe('autre-facture.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }) as HTMLButtonElement).disabled).toBe(false))
    expect(faux.lectures.filter((l) => l === 'operations_caisse').length).toBe(lecturesAvant + 1)
    await waitFor(() => expect(within(ligneDe('facture-fournisseur.pdf')).getByText(/Payée en espèces le 10\/03\/2026, 75,50\s€ \(par toi\)/)).toBeTruthy())
    expect(screen.queryByLabelText(JOUR)).toBeNull()
    expect(faux.ecritures).toHaveLength(1)
    const texte = document.body.textContent ?? ''
    expect(texte).not.toMatch(/123,45/)
    for (const appel of confirmer.mock.calls) expect(String(appel[0])).not.toMatch(/123,45/)
    expect(motsDuCabinet(texte)).toEqual([])
    expect(motsDuCabinet(String(confirmer.mock.calls[0][0]))).toEqual([])
  })

  it('ne part pas sans la confirmation ; le refus de la base, après le clic, aux mots du client', async () => {
    await monter()
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Espèces de ta caisse' }))
    fireEvent.click(bouton('Corriger'))
    fireEvent.change(champ(JOUR), { target: { value: '2026-03-10' } })
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { fireEvent.click(bouton('Enregistrer la correction')) })
    expect(faux.ecritures).toEqual([])
    confirmer.mockReturnValue(true)
    faux.refusRpc = 'Cette opération a été saisie depuis un autre accès à ce dossier : demande à ton cabinet de la corriger.'
    await act(async () => { fireEvent.click(bouton('Enregistrer la correction')) })
    expect((await screen.findByRole('alert')).textContent).toBe(`Ton paiement n’a pas été corrigé : ${faux.refusRpc}`)
    expect(faux.ecritures.map((e) => e.nom)).toEqual(['remplacer_paiement_par_la_caisse'])
  })

  it('un paiement d’avant la première année lue : « Corriger » grisé, la phrase qui renvoie au cabinet dite une fois', async () => {
    faux.operations = [operation({ date: '2024-11-20', cree_le: '2024-11-20T10:00:00Z' })]
    faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [] }
    render(<MemoryRouter><ClientUpload /></MemoryRouter>)
    await screen.findByText('facture-fournisseur.pdf')
    fireEvent.click(await within(ligneDe('facture-fournisseur.pdf')).findByRole('button', { name: 'Espèces de ta caisse' }))
    expect((bouton('Corriger') as HTMLButtonElement).disabled).toBe(true)
    expect((bouton('Retirer') as HTMLButtonElement).disabled).toBe(true)
    const phrase = 'Ta caisse est lue ici depuis le 01/01/2025 : pour un paiement plus ancien, demande à ton cabinet.'
    expect(screen.getAllByText(phrase)).toHaveLength(1)
  })
})
