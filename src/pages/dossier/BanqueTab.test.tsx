import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { Categorie, CotisationDeclaree, LigneBancaire, Piece, RegleAffectationBancaire } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import type { Predicat } from '../../test/filtresPostgrest'

// « Tout rapprocher automatiquement » n'avait AUCUN verrou en `useRef`, contrairement à son voisin
// `validerEtRapprocherLot` juste au-dessus dans le fichier : il ne se désactivait que via
// `rapprochementAuto`, un ÉTAT React qui ne prend effet qu'au rendu suivant. Un double clic partait
// donc deux fois dans le même lot — même défaut que VehiculesCard, ImportDossierModal et « C'est une
// facture » (DocumentsTab), retrouvé ici en écrivant le test plutôt qu'en relisant le code.
const faux = vi.hoisted(() => ({
  lignes: [] as LigneBancaire[],
  pieces: [] as unknown[],
  updatesLignes: [] as Record<string, unknown>[],
  // La promesse de la première mise à jour de ligne bancaire est gardée en attente : c'est la
  // fenêtre réelle pendant laquelle un second clic arrive. La résoudre tout de suite supprimerait
  // la fenêtre même que le verrou est censé fermer.
  resoudreUpdateLigne: null as null | (() => void),
  // La lecture des relevés déjà classés dans Documents, refusée à la demande.
  erreurReleves: null as string | null,
  // Mises à jour de ligne appliquées tout de suite, pour les tests qui ne regardent pas la fenêtre
  // d'attente — ou refusées, pour ceux qui regardent ce que l'écran fait d'un échec.
  majImmediate: false,
  erreurMajLigne: null as string | null,
  // La RELECTURE du relevé retenue à la demande : c'est la fenêtre pendant laquelle le panneau montre
  // encore l'état d'avant, et que le verrou doit couvrir.
  retenirLectureLignes: false,
  resoudreLectureLignes: null as null | (() => void),
  updatesPieces: [] as Record<string, unknown>[],
  insertions: [] as { table: string; valeur: Record<string, unknown> }[],
  // Le serveur qui cesse de rendre au-delà de N lignes d'une table tout en annonçant le vrai total :
  // la panne qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts). Par table, parce que
  // chaque lot ne regarde pas les mêmes lectures.
  muet: {} as Record<string, number>,
  // Ce que « lit » le faux pdf.js : des lignes de texte avec l'abscisse de leur montant.
  lignesPdf: [] as { texte: string; xFin: number }[],
  // Les lignes d'écriture de la pièce, que la contrepartie banque lit avant d'écrire ; vides, elle
  // renonce (rien à compléter). Et les dates qu'elle réécrit, avec leurs filtres.
  ecritures: [] as { id: string; compte: string; ligne_bancaire_id?: string | null }[],
  updatesEcritures: [] as { valeur: Record<string, unknown>; filtres: string[] }[],
  // Les suppressions d'écritures, avec leurs filtres : c'est ce qui dit QUELLES lignes l'annulation
  // d'un rapprochement retire.
  suppressionsEcritures: [] as string[][],
  // L'insertion d'une écriture refusée par la base : c'est ce qui fait dire à l'écran que l'écriture
  // de la banque n'a pas pu être créée.
  erreurInsertionEcritures: null as string | null,
  // Les catégories du dossier (ligne 26.6), et les appels aux fonctions SQL de l'affectation — que le
  // faux serveur APPLIQUE au relevé, pour que la relecture montre le mouvement dans son nouvel état.
  categories: [] as Categorie[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  // Les règles d'affectation, ce que l'écran en écrit (`upsert`) et en retire (`delete`) — et le refus
  // de l'un ou l'autre à la demande.
  reglesAffectation: [] as RegleAffectationBancaire[],
  upserts: [] as { table: string; valeur: Record<string, unknown>; options: unknown }[],
  suppressionsRegles: [] as string[][],
  erreurUpsert: null as string | null,
  erreurSuppressionRegle: null as string | null,
  // Le lot refusé au N-ième envoi (1 pour le premier) : ce qui dit ce que l'écran annonce d'un refus au
  // milieu d'un lot découpé en envois.
  refusAuEnvoi: null as number | null,
  // Les échéances de cotisation : un justificatif possible pour le lot des règles, et une lecture qui
  // peut être partielle comme les autres.
  cotisations: [] as CotisationDeclaree[],
}))

// BanqueTab importe aussi lib/pdfText (import de relevé PDF), qui charge pdf.js — celui-ci touche au
// DOM dès l'import (voir CLAUDE.md, « Même règle pour les dépendances navigateur ») et lève sous
// jsdom faute de `DOMMatrix`. Aucune fonctionnalité PDF n'est exercée par ce test : le module est
// donc remplacé, exactement comme `lib/supabase` l'est ci-dessous pour ce qui parle à la base.
vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => faux.lignesPdf }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let idFiltre: unknown = null
    let valeurMaj: Record<string, unknown> = {}
    const filtres: string[] = []
    // Les filtres APPLIQUÉS aux catégories (voir src/test/filtresPostgrest.ts) : lues sur le seul
    // dossier au lieu du dossier ET du cabinet, elles disparaissent toutes en production — aucune n'y
    // appartient à un dossier —, et un faux qui ignorait les deux filtres ne pouvait pas le voir.
    const predicats: Predicat[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'id') idFiltre = valeur
        filtres.push(`${colonne}=${valeur}`)
        predicats.push(predicatEq(colonne, valeur))
        return c
      },
      neq: (colonne: string, valeur: unknown) => { filtres.push(`${colonne}!=${valeur}`); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      order: () => c,
      in: () => c,
      delete: () => { operation = 'delete'; return c },
      update: (valeur: Record<string, unknown>) => {
        operation = 'update'
        valeurMaj = valeur
        if (table === 'lignes_bancaires') faux.updatesLignes.push(valeur)
        if (table === 'pieces') faux.updatesPieces.push(valeur)
        if (table === 'ecritures_brouillon') faux.updatesEcritures.push({ valeur, filtres })
        return c
      },
      insert: (valeur: Record<string, unknown>) => {
        operation = 'insert'
        faux.insertions.push({ table, valeur })
        return c
      },
      upsert: (valeur: Record<string, unknown>, options: unknown) => {
        operation = 'upsert'
        faux.upserts.push({ table, valeur, options })
        return c
      },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => {
        const muet = faux.muet[table]
        if (operation === 'select' && muet != null) {
          const toutes = table === 'lignes_bancaires' ? faux.lignes : table === 'pieces' ? faux.pieces
            : table === 'categories' ? filtrer(faux.categories, predicats)
              : table === 'regles_affectation_bancaire' ? filtrer(faux.reglesAffectation, predicats)
                : table === 'cotisations_declarees' ? faux.cotisations : []
          const rendu = toutes.slice(debut, Math.min(fin + 1, muet))
          return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update' && faux.erreurMajLigne) {
          return Promise.resolve({ data: null, error: { message: faux.erreurMajLigne } }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update' && faux.majImmediate) {
          faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
          return Promise.resolve({ data: null, error: null }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update') {
          // La mise à jour reste en attente jusqu'à `resoudreUpdateLigne` : c'est la fenêtre
          // réseau réelle pendant laquelle un second clic arriverait. Une fois « résolue », elle
          // applique réellement la valeur — sinon le rechargement suivant verrait une ligne encore
          // "non_rapprochee" et le bouton réapparaîtrait à tort.
          return new Promise((resoudre) => {
            faux.resoudreUpdateLigne = () => {
              // `as` ici seulement : on simule le serveur qui applique un `update` partiel. La FABRIQUE,
              // elle, reste typée sans `as` — c'est là que le compilateur doit mordre.
              faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
              resoudre({ data: null, error: null })
            }
          }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'select' && faux.retenirLectureLignes) {
          faux.retenirLectureLignes = false
          return new Promise((resoudre) => {
            faux.resoudreLectureLignes = () => resoudre({ data: faux.lignes, error: null, count: faux.lignes.length })
          }).then(suite)
        }
        if (table === 'lignes_bancaires') {
          return Promise.resolve({ data: faux.lignes, error: null, count: faux.lignes.length }).then(suite)
        }
        if (table === 'ecritures_brouillon') {
          if (operation === 'delete') faux.suppressionsEcritures.push([...filtres])
          return Promise.resolve(operation === 'select'
            ? { data: faux.ecritures, error: null, count: faux.ecritures.length }
            : operation === 'insert' && faux.erreurInsertionEcritures
              ? { data: null, error: { message: faux.erreurInsertionEcritures } }
              : { data: null, error: null }).then(suite)
        }
        if (table === 'regles_affectation_bancaire') {
          if (operation === 'upsert') {
            return Promise.resolve(faux.erreurUpsert ? { data: null, error: { message: faux.erreurUpsert } } : { data: null, error: null }).then(suite)
          }
          if (operation === 'delete') {
            faux.suppressionsRegles.push([...filtres])
            if (faux.erreurSuppressionRegle) return Promise.resolve({ data: null, error: { message: faux.erreurSuppressionRegle } }).then(suite)
            faux.reglesAffectation = faux.reglesAffectation.filter((r) => r.id !== idFiltre)
            return Promise.resolve({ data: null, error: null }).then(suite)
          }
          const lues = filtrer(faux.reglesAffectation, predicats)
          return Promise.resolve({ data: lues, error: null, count: lues.length }).then(suite)
        }
        if (table === 'cotisations_declarees') {
          return Promise.resolve({ data: faux.cotisations, error: null, count: faux.cotisations.length }).then(suite)
        }
        if (table === 'categories') {
          const lues = filtrer(faux.categories, predicats)
          return Promise.resolve({ data: lues, error: null, count: lues.length }).then(suite)
        }
        if (table === 'documents_divers' && faux.erreurReleves) {
          return Promise.resolve({ data: null, error: { message: faux.erreurReleves }, count: null }).then(suite)
        }
        if (table === 'pieces') {
          // Le `count` est OBLIGATOIRE ici : sans total annoncé, `lireTout` déclare la lecture
          // INCOMPLÈTE (voir lib/lectureComplete.ts) et l'écran bascule sur son bandeau de lecture
          // partielle. Les tests d'avant passaient dans cet état dégradé — donc pour une raison qui
          // n'était pas celle qu'ils annonçaient. C'est le coût récurrent de `lireTout`, et il se
          // paie une fois par faux client.
          return Promise.resolve({ data: faux.pieces, error: null, count: faux.pieces.length }).then(suite)
        }
        // regles_bancaires_ignorees, controles_releves_bancaires,
        // ecritures_brouillon (lu avant contrepartie — vide fait renoncer à l'insertion, ce qui
        // évite d'avoir à modéliser aussi cette écriture ici) : rien de tout ça n'intervient dans
        // ce que ce test vérifie.
        return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
      },
    })
    return c
  }
  // Les deux fonctions SQL de l'affectation : le faux serveur refuse à la demande, sinon il applique au
  // relevé ce que la vraie fonction écrit — la catégorie et le statut, l'écriture n'étant pas relue ici.
  function rpc(nom: string, args: Record<string, unknown>) {
    faux.rpcs.push({ nom, args })
    if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
    if (nom === 'affecter_mouvements_bancaires') {
      const envoi = args.p_affectations as { ligne_bancaire_id: string; categorie_id: string }[]
      const rang = faux.rpcs.filter((r) => r.nom === nom).length
      if (faux.refusAuEnvoi === rang) {
        return Promise.resolve({ data: null, error: { message: 'Le mouvement du 02/06/2025 (-100,00 €) n\'est plus à traiter : il a changé depuis l\'affichage.' } })
      }
      faux.lignes = faux.lignes.map((l): LigneBancaire => {
        const a = envoi.find((x) => x.ligne_bancaire_id === l.id)
        return a ? { ...l, categorie_id: a.categorie_id, statut: 'rapprochee' } : l
      })
      return Promise.resolve({ data: envoi.length, error: null })
    }
    const id = args.p_ligne_bancaire_id
    faux.lignes = faux.lignes.map((l): LigneBancaire => {
      if (l.id !== id) return l
      return nom === 'affecter_mouvement_bancaire'
        ? { ...l, categorie_id: String(args.p_categorie_id), statut: 'rapprochee' }
        : { ...l, categorie_id: null, statut: 'non_rapprochee' }
    })
    return Promise.resolve({ data: 2, error: null })
  }
  return { supabase: { from: (table: string) => chaine(table), rpc } }
})

