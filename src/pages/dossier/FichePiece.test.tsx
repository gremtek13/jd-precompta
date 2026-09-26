import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import { AVERTISSEMENT_RAPPROCHEMENT_DEFAIT } from '../../lib/controles'
import type { Categorie, Piece, TiersCategorie } from '../../lib/types'

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
  suppressions: [] as unknown[],
  // La promesse du premier `insert` reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle un
  // second envoi arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudreInsert: null as null | ((v: unknown) => void),
  updates: [] as unknown[],
  // Les appels aux Edge Functions, et la réponse programmée par chaque test — `null` la laisse EN
  // ATTENTE, pour ouvrir la fenêtre pendant laquelle un second clic arrive.
  invocations: [] as { nom: string; corps: unknown }[],
  reponseFonction: null as null | { data: unknown; error: unknown },
  resoudreFonction: null as null | ((v: { data: unknown; error: unknown }) => void),
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
          update: (ligne: unknown) => {
            faux.updates.push(ligne)
            return { eq: () => Promise.resolve({ error: null }) }
          },
          delete: () => ({
            eq: (_c: string, id: unknown) => {
              faux.suppressions.push(id)
              return Promise.resolve({ error: null })
            },
          }),
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
    functions: {
      invoke: (nom: string, options: { body: unknown }) => {
        faux.invocations.push({ nom, corps: options.body })
        if (faux.reponseFonction) return Promise.resolve(faux.reponseFonction)
        return new Promise((resolve) => { faux.resoudreFonction = resolve })
      },
    },
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
    <FichePiece
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

