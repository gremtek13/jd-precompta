import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { motsDuRefus } from '../../lib/dossierDuCabinet'
import type { LectureDeLaDesignation } from '../../lib/dossierDuCabinetLecture'
import BarreDossiers from '../../components/BarreDossiers'
import DossierDuCabinetCard from './DossierDuCabinetCard'

// LA CARTE « DOSSIER DU CABINET » ET LA PLACE À PART DANS LA BARRE (ligne 47, LM2). Les deux états du drapeau : baissé, la carte
// ne rend rien ; levé, elle dit la désignation, offre au chef seul de désigner ou de retirer, dit ses refus AVANT le clic aux
// mots de la fonction, nomme le dossier dans sa confirmation, passe la fonction de la base seule sous un verrou, et fait
// relire. La barre range le dossier désigné sous « Mon cabinet ». Données FICTIVES.

const etat = vi.hoisted(() => ({ leve: true, chef: true, appels: [] as [string, string | null][], issue: { ok: true } as { ok: true } | { ok: false; message: string } }))

vi.mock('../../lib/dossierDuCabinet', async (original) => {
  const reel = await original<typeof import('../../lib/dossierDuCabinet')>()
  return { ...reel, get DOSSIER_DU_CABINET_PREVU() { return etat.leve } }
})
vi.mock('../../lib/dossierDuCabinetLecture', () => ({
  designerLeDossierDuCabinet: async (cabinet: string, dossier: string | null) => { etat.appels.push([cabinet, dossier]); return etat.issue },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: etat.chef }) }))

const D = 'd0000000-0000-4000-8000-000000000001'
const lue = (p: Partial<Extract<LectureDeLaDesignation, { etat: 'lue' }>> = {}): LectureDeLaDesignation => ({
  etat: 'lue', dossierId: D, cabinetId: 'cab', dossierActuel: null, nomDeLActuel: null, actuelPorteUneFactureValidee: false,
  porteUnAccesClient: false, porteUneFactureEnMandataire: false, ...p,
})

let relectures = 0
const monter = (lecture: LectureDeLaDesignation | null) => render(
  <DossierDuCabinetCard dossierId={D} dossierNom="Cabinet fictif" lecture={lecture} onDesignationEcrite={() => { relectures += 1 }} />,
)

beforeEach(() => { etat.leve = true; etat.chef = true; etat.appels = []; etat.issue = { ok: true }; relectures = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('la carte du dossier du cabinet', () => {
  it('baissé : rien', () => {
    etat.leve = false
    const { container } = monter(lue())
    expect(container.innerHTML).toBe('')
  })

  it('pas revenue : « Chargement… », aucun geste ; illisible : le motif, aucun geste', () => {
    monter(null)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('illisible : le motif, aucun geste', () => {
    monter({ etat: 'illisible', dossierId: D, motif: 'accès refusé' })
    expect(screen.getByRole('alert').textContent).toContain('accès refusé')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('aucun désigné : le chef désigne, la confirmation nomme le dossier et dit l’irréversibilité, la base seule écrit', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter(lue())
    const bouton = screen.getByRole('button', { name: 'Désigner ce dossier comme celui du cabinet' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('« Cabinet fictif »')
    expect(confirmer.mock.calls[0][0]).toContain('irréversible dès que le dossier porte une facture validée')
    expect(etat.appels).toEqual([['cab', D]])
    expect(relectures).toBe(1)
    expect(await screen.findByText('Ce dossier est désormais le dossier du cabinet ✓')).toBeTruthy()
  })

  it('le refus dit AVANT le clic, aux mots de la fonction : un accès client, une facture en mandataire, l’irréversible', () => {
    monter(lue({ porteUnAccesClient: true }))
    expect(screen.getByText(motsDuRefus('accesClient'))).toBeTruthy()
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('désigné, avec une facture validée : le retrait se refuse avant le clic', () => {
    monter(lue({ dossierActuel: D, actuelPorteUneFactureValidee: true }))
    expect(screen.getByText(/^C’est le dossier du cabinet/)).toBeTruthy()
    expect(screen.getByText(motsDuRefus('irreversible'))).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Retirer la désignation' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('un autre désigné : la confirmation nomme celui qu’il remplace ; un refus de la base se dit', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    etat.issue = { ok: false, message: 'Accès refusé à ce cabinet.' }
    monter(lue({ dossierActuel: 'autre', nomDeLActuel: 'Ancien dossier' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Désigner ce dossier à sa place' })) })
    expect(confirmer.mock.calls[0][0]).toContain('Il remplace « Ancien dossier »')
    expect(screen.getByRole('alert').textContent).toContain('Rien n’a changé : Accès refusé à ce cabinet.')
  })

  it('un membre qui n’est pas chef : la désignation se dit, aucun geste', () => {
    etat.chef = false
    monter(lue({ dossierActuel: D }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Seul un comptable en chef désigne le dossier du cabinet.')).toBeTruthy()
  })
})

describe('la barre latérale : « Mon cabinet » à part', () => {
  const barre = (designes: ReadonlySet<string>, motifDesignation: string | null = null) => render(
    <MemoryRouter>
      <BarreDossiers
        dossiers={[{ id: 'a', nom: 'Client A' }, { id: D, nom: 'Cabinet fictif' }]} dossiersDuCabinet={designes}
        motifDesignation={motifDesignation} chargement={false} motif={null} recherche="" dossierOuvertId={null} ongletActif={null} reduite={false}
      />
    </MemoryRouter>,
  )
  it('le dossier désigné sous « Mon cabinet », hors des dossiers des clients', () => {
    barre(new Set([D]))
    expect(screen.getByRole('region', { name: 'Mon cabinet' }).textContent).toContain('Cabinet fictif')
    expect(screen.getByRole('region', { name: 'Dossiers' }).textContent).not.toContain('Cabinet fictif')
  })
  it('sans désignation : la barre d’hier ; une désignation illisible se dit', () => {
    barre(new Set(), 'délai dépassé')
    expect(screen.queryByRole('region', { name: 'Mon cabinet' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Dossiers' }).textContent).toContain('Cabinet fictif')
    expect(screen.getByText(/n’a pas pu être distingué/)).toBeTruthy()
  })
})
