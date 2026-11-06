import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SituationsPubliees from './SituationsPubliees'
import { composerLaSituation, REFUS_DE_L_ECRAN, REFUS_SITUATION, type SituationDuMoteur, type SituationPubliee } from '../../lib/situationsPubliees'
import type { LectureDuCabinet } from '../../lib/situationsPublieesLecture'

// Publier une situation, côté cabinet (étape C4b). La lecture est mockée ; la base, par `rpc`. L'écran garde ce qu'aucun
// calcul pur ne voit : rien avant le retour, aucun geste sur une lecture partielle, le refus d'un assujetti avant le clic,
// la confirmation qui nomme ce qui part, le contenu TEL QU'IL PART, « Remplacer » à une date déjà publiée, un seul appel pour
// deux clics, la relecture après chaque geste.

const faux = vi.hoisted(() => ({
  lecture: null as LectureDuCabinet | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: null })) })
    },
  },
}))
vi.mock('../../lib/situationsPublieesLecture', () => ({
  lireLesSituationsDuCabinet: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = [] })

const moteur = (debut: string, fin: string): SituationDuMoteur => ({
  periodeDebut: debut, periodeFin: fin, totauxParPoste: [['Recettes', 12500], ['Achats', -2300.5]], ventesFactureesEcartees: [],
  fraisSansPoste: [], recettesDeCaisseSansPoste: [] })
const calculer = (debut: string, fin: string) => moteur(debut, fin)

function publiee(id: string, arretee: string): SituationPubliee {
  const r = composerLaSituation({ arreteeAu: arretee, aujourdHui: '2026-11-06', anneesValidees: [], situation: moteur('2025-01-01', arretee),
    tva: { assujetti: false }, nMoins1: null })
  if (!r.ok) throw new Error(r.refus)
  return { id, dossier_id: 'd1', annee: 2025, geste: 'publication', arretee_au: arretee, statut: 'provisoire', contenu: r.contenu,
    remplace_id: null, auteur: 'a', publiee_le: '2025-07-01T08:00:00Z' }
}

const lecture = (lignes: SituationPubliee[], complete = true): LectureDuCabinet => ({
  dossierId: 'd1',
  situations: { lignes, complete, motif: complete ? null : 'lecture interrompue' },
  anneesValidees: { lignes: [], complete: true, motif: null },
})

describe('publier une situation (cabinet)', () => {
  it('rien n’est offert avant le retour de la lecture', () => {
    render(<SituationsPubliees dossierId="d1" arreteeAu="2025-06-30" assujettiTva={false} calculer={calculer} />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Publier/ })).toBeNull()
  })

  it('la confirmation nomme ce qui part ; deux clics, un seul appel, le contenu tel qu’il part ; puis la relecture', async () => {
    faux.lecture = lecture([])
    render(<SituationsPubliees dossierId="d1" arreteeAu="2025-06-30" assujettiTva={false} calculer={calculer} />)
    expect(await screen.findByText('Aucune situation n’est publiée au client.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publier cette situation' }))
    const fenetre = screen.getByRole('alertdialog')
    expect(fenetre.textContent).toContain('arrêtée au 30/06/2025, « provisoire »')
    expect(fenetre.textContent).toContain('du 01/01/2024 au 30/06/2024')
    const bouton = screen.getByRole('button', { name: 'Publier' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].nom).toBe('publier_situation')
    expect(faux.appels[0].args).toMatchObject({ p_dossier_id: 'd1', p_arretee_au: '2025-06-30', p_remplace_id: null })
    const contenu = faux.appels[0].args.p_contenu as { recettes: number; n_moins_1: unknown }
    expect(contenu.recettes).toBe(1250000)
    expect(contenu.n_moins_1).not.toBeNull()
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText(/arrêtée au 30\/06\/2025 est publiée au client/)).toBeTruthy()
  })

  it('à une date déjà publiée, « Remplacer » cite celle en cours ; « Retirer » passe par sa fonction', async () => {
    faux.lecture = lecture([publiee('p1', '2025-06-30')])
    render(<SituationsPubliees dossierId="d1" arreteeAu="2025-06-30" assujettiTva={false} calculer={calculer} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remplacer la situation du 30/06/2025' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }))
    expect(faux.appels[0].args.p_remplace_id).toBe('p1')
    await act(async () => { faux.retenir.forEach((r) => r()) })
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('30/06/2025')
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' }).at(-1)!)
    expect(faux.appels[1]).toEqual({ nom: 'retirer_situation', args: { p_situation_id: 'p1' } })
  })

  it('sans la comparaison, rien de N−1 ne part', async () => {
    faux.lecture = lecture([])
    render(<SituationsPubliees dossierId="d1" arreteeAu="2025-06-30" assujettiTva={false} calculer={calculer} />)
    fireEvent.click(await screen.findByLabelText('Joindre la même période de l’exercice précédent'))
    fireEvent.click(screen.getByRole('button', { name: 'Publier cette situation' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Sans la comparaison')
    fireEvent.click(screen.getByRole('button', { name: 'Publier' }))
    expect((faux.appels[0].args.p_contenu as { n_moins_1: unknown }).n_moins_1).toBeNull()
  })

  it('un assujetti, une lecture partielle ou une date à venir se refusent avant le clic, sans aucun geste', async () => {
    faux.lecture = lecture([])
    const { unmount } = render(<SituationsPubliees dossierId="d1" arreteeAu="2025-06-30" assujettiTva calculer={calculer} />)
    expect(await screen.findByText(REFUS_DE_L_ECRAN.tvaAssujetti)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publier cette situation' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    faux.lecture = lecture([publiee('p1', '2025-06-30')], false)
    const second = render(<SituationsPubliees dossierId="d1" arreteeAu="2025-06-30" assujettiTva={false} calculer={calculer} />)
    expect(await screen.findByText(REFUS_DE_L_ECRAN.lecture)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect((screen.getByRole('button', { name: /Publier|Remplacer/ }) as HTMLButtonElement).disabled).toBe(true)
    second.unmount()
    faux.lecture = lecture([])
    render(<SituationsPubliees dossierId="d1" arreteeAu="2099-01-31" assujettiTva={false} calculer={calculer} />)
    expect(await screen.findByText(REFUS_SITUATION.dateAVenir)).toBeTruthy()
    expect(faux.appels).toHaveLength(0)
  })
})
