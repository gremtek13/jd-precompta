import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { factureFigee } from '../../test/mentionsFigees'
import type { LettreAFacturer } from '../../lib/honorairesAFacturer'
import type { IssueDeLaFacturation, LectureDesHonoraires } from '../../lib/honorairesAFacturerLecture'
import type { LectureDeLaDesignation } from '../../lib/dossierDuCabinetLecture'
import type { FacturesDeLOnglet } from './DepotDesHonorairesCard'
import HonorairesAFacturerCard from './HonorairesAFacturerCard'

// « À FACTURER » (ligne 47, LM7). Les deux états du drapeau : baissé, rien ne se rend ni ne se lit ; levé, la carte ne vit
// que dans le dossier du cabinet, dit « Chargement… » avant ses lectures, n'offre aucun geste sur une lecture illisible ni
// sur des factures lues en partie, dit le refus avant le clic (le taux à choisir), nomme dans la confirmation le client, les
// périodes et le hors taxes, passe le geste sous un verrou (deux clics du même `act` : une facture), fait relire, et offre
// le brouillon créé. Données FICTIVES.

const etat = vi.hoisted(() => ({
  leve: true,
  designation: null as LectureDeLaDesignation | null,
  lecture: null as LectureDesHonoraires | null,
  relecture: -1,
  lectures: 0,
  appels: [] as { elements: unknown[]; taux: number }[],
  issue: { ok: true, factureId: 'f-neuve' } as IssueDeLaFacturation,
}))

