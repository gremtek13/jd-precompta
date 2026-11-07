import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ParametresDesCotisationsCard from './ParametresDesCotisationsCard'
import type { LectureDesParametres } from '../../lib/parametresDesCotisations'

// LA SAISIE DES PARAMÈTRES DES COTISATIONS (ligne 27, TNS-Q1 et TNS-Q4). Le calcul est dans lib/voletSocialPamc.ts, éprouvé
// contre le moteur de l'Urssaf ; ce qui se joue ici, aucun test du module ne le voit : une lecture partielle n'offre aucun
// formulaire, l'écriture part par la fonction seule avec les valeurs LUES qu'elle remplace, deux clics n'écrivent qu'une
// fois, un refus se dit avant le clic, l'erreur de la base se dit, et la carte du volet social, le drapeau levé, réclame
// à l'estimation ce qui lui manque.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; parametres: unknown }[],
  erreur: null as null | { message: string; code?: string },
  suspendu: null as null | (() => void),
  lecture: null as unknown,
  ligneVolet: null as unknown,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, parametres: unknown) => {
      faux.appels.push({ nom, parametres })
      return new Promise((resoudre) => {
        const repondre = () => resoudre({ data: faux.erreur ? null : 1, error: faux.erreur })
        if (faux.suspendu !== null) faux.suspendu = repondre
        else repondre()
      })
    },
    from: (table: string) => {
      if (table !== 'volet_social_pamc') throw new Error(`table inattendue : ${table}`)
      const lecture = { select: () => lecture, eq: () => lecture, maybeSingle: () => Promise.resolve({ data: faux.ligneVolet, error: null }) }
      return lecture
    },
  },
}))

// La carte du volet social lit les paramètres par ce module : le drapeau levé, la lecture rendue par le test.
vi.mock('../../lib/parametresDesCotisationsLecture', () => ({
  lireLesParametresDesCotisations: (dossierId: string) => Promise.resolve({ ...(faux.lecture as object), dossierId }),
}))
vi.mock('../../lib/parametresDesCotisations', async (original) => ({
  ...(await original<typeof import('../../lib/parametresDesCotisations')>()),
  PARAMETRES_DES_COTISATIONS_EXPORTES: true,
}))

const lus = (debutActivite: string | null, exercices: [number, { acre: boolean | null; tauxDentiste: number | null }][] = []): LectureDesParametres =>
  ({ dossierId: 'd', etat: 'lus', debutActivite, parExercice: new Map(exercices) })

function afficher(lecture: LectureDesParametres | null, o: { profession?: 'chirurgien_dentiste' | 'auxiliaire_medical' | null; exerciceValide?: boolean } = {}) {
  const onRelire = vi.fn(() => Promise.resolve())
  render(<ParametresDesCotisationsCard dossierId="d" annee={2025} lecture={lecture} profession={o.profession ?? 'auxiliaire_medical'}
    exerciceValide={o.exerciceValide ?? false} onRelire={onRelire} />)
  return onRelire
}

const bouton = () => screen.queryByRole('button', { name: /Enregistrer les paramètres/ })

