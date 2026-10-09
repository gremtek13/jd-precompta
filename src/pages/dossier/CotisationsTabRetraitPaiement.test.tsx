import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { ModeleComptable } from '../../lib/engagement'
import { cotisation, ecritureJuste, faux, reinitialiser } from '../../test/cotisationsPaiementPersonnel'
import { AvecExercicesValides } from '../../test/exercicesValides'

// LE RETRAIT D'UN PAIEMENT DEPUIS LE COMPTE PERSONNEL, PRÉPARÉ (ligne 26.6, phase C). Sa fonction
// (`retirer_paiement_personnel_cotisation`) vit dans une migration que le cabinet colle : tant qu'elle n'est pas en base,
// `RETRAIT_EXPORTE` est faux dans le module, et l'onglet n'offre pas le bouton (CotisationsTabPaiementPersonnel.test.tsx le
// garde). Le jour où l'export la porte, cotisationPersonnelle.test.ts exige de passer le drapeau à `true` — et le bouton
// s'ouvre. Ce fichier le joue dès aujourd'hui, drapeau levé, pour que ce jour-là le geste soit déjà éprouvé.
vi.mock('../../lib/cotisationPersonnelle', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/cotisationPersonnelle')>(),
  RETRAIT_EXPORTE: true,
}))
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/cotisationsPaiementPersonnel')).supabaseFaux() }))
vi.mock('../../lib/extraction', async () => (await import('../../test/cotisationsPaiementPersonnel')).extractionFausse())

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const GESTE = 'Payée depuis le compte personnel…'

const monter = (valides: readonly number[] = []) => render(
  <AvecExercicesValides annees={valides}><CotisationsTab dossierId="dossier-de-test" modele={TRESORERIE} /></AvecExercicesValides>,
)

beforeEach(() => { reinitialiser() })

afterEach(() => { vi.restoreAllMocks() })

describe('CotisationsTab — retirer un paiement personnel, quand sa fonction est en base', () => {
  it('confirme en nommant ce qu’on perd, retire par la base, et l’échéance redevient à déclarer', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.ecritures = ecritureJuste()
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return true })
    monter()

    const retirer = await screen.findByRole('button', { name: 'Retirer ce paiement' })
    await act(async () => { retirer.click() })
    expect(message).toMatch(/^Retirer ce paiement \?\n\nLe paiement du 10\/03\/2026 depuis le compte personnel est retiré\. Son écriture \(700,00\s€ au 646000, face au 108000\) est retirée du brouillon\./)
    expect(faux.rpcs).toEqual([{
      nom: 'retirer_paiement_personnel_cotisation', args: { p_dossier_id: 'dossier-de-test', p_cotisation_id: 'cot-1' },
    }])
    expect(await screen.findByRole('button', { name: GESTE })).toBeTruthy()
    expect(faux.ecritures).toEqual([])
  })

  it('annulé, rien ne part', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter()
    const retirer = await screen.findByRole('button', { name: 'Retirer ce paiement' })
    await act(async () => { retirer.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('deux clics dans le même rendu ne retirent qu’une fois', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await screen.findByRole('button', { name: 'Retirer ce paiement' })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('n’est pas offert quand l’échéance est d’un exercice validé : la raison en titre', async () => {
    // Payée en janvier 2026 (ouvert), échéance de décembre 2025 (validé) : sans le paiement, elle compterait en 2025.
    faux.cotisations = [cotisation({ echeance: '2025-12-15', paiement_personnel_le: '2026-01-10' })]
    monter([2025])

    const refus = await screen.findByText('Ne se retire plus')
    expect(refus.getAttribute('title')).toBe(
      'L\'exercice 2025 est validé : sans ce paiement, l\'échéance du 15/12/2025 y compterait ; il ne se retire plus.',
    )
    expect(screen.queryByRole('button', { name: 'Retirer ce paiement' })).toBeNull()
  })

  it('dit le refus de la base', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.erreurRpc = 'Cette échéance n\'est pas payée depuis le compte personnel.'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const retirer = await screen.findByRole('button', { name: 'Retirer ce paiement' })
    await act(async () => { retirer.click() })
    await screen.findByText('Le paiement n’a pas pu être retiré : Cette échéance n\'est pas payée depuis le compte personnel.')
  })
})
