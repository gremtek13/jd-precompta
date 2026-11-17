import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HausseDuChiffreDAffairesCard from './HausseDuChiffreDAffairesCard'
import {
  DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL, LIBELLES_DES_SEUILS, REGLAGE_ILLISIBLE, SEUILS_HORS_BORNES, SEUILS_VIDES, type SensDuSeuil,
} from '../../lib/hausseDuChiffreDAffaires'
import type { LectureDuReglage } from '../../lib/hausseDuChiffreDAffairesLecture'

// LA CARTE DES DEUX SEUILS DE L'ALERTE DU CHIFFRE D'AFFAIRES, À L'ÉCRAN (onglet Informations). Ce que le module ne voit pas : rien
// avant la lecture, aucun formulaire sur une lecture ratée, le drapeau dans ses deux états, le refus de chaque seuil dit avant le
// clic sous ses bornes à lui, une seule écriture pour deux clics du même rendu, celle du seul sens réglé, contre SA valeur LUE,
// puis relue — la saisie de l'autre seuil restant telle qu'elle est tapée. La lecture et l'écriture sont doublées. Données
// FICTIVES.
const faux = vi.hoisted(() => ({
  prevue: true,
  lectures: {} as Record<string, LectureDuReglage>,
  lues: [] as string[],
  ecritures: [] as { dossierId: string; sens: string; lu: number | null; seuil: number | null }[],
  porteEcriture: null as Promise<void> | null,
  refus: null as string | null,
}))

vi.mock('../../lib/hausseDuChiffreDAffaires', async (original) => {
  const vrai = await original<typeof import('../../lib/hausseDuChiffreDAffaires')>()
  return { ...vrai, get HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE() { return faux.prevue } }
})

vi.mock('../../lib/hausseDuChiffreDAffairesLecture', () => ({
  lireLeReglageDeLaHausse: async (dossierId: string) => {
    faux.lues.push(dossierId)
    return faux.lectures[dossierId]
  },
  reglerLeSeuil: async (dossierId: string, sens: 'hausse' | 'baisse', lu: number | null, seuil: number | null) => {
    faux.ecritures.push({ dossierId, sens, lu, seuil })
    await faux.porteEcriture
    if (faux.refus) return { ok: false, erreur: faux.refus }
    const avant = faux.lectures[dossierId]
    const ligne = avant?.etat === 'lu' ? avant.seuil : null
    faux.lectures[dossierId] = lu$(dossierId, sens === 'hausse' ? seuil : ligne?.seuil_de_hausse ?? null,
      sens === 'baisse' ? seuil : ligne?.seuil_de_baisse ?? null)
    return { ok: true, seuil }
  },
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'u-chef' } } }) }))

function lu$(dossierId: string, hausse: number | null, baisse: number | null = null): LectureDuReglage {
  return {
    dossierId, etat: 'lu', vues: [],
    seuil: { dossier_id: dossierId, seuil_de_hausse: hausse, seuil_de_baisse: baisse, regle_par: 'u-chef', regle_le: '2026-11-15T10:00:00Z' },
  }
}

/** Le formulaire d'un seuil : son champ et son bouton. */
function formulaire(sens: SensDuSeuil) {
  const form = screen.getByRole('form', { name: LIBELLES_DES_SEUILS[sens] })
  return {
    champ: within(form).getByRole('textbox') as HTMLInputElement,
    bouton: within(form).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement,
  }
}

beforeEach(() => {
  // Levé le 17/11/2026 (235) : l'état servi ; « drapeau baissé » joue l'état d'avant, tant que son code existe.
  DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU = true
  faux.prevue = true
  faux.lectures = {}
  faux.lues = []
  faux.ecritures = []
  faux.porteEcriture = null
  faux.refus = null
})

