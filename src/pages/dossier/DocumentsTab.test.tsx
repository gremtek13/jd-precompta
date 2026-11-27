import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentsTab from './DocumentsTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { DocumentDivers, SousDossier } from '../../lib/types'

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
  // LA RÉVISION DES SOLDES (ligne 41, étape R3) : ses décisions et leurs preuves, lues EN ENTIER ; `refusees` rend leur
  // lecture incomplète, comme un refus de la base.
  decisions: [] as Record<string, unknown>[],
  preuves: [] as Record<string, unknown>[],
  revisionRefusee: false,
  // LE DOSSIER PERMANENT (ligne 41, étape R7) : ses entrées, lues EN ENTIER ; `dossierPermanentRefuse` rend leur lecture
  // incomplète, sans toucher à celle de la révision d'un solde.
  entrees: [] as Record<string, unknown>[],
  dossierPermanentRefuse: false,
  // L'APERÇU DE LA FICHE D'UN DOCUMENT (16/11/2026) : les chemins dont une adresse signée est demandée, et, quand
  // `signaturesRetenues` est levé, la réponse de chacune laissée en attente — la fenêtre où l'on change de document.
  signatures: [] as string[],
  signaturesRetenues: false,
  signaturesEnAttente: new Map<string, () => void>(),
  // La suppression d'un document laissée en attente : la fenêtre où l'on ouvre un autre document.
  suppressionRetenue: false,
  relacherSuppression: null as null | (() => void),
  // LE SOUS-DOSSIER CHOISI DANS LA FICHE (DOCF-Q1) : les sous-dossiers, lus en entier sauf `sousDossiersRefuses` ; les
  // mises à jour envoyées ; `majSansEffet`, une mise à jour acceptée qui ne touche aucune ligne (la policy l'écarte).
  sousDossiers: [] as SousDossier[],
  sousDossiersRefuses: false,
  majs: [] as Partial<DocumentDivers>[],
  majSansEffet: false,
  // La relecture des documents laissée en attente : la fenêtre entre la réponse d'une écriture et sa relecture.
  relectureRetenue: false,
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
        const appliquer = () => {
          faux.documents = faux.documents.filter((d) => !supprimees.includes(d))
          return { data: mode === 'unique' ? (supprimees[0] ?? null) : supprimees, error: null }
        }
        if (faux.suppressionRetenue) return new Promise((resoudre) => { faux.relacherSuppression = () => resoudre(appliquer()) })
        return Promise.resolve(appliquer())
      }
      if (table === 'documents_divers' && operation === 'update') {
        faux.majs.push(valeurMaj)
        // Refusée, la mise à jour n'applique rien : la relecture montre la catégorie d'avant.
        if (faux.refusMaj) return Promise.resolve({ data: null, error: { message: faux.refusMaj } })
        if (faux.majSansEffet) return Promise.resolve({ data: mode === 'unique' ? null : [], error: null })
        const touchees = filtrer(faux.documents, predicats)
        faux.documents = faux.documents.map((d) => (touchees.includes(d) ? { ...d, ...valeurMaj } : d))
        return Promise.resolve({ data: mode === 'unique' ? (touchees[0] ?? null) : touchees, error: null })
      }
      if (table === 'sous_dossiers') {
        if (faux.sousDossiersRefuses) return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null })
        const lignes = filtrer(faux.sousDossiers, predicats)
        return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: lignes.length })
      }
      if (table === 'piece_textes_ocr' && operation === 'upsert') {
        faux.textesRattaches++
        return Promise.resolve({ data: null, error: faux.refusTexte ? { message: faux.refusTexte } : null })
      }
      if (table === 'revision_justifications' || table === 'revision_preuves') {
        if (faux.revisionRefusee) return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null })
        const lignes = filtrer(table === 'revision_justifications' ? faux.decisions : faux.preuves, predicats)
        return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: lignes.length })
      }
      // Les papiers signés des lettres de mission (ligne 47, LM5), lus depuis que leur migration est en production (12/11/2026) :
      // aucun ici, lus en entier — une lecture partielle retiendrait « C'est une facture » (le refus du papier signé lui-même :
      // lettresDeMissionVue.test.ts).
      if (table === 'lettres_de_mission') return Promise.resolve({ data: [], error: null, count: 0 })
      if (table === 'dossier_permanent') {
        if (faux.dossierPermanentRefuse) return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null })
        const lignes = filtrer(faux.entrees, predicats)
        return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: lignes.length })
      }
      if (table === 'documents_divers') {
        if (faux.relectureRetenue) return new Promise(() => {})
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
      select: () => c, order: () => c, or: () => c, in: () => c, not: () => c,
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
          createSignedUrl: (chemin: string) => {
            faux.signatures.push(chemin)
            const reponse = { data: { signedUrl: `https://signee.test/${chemin}` }, error: null }
            if (!faux.signaturesRetenues) return Promise.resolve(reponse)
            return new Promise((resoudre) => { faux.signaturesEnAttente.set(chemin, () => resoudre(reponse)) })
          },
        }),
      },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } } }) },
    },
  }
})

