import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlerteHausseDuChiffreDAffaires from './AlerteHausseDuChiffreDAffaires'
import {
  ILLISIBLE_DANS_LA_VUE, LIBELLE_MARQUER_VUE, NOM_DE_L_ALERTE, TITRE_DE_L_ALERTE, TITRE_DE_L_ALERTE_DE_BAISSE, type HausseDuChiffreDAffaires,
  type LectureDeLaHausse, type Trimestre,
} from '../../lib/hausseDuChiffreDAffaires'

// L'ALERTE DU CHIFFRE D'AFFAIRES DANS LA VUE D'ENSEMBLE, À L'ÉCRAN. Ce que le module ne voit pas : le silence avant la lecture, le
// drapeau dans ses deux états, une ligne discrète sur une lecture ratée (sans geste), la confirmation AVANT l'écriture, une seule
// marque pour deux clics du même rendu, la relecture qui tait l'alerte, un refus dit ; une baisse sous son titre. La lecture et
// l'écriture sont doublées. Données FICTIVES.
const faux = vi.hoisted(() => ({
  prevue: true,
  lectures: [] as LectureDeLaHausse[],
  lues: 0,
  marques: [] as { dossierId: string; trimestre: Trimestre }[],
  porteMarque: null as Promise<void> | null,
  refus: null as string | null,
}))

vi.mock('../../lib/hausseDuChiffreDAffaires', async (original) => {
  const vrai = await original<typeof import('../../lib/hausseDuChiffreDAffaires')>()
  return { ...vrai, get HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE() { return faux.prevue } }
})

vi.mock('../../lib/hausseDuChiffreDAffairesLecture', () => ({
  lireLaHausseDuDossier: async (dossier: { id: string }) => {
    const lecture = faux.lectures[Math.min(faux.lues, faux.lectures.length - 1)]
    faux.lues += 1
    return { dossierId: dossier.id, reglage: { dossierId: dossier.id, etat: 'lu', seuil: null, vues: [] }, lecture }
  },
  marquerLaHausseVue: async (dossierId: string, trimestre: Trimestre) => {
    faux.marques.push({ dossierId, trimestre })
    await faux.porteMarque
    return faux.refus ? { ok: false, erreur: faux.refus } : { ok: true }
  },
}))

