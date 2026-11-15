import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HausseDuChiffreDAffairesCard from './HausseDuChiffreDAffairesCard'
import { REGLAGE_ILLISIBLE, SEUIL_HORS_BORNES, SEUIL_VIDE } from '../../lib/hausseDuChiffreDAffaires'
import type { LectureDuReglage } from '../../lib/hausseDuChiffreDAffairesLecture'

// LA CARTE DU SEUIL DE L'ALERTE DE HAUSSE, À L'ÉCRAN (onglet Informations). Ce que le module ne voit pas : rien avant la lecture,
// aucun formulaire sur une lecture ratée, le drapeau dans ses deux états, le refus dit avant le clic, une seule écriture pour
// deux clics du même rendu, contre la valeur LUE, puis relue. La lecture et l'écriture sont doublées. Données FICTIVES.
const faux = vi.hoisted(() => ({
  prevue: true,
  lectures: {} as Record<string, LectureDuReglage>,
  lues: [] as string[],
  ecritures: [] as { dossierId: string; lu: number | null; seuil: number | null }[],
  porteEcriture: null as Promise<void> | null,
  refus: null as string | null,
}))

vi.mock('../../lib/hausseDuChiffreDAffaires', async (original) => {
  const vrai = await original<typeof import('../../lib/hausseDuChiffreDAffaires')>()
  return { ...vrai, get HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE() { return faux.prevue } }
})

vi.mock('../../lib/hausseDuChiffreDAffairesLecture', () => ({
  lireLeReglageDeLaHausse: async (dossierId: string) => {
    faux.lues.push(dossierId)
    return faux.lectures[dossierId]
  },
  reglerLeSeuilDeLaHausse: async (dossierId: string, lu: number | null, seuil: number | null) => {
    faux.ecritures.push({ dossierId, lu, seuil })
    await faux.porteEcriture
    if (faux.refus) return { ok: false, erreur: faux.refus }
    faux.lectures[dossierId] = lu$(dossierId, seuil)
    return { ok: true, seuil }
  },
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'u-chef' } } }) }))

function lu$(dossierId: string, seuil: number | null): LectureDuReglage {
  return {
    dossierId, etat: 'lu', vues: [],
    seuil: { dossier_id: dossierId, seuil_de_hausse: seuil, regle_par: 'u-chef', regle_le: '2026-11-15T10:00:00Z' },
  }
}

beforeEach(() => {
  faux.prevue = true
  faux.lectures = {}
  faux.lues = []
  faux.ecritures = []
  faux.porteEcriture = null
  faux.refus = null
})

describe('la carte du seuil', () => {
  it('drapeau baissé : rien, et rien de lu', async () => {
    faux.prevue = false
    const { container } = render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    await act(async () => {})
    expect(container.textContent).toBe('')
    expect(faux.lues).toEqual([])
  })

  it('« Chargement… » avant la lecture ; une lecture ratée n’offre aucun formulaire', async () => {
    faux.lectures.d1 = { dossierId: 'd1', etat: 'illisible', motif: 'coupée' }
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(await screen.findByText(REGLAGE_ILLISIBLE)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('sans seuil, le dit ; le refus se dit avant le clic et retient le bouton', async () => {
    faux.lectures.d1 = { dossierId: 'd1', etat: 'lu', seuil: null, vues: [] }
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    expect(await screen.findByText(SEUIL_VIDE)).toBeTruthy()
    const bouton = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '0' } })
    expect(screen.getByText(SEUIL_HORS_BORNES)).toBeTruthy()
    expect(bouton.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '20' } })
    expect(screen.queryByText(SEUIL_HORS_BORNES)).toBeNull()
    expect(bouton.disabled).toBe(false)
  })

  it('deux clics du même rendu : une seule écriture, contre la valeur lue ; puis relue', async () => {
    faux.lectures.d1 = lu$('d1', 15)
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    const champ = await screen.findByDisplayValue('15')
    fireEvent.change(champ, { target: { value: '25' } })
    let ouvrir!: () => void
    faux.porteEcriture = new Promise<void>((r) => { ouvrir = r })
    const bouton = screen.getByRole('button', { name: 'Enregistrer' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await act(async () => { ouvrir() })
    expect(faux.ecritures).toEqual([{ dossierId: 'd1', lu: 15, seuil: 25 }])
    expect(await screen.findByText('Seuil enregistré : 25 % ✓')).toBeTruthy()
    expect(faux.lues.filter((d) => d === 'd1')).toHaveLength(2)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('25')
  })

  it('un refus de la base se dit, et la valeur relue reste', async () => {
    faux.lectures.d1 = lu$('d1', 15)
    faux.refus = 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l\'enregistrer.'
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    fireEvent.change(await screen.findByDisplayValue('15'), { target: { value: '30' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })) })
    expect(await screen.findByText(faux.refus)).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('15')
  })
})