function documentDeTest(champs: Partial<DocumentDivers> = {}): DocumentDivers {
  return {
    id: 'document-a-convertir', dossier_id: 'dossier-de-test', storage_path: 'dossier-de-test/facture.pdf',
    storage_hash: null, nom_fichier: 'facture.pdf', categorie: 'autre', sous_dossier_id: null,
    attached_to_cotisation_id: null, created_at: '2025-03-10T09:00:00Z',
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
  faux.decisions = []
  faux.preuves = []
  faux.revisionRefusee = false
  faux.entrees = []
  faux.dossierPermanentRefuse = false
  faux.signatures = []
  faux.signaturesRetenues = false
  faux.signaturesEnAttente = new Map()
  faux.suppressionRetenue = false
  faux.relacherSuppression = null
  faux.sousDossiers = []
  faux.sousDossiersRefuses = false
  faux.majs = []
  faux.majSansEffet = false
  faux.relectureRetenue = false
}

// Dans la coque du panneau de droite, comme dans l'application : la fiche d'un document s'y ouvre, et `usePanneauDroit`
// lève hors d'elle.
function rendre() {
  return render(
    <FournisseurPanneauDroit>
      <DocumentsTab dossierId="dossier-de-test" />
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

afterEach(() => { vi.restoreAllMocks(); drapeau.documents = false })

// LES DOCUMENTS ET LES DEMANDES DU CABINET (ligne 51.5, étape B3a) : leurs deux sections ont leurs propres tests ; ici, qu'elles
// ne se montent qu'avec leur migration. Le drapeau, joué sous ses deux états par un accesseur.
const drapeau = vi.hoisted(() => ({ documents: false }))
vi.mock('../../lib/documentsEtDemandes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/documentsEtDemandes')>()
  return { ...original, get DOCUMENTS_ET_DEMANDES_PREVUS() { return drapeau.documents } }
})
vi.mock('./DocumentsMisADisposition', () => ({ default: ({ dossierId }: { dossierId: string }) => <p>Section des documents de {dossierId}</p> }))
vi.mock('./DemandesAuClient', () => ({ default: ({ dossierId }: { dossierId: string }) => <p>Section des demandes de {dossierId}</p> }))

describe('DocumentsTab — les documents et les demandes du cabinet (B3a)', () => {
  it('baissé, l’onglet d’hier ; levé, les deux sections, sur ce dossier', async () => {
    reinitialiser()
    const baisse = rendre()
    await screen.findByRole('button', { name: "C'est une facture" })
    expect(screen.queryByText(/Section des/)).toBeNull()
    baisse.unmount()
    drapeau.documents = true
    rendre()
    expect(await screen.findByText('Section des documents de dossier-de-test')).toBeTruthy()
    expect(screen.getByText('Section des demandes de dossier-de-test')).toBeTruthy()
  })
})

describe('DocumentsTab — « C\'est une facture »', () => {
  it('ne crée qu\'une pièce quand le bouton est cliqué plusieurs fois de suite', async () => {
    reinitialiser()
    rendre()
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
    expect(faux.inserts[0]).toMatchObject({ storage_path: 'dossier-de-test/facture.pdf', statut: 'a_valider' })

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
    rendre()

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
    rendre()
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
    rendre()
    await screen.findByText(/relancer la lecture repaierait Textract/)

    expect(screen.queryByRole('button', { name: /Retrouver le texte lu/ })).toBeNull()
  })

  it('propose la relecture quand la liste, elle, a bien été lue', async () => {
    reinitialiser()
    rendre()

    // Le même écran, à la seule différence de l'erreur de lecture : sans ce contre-exemple, le test
    // ci-dessus passerait aussi sur un bouton supprimé pour de bon.
    expect(await screen.findByRole('button', { name: /Retrouver le texte lu \(1\)/ })).toBeDefined()
  })

  it('dit que le document est resté ici quand sa suppression échoue', async () => {
    reinitialiser()
    faux.suppression = { error: { message: 'échec réseau' } }
    rendre()
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
// LA FACTURE PROBABLE (relecture du 04/11/2026, D4) : un document que la lecture a rangé ici, dont le texte lu se donne pour
// une facture, le dit à sa ligne, à côté du geste qui le reprend ; le relevé qui ne s'en donne pas l'air, non.
describe('DocumentsTab — « Facture probable »', () => {
  it('marque le document dont le texte lu se donne pour une facture, et offre « C’est une facture »', async () => {
    reinitialiser()
    faux.documents = [
      documentDeTest({ id: 'rc-pro', nom_fichier: 'rc-pro.pdf', categorie: 'attestation' }),
      documentDeTest({ id: 'releve', nom_fichier: 'releve.pdf', categorie: 'releve_bancaire' }),
    ]
    faux.presence = {
      data: [
        { document_id: 'rc-pro', texte: 'ASSURANCES FICTIVES SA\nFACTURE N° 2025-0412\nPrime annuelle TTC 412,50 €\nVotre attestation est jointe' },
        { document_id: 'releve', texte: 'BANQUE FICTIVE\nRELEVE DE COMPTE\nFACTURE CARTE DU 12/03 12,30' },
      ],
      error: null,
    }
    rendre()
    const marque = await screen.findByText('Facture probable')
    const ligne = marque.closest('tr') as HTMLElement
    within(ligne).getByText('rc-pro.pdf')
    within(ligne).getByRole('button', { name: "C'est une facture" })
    expect(marque.getAttribute('title')).toMatch(/n’entre pas dans la 2035/)
    expect(screen.getAllByText('Facture probable')).toHaveLength(1)
  })

  it('des textes illisibles ne marquent rien, et le disent sous la liste', async () => {
    reinitialiser()
    faux.presence = { data: [], error: { message: 'permission denied' } }
    rendre()
    await screen.findByText(/aucune n’est marquée « Facture probable »/)
    expect(screen.queryByText('Facture probable')).toBeNull()
  })
})

describe('DocumentsTab — « Supprimer la sélection »', () => {
  function troisDocuments(): DocumentDivers[] {
    return [1, 2, 3].map((n) => documentDeTest({
      id: `doc-${n}`, nom_fichier: `releve-${n}.pdf`, storage_path: `dossier-de-test/releve-${n}.pdf`,
    }))
  }

  async function supprimerToutLaSelection(confirmation = true) {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(confirmation)
    rendre()
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
    rendre()
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
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Supprimer' })

    await act(async () => { bouton.click() })

    expect(await screen.findByText(/Le document n’a pas pu être supprimé/)).toBeDefined()
    expect(faux.retraits).toEqual([])
  })

  it('retire la ligne puis son fichier quand la base l’a supprimée', async () => {
    reinitialiser()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Supprimer' })

    await act(async () => { bouton.click() })

    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(faux.retraits).toEqual([['dossier-de-test/facture.pdf']])
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
    rendre()
    await screen.findByText('facture.pdf')

    await act(async () => { fireEvent.change(listeDeCategorie(), { target: { value: 'attestation' } }) })

    expect(await screen.findByText(
      'La catégorie du document n’a pas pu être changée : permission denied for table documents_divers.',
    )).toBeDefined()
    expect((listeDeCategorie() as HTMLSelectElement).value).toBe('autre')
  })

  it('un changement de catégorie accepté ne dit rien', async () => {
    reinitialiser()
    rendre()
    await screen.findByText('facture.pdf')

    await act(async () => { fireEvent.change(listeDeCategorie(), { target: { value: 'attestation' } }) })

    expect(faux.documents[0].categorie).toBe('attestation')
    expect(screen.queryByText(/n’a pas pu être changée/)).toBeNull()
  })

  it('« C’est une facture » dit quand la base n’a retiré aucune ligne du document', async () => {
    reinitialiser()
    faux.sansEffet = new Set(['document-a-convertir'])
    rendre()
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
    rendre()
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
    rendre()
    const bouton = await screen.findByRole('button', { name: "C'est une facture" })

    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreInsert?.() })

    expect(faux.textesRattaches).toBe(1)
    expect(faux.suppressions).toBe(1)
    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(screen.queryByText(/Justificatifs, mais/)).toBeNull()
  })
})

// UN DOCUMENT CITÉ PAR LA RÉVISION DES SOLDES NE SE SUPPRIME PLUS (ligne 41, étape R3 ; `garder_source_citee`, hypothèse
// Q8) — ni ne se transforme en pièce, qui le supprime en dernier : la pièce naîtrait, et le document resterait. L'écran le
// dit AVANT le clic, sous les mots de la base (`refusDuRetraitDUneSource`), et n'envoie rien que la base refuserait.
describe('DocumentsTab — un document cité par la révision', () => {
  const PHRASE = 'Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne se supprime plus, sauf avec son dossier.'

  function citer(documentId: string) {
    faux.decisions = [{ id: 'j-2025', dossier_id: 'dossier-de-test', annee: 2025, compte: '512000' }]
    faux.preuves = [{ id: 'rp-1', dossier_id: 'dossier-de-test', justification_id: 'j-2025', piece_id: null, document_id: documentId }]
  }

  function deuxDocuments(): DocumentDivers[] {
    return [1, 2].map((n) => documentDeTest({
      id: `doc-${n}`, nom_fichier: `releve-${n}.pdf`, storage_path: `dossier-de-test/releve-${n}.pdf`,
    }))
  }

  it('dit la phrase de la base sur la ligne, et n’offre ni « Supprimer » ni « C’est une facture »', async () => {
    reinitialiser()
    citer('document-a-convertir')
    rendre()
    expect(await screen.findByText(PHRASE)).toBeDefined()
    expect(screen.getByText('Cité par la révision')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(screen.queryByRole('button', { name: "C'est une facture" })).toBeNull()
    expect(faux.inserts).toEqual([])
    expect(faux.suppressions).toBe(0)
  })

  it('une citation d’un AUTRE dossier ne compte pas : les deux gestes restent offerts', async () => {
    reinitialiser()
    citer('document-a-convertir')
    faux.decisions = faux.decisions.map((d) => ({ ...d, dossier_id: 'autre-dossier' }))
    faux.preuves = faux.preuves.map((p) => ({ ...p, dossier_id: 'autre-dossier' }))
    rendre()
    expect(await screen.findByRole('button', { name: "C'est une facture" })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDefined()
    expect(screen.queryByText(PHRASE)).toBeNull()
  })

  it('la sélection écarte le document cité, le NOMME dans la confirmation, et ne supprime que l’autre', async () => {
    reinitialiser()
    faux.documents = deuxDocuments()
    citer('doc-2')
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    fireEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }))
    await act(async () => { screen.getByRole('button', { name: /^Supprimer la sélection/ }).click() })

    const texte = String(confirmer.mock.calls[0]?.[0])
    expect(texte).toMatch(/^Supprimer définitivement 1 document \?/)
    expect(texte).toContain(`Un document de la sélection reste, cité par la révision des soldes :\n• releve-2.pdf — ${PHRASE}`)
    expect(faux.suppressions).toBe(1)
    expect(faux.retraits).toEqual([['dossier-de-test/releve-1.pdf']])
  })

  it('une sélection toute citée ne demande rien et dit pourquoi, sans rien envoyer', async () => {
    reinitialiser()
    citer('document-a-convertir')
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    fireEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }))
    await act(async () => { screen.getByRole('button', { name: /^Supprimer la sélection/ }).click() })

    expect(confirmer).not.toHaveBeenCalled()
    expect(faux.suppressions).toBe(0)
    // La phrase paraît deux fois : sur la ligne, et dans le message du geste refusé.
    expect(screen.getAllByText(PHRASE)).toHaveLength(2)
  })

  it('lues en partie, les citations le disent : « C’est une facture » attend, « Supprimer » reste (la base juge)', async () => {
    reinitialiser()
    faux.revisionRefusee = true
    rendre()
    expect(await screen.findByText(/Les décisions de la révision des soldes et leurs preuves/)).toBeDefined()
    expect((screen.getByRole('button', { name: "C'est une facture" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Supprimer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(faux.inserts).toEqual([])
  })
})

// LE DOSSIER PERMANENT CITE AUSSI (ligne 41, étape R7 ; `garder_source_citee` remplacée) : un document cité par une entrée
// — même remplacée, même retirée — ne se supprime plus et ne devient pas pièce. La révision d'un solde se dit d'abord,
// mot pour mot comme avant ; puis la NATURE de l'entrée qui cite, jamais son titre.
describe('DocumentsTab — un document cité par le dossier permanent', () => {
  const PHRASE_PERMANENT = 'Ce document est cité par le dossier permanent (bail) : il ne se supprime plus, sauf avec son dossier.'
  const PHRASE_REVISION = 'Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne se supprime plus, sauf avec son dossier.'

  function entree(champs: Record<string, unknown>) {
    return {
      id: 'e-1', dossier_id: 'dossier-de-test', nature: 'bail', titre: 'Titre secret du bail', texte: null,
      piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: null, valable_jusqu_au: null,
      remplace_id: null, retire_le: null, cree_le: '2026-01-01T00:00:00Z', ...champs,
    }
  }

  function deuxDocuments(): DocumentDivers[] {
    return [1, 2].map((n) => documentDeTest({
      id: `doc-${n}`, nom_fichier: `releve-${n}.pdf`, storage_path: `dossier-de-test/releve-${n}.pdf`,
    }))
  }

  it('dit la phrase de la base sur la ligne, sans le titre, et n’offre ni « Supprimer » ni « C’est une facture »', async () => {
    reinitialiser()
    faux.entrees = [entree({ document_id: 'document-a-convertir' })]
    rendre()
    expect(await screen.findByText(PHRASE_PERMANENT)).toBeDefined()
    expect(screen.getByText('Cité par le dossier permanent')).toBeDefined()
    expect(screen.queryByText(/Titre secret/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(screen.queryByRole('button', { name: "C'est une facture" })).toBeNull()
    expect(faux.inserts).toEqual([])
    expect(faux.suppressions).toBe(0)
  })

  it('une entrée RETIRÉE ou REMPLACÉE garde sa source : elle reste citée', async () => {
    reinitialiser()
    faux.entrees = [
      entree({ id: 'e-1', document_id: 'document-a-convertir', remplace_id: null, retire_le: null }),
      entree({ id: 'e-2', nature: 'contrat', document_id: null, texte: 'La suite', remplace_id: 'e-1', retire_le: '2026-02-01T00:00:00Z' }),
    ]
    rendre()
    expect(await screen.findByText(PHRASE_PERMANENT)).toBeDefined()
  })

  it('une entrée d’un AUTRE dossier ne compte pas : les deux gestes restent offerts', async () => {
    reinitialiser()
    faux.entrees = [entree({ dossier_id: 'autre-dossier', document_id: 'document-a-convertir' })]
    rendre()
    expect(await screen.findByRole('button', { name: "C'est une facture" })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDefined()
    expect(screen.queryByText(PHRASE_PERMANENT)).toBeNull()
  })

  it('la révision d’un solde se dit D’ABORD, mot pour mot, quand les deux citent', async () => {
    reinitialiser()
    faux.decisions = [{ id: 'j-2025', dossier_id: 'dossier-de-test', annee: 2025, compte: '512000' }]
    faux.preuves = [{ id: 'rp-1', dossier_id: 'dossier-de-test', justification_id: 'j-2025', piece_id: null, document_id: 'document-a-convertir' }]
    faux.entrees = [entree({ document_id: 'document-a-convertir' })]
    rendre()
    expect(await screen.findByText(PHRASE_REVISION)).toBeDefined()
    expect(screen.queryByText(PHRASE_PERMANENT)).toBeNull()
    expect(screen.getByText('Cité par la révision')).toBeDefined()
  })

  it('la sélection le NOMME : « cité par le dossier permanent », et ne supprime que l’autre', async () => {
    reinitialiser()
    faux.documents = deuxDocuments()
    faux.entrees = [entree({ document_id: 'doc-2' })]
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    fireEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }))
    await act(async () => { screen.getByRole('button', { name: /^Supprimer la sélection/ }).click() })

    const texte = String(confirmer.mock.calls[0]?.[0])
    expect(texte).toContain(`Un document de la sélection reste, cité par le dossier permanent :\n• releve-2.pdf — ${PHRASE_PERMANENT}`)
    expect(faux.suppressions).toBe(1)
    expect(faux.retraits).toEqual([['dossier-de-test/releve-1.pdf']])
  })

  it('cités par la révision ET par le dossier permanent, le message nomme les deux', async () => {
    reinitialiser()
    faux.documents = deuxDocuments()
    faux.decisions = [{ id: 'j-2025', dossier_id: 'dossier-de-test', annee: 2025, compte: '512000' }]
    faux.preuves = [{ id: 'rp-1', dossier_id: 'dossier-de-test', justification_id: 'j-2025', piece_id: null, document_id: 'doc-1' }]
    faux.entrees = [entree({ document_id: 'doc-2' })]
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    fireEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }))
    await act(async () => { screen.getByRole('button', { name: /^Supprimer la sélection/ }).click() })
    // Rien à supprimer : les deux sont cités, le message le dit sans demander de confirmation.
    expect(confirmer).not.toHaveBeenCalled()
    expect(screen.getByText(/^Ces 2 documents sont cités par la révision des soldes et le dossier permanent : ils ne se suppriment plus\./)).toBeDefined()
    expect(faux.suppressions).toBe(0)
  })

  it('lues en partie, les entrées le disent à part : « C’est une facture » attend, avec ses mots', async () => {
    reinitialiser()
    faux.dossierPermanentRefuse = true
    rendre()
    expect(await screen.findByText(/Les entrées du dossier permanent n'ont pas pu être lues en entier/)).toBeDefined()
    expect(screen.queryByText(/Les décisions de la révision des soldes et leurs preuves/)).toBeNull()
    const bouton = screen.getByRole('button', { name: "C'est une facture" }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    expect(bouton.title).toMatch(/^Les entrées du dossier permanent n’ont pas été lues en entier/)
    expect((screen.getByRole('button', { name: 'Supprimer' }) as HTMLButtonElement).disabled).toBe(false)
    expect(faux.inserts).toEqual([])
  })

  it('la révision d’un solde en défaut garde ses mots d’hier, et le dossier permanent n’en dit rien', async () => {
    reinitialiser()
    faux.revisionRefusee = true
    rendre()
    expect(await screen.findByText(/Les décisions de la révision des soldes et leurs preuves n'ont pas pu être lues en entier/)).toBeDefined()
    expect(screen.queryByText(/Les entrées du dossier permanent/)).toBeNull()
    expect((screen.getByRole('button', { name: "C'est une facture" }) as HTMLButtonElement).title)
      .toMatch(/^Les décisions de la révision des soldes n’ont pas été lues en entier/)
  })
})

// LA FICHE D'UN DOCUMENT DANS LE PANNEAU DE DROITE (demande du cabinet du 16/11/2026) : un clic sur un document ouvre sa
// fiche — l'aperçu et les gestes de la ligne —, au lieu d'ouvrir le fichier dans une autre fenêtre.
describe('DocumentsTab — la fiche d’un document dans le volet', () => {
  const volet = () => document.getElementById('panneau-droit')!
  const releveJanvier = () => documentDeTest({ id: 'doc-janvier', nom_fichier: 'releve-janvier.pdf', storage_path: 'dossier-de-test/releve-janvier.pdf', created_at: '2025-02-01T09:00:00Z' })
  const releveFevrier = () => documentDeTest({ id: 'doc-fevrier', nom_fichier: 'releve-fevrier.pdf', storage_path: 'dossier-de-test/releve-fevrier.pdf', created_at: '2025-03-01T09:00:00Z' })

  it('un clic sur le nom ouvre la fiche DE CE document, son aperçu signé, sans ouvrir de fenêtre', async () => {
    reinitialiser()
    faux.documents = [releveFevrier(), releveJanvier()]
    const ouverture = vi.spyOn(window, 'open')
    rendre()
    expect(volet().childElementCount).toBe(0)

    fireEvent.click(await screen.findByText('releve-janvier.pdf'))

    // Rendus du plus récent au plus ancien : janvier est le second de la liste affichée.
    expect(await within(volet()).findByText('Document 2 sur 2')).toBeDefined()
    expect(within(volet()).getByText('releve-janvier.pdf')).toBeDefined()
    const apercu = await within(volet()).findByTitle('Aperçu du document')
    expect(apercu.getAttribute('src')).toBe('https://signee.test/dossier-de-test/releve-janvier.pdf')
    expect(faux.signatures).toEqual(['dossier-de-test/releve-janvier.pdf'])
    expect(ouverture).not.toHaveBeenCalled()
    expect(screen.getByText('releve-janvier.pdf', { selector: 'a' }).closest('tr')!.className).toContain('ligne-ouverte')
  })

  it('« précédent » et « suivant » suivent la liste affichée', async () => {
    reinitialiser()
    faux.documents = [releveFevrier(), releveJanvier()]
    rendre()
    fireEvent.click(await screen.findByText('releve-fevrier.pdf'))
    expect(await within(volet()).findByText('Document 1 sur 2')).toBeDefined()
    expect((within(volet()).getByRole('button', { name: 'Document précédent' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(volet()).getByRole('button', { name: 'Document suivant' }))

    expect(await within(volet()).findByText('Document 2 sur 2')).toBeDefined()
    expect(within(volet()).getByText('releve-janvier.pdf')).toBeDefined()
    expect((within(volet()).getByRole('button', { name: 'Document suivant' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('changer de document pendant que l’aperçu se signe n’affiche jamais l’ancien', async () => {
    reinitialiser()
    faux.documents = [releveFevrier(), releveJanvier()]
    faux.signaturesRetenues = true
    rendre()
    fireEvent.click(await screen.findByText('releve-fevrier.pdf'))
    await within(volet()).findByText('Document 1 sur 2')
    fireEvent.click(within(volet()).getByRole('button', { name: 'Document suivant' }))
    await within(volet()).findByText('Document 2 sur 2')

    // La signature du document QUITTÉ revient la première : elle ne s'écrit nulle part.
    await act(async () => { faux.signaturesEnAttente.get('dossier-de-test/releve-fevrier.pdf')!() })
    expect(within(volet()).queryByTitle('Aperçu du document')).toBeNull()

    await act(async () => { faux.signaturesEnAttente.get('dossier-de-test/releve-janvier.pdf')!() })
    expect(within(volet()).getByTitle('Aperçu du document').getAttribute('src'))
      .toBe('https://signee.test/dossier-de-test/releve-janvier.pdf')
  })

  it('un chemin hors du dossier ne se demande pas au stockage, et la fiche le dit', async () => {
    reinitialiser()
    faux.documents = [documentDeTest({ storage_path: 'autre-dossier/facture.pdf' })]
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    expect(await within(volet()).findByText(/Aperçu indisponible : son chemin de stockage n’est pas dans ce dossier/)).toBeDefined()
    expect(faux.signatures).toEqual([])
  })

  it('ce qui ne se prévisualise pas le dit, et s’ouvre dans un onglet par lib/apercu.ts', async () => {
    reinitialiser()
    faux.documents = [documentDeTest({ nom_fichier: 'releve.csv', storage_path: 'dossier-de-test/releve.csv' })]
    const onglet = { opener: {} } as unknown as Window
    const ouverture = vi.spyOn(window, 'open').mockReturnValue(onglet)
    rendre()
    fireEvent.click(await screen.findByText('releve.csv'))
    expect(await within(volet()).findByText(/Ce type de fichier ne s’affiche pas ici/)).toBeDefined()
    expect(within(volet()).queryByTitle('Aperçu du document')).toBeNull()

    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Ouvrir dans un onglet ↗' })) })

    expect(ouverture).toHaveBeenCalledWith('https://signee.test/dossier-de-test/releve.csv', '_blank')
    expect(onglet.opener).toBeNull()
  })

  it('« Supprimer » depuis la fiche demande la même confirmation, n’écrit qu’une fois sur trois clics, et ferme la fiche', async () => {
    reinitialiser()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    const bouton = await within(volet()).findByRole('button', { name: 'Supprimer' })

    await act(async () => {
      bouton.click()
      bouton.click()
      bouton.click()
    })

    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(confirmation).toHaveBeenCalledWith('Supprimer définitivement "facture.pdf" ?')
    expect(faux.suppressions).toBe(1)
    expect(faux.retraits).toEqual([['dossier-de-test/facture.pdf']])
    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(volet().childElementCount).toBe(0)
  })

  it('une suppression qui répond après qu’on a ouvert un autre document ne ferme pas sa fiche', async () => {
    reinitialiser()
    faux.documents = [releveFevrier(), releveJanvier()]
    faux.suppressionRetenue = true
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    fireEvent.click(await screen.findByText('releve-fevrier.pdf'))
    await act(async () => { fireEvent.click(await within(volet()).findByRole('button', { name: 'Supprimer' })) })
    fireEvent.click(within(volet()).getByRole('button', { name: 'Document suivant' }))
    await within(volet()).findByText('Document 2 sur 2')

    await act(async () => { faux.relacherSuppression?.() })

    expect(await screen.findByText('Document 1 sur 1')).toBeDefined()
    expect(within(volet()).getByText('releve-janvier.pdf')).toBeDefined()
  })

  it('« C’est une facture » depuis la fiche n’écrit qu’une pièce sur trois clics, puis la fiche se ferme', async () => {
    reinitialiser()
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    const bouton = await within(volet()).findByRole('button', { name: "C'est une facture" })
    await screen.findAllByRole('button', { name: "C'est une facture" })
    await vi.waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false))

    await act(async () => {
      bouton.click()
      bouton.click()
      bouton.click()
    })
    expect(faux.inserts).toHaveLength(1)
    await act(async () => { faux.resoudreInsert?.() })

    expect(faux.suppressions).toBe(1)
    expect(await screen.findByText('Aucun document.')).toBeDefined()
    expect(volet().childElementCount).toBe(0)
  })

  it('un document cité n’offre dans la fiche ni « Supprimer » ni « C’est une facture », et dit la phrase de la base', async () => {
    reinitialiser()
    faux.documents = [documentDeTest({ dossier_id: 'dossier-de-test' })]
    faux.entrees = [{ id: 'e1', dossier_id: 'dossier-de-test', nature: 'bail', piece_id: null, document_id: 'document-a-convertir', remplace_id: null, retire_le: null }]
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    await within(volet()).findByText('Document 1 sur 1')
    await vi.waitFor(() => expect(within(volet()).queryByText('Cité par le dossier permanent')).not.toBeNull())
    expect(within(volet()).queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: "C'est une facture" })).toBeNull()
  })

  it('la catégorie se change depuis la fiche, et un refus s’y dit', async () => {
    reinitialiser()
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    const liste = await within(volet()).findByLabelText('Catégorie')

    await act(async () => { fireEvent.change(liste, { target: { value: 'attestation' } }) })
    expect(faux.documents[0].categorie).toBe('attestation')
    await vi.waitFor(() => expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('attestation'))

    faux.refusMaj = 'permission denied for table documents_divers'
    await act(async () => { fireEvent.change(within(volet()).getByLabelText('Catégorie'), { target: { value: 'autre' } }) })
    expect(await within(volet()).findByText(
      'La catégorie du document n’a pas pu être changée : permission denied for table documents_divers.',
    )).toBeDefined()
  })

  // LE SOUS-DOSSIER, CHOISI DANS LA FICHE SEULE (DOCF-Q1 (A), 16/11/2026).
  const sousDossier = (id: string, nom: string, dossier_id = 'dossier-de-test'): SousDossier => ({
    id, dossier_id, nom, ordre: 0, created_at: '2025-01-01T00:00:00Z',
  })
  const choixDuSousDossier = () => within(volet()).getByLabelText('Sous-dossier') as HTMLSelectElement

  it('le sous-dossier se choisit dans la fiche — parmi ceux de ce dossier —, s’écrit, se relit, et la ligne le montre', async () => {
    reinitialiser()
    faux.sousDossiers = [sousDossier('sd-banque', 'Banque'), sousDossier('sd-urssaf', 'Urssaf'), sousDossier('sd-ailleurs', 'Autre dossier', 'dossier-voisin')]
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    await within(volet()).findByLabelText('Sous-dossier')
    // Aucun, puis les deux du dossier : le sous-dossier d'un autre dossier n'est pas offert.
    expect([...choixDuSousDossier().options].map((o) => o.textContent)).toEqual(['— Aucun —', 'Banque', 'Urssaf'])
    // La ligne n'offre pas ce geste : un seul choix de sous-dossier à l'écran, celui de la fiche.
    expect(screen.getAllByLabelText('Sous-dossier')).toHaveLength(1)

    await act(async () => { fireEvent.change(choixDuSousDossier(), { target: { value: 'sd-urssaf' } }) })
    expect(faux.majs).toEqual([{ sous_dossier_id: 'sd-urssaf' }])
    expect(faux.documents[0].sous_dossier_id).toBe('sd-urssaf')
    await vi.waitFor(() => expect(choixDuSousDossier().value).toBe('sd-urssaf'))
    expect(screen.getByText('facture.pdf', { selector: 'a' }).closest('tr')!.textContent).toContain('Urssaf')

    // « Aucun » le retire : null, jamais une chaîne vide.
    await act(async () => { fireEvent.change(choixDuSousDossier(), { target: { value: '' } }) })
    expect(faux.majs[1]).toEqual({ sous_dossier_id: null })
    expect(faux.documents[0].sous_dossier_id).toBeNull()
  })

  it('deux choix du même rendu n’envoient qu’une mise à jour', async () => {
    reinitialiser()
    faux.sousDossiers = [sousDossier('sd-banque', 'Banque'), sousDossier('sd-urssaf', 'Urssaf')]
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    const choix = await within(volet()).findByLabelText('Sous-dossier')
    await act(async () => {
      fireEvent.change(choix, { target: { value: 'sd-banque' } })
      fireEvent.change(choix, { target: { value: 'sd-urssaf' } })
      fireEvent.change(choix, { target: { value: 'sd-banque' } })
    })
    expect(faux.majs).toHaveLength(1)
  })

  it('un refus de la base se dit, et le choix revient au sous-dossier d’avant', async () => {
    reinitialiser()
    faux.sousDossiers = [sousDossier('sd-banque', 'Banque'), sousDossier('sd-urssaf', 'Urssaf')]
    faux.documents = [documentDeTest({ sous_dossier_id: 'sd-banque' })]
    faux.refusMaj = 'permission denied for table documents_divers'
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    await within(volet()).findByLabelText('Sous-dossier')
    await act(async () => { fireEvent.change(choixDuSousDossier(), { target: { value: 'sd-urssaf' } }) })
    expect(await within(volet()).findByText(
      'Le sous-dossier du document n’a pas pu être changé : permission denied for table documents_divers.',
    )).toBeDefined()
    expect(choixDuSousDossier().value).toBe('sd-banque')
    expect(faux.documents[0].sous_dossier_id).toBe('sd-banque')
  })

  it('le choix optimiste s’annule dès le refus, sans attendre la relecture', async () => {
    reinitialiser()
    faux.sousDossiers = [sousDossier('sd-banque', 'Banque'), sousDossier('sd-urssaf', 'Urssaf')]
    faux.documents = [documentDeTest({ sous_dossier_id: 'sd-banque' })]
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    await within(volet()).findByLabelText('Sous-dossier')
    faux.refusMaj = 'permission denied for table documents_divers'
    faux.relectureRetenue = true
    await act(async () => { fireEvent.change(choixDuSousDossier(), { target: { value: 'sd-urssaf' } }) })
    expect(within(volet()).getByText(
      'Le sous-dossier du document n’a pas pu être changé : permission denied for table documents_divers.',
    )).toBeDefined()
    // Pendant la relecture, le choix attend (la liste se relit) et la fiche dit le sous-dossier : celui d'avant, déjà rendu.
    expect(within(volet()).getByText('La liste des sous-dossiers se lit : le sous-dossier se choisira ensuite.')).toBeDefined()
    expect(within(volet()).getByText('Banque', { selector: 'p' })).toBeDefined()
    expect(within(volet()).queryByText('Urssaf', { selector: 'p' })).toBeNull()
  })

  it('une mise à jour qui ne touche aucune ligne se dit, et le choix revient', async () => {
    reinitialiser()
    faux.sousDossiers = [sousDossier('sd-banque', 'Banque')]
    faux.majSansEffet = true
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    await within(volet()).findByLabelText('Sous-dossier')
    await act(async () => { fireEvent.change(choixDuSousDossier(), { target: { value: 'sd-banque' } }) })
    expect(await within(volet()).findByText(/la base n’a modifié aucune ligne/)).toBeDefined()
    expect(choixDuSousDossier().value).toBe('')
  })

  it('les sous-dossiers lus en partie : le sous-dossier se dit, aucun choix ne s’offre', async () => {
    reinitialiser()
    faux.sousDossiersRefuses = true
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    expect(await within(volet()).findByText(/La liste des sous-dossiers n’a pas pu être lue en entier .*ne se change pas d’ici\./)).toBeDefined()
    expect(within(volet()).queryByRole('combobox', { name: 'Sous-dossier' })).toBeNull()
    expect(faux.majs).toEqual([])
  })

  it('le texte lu se lit dans la fiche, sur un clic', async () => {
    reinitialiser()
    faux.presence = { data: [{ document_id: 'document-a-convertir' }], error: null }
    rendre()
    fireEvent.click(await screen.findByText('facture.pdf'))
    const bascule = await within(volet()).findByRole('button', { name: '▸ texte lu' })
    await act(async () => { fireEvent.click(bascule) })
    expect(await within(volet()).findByText('FOUR MICRO-ONDES')).toBeDefined()
  })
})

// LE TRI PAR UN CLIC SUR L'EN-TÊTE (demande du cabinet du 16/11/2026, lib/triDesTableaux.ts).
describe('DocumentsTab — le tri par un clic sur l’en-tête', () => {
  const volet = () => document.getElementById('panneau-droit')!
  const noms = () => [...document.querySelectorAll('tbody a.nom-fichier')].map((a) => a.textContent)
  const enTete = (nom: string) => screen.getByRole('button', { name: new RegExp(`^${nom}`) })
  const trois = () => [
    documentDeTest({ id: 'd-b', nom_fichier: 'b-releve.pdf', storage_path: 'dossier-de-test/b.pdf', created_at: '2025-03-01T09:00:00Z' }),
    documentDeTest({ id: 'd-c', nom_fichier: 'C-contrat.pdf', storage_path: 'dossier-de-test/c.pdf', created_at: '2025-02-01T09:00:00Z' }),
    documentDeTest({ id: 'd-a', nom_fichier: 'a-statuts.pdf', storage_path: 'dossier-de-test/a.pdf', created_at: '2025-01-01T09:00:00Z' }),
  ]

  it('croissant, décroissant, puis l’ordre d’origine, et aria-sort le dit', async () => {
    reinitialiser()
    faux.documents = trois()
    rendre()
    await screen.findByText('b-releve.pdf')
    const origine = noms()
    fireEvent.click(enTete('Fichier'))
    expect(noms()).toEqual(['a-statuts.pdf', 'b-releve.pdf', 'C-contrat.pdf'])
    expect(enTete('Fichier').closest('th')!.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(enTete('Fichier'))
    expect(noms()).toEqual(['C-contrat.pdf', 'b-releve.pdf', 'a-statuts.pdf'])
    expect(enTete('Fichier').closest('th')!.getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(enTete('Fichier'))
    expect(noms()).toEqual(origine)
    expect(enTete('Fichier').closest('th')!.getAttribute('aria-sort')).toBe('none')
  })

  it('la fiche d’un document suit l’ordre TRIÉ', async () => {
    reinitialiser()
    faux.documents = trois()
    rendre()
    await screen.findByText('b-releve.pdf')
    fireEvent.click(enTete('Ajouté le'))
    fireEvent.click(screen.getByText('a-statuts.pdf'))
    expect(await within(volet()).findByText('Document 1 sur 3')).toBeDefined()
    fireEvent.click(within(volet()).getByRole('button', { name: 'Document suivant' }))
    expect(await within(volet()).findByText('Document 2 sur 3')).toBeDefined()
    expect(within(volet()).getByText('C-contrat.pdf')).toBeDefined()
  })
})

// BOR6T-Q2 (A) : la Vue d'ensemble renvoie à la fiche d'un bordereau déjà déposé ; l'onglet l'ouvre une fois sa liste lue.
describe('DocumentsTab — la fiche demandée par la Vue d’ensemble', () => {
  const volet = () => document.getElementById('panneau-droit')!
  it('ouvre la fiche du document demandé et rend la demande ; dit celui qu’il ne trouve pas', async () => {
    reinitialiser()
    faux.documents = [documentDeTest({ id: 'doc-a', nom_fichier: 'scan-a.pdf', storage_path: 'dossier-de-test/scan-a.pdf', created_at: '2025-02-01T09:00:00Z' })]
    const prise = vi.fn()
    render(
      <FournisseurPanneauDroit>
        <DocumentsTab dossierId="dossier-de-test" ficheDemandee={{ dossierId: 'dossier-de-test', type: 'document', id: 'doc-a' }} onFicheDemandeePrise={prise} />
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>,
    )
    expect(await within(volet()).findByText('Document 1 sur 1')).toBeDefined()
    expect(prise).toHaveBeenCalledTimes(1)
    cleanup()
    reinitialiser()
    faux.documents = []
    render(
      <FournisseurPanneauDroit>
        <DocumentsTab dossierId="dossier-de-test" ficheDemandee={{ dossierId: 'dossier-de-test', type: 'document', id: 'parti' }} onFicheDemandeePrise={() => {}} />
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>,
    )
    expect(await screen.findByText(/n’est pas dans la liste lue/)).toBeDefined()
  })
})
