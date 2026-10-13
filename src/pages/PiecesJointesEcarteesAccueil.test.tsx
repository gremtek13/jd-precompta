import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import PiecesJointesEcarteesAccueil from './PiecesJointesEcarteesAccueil'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { LectureComplete } from '../lib/lectureComplete'
import { ACCUEIL_VERIFICATION_IMPOSSIBLE, titreDuSignalement, VOIR_DANS_MES_PIECES } from '../lib/piecesJointesEcarteesClient'
import type { PieceJointeEcarteeDuClient } from '../lib/types'

// LA LIGNE DE L'ACCUEIL DU CLIENT SUR LES PIÈCES JOINTES ÉCARTÉES (ligne 22.94), ses quatre états : pas revenue, vide lu en
// entier, la liste, lecture manquée. Ni raison, ni jour, ni poids, ni adresse : la carte de « Mes pièces » les dit. Ce que
// l'accueil fait de la base (la requête, le drapeau, une société changée) : ClientHome.ecartees.test.tsx.

const ligne = (o: Partial<PieceJointeEcarteeDuClient> = {}): PieceJointeEcarteeDuClient => ({
  jour: '2026-10-12', raison: 'format', octets: 4120, ...o,
})
const lue = (lignes: PieceJointeEcarteeDuClient[]): LectureComplete<PieceJointeEcarteeDuClient> => ({ lignes, complete: true, motif: null })
const manquee = (motif: string): LectureComplete<PieceJointeEcarteeDuClient> => ({ lignes: [], complete: false, motif })
const monter = (lecture: LectureComplete<PieceJointeEcarteeDuClient> | null) =>
  render(<MemoryRouter><PiecesJointesEcarteesAccueil lecture={lecture} /></MemoryRouter>)
const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ').trim()

describe('la ligne de l’accueil : pas revenue, vide, la liste, lecture manquée', () => {
  it('pas revenue : rien — aucune affirmation, pas même une attente', () => {
    const { container } = monter(null)
    expect(container.innerHTML).toBe('')
  })

  it('lue en entier et vide : rien — pas de « aucune »', () => {
    const { container } = monter(lue([]))
    expect(container.innerHTML).toBe('')
  })

  it('une pièce jointe : la phrase PARTAGÉE au singulier, et le renvoi vers « Mes pièces »', () => {
    monter(lue([ligne()]))
    const bloc = screen.getByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    expect(bloc.textContent).toContain('1 pièce jointe reçue par e-mail n’a pas été déposée')
    expect(bloc.textContent).toContain(titreDuSignalement(1))
    const lien = screen.getByRole('link', { name: VOIR_DANS_MES_PIECES })
    expect(lien.getAttribute('href')).toBe('/mes-pieces')
    // La pastille d'attention est décorative : le statut se lit au texte.
    expect(bloc.querySelector('.check-dot.check-attention')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('plusieurs : le compte, au pluriel — jamais la raison, le jour, le poids ni un nom', () => {
    monter(lue([ligne(), ligne({ jour: '2026-10-11', raison: 'depot', octets: null }), ligne({ jour: '2026-09-30', raison: 'vide', octets: 0 })]))
    // (Le bouton suit la phrase dans la rangée : les deux textes se touchent dans `textContent`.)
    expect(texte()).toBe(`${titreDuSignalement(3)}${VOIR_DANS_MES_PIECES}`)
    expect(texte()).toBe('3 pièces jointes reçues par e-mail n’ont pas été déposéesVoir dans « Mes pièces »')
    expect(texte()).not.toMatch(/format|poids|vide|échoué|\d{2}\/\d{2}|\bKo\b|@/i)
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('lecture partielle, refusée ou illisible : une ligne DISCRÈTE qui dit que la vérification n’a pas pu se faire — jamais le silence', () => {
    monter(manquee('lecture refusée : Accès refusé à ce dossier.'))
    const bloc = screen.getByRole('region', { name: 'Vérification des pièces jointes reçues par e-mail' })
    expect(bloc.className).toContain('client-signalement-discret')
    expect(texte()).toBe(`${ACCUEIL_VERIFICATION_IMPOSSIBLE}${VOIR_DANS_MES_PIECES}`)
    // Pas de compte, pas de pastille d'attention : rien n'est affirmé de ce qui n'a pas été lu. Le motif reste en infobulle.
    expect(texte()).not.toMatch(/\d/)
    expect(bloc.querySelector('.check-dot')).toBeNull()
    expect(screen.getByText(ACCUEIL_VERIFICATION_IMPOSSIBLE).getAttribute('title')).toBe('lecture refusée : Accès refusé à ce dossier.')
    expect(screen.getByRole('link', { name: VOIR_DANS_MES_PIECES }).getAttribute('href')).toBe('/mes-pieces')
  })

  it('une lecture manquée qui porterait des lignes n’en compte aucune', () => {
    monter({ lignes: [ligne(), ligne()], complete: false, motif: 'réponse illisible' })
    expect(texte()).not.toMatch(/\d/)
    expect(screen.queryByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })).toBeNull()
  })

  it('aux mots du client : tutoiement, aucun onglet, jamais « le client »', () => {
    for (const lecture of [lue([ligne()]), lue([ligne(), ligne()]), manquee('réponse illisible')]) {
      const { unmount } = monter(lecture)
      expect(motsDuCabinet(texte())).toEqual([])
      expect(texte()).not.toMatch(/\bclients?\b/i)
      unmount()
    }
  })
})
