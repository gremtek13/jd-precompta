import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HaussesDuChiffreDAffaires, { type DossierDuTableauDeBord } from './HaussesDuChiffreDAffaires'
import {
  LIBELLE_OUVRIR_LA_VUE_D_ENSEMBLE, SEUILS_ILLISIBLES, phraseDesIllisibles, phraseDesNonCalcules, phraseDuTitre,
  type HausseDuChiffreDAffaires, type LectureDeLaHausse, type SeuilsDeLAlerte,
} from '../lib/hausseDuChiffreDAffaires'

// LES ALERTES DU CHIFFRE D'AFFAIRES SUR LE TABLEAU DE BORD DU CABINET, À L'ÉCRAN. Ce que le module ne voit pas : rien sans clé ni
// avant les lectures, le drapeau dans ses deux états, les seuils lus d'abord et les seuls dossiers réglés calculés, l'un après
// l'autre, au plus le plafond ; une ligne par alerte non vue, à la hausse comme à la baisse, qui mène à la Vue d'ensemble de son
// dossier ; une lecture ratée dite discrètement, jamais tue. Les lectures sont doublées. Données FICTIVES.
const faux = vi.hoisted(() => ({
  prevue: true,
  plafond: 10,
  seuils: { etat: 'lus', seuils: new Map<string, SeuilsDeLAlerte>() } as
    | { etat: 'lus'; seuils: ReadonlyMap<string, SeuilsDeLAlerte> } | { etat: 'illisible'; motif: string },
  parDossier: {} as Record<string, LectureDeLaHausse>,
  calcules: [] as string[],
}))

vi.mock('../lib/hausseDuChiffreDAffaires', async (original) => {
  const vrai = await original<typeof import('../lib/hausseDuChiffreDAffaires')>()
  return {
    ...vrai,
    get HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE() { return faux.prevue },
    get PLAFOND_DU_TABLEAU_DE_BORD() { return faux.plafond },
  }
})

vi.mock('../lib/hausseDuChiffreDAffairesLecture', () => ({
  lireLesSeuilsDesDossiers: async () => faux.seuils,
  lireLaHausseDuDossier: async (dossier: { id: string }) => {
    faux.calcules.push(dossier.id)
    return { dossierId: dossier.id, reglage: { dossierId: dossier.id, etat: 'lu', seuil: null, vues: [] }, lecture: faux.parDossier[dossier.id] }
  },
}))

const comparee = (dixiemes: number, franchit: 'hausse' | 'baisse' | null) => ({
  etat: 'comparee' as const,
  comparaison: {
    debut: '2026-07-01', fin: '2026-09-30', debutPrecedent: '2025-07-01', finPrecedent: '2025-09-30', centimes: 1, precedentCentimes: 1,
    variationDixiemes: dixiemes, franchit,
  },
})
const hausse: HausseDuChiffreDAffaires = {
  etat: 'jugee', trimestre: { annee: 2026, trimestre: 3 }, seuils: { hausse: 20, baisse: null }, hausse: true, baisse: false, vue: null,
  duTrimestre: comparee(250, 'hausse'), duCumul: null, surDouzeMois: null,
}
const baisse: HausseDuChiffreDAffaires = {
  ...hausse, seuils: { hausse: null, baisse: 15 }, hausse: false, baisse: true, duTrimestre: comparee(-250, 'baisse'),
}
const seuil = (h: number | null, b: number | null = null): SeuilsDeLAlerte => ({ hausse: h, baisse: b })
const dossier = (id: string, nom: string): DossierDuTableauDeBord => ({ id, nom, assujetti_tva: false, mode_comptable: 'tresorerie' })
const DOSSIERS = [dossier('d1', 'Cabinet Alpha'), dossier('d2', 'Cabinet Bêta'), dossier('d3', 'Cabinet Gamma'), dossier('d4', 'Mon cabinet')]

