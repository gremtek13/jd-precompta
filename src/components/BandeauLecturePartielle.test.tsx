import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BandeauLecturePartielle from './BandeauLecturePartielle'

// Le bandeau dit ce qui est devenu faux, et il le dit en français correct : une faute d'accord dans
// une alerte la fait passer pour une négligence de l'application — exactement l'air qu'elle ne doit
// pas avoir. Il écrivait « n'ont pas pu être lues » quel que soit le sujet, y compris sous
// « L'historique des échanges » et « Les mouvements bancaires ».
describe('BandeauLecturePartielle', () => {
  it('se tait sur une lecture complète', () => {
    const { container } = render(<BandeauLecturePartielle quoi="Les écritures" motif={null} consequence="Rien." />)
    expect(container.textContent).toBe('')
  })

  it('accorde au féminin pluriel par défaut — la forme d’avant, inchangée', () => {
    render(<BandeauLecturePartielle quoi="Les écritures du brouillon" motif="2 ligne(s) lue(s) sur 3" consequence="Suite." />)
    expect(screen.getByText("Les écritures du brouillon n'ont pas pu être lues en entier (2 ligne(s) lue(s) sur 3). Suite.")).toBeTruthy()
  })

  it('accorde au masculin pluriel, et au singulier avec son auxiliaire', () => {
    render(
      <>
        <BandeauLecturePartielle quoi="Les mouvements bancaires" accord="lus" motif="m" consequence="A." />
        <BandeauLecturePartielle quoi="La liste des sous-dossiers" accord="lue" motif="m" consequence="B." />
        <BandeauLecturePartielle quoi="L’historique des échanges" accord="lu" motif="m" consequence="C." />
      </>,
    )
    expect(screen.getByText("Les mouvements bancaires n'ont pas pu être lus en entier (m). A.")).toBeTruthy()
    expect(screen.getByText("La liste des sous-dossiers n'a pas pu être lue en entier (m). B.")).toBeTruthy()
    expect(screen.getByText("L’historique des échanges n'a pas pu être lu en entier (m). C.")).toBeTruthy()
  })

  it('côté client, accorde « affichés » et garde le motif en infobulle', () => {
    render(<BandeauLecturePartielle quoi="Tes envois" accord="lus" technique={false} motif="2 sur 3" consequence="D." />)
    const bandeau = screen.getByText("Tes envois n'ont pas pu être affichés en entier. D.")
    expect(bandeau.getAttribute('title')).toBe('2 sur 3')
  })
})
