import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { factureFigee } from '../../test/mentionsFigees'
import { REFUS_DU_DEPOT, type DepotLu } from '../../lib/depotDesHonoraires'
import type { LectureDuDepot } from '../../lib/depotDesHonorairesLecture'
import type { LectureDeLaDesignation } from '../../lib/dossierDuCabinetLecture'
import DepotDesHonorairesCard, { type FacturesDeLOnglet } from './DepotDesHonorairesCard'

// « HONORAIRES DÉPOSÉS CHEZ LES CLIENTS » (ligne 47, LM8). Les deux états du drapeau : baissé, rien ne se rend ni ne se lit ;
// levé, la carte ne vit que dans le dossier du cabinet, dit « Chargement… » avant ses lectures, n'offre aucun geste sur une
// lecture illisible ni sur des factures lues en partie, dit le refus avant le clic, nomme dans la confirmation ce qui part et
// chez qui, passe le geste sous un verrou (deux clics du même `act` : un dépôt) et fait relire. Données FICTIVES.

const etat = vi.hoisted(() => ({
  leve: true,
  designation: null as LectureDeLaDesignation | null,
  lecture: null as LectureDuDepot | null,
  relecture: -1,
  lectures: 0,
  depots: [] as unknown[],
  issue: { ok: true, pieceId: 'p-neuve' } as { ok: true; pieceId: string } | { ok: false; message: string },
}))

