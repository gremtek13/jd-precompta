import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import PiecesTab from './PiecesTab'

// L'ÉCRAN OÙ LA PIÈCE SE CORRIGE. Cinq contrôles de la famille « donnée démontrée fausse » y
// envoient l'opérateur depuis la Checklist (`cible: 'pieces'`), et trois seulement marquaient la
// ligne : une date postérieure au dépôt et une devise non convertie annonçaient « 1 pièce,
// corrigez-la » puis renvoyaient vers une liste où RIEN ne la désigne.
//
// Ce test garde la PRÉSENCE du badge, ce qu'aucun test de `src/lib` ne peut faire : les deux
// contrôles étaient justes, ils n'étaient simplement branchés nulle part ici.
const faux = vi.hoisted(() => ({ parTable: {} as Record<string, unknown[]> }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        is: () => chaine,
        not: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({
            data: toutes.slice(debut, debut + (fin - debut + 1)),
            error: null,
            count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
  },
}))

// `PiecesTab` lit `monCabinetId` du contexte d'authentification, pour la règle tiers → catégorie
// partagée par le cabinet. Monter un AuthProvider complet ferait dépendre ce test d'une session
// Supabase ; la doublure dit exactement ce dont l'écran a besoin, et rien de plus.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: 'cabinet-de-test' }) }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
// La forme exacte de `PresenceTexteOcr` compte — `{ avecTexte: Set, erreur: string | null }` : le
// premier est lu en `.has()` à chaque ligne, le second décide de l'affichage du bouton de
// relecture (une lecture refusée retire le bouton, parce que sa présence coûte des appels Textract
// facturés). Une doublure qui invente ses champs fait planter l'écran avant le premier test.
vi.mock('../../lib/texteOcr', () => ({
  piecesAvecTexteOcr: async () => ({ avecTexte: new Set<string>(), erreur: null }),
  texteOcrDeLaPiece: async () => null,
}))

function piece(o: Record<string, unknown> = {}) {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'justificatif.pdf', statut: 'a_valider',
    type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
    montant_ttc: 120, tiers: 'FOURNISSEUR', categorie_id: null, confiance: 'haute',
    devise: 'EUR', montant_devise: null, taux_change: null, sous_dossier_id: null,
    storage_path: 'dossier-de-test/justificatif.pdf', storage_hash: null,
    created_at: '2026-09-16T09:00:00Z', ...o,
  }
}

function poser(pieces: unknown[]) {
  faux.parTable = {
    pieces, categories: [], sous_dossiers: [], tiers_categories: [],
    tiers_categories_cabinet: [], piece_commentaires: [], lignes_bancaires: [],
  }
}

function monter(annee: number | 'toutes') {
  return render(
    <AnneeProvider defaut={annee}>
      <PiecesTab dossierId="dossier-de-test" />
    </AnneeProvider>,
  )
}

describe('PiecesTab — les badges des données démontrées fausses', () => {
  it('marque la ligne d’une pièce datée après son dépôt', async () => {
    // Le cas réel, reconstruit : datée de 2028, déposée en 2026.
    poser([piece({ id: 'futur', date_piece: '2028-09-27' })])
    monter('toutes')

    expect(await screen.findByText('Date impossible')).toBeDefined()
  })

  it('marque la ligne d’une pièce en devise sans taux de change', async () => {
    poser([piece({ id: 'devise', devise: 'USD', montant_devise: 140, taux_change: null })])
    monter('toutes')

    expect(await screen.findByText('Devise non convertie')).toBeDefined()
  })

  it('ne marque rien sur une pièce datée avant son dépôt et libellée en euros', async () => {
    poser([piece({ id: 'saine' })])
    monter('toutes')

    // Ancré sur le tiers, qui est présent : vérifier une ABSENCE sur un écran encore en chargement
    // rendrait ce test vert pour une raison fausse.
    await screen.findByText('FOURNISSEUR')
    expect(screen.queryByText('Date impossible')).toBeNull()
    expect(screen.queryByText('Devise non convertie')).toBeNull()
  })
})
