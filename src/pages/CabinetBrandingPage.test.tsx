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
  // Le type que porte chaque corps envoyé au seau public : c'est lui qu'il sert (lib/bornesStockage.ts, ligne 22.6).
  typesEnvoyes: [] as string[],
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
        upload: (chemin: string, corps?: Blob) => {
          faux.envois.push(chemin)
          faux.typesEnvoyes.push(corps?.type ?? '(aucun corps)')
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
  faux.typesEnvoyes = []
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

// Les huit octets qui ouvrent tout PNG : le logo se juge à sa signature, plus à son nom (ligne 22.6).
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

// La charte lue, un nouveau logo choisi : l'enregistrement l'enverra au seau.
async function choisirUnLogo() {
  await act(async () => { render(<CabinetBrandingPage />) })
  const logo = new File([PNG], 'logo.png', { type: 'image/png' })
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

// LE SEAU DES LOGOS EST PUBLIC (ligne 22.6) : il sert chaque fichier sous le type qu'on lui a dit, à quiconque a
// l'adresse. Le champ ne propose plus le SVG, qui peut porter du script ; un logo se juge à ses premiers octets — un SVG
// renommé .png est refusé, un PNG nommé .svg part en PNG, sous un chemin .png — et à son poids (500 Kio).
describe('CabinetBrandingPage — les bornes du seau public des logos', () => {
  const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

  async function choisir(fichier: File) {
    await act(async () => { render(<CabinetBrandingPage />) })
    await act(async () => { fireEvent.change(screen.getByLabelText('Logo'), { target: { files: [fichier] } }) })
  }

  it('le champ ne propose plus le SVG, et dit les formats et la borne', async () => {
    await act(async () => { render(<CabinetBrandingPage />) })
    expect(screen.getByLabelText('Logo').getAttribute('accept')).toBe('.png,.jpg,.jpeg,.webp')
    expect(screen.getByText(/PNG, JPEG ou WebP/).textContent).toBe('PNG, JPEG ou WebP, 500\u00a0Ko au plus.')
  })

  it('un SVG, même renommé .png, est refusé au choix, et rien ne part à l’enregistrement', async () => {
    await choisir(new File([SVG], 'logo.png', { type: 'image/png' }))
    expect(document.querySelector('.error-text')?.textContent)
      .toBe('Ce logo n’est pas pris : format non pris en charge (un logo se dépose en PNG, JPEG ou WebP).')
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.envois).toEqual([])
    // La charte s'enregistre sans toucher au logo en place.
    expect(faux.misesAJour).toEqual([expect.objectContaining({ logo_storage_path: 'cab1/logo-ancien.png' })])
  })

  it('un logo trop lourd est refusé, avec son poids et la borne', async () => {
    const lourd = new File([PNG], 'logo.png', { type: 'image/png' })
    Object.defineProperty(lourd, 'size', { value: 800 * 1024 })
    await choisir(lourd)
    expect(document.querySelector('.error-text')?.textContent)
      .toBe('Ce logo n’est pas pris : il pèse 800\u00a0Ko, au-delà des 500\u00a0Ko qu’un logo peut peser.')
  })

  it('un PNG nommé .svg part en PNG, sous un chemin .png', async () => {
    await choisir(new File([PNG], 'logo.svg', { type: 'image/svg+xml' }))
    expect(document.querySelector('.error-text')).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.envois).toEqual([expect.stringMatching(/^cab1\/logo-\d+\.png$/)])
    expect(faux.typesEnvoyes).toEqual(['image/png'])
  })
})
