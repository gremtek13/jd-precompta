import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import type { DonneesExemplaire } from './ExemplaireDeLaFacture'
import type { DonneesHorsDeFrance } from './FicheHorsDeFrance'
import type { FactureProposee } from '../../lib/exemplairesDesFacturesLecture'
import type { Piece } from '../../lib/types'
import { ECARTS_ET_DECLARATIONS_VIDES } from '../../test/ereportingDeLaPiece'

// L'EXEMPLAIRE D'UNE FACTURE DANS LA FICHE D'UNE PIÈCE (ligne 28.6, étape VF1b) : ce que la fiche fait de ce que l'écran qui
// l'ouvre lui donne — le geste est offert sur une pièce de vente quand l'écran a lu les factures, jamais sans ; et le
// formulaire d'une pièce DÉSIGNÉE dit avant l'enregistrement que sa nature ne change pas, sans toucher au reste de la saisie
// ni rien envoyer. Le geste lui-même (verrou, confirmation, refus) est gardé par ExemplaireDeLaFacture.test.tsx. Données FICTIVES.
const faux = vi.hoisted(() => ({
  majPieces: [] as unknown[],
  insertions: [] as unknown[],
  rpcs: [] as string[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pieces') {
        return {
          update: (ligne: unknown) => { faux.majPieces.push(ligne); return { eq: () => Promise.resolve({ error: null }) } },
          insert: (ligne: unknown) => { faux.insertions.push(ligne); return Promise.resolve({ error: null }) },
        }
      }
      if (table === 'notes_internes') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      }
      if (table === 'piece_textes_ocr') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    rpc: (nom: string) => { faux.rpcs.push(nom); return Promise.resolve({ error: null }) },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }) }) },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: null }) }))
vi.mock('../../lib/extraction', () => ({
  hashFichier: () => Promise.resolve('empreinte-de-test'),
  fichierDejaPresent: () => Promise.resolve(false),
  extractPiece: () => Promise.resolve({}),
}))

const D = 'd1'
const HORS_DE_FRANCE: DonneesHorsDeFrance = {
  lecture: { fiches: [], taux: [], motif: null }, relire: async () => {}, anneeFigeante: null, gelIncomplet: null, pieces: [],
  ...ECARTS_ET_DECLARATIONS_VIDES,
}
const FACTURE: FactureProposee = {
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  tiers_nom: 'CLIENT FICTIF SAS', montant_ttc: 1200,
}
const EXEMPLAIRE: DonneesExemplaire = {
  factures: { lignes: [FACTURE], complete: true, motif: null },
  relireLesFactures: async () => {}, anneeFigeante: null, gelIncomplet: null, relirePiece: async () => null,
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: D, uploaded_by: null, source: 'upload',
    storage_path: 'd1/vente-0007.pdf', nom_fichier: 'vente-0007.pdf', storage_hash: null,
    date_piece: '2026-03-14', tiers: 'CLIENT FICTIF SAS', montant_ht: 1000, montant_tva: 200,
    montant_ttc: 1200, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'a_valider', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2026-03-14T09:00:00Z', updated_at: '2026-03-14T09:00:00Z', ...o,
  }
}

function monter(p: Piece, exemplaire?: DonneesExemplaire | null, venteEmise?: React.ComponentProps<typeof FichePiece>['venteEmise']) {
  return render(
    <FichePiece
      dossierId={D} categories={[]} sousDossiers={[]} tiersCategories={[]} tiersCategoriesCabinet={[]} tiersConnus={[]}
      piece={p} commentaires={[]} onClose={() => {}} onSaved={() => {}} onCommentaireAjoute={() => {}} onCommentaireSupprime={() => {}}
      horsDeFrance={HORS_DE_FRANCE} exemplaire={exemplaire} venteEmise={venteEmise}
    />,
  )
}

const choisirLeType = (valeur: string) => act(async () => {
  fireEvent.change(document.querySelector('#type')!, { target: { value: valeur } })
})

