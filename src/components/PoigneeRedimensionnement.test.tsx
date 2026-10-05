import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PoigneeRedimensionnement from './PoigneeRedimensionnement'

// Le bord d'un volet qu'on glisse (voir lib/largeurVolets.ts pour les bornes, Layout pour ce qui retient). Ce qu'il
// promet : la largeur suit le pointeur dans le bon sens et sans sortir des bornes, elle ne se retient qu'à la fin d'un
// geste qui a déplacé le bord — un clic n'écrit pas une préférence —, et le clavier fait ce que fait la souris.

function monter({ sens = 1 as 1 | -1, largeur = 300, min = 200, max = 420 } = {}) {
  const appels = { largeur: vi.fn(), retenir: vi.fn(), origine: vi.fn(), glisse: vi.fn() }
  render(
    <PoigneeRedimensionnement
      libelle="Largeur du volet"
      controle="volet"
      sens={sens}
      largeur={largeur}
      bornes={{ min, max }}
      onLargeur={appels.largeur}
      onRetenir={appels.retenir}
      onOrigine={appels.origine}
      onGlisse={appels.glisse}
    />,
  )
  return { poignee: screen.getByRole('separator', { name: 'Largeur du volet' }), ...appels }
}

const glisser = (poignee: HTMLElement, de: number, positions: number[], pointerId = 1) => {
  fireEvent.pointerDown(poignee, { clientX: de, pointerId, button: 0 })
  for (const x of positions) fireEvent.pointerMove(poignee, { clientX: x, pointerId })
  fireEvent.pointerUp(poignee, { clientX: positions.at(-1) ?? de, pointerId })
}