function monter(cle: string | null = 'u-chef') {
  return render(
    <MemoryRouter>
      <HaussesDuChiffreDAffaires dossiers={DOSSIERS} dossiersDuCabinet={new Set(['d4'])} cle={cle} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  faux.prevue = true
  faux.plafond = 10
  faux.seuils = { etat: 'lus', seuils: new Map([['d1', seuil(20)], ['d2', seuil(15)], ['d4', seuil(30)]]) }
  faux.parDossier = {
    d1: { etat: 'lue', hausse },
    d2: { etat: 'lue', hausse: { ...hausse, vue: { dossier_id: 'd2', annee: 2026, trimestre: 3, vue_par: 'u', vue_le: '2026-11-16T09:00:00Z' } } },
    d4: { etat: 'lue', hausse: { ...hausse, hausse: false, duTrimestre: comparee(30, null) } },
  }
  faux.calcules = []
})

describe('les alertes du tableau de bord', () => {
  it('drapeau baissé, ou sans clé : rien, et rien de lu', async () => {
    faux.prevue = false
    const { container } = monter()
    await act(async () => {})
    expect(container.textContent).toBe('')
    expect(faux.calcules).toEqual([])
    faux.prevue = true
    const sansCle = monter(null)
    await act(async () => {})
    expect(sansCle.container.textContent).toBe('')
    expect(faux.calcules).toEqual([])
  })

  it('les seuls dossiers réglés se calculent, dans l’ordre ; une ligne par alerte non vue, qui mène à sa Vue d’ensemble', async () => {
    const { container } = monter()
    expect(container.textContent).toBe('')
    expect(await screen.findByText(phraseDuTitre(1))).toBeTruthy()
    expect(faux.calcules).toEqual(['d1', 'd2', 'd4'])
    expect(container.textContent).toContain('Cabinet Alpha')
    expect(container.textContent).not.toContain('Cabinet Bêta')
    expect(container.textContent).not.toContain('Mon cabinet')
    const lien = screen.getByRole('link', { name: LIBELLE_OUVRIR_LA_VUE_D_ENSEMBLE })
    expect(lien.getAttribute('href')).toBe('/dossiers/d1/checklist')
  })

  it('une baisse se dit aussi, sa ligne disant la variation et le seuil de baisse', async () => {
    faux.seuils = { etat: 'lus', seuils: new Map([['d1', seuil(20)], ['d3', seuil(null, 15)]]) }
    faux.parDossier.d3 = { etat: 'lue', hausse: baisse }
    const { container } = monter()
    expect(await screen.findByText(phraseDuTitre(2))).toBeTruthy()
    expect(faux.calcules).toEqual(['d1', 'd3'])
    expect(container.textContent).toContain('Cabinet Gamma')
    expect(container.textContent).toContain('trimestre −25,0')
    expect(container.textContent).toContain('seuil de baisse 15')
  })

  it('rien quand rien n’attend le cabinet', async () => {
    faux.parDossier.d1 = { etat: 'lue', hausse: { etat: 'sans_seuil' } }
    const { container } = monter()
    await act(async () => {})
    await act(async () => {})
    expect(faux.calcules).toEqual(['d1', 'd2', 'd4'])
    expect(container.textContent).toBe('')
  })

  it('les seuils illisibles se disent ; une alerte illisible se compte ; au-delà du plafond, le reste se dit', async () => {
    faux.seuils = { etat: 'illisible', motif: 'coupée' }
    const illisibles = monter()
    expect(await screen.findByText(SEUILS_ILLISIBLES)).toBeTruthy()
    illisibles.unmount()

    faux.seuils = { etat: 'lus', seuils: new Map([['d1', seuil(20)], ['d2', seuil(15)], ['d3', seuil(null, 10)]]) }
    faux.parDossier.d3 = { etat: 'illisible', motif: 'coupée' }
    faux.plafond = 2
    faux.calcules = []
    monter()
    expect(await screen.findByText(phraseDesNonCalcules(1))).toBeTruthy()
    expect(faux.calcules).toEqual(['d1', 'd2'])
    faux.plafond = 10
    faux.calcules = []
    const tous = monter()
    expect(await tous.findByText(phraseDesIllisibles(1))).toBeTruthy()
  })
})
