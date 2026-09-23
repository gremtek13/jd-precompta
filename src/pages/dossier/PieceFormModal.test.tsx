import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PieceFormModal from './PieceFormModal'
import type { Piece } from '../../lib/types'

// Le verrou d'exécution de l'enregistrement d'une pièce (CLAUDE.md, « un verrou d'exécution est un
// `useRef`, jamais un état React »). Le doublon ne crée pas qu'une ligne en trop : c'est une PIÈCE
// de plus sur le même justificatif, donc une charge comptée deux fois — en 2035 comme en balance.
// Le formulaire est le pire déclencheur : « Valider » est un submit, donc deux « Entrée »
// rapprochés suffisent, pas seulement un double clic. CLAUDE.md annonçait cette couverture livrée
// le 21/09/2026 ; aucun fichier de test n'existait — c'est ce que ce fichier corrige.
const faux = vi.hoisted(() => ({
  appelsUpdate: [] as unknown[],
  resoudreUpdate: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pieces') {
        return {
          update: (payload: unknown) => {
            faux.appelsUpdate.push(payload)
            return { eq: () => new Promise((resolve) => { faux.resoudreUpdate = resolve }) }
          },
        }
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://exemple.test/apercu' }, error: null }),
      }),
    },
  },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ monCabinetId: 'c1' }),
}))

// Pièce déjà existante et sans fichier redéposé : `save()` saute alors le dépôt, le hash et la
// vérification de doublon (voir `uploadFile`/`save` dans PieceFormModal.tsx), qui ne concernent que
// la création ou le remplacement d'un fichier — hors du périmètre du verrou testé ici.
const piece: Piece = {
  id: 'p1',
  dossier_id: 'd1',
  uploaded_by: 'u1',
  source: 'upload',
  storage_path: 'd1/facture.pdf',
  nom_fichier: 'facture.pdf',
  storage_hash: 'abc',
  date_piece: '2026-09-01',
  tiers: null,
  montant_ht: 100,
  montant_tva: 20,
  montant_ttc: 120,
  devise: 'EUR',
  montant_devise: null,
  taux_change: null,
  conversion_source: null,
  categorie_id: null,
  sous_dossier_id: null,
  type_piece: 'achat',
  statut: 'a_valider',
  notes: null,
  confiance: null,
  superpdp_invoice_id: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
}

function monter() {
  faux.appelsUpdate = []
  faux.resoudreUpdate = null
  render(
    <PieceFormModal
      dossierId="d1"
      categories={[]}
      sousDossiers={[]}
      tiersCategories={[]}
      tiersCategoriesCabinet={[]}
      tiersConnus={[]}
      piece={piece}
      commentaires={[]}
      onClose={() => {}}
      onSaved={() => {}}
      onCommentaireAjoute={() => {}}
      onCommentaireSupprime={() => {}}
    />,
  )
  return screen.getByRole('button', { name: 'Valider' })
}

describe('PieceFormModal — le verrou d’enregistrement', () => {
  it("n'enregistre qu'une fois quand on soumet deux fois de suite (« Valider »)", async () => {
    const bouton = monter()

    // LES DEUX SOUMISSIONS DANS LE MÊME `act` : deux `.click()` successifs ouvrent chacun leur
    // `act`, qui rend le composant en sortant — le second tomberait sur un bouton déjà re-rendu avec
    // `saving` à jour, et le test resterait vert avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appelsUpdate).toHaveLength(1)
  })

  // IL FAUT TROIS SOUMISSIONS pour distinguer un verrou posé avant le `try` d'un verrou posé
  // dedans : si la vérification/pose du verrou vivait DANS le `try`, le `return` de la deuxième
  // soumission sortirait par le `finally`, qui relâcherait le verrou de la PREMIÈRE — encore en
  // cours — et la troisième repartirait pour un second enregistrement (CLAUDE.md).
  it("une troisième soumission n'enregistre pas une seconde fois", async () => {
    const bouton = monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appelsUpdate).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = monter()
    await act(async () => { bouton.click() })
    expect(faux.appelsUpdate).toHaveLength(1)

    // L'écriture échoue : `save` l'attrape et son `finally` doit relâcher le verrou — sinon la
    // modale resterait bloquée jusqu'à sa réouverture.
    await act(async () => { faux.resoudreUpdate?.({ error: { message: 'Échec écriture' } }) })
    expect(screen.getByText(/Échec écriture/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Valider' }).click() })
    expect(faux.appelsUpdate).toHaveLength(2)
  })
})
