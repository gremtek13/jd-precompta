import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { motsDuCabinet } from '../lib/espaceVentes'
import { DRAPEAU_DES_ESPECES_DU_CLIENT, REFUS_DES_ESPECES_DU_CLIENT } from '../lib/especesDuClientHorsDesReprises'
import type { JourDeLaCaisseDuClient, OperationDuClient } from '../lib/caisseClient'
import type { Piece } from '../lib/types'

// « MES PIÈCES » ET L'ORIGINAL D'UNE FACTURE REPRISE (A8Q5Q3Q2Q2-Q1 ; la migration préparée
// `especes_du_client_hors_des_reprises`). Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. le drapeau baissé, « Mes pièces » est celle d'hier : la liste ne se lit pas, et le paiement s'offre comme hier ;
//  2. levé, la liste se lit avec la caisse : sur la pièce qu'elle porte, la phrase de la base AVANT le clic, ni le formulaire
//     du paiement ni « Corriger » — « Retirer » reste ; une autre pièce se paie comme hier ;
//  3. la liste pas encore revenue, ou ratée : aucun geste de la caisse ne s'offre, et la phrase dit l'échec ;
//  4. après un geste, la liste se relit avec la caisse ;
//  5. rien du montant de la pièce, aucune forme du cabinet dans ce qui s'affiche (`motsDuCabinet`).
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const MOI = 'u-client'
// La vente citée : un identifiant de la forme que la base rend (la lecture refuse toute autre forme).
const VENTE = 'a8580000-0000-4000-8000-0000000000b2'

const faux = vi.hoisted(() => ({
  pieces: [] as Record<string, unknown>[],
  operations: [] as Record<string, unknown>[],
  jours: {} as Record<number, Record<string, unknown>[]>,
  hors: { data: [] as unknown, error: null as unknown },
  retenirHors: false,
  horsEnAttente: [] as (() => void)[],
  ecritures: [] as { nom: string; args: Record<string, unknown> }[],
  lectures: [] as string[],
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    dossierActifId: 'd1',
    session: { user: { id: 'u-client' }, access_token: 'jeton-fictif' },
    droitsParDossier: { d1: { ventes: false, banque: false, caisse: true } },
  }),
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  const { couvertureDe } = await import('../test/couvertureDuReleve')
  function chaine(nom: string, lignes: () => Record<string, unknown>[]) {
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const reponse = () => {
      faux.lectures.push(nom)
      const toutes = filtrer(lignes(), predicats)
      return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length)), error: null, count: toutes.length }
    }
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
      in: (col: string, v: unknown[]) => { predicats.push(predicatIn(col, v)); return c },
      not: () => c, gte: () => c, lte: () => c, is: () => c,
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => Promise.resolve({ data: reponse().data[0] ?? null, error: null }),
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve(reponse()).then(suite, echec),
    }
    return c
  }
  const DOSSIER = { id: 'd1', code_email: null, statut_tva: 'exonere', mode_comptable: 'tresorerie', assujetti_tva: false, categorie_recettes_client: null }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        if (nom === 'droits_sur_le_dossier') {
          faux.lectures.push(nom)
          return Promise.resolve({ data: { cabinet: false, membre: true, ventes: false, banque: false, caisse: true }, error: null })
        }
        if (nom === 'pieces_hors_de_la_caisse_du_client') {
          faux.lectures.push(`${nom}:${String(args.p_dossier_id)}`)
          if (faux.retenirHors) return new Promise((r) => { faux.horsEnAttente.push(() => r(faux.hors)) })
          return Promise.resolve(faux.hors)
        }
        if (nom === 'caisse_du_client') return chaine('caisse_du_client', () => faux.jours[args.p_annee as number] ?? [])
        if (nom === 'couverture_du_releve') return Promise.resolve({ data: couvertureDe([]), error: null })
        if (nom === 'pieces_jointes_ecartees_du_client') return Promise.resolve({ data: [], error: null })
        if (nom === 'honoraires_deposes_au_dossier') return Promise.resolve({ data: [], error: null, count: 0 })
        faux.ecritures.push({ nom, args })
        return Promise.resolve({ data: { id: 'neuf' }, error: null })
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
  id: 'o1', dossier_id: 'd1', genre: 'paiement', date: '2026-03-12', montant: 40, categorie_id: null, taux_tva: null,
  encaissements_du_jour: null, piece_id: VENTE, origine: 'client', remplace_id: null, cree_le: '2026-03-12T10:00:00Z',
  cree_par: MOI, retire_le: null, ...o,
})
const jour = (o: Partial<JourDeLaCaisseDuClient>): Record<string, unknown> => ({
  jour: '2025-01-01', report: 0, ouverture: 0, operations: 0, releve: 0, especes_des_factures: 0, encaissements_du_jour: [],
  solde: 0, fige: false, ...o,
})

