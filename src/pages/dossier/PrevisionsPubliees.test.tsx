import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PrevisionsPubliees from './PrevisionsPubliees'
import {
  avertissementDuRaccord, composerLaPrevision, REFUS_DU_MODULE, REFUS_PREVISION, refusDeLaLectureDuPlan, type ContenuDeLaPrevision, type EntreeDeLaPrevision,
  type PrevisionPubliee,
} from '../../lib/previsionsPubliees'
import type { LectureDuCabinet } from '../../lib/previsionsPublieesLecture'
import type { LigneBanquePourPlan } from '../../lib/planTresorerie'

// Publier la prévision de trésorerie au client, côté cabinet (C8-Q2). La lecture est mockée ; la base, par `rpc`. L'écran
// garde ce qu'aucun calcul pur ne voit : rien avant le retour, aucun geste sur une lecture partielle (des prévisions ou du
// plan), un refus de la base dit avant le clic, la confirmation qui nomme ce qui part, le contenu TEL QU'IL PART (au jour de
// Paris), « Remplacer » qui cite celle en cours, un seul appel pour deux clics, la relecture après chaque geste. Le jour est
// figé au 15 novembre 2026, midi à Paris : le plan affiché et la prévision portent alors sur les mêmes mois, sous les quatre
// fuseaux de la suite.

