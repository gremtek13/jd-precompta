import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModeleDuCabinetDossierCarte from './ModeleDuCabinetDossierCarte'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { PLAN_LU_PAR_DEFAUT } from '../../test/modeles'
import { ROLES_COMPTABLES, type LectureDuPlan } from '../../lib/planComptable'
import type { PlanLu } from '../../lib/planDepuisLaBalance'

// « APPLIQUER LE MODÈLE DU CABINET » SUR LE PLAN D'UN DOSSIER (ligne 43, PC5b), sous les deux états du drapeau
// (`MODELE_DU_CABINET_PREVU`, joué par un accesseur) : baissé, aucune carte et aucune lecture ; levé, le bouton ne
// s'offre que sur un modèle lu en entier qui change quelque chose, les refus se disent AVANT le clic, la confirmation
// nomme ce qui change, deux clics du même `act` n'appliquent qu'une fois, et le plan est RELU après l'application. Le
// calcul est gardé à part (modeleDuCabinet.test.ts) ; ici, ce qu'aucun calcul pur ne voit : le câblage et le verrou.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/modeleDuCabinet', async (original) => {
  const vrai = await original<typeof import('../../lib/modeleDuCabinet')>()
  return { ...vrai, get MODELE_DU_CABINET_PREVU() { return drapeau.leve } }
})

type LigneDePlan = { role: string; compte: string; libelle: string | null; prefixe_auxiliaire: string | null }

const faux = vi.hoisted(() => ({
  // Les rôles que le modèle du cabinet règle (rôle → compte, libellé), sinon le catalogue.
  modele: {} as Record<string, { compte: string; libelle: string | null }>,
  refusModele: null as string | null,
  retenueModele: null as Promise<void> | null,
  // Le plan que la base tient pour le dossier : l'application le remplace, la relecture le rend.
  planEnBase: [] as LigneDePlan[],
  refusApplication: null as string | null,
  planIllisibleApresApplication: false,
  retenueRelecture: null as Promise<void> | null,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      if (nom === 'modele_du_cabinet') {
        if (faux.retenueModele) await faux.retenueModele
        if (faux.refusModele) return { data: null, error: { message: faux.refusModele } }
        return {
          data: ROLES_COMPTABLES.map((r) => {
            const regle = faux.modele[r.role]
            return {
              role: r.role,
              compte: regle?.compte ?? r.compteDefaut,
              libelle: regle ? regle.libelle : r.libelleDefaut,
              prefixe_auxiliaire: r.prefixeAuxiliaireDefaut,
              origine: regle ? 'modele_du_cabinet' : 'application',
            }
          }),
          error: null,
        }
      }
      if (nom === 'appliquer_modele_du_cabinet') {
        if (faux.refusApplication) return { data: null, error: { message: faux.refusApplication } }
        faux.planEnBase = Object.entries(faux.modele).map(([role, l]) => ({ role, compte: l.compte, libelle: l.libelle, prefixe_auxiliaire: null }))
        return { data: faux.planEnBase.length, error: null }
      }
      if (nom === 'plan_du_dossier') {
        if (faux.retenueRelecture) await faux.retenueRelecture
        if (faux.planIllisibleApresApplication) return { data: null, error: { message: 'connexion perdue' } }
        return {
          data: ROLES_COMPTABLES.map((r) => {
            const regle = faux.planEnBase.find((l) => l.role === r.role)
            return {
              role: r.role,
              compte: regle?.compte ?? r.compteDefaut,
              libelle: regle ? regle.libelle : r.libelleDefaut,
              prefixe_auxiliaire: r.prefixeAuxiliaireDefaut,
            }
          }),
          error: null,
        }
      }
      return { data: null, error: null }
    },
  },
}))

const plansRelus: [string, LectureDuPlan][] = []
const nomsDesAppels = () => faux.appels.map((a) => a.nom)
const BOUTON = 'Appliquer le modèle du cabinet'

