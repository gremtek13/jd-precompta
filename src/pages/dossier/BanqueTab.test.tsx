import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import BanqueTab from './BanqueTab'
import type { Piece } from '../../lib/types'

// « Tout rapprocher automatiquement » n'avait AUCUN verrou en `useRef`, contrairement à son voisin
// `validerEtRapprocherLot` juste au-dessus dans le fichier : il ne se désactivait que via
// `rapprochementAuto`, un ÉTAT React qui ne prend effet qu'au rendu suivant. Un double clic partait
// donc deux fois dans le même lot — même défaut que VehiculesCard, ImportDossierModal et « C'est une
// facture » (DocumentsTab), retrouvé ici en écrivant le test plutôt qu'en relisant le code.
const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
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
              faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } : l))
              resoudre({ data: null, error: null })
            }
          }).then(suite)
        }
        if (table === 'lignes_bancaires') {
          return Promise.resolve({ data: faux.lignes, error: null, count: faux.lignes.length }).then(suite)
        }
        if (table === 'pieces') {
          return Promise.resolve({ data: faux.pieces, error: null }).then(suite)
        }
        // cotisations_declarees, regles_bancaires_ignorees, controles_releves_bancaires,
        // ecritures_brouillon (lu avant contrepartie — vide fait renoncer à l'insertion, ce qui
        // évite d'avoir à modéliser aussi cette écriture ici) : rien de tout ça n'intervient dans
        // ce que ce test vérifie.
        return Promise.resolve({ data: [], error: null }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

function ligneDeTest() {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -100,
    libelle: 'PRLV SEPA FOURNISSEUR', libelle_brut: null, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, prelevement_personnel: false, source_fichier: null,
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
