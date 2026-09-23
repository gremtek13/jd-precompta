import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import PiecesTab from './PiecesTab'
import type { Piece, PieceCommentaire } from '../../lib/types'
import { AVERTISSEMENT_RAPPROCHEMENT_DEFAIT } from '../../lib/controles'

// L'ÉCRAN OÙ LA PIÈCE SE CORRIGE. Cinq contrôles de la famille « donnée démontrée fausse » y
// envoient l'opérateur depuis la Checklist (`cible: 'pieces'`), et trois seulement marquaient la
// ligne : une date postérieure au dépôt et une devise non convertie annonçaient « 1 pièce,
// corrigez-la » puis renvoyaient vers une liste où RIEN ne la désigne.
//
// Ce test garde la PRÉSENCE du badge, ce qu'aucun test de `src/lib` ne peut faire : les deux
// contrôles étaient justes, ils n'étaient simplement branchés nulle part ici.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Par table, le rang au-delà duquel le serveur ne rend plus rien TOUT EN annonçant le vrai
  // total : c'est ce qui produit une lecture incomplète, pas une tranche plus courte (que
  // `lireTout` recolle, à juste titre).
  muetApres: {} as Record<string, number>,
  suppressions: [] as unknown[],
  // La base REFUSE la suppression : c'est le seul chemin qui allume l'alerte de fin de lot, et
  // c'est elle qui inventait une cause (« liées à un rapprochement bancaire ou à un pack déjà
  // généré ») au lieu de rendre la raison.
  refusSuppression: null as string | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let operation = 'select'
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { operation = 'delete'; return chaine },
        eq: (colonne: string, valeur: unknown) => {
          if (operation === 'delete' && colonne === 'id') faux.suppressions.push(valeur)
          return chaine
        },
        is: () => chaine,
        not: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (suite: (r: { data: unknown[]; error: { message: string } | null; count: number }) => unknown) => {
          if (operation === 'delete') {
            const erreur = faux.refusSuppression ? { message: faux.refusSuppression } : null
            return Promise.resolve({ data: [], error: erreur, count: 0 }).then(suite)
          }
          const toutes = faux.parTable[table] ?? []
          const plafond = faux.muetApres[table]
          const finReelle = plafond === undefined ? debut + (fin - debut + 1) : Math.min(debut + (fin - debut + 1), plafond)
          return Promise.resolve({
            data: toutes.slice(debut, finReelle),
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

// Typé `Piece` SANS `as` : le compilateur vérifie alors chaque champ contre la table, à chaque
// build et exhaustivement. C'est le remède déjà appliqué à ChecklistTab et BanqueTab après un
// `devise: null` qui faisait compter CHAQUE pièce comme « devise non convertie » — un jeu d'essai
// infidèle ne fait pas qu'affaiblir un test, il lui fait prouver autre chose.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'justificatif.pdf', statut: 'a_valider',
    type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
    montant_ttc: 120, tiers: 'FOURNISSEUR', categorie_id: null, confiance: 'haute',
    devise: 'EUR', montant_devise: null, taux_change: null, sous_dossier_id: null,
    storage_path: 'dossier-de-test/justificatif.pdf', storage_hash: null,
    // CINQ colonnes que ce jeu d'essai omettait, et que le typage a sorties une par une dès les
    // premières compilations : `uploaded_by`, `source` (`'cabinet'` n'existe pas — c'est déjà
    // l'infidélité qu'un autre écran portait), `conversion_source`, `notes` et
    // `superpdp_invoice_id`. Aucune n'était visible en relisant.
    uploaded_by: null, source: 'upload', conversion_source: null,
    notes: null, superpdp_invoice_id: null, updated_at: '2026-09-16T09:00:00Z',
    created_at: '2026-09-16T09:00:00Z', ...o,
  }
}

function poser(pieces: unknown[], commentaires: PieceCommentaire[] = []) {
  faux.muetApres = {}
  faux.suppressions = []
  faux.refusSuppression = null
  faux.parTable = {
    pieces, categories: [], sous_dossiers: [], tiers_categories: [],
    tiers_categories_cabinet: [], piece_commentaires: commentaires, lignes_bancaires: [],
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

describe('PiecesTab — une précision manquante ne doit pas ressembler à un client silencieux', () => {
  const commentaire = (i: number): PieceCommentaire => ({
    id: `c${i}`, dossier_id: 'dossier-de-test', piece_id: 'p1', document_id: null,
    auteur_id: 'u1', origine: 'client', texte: `précision ${i}`,
    created_at: '2026-09-16T10:00:00Z',
  })

  it('DIT que le fil des précisions est tronqué', async () => {
    // `chargerCommentaires` portait depuis toujours la mise en garde — « la précision du client
    // disparaît sur les pièces les plus récentes, précisément celles qu'on arbitre » — au-dessus
    // d'un code qui jetait le drapeau permettant de la voir. Une liste plus courte est
    // indiscernable d'un client qui n'a rien écrit, et c'est l'appel téléphonique que ces
    // précisions existent pour éviter.
    poser([piece()], [commentaire(1), commentaire(2), commentaire(3), commentaire(4)])
    faux.muetApres = { piece_commentaires: 2 }
    monter('toutes')

    expect(await screen.findByText(/Les précisions déposées par le client/)).toBeDefined()
  })

  it('ne dit rien quand le fil a été lu en entier', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « le bandeau apparaît » serait satisfait par un bandeau
    // permanent, qu'on cesserait de lire — et il emporterait ses voisins dans son discrédit.
    poser([piece()], [commentaire(1), commentaire(2)])
    monter('toutes')

    // Ancré sur le tiers, qui est présent : vérifier une ABSENCE sur un écran encore en chargement
    // rendrait ce test vert pour une raison fausse.
    await screen.findByText('FOURNISSEUR')
    expect(screen.queryAllByText(/Les précisions déposées par le client/)).toHaveLength(0)
  })

  it('n’annonce pas les précisions tronquées quand ce sont les PIÈCES qui le sont', async () => {
    // Deux bandeaux, deux conséquences : les fondre en un seul afficherait, sur l'un des deux cas,
    // une phrase qui n'est pas la sienne.
    poser([piece({ id: 'p1' }), piece({ id: 'p2' }), piece({ id: 'p3' })], [commentaire(1)])
    faux.muetApres = { pieces: 1 }
    monter('toutes')

    expect(await screen.findByText(/Les pièces du dossier/)).toBeDefined()
    expect(screen.queryAllByText(/Les précisions déposées par le client/)).toHaveLength(0)
  })
})

// SUPPRIMER UNE SÉLECTION DISAIT LE CONTRAIRE DE CE QU'ELLE FAIT. Le message annonçait que les
// pièces « liées à un rapprochement bancaire ou à un pack déjà généré » n'avaient pas pu être
// supprimées, et envoyait « retirer d'abord ce lien ». Mesuré le 23/09/2026 : les CINQ clés
// étrangères entrantes de `pieces` sont en SET NULL ou CASCADE, aucune en NO ACTION — une
// suppression de pièce ne peut donc JAMAIS lever 23503 —, et `packs` n'a plus aucune clé entrante,
// `pack_pieces` ayant été supprimée. La vraie conséquence, elle, n'était nommée nulle part : le
// mouvement rapproché sur cette pièce garde `statut = 'rapprochee'` et ne désigne plus rien.
describe('PiecesTab — supprimer une sélection dit ce que ça défait', () => {
  async function selectionner() {
    monter(2026)
    const cases = await screen.findAllByRole('checkbox')
    // La première case est « tout sélectionner » (en-tête) ; celle de la ligne vient après.
    await act(async () => { fireEvent.click(cases[cases.length - 1]) })
    return screen.findByRole('button', { name: /Supprimer la sélection/ })
  }

  it('nomme le rapprochement bancaire défait dans la confirmation', async () => {
    poser([piece({ id: 'p1' })])
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })

    const bouton = await selectionner()
    await act(async () => { bouton.click() })

    expect(message).toContain(AVERTISSEMENT_RAPPROCHEMENT_DEFAIT)
    expect(faux.suppressions).toHaveLength(0)
    expect(message).not.toMatch(/pack déjà généré/)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la confirmation nomme ce qu'on perd » serait satisfait par un
  // bouton qui ne supprime JAMAIS.
  it('supprime bien quand on confirme', async () => {
    poser([piece({ id: 'p1' })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const bouton = await selectionner()
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual(['p1'])
  })

  it("rend la RAISON d'un échec au lieu d'en inventer une", async () => {
    poser([piece({ id: 'p1' })])
    faux.refusSuppression = 'new row violates row-level security policy'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let alerte = ''
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alerte = String(m ?? '') })

    const bouton = await selectionner()
    await act(async () => { bouton.click() })

    expect(alerte).toContain('new row violates row-level security policy')
    // La cause inventée d'avant : un lien qui ne bloque rien, et une table qui n'existe plus.
    expect(alerte).not.toMatch(/pack déjà généré/)
  })
})
