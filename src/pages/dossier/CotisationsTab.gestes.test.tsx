import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { ModeleComptable } from '../../lib/engagement'
import { avis, cotisation, ecriture, faux, ligne, reinitialiser } from '../../test/cotisationsGestes'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { formatMoney } from '../../lib/format'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// « MODIFIER » ET « RÉUNIR » DANS L'ONGLET COTISATIONS (COT-Q3 et COT-Q1, 04/11/2026). Ce qu'aucun test du module
// (lib/gestesDesEcheances.test.ts) ne voit : que les gestes sont offerts sur les seules lignes qui peuvent les recevoir, et
// jamais sur une lecture partielle ; que la mise à jour RETIENT la version lue ; qu'elle part UNE fois sous le verrou du
// brouillon (deux clics dans le même `act`) ; que la réécriture suit la mise à jour ; et qu'une réunion arrêtée entre ses
// deux écritures se dit après la relecture, avec le geste qui la finit — jamais « réunies ».
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/cotisationsGestes')).supabaseFaux() }))
vi.mock('../../lib/extraction', async () => (await import('../../test/cotisationsGestes')).extractionFausse())

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

const monter = (valides: readonly number[] = []) => render(
  <AvecExercicesValides annees={valides}><CotisationsTab dossierId="dossier-de-test" modele={TRESORERIE} /></AvecExercicesValides>,
)

beforeEach(() => { reinitialiser() })
afterEach(() => { vi.restoreAllMocks() })

const ligneDe = async (date: string) => (await screen.findByText(date)).closest('tr')!
const fenetre = () => screen.getByRole('dialog')
// La ligne se cherche HORS de l'`act` (elle paraît après la lecture) ; le clic, dedans.
const cliquer = async (ligne: HTMLElement, nom: string) => { await act(async () => { within(ligne).getByRole('button', { name: nom }).click() }) }