vi.mock('../../lib/honorairesAFacturer', async (original) => {
  const reel = await original<typeof import('../../lib/honorairesAFacturer')>()
  return { ...reel, get HONORAIRES_FACTURES_PREVUS() { return etat.leve } }
})
vi.mock('../../lib/format', async (original) => {
  const reel = await original<typeof import('../../lib/format')>()
  return { ...reel, aujourdHuiAParis: () => '2026-11-11' }
})
vi.mock('../../lib/dossierDuCabinetLecture', () => ({ useDesignationDuDossier: () => { etat.lectures += 1; return etat.designation } }))
vi.mock('../../lib/honorairesAFacturerLecture', () => ({
  useHonorairesAFacturer: (_d: string, cabinet: string | null, relecture: number) => {
    etat.lectures += 1
    etat.relecture = relecture
    return cabinet === null ? null : etat.lecture
  },
  facturerLesHonoraires: async (_d: string, elements: unknown[], taux: number) => {
    etat.appels.push({ elements, taux })
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
const lettre: LettreAFacturer = {
  id: 'l1', remplace_id: null, dossier_client_id: C, date_effet: '2026-10-01', fin_initiale: '2026-12-31', reconduction_tacite: true,
  proposee_le: '2026-09-01', acceptee_le: '2026-09-05', refusee_le: null, retiree_le: null, fin_au: null, premier_exercice: 2026,
  honoraires: [
    { forme: 'forfait', libelle: 'Tenue mensuelle', montant_ht: 150, periodicite: 'mois' },
    { forme: 'tache', libelle: 'Déclaration 2035', montant_ht: 600, livrable: 'declaration_2035' },
  ],
}
const lue = (liens: Extract<LectureDesHonoraires, { etat: 'lue' }>['liens'] = []): LectureDesHonoraires => ({
  etat: 'lue', dossierId: K, lettres: [lettre], liens, avoirsRepris: [], dossiers: [{ id: C, nom: 'Client fictif' }],
})
const lues = (motif: string | null = null, factures = [factureFigee({ id: 'f1', dossier_id: K, montant_ttc: 180 })]): FacturesDeLOnglet => ({ factures, motif })
const texte = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const bouton = () => screen.queryByRole('button', { name: /^Facturer/ })
const choisirLeTaux = (valeur: string) => fireEvent.change(screen.getByLabelText('Taux de TVA des honoraires'), { target: { value: valeur } })

let confirmer: ReturnType<typeof vi.spyOn>
let relues: number
let ouverts: string[]
const carte = (l: FacturesDeLOnglet = lues()) => (
  <HonorairesAFacturerCard dossierId={K} lues={l} onFacturee={() => { relues += 1 }} ouvrirLeBrouillon={(id) => { ouverts.push(id) }} />
)
beforeEach(() => {
  etat.leve = true; etat.designation = designee(); etat.lecture = lue(); etat.lectures = 0; etat.appels = []
  etat.issue = { ok: true, factureId: 'f-neuve' }
  relues = 0; ouverts = []
  confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { confirmer.mockRestore() })

describe('drapeau baissé', () => {
  it('ne rend rien et ne lit rien', () => {
    etat.leve = false
    const { container } = render(carte())
    expect(container.textContent).toBe('')
    expect(etat.lectures).toBe(0)
  })
})

describe('drapeau levé', () => {
  it('ne vit que dans le dossier du cabinet', () => {
    etat.designation = designee('autre')
    const { container } = render(carte())
    expect(container.textContent).toBe('')
  })

  it('dit « Chargement… » avant ses lectures, et n’affirme rien', () => {
    etat.lecture = null
    const { unmount } = render(carte())
    expect(texte()).toContain('Chargement…')
    expect(bouton()).toBeNull()
    unmount()
    etat.lecture = lue()
    render(carte(null))
    expect(texte()).toContain('Chargement…')
    expect(texte()).not.toContain('Aucune lettre')
    expect(bouton()).toBeNull()
  })

  it('n’offre aucun geste sur une lecture illisible, sur des factures lues en partie, ni sous une désignation illisible', () => {
    etat.lecture = { etat: 'illisible', dossierId: K, motif: 'refus fictif' }
    const premier = render(carte())
    expect(texte()).toContain('refus fictif')
    expect(bouton()).toBeNull()
    premier.unmount()
    etat.lecture = lue()
    const second = render(carte(lues('lecture interrompue')))
    expect(texte()).toContain('lecture interrompue')
    expect(bouton()).toBeNull()
    second.unmount()
    etat.designation = { etat: 'illisible', dossierId: K, motif: 'désignation refusée' }
    render(carte())
    expect(texte()).toContain('désignation refusée')
    expect(bouton()).toBeNull()
  })

  it('range par client et par lettre ; le forfait échu coché, la tâche à cocher ; le refus dit avant le clic', () => {
    render(carte())
    expect(texte()).toContain('Client fictif')
    expect(texte()).toContain('Tenue mensuelle — octobre 2026')
    expect(texte()).not.toContain('novembre 2026')
    expect(texte()).toContain('Déclaration 2035 — exercice 2026')
    expect((screen.getByRole('checkbox', { name: /octobre 2026/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /exercice 2026/ }) as HTMLInputElement).checked).toBe(false)
    expect((bouton() as HTMLButtonElement).disabled).toBe(true)
    expect(texte()).toContain('Le taux de TVA des honoraires est de 20 %')
    choisirLeTaux('20')
    fireEvent.click(screen.getByRole('checkbox', { name: /octobre 2026/ }))
    expect(texte()).toContain('Coche au moins une période ou une tâche à facturer.')
    expect((bouton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('facture sur un clic confirmé qui nomme le client, les périodes et le HT ; deux clics du même act : une facture, puis la relecture et le brouillon', async () => {
    render(carte())
    choisirLeTaux('20')
    fireEvent.click(screen.getByRole('checkbox', { name: /exercice 2026/ }))
    const avant = etat.relecture
    await act(async () => {
      fireEvent.click(bouton()!)
      fireEvent.click(bouton()!)
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(etat.appels).toHaveLength(1)
    expect(etat.appels[0].taux).toBe(20)
    expect(etat.appels[0].elements).toMatchObject([
      { lettre_id: 'l1', ligne: 1, periode_debut: '2026-10-01', periode_fin: '2026-10-31' },
      { lettre_id: 'l1', ligne: 2, periode_debut: '2026-01-01', periode_fin: '2026-12-31' },
    ])
    const question = String(confirmer.mock.calls[0][0]).replace(/ | /g, ' ')
    expect(question).toContain('« Client fictif »')
    expect(question).toContain('Tenue mensuelle — octobre 2026 : 150,00 € HT')
    expect(question).toContain('Total : 750,00 € HT')
    expect(etat.relecture).toBe(avant + 1)
    expect(relues).toBe(1)
    expect(texte()).toContain('Brouillon de facture créé pour « Client fictif »')
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le brouillon' }))
    expect(ouverts).toEqual(['f-neuve'])
  })

  it('un clic non confirmé ne facture rien ; un refus de la base se dit et ne relit pas l’onglet', async () => {
    confirmer.mockReturnValue(false)
    render(carte())
    choisirLeTaux('0')
    fireEvent.click(bouton()!)
    expect(etat.appels).toHaveLength(0)
    confirmer.mockReturnValue(true)
    etat.issue = { ok: false, message: 'La lettre n’est pas en vigueur pour cette période.' }
    await act(async () => { fireEvent.click(bouton()!); await new Promise((r) => setTimeout(r, 5)) })
    expect(texte()).toContain('La lettre n’est pas en vigueur pour cette période.')
    expect(relues).toBe(0)
  })

  it('une période facturée se dit avec sa facture ; un avoir total la rend à facturer, et le dit', () => {
    const lien = { facture_id: 'f1', lettre_id: 'l1', ligne: 1, periode_debut: '2026-10-01', periode_fin: '2026-10-31', facturation: 1 }
    etat.lecture = lue([lien])
    const f1 = factureFigee({ id: 'f1', dossier_id: K, montant_ttc: 180, numero: 'F2026-0007' })
    const premier = render(carte(lues(null, [f1])))
    expect(screen.queryByRole('checkbox', { name: /octobre 2026/ })).toBeNull()
    expect(texte()).toContain('Tenue mensuelle — octobre 2026 — Facturée par la facture F2026-0007')
    premier.unmount()
    const avoir = factureFigee({ id: 'a1', dossier_id: K, type: 'avoir', montant_ttc: -180, facture_origine_id: 'f1', numero: 'A2026-0001' })
    render(carte(lues(null, [f1, avoir])))
    expect(screen.getByRole('checkbox', { name: /octobre 2026/ })).toBeTruthy()
    expect(texte()).toContain('Redevenue à facturer : la facture F2026-0007 a été créditée en entier par un avoir.')
    expect(texte()).toContain('créditée en entier par un avoir : à facturer de nouveau')
  })
})
