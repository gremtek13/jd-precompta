import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'

// « MES PIÈCES » : LE MÊME FICHIER DÉPOSÉ DEUX FOIS ENTRE DEUX LOTS (ligne 28.8). Le dépôt est le VRAI (lib/depot.ts) : seul
// lui réserve l'empreinte d'un fichier avant toute attente, et la libère à la fin. Ce que ce fichier garde est le câblage
// de l'écran — un registre d'empreintes en vol partagé par TOUS ses lots (`useRef`), là où un registre neuf par lot laissait
// deux lots lancés coup sur coup passer tous deux le contrôle anti-doublon avant que l'un ait écrit sa ligne.
//
// Le faux monde ressemble à la base sur ce qui compte ici : un envoi écrit sa ligne (donc la base connaît ensuite
// l'empreinte), la vérification des doublons est asynchrone (c'est elle qui laisse deux dépôts se croiser), et un envoi
// peut échouer.
const monde = vi.hoisted(() => ({
  presents: new Set<string>(),
  insertions: [] as string[],
  uploads: 0,
  insertErreur: null as Error | null,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        // Les lectures de l'écran : des listes vides, lues en entier.
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: () => chaine,
        maybeSingle: () => Promise.resolve(table === 'dossiers'
          ? { data: { code_email: null }, error: null }
          : { data: null, error: { message: `lecture inattendue : ${table}` } }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
        // Les écritures du dépôt : l'insertion rend la ligne créée, ou refuse.
        insert: (ligne: { storage_hash: string }) => ({
          select: () => ({
            single: () => {
              if (monde.insertErreur) return Promise.resolve({ data: null, error: monde.insertErreur })
              monde.insertions.push(ligne.storage_hash)
              monde.presents.add(ligne.storage_hash)
              return Promise.resolve({ data: { id: `id-${monde.insertions.length}` }, error: null })
            },
          }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      })
      return chaine
    },
    rpc: async (nom: string) => {
      if (nom === 'pieces_jointes_ecartees_du_client') return { data: [], error: null }
      if (nom === 'couverture_du_releve') return { data: [], error: null }
      return { data: null, error: { message: `fonction inattendue : ${nom}` } }
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: () => ({
        upload: () => { monde.uploads += 1; return Promise.resolve({ error: null }) },
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  },
}))

vi.mock('../lib/extraction', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../lib/extraction')>()
  return {
    ...reel,
    // Le contenu porte l'empreinte : deux noms, un même document.
    hashFichier: async (f: Blob) => `hash-de-${await f.text()}`,
    // Asynchrone comme la vraie (elle interroge la base) : c'est cet `await` qui laisse deux dépôts se croiser.
    fichierDejaPresent: async (_dossierId: string, hash: string) => {
      await Promise.resolve()
      return monde.presents.has(hash)
    },
    extractPiece: async () => ({ classification: 'facture', date_piece: '2026-03-10', tiers: 'EDF', montant_ttc: 120, confiance: 'haute' }),
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test' }),
}))

beforeEach(() => {
  monde.presents = new Set()
  monde.insertions = []
  monde.uploads = 0
  monde.insertErreur = null
})

async function monter() {
  const rendu = render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await waitFor(() => expect(screen.queryAllByText('Chargement…')).toHaveLength(0))
  return rendu
}

const pdf = (nom: string, contenu: string) => new File([contenu], nom, { type: 'application/pdf' })

// UN lot par appel, tous dans le MÊME `act` quand on en passe plusieurs : le second part avant que le premier ait rendu la
// main, comme deux gestes enchaînés du client.
function lots(conteneur: HTMLElement, ...lesLots: File[][]) {
  const champ = conteneur.querySelector('input[type="file"][multiple]') as HTMLInputElement
  return act(async () => {
    for (const fichiers of lesLots) fireEvent.change(champ, { target: { files: fichiers } })
  })
}

describe('ClientUpload — le même fichier d’un lot à l’autre', () => {
  it('ne dépose qu’une fois le même fichier de deux lots lancés dans le même instant', async () => {
    const { container } = await monter()

    await lots(container, [pdf('facture.pdf', 'EDF')], [pdf('facture (1).pdf', 'EDF')])

    await screen.findByText('facture (1).pdf : déjà déposé, pas réenvoyé.')
    expect(monde.insertions).toEqual(['hash-de-EDF'])
    expect(monde.uploads).toBe(1)
  })

  it('dépose chacun de deux fichiers différents de deux lots lancés dans le même instant', async () => {
    const { container } = await monter()

    await lots(container, [pdf('edf.pdf', 'EDF')], [pdf('orange.pdf', 'ORANGE')])

    await waitFor(() => expect(monde.insertions.sort()).toEqual(['hash-de-EDF', 'hash-de-ORANGE']))
    expect(container.querySelector('.error-text')).toBeNull()
  })

  it('libère l’empreinte d’un dépôt raté : le même fichier repart au lot suivant', async () => {
    const { container } = await monter()

    monde.insertErreur = new Error('permission denied')
    await lots(container, [pdf('facture.pdf', 'EDF')])
    await screen.findByText('facture.pdf : permission denied.')
    expect(monde.insertions).toEqual([])

    // Sans la libération, ce second essai se heurterait à une empreinte restée « en vol » : « déjà déposé » pour un
    // fichier qui n'est jamais arrivé.
    monde.insertErreur = null
    await lots(container, [pdf('facture.pdf', 'EDF')])
    await waitFor(() => expect(monde.insertions).toEqual(['hash-de-EDF']))
    expect(screen.queryAllByText(/déjà déposé/)).toHaveLength(0)
  })

  it('après un dépôt réussi, c’est la base qui dit « déjà déposé » : aucun nouvel envoi', async () => {
    const { container } = await monter()

    await lots(container, [pdf('facture.pdf', 'EDF')])
    await waitFor(() => expect(monde.insertions).toEqual(['hash-de-EDF']))

    await lots(container, [pdf('facture (2).pdf', 'EDF')])
    await screen.findByText('facture (2).pdf : déjà déposé, pas réenvoyé.')
    expect(monde.insertions).toEqual(['hash-de-EDF'])
    expect(monde.uploads).toBe(1)
  })
})