describe('CotisationsTab — « Modifier » une échéance', () => {
  it('pose 0 de CSG-CRDS sur une caisse de retraite : dit l’effet avant le clic, écrit en retenant la version lue, relit', async () => {
    faux.cotisations = [cotisation({ montant_appele: 1000, montant_csg_crds: null })]
    monter()
    const ligneRetraite = await ligneDe('20/03/2026')
    await act(async () => { within(ligneRetraite).getByRole('button', { name: 'Modifier' }).click() })

    fireEvent.change(within(fenetre()).getByLabelText('dont CSG-CRDS'), { target: { value: '0' } })
    expect(within(fenetre()).getByText('Une CSG-CRDS de 0 € dit que l’organisme n’en prélève pas : l’échéance n’est plus « sans ventilation ».')).toBeTruthy()
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })

    expect(faux.misesAJour).toEqual([{
      valeur: { echeance: '2026-03-20', montant_appele: 1000, montant_verse: null, montant_csg_crds: 0, previsionnel: false },
      filtres: [
        'id=eq.cot-1', 'echeance=eq.2026-03-20', 'montant_appele=eq.1000', 'previsionnel=eq.false', 'paiement_personnel_le=is.null',
        'montant_verse=is.null', 'montant_csg_crds=is.null',
      ],
    }])
    expect(faux.rpcs).toEqual([])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Un montant se lit à `textContent` (CLAUDE.md, « un montant ne se coupe pas »).
    await waitFor(() => expect((screen.getByText('20/03/2026').closest('tr')!.querySelector('[data-libelle="dont CSG-CRDS"]'))?.textContent).toBe(formatMoney(0)))
  })

  it('deux clics dans le même `act` n’écrivent qu’une fois', async () => {
    faux.cotisations = [cotisation({ montant_csg_crds: null })]
    monter()
    await cliquer(await ligneDe('20/03/2026'), 'Modifier')
    fireEvent.change(within(fenetre()).getByLabelText('dont CSG-CRDS'), { target: { value: '0' } })
    const enregistrer = within(fenetre()).getByRole('button', { name: 'Enregistrer' })
    await act(async () => { enregistrer.click(); enregistrer.click() })
    expect(faux.misesAJour).toHaveLength(1)
  })

  it('une échéance changée depuis sa lecture n’est pas écrite, et le dit', async () => {
    faux.cotisations = [cotisation({ montant_csg_crds: null })]
    monter()
    await cliquer(await ligneDe('20/03/2026'), 'Modifier')
    // Une autre session l'a changée entre la lecture et le clic.
    faux.cotisations = [cotisation({ montant_csg_crds: 120 })]
    fireEvent.change(within(fenetre()).getByLabelText('dont CSG-CRDS'), { target: { value: '0' } })
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })
    expect(await within(fenetre()).findByText(
      'L’échéance n’a pas été modifiée : elle a changé depuis sa lecture, ou la base ne l’a pas laissée écrire ; relis la liste et recommence.',
    )).toBeTruthy()
    expect(faux.cotisations[0].montant_csg_crds).toBe(120)
  })

  it('une échéance rapprochée : la CSG-CRDS changée réécrit l’écriture APRÈS la mise à jour, dit avant le clic', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.ecritures = [
      ecriture({ id: 'e-a' }), ecriture({ id: 'e-b', compte: '646000', sens: 'debit', montant: 1700 }),
      ecriture({ id: 'e-c', compte: '108000', sens: 'debit', montant: 300 }),
    ]
    monter()
    await cliquer(await ligneDe('20/03/2026'), 'Modifier')
    fireEvent.change(within(fenetre()).getByLabelText('Montant appelé'), { target: { value: '2000' } })
    fireEvent.change(within(fenetre()).getByLabelText('dont CSG-CRDS'), { target: { value: '750' } })
    expect(within(fenetre()).getByText(/^Son écriture est réécrite/).textContent).toBe(
      `Son écriture est réécrite dans le même geste : ${formatMoney(1250)} au 646000, ${formatMoney(750)} de CSG-CRDS au 108000, face à la banque.`,
    )
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })

    expect(faux.misesAJour).toHaveLength(1)
    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_cotisation',
      args: {
        p_ligne_bancaire_id: 'l-1', p_cotisation_id: 'cot-1', p_ecritures: [
          { compte: '512000', sens: 'credit', montant: 2000, libelle: 'PRLV URSSAF' },
          { compte: '646000', sens: 'debit', montant: 1250, libelle: 'PRLV URSSAF' },
          { compte: '108000', sens: 'debit', montant: 750, libelle: 'PRLV URSSAF' },
        ],
      },
    }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/n’a pas pu être réécrite/)).toBeNull()
  })

  it('la réécriture refusée laisse l’échéance modifiée, et le dit en nommant le bouton qui la réécrit', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.erreursRpc = { rapprocher_cotisation: 'JWT expired' }
    monter()
    await cliquer(await ligneDe('20/03/2026'), 'Modifier')
    fireEvent.change(within(fenetre()).getByLabelText('dont CSG-CRDS'), { target: { value: '450' } })
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Enregistrer' }).click() })
    expect(await screen.findByText(
      'L’échéance du 20/03/2026 est modifiée, mais l’écriture de son prélèvement du 21/03/2026 n’a pas pu être réécrite : JWT expired. « Écrire cette échéance », ci-dessus, la réécrit.',
    )).toBeTruthy()
    expect(faux.cotisations[0].montant_csg_crds).toBe(450)
    // L'onglet montre l'écriture à reprendre, et le bouton qui la réécrit.
    expect(screen.getByRole('button', { name: 'Écrire cette échéance' })).toBeTruthy()
  })

  it('n’est pas offert sur une échéance figée, ni sur une lecture partielle', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1', echeance: '2025-12-20' }), cotisation({ id: 'cot-2', echeance: '2026-03-20' })]
    monter([2025])
    expect(within(await ligneDe('20/12/2025')).queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(within(await ligneDe('20/03/2026')).getByRole('button', { name: 'Modifier' })).toBeTruthy()
  })

  it('une lecture partielle n’offre aucun geste', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-20' })]
    faux.muetApres = { lignes_bancaires: 0 }
    faux.lignes = [ligne({ cotisation_id: 'autre' })]
    monter()
    await ligneDe('20/03/2026')
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Réunir…' })).toBeNull()
  })
})