// TYPÉ, et sans `as`, comme `pieceDeTest` juste en dessous : le compilateur confronte alors chaque
// champ à `LigneBancaire`, donc à la table. Il a sorti `created_at`, absent depuis toujours de ce
// jeu d'essai — même remède que les cinq colonnes manquantes du `piece()` de PiecesTab.
function ligneDeTest(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -100,
    libelle: 'PRLV SEPA FOURNISSEUR', libelle_brut: null, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null,
    created_at: '2025-06-02T09:00:00Z', ...o,
  }
}

// TYPÉ, et sans `as` : le compilateur vérifie alors chaque champ contre `Piece`, donc contre la
// table. Le jeu d'essai portait `devise: null`, impossible en base (NOT NULL DEFAULT 'EUR') — et ce
// n'était pas inerte ici : `reglerPieceSurBanque` sort sur `!piece.devise` AVANT son test
// `=== 'EUR'`, donc le test exerçait la branche du champ absent au lieu de celle d'une pièce en
// euros. Un jeu d'essai infidèle ne fait pas qu'affaiblir un test : il lui fait prouver autre chose.
function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2025-06-01', tiers: 'Fournisseur', montant_ht: null, montant_tva: null,
    montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-06-01T09:00:00Z', updated_at: '2025-06-01T09:00:00Z', ...o,
  }
}

function reinitialiser() {
  faux.lignes = [ligneDeTest()]
  faux.pieces = [pieceDeTest()]
  faux.updatesLignes = []
  faux.resoudreUpdateLigne = null
  faux.erreurReleves = null
  faux.majImmediate = false
  faux.erreurMajLigne = null
  faux.retenirLectureLignes = false
  faux.resoudreLectureLignes = null
  faux.updatesPieces = []
  faux.insertions = []
  faux.muet = {}
  faux.lignesPdf = []
  faux.ecritures = []
  faux.updatesEcritures = []
  faux.suppressionsEcritures = []
  faux.erreurInsertionEcritures = null
  faux.categories = []
  faux.rpcs = []
  faux.erreurRpc = null
  faux.reglesAffectation = []
  faux.upserts = []
  faux.suppressionsRegles = []
  faux.erreurUpsert = null
  faux.erreurSuppressionRegle = null
  faux.refusAuEnvoi = null
  faux.cotisations = []
}

// L'onglet dans la coque du panneau de droite, comme dans l'application : sans elle,
// `usePanneauDroit` lève (voir lib/panneauDroit.ts) — un bouton qui n'ouvrirait rien ne doit pas
// passer pour un bouton qui marche.
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

function rendre(modele: ModeleComptable = TRESORERIE, assujettiTva = false) {
  return render(
    <FournisseurPanneauDroit>
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" modele={modele} assujettiTva={assujettiTva} />
      </AnneeProvider>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })

afterEach(() => { vi.restoreAllMocks() })

describe('BanqueTab — Tout rapprocher automatiquement', () => {
  it('ne rapproche le lot qu\'une fois quand le bouton est cliqué deux fois de suite', async () => {
    reinitialiser()
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })

    // Les deux clics partent dans le MÊME `act` : deux `fireEvent.click` de suite ne reproduisent
    // PAS un double clic, chacun ouvre son propre `act` qui re-rend le composant avant le suivant.
    await act(async () => {
      bouton.click()
      bouton.click()
    })

    expect(faux.updatesLignes).toHaveLength(1)
    expect(faux.updatesLignes[0]).toMatchObject({ statut: 'rapprochee', piece_id: 'piece-1' })

    await act(async () => { faux.resoudreUpdateLigne?.() })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull())
  })

  // DEUX PIÈCES QUI CONVIENNENT AUSSI BIEN L'UNE QUE L'AUTRE — le cas réel de ce dossier, deux
  // dépôts du même document au même montant et à la même date. L'écran faisait
  // `piecesValidees.find(...)` : la PREMIÈRE DE LA LISTE gagnait, en masse et sur un seul clic, sans
  // que rien ne le dise. `planRapprochementAutomatique` refuse désormais, et l'écran DIT ce qu'il
  // laisse — un bouton qui annonce N en en traitant moins ne dit pas où sont passées les autres.
  //
  // Aucun test de `src/lib` ne peut voir ceci : le plan est juste, c'est son CÂBLAGE à l'écran qui
  // décide de ce qui s'écrit en base et de ce que l'opérateur lit.
  it('ne rapproche rien et le dit quand deux pièces se disputent le mouvement', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    rendre()

    await screen.findByText(/plusieurs pièces ou échéances possibles/)
    expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull()
    expect(faux.updatesLignes).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE, et elle porte tout : sans elle, « l'écran refuse l'ambiguïté » serait satisfait
  // par un écran qui n'affiche JAMAIS le bouton et crie à l'ambiguïté sur un relevé ordinaire.
  it('ne crie pas à l’ambiguïté quand une seule pièce convient', async () => {
    reinitialiser()
    rendre()

    await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    expect(screen.queryByText(/plusieurs pièces ou échéances possibles/)).toBeNull()
  })
})

