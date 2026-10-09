import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CabinetBrandingPage from './CabinetBrandingPage'
import type { Cabinet } from '../lib/types'

// « ENREGISTRER » LA CHARTE NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026).
//
// `disabled={saving}` ne prend effet qu'au rendu suivant : deux soumissions du même rendu, un nouveau logo choisi, envoyaient
// DEUX fichiers au seau `cabinet-logos` (`logo-<horodatage>`), retiraient deux fois l'ancien, et la seconde mise à jour du
// cabinet désignait son propre fichier — le premier restait dans le seau sans que rien ne le désigne : un orphelin, que
// seul un ménage à la main retrouverait. Sur la même milliseconde, le second envoi butait sur le premier et l'écran disait
// l'échec d'un enregistrement réussi. Le cas à TROIS envois est le seul à distinguer un verrou posé dans le `try`.
const faux = vi.hoisted(() => ({
  cabinet: null as unknown,
  envois: [] as string[],
  // La réponse d'un envoi au seau attend `porteEnvoi` quand le test la pose : la fenêtre pendant laquelle un second
  // envoi arrive.
  porteEnvoi: null as Promise<void> | null,
  erreurEnvoi: null as { message: string } | null,
  misesAJour: [] as Record<string, unknown>[],
  retraits: [] as string[][],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'cabinets') throw new Error(`table inattendue : ${table}`)
      const chaine: Record<string, unknown> = {}
      let miseAJour = false
      Object.assign(chaine, {
        select: () => chaine,
        update: (valeur: Record<string, unknown>) => { miseAJour = true; faux.misesAJour.push(valeur); return chaine },
        eq: () => (miseAJour ? Promise.resolve({ error: null }) : chaine),
        maybeSingle: () => Promise.resolve({ data: faux.cabinet, error: null }),
      })
      return chaine
    },
    storage: {
      from: () => ({
        upload: (chemin: string) => {
          faux.envois.push(chemin)
          return (faux.porteEnvoi ?? Promise.resolve()).then(() => ({ error: faux.erreurEnvoi }))
        },
        remove: (chemins: string[]) => {
          faux.retraits.push(chemins)
          return Promise.resolve({ data: [], error: null })
        },
        getPublicUrl: (chemin: string) => ({ data: { publicUrl: `https://stockage.exemple/${chemin}` } }),
      }),
    },
  },
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: 'cab1' }) }))
// La barre latérale relit la charte sur ce signal : rien à relire ici.
vi.mock('../lib/branding', () => ({ signalerMajBranding: () => {} }))

// Typé sans `as` : le compilateur confronte le jeu d'essai à la table.
function cabinet(o: Partial<Cabinet> = {}): Cabinet {
  return {
    id: 'cab1', nom: 'Cabinet Fictif', couleur_primaire: '#2f7a6f', couleur_primaire_claire: null,
    police_google_font: null, logo_storage_path: 'cab1/logo-ancien.png', created_at: '2026-09-01T10:00:00Z', ...o,
  }
}

beforeEach(() => {
  // jsdom n'implémente pas `createObjectURL`, que l'aperçu du logo choisi appelle.
  URL.createObjectURL = () => 'blob:apercu'
  URL.revokeObjectURL = () => {}
  faux.cabinet = cabinet()
  faux.envois = []
  faux.porteEnvoi = null
  faux.erreurEnvoi = null
  faux.misesAJour = []
  faux.retraits = []
})

// Une porte laissée par un test qui échoue ne doit pas faire échouer les suivants.
afterEach(() => { faux.porteEnvoi = null })

function retenirLEnvoi(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porteEnvoi = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porteEnvoi = null
    await act(async () => { ouvrir() })
  }
}

// La charte lue, un nouveau logo choisi : l'enregistrement l'enverra au seau.
async function choisirUnLogo() {
  await act(async () => { render(<CabinetBrandingPage />) })
  const logo = new File(['png'], 'logo.png', { type: 'image/png' })
  await act(async () => { fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [logo] } }) })
  const bouton = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

describe('CabinetBrandingPage — le verrou de l’enregistrement de la charte', () => {
  it('n’envoie qu’un logo quand le formulaire est soumis deux fois dans le même rendu', async () => {
    const { bouton } = await choisirUnLogo()
    const liberer = retenirLEnvoi()

    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.envois).toHaveLength(1)
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Enregistrement…')
    await liberer()
    // Un seul fichier, et c'est lui que le cabinet désigne : l'ancien est retiré une fois.
    expect(faux.misesAJour).toEqual([expect.objectContaining({ logo_storage_path: faux.envois[0] })])
    expect(faux.retraits).toEqual([['cab1/logo-ancien.png']])
    expect(screen.getByText('Enregistré.')).toBeTruthy()
  })

  it('trois soumissions du formulaire — « Entrée » dans un champ — n’en envoient qu’un', async () => {
    const { formulaire } = await choisirUnLogo()
    const liberer = retenirLEnvoi()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(faux.envois).toHaveLength(1)
    await liberer()
    expect(faux.misesAJour).toHaveLength(1)
  })

  it('relâche le verrou sur un envoi refusé, et le dit', async () => {
    faux.erreurEnvoi = { message: 'The resource already exists' }
    const { bouton } = await choisirUnLogo()

    await act(async () => { bouton.click() })
    expect(screen.getByText(/The resource already exists/)).toBeTruthy()
    // Rien n'a désigné un fichier qui n'est pas arrivé.
    expect(faux.misesAJour).toEqual([])
    faux.erreurEnvoi = null
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })

    expect(faux.envois).toHaveLength(2)
    expect(faux.misesAJour).toHaveLength(1)
  })
})