beforeEach(() => {
  faux.appels = []
  faux.erreur = null
  faux.suspendu = null
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('la carte des paramètres des cotisations', () => {
  it('ne montre rien à écrire avant la lecture, ni sur une lecture partielle', () => {
    afficher(null)
    expect(screen.getByText(/Paramètres des cotisations : chargement/)).toBeTruthy()
    expect(bouton()).toBeNull()
  })

  it('une lecture partielle se dit, et n’offre aucun formulaire', () => {
    afficher({ dossierId: 'd', etat: 'incomplets', motif: 'lecture partielle' })
    expect(screen.getByText(/n’ont pas été lus en entier \(lecture partielle\)/)).toBeTruthy()
    expect(bouton()).toBeNull()
    expect(screen.queryByLabelText('Début d’activité')).toBeNull()
  })

  it('écrit par la fonction seule, contre les valeurs lues, après une confirmation qui nomme ce qui change ; deux clics, un appel', async () => {
    const onRelire = afficher(lus(null))
    expect((bouton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Début d’activité'), { target: { value: '2025-07-01' } })
    fireEvent.change(screen.getByLabelText('ACRE en 2025'), { target: { value: 'oui' } })
    faux.suspendu = () => {}
    await act(async () => {
      fireEvent.click(bouton() as HTMLElement)
      fireEvent.click(bouton() as HTMLElement)
    })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0]).toEqual({
      nom: 'enregistrer_parametres_des_cotisations',
      parametres: {
        p_dossier_id: 'd', p_annee: 2025,
        p_lus: { debut_activite: null, acre: null, taux_dentiste: null },
        p_saisis: { debut_activite: '2025-07-01', acre: true, taux_dentiste: null },
      },
    })
    const question = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(question).toMatch(/Début d’activité : non saisi → 01\/07\/2025/)
    expect(question).toMatch(/ACRE 2025 : non dite → oui/)
    expect(question).not.toMatch(/Taux dentiste/)
    await act(async () => { faux.suspendu?.() })
    expect(onRelire).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Enregistré.')).toBeTruthy()
  })

  it('le taux dentiste d’un chirurgien-dentiste, refusé avant le clic hors de 0 à 1 ou plus fin que le centième', async () => {
    afficher(lus('2015-01-01'), { profession: 'chirurgien_dentiste' })
    for (const taux of ['1,5', '0,355', 'trente']) {
      fireEvent.change(screen.getByLabelText('Taux dentiste 2025 (relevé SNIR)'), { target: { value: taux } })
      expect(screen.getByText(/se saisit entre 0 et 1, au centième/)).toBeTruthy()
      expect((bouton() as HTMLButtonElement).disabled).toBe(true)
    }
    fireEvent.change(screen.getByLabelText('Taux dentiste 2025 (relevé SNIR)'), { target: { value: '0,35' } })
    await act(async () => { fireEvent.click(bouton() as HTMLElement) })
    expect(faux.appels.map((a) => (a.parametres as { p_saisis: unknown }).p_saisis))
      .toEqual([{ debut_activite: '2015-01-01', acre: null, taux_dentiste: 0.35 }])
  })

  it('le taux dentiste ne se demande qu’à un chirurgien-dentiste', () => {
    afficher(lus('2015-01-01'))
    expect(screen.queryByLabelText('Taux dentiste 2025 (relevé SNIR)')).toBeNull()
  })

  it('une confirmation refusée n’écrit rien', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    afficher(lus(null))
    fireEvent.change(screen.getByLabelText('Début d’activité'), { target: { value: '2025-07-01' } })
    await act(async () => { fireEvent.click(bouton() as HTMLElement) })
    expect(faux.appels).toHaveLength(0)
  })

  it('l’erreur de la base se dit, et la relecture a lieu', async () => {
    faux.erreur = { message: 'Les paramètres des cotisations de l’exercice 2025 ont changé depuis leur lecture : relis-les avant de les enregistrer.', code: '40001' }
    const onRelire = afficher(lus(null))
    fireEvent.change(screen.getByLabelText('Début d’activité'), { target: { value: '2025-07-01' } })
    await act(async () => { fireEvent.click(bouton() as HTMLElement) })
    expect(screen.getByText(/ont changé depuis leur lecture/)).toBeTruthy()
    expect(onRelire).toHaveBeenCalledTimes(1)
  })

  it('un exercice validé ne change plus son ACRE, et le dit ; le début d’activité se corrige encore', async () => {
    afficher(lus('2025-07-01', [[2025, { acre: true, tauxDentiste: null }]]), { exerciceValide: true })
    expect((screen.getByLabelText('ACRE en 2025') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Début d’activité'), { target: { value: '2025-06-15' } })
    await act(async () => { fireEvent.click(bouton() as HTMLElement) })
    expect(faux.appels.map((a) => (a.parametres as { p_saisis: unknown }).p_saisis))
      .toEqual([{ debut_activite: '2025-06-15', acre: true, taux_dentiste: null }])
  })
})

describe('la carte du volet social, le drapeau levé', () => {
  const VALEURS = new Map([['AA', 80_000], ['BA', 20_000]])

  async function afficherLeVolet() {
    const { default: VoletSocialCard } = await import('./VoletSocialCard')
    render(<VoletSocialCard dossierId="d" annee={2025} valeurs={VALEURS} blocage={null} />)
    await act(async () => {})
  }

  beforeEach(() => {
    faux.ligneVolet = { id: 'v1', dossier_id: 'd', annee: 2025, profession: 'chirurgien_dentiste', remplacant: false,
      recettes_brutes: null, honoraires_conventionnes: 80_000, depassements: 0, recettes_structures: null }
  })

  it('l’estimation réclame la date de début d’activité tant qu’elle manque', async () => {
    faux.lecture = { etat: 'lus', debutActivite: null, parExercice: new Map() }
    await afficherLeVolet()
    expect(screen.getByText(/Saisissez la date de début d’activité du praticien/)).toBeTruthy()
    expect(screen.getByLabelText('Début d’activité')).toBeTruthy()
  })

  it('puis le taux dentiste, à saisir tant qu’il manque', async () => {
    faux.lecture = { etat: 'lus', debutActivite: '2015-01-01', parExercice: new Map() }
    await afficherLeVolet()
    expect(screen.getByText(/Saisissez le « taux dentiste » du relevé SNIR 2025/)).toBeTruthy()
  })

  it('estime un chirurgien-dentiste dont le taux est saisi', async () => {
    faux.lecture = { etat: 'lus', debutActivite: '2015-01-01', parExercice: new Map([[2025, { acre: null, tauxDentiste: 0.35 }]]) }
    await afficherLeVolet()
    expect(screen.getByText('Total à la charge du praticien')).toBeTruthy()
  })

  it('une lecture partielle des paramètres fait taire l’estimation, et n’offre aucun formulaire', async () => {
    faux.lecture = { etat: 'incomplets', motif: 'lecture partielle' }
    await afficherLeVolet()
    expect(screen.getByText('Les paramètres des cotisations n’ont pas été lus en entier : l’estimation se tait.')).toBeTruthy()
    expect(screen.getByText(/n’ont pas été lus en entier \(lecture partielle\) : rien ne s’écrit/)).toBeTruthy()
    expect(screen.queryByLabelText('Début d’activité')).toBeNull()
    expect(screen.queryByText('Total à la charge du praticien')).toBeNull()
  })
})