// UNE PASTILLE VERTE QUI SURVIT À CE QU'ELLE AFFIRMAIT. Les deux clés du côté banque
// (`piece_id`, `cotisation_id`) sont en `ON DELETE SET NULL` : supprimer la pièce ou l'échéance ne
// bloque pas, elle défait le lien en silence et `statut` reste `'rapprochee'`. L'écran affichait
// alors « Rapproché » en vert, indiscernable d'un vrai rapprochement — une pièce sans tiers rend
// exactement le même libellé nu — pendant que la Checklist, qui ne compte que les
// `non_rapprochee`, se taisait.
//
// Aucun test de `src/lib` ne peut le voir : `mouvementRapprocheSansObjet` est juste, c'est son
// CÂBLAGE à la pastille qui décide de ce que l'opérateur lit.
describe('BanqueTab — un mouvement rapproché qui ne désigne plus rien', () => {
  it("le dit au lieu d'afficher la pastille verte", async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: null, cotisation_id: null })]
    rendre()

    // L'écran s'ouvre sur « Non rapprochés » : c'est justement ce filtre qui fait disparaître le
    // mouvement orphelin de la vue par défaut, une raison de plus pour que sa pastille dise vrai.
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText('Rapproché sans justificatif')
    expect(screen.queryAllByText(/^Rapproché$/)).toHaveLength(0)

    // LE PANNEAU EST UNE SECONDE COPIE DE LA MÊME PASTILLE, et il faut l'OUVRIR pour la voir : une
    // assertion qui reste sur la liste laisserait le panneau mentir tout seul, et la mutation qui
    // ne corrige qu'un des deux sites passerait au vert.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(2)
    expect(screen.queryAllByText(/^Rapproché$/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la pastille ne ment plus » serait satisfait par un écran qui
  // crierait au justificatif manquant sur TOUS les rapprochements, y compris les vrais.
  it('laisse la pastille verte à un rapprochement qui désigne bien une pièce', async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText(/Rapproché — Fournisseur/)
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)

    // Le panneau dit le rapprochement par sa pastille ET par la pièce qu'il désigne.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(within(volet()).getByText('Rapproché')).toBeTruthy()
    expect(within(volet()).getByText('Rapproché avec')).toBeTruthy()
    expect(within(volet()).getByText('Fournisseur')).toBeTruthy()
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)
  })
})

// LA BANQUE FAIT FOI, MAIS SOUS UN SEUIL (décision du cabinet, 23/09/2026). Sous le seuil la pièce
// est ALIGNÉE au rapprochement, donc il ne reste aucun écart à montrer ; au-dessus on ne touche à
// rien — un écart large est presque toujours un paiement partiel ou groupé — et c'est cette pastille
// qui le dit.
//
// Aucun test de `src/lib` ne peut le voir : `ecartAvecBanque` est juste, c'est son CÂBLAGE qui
// décide de ce que l'opérateur lit. Et rien d'autre ne le dirait tant que les écritures ne sont pas
// générées : `synchroniserContrepartieBanque` sort avant d'écrire quoi que ce soit tant que la pièce
// n'a pas sa ligne de charge, donc `groupesDesequilibres` reste muet.
describe('BanqueTab — un rapprochement dont le montant ne correspond pas', () => {
  it("affiche l'écart, dans la liste ET dans le panneau", async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1', montant: -500 })]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText(/Écart de .*500,00.*avec la pièce/)

    // LE PANNEAU EST UNE SECONDE COPIE, et il faut l'OUVRIR : une assertion restée sur la liste
    // laisserait le panneau mentir tout seul, et la mutation qui ne corrige qu'un des deux sites
    // passerait au vert.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText(/Écart de .*500,00.*avec la pièce/)).toHaveLength(2)
  })

  // GARDE SYMÉTRIQUE — sans elle, « l'écran signale l'écart » serait satisfait par un écran qui
  // crie sur TOUS les rapprochements, y compris les exacts et ceux que le seuil absorbe.
  it('se tait sur un rapprochement exact et sur un écart sous le seuil', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 100 })]
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1', statut: 'rapprochee', piece_id: 'piece-1', montant: -100 }),
      ligneDeTest({ id: 'ligne-2', statut: 'rapprochee', piece_id: 'piece-1', montant: -100.03, libelle: 'PRLV AVEC FRAIS' }),
    ]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText('PRLV AVEC FRAIS')
    expect(screen.queryAllByText(/Écart de/)).toHaveLength(0)
  })
})

