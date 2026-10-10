import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { ModeleComptable } from '../../lib/engagement'
import { cotisation, ecriture, ecritureJuste, faux, ligne, reinitialiser } from '../../test/cotisationsPaiementPersonnel'
import { AvecExercicesValides } from '../../test/exercicesValides'

// LE RETRAIT D'UN PAIEMENT DEPUIS LE COMPTE PERSONNEL (ligne 26.6). Sa fonction (`retirer_paiement_personnel_cotisation`)
// est en base depuis que le cabinet a collé sa migration, le 10/10/2026, et l'export la porte : `RETRAIT_EXPORTE` est
// vrai dans le module, que ce fichier monte TEL QU'IL EST (cotisationPersonnelle.test.ts tient le drapeau égal à
// l'export). Ce qu'aucun test du module ne voit : que le geste est offert sur la seule ligne qui peut le recevoir, que la
// confirmation nomme ce qui part — les lignes du brouillon telles qu'elles sont —, que l'appel part UNE fois sous le
// verrou du brouillon, relâché après la relecture, et que les refus se disent avant le clic, puis ceux de la base.
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/cotisationsPaiementPersonnel')).supabaseFaux() }))
vi.mock('../../lib/extraction', async () => (await import('../../test/cotisationsPaiementPersonnel')).extractionFausse())

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const GESTE = 'Payée depuis le compte personnel…'
const RETIRER = 'Retirer ce paiement'

const monter = (valides: readonly number[] = []) => render(
  <AvecExercicesValides annees={valides}><CotisationsTab dossierId="dossier-de-test" modele={TRESORERIE} /></AvecExercicesValides>,
)

