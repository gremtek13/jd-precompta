import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import type { DonneesHorsDeFrance } from './FicheHorsDeFrance'
import type { CaisseDeLaPiece } from './ReglementParLaCaisse'
import { MOTS_DU_PAIEMENT } from '../../lib/paiementParLaCaisse'
import type { DonneesDeLaCaisse } from '../../lib/caisseEcran'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { OperationCaisse, Piece } from '../../lib/types'
import { ECARTS_ET_DECLARATIONS_VIDES } from '../../test/ereportingDeLaPiece'
import { AvecExercicesValides } from '../../test/exercicesValides'

// LA FICHE D'UNE PIÈCE DEVANT LA CAISSE (ligne 26.6, étape C9b). Ce que ces cas gardent, et qu'aucun test de `src/lib` ne voit :
// le câblage — la section « Payée en espèces » ne se monte qu'avec la caisse, le drapeau levé ; la garde de la pièce payée
// (`garder_piece_payee_par_la_caisse`) se dit AVANT l'enregistrement et grise les deux boutons ; une pièce qu'un paiement cite
// n'offre pas « Supprimer », et le dit. Le drapeau BAISSÉ, la fiche est celle d'hier, même avec la caisse passée. Des jeux FICTIFS.

const drapeau = vi.hoisted(() => ({ leve: true as boolean }))
vi.mock('../../lib/paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('../../lib/paiementParLaCaisse')>()
  return { ...module, get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeau.leve } }
})

const faux = vi.hoisted(() => ({ updates: [] as unknown[] }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pieces') {
        return { update: (ligne: unknown) => { faux.updates.push(ligne); return { eq: () => Promise.resolve({ error: null }) } } }
      }
      if (table === 'notes_internes') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), upsert: () => Promise.resolve({ error: null }) }
      }
      if (table === 'piece_textes_ocr') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }) }) },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: null, session: null }) }))

const D = 'd1'
const MODELE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const HORS_DE_FRANCE: DonneesHorsDeFrance = {
  lecture: { fiches: [], taux: [], motif: null }, relire: async () => {}, anneeFigeante: null, gelIncomplet: null, pieces: [],
  ...ECARTS_ET_DECLARATIONS_VIDES,
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/f.pdf`, nom_fichier: 'fournitures.pdf', storage_hash: null,
    date_piece: '2026-03-04', tiers: 'PAPETERIE FICTIVE', montant_ht: null, montant_tva: null, montant_ttc: 120, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null,
    confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-03-04T08:00:00Z', updated_at: '2026-03-04T08:00:00Z', ...o,
  } as Piece
}
function operation(o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse {
  return {
    dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 200, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}
function caisse(operations: OperationCaisse[]): CaisseDeLaPiece {
  const donnees: DonneesDeLaCaisse = {
    operations, ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' }, categories: [], piecesPayees: [],
  }
  return { lecture: { dossierId: D, etat: 'lue', donnees }, modele: MODELE, assujettiTva: false, paiements: new Map(), relire: async () => {} }
}
const PAYE = operation({ id: 'pa', genre: 'paiement', date: '2026-03-05', montant: -50, piece_id: 'p1' })

function monter(c: CaisseDeLaPiece | null, p: Piece = piece()) {
  return render(
    <AvecExercicesValides>
      <FichePiece
        dossierId={D} categories={[]} sousDossiers={[]} tiersCategories={[]} tiersCategoriesCabinet={[]} tiersConnus={[]}
        piece={p} commentaires={[]} onClose={() => {}} onSaved={() => {}} onCommentaireAjoute={() => {}} onCommentaireSupprime={() => {}}
        horsDeFrance={HORS_DE_FRANCE} caisse={c}
      />
    </AvecExercicesValides>,
  )
}

beforeEach(() => {
  drapeau.leve = true
  faux.updates = []
})
afterEach(() => { vi.restoreAllMocks() })

describe('la fiche d’une pièce devant la caisse', () => {
  it('sans la caisse, ou le drapeau baissé : ni section, ni refus, et « Supprimer » comme hier', async () => {
    const { unmount } = monter(null)
    await act(async () => {})
    expect(screen.queryByRole('region', { name: 'Payée en espèces' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeTruthy()
    unmount()
    drapeau.leve = false
    monter(caisse([operation({ id: 'ap' }), PAYE]))
    await act(async () => {})
    expect(screen.queryByRole('region', { name: 'Payée en espèces' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'note_frais' } })
    expect(screen.queryByText(MOTS_DU_PAIEMENT.piece_change_de_type.gabarit)).toBeNull()
  })

  it('le drapeau levé : la section se monte, et dit le paiement de la pièce', async () => {
    monter(caisse([operation({ id: 'ap' }), PAYE]))
    await act(async () => {})
    const section = screen.getByRole('region', { name: 'Payée en espèces' })
    expect(section.textContent).toContain('Le paiement en espèces du 05/03/2026')
    expect(screen.getByRole('button', { name: 'Régler par la caisse' })).toBeTruthy()
  })

  it('une pièce payée qui deviendrait une note de frais : le refus de la garde AVANT l’enregistrement, et rien ne part', async () => {
    monter(caisse([operation({ id: 'ap' }), PAYE]))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'note_frais' } })
    expect(screen.getByText(MOTS_DU_PAIEMENT.piece_change_de_type.gabarit)).toBeTruthy()
    const valider = screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement
    const brouillon = screen.getByRole('button', { name: 'Enregistrer brouillon' }) as HTMLButtonElement
    expect([valider.disabled, brouillon.disabled]).toEqual([true, true])
    await act(async () => { fireEvent.click(brouillon) })
    expect(faux.updates).toEqual([])
    // De vente, elle reste réglable : aucun refus.
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'vente' } })
    expect(screen.queryByText(MOTS_DU_PAIEMENT.piece_change_de_type.gabarit)).toBeNull()
  })

  it('une pièce qu’un paiement cite — même retiré — n’offre pas « Supprimer », et le dit', async () => {
    const { unmount } = monter(caisse([operation({ id: 'ap' }), PAYE]))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(screen.getByText(/^Cette pièce est payée par la caisse : elle ne se supprime pas/)).toBeTruthy()
    unmount()
    monter(caisse([operation({ id: 'ap' }), { ...PAYE, retire_le: '2026-03-06T08:00:00Z' }]))
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(screen.getByText(/^Un paiement de la caisse, retiré, cite cette pièce/)).toBeTruthy()
  })

  it('une pièce que rien ne cite garde « Supprimer » ; une caisse lue en partie ne retient rien (la base reste juge)', async () => {
    const { unmount } = monter(caisse([operation({ id: 'ap' })]))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeTruthy()
    unmount()
    monter({ ...caisse([]), lecture: { dossierId: D, etat: 'incomplete', motif: 'coupée' } })
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeTruthy()
    expect(screen.getByText(/n’a pas pu être lue en entier \(coupée\)/)).toBeTruthy()
  })
})
