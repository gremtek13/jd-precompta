import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModulesDuCabinetLus } from '../lib/optionsDuCabinetLecture'

// LES MODULES DU CABINET DU DOSSIER (OPT3-Q1 (A), 19/11/2026) : à l'intérieur d'un dossier, `modules_ouverts_du_dossier`
// remplace les modules du cabinet du compte. Le drapeau baissé, aucune lecture et l'état d'au-dessus tel quel ; levé,
// « lecture » d'abord, la réponse gardée avec l'identifiant du dossier, le côté fermé sur un échec, une seule lecture sous un
// fournisseur qui lit déjà ce dossier, et l'arbre jamais remonté.

const lectures: string[] = []
const enAttente: ((lu: ModulesDuCabinetLus) => void)[] = []
vi.mock('../lib/optionsDuCabinetLecture', () => ({
  lireLesModulesDuDossier: (id: string, prevues: boolean) => {
    lectures.push(`${id}:${String(prevues)}`)
    return new Promise((r) => enAttente.push(r))
  },
}))

const { ModulesDuDossier } = await import('./ModulesDuDossier')
const { ModulesFournis, useModulesOuverts } = await import('./ModulesOuverts')
const { TOUS_LES_MODULES } = await import('../lib/modulesDuCabinet')

let montages = 0
function Sonde() {
  const m = useModulesOuverts()
  // Un état propre : il ne survit qu'à un rendu qui ne remonte pas la sonde.
  const [montage] = useState(() => ++montages)
  return <p data-testid="sonde">{m.etat}:{m.ouverts.join(',')}#{montage}</p>
}
const sonde = () => screen.getByTestId('sonde').textContent

const AU_COMPTE = { etat: 'lus', ouverts: ['facturation'] } as const

beforeEach(() => {
  lectures.length = 0
  enAttente.length = 0
  montages = 0
})
afterEach(cleanup)

describe('le drapeau baissé', () => {
  it('aucune lecture : l’état d’au-dessus tel quel, avec ou sans fournisseur', () => {
    const { rerender } = render(<ModulesDuDossier dossierId="d1" prevues={false}><Sonde /></ModulesDuDossier>)
    expect(sonde()).toBe(`lus:${TOUS_LES_MODULES.join(',')}#1`)
    rerender(<ModulesFournis etat={AU_COMPTE}><ModulesDuDossier dossierId="d2" prevues={false}><Sonde /></ModulesDuDossier></ModulesFournis>)
    expect(sonde()).toMatch(/^lus:facturation#/)
    expect(lectures).toEqual([])
  })
})

describe('le drapeau levé', () => {
  it('hors d’un dossier : les modules du cabinet du compte, sans lecture', () => {
    render(<ModulesFournis etat={AU_COMPTE}><ModulesDuDossier dossierId={null} prevues><Sonde /></ModulesDuDossier></ModulesFournis>)
    expect(sonde()).toBe('lus:facturation#1')
    expect(lectures).toEqual([])
  })

  it('dans un dossier : « lecture », puis les modules DU DOSSIER, pas ceux du compte', async () => {
    render(<ModulesFournis etat={AU_COMPTE}><ModulesDuDossier dossierId="d1" prevues><Sonde /></ModulesDuDossier></ModulesFournis>)
    expect(sonde()).toBe('lecture:#1')
    expect(lectures).toEqual(['d1:true'])
    await act(async () => { enAttente[0]({ etat: 'lus', cle: 'd1', ouverts: ['tenue', 'assistant'] }) })
    expect(sonde()).toBe('lus:tenue,assistant#1')
  })

  it('illisibles : le côté fermé, le socle seul, même quand le compte a tout', async () => {
    render(<ModulesFournis etat={{ etat: 'lus', ouverts: TOUS_LES_MODULES }}><ModulesDuDossier dossierId="d1" prevues><Sonde /></ModulesDuDossier></ModulesFournis>)
    await act(async () => { enAttente[0]({ etat: 'illisibles', cle: 'd1', motif: 'refusé' }) })
    expect(sonde()).toBe('illisibles:#1')
  })

  it('d’un dossier à l’autre : la réponse du dossier quitté, arrivée la dernière, n’écrit rien', async () => {
    const arbre = (id: string) => <ModulesDuDossier dossierId={id} prevues><Sonde /></ModulesDuDossier>
    const { rerender } = render(arbre('d1'))
    rerender(arbre('d2'))
    expect(lectures).toEqual(['d1:true', 'd2:true'])
    expect(sonde()).toBe('lecture:#1')
    await act(async () => { enAttente[1]({ etat: 'lus', cle: 'd2', ouverts: ['facturation'] }) })
    expect(sonde()).toBe('lus:facturation#1')
    await act(async () => { enAttente[0]({ etat: 'lus', cle: 'd1', ouverts: TOUS_LES_MODULES }) })
    expect(sonde()).toBe('lus:facturation#1')
  })

  it('sous un fournisseur qui lit déjà ce dossier : une seule lecture ; un autre dossier se lit', async () => {
    const { rerender } = render(
      <ModulesDuDossier dossierId="d1" prevues><ModulesDuDossier dossierId="d1" prevues><Sonde /></ModulesDuDossier></ModulesDuDossier>,
    )
    expect(lectures).toEqual(['d1:true'])
    await act(async () => { enAttente[0]({ etat: 'lus', cle: 'd1', ouverts: ['tenue'] }) })
    expect(sonde()).toBe('lus:tenue#1')
    rerender(<ModulesDuDossier dossierId="d1" prevues><ModulesDuDossier dossierId="d2" prevues><Sonde /></ModulesDuDossier></ModulesDuDossier>)
    expect(lectures).toEqual(['d1:true', 'd2:true'])
    expect(sonde()).toBe('lecture:#1')
  })

  it('entrer dans un dossier et en sortir ne remonte rien de ce qu’il enveloppe', async () => {
    const arbre = (id: string | null) => (
      <ModulesFournis etat={AU_COMPTE}><ModulesDuDossier dossierId={id} prevues><Sonde /></ModulesDuDossier></ModulesFournis>
    )
    const { rerender } = render(arbre(null))
    rerender(arbre('d1'))
    await act(async () => { enAttente[0]({ etat: 'lus', cle: 'd1', ouverts: ['tenue'] }) })
    rerender(arbre(null))
    expect(sonde()).toBe('lus:facturation#1')
    expect(montages).toBe(1)
  })
})