beforeEach(() => {
  reinitialiser()
  // Le jour de la base, à Paris, comme le fichier de la déclaration.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CotisationsTab — retirer un paiement personnel', () => {
  it('confirme en nommant ce qu’on perd, retire par la base, et l’échéance redevient à déclarer', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.ecritures = ecritureJuste()
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return true })
    monter()

    const retirer = await screen.findByRole('button', { name: RETIRER })
    await act(async () => { retirer.click() })
    expect(message).toMatch(/^Retirer ce paiement \?\n\nLe paiement du 10\/03\/2026 depuis le compte personnel est retiré\. Son écriture \(700,00\s€ au 646000, face au 108000\) est retirée du brouillon\. L’échéance compte de nouveau à son échéance, le 05\/03\/2026, tant qu’aucun paiement ne la date\.$/)
    expect(faux.rpcs).toEqual([{
      nom: 'retirer_paiement_personnel_cotisation', args: { p_dossier_id: 'dossier-de-test', p_cotisation_id: 'cot-1' },
    }])
    expect(await screen.findByRole('button', { name: GESTE })).toBeTruthy()
    expect(screen.queryByText('Payée depuis le compte personnel le 10/03/2026')).toBeNull()
    expect(faux.ecritures).toEqual([])
  })

  it('annulé, rien ne part', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter()
    const retirer = await screen.findByRole('button', { name: RETIRER })
    await act(async () => { retirer.click() })
    expect(faux.rpcs).toEqual([])
    expect(screen.getByText('Payée depuis le compte personnel le 10/03/2026')).toBeTruthy()
  })

  // Le retrait est le geste que conseille une écriture « À reprendre » : la confirmation dit ce que la fonction retire —
  // les lignes qui désignent l'échéance, telles qu'elles sont —, pas l'écriture que le paiement produirait.
  it('sur une écriture à reprendre, la confirmation nomme les lignes telles qu’elles sont', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', paiement_personnel_le: '2026-03-10' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05', paiement_personnel_le: '2026-04-10' }),
    ]
    // cot-1 : une ligne de trop ; cot-2 : aucune.
    faux.ecritures = [...ecritureJuste(), ecriture({ id: 'e-c', compte: '108000', sens: 'credit', montant: 5 })]
    const messages: string[] = []
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { messages.push(m ?? ''); return false })
    monter()

    // Cherchées HORS de l'`act` : elles paraissent après la lecture.
    const premiere = (await screen.findByText('Payée depuis le compte personnel le 10/03/2026')).closest('tr')!
    const seconde = screen.getByText('Payée depuis le compte personnel le 10/04/2026').closest('tr')!
    await act(async () => { within(premiere).getByRole('button', { name: RETIRER }).click() })
    await act(async () => { within(seconde).getByRole('button', { name: RETIRER }).click() })
    expect(messages[0]).toContain('Ses 3 lignes au brouillon (108000, 646000), qui ne suivent plus l’échéance, sont retirées.')
    expect(messages[0]).not.toContain('Son écriture')
    expect(messages[1]).toContain('Il n’a aucune ligne au brouillon : rien n’en est retiré.')
    expect(faux.rpcs).toEqual([])
  })

  it('sur un brouillon lu en partie, la confirmation ne détaille pas ce qu’elle n’a pas vu', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.ecritures = ecritureJuste()
    faux.muetApres.ecritures_brouillon = 1
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })
    monter()

    const retirer = await screen.findByRole('button', { name: RETIRER })
    await act(async () => { retirer.click() })
    expect(message).toContain('Ses lignes au brouillon sont retirées avec lui ; le brouillon n’a été lu qu’en partie, elles ne sont pas détaillées ici.')
    expect(message).not.toContain('Son écriture')
  })

  it('deux clics dans le même rendu ne retirent qu’une fois', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await screen.findByRole('button', { name: RETIRER })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('trois clics ne retirent qu’une fois, et le verrou tient pendant la relecture', async () => {
    faux.cotisations = [
      cotisation({ paiement_personnel_le: '2026-03-10' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05' }),
      // Prélevée, sans écriture : « Écrire cette échéance » reste visible pendant la relecture.
      cotisation({ id: 'cot-3', echeance: '2026-02-05' }),
    ]
    faux.lignes = [ligne({ id: 'l-3', cotisation_id: 'cot-3', date: '2026-02-06' })]
    faux.ecritures = ecritureJuste()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = await screen.findByRole('button', { name: RETIRER })
    faux.retenirLectures = true
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await waitFor(() => expect(faux.relacher).not.toBeNull())
    expect(faux.rpcs).toHaveLength(1)
    // La relecture n'est pas revenue : le tableau attend, et « Écrire » reste grisé et ne part pas — il partirait de
    // listes d'avant le retrait.
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: RETIRER })).toBeNull()
    const ecrire = screen.getByRole('button', { name: 'Écriture…' })
    expect(ecrire.hasAttribute('disabled')).toBe(true)
    await act(async () => { ecrire.click() })
    expect(faux.rpcs).toHaveLength(1)

    faux.retenirLectures = false
    await act(async () => { faux.relacher?.(); faux.retenue = null })
    // Relâché après la relecture : les deux échéances sans paiement se déclarent, la prélevée s'écrit.
    await waitFor(() => expect(screen.getAllByRole('button', { name: GESTE })).toHaveLength(2))
    expect(screen.getAllByRole('button', { name: GESTE }).every((b) => !b.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Écrire cette échéance' }).hasAttribute('disabled')).toBe(false)
  })

  it('le verrou est celui du brouillon : pendant le retrait, « Retirer » et la déclaration attendent', async () => {
    faux.cotisations = [
      cotisation({ paiement_personnel_le: '2026-03-10' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05' }),
    ]
    faux.ecritures = ecritureJuste()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = await screen.findByRole('button', { name: RETIRER })
    faux.retenirRpc = true
    await act(async () => { bouton.click() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: RETIRER }).hasAttribute('disabled')).toBe(true)
    const retirer = screen.getAllByRole('button', { name: 'Retirer' })
    expect(retirer.every((b) => b.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByRole('button', { name: GESTE }).hasAttribute('disabled')).toBe(true)
    await act(async () => { retirer[0].click() })
    expect(confirmation).toHaveBeenCalledTimes(1)

    await act(async () => { faux.relacherRpc?.() })
    await waitFor(() => expect(screen.getAllByRole('button', { name: GESTE })).toHaveLength(2))
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['retirer_paiement_personnel_cotisation'])
  })

  it('n’est pas offert quand le paiement est d’un exercice validé : la raison en titre', async () => {
    faux.cotisations = [cotisation({ echeance: '2026-01-15', paiement_personnel_le: '2025-12-20' })]
    faux.ecritures = ecritureJuste('2025-12-20')
    monter([2025])

    const refus = await screen.findByText('Ne se retire plus')
    expect(refus.getAttribute('title')).toBe('L\'exercice 2025 est validé : ce paiement ne se retire plus.')
    expect(screen.queryByRole('button', { name: RETIRER })).toBeNull()
  })

  it('n’est pas offert quand l’échéance est d’un exercice validé : la raison en titre', async () => {
    // Payée en janvier 2026 (ouvert), échéance de décembre 2025 (validé) : sans le paiement, elle compterait en 2025.
    faux.cotisations = [cotisation({ echeance: '2025-12-15', paiement_personnel_le: '2026-01-10' })]
    monter([2025])

    const refus = await screen.findByText('Ne se retire plus')
    expect(refus.getAttribute('title')).toBe(
      'L\'exercice 2025 est validé : sans ce paiement, l\'échéance du 15/12/2025 y compterait ; il ne se retire plus.',
    )
    expect(screen.queryByRole('button', { name: RETIRER })).toBeNull()
  })

  it('n’est offert que sur une échéance payée depuis le compte personnel', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ cotisation_id: 'cot-2', date: '2026-04-06' })]
    monter()
    await screen.findByRole('button', { name: GESTE })
    expect(screen.queryByRole('button', { name: RETIRER })).toBeNull()
  })

  it('dit le refus de la base', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.erreurRpc = 'Cette échéance n\'est pas payée depuis le compte personnel.'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const retirer = await screen.findByRole('button', { name: RETIRER })
    await act(async () => { retirer.click() })
    await screen.findByText('Le paiement n’a pas pu être retiré : Cette échéance n\'est pas payée depuis le compte personnel.')
    // Relu, et le verrou relâché : le geste se propose de nouveau.
    expect(screen.getByRole('button', { name: RETIRER }).hasAttribute('disabled')).toBe(false)
  })
})