const faux = vi.hoisted(() => ({
  lecture: null as LectureDuCabinet | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
  erreur: null as { message: string } | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: faux.erreur })) })
    },
  },
}))
vi.mock('../../lib/previsionsPublieesLecture', () => ({
  lireLesPrevisionsDuCabinet: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-15T11:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []; faux.erreur = null
})

const ligne = (date: string, sens: 'debit' | 'credit', montant: number): LigneBanquePourPlan => ({ date, sens, montant })
const LIGNES = [ligne('2026-05-04', 'debit', 4000), ligne('2026-06-03', 'debit', 3800), ligne('2026-08-05', 'debit', 4200),
  ligne('2026-09-07', 'debit', 3900), ligne('2026-10-02', 'debit', 4100), ligne('2026-10-20', 'credit', 7000)]
const ENTREE: Omit<EntreeDeLaPrevision, 'aujourdHui'> = {
  lignesBanque: LIGNES, ouverture: null, lignesDuRythme: LIGNES, nbMoisHistorique: 6, nbMoisProjection: 3, avecEspeces: false,
}
const MOIS = ['2026-12', '2027-01', '2027-02']

function contenu(): ContenuDeLaPrevision {
  const r = composerLaPrevision({ ...ENTREE, aujourdHui: '2026-11-15' })
  if (!r.ok) throw new Error(r.refus)
  return r.contenu
}
const publiee = (id: string, remplace: string | null = null): PrevisionPubliee => ({
  id, dossier_id: 'd1', geste: 'publication', contenu: contenu(), remplace_id: remplace, publiee_le: '2026-11-02T08:00:00Z',
})
const lecture = (lignes: PrevisionPubliee[], complete = true): LectureDuCabinet => ({
  dossierId: 'd1', previsions: { lignes, complete, motif: complete ? null : 'lecture interrompue' },
})
const ecran = (e: Partial<{ entree: typeof ENTREE; mois: string[]; lectureDuPlan: string | null }> = {}) =>
  render(<PrevisionsPubliees dossierId="d1" entree={e.entree ?? ENTREE} moisAffiches={e.mois ?? MOIS} lectureDuPlan={e.lectureDuPlan ?? null} />)

describe('publier la prévision (cabinet)', () => {
  it('rien n’est offert avant le retour de la lecture', () => {
    ecran()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Publier|Remplacer/ })).toBeNull()
  })

  it('la confirmation nomme ce qui part et dit que c’est une prévision ; deux clics, un seul appel, le contenu tel qu’il part ; puis la relecture', async () => {
    faux.lecture = lecture([])
    ecran()
    expect(await screen.findByText('Aucune prévision n’est publiée au client.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publier cette prévision' }))
    const fenetre = screen.getByRole('alertdialog')
    expect(fenetre.textContent).toContain('établie aujourd’hui, le 15/11/2026')
    expect(fenetre.textContent).toContain('de décembre 2026 à février 2027')
    expect(fenetre.textContent).toContain('pas un engagement')
    const bouton = screen.getByRole('button', { name: 'Publier' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].nom).toBe('publier_prevision')
    expect(faux.appels[0].args).toMatchObject({ p_dossier_id: 'd1', p_remplace_id: null })
    expect(faux.appels[0].args.p_contenu).toEqual(contenu())
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText(/établie le 15\/11\/2026 est publiée au client/)).toBeTruthy()
  })

  it('une prévision en cours : « Remplacer » la cite ; « Retirer » passe par sa fonction', async () => {
    faux.lecture = lecture([publiee('p1')])
    ecran()
    expect(await screen.findByText(/solde à la fin de février 2027/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer la prévision publiée le 02/11/2026' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Elle remplace celle publiée le 02/11/2026')
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }))
    expect(faux.appels[0].args.p_remplace_id).toBe('p1')
    await act(async () => { faux.retenir.forEach((r) => r()) })
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('02/11/2026')
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' }).at(-1)!)
    expect(faux.appels[1]).toEqual({ nom: 'retirer_prevision', args: { p_prevision_id: 'p1' } })
  })

  it('le refus de la base, dit : l’erreur de l’appel s’affiche, et la relecture a lieu', async () => {
    faux.lecture = lecture([])
    faux.erreur = { message: REFUS_PREVISION.dejaPubliee }
    ecran()
    fireEvent.click(await screen.findByRole('button', { name: 'Publier cette prévision' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }))
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect((await screen.findByRole('alert')).textContent).toContain(REFUS_PREVISION.dejaPubliee)
  })

  it('un raccord de plus d’un mois (C8Q2Q3-Q1) : averti près du bouton et dans la confirmation, le geste reste offert ; à jour, rien', async () => {
    faux.lecture = lecture([])
    const premier = ecran()
    const attendu = avertissementDuRaccord(contenu())
    expect(attendu).toContain('qu’au 20/10/2026')
    expect(await screen.findByText(attendu!)).toBeTruthy()
    const bouton = screen.getByRole('button', { name: 'Publier cette prévision' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(false)
    fireEvent.click(bouton)
    expect(screen.getByRole('alertdialog').textContent).toContain(attendu!)
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }))
    expect(faux.appels).toHaveLength(1)
    premier.unmount()
    // La banque à jour au 10 novembre : le raccord couvre 20 jours, aucun avertissement, ni à l'écran ni dans la confirmation.
    const aJour = { ...ENTREE, lignesBanque: [...LIGNES, ligne('2026-11-10', 'credit', 50)] }
    ecran({ entree: aJour })
    fireEvent.click(await screen.findByRole('button', { name: 'Publier cette prévision' }))
    expect(screen.queryByText(/Importe d’abord/)).toBeNull()
    expect(screen.getByRole('alertdialog').textContent).not.toContain('Importe d’abord')
  })

  it('une lecture partielle des prévisions ou du plan, aucun mouvement observé, des mois qui diffèrent : refusés avant le clic, sans aucun geste', async () => {
    faux.lecture = lecture([publiee('p1')], false)
    const premier = ecran()
    expect(await screen.findByText(REFUS_DU_MODULE.lecture)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect((screen.getByRole('button', { name: /Publier|Remplacer/ }) as HTMLButtonElement).disabled).toBe(true)
    premier.unmount()
    faux.lecture = lecture([])
    const second = ecran({ lectureDuPlan: 'les écritures du compte de banque lues en partie' })
    expect(await screen.findByText(refusDeLaLectureDuPlan('les écritures du compte de banque lues en partie'))).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publier cette prévision' }) as HTMLButtonElement).disabled).toBe(true)
    second.unmount()
    const troisieme = ecran({ entree: { ...ENTREE, lignesDuRythme: [ligne('2026-11-03', 'debit', 10)] } })
    expect(await screen.findByText(REFUS_PREVISION.sansMouvement)).toBeTruthy()
    troisieme.unmount()
    ecran({ mois: ['2026-11', '2026-12', '2027-01'] })
    expect(await screen.findByText(REFUS_DU_MODULE.moisDifferents)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publier cette prévision' }) as HTMLButtonElement).disabled).toBe(true)
    expect(faux.appels).toHaveLength(0)
  })
})