describe('CotisationsTab — « Réunir » deux échéances', () => {
  const mensualite = cotisation({ id: 'cot-1', echeance: '2026-03-20', montant_appele: 800, montant_csg_crds: 300 })
  const regularisation = cotisation({ id: 'cot-2', echeance: '2026-03-15', montant_appele: 1200, montant_csg_crds: 450 })

  async function ouvrirEtChoisir() {
    monter()
    await cliquer(await ligneDe('20/03/2026'), 'Réunir…')
    fireEvent.click(within(fenetre()).getByLabelText(new RegExp('^15/03/2026')))
  }

  it('nomme le résultat avant le clic, porte la gardée à la somme PUIS retire l’autre, et la liste n’en porte plus qu’une', async () => {
    faux.cotisations = [mensualite, regularisation]
    faux.documents = [avis({ attached_to_cotisation_id: 'cot-2' })]
    await ouvrirEtChoisir()
    expect(within(fenetre()).getByText(/^L’échéance du 20\/03\/2026 est gardée, à sa date, et portée à/).textContent).toBe(
      `L’échéance du 20/03/2026 est gardée, à sa date, et portée à ${formatMoney(2000)} appelés, dont ${formatMoney(750)} de CSG-CRDS. `
      + `Celle du 15/03/2026 (${formatMoney(1200)} appelés, dont ${formatMoney(450)} de CSG-CRDS) est retirée : aucun mouvement ne la paie. `
      + 'Son avis « regul.pdf » redevient non rattaché. '
      + 'Ne réunis que deux échéances d’un même organisme qu’un même prélèvement paie : l’application ne connaît pas l’organisme d’une échéance.',
    )
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Réunir' }).click() })

    expect(faux.misesAJour.map((m) => m.valeur)).toEqual([
      { echeance: '2026-03-20', montant_appele: 2000, montant_verse: null, montant_csg_crds: 750, previsionnel: false },
    ])
    expect(faux.misesAJour[0].filtres).toContain('id=eq.cot-1')
    expect(faux.rpcs).toEqual([{ nom: 'supprimer_echeance_cotisation', args: { p_cotisation_id: 'cot-2' } }])
    await waitFor(() => expect(screen.queryByText('15/03/2026')).toBeNull())
    expect((await ligneDe('20/03/2026')).querySelector('[data-libelle="Appelé"]')?.textContent).toBe(formatMoney(2000))
    expect(screen.queryByText(/Réunion inachevée/)).toBeNull()
  })

  it('deux clics dans le même `act` ne réunissent qu’une fois', async () => {
    faux.cotisations = [mensualite, regularisation]
    await ouvrirEtChoisir()
    const reunirBouton = within(fenetre()).getByRole('button', { name: 'Réunir' })
    await act(async () => { reunirBouton.click(); reunirBouton.click() })
    expect(faux.misesAJour).toHaveLength(1)
    expect(faux.rpcs).toHaveLength(1)
  })

  it('le retrait refusé : la réunion est dite inachevée après la relecture, avec le geste qui la finit — jamais « réunies »', async () => {
    faux.cotisations = [mensualite, regularisation]
    faux.erreursRpc = { supprimer_echeance_cotisation: 'JWT expired' }
    await ouvrirEtChoisir()
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Réunir' }).click() })

    expect((await screen.findByText(/^Réunion inachevée/)).textContent).toBe(
      `Réunion inachevée : l’échéance du 20/03/2026 porte déjà ${formatMoney(2000)} appelés, dont ${formatMoney(750)} de CSG-CRDS, `
      + `mais celle du 15/03/2026 (${formatMoney(1200)} appelés, dont ${formatMoney(450)} de CSG-CRDS) n’a pas pu être retirée : JWT expired. `
      + `Tant qu’elle reste, ses ${formatMoney(1200)} comptent deux fois. Retire l’échéance du 15/03/2026 pour finir.`,
    )
    expect(screen.queryByText(/réunies/)).toBeNull()
    // L'état est celui que la base porte, relu : les deux échéances, la gardée à la somme, l'autre marquée.
    expect((await ligneDe('20/03/2026')).querySelector('[data-libelle="Appelé"]')?.textContent).toBe(formatMoney(2000))
    expect((await screen.findByText('À retirer : réunie à l’échéance du 20/03/2026')).closest('tr')?.textContent).toContain('15/03/2026')

    // Le geste qui finit : il confirme ce qu'il retire, puis la liste n'en porte plus qu'une, et l'avis se tait.
    faux.erreursRpc = {}
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { screen.getByRole('button', { name: 'Retirer l’échéance du 15/03/2026' }).click() })
    await waitFor(() => expect(screen.queryByText(/Réunion inachevée/)).toBeNull())
    expect(screen.queryByText('15/03/2026')).toBeNull()
  })

  it('la gardée refusée : rien n’est réuni, et rien n’est retiré', async () => {
    faux.cotisations = [mensualite, regularisation]
    faux.erreurMiseAJour = 'permission denied for table cotisations_declarees'
    await ouvrirEtChoisir()
    await act(async () => { within(fenetre()).getByRole('button', { name: 'Réunir' }).click() })
    expect(await within(fenetre()).findByText(
      'Rien n’a été réuni : l’échéance du 20/03/2026 n’a pas été modifiée — permission denied for table cotisations_declarees.',
    )).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    expect(faux.cotisations).toHaveLength(2)
  })

  it('n’est offert que sur une échéance qui a une candidate : ni rapprochée, ni seule de son sens', async () => {
    faux.cotisations = [mensualite, regularisation, cotisation({ id: 'cot-3', echeance: '2026-05-20', montant_appele: -500 })]
    faux.lignes = [ligne({ id: 'l-9', cotisation_id: 'cot-2', date: '2026-03-16', montant: -1200 })]
    monter()
    // cot-2 rapprochée : cot-1 n'a plus de candidate du même sens ; cot-3, un remboursement, non plus.
    for (const date of ['20/03/2026', '15/03/2026', '20/05/2026']) {
      expect(within(await ligneDe(date)).queryByRole('button', { name: 'Réunir…' })).toBeNull()
    }
  })
})
