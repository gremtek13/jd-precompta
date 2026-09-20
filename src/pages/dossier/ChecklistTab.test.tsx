import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChecklistTab from './ChecklistTab'

// L'ÉCRAN QUI PRÉTEND DIRE CE QUI MANQUE — donc celui dont le SILENCE est le plus dangereux, parce
// qu'il est exactement ce qu'on attend de lui quand tout va bien. Un contrôle branché sur le mauvais
// sous-ensemble y est invisible : le module appelé derrière est juste, l'écran est calme, et il n'y a
// rien à regarder.
//
// Ce test garde ce câblage-là, et pas le calcul. Le projet connaissait déjà le piège — il est écrit
// en tête du composant, sur moisEnDoubleSurAbonnement — et il s'est reproduit quand même sur
// piecesADateImpossible : la SEULE pièce de la base à porter une date impossible est « à valider »,
// donc le contrôle était aveugle sur le cas même que son commentaire cite comme origine.
const faux = vi.hoisted(() => ({ parTable: {} as Record<string, unknown[]> }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      // Le statut demandé décide de ce que rend la table `pieces` : c'est tout l'objet du test, les
      // deux piles devant être distinguables.
      let statut: string | null = null
      Object.assign(chaine, {
        select: () => chaine,
        eq: (colonne: string, valeur: string) => { if (colonne === 'statut') statut = valeur; return chaine },
        is: () => chaine,
        not: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const cle = table === 'pieces' && statut ? `pieces:${statut}` : table
          const toutes = faux.parTable[cle] ?? []
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

// Deux lectures best-effort que le composant fait hors du client Supabase.
vi.mock('../../lib/controlesReleves', () => ({ chargerRelevesIncoherents: async () => [] }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))

function piece(o: Record<string, unknown> = {}) {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'justificatif.pdf', statut: 'a_valider',
    type_piece: 'achat', date_piece: null, montant_ht: null, montant_tva: null, montant_ttc: null,
    tiers: null, categorie_id: null, confiance: 'haute', devise: null, montant_devise: null,
    created_at: '2026-09-16T09:00:00Z', ...o,
  }
}

function poser(pieces: { validees?: unknown[]; aValider?: unknown[] }) {
  faux.parTable = {
    'pieces:validee': pieces.validees ?? [],
    'pieces:a_valider': pieces.aValider ?? [],
    pieces: [...(pieces.validees ?? []), ...(pieces.aValider ?? [])],
    cotisations_declarees: [], lignes_bancaires: [], immobilisations: [],
    natures_immobilisation: [], categories: [], ecritures_brouillon: [],
    declarations_tva: [], documents_divers: [], informations_dossier: [],
  }
}

function monter() {
  return render(<ChecklistTab dossierId="dossier-de-test" assujettiTva={false} onNavigate={() => {}} />)
}

const LIBELLE = /datée\(s\) après leur dépôt/

describe('ChecklistTab — une date impossible se voit AVANT la validation', () => {
  it('signale une pièce « à valider » datée après son dépôt', async () => {
    // Le cas réel, reconstruit : datée de 2028, déposée en 2026, sans tiers ni montant. Branché sur
    // les seules pièces validées, ce point reste à zéro et l'écran n'a rien à montrer.
    poser({ aValider: [piece({ id: 'futur', date_piece: '2028-09-27' })] })
    monter()

    const ligne = await screen.findByText(LIBELLE)
    expect(ligne.textContent).toMatch(/^1 /)

    // ET IL DIT COMMENT LA TROUVER. C'est le seul point de la liste dont le bouton ne suffit pas :
    // la pièce est par définition dans un exercice futur, donc écartée par le sélecteur d'exercice
    // de l'en-tête, qui s'ouvre toujours sur une année précise. Sans cette ligne, « Corrigez ces
    // dates » menait vers une liste où la pièce n'apparaît même pas.
    expect(screen.getByText(/toutes les années/)).toBeDefined()
  })

  it('signale aussi une pièce VALIDÉE datée après son dépôt', async () => {
    // L'autre moitié : élargir aux deux piles ne doit pas faire perdre celle qui marchait déjà.
    poser({ validees: [piece({ id: 'futur', statut: 'validee', date_piece: '2028-09-27' })] })
    monter()

    const ligne = await screen.findByText(LIBELLE)
    expect(ligne.textContent).toMatch(/^1 /)
  })

  it('se tait quand toutes les dates sont antérieures au dépôt', async () => {
    poser({
      validees: [piece({ id: 'ok1', statut: 'validee', date_piece: '2026-03-10' })],
      aValider: [piece({ id: 'ok2', date_piece: '2026-01-05' })],
    })
    monter()

    // Le point d'ancrage est un AUTRE point de la même liste, que ce jeu de données déclenche
    // forcément (la pièce validée n'a pas de catégorie) : il prouve que le rendu a eu lieu et que la
    // liste est peuplée. Sans lui, un écran encore en chargement rendrait ce test vert pour une
    // raison fausse — c'est le piège d'un test qui vérifie une ABSENCE.
    await screen.findByText(/sans catégorie/)
    expect(screen.queryByText(LIBELLE)).toBeNull()
  })
})
