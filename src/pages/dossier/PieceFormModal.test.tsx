import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PieceFormModal from './PieceFormModal'

// Le verrou d'exécution de l'enregistrement d'une pièce (CLAUDE.md, « un verrou d'exécution est un
// `useRef`, jamais un état React »). C'est le dernier des quatre verrous corrigés le 20/09/2026 à
// n'avoir aucun test, et celui dont le doublon coûte le plus cher : il crée une PIÈCE de plus sur le
// même justificatif, donc une charge comptée deux fois — en 2035 comme en balance.
//
// AUCUN TEST DE `src/lib` NE PEUT LE VOIR : toute la logique appelée derrière est juste, c'est le
// NOMBRE d'appels qui serait faux. Même famille que le défaut d'origine du projet, 141 lignes
// importées pour 78 fichiers, ici sur le chemin à l'unité.
//
// ET LE FORMULAIRE EST LE PIRE DÉCLENCHEUR, PAS LE DOUBLE CLIC : le bouton « Valider » est un
// `type="submit"` dans un `<form>`, donc deux « Entrée » rapprochés suffisent — geste bien plus
// banal que deux clics, comme pour `EnvoyerEmailModal`.

const faux = vi.hoisted(() => ({
  inserts: [] as unknown[],
  uploads: [] as string[],
  // La promesse du premier `insert` reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle un
  // second envoi arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudreInsert: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pieces') {
        return {
          insert: (ligne: unknown) => {
            faux.inserts.push(ligne)
            return new Promise((resolve) => { faux.resoudreInsert = resolve })
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      // Volontairement bruyant : une table inattendue doit nommer ce que le test n'avait pas prévu,
      // plutôt que de rendre un objet vide et de faire échouer l'écran loin de la cause.
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    storage: {
      from: () => ({
        upload: (chemin: string) => {
          faux.uploads.push(chemin)
          return Promise.resolve({ error: null })
        },
        createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }),
      }),
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))

// Doublé plutôt que monté en vrai : un `AuthProvider` complet ferait dépendre ce test d'une session
// Supabase (CLAUDE.md). `monCabinetId` à null suffit — la règle de cabinet n'est de toute façon pas
// exercée ici, le champ tiers restant vide.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: null }) }))

// L'extraction est doublée pour ne rien facturer : ce test porte sur le NOMBRE d'enregistrements,
// pas sur ce que l'OCR lit.
vi.mock('../../lib/extraction', () => ({
  hashFichier: () => Promise.resolve('empreinte-de-test'),
  fichierDejaPresent: () => Promise.resolve(false),
  extractPiece: () => Promise.resolve({}),
}))

function monter() {
  faux.inserts = []
  faux.uploads = []
  faux.resoudreInsert = null
  render(
    <PieceFormModal
      dossierId="d1"
      categories={[]}
      sousDossiers={[]}
      tiersCategories={[]}
      tiersCategoriesCabinet={[]}
      tiersConnus={[]}
      piece={null}
      commentaires={[]}
      onClose={() => {}}
      onSaved={() => {}}
      onCommentaireAjoute={() => {}}
      onCommentaireSupprime={() => {}}
    />,
  )

  // Les deux seules conditions que `save('validee')` exige : un fichier (création) et un TTC.
  const fichier = new File(['%PDF-1.4 facture'], 'facture.pdf', { type: 'application/pdf' })
  fireEvent.change(document.querySelector('#file')!, { target: { files: [fichier] } })
  fireEvent.change(document.querySelector('#ttc')!, { target: { value: '120.00' } })

  return screen.getByRole('button', { name: 'Valider' })
}

beforeEach(() => {
  // jsdom n'implémente pas `createObjectURL`, que l'aperçu appelle dès qu'un fichier est choisi.
  URL.createObjectURL = () => 'blob:apercu'
  URL.revokeObjectURL = () => {}
})

describe('PieceFormModal — le verrou d’enregistrement d’une pièce', () => {
  it("n'enregistre qu'une seule pièce quand le formulaire part deux fois de suite", async () => {
    const bouton = monter()

    // LES DEUX ENVOIS DANS LE MÊME `act` : deux `.click()` successifs ouvrent chacun leur `act`, qui
    // rend le composant en sortant — le second tomberait sur un bouton déjà re-rendu avec `saving` à
    // jour, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.inserts).toHaveLength(1)
    // Le dépôt du fichier précède l'insertion : le compter aussi attrape un envoi qui aurait franchi
    // le verrou sans encore avoir atteint la base.
    expect(faux.uploads).toHaveLength(1)
  })

  // IL FAUT TROIS ENVOIS pour distinguer un verrou posé AVANT le `try` d'un verrou posé dedans : si
  // la pose vivait dans le `try`, le `return` du deuxième sortirait par le `finally`, qui relâcherait
  // le verrou du PREMIER — encore en cours — et le troisième repartirait pour une seconde pièce.
  // Avec deux envois seulement, la version fautive paraît correcte.
  it('un troisième envoi ne crée pas de seconde pièce', async () => {
    const bouton = monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.inserts).toHaveLength(1)
    expect(faux.uploads).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = monter()
    await act(async () => { bouton.click() })
    expect(faux.inserts).toHaveLength(1)

    // L'insertion répond une erreur : `save` la lève, l'attrape, et son `finally` doit relâcher le
    // verrou — sinon la fiche resterait bloquée jusqu'à sa réouverture, avec un justificatif déposé
    // dans le stockage et aucune ligne en base pour le relier (l'orphelin que ce dépôt connaît).
    await act(async () => { faux.resoudreInsert?.({ error: { message: 'Insertion refusée' } }) })
    expect(screen.getByText(/Insertion refusée/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Valider' }).click() })
    expect(faux.inserts).toHaveLength(2)
  })

  // Le second chemin d'enregistrement de la même fiche, et il porte le MÊME verrou — un test qui
  // n'exercerait que « Valider » laisserait « Enregistrer brouillon » à découvert, alors que c'est le
  // geste le plus courant sur une pièce qu'on vient de déposer.
  it('couvre aussi l’enregistrement en brouillon', async () => {
    monter()
    const brouillon = screen.getByRole('button', { name: 'Enregistrer brouillon' })
    await act(async () => { brouillon.click(); brouillon.click(); brouillon.click() })
    expect(faux.inserts).toHaveLength(1)
  })
})