// LES RELEVÉS DÉJÀ CLASSÉS, LUS EN PARTIE, LE DISENT DANS L'IMPORT. Leur lecture s'écrivait
// `lireTout(…).then((lecture) => …)` — une forme que le scanner ne voyait pas — et jetait son
// drapeau : tronquée, la liste cache un relevé déjà classé, qu'on croit alors devoir redemander.
describe('BanqueTab — les relevés déjà classés dans Documents', () => {
  it('lus en partie, ils le disent', async () => {
    reinitialiser()
    faux.erreurReleves = 'refus simulé'
    rendre()
    expect(await screen.findByText(/Les relevés déjà classés dans Documents n'ont pas pu être lus en entier \(lecture interrompue après 0 ligne\(s\) : refus simulé\)/)).toBeTruthy()
  })

  it('lus en entier, ils se taisent', async () => {
    reinitialiser()
    rendre()
    expect(await screen.findByText('Importer un relevé bancaire')).toBeTruthy()
    expect(screen.queryAllByText(/Les relevés déjà classés dans Documents n'ont pas pu/)).toHaveLength(0)
  })
})

// LE RAPPROCHEMENT D'UN MOUVEMENT DANS LE PANNEAU DE DROITE (étape 2 de l'interface d'ordinateur).
// Il remplace une fenêtre qui recouvrait l'écran — et c'est ce qui change le plus : la liste reste
// cliquable à côté, donc « Tout rapprocher » et une action du panneau peuvent désormais se croiser sur
// le même mouvement. Ce qui ferait mentir le panneau sans que rien ne casse visiblement : une pièce
// « proposée » quand deux conviennent aussi bien (l'ordre de tri trancherait à la place de
// l'opérateur), trois coches sous une pièce que la banque ne confirme pas, un choix dans la liste
// déroulante qui rapproche dès qu'on y touche, une action qui part deux fois, et un panneau qui
// retombe sur l'état d'avant l'action.
// Par la ligne du RELEVÉ : le même libellé apparaît aussi dans les tableaux « Sans doute possible »
// et « À trancher par l'opérateur », qui ne s'ouvrent pas. Cherchée HORS de l'`act` : dedans, React
// retient les mises à jour du chargement jusqu'à la sortie, et la ligne n'apparaîtrait jamais.
async function ouvrir(libelle = 'PRLV SEPA FOURNISSEUR') {
  const cellules = await screen.findAllByText(libelle)
  const cellule = cellules.find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { cellule.click() })
}

describe('BanqueTab — le mouvement dans le panneau de droite', () => {
  it('associe la pièce proposée et RESTE sur le mouvement, dans son nouvel état', async () => {
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()

    expect(within(volet()).getByText('Mouvement 1 sur 1')).toBeTruthy()
    expect(within(volet()).getByText('Pièce proposée')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })

    // Comme dans la maquette : on voit ce qu'on vient de faire, et l'annulation est à portée de main.
    // Le mouvement a quitté la liste « Non rapprochés », et le panneau le dit plutôt que de mentir
    // sur sa place.
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())
    expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'rapprochee', piece_id: 'piece-1' })])
    expect(within(volet()).getByText('Mouvement hors de la liste affichée')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Annuler le rapprochement' })).toBeTruthy()
  })

  it('la ligne ouverte est surlignée dans la liste, et ne l’est plus panneau fermé', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const ligne = screen.getAllByText('PRLV SEPA FOURNISSEUR').map((e) => e.closest('tr')).find((tr) => tr != null)!
    expect(ligne.className).toContain('ligne-ouverte')
    await act(async () => { within(volet()).getByRole('button', { name: 'Fermer le panneau' }).click() })
    expect(ligne.className).not.toContain('ligne-ouverte')
    expect(volet().childElementCount).toBe(0)
  })

  it('justifie la pièce proposée par ses signaux', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('Même montant, au centime près')).toBeTruthy()
    expect(panneau.getByText('1 jour d’écart avec la pièce')).toBeTruthy()
    expect(panneau.getByText('Fournisseur retrouvé dans le libellé bancaire')).toBeTruthy()
    expect(panneau.queryAllByText(/Sens contraire/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE du précédent : sans elle, « le panneau justifie » serait satisfait par un
  // panneau qui coche TOUT — or c'est précisément le fournisseur et le sens qui séparent une
  // concordance d'une coïncidence (voir lib/appariementBanque.ts).
  it('dit ce que la banque ne confirme pas, au lieu de le cocher', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ tiers: 'Transmedical' })]
    faux.lignes = [ligneDeTest({ montant: 100, libelle: 'VIR SEPA REMBOURSEMENT' })]
    rendre()
    await ouvrir('VIR SEPA REMBOURSEMENT')
    const panneau = within(volet())
    expect(panneau.getByText('Fournisseur non retrouvé dans le libellé bancaire')).toBeTruthy()
    expect(panneau.getByText('Sens contraire : la pièce attend un paiement, le relevé montre un crédit')).toBeTruthy()
    expect(panneau.queryAllByText('Fournisseur retrouvé dans le libellé bancaire')).toHaveLength(0)
  })

  // DEUX PIÈCES QUI CONVIENNENT AUSSI BIEN : le cas que « Tout rapprocher » refuse de trancher. En
  // mettre une en avant sous « Pièce proposée », avec le bouton principal, le trancherait à la place
  // de l'opérateur — par l'ordre de tri.
  it('ne propose aucune des deux pièces qui conviennent aussi bien : il les montre toutes', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('2 pièces conviennent aussi bien')).toBeTruthy()
    expect(panneau.queryAllByText('Pièce proposée')).toHaveLength(0)
    expect(panneau.queryAllByRole('button', { name: 'Associer cette pièce' })).toHaveLength(0)

    const boutons = panneau.getAllByRole('button', { name: 'Associer celle-ci' })
    expect(boutons).toHaveLength(2)
    await act(async () => { boutons[1].click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ piece_id: 'piece-2' })]))
  })

  // Dans la fenêtre d'avant, choisir dans la liste déroulante RAPPROCHAIT : sur une liste qui a le
  // focus, les flèches du clavier changent la valeur, donc la première pièce venue partait sans avoir
  // été choisie. Le choix ne s'applique plus qu'au clic sur « Associer ».
  it('le choix à la main ne rapproche qu’au clic sur « Associer »', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ montant_ttc: 250 })]
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('Aucune pièce proposée pour ce mouvement.')).toBeTruthy()

    await act(async () => { fireEvent.change(panneau.getByLabelText('Pièce'), { target: { value: 'piece-1' } }) })
    expect(faux.updatesLignes).toHaveLength(0)

    await act(async () => { panneau.getByRole('button', { name: 'Associer' }).click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ piece_id: 'piece-1' })]))
  })

  // Trois clics dans le MÊME rendu, et pas deux : un verrou posé DANS le `try` laisse le refus du
  // deuxième sortir par le `finally`, qui relâche le verrou du premier — le troisième passe alors
  // (voir CLAUDE.md, « Le verrou se pose AVANT le `try` »).
  it('n’associe qu’une fois, même sur trois clics rapprochés', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const bouton = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.updatesLignes).toHaveLength(1)
  })

  // LE VERROU EST PARTAGÉ. Tant que le rapprochement vivait dans une fenêtre qui recouvrait l'écran,
  // on ne pouvait pas lancer « Tout rapprocher » en arbitrant une ligne ; le panneau laisse la liste
  // cliquable, donc les deux peuvent se croiser — et deux écritures qui se croisent laissent une
  // contrepartie banque pour une pièce que le mouvement ne désigne plus.
  it('une action du panneau en cours retient « Tout rapprocher », et inversement', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    const toutRapprocher = screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { associer.click(); toutRapprocher.click() })
    expect(faux.updatesLignes).toHaveLength(1)
    expect(toutRapprocher.hasAttribute('disabled')).toBe(true)
  })

  it('« Tout rapprocher » en cours retient le panneau', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    const toutRapprocher = screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { toutRapprocher.click(); associer.click() })
    expect(faux.updatesLignes).toHaveLength(1)
    expect(associer.hasAttribute('disabled')).toBe(true)
  })

  // Relâché avant la relecture du relevé, le verrou laisserait le panneau montrer « Associer cette
  // pièce » sur un mouvement DÉJÀ rapproché, le temps que la relecture revienne — et un second clic
  // referait le rapprochement.
  it('reste verrouillé tant que la relecture du relevé n’est pas revenue', async () => {
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()
    faux.retenirLectureLignes = true
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { associer.click() })
    await waitFor(() => expect(faux.resoudreLectureLignes).not.toBeNull())
    expect(associer.hasAttribute('disabled')).toBe(true)

    await act(async () => { faux.resoudreLectureLignes?.() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())
  })

  // L'échec se DIT, et l'écran ne reste pas figé : c'était la moitié silencieuse de l'ancien
  // `ignorer`, dont le résultat n'était pas lu — sans conséquence tant que la fenêtre se fermait sur
  // l'action, trompeur maintenant que le panneau reste sur le mouvement.
  it('un refus est dit, et le panneau redevient utilisable', async () => {
    reinitialiser()
    faux.erreurMajLigne = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ignorer' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/n'a pas pu être ignoré : refus simulé/)))
    expect(within(volet()).getByRole('button', { name: 'Ignorer' }).hasAttribute('disabled')).toBe(false)
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  // Rapproché sous le filtre « Non rapprochés », le mouvement quitte la liste : « Suivant » mène au
  // mouvement qui a pris sa place, et on enchaîne sans revenir à la liste.
  it('« Suivant » mène, après une association, au mouvement qui a pris sa place', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1' }),
      ligneDeTest({ id: 'ligne-2', montant: -42, libelle: 'PRLV SEPA AUTRE CHOSE' }),
    ]
    rendre()
    await ouvrir()
    expect(within(volet()).getByText('Mouvement 1 sur 2')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Mouvement hors de la liste affichée')).toBeTruthy())

    expect(within(volet()).getByRole('button', { name: 'Mouvement précédent' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { within(volet()).getByRole('button', { name: 'Mouvement suivant' }).click() })
    expect(within(volet()).getByText('Mouvement 1 sur 1')).toBeTruthy()
    expect(within(volet()).getAllByText('PRLV SEPA AUTRE CHOSE').length).toBeGreaterThan(0)
  })

  it('un mouvement ignoré se remet à traiter', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'ignoree' })]
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Ignorés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Remettre à traiter' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'non_rapprochee', piece_id: null, cotisation_id: null })])
  })
})

// L'ÉCRITURE D'UNE PIÈCE SUIT SON PAIEMENT (lib/rattachement.ts, lib/contrepartieBanque.ts) : datée
// au paiement quand on la rapproche, rendue à sa date de facture quand on annule. Ce qui se joue ici
// est le CÂBLAGE — que l'écran passe la pièce et le mouvement à ces deux fonctions.
describe('BanqueTab — l’écriture suit le paiement', () => {
  it('rapprocher une pièce déjà passée en écriture la date au paiement', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.ecritures = [{ id: 'e1', compte: '606100' }]
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())

    expect(faux.updatesEcritures).toEqual([{ valeur: { date: '2025-06-02' }, filtres: ['piece_id=piece-1', 'compte!=512000'] }])
    expect(faux.insertions).toContainEqual({ table: 'ecritures_brouillon', valeur: expect.objectContaining({ compte: '512000', date: '2025-06-02' }) })
  })

  it('annuler le rapprochement rend l’écriture à la date de sa facture', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())

    expect(faux.updatesEcritures).toEqual([{ valeur: { date: '2025-06-01' }, filtres: ['piece_id=piece-1'] }])
  })
})

