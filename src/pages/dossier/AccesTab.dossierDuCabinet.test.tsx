import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import AccesTab from './AccesTab'
import {
  PHRASE_DESIGNATION_PAS_LUE, REFUS_ACCES_CLIENT, phraseDesignationIllisible, type DesignationPourLesAcces,
} from '../../lib/dossierDuCabinet'

// L'ONGLET ACCÈS SUR LE DOSSIER DU CABINET (ligne 47, LM2). Ce que le module pur ne voit pas : sous les deux états du drapeau,
// le formulaire « Donner un accès client » se refuse AVANT le clic sur le dossier désigné, aux mots de la garde, sans champ ni
// bouton ni lien de réinitialisation ; une désignation pas encore lue, lue pour un autre dossier ou illisible le retient et le
// dit — jamais « offert » sur une lecture absente ; le drapeau baissé, l'onglet est celui d'hier et ne lit rien. Données
// FICTIVES.

const D = 'd0000000-0000-4000-8000-000000000001'

const etat = vi.hoisted(() => ({
  leve: true,
  designation: null as DesignationPourLesAcces,
  lecturesDeLaDesignation: 0,
  appelsDeLaFonction: 0,
}))

vi.mock('../../lib/dossierDuCabinet', async (original) => {
  const reel = await original<typeof import('../../lib/dossierDuCabinet')>()
  return { ...reel, get DOSSIER_DU_CABINET_PREVU() { return etat.leve } }
})
// La lecture de la désignation a son test (dossierDuCabinetLecture.test.ts) : ici, ce que l'onglet en fait. Baissé, le vrai hook
// ne lit rien et rend `null` ; ce double en dit autant, et compte ses lectures.
vi.mock('../../lib/dossierDuCabinetLecture', () => ({
  useDesignationDuDossier: () => {
    if (!etat.leve) return null
    etat.lecturesDeLaDesignation += 1
    return etat.designation
  },
}))
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({ dossierId, lignes: [], motif: null }),
}))
vi.mock('../../lib/reglageDuDossierLecture', () => ({
  lireLeReglageDuDossier: async (dossierId: string) => ({
    dossierId, reglage: { etat: 'bascule' }, caisse: { etat: 'exclu', statut: 'exonere' }, nature: { etat: 'lue', categorieId: null },
  }),
}))
vi.mock('../../lib/natureDesRecettesLecture', () => ({
  lireLesCategoriesDeLaNature: async (dossierId: string) => ({ dossierId, etat: 'lues', categories: [] }),
  fixerLaNatureDesRecettes: async () => ({ ecrite: true, categorieId: null }),
}))
vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))
vi.mock('../../lib/supabase', () => {
  const ligne = {
    id: 'm1', user_id: 'u1', email: 'client@exemple.fr', dossier_id: 'd1',
    droit_ventes: false, droit_banque: false, droit_caisse: false,
  }
  const chaine: Record<string, unknown> = {}
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => chaine,
    order: () => chaine,
    range: () => chaine,
    then: (suite: (r: unknown) => unknown) => Promise.resolve({ data: [ligne], error: null, count: 1 }).then(suite),
  })
  return {
    supabase: {
      from: () => chaine,
      functions: { invoke: () => { etat.appelsDeLaFonction += 1; return new Promise(() => {}) } },
      auth: { resetPasswordForEmail: async () => ({ data: {}, error: null }) },
      rpc: async () => ({ data: null, error: null }),
    },
  }
})

const monter = () => render(<AccesTab dossierId={D} dossierNom="Cabinet fictif" codeEmail="abc123" />)
const lue = (dossierActuel: string | null, dossierId = D): DesignationPourLesAcces => ({ etat: 'lue', dossierId, dossierActuel })
const LIEN = 'Envoyer un lien de réinitialisation'

beforeEach(() => {
  etat.leve = true
  etat.designation = null
  etat.lecturesDeLaDesignation = 0
  etat.appelsDeLaFonction = 0
})

describe('l’onglet Accès devant le dossier du cabinet', () => {
  it('levé, le dossier désigné : le refus aux mots de la garde, ni champ ni bouton « Créer l’accès » ni lien de réinitialisation', async () => {
    etat.designation = lue(D)
    monter()
    expect((await screen.findByRole('alert')).textContent).toBe(REFUS_ACCES_CLIENT)
    expect(screen.queryByLabelText('Email du client')).toBeNull()
    expect(screen.queryByLabelText('Mot de passe initial')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Créer l\'accès' })).toBeNull()
    // La liste lue est affichée (« Retirer » reste offert) : seul l'envoi du lien d'un accès qui n'existera pas disparaît.
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryByRole('button', { name: LIEN })).toBeNull()
    expect(etat.appelsDeLaFonction).toBe(0)
  })

  it('levé, un autre dossier désigné ou aucun : le formulaire est offert, comme hier', async () => {
    for (const designation of [lue(null), lue('un-autre-dossier')]) {
      etat.designation = designation
      const { unmount } = monter()
      expect(await screen.findByLabelText('Email du client')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Créer l\'accès' }) as HTMLButtonElement).disabled).toBe(false)
      expect(await screen.findByRole('button', { name: LIEN })).toBeTruthy()
      expect(screen.queryByText(REFUS_ACCES_CLIENT)).toBeNull()
      unmount()
    }
  })

  it('levé, désignation pas encore lue ou lue pour un autre dossier : le formulaire est retenu et le dit', async () => {
    for (const designation of [null, lue(null, 'un-autre-dossier')]) {
      etat.designation = designation
      const { unmount } = monter()
      expect((await screen.findByRole('status')).textContent).toBe(PHRASE_DESIGNATION_PAS_LUE)
      expect(screen.queryByLabelText('Email du client')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Créer l\'accès' })).toBeNull()
      unmount()
    }
  })

  it('levé, désignation illisible : le motif, aucun formulaire', async () => {
    etat.designation = { etat: 'illisible', dossierId: D, motif: 'accès refusé' }
    monter()
    expect((await screen.findByRole('alert')).textContent).toBe(phraseDesignationIllisible('accès refusé'))
    expect(screen.queryByLabelText('Email du client')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Créer l\'accès' })).toBeNull()
    expect(etat.appelsDeLaFonction).toBe(0)
  })

  it('baissé : l’onglet est celui d’hier — formulaire offert, lien offert, aucune désignation lue, aucun avis', async () => {
    etat.leve = false
    // Même une désignation qui refuserait ne compte pas : le hook réel ne lit rien, et l'écran ne regarde rien.
    etat.designation = lue(D)
    monter()
    expect(await screen.findByLabelText('Email du client')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Créer l\'accès' }) as HTMLButtonElement).disabled).toBe(false)
    expect(await screen.findByRole('button', { name: LIEN })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(etat.lecturesDeLaDesignation).toBe(0)
  })
})
