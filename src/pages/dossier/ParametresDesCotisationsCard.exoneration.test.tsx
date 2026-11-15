import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ParametresDesCotisationsCard from './ParametresDesCotisationsCard'
import type { CasesDuMedecin, LectureDesParametres } from '../../lib/parametresDesCotisations'

// L'EXONÉRATION DE 2025 EN ZONE D'INTERVENTION PRIORITAIRE DANS LA CARTE DES PARAMÈTRES (RET2-Q2),
// `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE` levé par l'accesseur — l'état d'après sa migration préparée : offerte pour l'exercice
// 2025 d'un médecin dont le cumul est dit « oui », enregistrée sous la forme à six clés, nommée dans la confirmation, remise
// à « non dite » quand le cumul cesse d'être « oui » ; baissé (l'état servi), la carte d'hier, cinq clés.
const faux = vi.hoisted(() => ({ appels: [] as { nom: string; parametres: unknown }[], exoneration: true }))

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
  CASES_DU_MEDECIN_PREVUES: true,
  get EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE() { return faux.exoneration },
}))

const NON_DIT: CasesDuMedecin = { cumulEmploiRetraite: null, dispenseComplementaire: null, exonerationZonePrioritaire: null }
const lus = (annee: number, medecin: CasesDuMedecin): LectureDesParametres =>
  ({ dossierId: 'd', etat: 'lus', debutActivite: '2010-01-01', parExercice: new Map([[annee, { acre: false, tauxDentiste: null, medecin }]]) })

function afficher(annee: number, medecin: CasesDuMedecin = NON_DIT) {
  render(<ParametresDesCotisationsCard dossierId="d" annee={annee} lecture={lus(annee, medecin)}
    profession="medecin_secteur_2" exerciceValide={false} onRelire={() => Promise.resolve()} />)
}
const bouton = () => screen.getByRole('button', { name: /Enregistrer les paramètres/ }) as HTMLButtonElement
const exoneration = (annee: number) => screen.queryByLabelText(`Exonération de la retraite ${annee} (zone d’intervention prioritaire)`)

beforeEach(() => {
  faux.appels = []
  faux.exoneration = true
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('l’exonération de 2025 en zone d’intervention prioritaire dans la carte des paramètres (RET2-Q2)', () => {
  it('offerte en 2025 dès que le cumul est dit « oui », enregistrée sous six clés, nommée dans la confirmation', async () => {
    afficher(2025)
    expect(exoneration(2025)).toBeNull()
    fireEvent.change(screen.getByLabelText('Cumul emploi-retraite en 2025'), { target: { value: 'oui' } })
    expect(screen.getByText(/l’application ne sait ni la zone, ni la date de la retraite/)).toBeTruthy()
    fireEvent.change(exoneration(2025)!, { target: { value: 'oui' } })
    await act(async () => { fireEvent.click(bouton()) })
    expect(faux.appels).toEqual([{
      nom: 'enregistrer_parametres_des_cotisations',
      parametres: {
        p_dossier_id: 'd', p_annee: 2025,
        p_lus: { debut_activite: '2010-01-01', acre: false, taux_dentiste: null, cumul_emploi_retraite: null, dispense_complementaire: null,
          exoneration_zone_prioritaire: null },
        p_saisis: { debut_activite: '2010-01-01', acre: false, taux_dentiste: null, cumul_emploi_retraite: true, dispense_complementaire: null,
          exoneration_zone_prioritaire: true },
      },
    }])
    const question = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(question).toMatch(/Exonération de la retraite 2025 \(zone d’intervention prioritaire\) : non dit → oui/)
  })

  it('jamais pour un autre exercice : 2026 ne l’offre pas, même en cumul, et part tout de même sous six clés', async () => {
    afficher(2026, { cumulEmploiRetraite: true, dispenseComplementaire: null, exonerationZonePrioritaire: null })
    expect(exoneration(2026)).toBeNull()
    fireEvent.change(screen.getByLabelText('ACRE en 2026'), { target: { value: 'oui' } })
    await act(async () => { fireEvent.click(bouton()) })
    const parametres = faux.appels[0]?.parametres as { p_saisis: Record<string, unknown> }
    expect(parametres.p_saisis.exoneration_zone_prioritaire).toBeNull()
    expect(Object.keys(parametres.p_saisis)).toHaveLength(6)
  })

  it('le cumul qui cesse d’être « oui » rend l’exonération sans objet : elle repart « non dite » dans la même écriture', async () => {
    afficher(2025, { cumulEmploiRetraite: true, dispenseComplementaire: null, exonerationZonePrioritaire: true })
    expect((exoneration(2025) as HTMLSelectElement).value).toBe('oui')
    fireEvent.change(screen.getByLabelText('Cumul emploi-retraite en 2025'), { target: { value: 'non' } })
    // Dite en base, elle reste offerte, pour qu'on la voie partir.
    expect((exoneration(2025) as HTMLSelectElement).value).toBe('')
    expect(bouton().disabled).toBe(false)
    await act(async () => { fireEvent.click(bouton()) })
    const parametres = faux.appels[0]?.parametres as { p_saisis: Record<string, unknown> }
    expect(parametres.p_saisis).toMatchObject({ cumul_emploi_retraite: false, exoneration_zone_prioritaire: null })
    const question = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(question).toMatch(/Exonération de la retraite 2025 \(zone d’intervention prioritaire\) : oui → non dit/)
  })

  it('drapeau baissé (l’état servi) : ni la case, ni la sixième clé', async () => {
    faux.exoneration = false
    afficher(2025)
    fireEvent.change(screen.getByLabelText('Cumul emploi-retraite en 2025'), { target: { value: 'oui' } })
    expect(exoneration(2025)).toBeNull()
    await act(async () => { fireEvent.click(bouton()) })
    const parametres = faux.appels[0]?.parametres as { p_lus: Record<string, unknown>; p_saisis: Record<string, unknown> }
    expect(Object.keys(parametres.p_lus)).toHaveLength(5)
    expect(Object.keys(parametres.p_saisis)).toHaveLength(5)
  })
})
