import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EstimationTab from './EstimationTab'
import type { Categorie, Piece } from '../../lib/types'

// LE CALCUL EST DANS `lib/estimation.ts`, TESTÉ — CE QUI SE JOUE ICI EST LE CÂBLAGE.
//
// Deux écrivains alimentaient `references_postes_annuels` avec deux conventions de signe : le bouton
// « Calculer le détail par poste » écrivait des montants NÉGATIFS pour une charge, le formulaire
// juste au-dessus ce que le cabinet tape. Les deux s'affichent dans le même tableau, sous un titre
// qui dit « autres charges ».
//
// Et l'écran porte DEUX jeux de pièces — `piecesValidees` et `recettesValidees` — dont CLAUDE.md
// raconte qu'un nom y a déjà menti. Se tromper d'argument ne se verrait pas au type, les deux étant
// des `Piece[]` : c'est ce qu'aucun test de `src/lib` ne peut voir.
const faux = vi.hoisted(() => ({
  pieces: [] as unknown[],
  categories: [] as unknown[],
  immobilisations: [] as unknown[],
  upserts: [] as Record<string, unknown>[],
  upsertsAnnuels: [] as Record<string, unknown>[],
  // Le serveur qui cesse de rendre les pièces au-delà de N tout en annonçant le vrai total : la
  // panne qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts).
  muetPieces: null as number | null,
}))

vi.mock('../../lib/supabase', () => {
  function chaine(table: string) {
    let venteSeulement = false
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'type_piece' && valeur === 'vente') venteSeulement = true
        return c
      },
      or: () => c, order: () => c, in: () => c, delete: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      upsert: (valeur: Record<string, unknown>) => {
        if (table === 'references_postes_annuels') faux.upserts.push(valeur)
        if (table === 'references_annuelles') faux.upsertsAnnuels.push(valeur)
        return c
      },
      then: (suite: (r: unknown) => unknown) => {
        // `pieces` est lu DEUX fois par cet écran : une fois restreint aux ventes
        // (`recettesValidees`), une fois pour toutes les validées (`piecesValidees`). Le faux
        // respecte la distinction, sans quoi le test ne pourrait pas voir l'écran se tromper de jeu.
        const donnees = table === 'pieces'
          ? (venteSeulement ? faux.pieces.filter((p) => (p as Piece).type_piece === 'vente') : faux.pieces)
          : table === 'categories' ? faux.categories
          : table === 'immobilisations' ? faux.immobilisations : []
        if (table === 'pieces' && faux.muetPieces != null) {
          const rendu = donnees.slice(debut, Math.min(fin + 1, faux.muetPieces))
          return Promise.resolve({ data: rendu, error: null, count: donnees.length }).then(suite)
        }
        return Promise.resolve({ data: donnees, error: null, count: donnees.length }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

// TYPÉ SANS `as` : le compilateur vérifie alors chaque champ contre la table — le remède appliqué à
// `ChecklistTab`, `BanqueTab` puis `PiecesTab` après qu'un `devise: null` impossible en base eut fait
// prouver autre chose à un test.
function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier/f.pdf', nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2025-03-01', tiers: 'Bailleur', montant_ht: 1000, montant_tva: null,
    montant_ttc: 1200, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: 'cat-loyer', sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-03-01T09:00:00Z', updated_at: '2025-03-01T09:00:00Z', ...o,
  }
}

// Sans `as`, là encore : la première version de ce jeu d'essai portait un champ `nom` et un `type`
// que `Categorie` n'a pas (elle porte `code` et `libelle`), et c'est le compilateur qui l'a dit.
function categorieDeTest(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-loyer', dossier_id: null, code: '613200', libelle: 'Loyer', ordre: 1,
    compte_comptable: '613200', poste_2035: 'Loyer', ...o,
  }
}

async function rendre() {
  render(<EstimationTab dossierId="dossier-de-test" />)
  return screen.findByRole('button', { name: 'Calculer le détail par poste' })
}