vi.mock('../../lib/depotDesHonoraires', async (original) => {
  const reel = await original<typeof import('../../lib/depotDesHonoraires')>()
  return { ...reel, get DEPOT_DES_HONORAIRES_PREVU() { return etat.leve } }
})
vi.mock('../../lib/dossierDuCabinetLecture', () => ({ useDesignationDuDossier: () => { etat.lectures += 1; return etat.designation } }))
vi.mock('../../lib/depotDesHonorairesLecture', () => ({
  useDepotDesHonoraires: (_d: string, cabinet: string | null, relecture: number) => {
    etat.lectures += 1
    etat.relecture = relecture
    return cabinet === null ? null : etat.lecture
  },
  deposerChezLeClient: async (p: unknown) => {
    etat.depots.push(p)
    await new Promise((r) => setTimeout(r, 0))
    return etat.issue
  },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const K = 'k0000000-0000-4000-8000-00000000000a'
const C = 'c0000000-0000-4000-8000-00000000000c'
const designee = (actuel: string | null = K): LectureDeLaDesignation => ({
  etat: 'lue', dossierId: K, cabinetId: 'cab', dossierActuel: actuel, nomDeLActuel: 'Cabinet fictif', actuelPorteUneFactureValidee: true,
  porteUnAccesClient: false, porteUneFactureEnMandataire: false,
})
const lue = (depots: DepotLu[] = []): LectureDuDepot => ({
  etat: 'lue', dossierId: K, depots, liens: [{ id: 'h1', facture_id: 'f1', lettre_id: 'l1', cree_le: '2027-11-01T10:00:00Z' }],
  lettres: [{ id: 'l1', dossier_client_id: C }], dossiers: [{ id: C, nom: 'Client fictif' }],
})
const facture = factureFigee({ dossier_id: K, montant_ttc: 180 })
const lues = (motif: string | null = null): FacturesDeLOnglet => ({ factures: [facture], motif })
const texte = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const bouton = () => screen.queryByRole('button', { name: 'Déposer chez le client' })

let confirmer: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  etat.leve = true; etat.designation = designee(); etat.lecture = lue(); etat.lectures = 0; etat.depots = []
  etat.issue = { ok: true, pieceId: 'p-neuve' }
  confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { confirmer.mockRestore() })

describe('drapeau baissé', () => {
  it('ne rend rien et ne lit rien', () => {
    etat.leve = false
    const { container } = render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(container.textContent).toBe('')
    expect(etat.lectures).toBe(0)
  })
})

describe('drapeau levé', () => {
  it('ne vit que dans le dossier du cabinet', () => {
    etat.designation = designee('autre')
    const { container } = render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(container.textContent).toBe('')
  })

  it('dit « Chargement… » avant ses lectures, et n’affirme rien', () => {
    etat.lecture = null
    render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(texte()).toContain('Chargement…')
    expect(bouton()).toBeNull()
    etat.lecture = lue()
    render(<DepotDesHonorairesCard dossierId={K} lues={null} />)
    expect(texte()).not.toContain('Aucune facture')
  })

  it('n’offre aucun geste sur une lecture illisible, ni sur des factures lues en partie', () => {
    etat.lecture = { etat: 'illisible', dossierId: K, motif: 'refus fictif' }
    const { unmount } = render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(texte()).toContain('refus fictif')
    expect(bouton()).toBeNull()
    unmount()
    etat.lecture = lue()
    render(<DepotDesHonorairesCard dossierId={K} lues={lues('lecture interrompue')} />)
    expect(texte()).toContain('lecture interrompue')
    expect(bouton()).toBeNull()
  })

  it('une désignation illisible ne laisse rien déposer', () => {
    etat.designation = { etat: 'illisible', dossierId: K, motif: 'désignation refusée' }
    render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(texte()).toContain('désignation refusée')
    expect(bouton()).toBeNull()
  })

  it('dépose sur un clic confirmé qui nomme ce qui part et chez qui ; deux clics du même act : un dépôt, puis une relecture', async () => {
    render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(texte()).toContain('À déposer')
    const avant = etat.relecture
    await act(async () => {
      fireEvent.click(bouton()!)
      fireEvent.click(bouton()!)
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(etat.depots).toHaveLength(1)
    expect(etat.depots[0]).toMatchObject({ dossierId: K, dossierClientId: C, numeroDeLOrigine: null })
    const question = String(confirmer.mock.calls[0][0])
    expect(question).toContain('la facture F2027-0001')
    expect(question).toContain('« Client fictif »')
    expect(question).toContain('« Facture F2027-0001.pdf »')
    expect(etat.relecture).toBe(avant + 1)
    expect(texte()).toContain('Facture F2027-0001 déposée chez « Client fictif »')
  })

  it('un clic non confirmé ne dépose rien ; un refus de la base se dit', async () => {
    confirmer.mockReturnValue(false)
    render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    fireEvent.click(bouton()!)
    expect(etat.depots).toHaveLength(0)
    confirmer.mockReturnValue(true)
    etat.issue = { ok: false, message: 'Le dossier du client n’existe plus dans ce cabinet.' }
    await act(async () => { fireEvent.click(bouton()!); await new Promise((r) => setTimeout(r, 5)) })
    expect(texte()).toContain('Le dossier du client n’existe plus dans ce cabinet.')
  })

  it('dit le refus avant le clic : un dossier client que le compte ne lit pas', () => {
    etat.lecture = { ...lue(), dossiers: [] } as LectureDuDepot
    render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(bouton()).toHaveProperty('disabled', true)
    expect(texte()).toContain(REFUS_DU_DEPOT.dossierClientFerme)
  })

  it('une facture chez le client se dit déposée, sans bouton ; sa pièce retirée la rend à déposer (LM8-Q1)', () => {
    const depot: DepotLu = { facture_id: 'f1', depot: 1, dossier_client_id: C, piece_id: 'p1', depose_le: '2027-11-03T09:00:00Z', presente: true }
    etat.lecture = lue([depot])
    const { unmount } = render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(texte()).toContain('Déposée le 03/11/2027')
    expect(bouton()).toBeNull()
    unmount()
    etat.lecture = lue([{ ...depot, presente: false }])
    render(<DepotDesHonorairesCard dossierId={K} lues={lues()} />)
    expect(texte()).toContain('a été retirée du dossier du client')
    expect(bouton()).toHaveProperty('disabled', false)
  })
})
