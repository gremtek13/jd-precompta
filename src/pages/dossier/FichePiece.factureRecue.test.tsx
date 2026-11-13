import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import type { Piece } from '../../lib/types'
import type { DonneesHorsDeFrance } from './FicheHorsDeFrance'
import { ECARTS_ET_DECLARATIONS_VIDES } from '../../test/ereportingDeLaPiece'
import { factureRecueCii, octetsDe, SIREN_DU_DOSSIER } from '../../test/factureRecue'
import type { OriginalRecu } from '../../lib/factureRecueLecture'

// « LIRE LA FACTURE ÉLECTRONIQUE » (B4R-Q1, tranchée le 12/11/2026 : « (A) Un bouton du cabinet dans la fiche »). La facture
// d'achat reçue par l'accès « Achats » arrive « à valider », sans montants ; le cabinet la relit d'un clic par le lecteur du
// navigateur, et la fiche se REMPLIT. Ce test garde : rien sous le drapeau baissé (le texte d'hier) ; le bouton levé ; deux
// clics du même `act`, une seule lecture ; la fiche remplie et RIEN d'écrit ; une autre entreprise comme acheteur ne remplit
// rien et se dit ; une pièce figée n'offre rien.

const HORS_DE_FRANCE: DonneesHorsDeFrance = {
  lecture: { fiches: [], taux: [], motif: null }, relire: async () => {}, anneeFigeante: null, gelIncomplet: null, pieces: [],
  ...ECARTS_ET_DECLARATIONS_VIDES,
}

const faux = vi.hoisted(() => ({
  achatsLeves: true,
  lectures: [] as string[],
  original: null as unknown,
  porte: null as Promise<void> | null,
  ecritures: [] as string[],
}))

vi.mock('../../lib/achatsClient', async (original) => ({
  ...await original<typeof import('../../lib/achatsClient')>(),
  get ACHATS_DU_CLIENT_PREVUS() { return faux.achatsLeves },
}))
// La section des achats du client (B5) a ses propres tests : ici, elle ne lit rien.
vi.mock('./AchatDeLaPiece', () => ({ default: () => null }))
vi.mock('../../lib/factureRecueLecture', () => ({
  lireLOriginalRecu: async (dossierId: string, chemin: string) => {
    faux.lectures.push(`${dossierId} ${chemin}`)
    await faux.porte
    return faux.original
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'piece_textes_ocr') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      }
      // Toute écriture se compte : le bouton ne doit en faire aucune.
      if (table === 'pieces') {
        const ecrire = (genre: string) => () => { faux.ecritures.push(genre); return { eq: () => Promise.resolve({ error: null }) } }
        return { update: ecrire('update'), insert: ecrire('insert'), delete: ecrire('delete') }
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }) }) },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: null }) }))
vi.mock('../../lib/extraction', () => ({
  hashFichier: () => Promise.resolve('empreinte-de-test'),
  fichierDejaPresent: () => Promise.resolve(false),
  extractPiece: () => { throw new Error('aucune extraction attendue') },
}))

function pieceRecue(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-1', dossier_id: 'd1', uploaded_by: 'client-1', source: 'plateforme',
    storage_path: 'd1/1700000000000-facture-42.xml', nom_fichier: 'facture 42.xml', storage_hash: 'h',
    date_piece: null, tiers: null, montant_ht: null, montant_tva: null,
    montant_ttc: null, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'a_valider', confiance: 'basse', superpdp_invoice_id: null, flux_hote: 'pa.exemple.fr', flux_id: 'f1', lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', ...o,
  }
}

function monter(piece: Piece = pieceRecue(), figeePar: string | null = null) {
  render(
    <FichePiece
      dossierId="d1" categories={[]} sousDossiers={[]} tiersCategories={[]} tiersCategoriesCabinet={[]} tiersConnus={[]}
      piece={piece} commentaires={[]} onClose={() => {}} onSaved={() => {}} horsDeFrance={HORS_DE_FRANCE}
      onCommentaireAjoute={() => {}} onCommentaireSupprime={() => {}} figeePar={figeePar}
    />,
  )
}

const champ = (id: string) => (document.querySelector(`#${id}`) as HTMLInputElement).value
const original = (xml: string): OriginalRecu => ({ octets: octetsDe(xml), sirenDossier: SIREN_DU_DOSSIER })

afterEach(() => {
  cleanup()
  faux.achatsLeves = true; faux.lectures = []; faux.original = null; faux.porte = null; faux.ecritures = []
})

describe('FichePiece — « Lire la facture électronique » (B4R-Q1)', () => {
  it('drapeau baissé : aucun bouton, le texte d’hier', () => {
    faux.achatsLeves = false
    monter()
    expect(screen.queryByRole('button', { name: 'Lire la facture électronique' })).toBeNull()
    expect(screen.getByText(/rien n’est à extraire/)).toBeTruthy()
  })

  it('deux clics, une lecture ; la fiche se remplit et rien ne s’écrit', async () => {
    let ouvrir: () => void = () => {}
    faux.porte = new Promise((r) => { ouvrir = r })
    faux.original = original(factureRecueCii())
    monter()
    const bouton = screen.getByRole('button', { name: 'Lire la facture électronique' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.lectures).toEqual(['d1 d1/1700000000000-facture-42.xml'])
    await act(async () => { ouvrir() })
    expect(await screen.findByText('La fiche est remplie depuis la facture électronique : vérifie-la, puis enregistre ou valide.')).toBeTruthy()
    expect([champ('date'), champ('tiers'), champ('ht'), champ('tva'), champ('ttc')]).toEqual(['2026-09-15', 'Fournitures Martin', '100', '20', '120'])
    expect(screen.getByText('Confiance haute — vérifie les champs')).toBeTruthy()
    expect(faux.ecritures).toEqual([])
  })

  it('une autre entreprise comme acheteur : rien ne se remplit, et le refus se dit', async () => {
    faux.original = original(factureRecueCii({ acheteur: '111111118' }))
    monter()
    fireEvent.click(screen.getByRole('button', { name: 'Lire la facture électronique' }))
    expect(await screen.findByText(/autre entreprise comme acheteur \(SIREN 111111118\)/)).toBeTruthy()
    expect([champ('tiers'), champ('ttc')]).toEqual(['', ''])
    expect(faux.ecritures).toEqual([])
  })

  it('le refus de la lecture se dit ; une pièce figée n’offre pas le bouton', async () => {
    faux.original = { refus: 'L’original de la facture n’a pas pu être téléchargé (Object not found).' }
    monter()
    fireEvent.click(screen.getByRole('button', { name: 'Lire la facture électronique' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('L’original de la facture n’a pas pu être téléchargé (Object not found).')).toBeTruthy()
    cleanup()
    monter(pieceRecue(), 'Exercice 2026 validé')
    expect(screen.queryByRole('button', { name: 'Lire la facture électronique' })).toBeNull()
  })
})