// LE TROISIÈME CHEMIN DE RAPPROCHEMENT N'APPELAIT PAS LE RÈGLEMENT SUR LA BANQUE. Le rapprochement à
// la main et le lot « sans doute possible » règlent la pièce sur le montant réellement débité avant
// d'écrire la contrepartie (voir lib/reglementBanque.ts) ; « Tout rapprocher » ne le faisait pas, donc
// une pièce en devise rapprochée par lui restait « provisoire » au cours BCE alors que la banque
// venait de donner son montant réel.
describe('BanqueTab — Tout rapprocher règle la pièce sur la banque', () => {
  it('une pièce en devise passe au montant réellement débité', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ devise: 'USD', montant_devise: 120, montant_ttc: 100, taux_change: 1.2, conversion_source: 'bce' })]
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ conversion_source: 'banque' })]))
  })
})

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. Les bandeaux disaient déjà que les mouvements, les
// pièces ou les règles n'avaient été lus qu'en partie ; les boutons qui ÉCRIVENT à partir de ces
// listes restaient ouverts. L'import dédoublonne contre les mouvements LUS — et aucun écran ne permet
// de retirer un mouvement bancaire ; les deux lots n'écrivent que ce qui n'a qu'UN candidat, et une
// unicité ne se juge que sur tout ce qui existe.
describe('BanqueTab — import d’un relevé', () => {
  // Un import qui écarte des doublons le DIT par une alerte : c'est elle qui prouve, dans le cas
  // passant, que le dédoublonnage a bien tourné contre les mouvements lus.
  const alertes: string[] = []
  beforeEach(() => {
    alertes.length = 0
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alertes.push(String(m)) })
  })

  const CSV = 'Date;Libellé;Montant\n02/06/2025;PRLV SEPA FOURNISSEUR;-100,00\n05/06/2025;VIR CLIENT DUPONT;250,00\n'

  async function deposer() {
    const fichier = new File([CSV], 'releve-juin.csv', { type: 'text/csv' })
    const champ = document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
  }

  // La garde posée DANS les gestionnaires (`if (lectureIncomplete) return`) n'est atteinte par aucun
  // clic, le bouton étant déjà grisé : la retirer laisse ces tests verts, et c'est attendu. C'est une
  // seconde ceinture, comme le refus côté gestionnaire de ClotureTab — la dire gardée serait faux.
  it('se suspend sur un relevé lu à moitié, plutôt que de réimporter ce qu’il n’a pas lu', async () => {
    reinitialiser()
    // Le mouvement du 02/06 est en base, mais la lecture n'en rend rien : le dédoublonnage le
    // croirait absent, et l'importerait une seconde fois.
    faux.muet = { lignes_bancaires: 0 }
    rendre()

    const bouton = await deposer()
    expect(screen.getByText(/Import suspendu/)).toBeTruthy()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(0)
  })

  it('importe, sur une lecture complète, la seule ligne qui manque', async () => {
    // Le garde symétrique : sans lui, « l'import se suspend » serait satisfait par un import qui ne
    // part JAMAIS.
    reinitialiser()
    rendre()

    const bouton = await deposer()
    expect(screen.queryByText(/Import suspendu/)).toBeNull()
    await act(async () => { bouton.click() })

    const lot = faux.insertions.filter((i) => i.table === 'lignes_bancaires')
    expect(lot).toHaveLength(1)
    expect(lot[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT DUPONT', montant: 250 })])
    expect(alertes).toEqual([expect.stringContaining('1 déjà présente(s), ignorée(s)')])
  })

  // Le chemin PDF porte la même garde et le même verrou que le CSV — un chemin qu'on ne teste pas
  // est celui où une mutation passe inaperçue.
  async function deposerPdf() {
    faux.lignesPdf = [
      { texte: '02/06/2025 PRLV SEPA FOURNISSEUR -100,00', xFin: 0 },
      { texte: '05/06/2025 VIR CLIENT DUPONT 250,00', xFin: 0 },
    ]
    await act(async () => { (await screen.findByRole('button', { name: 'PDF' })).click() })
    const fichier = new File(['%PDF'], 'releve-juin.pdf', { type: 'application/pdf' })
    const champ = document.querySelector('input[type=file][accept=".pdf,application/pdf"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
  }

  it('se suspend aussi par le chemin PDF', async () => {
    reinitialiser()
    faux.muet = { lignes_bancaires: 0 }
    rendre()

    const bouton = await deposerPdf()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(0)
  })

  it("n'importe qu'une fois un relevé PDF cliqué trois fois", async () => {
    reinitialiser()
    rendre()

    const bouton = await deposerPdf()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    const lot = faux.insertions.filter((i) => i.table === 'lignes_bancaires')
    expect(lot).toHaveLength(1)
    expect(lot[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT DUPONT', montant: 250 })])
  })

  it("trois clics rapprochés n'importent le relevé qu'une fois", async () => {
    // Chaque clic dédoublonnait contre la MÊME liste d'avant : deux imports partis dans le même rendu
    // inséraient tous deux le relevé entier. Trois et non deux : un verrou posé dans le `try` serait
    // relâché par le deuxième clic et laisserait passer le troisième.
    reinitialiser()
    rendre()

    const bouton = await deposer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(1)
  })
})

describe('BanqueTab — les lots de rapprochement sur une lecture partielle', () => {
  it('suspend « Tout rapprocher » quand la jumelle d’une pièce peut ne pas avoir été lue', async () => {
    // Deux dépôts du même document : lus ensemble, le plan refuse de trancher (test plus haut). Lus
    // à moitié, la seconde disparaît et la première paraît seule candidate.
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    faux.muet = { pieces: 1 }
    rendre()

    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Rapprochement automatique suspendu/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.updatesLignes).toHaveLength(0)
  })

  it('suspend la validation en lot, qui validerait la pièce sur cette fausse certitude', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf', statut: 'a_valider' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf', statut: 'a_valider' }),
    ]
    faux.muet = { pieces: 1 }
    rendre()

    const bouton = await screen.findByRole('button', { name: /Valider et rapprocher les 1/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Validation en lot suspendue/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.updatesPieces).toHaveLength(0)
    expect(faux.updatesLignes).toHaveLength(0)
  })

  it('valide en lot, sur une lecture complète, la pièce qui n’a qu’un mouvement possible', async () => {
    // Le garde symétrique du précédent.
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ id: 'piece-1', statut: 'a_valider' })]
    rendre()

    const bouton = await screen.findByRole('button', { name: /Valider et rapprocher les 1/ })
    expect(screen.queryByText(/Validation en lot suspendue/)).toBeNull()
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ statut: 'validee' })]))
  })
})

// EN ENGAGEMENT (lib/engagement.ts), le rapprochement écrit le RÈGLEMENT de la facture et ne redate
// rien ; l'annuler retire ce règlement-là. Le calcul est testé à part : ici, que l'écran passe le
// modèle du dossier aux deux fonctions.
describe('BanqueTab — en engagement', () => {
  it('rapprocher écrit le règlement du mouvement, 401 contre 512, sans redater la facture', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.ecritures = [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: '401000', ligne_bancaire_id: null }]
    rendre(ENGAGEMENT)
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())

    expect(faux.updatesEcritures).toEqual([])
    expect(faux.insertions).toContainEqual({
      table: 'ecritures_brouillon',
      valeur: [
        expect.objectContaining({ compte: '401000', sens: 'debit', montant: 100, date: '2025-06-02', ligne_bancaire_id: 'ligne-1' }),
        expect.objectContaining({ compte: '512000', sens: 'credit', montant: 100, date: '2025-06-02', ligne_bancaire_id: 'ligne-1' }),
      ],
    })
  })

  it('dit que l’écriture de RÈGLEMENT n’a pas pu être créée, pas une « contrepartie banque »', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.erreurInsertionEcritures = 'refus simulé'
    faux.ecritures = [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: '401000', ligne_bancaire_id: null }]
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre(ENGAGEMENT)
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(
      "Le rapprochement est enregistré, mais l'écriture de règlement n'a pas pu être créée : refus simulé",
    ))
  })

  it('et parle de contrepartie banque en trésorerie — le garde symétrique', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.erreurInsertionEcritures = 'refus simulé'
    faux.ecritures = [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }]
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre(TRESORERIE)
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(
      "Le rapprochement est enregistré, mais l'écriture de contrepartie banque n'a pas pu être créée : refus simulé",
    ))
  })

  it('annuler le rapprochement retire le règlement de ce mouvement, et ne redate rien', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre(ENGAGEMENT)
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())

    expect(faux.suppressionsEcritures).toEqual([['ligne_bancaire_id=ligne-1']])
    expect(faux.updatesEcritures).toEqual([])
  })
})

