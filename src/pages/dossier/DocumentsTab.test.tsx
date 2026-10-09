import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentsTab from './DocumentsTab'
import type { DocumentDivers } from '../../lib/types'

// « C'est une facture » recrée une pièce à partir d'un document déjà en stockage, puis supprime le
// document. Trois façons de s'y tromper en silence, et le verrou est la pire : la détection de
// doublon du projet porte sur l'empreinte d'un fichier DÉPOSÉ — or ici rien n'est envoyé, la pièce
// reprend le chemin de stockage du document. Deux clics rapprochés créent donc deux pièces sur le
// même fichier, que rien ne rattrape au dépôt.
const faux = vi.hoisted(() => ({
  documents: [] as DocumentDivers[],
  // Programmé par test : ce que rendent la lecture du texte et la suppression du document.
  lectureTexte: { data: null as unknown, error: null as { message: string } | null },
  // La liste « qui a déjà un texte », lue en une fois au chargement.
  presence: { data: [] as unknown[], error: null as { message: string } | null },
  suppression: { error: null as { message: string } | null },
  // Par document : la suppression que la base REFUSE (avec sa raison), et celle qu'elle accepte
  // sans rien supprimer — ce que rend PostgREST quand la policy écarte la ligne, ou quand un autre
  // onglet l'a déjà retirée : aucune erreur, zéro ligne.
  refus: {} as Record<string, string>,
  sansEffet: new Set<string>(),
  inserts: [] as Record<string, unknown>[],
  suppressions: 0,
  // Les retraits demandés au stockage, un tableau de chemins par appel.
  retraits: [] as string[][],
  // Plafond du serveur : le « Max rows » de PostgREST, qui ne se signale pas.
  plafond: null as number | null,
  // Laissée en attente : la fenêtre réelle pendant laquelle le second clic arrive.
  resoudreInsert: null as null | (() => void),
  // La base refuse le changement de catégorie, ou le rattachement du texte lu à la pièce créée.
  refusMaj: null as string | null,
  refusTexte: null as string | null,
  textesRattaches: 0,
}))

vi.mock('../../lib/supabase', async () => {
  // Chargé DANS la fabrique : `vi.mock` est remonté au-dessus des imports.
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    // Le faux client honore `range` et annonce un `count` : la lecture par tranches ne prouverait
    // rien contre un serveur qui rend tout d'un coup quoi qu'on lui demande.
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    // Les `.eq` APPLIQUÉS à `documents_divers` : une suppression qui ignorerait son filtre viderait
    // la table entière, et un faux client qui l'accepterait en silence ne le verrait pas.
    const predicats: ReturnType<typeof predicatEq>[] = []
    let valeurMaj: Partial<DocumentDivers> = {}
    const c: Record<string, unknown> = {}
    // `piece_textes_ocr` est interrogée de DEUX façons : en liste (quels documents ont un texte) et
    // à l'unité (le texte de celui-ci). Rendre la même chose aux deux ferait planter la première sur
    // un objet là où elle attend un tableau — le faux client doit distinguer le mode d'appel.
    function reponse(mode: 'liste' | 'unique'): unknown {
      if (table === 'documents_divers' && operation === 'delete') {
        faux.suppressions++
        if (faux.suppression.error) return Promise.resolve({ data: null, error: faux.suppression.error })
        const visees = filtrer(faux.documents, predicats)
        const refus = visees.map((d) => faux.refus[d.id]).find((motif) => motif !== undefined)
        if (refus) return Promise.resolve({ data: null, error: { message: refus } })
        const supprimees = visees.filter((d) => !faux.sansEffet.has(d.id))
        faux.documents = faux.documents.filter((d) => !supprimees.includes(d))
        return Promise.resolve({ data: mode === 'unique' ? (supprimees[0] ?? null) : supprimees, error: null })
      }
      if (table === 'documents_divers' && operation === 'update') {
        // Refusée, la mise à jour n'applique rien : la relecture montre la catégorie d'avant.
        if (faux.refusMaj) return Promise.resolve({ data: null, error: { message: faux.refusMaj } })
        faux.documents = faux.documents.map((d) => (filtrer([d], predicats).length > 0 ? { ...d, ...valeurMaj } : d))
        return Promise.resolve({ data: null, error: null })
      }
      if (table === 'piece_textes_ocr' && operation === 'upsert') {
        faux.textesRattaches++
        return Promise.resolve({ data: null, error: faux.refusTexte ? { message: faux.refusTexte } : null })
      }
      if (table === 'documents_divers') {
        const lignes = filtrer(faux.documents, predicats)
        const demande = fin - debut + 1
        const taille = faux.plafond == null ? demande : Math.min(demande, faux.plafond)
        return Promise.resolve({
          data: lignes.slice(debut, debut + taille),
          error: null,
          count: lignes.length,
        })
      }
      if (table === 'piece_textes_ocr') {
        if (mode === 'unique') {
          return Promise.resolve({ data: faux.lectureTexte.data, error: faux.lectureTexte.error })
        }
        // La liste « qui a déjà un texte » se lit par tranches et annonce son total : sans `count`,
        // la lecture se déclarerait incomplète — à juste titre (voir lib/lectureComplete.ts).
        return Promise.resolve({
          data: faux.presence.error ? null : faux.presence.data,
          error: faux.presence.error,
          count: faux.presence.error ? null : faux.presence.data.length,
        })
      }
      if (table === 'pieces' && operation === 'insert') {
        return new Promise((resoudre) => {
          faux.resoudreInsert = () => resoudre({ data: { id: 'piece-creee' }, error: null })
        })
      }
      return Promise.resolve({ data: [], error: null })
    }
    Object.assign(c, {
      select: () => c, order: () => c, or: () => c, in: () => c,
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
      insert: (valeur: Record<string, unknown>) => { operation = 'insert'; faux.inserts.push(valeur); return c },
      delete: () => { operation = 'delete'; return c },
      update: (valeur: Partial<DocumentDivers>) => { operation = 'update'; valeurMaj = valeur; return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
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
      storage: {
        from: () => ({
          remove: (chemins: string[]) => { faux.retraits.push(chemins); return Promise.resolve({ data: [], error: null }) },
        }),
      },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } } }) },
    },
  }
})

