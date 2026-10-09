import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import { AVERTISSEMENT_PAIEMENT_DEFAIT } from '../../lib/controles'
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
  // Le stockage : les chemins dont une adresse signée est demandée (ce qui est MONTRÉ), et ceux qu'on retire.
  cheminsSignes: [] as string[],
  urlSignee: false,
  retraits: [] as string[][],
  // Les lectures automatiques demandées — chacune FACTURÉE (OCR puis citation) —, la porte qui retient leur réponse, et
  // l'échec qu'un test peut leur faire rendre.
  extractions: 0,
  porteExtraction: null as Promise<void> | null,
  erreurExtraction: null as Error | null,
  // LA NOTE INTERNE (`notes_internes`, espace client P0) : ce que rend sa lecture — `null` la laisse EN ATTENTE —, les
  // lectures demandées, les écritures envoyées et la réponse de chacune.
  noteLue: { data: null, error: null } as null | { data: unknown; error: unknown },
  resoudreNote: null as null | ((v: { data: unknown; error: unknown }) => void),
  // Toutes les lectures restées en attente, dans l'ordre : pour rendre une réponse APRÈS celle d'une lecture suivante.
  lecturesEnAttente: [] as ((v: { data: unknown; error: unknown }) => void)[],
  lecturesNote: [] as unknown[][],
  notesEcrites: [] as { ligne: unknown; options: unknown }[],
  reponseNoteEcrite: { error: null } as { error: unknown },
  // L'ordre des écritures, toutes tables confondues : la note part AVANT la pièce.
  ordre: [] as string[],
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
            faux.ordre.push('pieces.update')
            return { eq: () => Promise.resolve({ error: null }) }
          },
          // La suppression rend la ligne supprimée (`.select('id').maybeSingle()`) : c'est elle qui autorise le retrait
          // des fichiers. Le cas où la base n'en supprime aucune est joué dans `FichePiece.ecritures.test.tsx`.
          delete: () => ({
            eq: (_c: string, id: unknown) => {
              faux.suppressions.push(id)
              return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id }, error: null }) }) }
            },
          }),
        }
      }
      if (table === 'notes_internes') {
        return {
          select: (colonnes: string) => ({
            eq: (colonne: string, valeur: unknown) => ({
              maybeSingle: () => {
                faux.lecturesNote.push([colonnes, colonne, valeur])
                if (faux.noteLue) return Promise.resolve(faux.noteLue)
                return new Promise((resolve) => {
                  faux.resoudreNote = resolve
                  faux.lecturesEnAttente.push(resolve)
                })
              },
            }),
          }),
          upsert: (ligne: unknown, options: unknown) => {
            faux.notesEcrites.push({ ligne, options })
            faux.ordre.push('notes_internes.upsert')
            return Promise.resolve(faux.reponseNoteEcrite)
          },
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
        createSignedUrl: (chemin: string) => {
          faux.cheminsSignes.push(chemin)
          return Promise.resolve(faux.urlSignee
            ? { data: { signedUrl: `https://stockage.exemple/${chemin}` }, error: null }
            : { data: null, error: { message: 'non utilisé' } })
        },
        remove: (chemins: string[]) => {
          faux.retraits.push(chemins)
          return Promise.resolve({ error: null })
        },
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
  extractPiece: async () => {
    faux.extractions += 1
    await faux.porteExtraction
    if (faux.erreurExtraction) throw faux.erreurExtraction
    return {}
  },
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
  faux.extractions = 0
  faux.porteExtraction = null
  faux.erreurExtraction = null
  faux.noteLue = { data: null, error: null }
  faux.resoudreNote = null
  faux.lecturesEnAttente = []
  faux.lecturesNote = []
  faux.notesEcrites = []
  faux.reponseNoteEcrite = { error: null }
  faux.ordre = []
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

// « EXTRAIRE AUTOMATIQUEMENT » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026). `disabled={extracting}` ne prend effet qu'au
// rendu suivant : deux clics du même rendu payaient deux lectures du même fichier — OCR puis citation par le modèle,
// chacune FACTURÉE —, et la plus lente des deux réécrivait les champs que l'opérateur avait peut-être déjà corrigés
// d'après la première. Le cas à TROIS clics est le seul à distinguer un verrou posé dans le `try`.
describe('FichePiece — le verrou de l’extraction automatique', () => {
  function retenirLExtraction(): () => Promise<void> {
    let ouvrir = () => {}
    faux.porteExtraction = new Promise<void>((resolve) => { ouvrir = resolve })
    return async () => {
      faux.porteExtraction = null
      await act(async () => { ouvrir() })
    }
  }
  function boutonDExtraction() {
    monter()
    return screen.getByRole('button', { name: '✨ Extraire automatiquement' }) as HTMLButtonElement
  }

  it('ne lit le fichier qu’une fois quand le bouton part deux fois dans le même rendu', async () => {
    const bouton = boutonDExtraction()
    const liberer = retenirLExtraction()

    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.extractions).toBe(1)
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Extraction…')
    await liberer()
  })

  it('trois clics dans le même rendu ne le lisent qu’une fois', async () => {
    const bouton = boutonDExtraction()
    const liberer = retenirLExtraction()

    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.extractions).toBe(1)
    await liberer()
  })

  it('relâche le verrou sur un échec de la lecture, et le dit', async () => {
    faux.erreurExtraction = new Error('Le service de lecture ne répond pas.')
    const bouton = boutonDExtraction()

    await act(async () => { bouton.click() })
    expect(screen.getByText('Le service de lecture ne répond pas.')).toBeTruthy()
    await act(async () => { bouton.click() })

    expect(faux.extractions).toBe(2)
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
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
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

    expect(message).toContain(AVERTISSEMENT_PAIEMENT_DEFAIT)
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

// UNE FACTURE REÇUE DE LA PLATEFORME DU CLIENT (ligne 28.5) : son original XML ne se lit pas, sa version lisible si ;
// son fichier est l'original transmis, et ses champs viennent de la facture électronique elle-même. Ce que la fiche
// en montre, ce qu'elle n'offre pas, et ce qu'une suppression emporte.
function factureRecue(o: Partial<Piece> = {}): Piece {
  return pieceDeTest({
    source: 'plateforme', storage_path: 'd1/1-fa-42.xml', nom_fichier: 'FA-42.xml', lisible_path: 'd1/1-fa-42-lisible.pdf',
    flux_hote: 'pa.exemple.fr', flux_id: 'flux-1', statut: 'a_valider', ...o,
  })
}

function monterAvec(piece: Piece) {
  faux.cheminsSignes = []
  faux.retraits = []
  faux.suppressions = []
  render(
    <FichePiece
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
}

describe('FichePiece — une facture reçue de la plateforme du client', () => {
  beforeEach(() => { faux.urlSignee = false })

  it('se montre par sa version lisible, et l’original transmis reste à portée d’un lien', async () => {
    faux.urlSignee = true
    monterAvec(factureRecue())
    expect(await screen.findByTitle('Aperçu de la pièce')).toBeTruthy()
    expect(faux.cheminsSignes).toEqual(['d1/1-fa-42-lisible.pdf'])
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('https://stockage.exemple/d1/1-fa-42-lisible.pdf')

    const ouvrir = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as unknown as Window)
    await act(async () => { screen.getByText('Voir l’original transmis (XML) ↗').click() })
    expect(faux.cheminsSignes).toEqual(['d1/1-fa-42-lisible.pdf', 'd1/1-fa-42.xml'])
    expect(ouvrir).toHaveBeenCalledWith('https://stockage.exemple/d1/1-fa-42.xml', '_blank')
  })

  it('n’offre ni fichier à remplacer ni lecture automatique, et dit pourquoi', async () => {
    monterAvec(factureRecue())
    expect(screen.getByText(/Facture reçue de la plateforme du client \(pa\.exemple\.fr\) : FA-42\.xml\./)).toBeTruthy()
    expect(screen.getByText(/il ne se remplace pas ; et ses champs viennent de la facture électronique elle-même/)).toBeTruthy()
    expect(document.querySelector('#file')).toBeNull()
    expect(screen.queryByText('✨ Extraire automatiquement')).toBeNull()
  })

  it('supprimée, elle emporte ses deux fichiers', async () => {
    monterAvec(factureRecue())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { screen.getByRole('button', { name: /Supprimer/ }).click() })
    expect(faux.suppressions).toEqual(['piece-1'])
    expect(faux.retraits).toEqual([['d1/1-fa-42.xml', 'd1/1-fa-42-lisible.pdf']])
  })

  // GARDE SYMÉTRIQUE : une pièce déposée garde son fichier à remplacer, sa lecture automatique et son aperçu.
  it('une pièce déposée garde son fichier, sa lecture automatique et son seul fichier', async () => {
    faux.urlSignee = true
    monterAvec(pieceDeTest())
    expect(await screen.findByTitle('Aperçu de la pièce')).toBeTruthy()
    expect(faux.cheminsSignes).toEqual(['d1/facture.pdf'])
    expect(document.querySelector('#file')).not.toBeNull()
    expect(screen.getByText('✨ Extraire automatiquement')).toBeTruthy()
    expect(screen.queryByText(/Voir l’original transmis/)).toBeNull()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { screen.getByRole('button', { name: /Supprimer/ }).click() })
    expect(faux.retraits).toEqual([['d1/facture.pdf']])
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

// UNE PIÈCE QU'UN EXERCICE VALIDÉ A FIGÉE (lib/validationExercice.ts, `piecesFigees`). La base refuse d'en changer la
// date, le tiers, le type, la catégorie, les montants ou le fichier, et de la supprimer (`garder_piece_validee`) ; ses
// notes et son sous-dossier restent libres. La fiche le dit, grise le reste, n'offre ni la suppression ni le brouillon,
// et n'envoie QUE ces deux champs — renvoyer tous les champs tels quels prendrait le risque d'un refus pour rien.
describe('FichePiece — une pièce figée par un exercice validé', () => {
  const SOUS_DOSSIERS = [{ id: 'sd-1', dossier_id: 'd1', nom: 'Véhicule', ordre: 1, created_at: '2026-01-01T09:00:00Z' }]
  function monterFigee(figeePar: string | null = "L'exercice 2025 est validé", o: Partial<Piece> = {}) {
    faux.updates = []
    faux.suppressions = []
    const fermee = vi.fn()
    const enregistree = vi.fn()
    render(
      <FichePiece
        dossierId="d1"
        categories={CATEGORIES}
        sousDossiers={SOUS_DOSSIERS}
        tiersCategories={[]}
        tiersCategoriesCabinet={[]}
        tiersConnus={[]}
        piece={pieceDeTest({ categorie_id: null, ...o })}
        commentaires={[]}
        onClose={fermee}
        onSaved={enregistree}
        onCommentaireAjoute={() => {}}
        onCommentaireSupprime={() => {}}
        figeePar={figeePar}
      />,
    )
    return { fermee, enregistree }
  }
  const champ = (id: string) => document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)!

  it('le dit, grise ce que la base refuserait, et laisse libres les notes et le sous-dossier', async () => {
    monterFigee()
    // La note se lit à part (sa table, que la validation ne fige pas) : le champ s'ouvre une fois lue.
    await act(async () => {})
    expect(screen.getByText(/L'exercice 2025 est validé : cette pièce justifie une écriture validée\. Sa date, son tiers, son type, sa catégorie, ses montants et son fichier ne changent plus/)).toBeTruthy()
    for (const id of ['file', 'date', 'type', 'tiers', 'categorie', 'ht', 'tva', 'ttc']) expect(champ(id).disabled, id).toBe(true)
    for (const id of ['notes', 'sousDossier']) expect(champ(id).disabled, id).toBe(false)
    expect(screen.queryByRole('button', { name: /Supprimer/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer brouillon' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
    expect((screen.getByRole('button', { name: /Extraire automatiquement/ }) as HTMLButtonElement).disabled).toBe(true)
    // Ni la proposition d'une catégorie : elle ne pourrait pas se poser.
    expect(boutonProposer()).toBeNull()
  })

  it('« Enregistrer » n’envoie que la note interne et le sous-dossier, puis ferme la fiche', async () => {
    const { fermee, enregistree } = monterFigee()
    await act(async () => {})
    fireEvent.change(champ('notes'), { target: { value: 'Repas avec un confrère' } })
    fireEvent.change(champ('sousDossier'), { target: { value: 'sd-1' } })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    // La note dans sa table, que le client ne lit pas ; la pièce ne porte plus que son sous-dossier.
    expect(faux.notesEcrites).toEqual([{
      ligne: { dossier_id: 'd1', piece_id: 'piece-1', texte: 'Repas avec un confrère' }, options: { onConflict: 'piece_id' },
    }])
    expect(faux.updates).toEqual([{ sous_dossier_id: 'sd-1' }])
    expect(faux.ordre).toEqual(['notes_internes.upsert', 'pieces.update'])
    expect(enregistree).toHaveBeenCalledTimes(1)
    expect(fermee).toHaveBeenCalledTimes(1)
  })

  it('trois envois rapprochés n’enregistrent qu’une fois', async () => {
    monterFigee()
    await act(async () => {})
    fireEvent.change(champ('notes'), { target: { value: 'Repas' } })
    const bouton = screen.getByRole('button', { name: 'Enregistrer' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.updates).toHaveLength(1)
    expect(faux.notesEcrites).toHaveLength(1)
  })

  it('une pièce en devise figée ne se reconvertit plus — non figée, si', () => {
    const enDevise: Partial<Piece> = { devise: 'USD', montant_devise: 120, montant_ttc: 100, taux_change: 1.2, conversion_source: 'bce' }
    monterFigee(undefined, enDevise)
    expect((screen.getByRole('button', { name: /Convertir au taux du/ }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    monterFigee(null, enDevise)
    expect((screen.getByRole('button', { name: /Convertir au taux du/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  // Le garde symétrique : la même pièce, que rien ne fige, garde tous ses gestes.
  it('non figée, la même pièce se modifie, se valide et se supprime', () => {
    monterFigee(null)
    expect(screen.queryByText(/cette pièce justifie une écriture validée/)).toBeNull()
    for (const id of ['date', 'type', 'tiers', 'categorie', 'ttc']) expect(champ(id).disabled, id).toBe(false)
    expect(screen.getByRole('button', { name: /Supprimer/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Valider' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer brouillon' })).toBeTruthy()
  })
})

// LA NOTE INTERNE, HORS DE PORTÉE DU CLIENT (espace client, étape P0, 09/10/2026). Elle ne vit plus sur la pièce, que le
// client du dossier lit, mais dans `notes_internes`, que le cabinet seul lit : la fiche la lit à part, ne l'offre qu'une
// fois LUE (un champ vide faute d'avoir lu l'effacerait au premier enregistrement), l'écrit AVANT la pièce et seulement
// si elle a changé, et ne pose plus jamais la colonne de la pièce.
describe('FichePiece — la note interne, hors de portée du client', () => {
  function monterNote(o: { piece?: Partial<Piece> | null } = {}) {
    faux.updates = []
    faux.inserts = []
    const modifiee = vi.fn()
    const fermee = vi.fn()
    const enregistree = vi.fn()
    render(
      <FichePiece
        dossierId="d1"
        categories={CATEGORIES}
        sousDossiers={[]}
        tiersCategories={[]}
        tiersCategoriesCabinet={[]}
        tiersConnus={[]}
        piece={o.piece === null ? null : pieceDeTest({ statut: 'a_valider', ...o.piece })}
        commentaires={[]}
        onClose={fermee}
        onSaved={enregistree}
        onCommentaireAjoute={() => {}}
        onCommentaireSupprime={() => {}}
        onModifiee={modifiee}
      />,
    )
    return { modifiee, fermee, enregistree }
  }
  const champNote = () => document.querySelector<HTMLTextAreaElement>('#notes')
  const enregistrer = () => screen.getByRole('button', { name: 'Enregistrer brouillon' })

  it('lit la note de CETTE pièce dans sa table, et l’offre une fois lue', async () => {
    faux.noteLue = null
    monterNote()
    expect(faux.lecturesNote).toEqual([['texte', 'piece_id', 'piece-1']])
    // Pas encore lue : le champ n'est pas offert, et le dit.
    expect(champNote()!.disabled).toBe(true)
    expect(champNote()!.placeholder).toBe('Lecture de la note…')
    await act(async () => { faux.resoudreNote!({ data: { texte: 'Vu avec le client le 3 mars.' }, error: null }) })
    expect(champNote()!.disabled).toBe(false)
    expect(champNote()!.value).toBe('Vu avec le client le 3 mars.')
    expect(screen.getByText(/Pour le cabinet seul : le client ne la lit pas\./)).toBeTruthy()
  })

  it('n’affiche plus l’ancienne colonne de la pièce, même remplie', async () => {
    monterNote({ piece: { notes: 'ANCIENNE NOTE RESTÉE SUR LA PIÈCE' } })
    await act(async () => {})
    expect(champNote()!.value).toBe('')
    expect(screen.queryByDisplayValue('ANCIENNE NOTE RESTÉE SUR LA PIÈCE')).toBeNull()
  })

  it('pas encore lue, l’enregistrement de la pièce n’y touche pas', async () => {
    faux.noteLue = null
    const { fermee } = monterNote()
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toEqual([])
    expect(faux.updates).toHaveLength(1)
    expect(faux.updates[0]).not.toHaveProperty('notes')
    expect(fermee).toHaveBeenCalledTimes(1)
  })

  it('illisible, elle dit pourquoi, ne s’offre pas, se relit sur un clic, et l’enregistrement n’y touche pas', async () => {
    faux.noteLue = { data: null, error: { message: 'permission denied for table notes_internes', code: '42501' } }
    monterNote()
    await act(async () => {})
    expect(champNote()).toBeNull()
    expect(screen.getByText(/La note interne n’a pas pu être lue \(permission denied for table notes_internes\)/)).toBeTruthy()
    faux.noteLue = { data: { texte: 'Relue.' }, error: null }
    await act(async () => { screen.getByRole('button', { name: 'Relire la note' }).click() })
    expect(faux.lecturesNote).toHaveLength(2)
    expect(champNote()!.value).toBe('Relue.')
  })

  it('illisible, l’enregistrement de la pièce part sans elle', async () => {
    faux.noteLue = { data: null, error: { message: 'permission denied for table notes_internes', code: '42501' } }
    const { fermee } = monterNote()
    await act(async () => {})
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toEqual([])
    expect(faux.updates).toHaveLength(1)
    expect(faux.updates[0]).not.toHaveProperty('notes')
    expect(fermee).toHaveBeenCalledTimes(1)
  })

  it('modifiée, elle part AVANT la pièce, dans sa table, et la pièce ne porte plus la colonne', async () => {
    faux.noteLue = { data: { texte: 'Avant.' }, error: null }
    const { modifiee } = monterNote()
    await act(async () => {})
    expect(modifiee).toHaveBeenLastCalledWith(false)
    fireEvent.change(champNote()!, { target: { value: 'Après.' } })
    // La garde de sortie la compte comme une saisie à ne pas perdre.
    expect(modifiee).toHaveBeenLastCalledWith(true)
    await act(async () => { enregistrer().click() })
    expect(faux.ordre).toEqual(['notes_internes.upsert', 'pieces.update'])
    expect(faux.notesEcrites).toEqual([{ ligne: { dossier_id: 'd1', piece_id: 'piece-1', texte: 'Après.' }, options: { onConflict: 'piece_id' } }])
    expect(faux.updates[0]).not.toHaveProperty('notes')
  })

  it('inchangée, elle ne s’écrit pas ; effacée, elle s’écrit vide — jamais retirée', async () => {
    faux.noteLue = { data: { texte: 'À effacer.' }, error: null }
    monterNote()
    await act(async () => {})
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toEqual([])
    cleanup()

    monterNote()
    await act(async () => {})
    fireEvent.change(champNote()!, { target: { value: '' } })
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toEqual([{ ligne: { dossier_id: 'd1', piece_id: 'piece-1', texte: '' }, options: { onConflict: 'piece_id' } }])
  })

  it('refusée, elle dit la raison, la pièce n’est pas écrite, la fiche reste ouverte et le verrou se relâche', async () => {
    faux.noteLue = { data: { texte: '' }, error: null }
    faux.reponseNoteEcrite = { error: { message: 'new row violates row-level security policy for table "notes_internes"', code: '42501' } }
    const { fermee, enregistree } = monterNote()
    await act(async () => {})
    fireEvent.change(champNote()!, { target: { value: 'Une note.' } })
    await act(async () => { enregistrer().click() })
    expect(screen.getByText(/new row violates row-level security policy for table "notes_internes"/)).toBeTruthy()
    expect(faux.updates).toEqual([])
    expect(fermee).not.toHaveBeenCalled()
    expect(enregistree).not.toHaveBeenCalled()
    // La saisie reste, et un nouvel essai repart.
    expect(champNote()!.value).toBe('Une note.')
    faux.reponseNoteEcrite = { error: null }
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toHaveLength(2)
    expect(faux.updates).toHaveLength(1)
  })

  it('une pièce en cours de création n’a pas encore de note : rien n’est lu ni offert', async () => {
    monterNote({ piece: null })
    await act(async () => {})
    expect(faux.lecturesNote).toEqual([])
    expect(champNote()).toBeNull()
  })

  // La fiche est clée par pièce dans PiecesTab ; le composant, lui, ne le suppose pas : passée d'une pièce à l'autre
  // sans se remonter, la réponse tardive de la pièce quittée ne déplace rien — ni la lecture, ni le texte du champ.
  it('une réponse pour une pièce déjà quittée ne déplace rien, quel que soit l’ordre des réponses', async () => {
    const props = {
      dossierId: 'd1', categories: CATEGORIES, sousDossiers: [], tiersCategories: [], tiersCategoriesCabinet: [], tiersConnus: [],
      commentaires: [], onClose: () => {}, onSaved: () => {}, onCommentaireAjoute: () => {}, onCommentaireSupprime: () => {},
    }
    faux.noteLue = null
    const { rerender } = render(<FichePiece {...props} piece={pieceDeTest({ id: 'piece-A', statut: 'a_valider' })} />)
    rerender(<FichePiece {...props} piece={pieceDeTest({ id: 'piece-B', statut: 'a_valider' })} />)
    expect(faux.lecturesNote).toEqual([['texte', 'piece_id', 'piece-A'], ['texte', 'piece_id', 'piece-B']])
    const [repondreA, repondreB] = faux.lecturesEnAttente
    // B répond d'abord, puis A, en retard.
    await act(async () => { repondreB({ data: { texte: 'Note de B' }, error: null }) })
    await act(async () => { repondreA({ data: { texte: 'Note de A' }, error: null }) })
    expect(champNote()!.value).toBe('Note de B')
    expect(champNote()!.disabled).toBe(false)
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toEqual([])

    cleanup()
    faux.lecturesEnAttente = []
    const second = render(<FichePiece {...props} piece={pieceDeTest({ id: 'piece-A', statut: 'a_valider' })} />)
    second.rerender(<FichePiece {...props} piece={pieceDeTest({ id: 'piece-B', statut: 'a_valider' })} />)
    const [tardiveA, lectureB] = faux.lecturesEnAttente
    // A répond pendant que B se lit encore : rien ne s'offre, et la note de A ne s'affiche pas sous B.
    await act(async () => { tardiveA({ data: { texte: 'Note de A' }, error: null }) })
    expect(champNote()!.disabled).toBe(true)
    expect(champNote()!.value).toBe('')
    await act(async () => { lectureB({ data: { texte: 'Note de B' }, error: null }) })
    expect(champNote()!.value).toBe('Note de B')

    cleanup()
    faux.lecturesEnAttente = []
    // A est lue, puis la fiche passe à B : tant que B se lit, la note de A ne s'offre pas — ni ne s'écrirait sur B.
    const troisieme = render(<FichePiece {...props} piece={pieceDeTest({ id: 'piece-A', statut: 'a_valider' })} />)
    await act(async () => { faux.lecturesEnAttente[0]({ data: { texte: 'Note de A' }, error: null }) })
    expect(champNote()!.value).toBe('Note de A')
    troisieme.rerender(<FichePiece {...props} piece={pieceDeTest({ id: 'piece-B', statut: 'a_valider' })} />)
    expect(champNote()!.disabled).toBe(true)
    expect(champNote()!.value).toBe('')
    await act(async () => { enregistrer().click() })
    expect(faux.notesEcrites).toEqual([])
    await act(async () => { faux.lecturesEnAttente[1]({ data: { texte: 'Note de B' }, error: null }) })
    expect(champNote()!.value).toBe('Note de B')
  })
})