beforeEach(() => { faux.majPieces = []; faux.insertions = []; faux.rpcs = [] })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FichePiece — l’exemplaire d’une facture, selon ce que l’écran appelant a lu', () => {
  it('sans rien lu par l’appelant (aucun `exemplaire`), la fiche d’une pièce de vente n’offre aucun geste', async () => {
    await act(async () => { monter(piece()) })
    expect(screen.queryByText('Exemplaire d’une facture émise')).toBeNull()
    expect(screen.queryByRole('button', { name: /Désigner|Défaire/ })).toBeNull()
  })

  it('les factures lues par l’appelant : une pièce de vente peut être désignée', async () => {
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    expect(screen.getByText('Exemplaire d’une facture émise')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Désigner comme exemplaire' })).toBeTruthy()
  })

  it('la même fiche, sur un achat : rien, quoi que l’appelant ait lu', async () => {
    await act(async () => { monter(piece({ type_piece: 'achat' }), EXEMPLAIRE) })
    expect(screen.queryByText('Exemplaire d’une facture émise')).toBeNull()
    expect(screen.queryByRole('button', { name: /Désigner|Défaire/ })).toBeNull()
  })

  it('une pièce désignée offre de défaire, et la vente comptée deux fois est transmise à la confirmation', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => {
      monter(piece({ facture_id: 'f1' }), EXEMPLAIRE, {
        genre: 'double', libelle: 'Comptée deux fois', explication: 'La facture F2026-0007 est portée par 2 pièces.', autres: ['facture-0007.xml'],
      })
    })
    await act(async () => { screen.getByRole('button', { name: 'Défaire la désignation' }).click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('« facture-0007.xml »')
    expect(String(confirmation.mock.calls[0][0])).toContain('NE RETIRE PAS le double compte')
    expect(faux.rpcs).toEqual([])
  })

  it('une vente reconnue seulement (« Facture émise… ») ne fait pas dire à la confirmation qu’elle est comptée deux fois', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => {
      monter(piece({ facture_id: 'f1' }), EXEMPLAIRE, {
        genre: 'jumelle', libelle: 'Facture émise F2026-0007', explication: 'Cette pièce est un exemplaire de la facture F2026-0007.', autres: [],
      })
    })
    await act(async () => { screen.getByRole('button', { name: 'Défaire la désignation' }).click() })
    expect(String(confirmation.mock.calls[0][0])).not.toContain('NE RETIRE PAS')
  })
})

describe('FichePiece — une pièce désignée reste une pièce de vente', () => {
  it('changer sa nature le dit avant l’enregistrement, sous les mots de la garde, sans toucher au reste de la saisie', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' }), EXEMPLAIRE) })
    fireEvent.change(document.querySelector('#tiers')!, { target: { value: 'AUTRE CLIENT' } })
    await choisirLeType('achat')
    expect(screen.getByText("Cette pièce est l'exemplaire de la facture F2026-0007 : elle reste une pièce de vente — défaire d'abord la désignation.")).toBeTruthy()
    // Le reste du formulaire est tel que saisi : ni le tiers ni le type choisi ne sont remis en place.
    expect((document.querySelector('#tiers') as HTMLInputElement).value).toBe('AUTRE CLIENT')
    expect((document.querySelector('#type') as HTMLSelectElement).value).toBe('achat')
    expect((screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Enregistrer brouillon' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('rien ne part tant que le refus tient, même par la touche Entrée du formulaire', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' }), EXEMPLAIRE) })
    await choisirLeType('note_frais')
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toEqual([])
  })

  it('revenir à « Vente » retire le refus, et l’enregistrement part', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' }), EXEMPLAIRE) })
    await choisirLeType('autre')
    expect(screen.getByText(/elle reste une pièce de vente/)).toBeTruthy()
    await choisirLeType('vente')
    expect(screen.queryByText(/elle reste une pièce de vente/)).toBeNull()
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toHaveLength(1)
  })

  it('le refus tient aussi quand l’appelant n’a rien lu : la désignation se sait de la pièce, le numéro n’est pas inventé', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' })) })
    await choisirLeType('achat')
    expect(screen.getByText(/dont le numéro n’a pas pu être lu : elle reste une pièce de vente/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('une pièce que rien ne désigne change de nature librement', async () => {
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    await choisirLeType('achat')
    expect(screen.queryByText(/elle reste une pièce de vente/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