describe('Le bord d’un volet', () => {
  it('se présente comme un séparateur qu’on atteint au clavier, avec sa largeur et ses bornes', () => {
    const { poignee } = monter()
    expect(poignee.getAttribute('aria-orientation')).toBe('vertical')
    expect(poignee.getAttribute('aria-controls')).toBe('volet')
    expect(poignee.getAttribute('aria-valuenow')).toBe('300')
    expect(poignee.getAttribute('aria-valuemin')).toBe('200')
    expect(poignee.getAttribute('aria-valuemax')).toBe('420')
    expect(poignee.tabIndex).toBe(0)
  })

  it('la barre de gauche suit le pointeur vers la droite, et sa largeur se retient quand on lâche', () => {
    const { poignee, largeur, retenir, glisse } = monter({ sens: 1 })
    glisser(poignee, 100, [120, 150])
    expect(largeur.mock.calls.map((c) => c[0])).toEqual([320, 350])
    expect(retenir).toHaveBeenCalledTimes(1)
    expect(retenir).toHaveBeenCalledWith(350)
    expect(glisse.mock.calls.map((c) => c[0])).toEqual([true, false])
  })

  it('le volet de droite s’élargit quand on tire vers la gauche', () => {
    const { poignee, largeur, retenir } = monter({ sens: -1 })
    glisser(poignee, 500, [470])
    expect(largeur).toHaveBeenLastCalledWith(330)
    expect(retenir).toHaveBeenCalledWith(330)
  })

  it('ne sort pas de ses bornes, et ne redit pas une largeur qu’il vient de dire', () => {
    const { poignee, largeur, retenir } = monter({ sens: 1 })
    glisser(poignee, 100, [400, 500, 900, -400])
    expect(largeur.mock.calls.map((c) => c[0])).toEqual([420, 200])
    expect(retenir).toHaveBeenCalledWith(200)
  })

  it('un clic sans déplacement ne retient rien : la largeur d’origine reste celle d’origine', () => {
    const { poignee, largeur, retenir } = monter()
    glisser(poignee, 100, [100])
    expect(largeur).not.toHaveBeenCalled()
    expect(retenir).not.toHaveBeenCalled()
  })

  it('un aller-retour qui ramène le bord où il était ne retient rien non plus', () => {
    const { poignee, largeur, retenir } = monter()
    glisser(poignee, 100, [140, 100])
    expect(largeur.mock.calls.map((c) => c[0])).toEqual([340, 300])
    expect(retenir).not.toHaveBeenCalled()
  })

  it('n’écoute que le pointeur qui l’a saisi, et pas le bouton droit', () => {
    const { poignee, largeur, retenir } = monter()
    fireEvent.pointerDown(poignee, { clientX: 100, pointerId: 1, button: 0 })
    fireEvent.pointerMove(poignee, { clientX: 180, pointerId: 2 })
    fireEvent.pointerUp(poignee, { clientX: 180, pointerId: 2 })
    expect(largeur).not.toHaveBeenCalled()
    fireEvent.pointerUp(poignee, { clientX: 100, pointerId: 1 })

    fireEvent.pointerDown(poignee, { clientX: 100, pointerId: 3, button: 2 })
    fireEvent.pointerMove(poignee, { clientX: 180, pointerId: 3 })
    expect(largeur).not.toHaveBeenCalled()
    expect(retenir).not.toHaveBeenCalled()
  })

  it('un geste interrompu par le navigateur retient ce qui a été fait', () => {
    const { poignee, retenir, glisse } = monter()
    fireEvent.pointerDown(poignee, { clientX: 100, pointerId: 1, button: 0 })
    fireEvent.pointerMove(poignee, { clientX: 130, pointerId: 1 })
    fireEvent.pointerCancel(poignee, { pointerId: 1 })
    expect(retenir).toHaveBeenCalledWith(330)
    expect(glisse).toHaveBeenLastCalledWith(false)
  })

  it('au clavier, les flèches déplacent le bord — dans le sens du volet —, Début et Fin vont aux bornes', () => {
    const barre = monter({ sens: 1 })
    fireEvent.keyDown(barre.poignee, { key: 'ArrowRight' })
    expect(barre.largeur).toHaveBeenLastCalledWith(316)
    expect(barre.retenir).toHaveBeenLastCalledWith(316)
    fireEvent.keyDown(barre.poignee, { key: 'ArrowLeft', shiftKey: true })
    expect(barre.largeur).toHaveBeenLastCalledWith(236)
    fireEvent.keyDown(barre.poignee, { key: 'Home' })
    expect(barre.largeur).toHaveBeenLastCalledWith(200)
    fireEvent.keyDown(barre.poignee, { key: 'End' })
    expect(barre.largeur).toHaveBeenLastCalledWith(420)
  })

  it('le volet de droite s’élargit à la flèche gauche', () => {
    const { poignee, largeur } = monter({ sens: -1 })
    fireEvent.keyDown(poignee, { key: 'ArrowLeft' })
    expect(largeur).toHaveBeenLastCalledWith(316)
    fireEvent.keyDown(poignee, { key: 'ArrowRight', shiftKey: true })
    expect(largeur).toHaveBeenLastCalledWith(236)
  })

  it('à sa borne, une flèche de plus ne retient rien', () => {
    const { poignee, largeur, retenir } = monter({ largeur: 420 })
    fireEvent.keyDown(poignee, { key: 'ArrowRight' })
    fireEvent.keyDown(poignee, { key: 'End' })
    expect(largeur).not.toHaveBeenCalled()
    expect(retenir).not.toHaveBeenCalled()
  })

  it('Entrée et le double-clic rendent la largeur d’origine', () => {
    const { poignee, origine, largeur } = monter()
    fireEvent.keyDown(poignee, { key: 'Enter' })
    fireEvent.doubleClick(poignee)
    expect(origine).toHaveBeenCalledTimes(2)
    expect(largeur).not.toHaveBeenCalled()
  })

  it('les autres touches ne font rien', () => {
    const { poignee, largeur, origine } = monter()
    fireEvent.keyDown(poignee, { key: 'ArrowUp' })
    fireEvent.keyDown(poignee, { key: 'a' })
    expect(largeur).not.toHaveBeenCalled()
    expect(origine).not.toHaveBeenCalled()
  })
})
