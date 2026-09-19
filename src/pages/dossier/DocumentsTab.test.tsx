import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DocumentsTab from './DocumentsTab'

// « C'est une facture » recrée une pièce à partir d'un document déjà en stockage, puis supprime le
// document. Trois façons de s'y tromper en silence, et le verrou est la pire : la détection de
// doublon du projet porte sur l'empreinte d'un fichier DÉPOSÉ — or ici rien n'est envoyé, la pièce
// reprend le chemin de stockage du document. Deux clics rapprochés créent donc deux pièces sur le
// même fichier, que rien ne rattrape au dépôt.
const faux = vi.hoisted(() => ({
  documents: [] as Record<string, unknown>[],
  // Programmé par test : ce que rendent la lecture du texte et la suppression du document.
  lectureTexte: { data: null as unknown, error: null as { message: string } | null },
  // La liste « qui a déjà un texte », lue en une fois au chargement.
  presence: { data: [] as unknown[], error: null as { message: string } | null },
  suppression: { error: null as { message: string } | null },
  inserts: [] as Record<string, unknown>[],
  suppressions: 0,
  // Laissée en attente : la fenêtre réelle pendant laquelle le second clic arrive.
  resoudreInsert: null as null | (() => void),
}))

vi.mock('../../lib/supabase', () => {
  function chaine(table: string) {
    let operation = 'select'
    const c: Record<string, unknown> = {}
    // `piece_textes_ocr` est interrogée de DEUX façons : en liste (quels documents ont un texte) et
    // à l'unité (le texte de celui-ci). Rendre la même chose aux deux ferait planter la première sur
    // un objet là où elle attend un tableau — le faux client doit distinguer le mode d'appel.
    function reponse(mode: 'liste' | 'unique'): unknown {
      if (table === 'documents_divers' && operation === 'delete') {
        faux.suppressions++
        return Promise.resolve({ data: null, error: faux.suppression.error })
      }
      if (table === 'documents_divers') return Promise.resolve({ data: faux.documents, error: null })
      if (table === 'piece_textes_ocr') {
        return mode === 'unique'
          ? Promise.resolve({ data: faux.lectureTexte.data, error: faux.lectureTexte.error })
          : Promise.resolve({ data: faux.presence.data, error: faux.presence.error })
      }
      if (table === 'pieces' && operation === 'insert') {
        return new Promise((resoudre) => {
          faux.resoudreInsert = () => resoudre({ data: { id: 'piece-creee' }, error: null })
        })
      }
      return Promise.resolve({ data: [], error: null })
    }
    Object.assign(c, {
      select: () => c, eq: () => c, order: () => c, or: () => c, in: () => c,
      insert: (valeur: Record<string, unknown>) => { operation = 'insert'; faux.inserts.push(valeur); return c },
      delete: () => { operation = 'delete'; return c },
      update: () => { operation = 'update'; return c },
      upsert: () => { operation = 'upsert'; return c },
      single: () => reponse('unique'),
      maybeSingle: () => reponse('unique'),
      then: (suite: (r: unknown) => unknown) => Promise.resolve(reponse('liste')).then(suite),
    })
    return c
  }
  return {
    supabase: {
      from: (table: string) => chaine(table),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } } }) },
    },
  }
})

function documentDeTest() {
  return {
    id: 'document-a-convertir', dossier_id: 'dossier-de-test', storage_path: 'dossier/facture.pdf',
    nom_fichier: 'facture.pdf', categorie: 'autre', sous_dossier_id: null,
    attached_to_cotisation_id: null, created_at: '2025-03-10T09:00:00Z',
  }
}

function reinitialiser() {
  faux.documents = [documentDeTest()]
  faux.lectureTexte = { data: { texte: 'FOUR MICRO-ONDES' }, error: null }
  faux.presence = { data: [], error: null }
  faux.suppression = { error: null }
  faux.inserts = []
  faux.suppressions = 0
  faux.resoudreInsert = null
}

describe('DocumentsTab — « C\'est une facture »', () => {
  it('ne crée qu\'une pièce quand le bouton est cliqué plusieurs fois de suite', async () => {
    reinitialiser()
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    // TROIS clics, et le troisième n'est pas du zèle : c'est lui qui distingue un verrou posé AVANT
    // le `try` d'un verrou posé dedans. Placé dedans, le refus du deuxième clic sort par son
    // `return`, donc par le `finally`, qui relâche le verrou du PREMIER — et le troisième passe.
    // Avec deux clics seulement, cette version fautive paraissait correcte (mutation survivante).
    await act(async () => {
      bouton.click()
      bouton.click()
      bouton.click()
    })

    expect(faux.inserts).toHaveLength(1)
    expect(faux.inserts[0]).toMatchObject({ storage_path: 'dossier/facture.pdf', statut: 'a_valider' })

    await act(async () => { faux.resoudreInsert?.() })
    expect(faux.suppressions).toBe(1)
  })

  it('renonce sans rien créer quand le texte lu ne peut pas être relu', async () => {
    reinitialiser()
    // « Pas de texte » et « lecture refusée » rendent tous deux null. Le second veut dire qu'un texte
    // existe peut-être : supprimer le document l'effacerait au moment même où le code prend soin de
    // ne pas le perdre.
    faux.lectureTexte = { data: null, error: { message: 'permission denied' } }
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    await act(async () => { bouton.click() })

    expect(faux.inserts).toHaveLength(0)
    expect(faux.suppressions).toBe(0)
    expect(screen.getByText(/conversion annulée pour ne pas le perdre/)).toBeDefined()
  })

  it('ne propose pas de relecture facturée quand la liste des textes déjà lus est illisible', async () => {
    reinitialiser()
    // Une liste vide et une liste illisible rendent le même ensemble vide, et veulent dire le
    // contraire l'une de l'autre. Sur la seconde, « Retrouver le texte lu » relancerait Textract —
    // facturé — sur des documents dont le texte est peut-être déjà archivé.
    faux.presence = { data: [], error: { message: 'permission denied for table piece_textes_ocr' } }
    render(<DocumentsTab dossierId="dossier-de-test" />)
    await screen.findByText(/relancer la lecture repaierait Textract/)

    expect(screen.queryByRole('button', { name: /Retrouver le texte lu/ })).toBeNull()
  })

  it('propose la relecture quand la liste, elle, a bien été lue', async () => {
    reinitialiser()
    render(<DocumentsTab dossierId="dossier-de-test" />)

    // Le même écran, à la seule différence de l'erreur de lecture : sans ce contre-exemple, le test
    // ci-dessus passerait aussi sur un bouton supprimé pour de bon.
    expect(await screen.findByRole('button', { name: /Retrouver le texte lu \(1\)/ })).toBeDefined()
  })

  it('dit que le document est resté ici quand sa suppression échoue', async () => {
    reinitialiser()
    faux.suppression = { error: { message: 'échec réseau' } }
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreInsert?.() })

    // La pièce existe, le document aussi : passé sous silence, le réflexe — recliquer — créerait une
    // pièce de plus à chaque fois.
    expect(faux.inserts).toHaveLength(1)
    expect(screen.getByText(/le même fichier existe en double/)).toBeDefined()
  })
})
