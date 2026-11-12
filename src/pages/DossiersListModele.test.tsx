import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DossiersList from './DossiersList'
import { modeleDeLaReponse, type LectureDuModele } from '../lib/modeleDuCabinet'
import { ROLES_DE_LA_BASE } from '../test/rolesDeLaBase'

// « NOUVEAU DOSSIER » APPLIQUE LE MODÈLE DE PLAN DU CABINET (ligne 43, PC5), sous les deux états du drapeau
// (`MODELE_DU_CABINET_PREVU`, joué par un accesseur) : levé, la fenêtre dit avant le clic ce qu'elle fera du modèle, attend
// sa lecture, crée le dossier PUIS applique le modèle, une seule fois sous deux soumissions du même rendu ; un refus du
// modèle se dit, le dossier créé reste ; baissé, la création d'hier, sans lecture ni application.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../lib/modeleDuCabinet', async (original) => {
  const vrai = await original<typeof import('../lib/modeleDuCabinet')>()
  return { ...vrai, get MODELE_DU_CABINET_PREVU() { return drapeau.leve } }
})

const faux = vi.hoisted(() => ({
  modele: null as unknown as LectureDuModele,
  retenueModele: null as Promise<void> | null,
  lectures: 0,
  creations: [] as unknown[],
  applications: [] as string[],
  refusApplication: null as string | null,
  retenueCreation: null as Promise<void> | null,
  signaux: 0,
}))

vi.mock('../lib/modeleDuCabinetLecture', () => ({
  lireLeModeleDuCabinet: async (cabinetId: string) => {
    faux.lectures++
    if (faux.retenueModele) await faux.retenueModele
    return { cabinetId, lecture: faux.modele }
  },
  appliquerLeModeleAuDossier: async (dossierId: string) => {
    faux.applications.push(dossierId)
    return faux.refusApplication ? { applique: false, refus: faux.refusApplication } : { applique: true, nombre: 1 }
  },
}))
vi.mock('../lib/listeDossiers', () => ({ signalerMajDossiers: () => { faux.signaux++ } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'u-chef' } }, monCabinetId: 'cab' }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: { dossiers: [] }, error: null }),
    from: () => {
      const chaine: Record<string, unknown> = {}
      let creation = false
      Object.assign(chaine, {
        select: () => chaine, eq: () => chaine, gte: () => chaine, order: () => chaine, range: () => chaine,
        single: () => chaine,
        insert: (ligne: unknown) => { creation = true; faux.creations.push(ligne); return chaine },
        then: (suite: (r: unknown) => unknown) => {
          if (creation) {
            const repondre = () => ({ data: { id: 'nouveau' }, error: null })
            return (faux.retenueCreation ? faux.retenueCreation.then(repondre) : Promise.resolve(repondre())).then(suite)
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
        },
      })
      return chaine
    },
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

async function monterFormulaireRempli() {
  await act(async () => { render(<MemoryRouter initialEntries={['/dossiers?nouveau=1']}><DossiersList /></MemoryRouter>) })
  const champ = screen.getByLabelText('Nom du client')
  await act(async () => { fireEvent.change(champ, { target: { value: 'Cabinet Martin' } }) })
}
const creer = () => screen.queryByRole('button', { name: /^(Créer|Création…)$/ }) as HTMLButtonElement | null

describe('« Nouveau dossier » et le modèle de plan du cabinet', () => {
  beforeEach(() => {
    drapeau.leve = true
    faux.modele = lecture({ banque: '512100' })
    faux.retenueModele = null
    faux.lectures = 0
    faux.creations = []
    faux.applications = []
    faux.refusApplication = null
    faux.retenueCreation = null
    faux.signaux = 0
  })
  afterEach(() => { faux.retenueModele = null; faux.retenueCreation = null })

  it('dit avant le clic que le modèle s’appliquera, crée le dossier puis l’applique, et se referme', async () => {
    await monterFormulaireRempli()
    expect(screen.getByText('Le modèle de plan du cabinet s’appliquera au dossier créé : 1 rôle(s) réglé(s) (Banque 512100).')).toBeTruthy()
    await act(async () => { creer()!.click() })
    expect(faux.creations).toHaveLength(1)
    expect(faux.applications).toEqual(['nouveau'])
    expect(screen.queryByLabelText('Nom du client')).toBeNull()
  })

  it('tant que le modèle n’est pas lu, « Créer » attend', async () => {
    let liberer = () => {}
    faux.retenueModele = new Promise<void>((r) => { liberer = r })
    await monterFormulaireRempli()
    expect(screen.getByText('Lecture du modèle de plan du cabinet…')).toBeTruthy()
    expect(creer()!.disabled).toBe(true)
    await act(async () => { liberer() })
    expect(creer()!.disabled).toBe(false)
  })

  it('deux soumissions dans le même `act` : un dossier, une application', async () => {
    await monterFormulaireRempli()
    let liberer = () => {}
    faux.retenueCreation = new Promise<void>((r) => { liberer = r })
    const bouton = creer()!
    await act(async () => { bouton.click(); bouton.click() })
    await act(async () => { liberer() })
    expect(faux.creations).toHaveLength(1)
    expect(faux.applications).toEqual(['nouveau'])
  })

  it('le modèle refusé par la base : la fenêtre le dit, le dossier créé reste et la liste se relit', async () => {
    faux.refusApplication = 'Accès refusé à ce dossier.'
    await monterFormulaireRempli()
    await act(async () => { creer()!.click() })
    expect(faux.creations).toHaveLength(1)
    expect(screen.getByText('Le dossier est créé, mais le modèle de plan du cabinet ne lui a pas été appliqué : Accès refusé à ce dossier. Son plan reste celui de l’application.')).toBeTruthy()
    expect(creer()).toBeNull()
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy()
    expect(faux.signaux).toBeGreaterThan(0)
  })

  it('un modèle vide ou illisible : le dossier se crée sans application, et la fenêtre l’a dit', async () => {
    faux.modele = { modele: null, motif: 'modèle de plan refusé : X' }
    await monterFormulaireRempli()
    expect(screen.getByText(/n'a pas pu être lu \(modèle de plan refusé : X\)/)).toBeTruthy()
    await act(async () => { creer()!.click() })
    expect(faux.creations).toHaveLength(1)
    expect(faux.applications).toEqual([])
  })

  it('drapeau baissé : ni lecture du modèle, ni phrase, ni application', async () => {
    drapeau.leve = false
    await monterFormulaireRempli()
    expect(screen.queryByText(/modèle de plan/)).toBeNull()
    await act(async () => { creer()!.click() })
    expect(faux.lectures).toBe(0)
    expect(faux.creations).toHaveLength(1)
    expect(faux.applications).toEqual([])
  })
})
