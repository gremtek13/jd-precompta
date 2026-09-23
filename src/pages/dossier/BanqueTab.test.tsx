import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import BanqueTab from './BanqueTab'
import type { LigneBancaire, Piece } from '../../lib/types'

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
}))

// BanqueTab importe aussi lib/pdfText (import de relevé PDF), qui charge pdf.js — celui-ci touche au
// DOM dès l'import (voir CLAUDE.md, « Même règle pour les dépendances navigateur ») et lève sous
// jsdom faute de `DOMMatrix`. Aucune fonctionnalité PDF n'est exercée par ce test : le module est
// donc remplacé, exactement comme `lib/supabase` l'est ci-dessous pour ce qui parle à la base.
vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))

vi.mock('../../lib/supabase', () => {
  function chaine(table: string) {
    let operation = 'select'
    let idFiltre: unknown = null
    let valeurMaj: Record<string, unknown> = {}
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'id') idFiltre = valeur
        return c
      },
      order: () => c,
      in: () => c,
      update: (valeur: Record<string, unknown>) => {
        operation = 'update'
        valeurMaj = valeur
        if (table === 'lignes_bancaires') faux.updatesLignes.push(valeur)
        return c
      },
      range: () => c,
      then: (suite: (r: unknown) => unknown) => {
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
        if (table === 'lignes_bancaires') {
          return Promise.resolve({ data: faux.lignes, error: null, count: faux.lignes.length }).then(suite)
        }
        if (table === 'pieces') {
          // Le `count` est OBLIGATOIRE ici : sans total annoncé, `lireTout` déclare la lecture
          // INCOMPLÈTE (voir lib/lectureComplete.ts) et l'écran bascule sur son bandeau de lecture
          // partielle. Les tests d'avant passaient dans cet état dégradé — donc pour une raison qui
          // n'était pas celle qu'ils annonçaient. C'est le coût récurrent de `lireTout`, et il se
          // paie une fois par faux client.
          return Promise.resolve({ data: faux.pieces, error: null, count: faux.pieces.length }).then(suite)
        }
        // cotisations_declarees, regles_bancaires_ignorees, controles_releves_bancaires,
        // ecritures_brouillon (lu avant contrepartie — vide fait renoncer à l'insertion, ce qui
        // évite d'avoir à modéliser aussi cette écriture ici) : rien de tout ça n'intervient dans
        // ce que ce test vérifie.
        return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

// TYPÉ, et sans `as`, comme `pieceDeTest` juste en dessous : le compilateur confronte alors chaque
// champ à `LigneBancaire`, donc à la table. Il a sorti `created_at`, absent depuis toujours de ce
// jeu d'essai — même remède que les cinq colonnes manquantes du `piece()` de PiecesTab.
function ligneDeTest(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -100,
    libelle: 'PRLV SEPA FOURNISSEUR', libelle_brut: null, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, prelevement_personnel: false, source_fichier: null,
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
}

describe('BanqueTab — Tout rapprocher automatiquement', () => {
  it('ne rapproche le lot qu\'une fois quand le bouton est cliqué deux fois de suite', async () => {
    reinitialiser()
    render(
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" />
      </AnneeProvider>,
    )
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
    render(
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" />
      </AnneeProvider>,
    )

    await screen.findByText(/plusieurs pièces ou échéances possibles/)
    expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull()
    expect(faux.updatesLignes).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE, et elle porte tout : sans elle, « l'écran refuse l'ambiguïté » serait satisfait
  // par un écran qui n'affiche JAMAIS le bouton et crie à l'ambiguïté sur un relevé ordinaire.
  it('ne crie pas à l’ambiguïté quand une seule pièce convient', async () => {
    reinitialiser()
    render(
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" />
      </AnneeProvider>,
    )

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
    render(
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" />
      </AnneeProvider>,
    )

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
    render(
      <AnneeProvider defaut="toutes">
        <BanqueTab dossierId="dossier-de-test" />
      </AnneeProvider>,
    )

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText(/Rapproché — Fournisseur/)
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)

    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText(/Rapproché — Fournisseur/)).toHaveLength(2)
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)
  })
})
