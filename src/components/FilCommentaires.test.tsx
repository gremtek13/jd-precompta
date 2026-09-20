import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FilCommentaires from './FilCommentaires'
import type { PieceCommentaire } from '../lib/types'

// LE SEUL GESTE DESTRUCTEUR DU FIL, et le seul qu'aucun test de `src/lib` ne peut voir :
// `supprimerCommentaire` est juste — elle rend le message d'erreur de Postgres — c'est ce que
// l'ÉCRAN en fait qui décide. Trois choses se jouent ici, et chacune a déjà coûté ailleurs dans ce
// projet :
//
//   1. **Qui voit le bouton.** La policy `piece_commentaires_delete` n'ouvre la suppression qu'au
//      cabinet. Un bouton offert au client serait refusé par la base à chaque clic : un bouton qui
//      échoue toujours est pire que pas de bouton.
//   2. **Ce que l'échec devient.** Une suppression muette laisse la ligne en place sans un mot, et
//      le réflexe — recliquer — rend le même silence. C'est mot pour mot le défaut de
//      `SuperPdpModal.retirer()`, relevé au balayage du 20/09/2026.
//   3. **Ce que le parent apprend.** L'écran qui détient la liste affiche la dernière précision sur
//      la ligne d'arbitrage. Prévenu d'une suppression qui a ÉCHOUÉ, il ferait disparaître de
//      l'écran un commentaire toujours en base.
const faux = vi.hoisted(() => ({
  suppressions: [] as string[],
  echec: null as string | null,
}))

vi.mock('../lib/commentaires', () => ({
  ajouterCommentaire: async () => ({ ok: false, message: 'hors sujet ici' }),
  supprimerCommentaire: async (id: string) => {
    faux.suppressions.push(id)
    return faux.echec
  },
}))

function commentaire(o: Partial<PieceCommentaire> = {}): PieceCommentaire {
  return {
    id: 'c1',
    dossier_id: 'dossier-de-test',
    piece_id: 'p1',
    document_id: null,
    auteur_id: 'u1',
    origine: 'client',
    texte: 'Four de la salle d’attente.',
    created_at: '2026-09-18T09:00:00Z',
    ...o,
  } as PieceCommentaire
}

const DEUX = [
  commentaire({ id: 'c1', texte: 'Four de la salle d’attente.' }),
  commentaire({ id: 'c2', origine: 'cabinet', texte: 'Appelé le client, il confirme.' }),
]

let confirme = true

beforeEach(() => {
  faux.suppressions = []
  faux.echec = null
  confirme = true
  vi.stubGlobal('confirm', () => confirme)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('FilCommentaires — retrait d’un commentaire', () => {
  it('le client ne peut pas retirer : aucun bouton, alors que le fil est bien affiché', () => {
    // L'ancre est le TEXTE du commentaire : sans elle, un composant qui n'aurait rien rendu du tout
    // ferait passer ce test pour une raison fausse (le piège déjà nommé pour ChecklistTab).
    render(
      <FilCommentaires
        dossierId="dossier-de-test"
        cible={{ type: 'piece', id: 'p1' }}
        commentaires={DEUX}
        estCabinet={false}
        onAjout={() => {}}
      />,
    )
    expect(screen.getByText('Four de la salle d’attente.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Retirer' })).toHaveLength(0)
  })

  it('le cabinet retire CE commentaire-là, et le parent en est prévenu', async () => {
    const prevenu: string[] = []
    render(
      <FilCommentaires
        dossierId="dossier-de-test"
        cible={{ type: 'piece', id: 'p1' }}
        commentaires={DEUX}
        estCabinet
        onAjout={() => {}}
        onSuppression={(id) => prevenu.push(id)}
      />,
    )
    const boutons = screen.getAllByRole('button', { name: 'Retirer' })
    expect(boutons).toHaveLength(2)

    // Le SECOND, pas le premier : un câblage qui retirerait toujours la première ligne du fil
    // passerait un test posé sur un commentaire unique.
    await act(async () => { boutons[1].click() })

    expect(faux.suppressions).toEqual(['c2'])
    expect(prevenu).toEqual(['c2'])
  })

  it('un refus de la base se dit, et le parent n’est PAS prévenu', async () => {
    faux.echec = 'new row violates row-level security policy'
    const prevenu: string[] = []
    render(
      <FilCommentaires
        dossierId="dossier-de-test"
        cible={{ type: 'piece', id: 'p1' }}
        commentaires={DEUX}
        estCabinet
        onAjout={() => {}}
        onSuppression={(id) => prevenu.push(id)}
      />,
    )
    await act(async () => { screen.getAllByRole('button', { name: 'Retirer' })[0].click() })

    // La RAISON rendue par Postgres doit arriver jusqu'à l'écran, pas un « échec » générique :
    // c'est elle qui distingue un refus de droits d'une panne réseau.
    expect(screen.getByText(/pas été retiré/)).toBeTruthy()
    expect(screen.getByText(/row-level security policy/)).toBeTruthy()
    // Le plus important des deux : prévenu, le parent retirerait de l'écran un commentaire qui est
    // toujours en base — et personne ne le saurait avant le prochain rechargement.
    expect(prevenu).toEqual([])
  })

  it('une confirmation refusée n’appelle rien du tout', async () => {
    confirme = false
    const prevenu: string[] = []
    render(
      <FilCommentaires
        dossierId="dossier-de-test"
        cible={{ type: 'piece', id: 'p1' }}
        commentaires={DEUX}
        estCabinet
        onAjout={() => {}}
        onSuppression={(id) => prevenu.push(id)}
      />,
    )
    await act(async () => { screen.getAllByRole('button', { name: 'Retirer' })[0].click() })

    expect(faux.suppressions).toEqual([])
    expect(prevenu).toEqual([])
  })
})