describe('la carte des seuils', () => {
  it('drapeau baissé : rien, et rien de lu', async () => {
    faux.prevue = false
    const { container } = render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    await act(async () => {})
    expect(container.textContent).toBe('')
    expect(faux.lues).toEqual([])
  })

  it('« Chargement… » avant la lecture ; une lecture ratée n’offre aucun formulaire', async () => {
    faux.lectures.d1 = { dossierId: 'd1', etat: 'illisible', motif: 'coupée' }
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(await screen.findByText(REGLAGE_ILLISIBLE)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('sans seuil, le dit ; deux formulaires, chacun refusant avant le clic ce que ses bornes refusent', async () => {
    faux.lectures.d1 = { dossierId: 'd1', etat: 'lu', seuil: null, vues: [] }
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    expect(await screen.findByText(SEUILS_VIDES)).toBeTruthy()
    const hausse = formulaire('hausse')
    const baisse = formulaire('baisse')
    expect([hausse.bouton.disabled, baisse.bouton.disabled]).toEqual([true, true])
    // 101 % : une hausse permise, une baisse refusée (au-delà de 100 %, le chiffre serait sous zéro).
    fireEvent.change(hausse.champ, { target: { value: '101' } })
    fireEvent.change(baisse.champ, { target: { value: '101' } })
    expect(screen.queryByText(SEUILS_HORS_BORNES.hausse)).toBeNull()
    expect(screen.getByText(SEUILS_HORS_BORNES.baisse)).toBeTruthy()
    expect([hausse.bouton.disabled, baisse.bouton.disabled]).toEqual([false, true])
    fireEvent.change(baisse.champ, { target: { value: '100' } })
    expect(screen.queryByText(SEUILS_HORS_BORNES.baisse)).toBeNull()
    expect(baisse.bouton.disabled).toBe(false)
    fireEvent.change(hausse.champ, { target: { value: '0' } })
    expect(screen.getByText(SEUILS_HORS_BORNES.hausse)).toBeTruthy()
    expect(hausse.bouton.disabled).toBe(true)
  })

  it('deux clics du même rendu : une seule écriture, du seul seuil réglé, contre SA valeur lue ; puis relue, l’autre saisie gardée', async () => {
    faux.lectures.d1 = lu$('d1', 15, 10)
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    await screen.findByDisplayValue('15')
    const baisse = formulaire('baisse')
    const hausse = formulaire('hausse')
    expect(baisse.champ.value).toBe('10')
    fireEvent.change(hausse.champ, { target: { value: '30' } })
    fireEvent.change(baisse.champ, { target: { value: '25' } })
    let ouvrir!: () => void
    faux.porteEcriture = new Promise<void>((r) => { ouvrir = r })
    act(() => { fireEvent.click(baisse.bouton); fireEvent.click(baisse.bouton) })
    await act(async () => { ouvrir() })
    expect(faux.ecritures).toEqual([{ dossierId: 'd1', sens: 'baisse', lu: 10, seuil: 25 }])
    expect(await screen.findByText('Seuil de baisse enregistré : 25 % ✓')).toBeTruthy()
    expect(faux.lues.filter((d) => d === 'd1')).toHaveLength(2)
    expect(formulaire('baisse').champ.value).toBe('25')
    // La hausse tapée et pas encore enregistrée reste dans son champ.
    expect(formulaire('hausse').champ.value).toBe('30')
  })

  it('un refus de la base se dit, et la valeur relue reste', async () => {
    faux.lectures.d1 = lu$('d1', 15)
    faux.refus = 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l\'enregistrer.'
    render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    fireEvent.change(await screen.findByDisplayValue('15'), { target: { value: '30' } })
    await act(async () => { fireEvent.click(formulaire('hausse').bouton) })
    expect(await screen.findByText(faux.refus)).toBeTruthy()
    expect(faux.ecritures).toEqual([{ dossierId: 'd1', sens: 'hausse', lu: 15, seuil: 30 }])
    expect(formulaire('hausse').champ.value).toBe('15')
  })
})

// CA2-Q1 : l'auteur de chaque seuil, sous `AUTEUR_DE_CHAQUE_SEUIL_PREVU`. Baissé, la ligne d'hier (le dernier réglage de la
// ligne) ; levé, une ligne par seuil — « toi », l'adresse que la session lit dans l'équipe, sinon « le cabinet », jamais un
// identifiant.
describe('l’auteur de chaque seuil (CA2-Q1)', () => {
  const NB = String.fromCharCode(160)
  const lecture: LectureDuReglage = {
    dossierId: 'd1', etat: 'lu', vues: [], equipe: new Map([['u-membre', 'membre@cabinet.example']]),
    seuil: {
      dossier_id: 'd1', seuil_de_hausse: 20, seuil_de_baisse: 10, regle_par: 'u-chef', regle_le: '2026-11-16T10:00:00Z',
      seuil_de_hausse_regle_par: 'u-membre', seuil_de_hausse_regle_le: '2026-11-14T10:00:00Z',
      seuil_de_baisse_regle_par: 'u-parti', seuil_de_baisse_regle_le: '2026-11-16T10:00:00Z',
    },
  }

  it('drapeau baissé : le dernier réglage de la ligne, comme hier', async () => {
    DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU = false
    faux.lectures.d1 = lecture
    const { container } = render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    await screen.findByText(/Dernier réglage/)
    expect(container.textContent).toContain(`Seuil de hausse : 20${NB}% ; seuil de baisse : 10${NB}%. Dernier réglage le 16/11/2026, par toi.`)
    expect(screen.queryByText(/réglé le/)).toBeNull()
  })

  it('drapeau levé : chaque seuil, son compte et sa date ; l’adresse lue dans l’équipe, sinon « le cabinet »', async () => {
    DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU = true
    faux.lectures.d1 = lecture
    const { container } = render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
    await screen.findByText(/réglé le 14\/11\/2026/)
    expect(container.textContent).toContain(`Hausse : 20${NB}%, réglé le 14/11/2026 par membre@cabinet.example.`)
    expect(container.textContent).toContain(`Baisse : 10${NB}%, réglé le 16/11/2026 par le cabinet.`)
    expect(screen.queryByText(/Dernier réglage/)).toBeNull()
    expect(container.textContent).not.toMatch(/u-parti|u-membre/)
  })

  // CA2Q1-Q1 (A) : une marque « vue avec le client » dit qui l'a posée par la règle des seuils, sous les deux états du drapeau
  // (la base garde déjà son auteur) — jamais le début d'un identifiant.
  for (const leve of [true, false]) {
    it(`les marques « vue avec le client » : toi, l’adresse lue, sinon « le cabinet » (drapeau ${leve ? 'levé' : 'baissé'})`, async () => {
      DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU = leve
      faux.lectures.d1 = {
        ...lecture,
        vues: [
          { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u-membre', vue_le: '2026-11-16T09:00:00Z' },
          { dossier_id: 'd1', annee: 2026, trimestre: 2, vue_par: 'u-parti', vue_le: '2026-08-10T09:00:00Z' },
          { dossier_id: 'd1', annee: 2026, trimestre: 1, vue_par: 'u-chef', vue_le: '2026-05-04T09:00:00Z' },
        ],
      }
      const { container } = render(<HausseDuChiffreDAffairesCard dossierId="d1" />)
      await screen.findByText(/Trimestres vus avec le client/)
      expect(container.textContent).toContain('3e trimestre 2026 (juillet à septembre) : vue avec le client le 16/11/2026, par membre@cabinet.example.')
      expect(container.textContent).toContain('2e trimestre 2026 (avril à juin) : vue avec le client le 10/08/2026, par le cabinet.')
      expect(container.textContent).toContain('1er trimestre 2026 (janvier à mars) : vue avec le client le 04/05/2026, par toi.')
      expect(container.textContent).not.toMatch(/u-parti|u-membre|autre compte/)
    })
  }
})