function documentDeTest(champs: Partial<DocumentDivers> = {}): DocumentDivers {
  return {
    id: 'document-a-convertir', dossier_id: 'dossier-de-test', storage_path: 'dossier/facture.pdf',
    storage_hash: null, nom_fichier: 'facture.pdf', categorie: 'autre', sous_dossier_id: null,
    attached_to_cotisation_id: null, notes: null, created_at: '2025-03-10T09:00:00Z',
    ...champs,
  }
}

function reinitialiser() {
  faux.plafond = null
  faux.documents = [documentDeTest()]
  faux.lectureTexte = { data: { texte: 'FOUR MICRO-ONDES' }, error: null }
  faux.presence = { data: [], error: null }
  faux.suppression = { error: null }
  faux.refus = {}
  faux.sansEffet = new Set()
  faux.inserts = []
  faux.suppressions = 0
  faux.retraits = []
  faux.resoudreInsert = null
  faux.refusMaj = null
  faux.refusTexte = null
  faux.textesRattaches = 0
}

afterEach(() => { vi.restoreAllMocks() })

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

  it('recolle les tranches quand le serveur plafonne la liste des documents', async () => {
    reinitialiser()
    faux.plafond = 1
    faux.documents = [
      { ...documentDeTest(), id: 'doc-1', nom_fichier: 'releve-janvier.pdf' },
      { ...documentDeTest(), id: 'doc-2', nom_fichier: 'releve-fevrier.pdf' },
    ]
    render(<DocumentsTab dossierId="dossier-de-test" />)

    // Lue d'un coup, la liste n'aurait que janvier — et rien ne l'aurait dit.
    expect(await screen.findByText('releve-janvier.pdf')).toBeDefined()
    expect(screen.getByText('releve-fevrier.pdf')).toBeDefined()
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

// « Supprimer la sélection » supprimait document par document et, sur un refus, passait au suivant
// SANS RIEN GARDER : ni le compte, ni la raison. La sélection était vidée, la liste relue, et le
// document refusé reparaissait au milieu des autres, sans un mot — sur un geste que l'opérateur
// venait de CONFIRMER, donc qu'il croit accompli. Ces cas sont rouges sur ce code-là.
describe('DocumentsTab — « Supprimer la sélection »', () => {
  function troisDocuments(): DocumentDivers[] {
    return [1, 2, 3].map((n) => documentDeTest({
      id: `doc-${n}`, nom_fichier: `releve-${n}.pdf`, storage_path: `dossier-de-test/releve-${n}.pdf`,
    }))
  }

  async function supprimerToutLaSelection(confirmation = true) {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(confirmation)
    render(<DocumentsTab dossierId="dossier-de-test" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }))
    const bouton = screen.getByRole('button', { name: /^Supprimer la sélection/ })
    await act(async () => { bouton.click() })
    return confirmer
  }

  it('dit combien de documents sont partis, combien sont restés et pourquoi, puis relit', async () => {
    reinitialiser()
    faux.documents = troisDocuments()
    faux.refus = { 'doc-2': 'permission denied for table documents_divers' }

    await supprimerToutLaSelection()

    expect(await screen.findByText(/2 documents supprimés sur 3/)).toBeDefined()
    expect(screen.getByText(/1 n’a pas pu l’être/)).toBeDefined()
    expect(screen.getByText(/permission denied for table documents_divers/)).toBeDefined()
    // Les fichiers des DEUX documents partis, et ceux-là seulement : celui du document resté est
    // toujours désigné par sa ligne.
    expect(faux.retraits).toEqual([['dossier-de-test/releve-1.pdf'], ['dossier-de-test/releve-3.pdf']])
    // Relue : le document refusé est toujours là, les deux autres n'y sont plus.
    expect(screen.getByText('releve-2.pdf')).toBeDefined()
    expect(screen.queryByText('releve-1.pdf')).toBeNull()
    expect(screen.queryByText('releve-3.pdf')).toBeNull()
  })

  it('ne retire pas le fichier d’un document que la base n’a pas supprimé, et le dit', async () => {
    reinitialiser()
    // Aucune erreur, zéro ligne : la policy a écarté la ligne, ou un autre onglet l'a déjà retirée.
    // Retirer le fichier ici laisserait une ligne bien visible qui désigne un fichier disparu.
    faux.sansEffet = new Set(['document-a-convertir'])

    await supprimerToutLaSelection()

    expect(await screen.findByText(/Le document n’a pas pu être supprimé/)).toBeDefined()
    expect(screen.getByText(/la base n’a supprimé aucune ligne/)).toBeDefined()
    expect(faux.retraits).toEqual([])
    expect(screen.getByText('facture.pdf')).toBeDefined()
  })

  it('ne prétend aucun succès quand aucun document n’est parti', async () => {
    reinitialiser()
    faux.documents = troisDocuments().slice(0, 2)
    faux.refus = { 'doc-1': 'JWT expired', 'doc-2': 'JWT expired' }

    await supprimerToutLaSelection()

    // La raison une fois, pas autant de fois qu'il y a de documents : un refus les frappe tous pareil.
    const message = await screen.findByText(/Aucun des 2 documents n’a pu être supprimé/)
    expect(message.textContent?.match(/JWT expired/g)).toHaveLength(1)
    expect(screen.queryByText(/supprimés? sur/)).toBeNull()
    expect(faux.retraits).toEqual([])
  })

  it('supprime tout et ne parle d’aucun échec quand la base a tout supprimé', async () => {
    reinitialiser()
    faux.documents = troisDocuments()

    await supprimerToutLaSelection()

    // Le garde SYMÉTRIQUE : sans lui, « dit ses échecs » serait satisfait par un écran qui crie à
    // l'échec à chaque suppression.
    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(screen.queryByText(/n’a pas pu|n’ont pas pu|Aucun des/)).toBeNull()
    expect(faux.retraits).toHaveLength(3)
  })

  it('ne supprime rien quand la confirmation est refusée', async () => {
    reinitialiser()
    faux.documents = troisDocuments()

    await supprimerToutLaSelection(false)

    expect(faux.suppressions).toBe(0)
    expect(faux.retraits).toEqual([])
  })

  it('nomme dans la confirmation ce qui part avec les documents', async () => {
    reinitialiser()
    faux.documents = troisDocuments()

    const confirmer = await supprimerToutLaSelection(false)

    const message = String(confirmer.mock.calls[0]?.[0])
    expect(message).toMatch(/^Supprimer définitivement 3 documents \?/)
    expect(message).toMatch(/Leur fichier, leur texte lu/)
    expect(message).toMatch(/texte lu/)
    expect(message).toMatch(/précisions/)
  })

  it('ne supprime chaque document qu’une fois quand le bouton est cliqué trois fois de suite', async () => {
    reinitialiser()
    faux.documents = troisDocuments().slice(0, 2)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DocumentsTab dossierId="dossier-de-test" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }))
    const bouton = screen.getByRole('button', { name: /^Supprimer la sélection/ })

    // TROIS clics dans le même `act` : le troisième est celui qui distingue un verrou posé avant le
    // `try` d'un verrou posé dedans (voir le premier test de ce fichier).
    await act(async () => {
      bouton.click()
      bouton.click()
      bouton.click()
    })

    expect(faux.suppressions).toBe(2)
    expect(faux.retraits).toHaveLength(2)
    // Et le bilan ne compte pas en double : les clics de trop n'ont rien supprimé, ni rien prétendu.
    expect(screen.queryByText(/n’a pas pu|n’ont pas pu|Aucun des/)).toBeNull()
  })
})