async function monter(options: { cabinetId?: string | null; annees?: number[]; planLu?: PlanLu } = {}) {
  const cabinetId = options.cabinetId === undefined ? 'cabinet-de-test' : options.cabinetId
  await act(async () => {
    render(
      <AvecExercicesValides annees={options.annees ?? []}>
        <ModeleDuCabinetDossierCarte
          dossierId="dossier-de-test" cabinetId={cabinetId} planLu={options.planLu ?? PLAN_LU_PAR_DEFAUT}
          onPlanRelu={(id, lecture) => { plansRelus.push([id, lecture]) }}
        />
      </AvecExercicesValides>,
    )
  })
}

beforeEach(() => {
  drapeau.leve = true
  faux.modele = { banque: { compte: '512100', libelle: 'Banque principale' } }
  faux.refusModele = null
  faux.retenueModele = null
  faux.planEnBase = []
  faux.refusApplication = null
  faux.planIllisibleApresApplication = false
  faux.retenueRelecture = null
  faux.appels = []
  plansRelus.length = 0
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => { vi.restoreAllMocks() })

describe('ModeleDuCabinetDossierCarte — le drapeau', () => {
  it('baissé : aucune carte, aucun bouton, aucune lecture', async () => {
    drapeau.leve = false
    await monter()
    expect(screen.queryByText('Modèle de plan du cabinet')).toBeNull()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
    expect(faux.appels).toEqual([])
  })

  it('levé : lit le modèle du cabinet du dossier et offre le bouton, avec ce qu’il change', async () => {
    await monter()
    expect(nomsDesAppels()).toEqual(['modele_du_cabinet'])
    expect(faux.appels[0].args).toEqual({ p_cabinet_id: 'cabinet-de-test' })
    expect(screen.getByRole('button', { name: BOUTON })).toBeTruthy()
    expect(screen.getByText('Un rôle s’écarte du plan de l’application ; ce que l’application du modèle change à ce dossier :')).toBeTruthy()
    expect(screen.getByText('Banque : 512000 « Banque » → 512100 « Banque principale »')).toBeTruthy()
  })

  it('levé, avant que la lecture soit revenue : la dit, sans bouton, puis l’offre', async () => {
    let relacher!: () => void
    faux.retenueModele = new Promise((r) => { relacher = r })
    await monter()
    expect(screen.getByText('Lecture du modèle de plan du cabinet…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
    await act(async () => { relacher() })
    expect(screen.getByRole('button', { name: BOUTON })).toBeTruthy()
  })
})

describe('ModeleDuCabinetDossierCarte — les refus, dits avant le clic', () => {
  it('un modèle vide : rien à appliquer, aucun bouton', async () => {
    faux.modele = {}
    await monter()
    expect(screen.getByText('Le cabinet n’a pas de modèle de plan : il n’y a rien à appliquer à ce dossier.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
  })

  it('un modèle refusé à la lecture (l’accès) : le motif, aucun bouton', async () => {
    faux.refusModele = 'Accès refusé à ce cabinet.'
    await monter()
    expect(screen.getByText(/Le modèle de plan du cabinet n’a pas pu être lu \(.*Accès refusé à ce cabinet\..*\) : il ne s’applique pas à ce dossier\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
  })

  it('un cabinet que la page n’a pas lu : le dit, sans lire ni offrir', async () => {
    await monter({ cabinetId: null })
    expect(screen.getByText(/le cabinet de ce dossier n’est pas connu/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
    expect(faux.appels).toEqual([])
  })

  it('un exercice validé : le plan ne change plus, aucun bouton', async () => {
    await monter({ annees: [2025] })
    expect(screen.getByText('Un exercice de ce dossier est validé : son plan ne change plus, le modèle ne peut pas lui être appliqué.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
  })

  it('un plan qui tient déjà le modèle : rien à appliquer', async () => {
    const tenu: PlanLu = {
      plan: { ...PLAN_LU_PAR_DEFAUT.plan, banque: '512100' },
      libelles: { ...PLAN_LU_PAR_DEFAUT.libelles, banque: 'Banque principale' },
      prefixes: PLAN_LU_PAR_DEFAUT.prefixes,
    }
    await monter({ planLu: tenu })
    expect(screen.getByText('Le plan de ce dossier tient déjà le modèle du cabinet : il n’y a rien à appliquer.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: BOUTON })).toBeNull()
  })
})

describe('ModeleDuCabinetDossierCarte — le geste', () => {
  it('confirme en nommant ce qui change, applique, RELIT le plan et le rend à la page', async () => {
    await monter()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BOUTON })) })

    const confirmation = vi.mocked(window.confirm).mock.calls[0][0]
    expect(confirmation).toContain('Un rôle s’écarte du plan de l’application')
    expect(confirmation).toContain('– Banque : 512000 « Banque » → 512100 « Banque principale »')
    expect(nomsDesAppels()).toEqual(['modele_du_cabinet', 'appliquer_modele_du_cabinet', 'plan_du_dossier'])
    expect(faux.appels[1].args).toEqual({ p_dossier_id: 'dossier-de-test' })
    // La page reçoit le plan que la base a gardé.
    expect(plansRelus).toHaveLength(1)
    expect(plansRelus[0][0]).toBe('dossier-de-test')
    expect(plansRelus[0][1].plan?.banque).toBe('512100')
    expect(screen.getByText('Modèle appliqué et plan relu : un rôle copié.')).toBeTruthy()
  })

  it('deux clics du même rendu n’appliquent qu’une fois ; le verrou se relâche APRÈS la relecture', async () => {
    await monter()
    let relacher!: () => void
    faux.retenueRelecture = new Promise((r) => { relacher = r })
    const bouton = screen.getByRole('button', { name: BOUTON })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(nomsDesAppels().filter((n) => n === 'appliquer_modele_du_cabinet')).toHaveLength(1)
    expect(vi.mocked(window.confirm)).toHaveBeenCalledTimes(1)
    // Tant que la relecture n'est pas revenue : le geste est en cours, rien ne repart.
    const enCours = screen.getByRole('button', { name: 'Application…' }) as HTMLButtonElement
    expect(enCours.disabled).toBe(true)
    expect(plansRelus).toHaveLength(0)

    await act(async () => { relacher() })
    expect(plansRelus).toHaveLength(1)
    // Relâché : un nouveau clic passe (la page n'a pas changé le plan lu de ce test).
    faux.retenueRelecture = null
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BOUTON })) })
    expect(nomsDesAppels().filter((n) => n === 'appliquer_modele_du_cabinet')).toHaveLength(2)
  })

  it('un refus de la base se dit en clair, ne relit rien et relâche le verrou', async () => {
    faux.refusApplication = 'Le plan comptable de ce dossier ne se change plus : il porte déjà 3 écriture(s) au brouillon, qui resteraient sur les anciens comptes.'
    await monter()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BOUTON })) })
    expect(screen.getByText(/il porte déjà 3 écriture\(s\) au brouillon/)).toBeTruthy()
    expect(nomsDesAppels()).not.toContain('plan_du_dossier')
    expect(plansRelus).toHaveLength(0)
    expect((screen.getByRole('button', { name: BOUTON }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('une confirmation refusée n’écrit rien', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    await monter()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BOUTON })) })
    expect(nomsDesAppels()).toEqual(['modele_du_cabinet'])
  })

  it('un plan appliqué mais illisible à la relecture le dit, et ne le donne pas à la page', async () => {
    faux.planIllisibleApresApplication = true
    await monter()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BOUTON })) })
    expect(screen.getByText(/Le modèle a été appliqué, mais le plan n’a pas pu être relu/)).toBeTruthy()
    expect(plansRelus).toHaveLength(0)
  })
})