// Un achat (p1) et une vente (p2), l'original d'une facture reprise ; une caisse de 100 € reportés au 1er janvier 2025.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
  faux.pieces = [
    piece({}),
    piece({ id: VENTE, nom_fichier: 'note-honoraires.pdf', type_piece: 'vente', montant_ttc: 67.89, created_at: '2026-03-04T09:00:00Z' }),
  ]
  faux.operations = []
  faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [] }
  faux.hors = { data: [VENTE], error: null }
  faux.retenirHors = false
  faux.horsEnAttente = []
  faux.ecritures = []
  faux.lectures = []
  DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES = true
})
afterEach(() => {
  // L'état du chargement : levé depuis l'application de la migration (16/11/2026).
  DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES = true
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const ligneDe = (fichier: string) => screen.getByText(fichier).closest('tr') as HTMLElement
const lectureDeLaListe = () => faux.lectures.filter((l) => l.startsWith('pieces_hors_de_la_caisse_du_client'))
async function monter() {
  render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByText('facture-fournisseur.pdf')
}

describe('le drapeau baissé', () => {
  it('« Mes pièces » est celle d’hier : la liste ne se lit pas, la vente se paie comme hier', async () => {
    DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES = false
    await monter()
    fireEvent.click(await within(ligneDe('note-honoraires.pdf')).findByRole('button', { name: 'Encaissée en espèces dans ta caisse' }))
    expect(screen.getByLabelText('Jour où tu as reçu les espèces')).toBeTruthy()
    expect(screen.queryByText(REFUS_DES_ESPECES_DU_CLIENT.modele)).toBeNull()
    expect(lectureDeLaListe()).toEqual([])
  })
})

describe('le drapeau levé', () => {
  it('la liste se lit avec la caisse, pour la société affichée', async () => {
    await monter()
    await within(ligneDe('note-honoraires.pdf')).findByRole('button', { name: 'Encaissée en espèces dans ta caisse' })
    expect(lectureDeLaListe()).toEqual(['pieces_hors_de_la_caisse_du_client:d1'])
  })

  it('sur la pièce qu’elle porte : la phrase de la base avant le clic, ni formulaire ni « Enregistrer » ; l’autre pièce se paie', async () => {
    await monter()
    fireEvent.click(await within(ligneDe('note-honoraires.pdf')).findByRole('button', { name: 'Encaissée en espèces dans ta caisse' }))
    expect(screen.getByText(REFUS_DES_ESPECES_DU_CLIENT.modele)).toBeTruthy()
    expect(screen.queryByLabelText('Jour où tu as reçu les espèces')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    fireEvent.click(within(ligneDe('facture-fournisseur.pdf')).getByRole('button', { name: 'Payée en espèces de ta caisse' }))
    expect(screen.getByLabelText('Jour où tu as payé')).toBeTruthy()
    expect(screen.queryByText(REFUS_DES_ESPECES_DU_CLIENT.modele)).toBeNull()
    expect(faux.ecritures).toEqual([])
    const texte = document.body.textContent ?? ''
    expect(texte).not.toMatch(/123,45|67,89/)
    expect(motsDuCabinet(texte)).toEqual([])
  })

  it('un paiement saisi avant la citation : « Retirer » reste, « Corriger » ne s’offre pas', async () => {
    faux.operations = [operation({})]
    faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [jour({ jour: '2026-03-12', operations: 40, solde: 140 })] }
    await monter()
    fireEvent.click(await within(ligneDe('note-honoraires.pdf')).findByRole('button', { name: 'Espèces de ta caisse' }))
    expect(screen.getByRole('button', { name: 'Retirer' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull()
    expect(screen.getByText(REFUS_DES_ESPECES_DU_CLIENT.modele)).toBeTruthy()
  })

  it('… et sur une pièce que la liste ne porte pas, « Corriger » s’offre comme hier', async () => {
    faux.hors = { data: [], error: null }
    faux.operations = [operation({})]
    faux.jours = { 2025: [jour({ report: 100, solde: 100 })], 2026: [jour({ jour: '2026-03-12', operations: 40, solde: 140 })] }
    await monter()
    fireEvent.click(await within(ligneDe('note-honoraires.pdf')).findByRole('button', { name: 'Espèces de ta caisse' }))
    expect(screen.getByRole('button', { name: 'Corriger' })).toBeTruthy()
    expect(screen.queryByText(REFUS_DES_ESPECES_DU_CLIENT.modele)).toBeNull()
  })

  it('la liste pas encore revenue : aucun geste de la caisse ; revenue, les gestes', async () => {
    faux.retenirHors = true
    await monter()
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('button', { name: /espèces/ })).toBeNull()
    await act(async () => { for (const r of faux.horsEnAttente.splice(0)) r() })
    await within(ligneDe('facture-fournisseur.pdf')).findByRole('button', { name: 'Payée en espèces de ta caisse' })
  })

  it('la liste ratée : la phrase de l’échec, aucun geste de la caisse', async () => {
    faux.hors = { data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }
    await monter()
    await screen.findByText(/^La liste des pièces dont ton cabinet enregistre lui-même le paiement en espèces n’a pas pu être lue/)
    expect(screen.queryByRole('button', { name: /espèces/ })).toBeNull()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('après un geste, la liste se relit avec la caisse', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await monter()
    fireEvent.click(await within(ligneDe('facture-fournisseur.pdf')).findByRole('button', { name: 'Payée en espèces de ta caisse' }))
    fireEvent.change(screen.getByLabelText('Jour où tu as payé'), { target: { value: '2026-03-12' } })
    fireEvent.change(screen.getByLabelText('Montant de tes espèces (€)'), { target: { value: '10' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })) })
    await screen.findByText(/^Enregistré : /)
    expect(faux.ecritures.map((e) => e.nom)).toEqual(['regler_piece_par_la_caisse'])
    expect(lectureDeLaListe()).toEqual(['pieces_hors_de_la_caisse_du_client:d1', 'pieces_hors_de_la_caisse_du_client:d1'])
  })
})
