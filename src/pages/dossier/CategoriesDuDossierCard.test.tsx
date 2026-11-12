import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { Categorie } from '../../lib/types'
import CategoriesDeLaBalance from './CategoriesDeLaBalance'
import CategoriesDuDossierCard from './CategoriesDuDossierCard'

// Les deux écrans de PC7, le drapeau `CATEGORIES_DU_DOSSIER_PREVUES` levé par un accesseur (baissé, la carte ne rend rien) :
// « Chargement… » avant la lecture, aucun geste sur une lecture partielle, la création sous verrou, rien de coché d'avance.
const garde = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/categoriesDuDossier', async (original) => {
  const vrai = await original<typeof import('../../lib/categoriesDuDossier')>()
  return { ...vrai, get CATEGORIES_DU_DOSSIER_PREVUES() { return garde.leve } }
})
const lecture = vi.hoisted(() => ({ lire: vi.fn(), emplois: vi.fn(), creer: vi.fn(), modifier: vi.fn(), supprimer: vi.fn() }))
vi.mock('../../lib/categoriesDuDossierLecture', () => ({
  lireLesCategoriesDuDossier: lecture.lire, lireLesEmplois: lecture.emplois, creerLesCategories: lecture.creer,
  modifierLaCategorie: lecture.modifier, supprimerLaCategorie: lecture.supprimer,
}))

const commune = (c: Partial<Categorie>): Categorie => ({
  id: 'c1', dossier_id: null, code: 'loyer', libelle: 'Loyer', ordre: 0, compte_comptable: '613200', poste_2035: 'Loyers et charges locatives', ...c,
})
const LUES = { dossierId: 'd1', etat: 'lues' as const, categories: [commune({})] }

beforeEach(() => {
  garde.leve = true
  for (const f of Object.values(lecture)) f.mockReset()
})

describe('la carte des catégories du dossier', () => {
  it('baissé, ne rend ni ne lit rien', () => {
    garde.leve = false
    const { container } = render(<CategoriesDuDossierCard dossierId="d1" plan={PLAN_PAR_DEFAUT} />)
    expect(container.textContent).toBe('')
    expect(lecture.lire).not.toHaveBeenCalled()
  })
  it('« Chargement… » avant la lecture, puis aucun geste sur une lecture partielle', async () => {
    let rendre: (v: unknown) => void = () => {}
    lecture.lire.mockReturnValue(new Promise((r) => { rendre = r }))
    render(<CategoriesDuDossierCard dossierId="d1" plan={PLAN_PAR_DEFAUT} />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Créer/ })).toBeNull()
    await act(async () => { rendre({ dossierId: 'd1', etat: 'incompletes', motif: 'lecture incomplète' }) })
    expect(screen.getByText(/n’ont pas été lues en entier/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Créer/ })).toBeNull()
  })
  it('crée sous verrou : deux clics, une écriture, au code stable et au poste choisi', async () => {
    lecture.lire.mockResolvedValue(LUES)
    lecture.creer.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true }), 0)))
    render(<CategoriesDuDossierCard dossierId="d1" plan={PLAN_PAR_DEFAUT} />)
    const bouton = await screen.findByRole('button', { name: 'Créer la catégorie' })
    expect((bouton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Libellé (lu par le client)'), { target: { value: 'Petit matériel' } })
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: '6063' } })
    fireEvent.change(screen.getByLabelText('Poste de la 2035'), { target: { value: 'Achats' } })
    expect((bouton as HTMLButtonElement).disabled).toBe(false)
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await waitFor(() => expect(lecture.lire).toHaveBeenCalledTimes(2))
    expect(lecture.creer).toHaveBeenCalledTimes(1)
    expect(lecture.creer).toHaveBeenCalledWith('d1', [{ code: 'dossier_606300', libelle: 'Petit matériel', compte_comptable: '606300', poste_2035: 'Achats' }])
  })
  it('dit le refus du barème avant le clic', async () => {
    lecture.lire.mockResolvedValue(LUES)
    render(<CategoriesDuDossierCard dossierId="d1" plan={PLAN_PAR_DEFAUT} />)
    await screen.findByRole('button', { name: 'Créer la catégorie' })
    fireEvent.change(screen.getByLabelText('Libellé (lu par le client)'), { target: { value: 'Kilomètres' } })
    fireEvent.change(screen.getByLabelText('Compte'), { target: { value: '625110' } })
    expect(screen.getByText(/celui des indemnités kilométriques du plan de ce dossier/)).toBeTruthy()
  })
})

describe('le troisième temps de la carte de la balance', () => {
  const BALANCE = [{ compte: '606400', libelle: 'Fournitures', debit: 12, credit: 0 }, { compte: '613200', libelle: 'Loyer', debit: 600, credit: 0 }]
  it('« Chargement… », puis la proposition, rien de coché ni de deviné, le compte déjà tenu écarté et dit', async () => {
    lecture.lire.mockResolvedValue(LUES)
    render(<CategoriesDeLaBalance dossierId="d1" lignes={BALANCE} plan={PLAN_PAR_DEFAUT} />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    const case606 = await screen.findByRole('checkbox', { name: 'Créer la catégorie 606400' })
    expect((case606 as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole('checkbox', { name: 'Créer la catégorie 613200' })).toBeNull()
    expect(screen.getByText(/déjà le compte de la catégorie « Loyer »/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Créer la catégorie cochée/ })).toBeNull()
    fireEvent.click(case606)
    expect(screen.getByText(/Choisissez le poste de la 2035/)).toBeTruthy()
    expect(lecture.creer).not.toHaveBeenCalled()
  })
})
