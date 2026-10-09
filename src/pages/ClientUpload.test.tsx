import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import type { DocumentDivers, Piece, PieceCommentaire } from '../lib/types'

// « MES PIÈCES », l'écran où le client dépose et vérifie ce qu'il a envoyé. Le dépôt lui-même vit
// dans `lib/depot.ts` et l'arithmétique d'exercice dans `lib/resteAEnvoyer.ts`, tous deux testés ; ce
// que ce test garde est le CÂBLAGE, qu'aucun test de `src/lib` ne peut voir :
//
//  1. le client voit ses envois, jamais un montant (accès volontairement restreint, CLAUDE.md) ;
//  2. « ce qu'il reste à envoyer » compte les DÉPÔTS de l'année — le critère propre aux écrans
//     client — et suit la clôture cochée par le cabinet ;
//  3. une lecture refusée n'affirme pas « aucun dépôt » : le client croirait ses envois perdus ;
//  4. les fichiers d'un même lot partagent UN registre d'empreintes, qui seul empêche deux copies
//     d'un même fichier, parties en parallèle, de passer toutes deux le contrôle anti-doublon ;
//  5. la zone de précision s'ouvre sur un dépôt unique, jamais au hasard dans un lot ;
//  6. tant que les lectures ne sont pas revenues, l'écran dit « Chargement… » : il ne réclame rien (les listes sont vides
//     faute d'avoir été lues, pas faute d'envois) et ne dit pas « aucun dépôt » ; la relecture qui suit un dépôt, elle,
//     laisse sous les yeux du client la liste déjà lue.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  refusees: new Set<string>(),
  // Tables dont la réponse attend que le test la libère (voir `retenir`) : c'est ainsi qu'on regarde l'écran PENDANT une
  // lecture, au lieu de parier sur la vitesse du faux client.
  retenues: new Map<string, Promise<void>>(),
  // Les tables demandées par l'écran, puis celles dont la réponse lui est parvenue, dans l'ordre : le test sait où en est
  // la lecture sans deviner combien de temps elle prend.
  demandees: [] as string[],
  livrees: [] as string[],
  deposer: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count: number | null }) => unknown) => {
          faux.demandees.push(table)
          // La réponse se compose au moment où elle PART, pas à celui de la demande : une lecture retenue rend l'état de
          // la base à sa libération, comme le ferait un serveur lent.
          const repondre = () => {
            if (faux.refusees.has(table)) {
              return { data: null, error: { message: 'permission denied' }, count: null }
            }
            const toutes = faux.parTable[table] ?? []
            return { data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }
          }
          const retenue = faux.retenues.get(table)
          return (retenue ? retenue.then(repondre) : Promise.resolve(repondre()))
            .then((reponse) => { faux.livrees.push(table); return suite(reponse) })
        },
      })
      return chaine
    },
  },
}))

vi.mock('../lib/depot', () => ({ deposerFichier: faux.deposer }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test' }),
}))

// Typés sans `as` : le compilateur confronte chaque champ à la table.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-09-01', tiers: 'FOURNISSEUR', montant_ht: null, montant_tva: null,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: '2026-09-10T09:00:00Z', updated_at: '2026-09-10T09:00:00Z', ...o,
  }
}

function documentDivers(o: Partial<DocumentDivers> = {}): DocumentDivers {
  return {
    id: 'd1', dossier_id: 'dossier-de-test', sous_dossier_id: null,
    storage_path: 'dossier-de-test/releve.pdf', storage_hash: null, nom_fichier: 'releve.pdf',
    categorie: 'releve_bancaire', attached_to_cotisation_id: null, notes: null,
    created_at: '2026-09-02T09:00:00Z', ...o,
  }
}

function commentaire(o: Partial<PieceCommentaire> = {}): PieceCommentaire {
  return {
    id: 'c1', dossier_id: 'dossier-de-test', piece_id: 'p1', document_id: null, auteur_id: 'u1',
    origine: 'client', texte: 'Four de la salle d’attente.', created_at: '2026-09-10T09:05:00Z', ...o,
  }
}

