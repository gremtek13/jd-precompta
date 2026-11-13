import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ParametresDesCotisationsCard from './ParametresDesCotisationsCard'
import type { LectureDesParametres } from '../../lib/parametresDesCotisations'

// LES DEUX CASES D'UN MÉDECIN DANS LA CARTE DES PARAMÈTRES (RET-Q2), `CASES_DU_MEDECIN_PREVUES` levé par l'accesseur : offertes
// à un médecin, enregistrées sous la forme à cinq clés — les valeurs lues et les saisies de même forme, que la fonction
// exige —, nommées dans la confirmation ; baissé (l'état servi), ParametresDesCotisationsCard.test.tsx joue la carte d'hier.
const faux = vi.hoisted(() => ({ appels: [] as { nom: string; parametres: unknown }[], cases: true }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, parametres: unknown) => {
      faux.appels.push({ nom, parametres })
      return Promise.resolve({ data: 1, error: null })
    },
  },
}))
vi.mock('../../lib/parametresDesCotisations', async (original) => ({
  ...(await original<typeof import('../../lib/parametresDesCotisations')>()),
  PARAMETRES_DES_COTISATIONS_EXPORTES: true,
  get CASES_DU_MEDECIN_PREVUES() { return faux.cases },
}))

const lus = (cases: { cumulEmploiRetraite: boolean | null; dispenseComplementaire: boolean | null }): LectureDesParametres =>
  ({ dossierId: 'd', etat: 'lus', debutActivite: '2024-11-15', parExercice: new Map([[2025, { acre: false, tauxDentiste: null, medecin: cases }]]) })

function afficher(profession: 'medecin_secteur_1' | 'auxiliaire_medical') {
  render(<ParametresDesCotisationsCard dossierId="d" annee={2025} lecture={lus({ cumulEmploiRetraite: null, dispenseComplementaire: null })}
    profession={profession} exerciceValide={false} onRelire={() => Promise.resolve()} />)
}
const bouton = () => screen.getByRole('button', { name: /Enregistrer les paramètres/ }) as HTMLButtonElement

beforeEach(() => {
  faux.appels = []
  faux.cases = true
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('les deux cases d’un médecin dans la carte des paramètres (RET-Q2)', () => {
  it('un médecin les voit, et les enregistre sous cinq clés, contre les valeurs lues ; la confirmation les nomme', async () => {
    afficher('medecin_secteur_1')
    fireEvent.change(screen.getByLabelText('Cumul emploi-retraite en 2025'), { target: { value: 'non' } })
    fireEvent.change(screen.getByLabelText('Dispense du complémentaire CARMF en 2025'), { target: { value: 'oui' } })
    await act(async () => { fireEvent.click(bouton()) })
    expect(faux.appels).toEqual([{
      nom: 'enregistrer_parametres_des_cotisations',
      parametres: {
        p_dossier_id: 'd', p_annee: 2025,
        p_lus: { debut_activite: '2024-11-15', acre: false, taux_dentiste: null, cumul_emploi_retraite: null, dispense_complementaire: null },
        p_saisis: { debut_activite: '2024-11-15', acre: false, taux_dentiste: null, cumul_emploi_retraite: false, dispense_complementaire: true },
      },
    }])
    const question = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(question).toMatch(/Cumul emploi-retraite 2025 : non dit → non/)
    expect(question).toMatch(/Dispense du complémentaire CARMF 2025 : non dit → oui/)
  })

  it('une autre profession ne les voit pas, et part tout de même sous cinq clés, les cases inchangées', async () => {
    afficher('auxiliaire_medical')
    expect(screen.queryByLabelText('Cumul emploi-retraite en 2025')).toBeNull()
    fireEvent.change(screen.getByLabelText('ACRE en 2025'), { target: { value: 'oui' } })
    await act(async () => { fireEvent.click(bouton()) })
    const parametres = faux.appels[0]?.parametres as { p_saisis: Record<string, unknown> }
    expect(parametres.p_saisis).toEqual({ debut_activite: '2024-11-15', acre: true, taux_dentiste: null, cumul_emploi_retraite: null, dispense_complementaire: null })
  })

  it('drapeau baissé : ni les cases, ni les deux clés de plus', async () => {
    faux.cases = false
    afficher('medecin_secteur_1')
    expect(screen.queryByLabelText('Cumul emploi-retraite en 2025')).toBeNull()
    fireEvent.change(screen.getByLabelText('ACRE en 2025'), { target: { value: 'oui' } })
    await act(async () => { fireEvent.click(bouton()) })
    const parametres = faux.appels[0]?.parametres as { p_lus: Record<string, unknown>; p_saisis: Record<string, unknown> }
    expect(Object.keys(parametres.p_lus).sort()).toEqual(['acre', 'debut_activite', 'taux_dentiste'])
    expect(Object.keys(parametres.p_saisis).sort()).toEqual(['acre', 'debut_activite', 'taux_dentiste'])
  })
})