const T3: Trimestre = { annee: 2026, trimestre: 3 }
const comparee = (centimes: number, precedentCentimes: number, dixiemes: number, franchit: 'hausse' | 'baisse' | null, debut: string) => ({
  etat: 'comparee' as const,
  comparaison: {
    debut, fin: '2026-09-30', debutPrecedent: debut.replace('2026', '2025'), finPrecedent: '2025-09-30', centimes, precedentCentimes,
    variationDixiemes: dixiemes, franchit,
  },
})
const hausse: HausseDuChiffreDAffaires = {
  etat: 'jugee', trimestre: T3, seuils: { hausse: 20, baisse: null }, hausse: true, baisse: false, vue: null,
  duTrimestre: comparee(3_750_000, 3_000_000, 250, 'hausse', '2026-07-01'),
  duCumul: comparee(9_750_000, 9_000_000, 83, null, '2026-01-01'),
  surDouzeMois: { etat: 'non_comparable', raison: 'releve_manquant', mois: ['2024-10', '2024-11', '2024-12'] },
}
const baisse: HausseDuChiffreDAffaires = {
  etat: 'jugee', trimestre: T3, seuils: { hausse: null, baisse: 20 }, hausse: false, baisse: true, vue: null,
  duTrimestre: comparee(2_250_000, 3_000_000, -250, 'baisse', '2026-07-01'),
  duCumul: comparee(8_250_000, 9_000_000, -83, null, '2026-01-01'),
  surDouzeMois: comparee(11_250_000, 12_000_000, -63, null, '2025-10-01'),
}
const vue: HausseDuChiffreDAffaires = { ...hausse, vue: { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u', vue_le: '2026-11-16T09:00:00Z' } }
const DOSSIER = { id: 'd1', assujetti_tva: false, mode_comptable: 'tresorerie' as const }

beforeEach(() => {
  faux.prevue = true
  faux.lectures = [{ etat: 'lue', hausse }]
  faux.lues = 0
  faux.marques = []
  faux.porteMarque = null
  faux.refus = null
})
afterEach(() => { vi.restoreAllMocks() })

describe('l’alerte de la Vue d’ensemble', () => {
  it('drapeau baissé : rien, et rien de lu', async () => {
    faux.prevue = false
    const { container } = render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    await act(async () => {})
    expect(container.textContent).toBe('')
    expect(faux.lues).toBe(0)
  })

  it('rien avant la lecture ; puis le constat, les deux chiffres et le seuil, et le seul geste', async () => {
    const { container } = render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    expect(container.textContent).toBe('')
    expect(await screen.findByText(TITRE_DE_L_ALERTE)).toBeTruthy()
    expect(container.textContent).toContain('3e trimestre 2026 (juillet à septembre)')
    expect(container.textContent).toContain('Les douze mois glissants ne se comparent pas')
    expect(container.textContent).toContain('Le seuil de hausse de ce dossier est de 20')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([LIBELLE_MARQUER_VUE])
  })

  it('une baisse se dit sous son titre, avec ses chiffres, son seuil et le même geste', async () => {
    faux.lectures = [{ etat: 'lue', hausse: baisse }]
    const { container } = render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    expect(await screen.findByText(TITRE_DE_L_ALERTE_DE_BAISSE)).toBeTruthy()
    expect(screen.queryByText(TITRE_DE_L_ALERTE)).toBeNull()
    expect(container.textContent).toContain('Sur douze mois, d’octobre 2025 à septembre 2026')
    expect(container.textContent).toContain('Le seuil de baisse de ce dossier est de 20')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([LIBELLE_MARQUER_VUE])
  })

  it('une lecture ratée : une ligne discrète, aucun geste', async () => {
    faux.lectures = [{ etat: 'illisible', motif: 'coupée' }]
    render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    expect(await screen.findByText(ILLISIBLE_DANS_LA_VUE)).toBeTruthy()
    expect(screen.getByRole('region', { name: NOM_DE_L_ALERTE })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('la confirmation refusée n’écrit rien', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    // Cherché HORS de l'`act` : dedans, le rendu qui le fait paraître attendrait la fin de l'`act`.
    const bouton = await screen.findByRole('button', { name: LIBELLE_MARQUER_VUE })
    await act(async () => { fireEvent.click(bouton) })
    expect(faux.marques).toEqual([])
  })

  it('deux clics du même rendu : une seule marque, du trimestre jugé ; la relecture tait l’alerte', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.lectures = [{ etat: 'lue', hausse }, { etat: 'lue', hausse: vue }]
    const { container } = render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    const bouton = await screen.findByRole('button', { name: LIBELLE_MARQUER_VUE })
    let ouvrir!: () => void
    faux.porteMarque = new Promise<void>((r) => { ouvrir = r })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await act(async () => { ouvrir() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(confirmation.mock.calls[0][0]).toContain('3e trimestre 2026 (juillet à septembre)')
    expect(faux.marques).toEqual([{ dossierId: 'd1', trimestre: T3 }])
    await act(async () => {})
    expect(container.textContent).toBe('')
  })

  it('un refus de la base se dit, et l’alerte reste', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refus = 'Ce trimestre est déjà marqué vu avec le client.'
    render(<AlerteHausseDuChiffreDAffaires dossier={DOSSIER} />)
    const bouton = await screen.findByRole('button', { name: LIBELLE_MARQUER_VUE })
    await act(async () => { fireEvent.click(bouton) })
    expect(await screen.findByText(faux.refus)).toBeTruthy()
    expect(screen.getByText(TITRE_DE_L_ALERTE)).toBeTruthy()
  })
})