function poser(o: {
  pieces?: Piece[]
  documents?: DocumentDivers[]
  commentaires?: PieceCommentaire[]
  clotures?: { annee: number }[]
} = {}) {
  faux.parTable = {
    pieces: o.pieces ?? [],
    documents_divers: o.documents ?? [],
    lignes_bancaires: [],
    cotisations_declarees: [],
    piece_commentaires: o.commentaires ?? [],
    exercices_clotures: o.clotures ?? [],
  }
  faux.refusees = new Set()
  faux.retenues = new Map()
  faux.demandees = []
  faux.livrees = []
  faux.deposer.mockReset()
}

// Retient la réponse de ces tables jusqu'à ce que le test appelle la fonction rendue. Les lectures déjà parties attendent
// alors la libération, et la base qu'elles rendent est celle de CE moment-là.
function retenir(...tables: string[]): () => void {
  let ouvrir = () => {}
  const porte = new Promise<void>((resolve) => { ouvrir = resolve })
  for (const table of tables) faux.retenues.set(table, porte)
  return () => {
    for (const table of tables) faux.retenues.delete(table)
    ouvrir()
  }
}

// Un tour d'horloge DANS l'`act` : tout ce que l'écran avait à faire des réponses déjà livrées est rendu avant qu'on le regarde.
// Sans lui, une assertion d'absence passerait aussi sur un écran qui s'apprêtait à se tromper.
function laisserPasserUnTour() {
  return act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
}

// L'écran tel qu'il est au premier rendu : les titres sont là, les lectures n'ont pas encore répondu. Pour le regarder
// PENDANT qu'elles sont retenues (voir `retenir`).
async function monterSansAttendre() {
  const rendu = render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Mes dépôts' })
  return rendu
}

async function monter() {
  const rendu = await monterSansAttendre()
  // Tant que les lectures ne sont pas revenues l'écran dit « Chargement… » : on attend la fin de cette parole, et non la
  // vitesse du faux client. C'est elle qui décidait si un test lisait, juste après `monter()`, l'état lu ou un état encore
  // vide — et les tests qui lisent « ce qu'il reste à envoyer » ou les dépôts n'ont ainsi plus à l'attendre un à un.
  await waitFor(() => expect(screen.queryAllByText('Chargement…')).toHaveLength(0))
  return rendu
}

// Le détail d'un point de « ce qu'il reste à envoyer », lu sous son libellé.
function detailDe(libelle: string): string {
  return screen.getByText(libelle).nextElementSibling?.textContent ?? ''
}