// LIGNE 26.6 : un mouvement qui n'aura jamais de facture — des frais bancaires, un encaissement de
// l'Assurance maladie — s'affecte à une catégorie. Ce que ce bloc garde et qu'aucun test de `src/lib`
// ne peut voir : que l'écran passe par la fonction SQL (jamais une mise à jour directe de la ligne,
// qui laisserait l'écriture derrière), avec l'écriture composée pour CE mouvement, au clic seulement,
// une seule fois, et qu'il dise avant le clic ce que la base refuserait.
function categorieDeTest(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers', ...o,
  }
}

describe('BanqueTab — affecter un mouvement sans justificatif à une catégorie', () => {
  const FRAIS = categorieDeTest()
  const RECETTES = categorieDeTest({
    id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  })
  const BILAN = categorieDeTest({ id: 'cat-bilan', code: 'exploitant', libelle: 'Exploitant', ordre: 90, compte_comptable: '108000', poste_2035: null })

  function preparer(ligne: Partial<LigneBancaire> = {}) {
    reinitialiser()
    faux.pieces = []
    faux.categories = [FRAIS, RECETTES, BILAN]
    faux.lignes = [ligneDeTest({ libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5, ...ligne })]
  }
  const choisir = (id: string) => fireEvent.change(within(volet()).getByLabelText('Catégorie'), { target: { value: id } })
  async function voirLesRapproches() {
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
  }

  it('n’affecte qu’au clic sur « Affecter », par la base, et reste sur le mouvement', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    // Changer la liste n'écrit rien : sur une liste qui a le focus, les flèches du clavier la changent.
    choisir('cat-frais')
    expect(faux.rpcs).toEqual([])
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })

    await waitFor(() => expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy())
    expect(faux.rpcs).toEqual([{
      nom: 'affecter_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        p_categorie_id: 'cat-frais',
        p_ecritures: [
          { compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
          { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
        ],
      },
    }])
    // Jamais une mise à jour directe de la ligne : l'affectation et son écriture partent ensemble.
    expect(faux.updatesLignes).toEqual([])
    expect(within(volet()).getByRole('button', { name: 'Annuler l’affectation' })).toBeTruthy()
  })

  it('écrit un encaissement en recette sur un dossier exonéré : la banque au débit, le produit au crédit', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre()
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '706000', sens: 'credit', montant: 250, libelle: 'VIR CPAM' },
      { compte: '512000', sens: 'debit', montant: 250, libelle: 'VIR CPAM' },
    ])
  })

  it('refuse une recette sur un dossier assujetti, avant le clic', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre(TRESORERIE, true)
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    expect(within(volet()).getByText(/Sur un dossier assujetti à la TVA, une recette sans facture/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(true)
    // Une dépense, elle, s'affecte sur ce même dossier : pas de TVA déductible sans facture.
    choisir('cat-frais')
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(false)
  })

  it('nomme un encaissement rangé sur une dépense, sans le refuser — c’est un remboursement', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre()
    await ouvrir('VIR CPAM')
    choisir('cat-frais')
    expect(within(volet()).getByText(/C’est un encaissement, et cette catégorie est une dépense/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(false)
    // Le garde symétrique : rangé en recette, il n'y a rien à dire.
    choisir('cat-recettes')
    expect(within(volet()).queryByText(/C’est un encaissement/)).toBeNull()
  })

  it('ne propose que les comptes de charge et de produit, les dépenses d’abord pour un paiement', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    const options = within(within(volet()).getByLabelText('Catégorie')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['— Choisir —', 'Frais bancaires (627000)', 'Ventes / prestations (706000)'])
  })

  it('n’affecte qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    choisir('cat-frais')
    const bouton = within(volet()).getByRole('button', { name: 'Affecter' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('dit une affectation que la base refuse, et le mouvement reste à traiter', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    choisir('cat-frais')
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/L'affectation n'a pas pu être enregistrée : refus simulé/)))
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  it('la liste dit « Affecté » et la catégorie, jamais un « Rapproché » nu ni « sans justificatif »', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    rendre()
    await voirLesRapproches()
    expect(await screen.findByText('Affecté — Frais bancaires')).toBeTruthy()
    expect(screen.queryByText('Rapproché')).toBeNull()
    expect(screen.queryByText('Rapproché sans justificatif')).toBeNull()
  })

  it('annule l’affectation par la base, jamais par une remise à « à traiter »', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy()
    // Pas « Rapproché avec » : sa preuve est le relevé, pas une pièce.
    expect(within(volet()).queryByText('Rapproché avec')).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler l’affectation' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_affectation_mouvement_bancaire', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
  })

  it('dit une annulation que la base refuse, et le mouvement reste affecté', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler l’affectation' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/L'affectation n'a pas pu être annulée : refus simulé/)))
    expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Annuler l’affectation' }).hasAttribute('disabled')).toBe(false)
  })

  // LE VERROU EST PARTAGÉ AVEC LES LOTS, et le bouton le montre : sans cela il resterait cliquable
  // pendant « Tout rapprocher », et le clic, refusé par le verrou, ne ferait visiblement rien.
  it('« Tout rapprocher » en cours retient aussi l’affectation', async () => {
    preparer()
    faux.pieces = [pieceDeTest()]
    faux.lignes = [ligneDeTest(), ligneDeTest({ id: 'ligne-2', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5 })]
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    choisir('cat-frais')
    const affecter = within(volet()).getByRole('button', { name: 'Affecter' })
    expect(affecter.hasAttribute('disabled')).toBe(false)
    await act(async () => { screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ }).click() })
    expect(affecter.hasAttribute('disabled')).toBe(true)
    await act(async () => { affecter.click() })
    expect(faux.rpcs).toEqual([])
  })

  // Le compte d'une catégorie se change dans Écritures, après coup : un mouvement affecté quand elle
  // portait un compte de charge ne compte plus dans aucun total si elle porte maintenant un compte de
  // bilan, et c'est sur ce mouvement que l'opérateur doit l'apprendre.
  it('dit, sur un mouvement affecté, un compte qui n’est plus de charge ni de produit', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    // Le garde symétrique : affecté à une catégorie de charge, il n'y a rien à en dire.
    expect(within(volet()).queryByText(/n’est plus un compte de charge ou de produit/)).toBeNull()
    cleanup()

    preparer({ statut: 'rapprochee', categorie_id: 'cat-bilan' })
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText(/Le compte de cette catégorie n’est plus un compte de charge ou de produit/)).toBeTruthy()
  })

  it('dit qu’aucune catégorie n’a de compte de charge ou de produit, au lieu d’une liste vide', async () => {
    preparer()
    faux.categories = [BILAN]
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText(/Aucune catégorie de ce dossier n’a de compte de charge ou de produit/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Affecter' })).toBeNull()
  })

  it('dit des catégories lues en partie, sans quoi la liste de choix manquerait d’une catégorie en silence', async () => {
    preparer()
    faux.muet = { categories: 1 }
    rendre()
    expect(await screen.findByText(/Les catégories n'ont pas pu être lues en entier/)).toBeTruthy()
    // Le garde symétrique : lues en entier, rien à dire.
    cleanup()
    preparer()
    rendre()
    await screen.findAllByText('FRAIS TENUE DE COMPTE')
    expect(screen.queryByText(/Les catégories n'ont pas pu être lues/)).toBeNull()
  })

  it('dit, sur un mouvement affecté, ce que la 2035 ne comptera pas', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-divers' })
    faux.categories = [...faux.categories, categorieDeTest({ id: 'cat-divers', code: 'divers', libelle: 'Divers', compte_comptable: '628000', poste_2035: null })]
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText(/Cette catégorie n’a pas de poste 2035/)).toBeTruthy()
    // Réaffecter part de la catégorie en place : sans rien changer, il réécrit l'écriture.
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('cat-divers')
  })
})

function regleDeTest(o: Partial<RegleAffectationBancaire> = {}): RegleAffectationBancaire {
  return {
    id: 'regle-1', dossier_id: 'dossier-de-test', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes',
    created_at: '2025-07-01T09:00:00Z', ...o,
  }
}

// LES RÈGLES PROPOSENT, LE CLIC ÉCRIT (lib/reglesAffectation.ts). Ce qu'aucun test de `src/lib` ne peut
// voir : que le lot parte sur le clic et pas avant, par la fonction SQL et pas autrement, UNE fois
// sous trois clics, qu'il se suspende sur une lecture partielle, qu'il laisse de côté un mouvement
// dont la pièce est au dossier — et qu'une règle retenue depuis la fiche parte APRÈS l'affectation.
describe('BanqueTab — les règles d’affectation et le lot', () => {
  const FRAIS = categorieDeTest()
  const RECETTES = categorieDeTest({
    id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  })
  const ASSURANCE = categorieDeTest({ id: 'cat-assurance', code: 'assurance', libelle: 'Assurance', ordre: 30, compte_comptable: '616100', poste_2035: "Primes d'assurance" })

  function preparer() {
    reinitialiser()
    faux.pieces = []
    faux.categories = [FRAIS, RECETTES, ASSURANCE]
    faux.lignes = [
      ligneDeTest({ id: 'l-cpam-1', libelle: 'VIR CPAM 13 SOINS', montant: 250, date: '2025-06-03' }),
      ligneDeTest({ id: 'l-cpam-2', libelle: 'VIR CPAM 13 SOINS', montant: 180, date: '2025-06-10' }),
      ligneDeTest({ id: 'l-frais', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5, date: '2025-06-05' }),
      ligneDeTest({ id: 'l-swiss-1', libelle: 'PRLV SEPA SWISSLIFE', montant: -60, date: '2025-06-07' }),
      ligneDeTest({ id: 'l-swiss-2', libelle: 'PRLV SEPA SWISSLIFE', montant: -60, date: '2025-07-07' }),
    ]
    faux.reglesAffectation = [
      regleDeTest(),
      regleDeTest({ id: 'regle-2', motif: 'frais', sens: 'decaissement', categorie_id: 'cat-frais' }),
    ]
  }
  const envoisDuLot = () => faux.rpcs.filter((r) => r.nom === 'affecter_mouvements_bancaires')
  const choisir = (id: string) => fireEvent.change(within(volet()).getByLabelText('Catégorie'), { target: { value: id } })

  it('propose ce que les règles reconnaissent, et ne l’écrit qu’au clic, en un envoi', async () => {
    preparer()
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (3)')).toBeTruthy()
    expect(screen.getByText(/2 mouvements,/).closest('li')?.textContent).toMatch(/^Ventes \/ prestations \(706000\) : 2 mouvements, 430,00/)
    expect(screen.getByText(/1 mouvement,/).closest('li')?.textContent).toMatch(/^Frais bancaires \(627000\) : 1 mouvement, -8,50/)
    // Rien n'est écrit au chargement : la règle propose, elle n'écrit pas.
    expect(faux.rpcs).toEqual([])

    await act(async () => { screen.getByRole('button', { name: 'Affecter les 3' }).click() })

    expect(envoisDuLot()).toEqual([{
      nom: 'affecter_mouvements_bancaires',
      args: {
        p_affectations: [
          { ligne_bancaire_id: 'l-cpam-1', categorie_id: 'cat-recettes', ecritures: [
            { compte: '706000', sens: 'credit', montant: 250, libelle: 'VIR CPAM 13 SOINS' },
            { compte: '512000', sens: 'debit', montant: 250, libelle: 'VIR CPAM 13 SOINS' },
          ] },
          { ligne_bancaire_id: 'l-cpam-2', categorie_id: 'cat-recettes', ecritures: [
            { compte: '706000', sens: 'credit', montant: 180, libelle: 'VIR CPAM 13 SOINS' },
            { compte: '512000', sens: 'debit', montant: 180, libelle: 'VIR CPAM 13 SOINS' },
          ] },
          { ligne_bancaire_id: 'l-frais', categorie_id: 'cat-frais', ecritures: [
            { compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
            { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
          ] },
        ],
      },
    }])
    // Le relevé relu, plus rien n'est proposé : la carte disparaît.
    await waitFor(() => expect(screen.queryByText(/Affectations proposées par vos règles/)).toBeNull())
    expect(faux.updatesLignes).toEqual([])
  })

  it('la liste signale un mouvement qu’une règle propose', async () => {
    preparer()
    rendre()
    const ligne = (await screen.findAllByText('FRAIS TENUE DE COMPTE')).find((e) => e.closest('tr')?.classList.contains('clickable'))
    expect(ligne?.closest('tr')?.textContent).toMatch(/Non rapproché · suggestion/)
    // Le garde symétrique : un mouvement qu'aucune règle ne reconnaît reste sans suggestion.
    const autre = (await screen.findAllByText('PRLV SEPA SWISSLIFE')).find((e) => e.closest('tr')?.classList.contains('clickable'))
    expect(autre?.closest('tr')?.textContent).not.toMatch(/suggestion/)
  })

  it('écarte du lot un mouvement dont la pièce est au dossier, et le dit', async () => {
    preparer()
    faux.pieces = [pieceDeTest({ id: 'p-cpam', tiers: null, type_piece: 'vente', montant_ttc: 250, date_piece: '2025-06-01', statut: 'a_valider' })]
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (2)')).toBeTruthy()
    expect(screen.getByText(/1 mouvement à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.getByText(/Une pièce du même montant attend un rapprochement/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Affecter les 2' }).click() })
    const envoyes = (envoisDuLot()[0].args.p_affectations as { ligne_bancaire_id: string }[]).map((a) => a.ligne_bancaire_id)
    expect(envoyes).toEqual(['l-cpam-2', 'l-frais'])
  })

  it('suspend le lot sur une lecture partielle des règles, et le dit', async () => {
    preparer()
    faux.muet = { regles_affectation_bancaire: 1 }
    rendre()
    expect(await screen.findByText(/Les règles d’affectation n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.getByText(/Affectation en lot suspendue/)).toBeTruthy()
    const bouton = screen.getByRole('button', { name: /^Affecter les / })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(envoisDuLot()).toEqual([])
  })

  it('suspend aussi le lot sur une lecture partielle des pièces — un justificatif non lu ne s’écarte pas', async () => {
    preparer()
    faux.pieces = [pieceDeTest({ id: 'p-cpam', tiers: null, type_piece: 'vente', montant_ttc: 250, date_piece: '2025-06-01' })]
    faux.muet = { pieces: 0 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('suspend aussi le lot sur une lecture partielle des catégories — une règle y viserait une catégorie non lue', async () => {
    preparer()
    faux.muet = { categories: 2 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('suspend aussi le lot sur un relevé lu en partie', async () => {
    preparer()
    faux.muet = { lignes_bancaires: 4 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('suspend aussi le lot sur des échéances de cotisation lues en partie — une échéance non lue ne s’écarte pas', async () => {
    preparer()
    faux.cotisations = [{
      id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2025-06-05', montant_appele: 90, montant_verse: null,
      montant_csg_crds: null, previsionnel: false, created_at: '2025-01-10T09:00:00Z',
    }]
    faux.muet = { cotisations_declarees: 0 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('dit où sont passés les mouvements qu’une règle reconnaît, même quand elle n’en propose aucun', async () => {
    preparer()
    faux.reglesAffectation = [regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-assurance' })]
    faux.pieces = [pieceDeTest({ id: 'p-swiss', tiers: 'Swisslife Prévoyance', montant_ttc: 720, date_piece: '2025-01-15' })]
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (0)')).toBeTruthy()
    expect(screen.getByText(/2 mouvements à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Affecter les / })).toBeNull()
  })

  it('dit les mouvements que l’affectation refuserait, et pourquoi — jamais dans le lot', async () => {
    preparer()
    rendre(TRESORERIE, true)
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    const refus = screen.getByText(/2 mouvements que l'affectation refuserait/).closest('details')
    expect(refus?.textContent).toMatch(/règle « cpam »\) : .*assujetti à la TVA/)
  })

  it('dit les mouvements où des règles se contredisent, sans en proposer aucun', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'soins', sens: 'encaissement', categorie_id: 'cat-frais' }))
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    const conflits = screen.getByText(/2 mouvements où des règles se contredisent/).closest('details')
    expect(conflits?.textContent).toMatch(/VIR CPAM 13 SOINS : « cpam », « soins »/)
  })

  it('le dit aussi dans la fiche, et n’y présélectionne rien', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'soins', sens: 'encaissement', categorie_id: 'cat-frais' }))
    rendre()
    await ouvrir('VIR CPAM 13 SOINS')
    expect(within(volet()).getByText(/Plusieurs règles reconnaissent ce libellé sans s’accorder sur la catégorie/)).toBeTruthy()
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('')
  })

  it('n’affecte le lot qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Affecter les 3' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(envoisDuLot()).toHaveLength(1)
  })

  it('découpe un grand lot en envois de cent, et dit ce qui est passé avant un refus', async () => {
    preparer()
    faux.lignes = Array.from({ length: 150 }, (_, i) => ligneDeTest({
      id: `l${i}`, libelle: 'VIR CPAM 13 SOINS', montant: 10 + i, date: `2025-06-${String((i % 28) + 1).padStart(2, '0')}`,
    }))
    faux.refusAuEnvoi = 2
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Affecter les 150' })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalled())
    expect(envoisDuLot().map((r) => (r.args.p_affectations as unknown[]).length)).toEqual([100, 50])
    expect(alerte).toHaveBeenCalledWith(expect.stringMatching(
      /^100 mouvements affectés, puis l'envoi suivant a été refusé, et rien de cet envoi n'a été écrit : Le mouvement du 02\/06\/2025/))
    // Les cent premiers sont écrits : le relevé est relu, et la carte ne propose plus que les cinquante
    // autres — sans relecture, elle en annoncerait cent cinquante, dont cent déjà affectés.
    await waitFor(() => expect(screen.getByText('Affectations proposées par vos règles (50)')).toBeTruthy())
  })

  it('refusé dès le premier envoi, le lot dit que rien de cet envoi n’a été écrit', async () => {
    preparer()
    faux.refusAuEnvoi = 1
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Affecter les 3' })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/^Le lot a été refusé, et rien de cet envoi n'a été écrit : /)))
    expect(screen.getByText('Affectations proposées par vos règles (3)')).toBeTruthy()
  })

  it('retire une règle après une confirmation qui dit ce qu’on perd, sans toucher aux mouvements', async () => {
    preparer()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    const retirer = await screen.findByRole('button', { name: 'Retirer la règle « frais »' })
    await act(async () => { retirer.click() })
    expect(confirmation).toHaveBeenCalledWith(expect.stringMatching(/« frais » \(paiements → Frais bancaires\)[\s\S]*Les mouvements déjà affectés le restent/))
    expect(faux.suppressionsRegles).toEqual([])

    confirmation.mockReturnValue(true)
    await act(async () => { retirer.click() })
    expect(faux.suppressionsRegles).toEqual([['id=regle-2']])
    expect(faux.rpcs).toEqual([])
    await waitFor(() => expect(screen.getByText('Affectations proposées par vos règles (2)')).toBeTruthy())
  })

  it('dit un retrait de règle que la base refuse', async () => {
    preparer()
    faux.erreurSuppressionRegle = 'refus simulé'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    const retirer = await screen.findByRole('button', { name: 'Retirer la règle « frais »' })
    await act(async () => { retirer.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith("La règle n'a pas pu être retirée : refus simulé"))
  })

  it('présélectionne dans la fiche la catégorie qu’une règle propose, et le dit — sans rien écrire', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('cat-frais')
    expect(within(volet()).getByText(/Une règle range les paiements contenant « frais » dans cette catégorie/)).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    // Une autre catégorie choisie, la phrase se tait : elle parlerait d'une catégorie qui n'est plus celle-là.
    choisir('cat-assurance')
    expect(within(volet()).queryByText(/Une règle range les paiements/)).toBeNull()
  })

  it('ne parle d’aucune règle sur un mouvement déjà affecté', async () => {
    preparer()
    faux.lignes = faux.lignes.map((l) => (l.id === 'l-frais' ? { ...l, statut: 'rapprochee' as const, categorie_id: 'cat-frais' } : l))
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy()
    expect(within(volet()).queryByText(/Une règle range/)).toBeNull()
  })

  it('retient une règle depuis la fiche : l’affectation d’abord, puis la règle normalisée', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    expect((within(volet()).getByLabelText('Motif de la règle') as HTMLInputElement).value).toBe('swisslife')
    expect(within(volet()).getByText(/1 autre mouvement à traiter le contient : il sera proposé/)).toBeTruthy()
    fireEvent.change(within(volet()).getByLabelText('Motif de la règle'), { target: { value: '  SwissLife ' } })

    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })

    expect(faux.rpcs.map((r) => r.nom)).toEqual(['affecter_mouvement_bancaire'])
    expect(faux.upserts).toEqual([{
      table: 'regles_affectation_bancaire',
      valeur: { dossier_id: 'dossier-de-test', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-assurance' },
      options: { onConflict: 'dossier_id,motif,sens' },
    }])
  })

  it('n’écrit pas la règle quand l’affectation est refusée — une règle sans affectation proposerait un choix que personne n’a fait', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['affecter_mouvement_bancaire'])
    expect(faux.upserts).toEqual([])
  })

  it('n’écrit aucune règle quand la case n’est pas cochée', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['affecter_mouvement_bancaire'])
    expect(faux.upserts).toEqual([])
  })

  it('refuse, avant le clic, un motif qui ne nomme personne', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    fireEvent.change(within(volet()).getByLabelText('Motif de la règle'), { target: { value: 'PRLV SEPA' } })
    expect(within(volet()).getByText(/il désignerait un type d’opération, pas un tiers/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(true)
  })

  it('dit la règle que la nouvelle remplacerait', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-frais' }))
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    expect(within(volet()).getByText(/Elle remplacera la règle qui les range en « Frais bancaires »/)).toBeTruthy()
    // Le garde symétrique : la même catégorie choisie, rien n'est remplacé.
    choisir('cat-frais')
    expect(within(volet()).queryByText(/Elle remplacera/)).toBeNull()
  })

  it('ne dit pas remplacer une règle de l’autre sens', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'encaissement', categorie_id: 'cat-recettes' }))
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    expect(within(volet()).getByText(/1 autre mouvement à traiter le contient/)).toBeTruthy()
    expect(within(volet()).queryByText(/Elle remplacera/)).toBeNull()
  })

  it('dit une règle que la base refuse, le mouvement restant affecté', async () => {
    preparer()
    faux.erreurUpsert = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(
      "Le mouvement est affecté, mais la règle n'a pas pu être enregistrée : refus simulé"))
    await waitFor(() => expect(within(volet()).getByText('Affecté à « Assurance »')).toBeTruthy())
  })

  it('ne retient aucune règle sur une lecture partielle des règles', async () => {
    preparer()
    faux.muet = { regles_affectation_bancaire: 1 }
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    expect(within(volet()).getByRole('checkbox').hasAttribute('disabled')).toBe(true)
    expect(within(volet()).getByText(/Les règles d’affectation n’ont pas pu être lues en entier/)).toBeTruthy()
  })

  it('des règles relues en partie, fiche ouverte et case cochée, suspendent l’affectation', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    // Une relecture du relevé arrive pendant que la fiche est ouverte — ici après le retrait d'une autre
    // règle —, et elle ne lit les règles qu'en partie.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.muet = { regles_affectation_bancaire: 0 }
    await act(async () => { screen.getByRole('button', { name: 'Retirer la règle « frais »' }).click() })
    await waitFor(() => expect(within(volet()).getByText(/Les règles d’affectation n’ont pas pu être lues en entier/)).toBeTruthy())
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(true)
  })

  it('avertit, avant d’affecter, qu’un justificatif de ce tiers attend un rapprochement', async () => {
    preparer()
    faux.pieces = [pieceDeTest({ id: 'p-swiss', tiers: 'Swisslife Prévoyance', montant_ttc: 720, date_piece: '2025-01-15' })]
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    expect(within(volet()).getByText(/Un justificatif de ce tiers n’est rapproché d’aucun mouvement\. Avant d’affecter/)).toBeTruthy()
    // Le garde symétrique : sans pièce de ce tiers, rien à dire.
    cleanup()
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    expect(within(volet()).queryByText(/Avant d’affecter/)).toBeNull()
  })
})
