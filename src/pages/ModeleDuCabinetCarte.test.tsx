import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModeleDuCabinetCarte from './ModeleDuCabinetCarte'
import { modeleDeLaReponse, type LectureDuModele } from '../lib/modeleDuCabinet'
import { ROLES_DE_LA_BASE } from '../test/rolesDeLaBase'

// LE MODÈLE DE PLAN DU CABINET, À L'ÉCRAN (ligne 43, PC5) : ce qu'aucun calcul pur ne voit — aucun geste avant que le modèle
// ET les catégories communes soient lus en entier, le refus dit avant le clic, la confirmation qui nomme, le réglage sous
// verrou (deux clics dans le même `act`) PUIS la relecture. Les règles : modeleDuCabinet.test.ts.

const faux = vi.hoisted(() => ({
  modele: null as unknown as LectureDuModele,
  categories: { etat: 'lus', comptes: [] as string[] } as { etat: 'lus'; comptes: string[] } | { etat: 'incomplets'; motif: string },
  reglages: [] as { cabinetId: string; comptes: unknown[] }[],
  retenue: null as Promise<void> | null,
  relu: null as unknown as LectureDuModele,
}))

vi.mock('../lib/modeleDuCabinetLecture', () => ({
  lireLeModeleDuCabinet: async (cabinetId: string) => ({ cabinetId, lecture: faux.modele }),
  lireLesComptesDesCategoriesCommunes: async () => faux.categories,
  reglerPuisRelireLeModele: async (cabinetId: string, comptes: unknown[]) => {
    faux.reglages.push({ cabinetId, comptes })
    if (faux.retenue) await faux.retenue
    return { regle: true, lecture: faux.relu }
  },
}))

function lecture(regles: Record<string, string> = {}): LectureDuModele {
  return modeleDeLaReponse({
    data: ROLES_DE_LA_BASE.map((r) => ({
      role: r.role, compte: regles[r.role] ?? r.compteDefaut, libelle: r.libelleDefaut,
      prefixe_auxiliaire: r.prefixeAuxiliaireDefaut, origine: r.role in regles ? 'modele_du_cabinet' : 'application',
    })),
    error: null,
  })
}

async function monter() {
  await act(async () => { render(<ModeleDuCabinetCarte cabinetId="cab" />) })
}

const compteDeLaBanque = () => screen.getByLabelText('Compte — Banque') as HTMLInputElement
const bouton = () => screen.queryByRole('button', { name: /Enregistrer le modèle|Enregistrement…/ }) as HTMLButtonElement | null

describe('la carte du modèle de plan du cabinet', () => {
  beforeEach(() => {
    faux.modele = lecture()
    faux.categories = { etat: 'lus', comptes: ['606100'] }
    faux.reglages = []
    faux.retenue = null
    faux.relu = lecture({ banque: '512100' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('les catégories communes lues en partie : l’écran le dit et n’offre aucun geste', async () => {
    faux.categories = { etat: 'incomplets', motif: 'lecture partielle (3 sur 10)' }
    await monter()
    expect(screen.getByText(/lecture partielle \(3 sur 10\)/)).toBeTruthy()
    expect(bouton()).toBeNull()
    expect(screen.queryByLabelText('Compte — Banque')).toBeNull()
  })

  it('le modèle refusé : aucun geste non plus', async () => {
    faux.modele = { modele: null, motif: 'modèle de plan refusé : Accès refusé à ce cabinet.' }
    await monter()
    expect(screen.getByText(/Accès refusé à ce cabinet/)).toBeTruthy()
    expect(bouton()).toBeNull()
  })

  it('rien de changé : le bouton attend ; un compte hors forme : le refus de la base dit avant le clic', async () => {
    await monter()
    expect(bouton()!.disabled).toBe(true)
    await act(async () => { fireEvent.change(compteDeLaBanque(), { target: { value: '5121' } }) })
    expect(screen.getByText('Le compte du rôle « banque » s\'écrit en six chiffres : « 5121 » n\'en est pas un.')).toBeTruthy()
    expect(bouton()!.disabled).toBe(true)
  })

  it('deux clics dans le même `act` ne règlent qu’une fois ; la confirmation nomme le changement ; le modèle relu s’affiche', async () => {
    await monter()
    await act(async () => { fireEvent.change(compteDeLaBanque(), { target: { value: '512100' } }) })
    expect(screen.getByText('Banque : 512000 « Banque » → 512100 « Banque »')).toBeTruthy()
    let liberer = () => {}
    faux.retenue = new Promise<void>((r) => { liberer = r })
    const b = bouton()!
    await act(async () => { b.click(); b.click() })
    expect(faux.reglages).toHaveLength(1)
    expect(faux.reglages[0]).toEqual({ cabinetId: 'cab', comptes: [{ role: 'banque', compte: '512100', libelle: null, prefixe_auxiliaire: null }] })
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('512000 « Banque » → 512100 « Banque »')
    expect(bouton()!.textContent).toBe('Enregistrement…')
    await act(async () => { liberer() })
    await waitFor(() => expect(screen.getByText(/Modèle enregistré/)).toBeTruthy())
    expect(compteDeLaBanque().value).toBe('512100')
    expect(bouton()!.disabled).toBe(true)
  })

  it('la confirmation refusée : rien ne part', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    await monter()
    await act(async () => { fireEvent.change(compteDeLaBanque(), { target: { value: '512100' } }) })
    await act(async () => { bouton()!.click() })
    expect(faux.reglages).toHaveLength(0)
  })
})
