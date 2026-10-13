import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PiecesJointesEcarteesClient from './PiecesJointesEcarteesClient'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { LectureComplete } from '../lib/lectureComplete'
import { ECARTEES_EN_LECTURE } from '../lib/piecesJointesEcarteesClient'
import type { PieceJointeEcarteeDuClient } from '../lib/types'

// LA CARTE DES PIÈCES JOINTES ÉCARTÉES, TELLE QUE LE CLIENT LA VOIT (ligne 22.9) : ses quatre états — l'attente, la
// lecture partielle, le vide lu en entier, la liste —, jamais un nom de fichier, jamais un geste, et les mots du client.
// Ce que la page qui la lit fait de la base (la requête, le drapeau, une société changée) : ClientUpload.ecartees.test.tsx.

const ligne = (o: Partial<PieceJointeEcarteeDuClient> = {}): PieceJointeEcarteeDuClient => ({
  jour: '2026-10-12', raison: 'format', octets: 4120, ...o,
})
const lue = (lignes: PieceJointeEcarteeDuClient[]): LectureComplete<PieceJointeEcarteeDuClient> => ({ lignes, complete: true, motif: null })
// Les blancs ordinaires seulement : `\s` prendrait aussi les espaces insécables, qui tiennent un poids à son unité.
const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ').trim()

describe('la carte du client : l’attente, la lecture partielle, le vide, la liste', () => {
  it('avant la lecture, l’attente seule — ni compte, ni silence', () => {
    render(<PiecesJointesEcarteesClient lecture={null} />)
    const attente = screen.getByText(ECARTEES_EN_LECTURE)
    expect(attente.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('lue en partie ou refusée : le bandeau, dans ses mots, sans compte ni liste', () => {
    render(<PiecesJointesEcarteesClient lecture={{ lignes: [ligne()], complete: false, motif: 'lecture refusée : Accès refusé à ce dossier.' }} />)
    // (L'apostrophe droite de « n'ont » est celle du bandeau partagé, BandeauLecturePartielle.)
    expect(texte()).toBe('Les pièces jointes reçues par e-mail n\'ont pas pu être affichées en entier. Recharge la page : une pièce jointe reçue '
      + 'par e-mail et qui n’a pas pu être déposée peut ne pas être dite ici.')
    // Le motif technique reste en infobulle : un refus de la base ne veut rien dire pour le client.
    expect(screen.getByText(/pas pu être affichées en entier/).getAttribute('title')).toBe('lecture refusée : Accès refusé à ce dossier.')
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('lue en entier et vide : rien', () => {
    const { container } = render(<PiecesJointesEcarteesClient lecture={lue([])} />)
    expect(container.innerHTML).toBe('')
  })

  it('la liste : combien, quand, pourquoi, ce qu’il peut faire — sans nom, sans geste, aux mots du client', () => {
    render(<PiecesJointesEcarteesClient lecture={lue([
      ligne(),
      ligne({ jour: '2026-10-11', raison: 'depot', octets: null }),
      ligne({ jour: '2026-09-30', raison: 'vide', octets: 0 }),
    ])} />)
    expect(screen.getByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })).toBeTruthy()
    expect(screen.getByRole('heading').textContent).toBe('3 pièces jointes reçues par e-mail n’ont pas été déposées')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'le 12/10/2026 — format non pris en charge (4 Ko)',
      'le 11/10/2026 — le dépôt a échoué avant toute lecture de la pièce jointe (poids inconnu)',
      'le 30/09/2026 — arrivée vide (0 octet)',
    ])
    expect(texte()).toContain('Reçues à l’adresse de collecte de ton dossier ces 90 derniers jours ; ton cabinet les voit aussi.')
    expect(texte()).toContain('Celle dont le dépôt a échoué : ce n’est pas de ton fait, renvoie-la telle quelle.')
    expect(texte()).toContain('Celle arrivée vide : vérifie ton fichier (qu’il s’ouvre et ne soit pas vide) avant de le renvoyer.')
    expect(texte()).toContain('Cette liste ne sait pas si tu les as renvoyées depuis : si c’est fait, tu n’as rien à faire.')
    // Rien à cocher ni à marquer : son geste est de renvoyer, plus bas.
    expect(document.querySelectorAll('button, input, select, textarea, a')).toHaveLength(0)
    expect(motsDuCabinet(texte())).toEqual([])
    expect(texte()).not.toMatch(/\bclients?\b/i)
  })

  it('une seule : au singulier, d’un bout à l’autre', () => {
    render(<PiecesJointesEcarteesClient lecture={lue([ligne({ raison: 'taille', octets: 27_000_000 })])} />)
    expect(screen.getByRole('heading').textContent).toBe('1 pièce jointe reçue par e-mail n’a pas été déposée')
    expect(texte()).toContain('Reçue à l’adresse de collecte de ton dossier ces 90 derniers jours ; ton cabinet la voit aussi.')
    expect(texte()).toContain('le 12/10/2026 — au-delà des 20 Mo qu’une pièce peut peser (25,7 Mo)')
    expect(texte()).toContain('Pour qu’elle arrive, renvoie-la en PDF, JPEG, PNG ou CSV, et sous 20 Mo — dans « Déposer des fichiers », '
      + 'ci-dessous, ou par e-mail, à la même adresse.')
    expect(texte()).toContain('Cette liste ne sait pas si tu l’as renvoyée depuis : si c’est fait, tu n’as rien à faire.')
  })

  it('deux pièces jointes d’un même jour, d’une même raison et d’un même poids restent deux lignes', () => {
    render(<PiecesJointesEcarteesClient lecture={lue([ligne(), ligne()])} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
