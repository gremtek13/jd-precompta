import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from '../components/Layout'
import ClientInformations from './ClientInformations'

// Un client suivi pour plusieurs sociétés change de société par le sélecteur de la coque, SANS
// quitter l'écran : même route, autre dossier. L'écran monté dans la vraie coque, parce que c'est elle
// qui décide s'il repart de zéro — rien dans l'écran lui-même ne peut le voir.
//
// Deux façons dont les réponses d'une société finissaient dans l'autre, et « Enregistrer » les y
// écrivait (l'enregistrement porte TOUS les champs, voir lib/informationsDossier.ts) :
// — sans course : une société qui n'a encore rien répondu ne remet pas le formulaire à zéro, il garde
//   celles de la société précédente ;
// — avec course : la lecture de la société précédente, plus lente, arrive APRÈS celle de la nouvelle.

const faux = vi.hoisted(() => ({
  informations: {} as Record<string, Record<string, unknown> | null>,
  retenues: {} as Record<string, Promise<void>>,
  enregistrements: [] as Record<string, unknown>[],
}))

// Le sélecteur de société écrit dans l'authentification : le double retient la société active et
// prévient les écrans abonnés, comme le vrai contexte le ferait.
const auth = vi.hoisted(() => ({ dossierActifId: 'a', abonnes: new Set<() => void>() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      let dossierId = ''
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: (colonne: string, valeur: string) => { if (colonne === 'dossier_id') dossierId = valeur; return chaine },
        maybeSingle: () => {
          const id = dossierId
          return (faux.retenues[id] ?? Promise.resolve()).then(() => ({ data: faux.informations[id] ?? null, error: null }))
        },
        upsert: (ligne: Record<string, unknown>) => {
          faux.enregistrements.push(ligne)
          return Promise.resolve({ error: null })
        },
      })
      return chaine
    },
  },
}))
vi.mock('../context/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react')
  const abonner = (rappel: () => void) => { auth.abonnes.add(rappel); return () => { auth.abonnes.delete(rappel) } }
  return {
    useAuth: () => ({
      session: { user: { email: 'client@exemple.fr' } },
      role: 'client',
      isSuperAdmin: false,
      estChef: false,
      mesSocietes: [{ id: 'a', nom: 'Société Alpha' }, { id: 'b', nom: 'Société Bêta' }],
      dossierActifId: useSyncExternalStore(abonner, () => auth.dossierActifId),
      setDossierActifId: (id: string) => { auth.dossierActifId = id; auth.abonnes.forEach((rappel) => rappel()) },
      signOut: async () => {},
    }),
  }
})
vi.mock('../lib/branding', () => ({ useCabinetBranding: () => null }))
vi.mock('../lib/theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }))

async function afficher() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/mes-informations']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/mes-informations" element={<ClientInformations />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })
}

function retenue(): { promesse: Promise<void>; relacher: () => void } {
  let relacher: () => void = () => {}
  const promesse = new Promise<void>((resolve) => { relacher = resolve })
  return { promesse, relacher }
}

async function choisirSociete(id: string) {
  await act(async () => { fireEvent.change(screen.getByLabelText('Société'), { target: { value: id } }) })
}

const notes = async () => ((await screen.findByLabelText(/Autres informations utiles/)) as HTMLTextAreaElement).value

const reponses = (texte: string) => ({
  dossier_id: '', vehicule_type: 'aucun', vehicule_libelle: null, jours_travailles_an: 210,
  tickets_restaurant: false, cheques_vacances: false, notes: texte,
})

beforeEach(() => {
  auth.dossierActifId = 'a'
  faux.informations = { a: reponses('Mutuelle de la société Alpha') }
  faux.retenues = {}
  faux.enregistrements = []
})

describe('Mes informations — changer de société sans quitter l’écran', () => {
  it('une société qui n’a encore rien répondu part d’un formulaire vide, pas des réponses de la précédente', async () => {
    await afficher()
    expect(await notes()).toBe('Mutuelle de la société Alpha')

    await choisirSociete('b')
    expect(await notes()).toBe('')

    // Le dégât n'est pas l'affichage : c'est ce qu'« Enregistrer » écrit dans la société Bêta.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })) })
    expect(faux.enregistrements).toHaveLength(1)
    expect(faux.enregistrements[0]).toMatchObject({ dossier_id: 'b', notes: null, jours_travailles_an: null })
  })

  it('la lecture de la société précédente, arrivée APRÈS celle de la nouvelle, ne la remplace pas', async () => {
    faux.informations.b = reponses('Local professionnel de la société Bêta')
    const alpha = retenue()
    faux.retenues.a = alpha.promesse
    await afficher()

    await choisirSociete('b')
    expect(await notes()).toBe('Local professionnel de la société Bêta')

    await act(async () => { alpha.relacher() })
    await act(async () => { await alpha.promesse })
    expect(await notes()).toBe('Local professionnel de la société Bêta')
  })
})