describe('FichePiece — le verrou d’enregistrement d’une pièce', () => {
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

// UNE CONFIRMATION NOMME CE QU'ON PERD — et celle-ci ne le faisait pas, sur le seul effet de la
// suppression qui ne se voit nulle part ensuite. `lignes_bancaires.piece_id` est en
// `ON DELETE SET NULL` : le mouvement rapproché sur cette pièce garde `statut = 'rapprochee'` et ne
// désigne plus rien. Le message d'avant disait même l'inverse — « cette pièce est liée à un
// rapprochement bancaire […] retire d'abord ce lien » — alors que ce lien ne bloque RIEN : mesuré le
// 23/09/2026, aucune des cinq clés entrantes de `pieces` n'est en NO ACTION, donc 23503 ne peut pas
// se lever ici.
function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-1', dossier_id: 'd1', uploaded_by: null, source: 'upload',
    storage_path: 'd1/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Fournisseur', montant_ht: null, montant_tva: null,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

function monterSurPieceExistante() {
  faux.inserts = []
  faux.uploads = []
  faux.suppressions = []
  render(
    <FichePiece
      dossierId="d1"
      categories={[]}
      sousDossiers={[]}
      tiersCategories={[]}
      tiersCategoriesCabinet={[]}
      tiersConnus={[]}
      piece={pieceDeTest()}
      commentaires={[]}
      onClose={() => {}}
      onSaved={() => {}}
      onCommentaireAjoute={() => {}}
      onCommentaireSupprime={() => {}}
    />,
  )
  return screen.getByRole('button', { name: /Supprimer/ })
}

describe('FichePiece — supprimer une pièce dit ce que ça défait', () => {
  it('nomme le rapprochement bancaire défait dans la confirmation', async () => {
    const bouton = monterSurPieceExistante()
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })

    await act(async () => { bouton.click() })

    expect(message).toContain(AVERTISSEMENT_RAPPROCHEMENT_DEFAIT)
    expect(faux.suppressions).toHaveLength(0)
    // Le message d'avant envoyait chercher un lien à retirer qui ne bloque rien.
    expect(message).not.toMatch(/Retire d.abord ce lien/)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la confirmation nomme ce qu'on perd » serait satisfait par un
  // bouton qui ne supprime JAMAIS.
  it('supprime bien quand on confirme', async () => {
    const bouton = monterSurPieceExistante()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual(['piece-1'])
  })
})

// « PROPOSER UNE CATÉGORIE » — la ligne 25 de la feuille de route, et le contrat de
// `lib/categorisationIa.ts` vu depuis l'écran. La fonction qui répond est doublée au niveau de
// `functions.invoke`, pas du module qui l'appelle : la vraie lecture de la réponse et le vrai message
// d'erreur tournent donc ici, et le CORPS envoyé est vérifié.
//
// Ce que ces tests gardent, qu'aucun test de `src/lib` ne peut voir : que la proposition ne REMPLIT
// le champ que sur le clic de l'opérateur et n'écrit RIEN en base ; qu'une règle apprise passe avant
// le modèle, qui coûte ; que le type affiché part avec la demande ; et que chaque clic — un appel
// facturé — passe par un verrou.

const CATEGORIES: Categorie[] = [
  { id: 'cat-fournitures', dossier_id: null, code: 'fournitures', libelle: 'Fournitures', ordre: 1, compte_comptable: '606000', poste_2035: 'Achats' },
  { id: 'cat-ventes', dossier_id: null, code: 'ventes', libelle: 'Ventes / prestations', ordre: 2, compte_comptable: '706000', poste_2035: 'Recettes' },
]

const RETENUE = { data: { issue: 'retenue', categorieId: 'cat-fournitures', indice: 'FOUR MICRO-ONDES' }, error: null }

function monterPourProposer(o: { piece?: Partial<Piece>; regles?: TiersCategorie[]; sansTexteLu?: boolean } = {}) {
  faux.inserts = []
  faux.updates = []
  faux.invocations = []
  faux.resoudreFonction = null
  render(
    <FichePiece
      dossierId="d1"
      categories={CATEGORIES}
      sousDossiers={[]}
      tiersCategories={o.regles ?? []}
      tiersCategoriesCabinet={[]}
      tiersConnus={[]}
      piece={pieceDeTest({ tiers: 'Boulanger Marseille', statut: 'a_valider', ...o.piece })}
      commentaires={[]}
      onClose={() => {}}
      onSaved={() => {}}
      onCommentaireAjoute={() => {}}
      onCommentaireSupprime={() => {}}
      sansTexteLu={o.sansTexteLu}
    />,
  )
}

const champCategorie = () => document.querySelector<HTMLSelectElement>('#categorie')!
const boutonProposer = () => screen.queryByRole('button', { name: /Proposer une catégorie/ })

describe('FichePiece — proposer une catégorie', () => {
  beforeEach(() => { faux.reponseFonction = RETENUE })

  it('propose sur un clic, montre l’extrait qui la justifie, et ne remplit rien tout seul', async () => {
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })

    expect(faux.invocations).toEqual([{ nom: 'proposer-categorie', corps: { pieceId: 'piece-1', typePiece: 'achat' } }])
    // Le libellé de la liste de la fiche — « Fournitures » est aussi une option du champ.
    expect(document.querySelector('.proposition-categorie strong')?.textContent).toBe('Fournitures')
    expect(screen.getByText(/« FOUR MICRO-ONDES »/)).toBeTruthy()
    // Proposée n'est pas appliquée : le champ attend le clic.
    expect(champCategorie().value).toBe('')
    expect(faux.updates).toHaveLength(0)
    expect(faux.inserts).toHaveLength(0)
  })

  it('« Appliquer » remplit le champ — et n’enregistre toujours rien', async () => {
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })
    await act(async () => { screen.getByRole('button', { name: 'Appliquer' }).click() })

    expect(champCategorie().value).toBe('cat-fournitures')
    // Le bloc s'efface : une catégorie est choisie, il n'y a plus rien à proposer.
    expect(screen.queryByRole('button', { name: 'Appliquer' })).toBeNull()
    expect(faux.updates).toHaveLength(0)
    expect(faux.inserts).toHaveLength(0)
  })

  it('« Écarter » retire la proposition sans rien appliquer', async () => {
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })
    await act(async () => { screen.getByRole('button', { name: 'Écarter' }).click() })

    expect(champCategorie().value).toBe('')
    expect(screen.queryByText(/FOUR MICRO-ONDES/)).toBeNull()
    expect(boutonProposer()).toBeTruthy()
  })

  it('envoie le type AFFICHÉ, et une proposition faite pour un autre type ne se montre plus', async () => {
    monterPourProposer()
    fireEvent.change(document.querySelector('#type')!, { target: { value: 'note_frais' } })
    await act(async () => { boutonProposer()!.click() })
    expect(faux.invocations[0].corps).toEqual({ pieceId: 'piece-1', typePiece: 'note_frais' })
    expect(screen.getByText(/FOUR MICRO-ONDES/)).toBeTruthy()

    // Repassée en vente, la pièce ne se voit plus proposer une catégorie de dépense.
    fireEvent.change(document.querySelector('#type')!, { target: { value: 'vente' } })
    expect(screen.queryByText(/FOUR MICRO-ONDES/)).toBeNull()
    expect(boutonProposer()).toBeTruthy()
  })

  it('dit pourquoi une proposition est écartée, sans rien montrer à appliquer', async () => {
    faux.reponseFonction = { data: { issue: 'indice absent du texte', categorieId: null, indice: null }, error: null }
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })

    expect(screen.getByText(/l’extrait cité pour la justifier ne figure pas dans le document/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Appliquer' })).toBeNull()
  })

  it('dit l’erreur que la fonction a rendue, pas un repli', async () => {
    faux.reponseFonction = {
      data: null,
      error: { context: new Response(JSON.stringify({ error: 'Pièce introuvable.' }), { status: 404 }) },
    }
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })
    expect(screen.getByText('Pièce introuvable.')).toBeTruthy()
  })

  it('une catégorie proposée hors de la liste de la fiche ne se pose pas dans le champ', async () => {
    faux.reponseFonction = { data: { issue: 'retenue', categorieId: 'cat-inconnue', indice: 'FOUR MICRO-ONDES' }, error: null }
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })
    expect(screen.getByText(/n’est pas dans la liste de ce dossier/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Appliquer' })).toBeNull()
  })

  // LE VERROU : chaque clic est un appel au modèle FACTURÉ. Les clics partent dans le MÊME `act`, et
  // il en faut TROIS pour distinguer un verrou posé avant le `try` d'un verrou posé dedans.
  it('trois clics rapprochés ne font qu’un appel', async () => {
    faux.reponseFonction = null
    monterPourProposer()
    const bouton = boutonProposer()!
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.invocations).toHaveLength(1)
    await act(async () => { faux.resoudreFonction?.(RETENUE) })
    expect(screen.getByText(/FOUR MICRO-ONDES/)).toBeTruthy()
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    faux.reponseFonction = null
    monterPourProposer()
    await act(async () => { boutonProposer()!.click() })
    await act(async () => { faux.resoudreFonction?.({ data: null, error: new Error('Réseau coupé') }) })
    expect(screen.getByText('Réseau coupé')).toBeTruthy()

    faux.reponseFonction = RETENUE
    await act(async () => { boutonProposer()!.click() })
    expect(faux.invocations).toHaveLength(2)
    expect(screen.getByText(/FOUR MICRO-ONDES/)).toBeTruthy()
  })

  it('une règle apprise passe avant le modèle : elle se propose, et le modèle n’est pas offert', async () => {
    const regle: TiersCategorie = {
      id: 'r1', dossier_id: 'd1', tiers_normalise: 'boulanger marseille', categorie_id: 'cat-fournitures', updated_at: '2026-03-01T00:00:00Z',
    }
    monterPourProposer({ regles: [regle] })
    expect(boutonProposer()).toBeNull()
    expect(screen.getByText(/Une règle apprise range ce fournisseur en/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Appliquer' }).click() })
    expect(champCategorie().value).toBe('cat-fournitures')
    expect(faux.invocations).toHaveLength(0)
  })

  // GARDES SYMÉTRIQUES : sans elles, « le bouton s'affiche » serait satisfait par un bouton qui
  // s'afficherait partout — sur une pièce sans texte à citer, déjà catégorisée, ou pas encore créée.
  it('ne s’offre pas sur une pièce dont on SAIT qu’elle n’a pas de texte lu', () => {
    monterPourProposer({ sansTexteLu: true })
    expect(boutonProposer()).toBeNull()
  })

  it('ne s’offre pas quand une catégorie est déjà choisie', () => {
    monterPourProposer({ piece: { categorie_id: 'cat-ventes' } })
    expect(boutonProposer()).toBeNull()
  })

  it('ne s’offre pas sur une pièce en cours de création', () => {
    monter()
    expect(boutonProposer()).toBeNull()
  })
})