function deposer(conteneur: HTMLElement, noms: string[]) {
  const champ = conteneur.querySelector('input[type="file"][multiple]') as HTMLInputElement
  const fichiers = noms.map((nom) => new File(['contenu'], nom, { type: 'image/jpeg' }))
  return act(async () => { fireEvent.change(champ, { target: { files: fichiers } }) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-25T10:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('ClientUpload — ce que le client voit de ses envois', () => {
  it('liste chaque envoi avec son statut, sans jamais un montant', async () => {
    poser({
      pieces: [piece({ nom_fichier: 'facture-edf.pdf', statut: 'validee', montant_ttc: 1234.56 })],
      documents: [documentDivers({ nom_fichier: 'releve-aout.pdf' })],
    })
    await monter()

    within(screen.getByText('facture-edf.pdf').closest('tr') as HTMLElement).getByText('Facture — traitée')
    within(screen.getByText('releve-aout.pdf').closest('tr') as HTMLElement).getByText('Relevé bancaire')
    expect(document.body.textContent).not.toMatch(/1\s?234,56/)
  })

  it('compte les DÉPÔTS de l’année, pas les pièces datées de l’année', async () => {
    // Une facture de 2024 envoyée en mars 2026 est un envoi de 2026 : c'est la question du client
    // (« ai-je envoyé quelque chose ? »), là où la Checklist du cabinet compte les pièces DATÉES.
    poser({
      pieces: [piece({ date_piece: '2024-12-20', created_at: '2026-03-10T09:00:00Z' })],
      documents: [documentDivers({ created_at: '2026-05-02T09:00:00Z' })],
    })
    await monter()

    expect(detailDe('Factures et documents 2026')).toBe('2 déposé(s)')
  })
})

describe('ClientUpload — au passage d’une année', () => {
  beforeEach(() => { vi.setSystemTime(new Date('2027-01-05T10:00:00Z')) })

  it('réclame encore l’exercice révolu tant que le cabinet ne l’a pas clôturé', async () => {
    poser()
    await monter()

    expect(detailDe('Relevés bancaires 2026')).toMatch(/^Mois manquants : janvier, février, mars/)
  })

  it('cesse de le réclamer une fois la clôture cochée', async () => {
    poser({ clotures: [{ annee: 2026 }] })
    await monter()

    // On attend l'état LU (2027 réclamé) avant de vérifier l'absence de 2026 : vérifiée plus tôt, elle échouait au moindre
    // retard de la lecture des clôtures, et sur un écran qui n'a encore rien lu elle serait vraie sans rien prouver.
    await screen.findByText('Relevés bancaires 2027')
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
  })
})

describe('ClientUpload — tant que les lectures ne sont pas revenues', () => {
  // Le 5 janvier, 2026 est un exercice révolu que le cabinet n'a pas (encore) clôturé : c'est lui qu'un écran qui n'a rien
  // lu réclame, avec les douze mois « manquants », puisque aucun relevé n'a été lu non plus.
  beforeEach(() => { vi.setSystemTime(new Date('2027-01-05T10:00:00Z')) })

  const TOUTES_LES_TABLES = [
    'pieces', 'documents_divers', 'lignes_bancaires', 'cotisations_declarees', 'piece_commentaires', 'exercices_clotures',
  ]

  it('ne réclame rien et ne dit pas « aucun dépôt » avant d’avoir lu quoi que ce soit', async () => {
    poser()
    const liberer = retenir(...TOUTES_LES_TABLES)
    await monterSansAttendre()

    // Les listes sont vides faute de lecture, pas faute d'envois : ni la demande d'un relevé, ni « aucun dépôt ».
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
    expect(screen.queryAllByText("Aucun dépôt pour l'instant.")).toHaveLength(0)
    // Les deux blocs le disent, au lieu de rester vides sans explication.
    expect(screen.getAllByText('Chargement…')).toHaveLength(2)

    await act(async () => { liberer() })

    // Garde symétrique : l'état lu paraît juste après. Sans elle, l'absence ci-dessus se satisferait d'un écran qui ne
    // montrerait jamais rien.
    await screen.findByText("Aucun dépôt pour l'instant.")
    expect(detailDe('Relevés bancaires 2026')).toMatch(/^Mois manquants : janvier, février, mars/)
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
  })

  it('attend aussi la dernière lecture : des clôtures en retard ne font pas réclamer un exercice déjà clos', async () => {
    // Le défaut tel que la CI l'a montré : tout est revenu SAUF les clôtures. L'écran réclamait 2026, que le cabinet a clos.
    poser({ clotures: [{ annee: 2026 }] })
    const liberer = retenir('exercices_clotures')
    await monterSansAttendre()

    await waitFor(() => expect(faux.livrees).toEqual(expect.arrayContaining([
      'pieces', 'documents_divers', 'lignes_bancaires', 'cotisations_declarees', 'piece_commentaires',
    ])))
    expect(faux.livrees).not.toContain('exercices_clotures')
    await laisserPasserUnTour()

    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
    expect(screen.queryAllByText("Aucun dépôt pour l'instant.")).toHaveLength(0)
    expect(screen.getAllByText('Chargement…')).toHaveLength(2)

    await act(async () => { liberer() })

    await screen.findByText('Relevés bancaires 2027')
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
    screen.getByText("Aucun dépôt pour l'instant.")
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
  })
})

describe('ClientUpload — une lecture qui échoue', () => {
  it('ne dit pas « aucun dépôt » quand les envois n’ont pas pu être lus', async () => {
    poser({ pieces: [piece()] })
    faux.refusees = new Set(['pieces'])
    await monter()

    screen.getByText(/Tes envois n'ont pas pu être affichés en entier/)
    screen.getByText("Tes envois n'ont pas pu être affichés — recharge la page.")
    expect(screen.queryAllByText("Aucun dépôt pour l'instant.")).toHaveLength(0)
  })

  it('le dit en revanche quand seuls les relevés manquent : la liste des dépôts, elle, est lue', async () => {
    // Le bandeau couvre les quatre collections de « ce qu'il reste à envoyer » ; l'état vide de la
    // liste ne dépend que des pièces et des documents. Fondre les deux ferait dire « tes envois n'ont
    // pas pu être affichés » à un client qui n'a simplement rien envoyé.
    poser()
    faux.refusees = new Set(['lignes_bancaires'])
    await monter()

    screen.getByText(/Tes envois n'ont pas pu être affichés en entier/)
    screen.getByText("Aucun dépôt pour l'instant.")
  })
})

describe('ClientUpload — déposer', () => {
  // Le dépôt réussi écrit sa pièce, comme la base : la relecture qui suit la voit.
  function depotReussi(id: string) {
    return async (_dossier: string, fichier: File) => {
      faux.parTable.pieces = [...faux.parTable.pieces, piece({ id, nom_fichier: fichier.name, created_at: '2026-09-25T10:00:00Z' })]
      return { statut: 'ok' as const, cible: { type: 'piece' as const, id } }
    }
  }

  it('ouvre la zone de précision du fichier qu’on vient d’envoyer seul', async () => {
    poser()
    faux.deposer.mockImplementation(depotReussi('nouvelle'))
    const { container } = await monter()

    await deposer(container, ['photo.jpg'])

    await screen.findByPlaceholderText(/four de la salle d’attente/)
    within(screen.getByText('photo.jpg').closest('tr') as HTMLElement).getByText('Facture — en attente de traitement')
  })

  it('n’ouvre aucune zone sur un lot, et ses fichiers partagent UN registre d’empreintes', async () => {
    poser()
    let rang = 0
    faux.deposer.mockImplementation((dossier: string, fichier: File) => depotReussi(`lot-${rang++}`)(dossier, fichier))
    const { container } = await monter()

    await deposer(container, ['a.jpg', 'b.jpg'])
    await screen.findByText('b.jpg')

    const appels = faux.deposer.mock.calls
    expect(appels).toHaveLength(2)
    // Le MÊME Set pour les deux branches parallèles : c'est lui qui voit la seconde copie d'un même
    // fichier avant que la première ait écrit sa ligne.
    expect(appels[0][2]).toBeInstanceOf(Set)
    expect(appels[1][2]).toBe(appels[0][2])
    expect(screen.queryAllByPlaceholderText(/four de la salle d’attente/)).toHaveLength(0)

    // Et un registre NEUF au lot suivant : au dépôt d'après, la base fait foi.
    await deposer(container, ['c.jpg'])
    expect(faux.deposer.mock.calls[2][2]).not.toBe(appels[0][2])
  })

  it('laisse sous les yeux du client la liste déjà lue pendant la relecture qui suit le dépôt', async () => {
    // L'état de chargement ne vaut que pour la PREMIÈRE lecture : `load()` repart après chaque dépôt, et un écran qui
    // retomberait alors sur « Chargement… » ferait disparaître la liste au moment même où le client vérifie son envoi.
    poser({ pieces: [piece({ id: 'ancienne', nom_fichier: 'facture-edf.pdf' })] })
    faux.deposer.mockImplementation(depotReussi('nouvelle'))
    const { container } = await monter()
    screen.getByText('facture-edf.pdf')

    const liberer = retenir('pieces')
    await deposer(container, ['photo.jpg'])
    // La relecture est partie (deux demandes de `pieces` en tout) et ne rendra rien avant que le test le décide.
    await waitFor(() => expect(faux.demandees.filter((table) => table === 'pieces')).toHaveLength(2))
    await laisserPasserUnTour()

    screen.getByText('facture-edf.pdf')
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)

    await act(async () => { liberer() })
    await screen.findByText('photo.jpg')
    screen.getByText('facture-edf.pdf')
  })

  it('dit un doublon en nommant le fichier', async () => {
    poser()
    faux.deposer.mockResolvedValue({ statut: 'doublon' })
    const { container } = await monter()

    await deposer(container, ['photo.jpg'])

    await screen.findByText('photo.jpg : déjà déposé, pas réenvoyé.')
  })
})

describe('ClientUpload — la recherche', () => {
  it('retrouve un dépôt par la précision qu’on y a laissée', async () => {
    // « salle d'attente » est souvent tout ce dont le client se souvient d'une photo, dont son
    // téléphone a choisi le nom tout seul.
    poser({
      pieces: [piece({ id: 'p1', nom_fichier: 'IMG_1234.jpg' }), piece({ id: 'p2', nom_fichier: 'IMG_5678.jpg' })],
      commentaires: [commentaire({ piece_id: 'p1' })],
    })
    await monter()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'salle attente' } })

    screen.getByText('IMG_1234.jpg')
    expect(screen.queryAllByText('IMG_5678.jpg')).toHaveLength(0)
    screen.getByText('1 sur 2')
  })
})