describe('EstimationTab — détail par poste', () => {
  it('enregistre des montants POSITIFS pour une charge', async () => {
    faux.pieces = [pieceDeTest()]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0]).toMatchObject({ annee: 2025, poste: 'Loyer', montant: 1000 })
  })

  it('n’écrit aucune recette dans une carte intitulée « autres charges »', async () => {
    // Et le test le prouve sur un jeu qui contient les DEUX : sans la charge à côté, « n'écrit pas
    // la recette » serait satisfait par un écran qui n'écrit jamais rien.
    faux.pieces = [
      pieceDeTest({ id: 'charge' }),
      pieceDeTest({ id: 'recette', type_piece: 'vente', categorie_id: 'cat-hono', montant_ht: 4500 }),
    ]
    faux.categories = [categorieDeTest(), categorieDeTest({ id: 'cat-hono', code: '706000', libelle: 'Honoraires', poste_2035: 'Honoraires' })]
    faux.immobilisations = []
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts.map((u) => u.poste)).toEqual(['Loyer'])
  })

  it('n’écrit pas une dépense capitalisée, qui serait comptée deux fois', async () => {
    // Une pièce immobilisée est déjà couverte par son amortissement : la porter aussi en charge
    // courante la compterait deux fois. Trouvé par mutation — l'écran peut très bien appeler le bon
    // calcul en lui passant un ensemble vide, et aucun test de `src/lib` ne le verrait.
    faux.pieces = [pieceDeTest({ id: 'immo' }), pieceDeTest({ id: 'charge', montant_ht: 300 })]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = [{ piece_id: 'immo', id: 'i1' }]
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0]).toMatchObject({ poste: 'Loyer', montant: 300 })
  })

  it('le dit plutôt que d’écrire quand aucune pièce ne porte de poste', async () => {
    // GARDE SYMÉTRIQUE de l'écran : sans elle, « n'écrit pas les recettes » serait satisfait par un
    // bouton muet, et l'opérateur cliquerait sans jamais rien obtenir ni comprendre pourquoi.
    faux.pieces = [pieceDeTest({ categorie_id: null })]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []

    const bouton = await rendre()
    await act(async () => { bouton.click() })

    expect(faux.upserts).toHaveLength(0)
    await screen.findByText(/Aucune pièce avec un poste 2035 renseigné/)
  })
})

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. Les deux calculs ENREGISTRENT leur résultat comme
// repère annuel : faits sur une partie des pièces, ils gravaient un chiffre trop bas, qui survivait au
// rechargement de la page alors que le bandeau, lui, disparaissait avec la panne.
describe('EstimationTab — les repères ne se calculent pas sur une lecture partielle', () => {
  function poser() {
    faux.pieces = [pieceDeTest({ id: 'p1' }), pieceDeTest({ id: 'p2', montant_ht: 300 })]
    faux.categories = [categorieDeTest()]
    faux.immobilisations = []
    faux.upserts = []
    faux.upsertsAnnuels = []
    faux.muetPieces = null
  }

  it('grise les deux calculs et n’enregistre rien', async () => {
    poser()
    faux.muetPieces = 1
    await rendre()

    await screen.findByText(/Calcul suspendu/)
    const postes = screen.getByRole('button', { name: 'Calculer le détail par poste' })
    const annuel = screen.getByRole('button', { name: 'Calculer CA + cotisations' })
    expect(postes.hasAttribute('disabled')).toBe(true)
    expect(annuel.hasAttribute('disabled')).toBe(true)
    await act(async () => { postes.click(); annuel.click() })
    expect(faux.upserts).toHaveLength(0)
    expect(faux.upsertsAnnuels).toHaveLength(0)
  })

  it('calcule le repère annuel sur une lecture complète', async () => {
    // Garde symétrique pour le second bouton — le premier a les siens plus haut.
    poser()
    await rendre()
    expect(screen.queryByText(/Calcul suspendu/)).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Calculer CA + cotisations' }).click() })
    // L'année proposée est celle d'avant l'année en cours : lue ici comme l'écran la lit, pour que ce
    // test ne dépende pas du jour où il tourne.
    expect(faux.upsertsAnnuels).toEqual([expect.objectContaining({ annee: new Date().getFullYear() - 1, source: 'calculee' })])
  })
})