// « Supprimer » sur une ligne passe par la même suppression vérifiée que la sélection : la ligne
// d'abord, son fichier seulement si la base l'a bien supprimée.
describe('DocumentsTab — « Supprimer » un document', () => {
  it('ne retire pas le fichier quand la base n’a supprimé aucune ligne, et le dit', async () => {
    reinitialiser()
    faux.sansEffet = new Set(['document-a-convertir'])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: 'Supprimer' })

    await act(async () => { bouton.click() })

    expect(await screen.findByText(/Le document n’a pas pu être supprimé/)).toBeDefined()
    expect(faux.retraits).toEqual([])
  })

  it('retire la ligne puis son fichier quand la base l’a supprimée', async () => {
    reinitialiser()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: 'Supprimer' })

    await act(async () => { bouton.click() })

    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(faux.retraits).toEqual([['dossier/facture.pdf']])
    expect(screen.queryByText(/n’a pas pu/)).toBeNull()
  })
})

// UNE ÉCRITURE REFUSÉE SE DIT (09/10/2026, `ecrituresVerifiees.test.ts`). Le changement de catégorie jetait le résultat
// de sa mise à jour : la relecture remettait l'ancienne catégorie, sans un mot. Et « C'est une facture » supprimait le
// document sur la seule absence d'erreur — zéro ligne supprimée passait pour un succès —, et même quand le texte lu
// n'avait pas pu être rattaché à la pièce : la suppression l'emportait alors en cascade. Rouges sur le code d'avant.
describe('DocumentsTab — une écriture refusée se dit', () => {
  function listeDeCategorie() {
    return within(screen.getByText('facture.pdf').closest('tr')!).getByRole('combobox')
  }

  it('un changement de catégorie refusé le dit, et la liste garde la catégorie de la base', async () => {
    reinitialiser()
    faux.refusMaj = 'permission denied for table documents_divers'
    render(<DocumentsTab dossierId="dossier-de-test" />)
    await screen.findByText('facture.pdf')

    await act(async () => { fireEvent.change(listeDeCategorie(), { target: { value: 'attestation' } }) })

    expect(await screen.findByText(
      'La catégorie du document n’a pas pu être changée : permission denied for table documents_divers.',
    )).toBeDefined()
    expect((listeDeCategorie() as HTMLSelectElement).value).toBe('autre')
  })

  it('un changement de catégorie accepté ne dit rien', async () => {
    reinitialiser()
    render(<DocumentsTab dossierId="dossier-de-test" />)
    await screen.findByText('facture.pdf')

    await act(async () => { fireEvent.change(listeDeCategorie(), { target: { value: 'attestation' } }) })

    expect(faux.documents[0].categorie).toBe('attestation')
    expect(screen.queryByText(/n’a pas pu être changée/)).toBeNull()
  })

  it('« C’est une facture » dit quand la base n’a retiré aucune ligne du document', async () => {
    reinitialiser()
    faux.sansEffet = new Set(['document-a-convertir'])
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreInsert?.() })

    expect(faux.suppressions).toBe(1)
    expect(screen.getByText(/le document n'a pas été retiré d'ici/)).toBeDefined()
    expect(screen.getByText(/la base n’a supprimé aucune ligne/)).toBeDefined()
  })

  it('« C’est une facture » garde le document quand le texte lu n’a pas pu être rattaché à la pièce', async () => {
    reinitialiser()
    faux.refusTexte = 'new row violates row-level security policy'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreInsert?.() })

    // Supprimé, le document emporterait son texte en cascade : le seul exemplaire, puisque la pièce n'a pas le sien.
    expect(faux.textesRattaches).toBe(1)
    expect(faux.suppressions).toBe(0)
    expect(screen.getByText(/le texte lu n'a pas pu lui être rattaché \(new row violates row-level security policy\)/)).toBeDefined()
    expect(screen.getByText('facture.pdf')).toBeDefined()
  })

  it('« C’est une facture » réussi ne dit rien, et le document part', async () => {
    // Le garde SYMÉTRIQUE des deux cas ci-dessus.
    reinitialiser()
    render(<DocumentsTab dossierId="dossier-de-test" />)
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreInsert?.() })

    expect(faux.textesRattaches).toBe(1)
    expect(faux.suppressions).toBe(1)
    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(screen.queryByText(/Justificatifs, mais/)).toBeNull()
  })
})
