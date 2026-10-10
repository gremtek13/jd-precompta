import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import { AUCUNE_PIECE_SUPPRIMEE } from '../../lib/bilanSuppression'
import type { Piece } from '../../lib/types'
import type { DonneesHorsDeFrance } from './FicheHorsDeFrance'

const HORS_DE_FRANCE: DonneesHorsDeFrance = {
  lecture: { fiches: [], taux: [], motif: null }, relire: async () => {}, anneeFigeante: null, gelIncomplet: null, pieces: [],
}

// « SUPPRIMER » UNE PIÈCE DEPUIS SA FICHE RETIRAIT SES FICHIERS SUR LA SEULE ABSENCE D'ERREUR (09/10/2026,
// `ecrituresVerifiees.test.ts`). Or PostgREST rend une suppression qui ne touche AUCUNE ligne sans erreur — la policy a
// écarté la ligne, ou un autre onglet l'a déjà retirée : la pièce restait visible, et son fichier était parti. La ligne
// supprimée se lit désormais avant tout retrait. Rouge sur le code d'avant.
//
// À part de `FichePiece.test.tsx` : ce fichier ne porte que ce que la suppression rend, et son faux client le programme.
const faux = vi.hoisted(() => ({
  // Ce que rend la suppression : la ligne supprimée, rien (zéro ligne, sans erreur), ou un refus.
  rendu: 'supprimee' as 'supprimee' | 'aucune' | 'refus',
  suppressions: [] as unknown[],
  retraits: [] as string[][],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      // Le texte lu d'une pièce d'achat, que la fiche « hors de France » lit pour ses signaux : aucun ici.
      if (table === 'piece_textes_ocr') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      }
      if (table !== 'pieces') throw new Error(`Table non attendue dans ce test : ${table}`)
      return {
        delete: () => ({
          eq: (colonne: string, id: unknown) => {
            if (colonne === 'id') faux.suppressions.push(id)
            return {
              select: () => ({
                maybeSingle: () => Promise.resolve(
                  faux.rendu === 'refus' ? { data: null, error: { message: 'permission denied for table pieces' } }
                    : faux.rendu === 'aucune' ? { data: null, error: null }
                      : { data: { id }, error: null },
                ),
              }),
            }
          },
        }),
      }
    },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }),
        remove: (chemins: string[]) => {
          faux.retraits.push(chemins)
          return Promise.resolve({ error: null })
        },
      }),
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: null }) }))
vi.mock('../../lib/extraction', () => ({
  hashFichier: () => Promise.resolve('empreinte-de-test'),
  fichierDejaPresent: () => Promise.resolve(false),
  extractPiece: () => Promise.resolve({}),
}))

function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-1', dossier_id: 'd1', uploaded_by: null, source: 'upload',
    storage_path: 'd1/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Fournisseur', montant_ht: null, montant_tva: null,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

async function supprimer(rendu: typeof faux.rendu) {
  faux.rendu = rendu
  faux.suppressions = []
  faux.retraits = []
  const surEnregistree = vi.fn()
  render(
    <FichePiece
      dossierId="d1" categories={[]} sousDossiers={[]} tiersCategories={[]} tiersCategoriesCabinet={[]} tiersConnus={[]}
      piece={pieceDeTest()} commentaires={[]} onClose={() => {}} onSaved={surEnregistree} horsDeFrance={HORS_DE_FRANCE}
      onCommentaireAjoute={() => {}} onCommentaireSupprime={() => {}}
    />,
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await act(async () => { screen.getByRole('button', { name: /Supprimer/ }).click() })
  return surEnregistree
}

afterEach(() => { vi.restoreAllMocks() })

describe('FichePiece — une suppression qui ne supprime rien', () => {
  it('ne retire pas le fichier d’une pièce que la base n’a pas supprimée, et le dit', async () => {
    const surEnregistree = await supprimer('aucune')

    expect(faux.suppressions).toEqual(['piece-1'])
    expect(faux.retraits).toEqual([])
    expect(screen.getByText(`La pièce n’a pas pu être supprimée, et aucun de ses fichiers n’a été touché : ${AUCUNE_PIECE_SUPPRIMEE}.`)).toBeTruthy()
    // La fiche ne se ferme pas sur un succès qu'elle n'a pas obtenu.
    expect(surEnregistree).not.toHaveBeenCalled()
  })

  it('ne retire rien non plus sur un refus, et rend la raison de la base', async () => {
    const surEnregistree = await supprimer('refus')

    expect(faux.retraits).toEqual([])
    expect(screen.getByText('permission denied for table pieces')).toBeTruthy()
    expect(surEnregistree).not.toHaveBeenCalled()
  })

  it('retire la ligne puis son fichier quand la base l’a supprimée', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « ne retire rien » serait satisfait par une fiche qui ne retire jamais.
    const surEnregistree = await supprimer('supprimee')

    expect(faux.retraits).toEqual([['d1/facture.pdf']])
    expect(surEnregistree).toHaveBeenCalledTimes(1)
  })
})
