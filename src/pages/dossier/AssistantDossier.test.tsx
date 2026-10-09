import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AssistantDossier, { BoutonAssistant } from './AssistantDossier'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'

// L'assistant dans le panneau de droite (voir AssistantDossier, AssistantTab). Ce qui le ferait
// mentir : un bouton qui s'enfonce sans que rien ne s'ouvre, une bulle mobile qui n'ouvre pas le même
// volet, et surtout — le panneau restant ouvert d'un dossier à l'autre — la conversation d'un dossier
// affichée sous un autre, par un fil resté sélectionné ou par une lecture plus lente arrivée en
// dernier. Le message suivant partirait alors dans le fil d'un autre client.

interface Ligne {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  texte: string
  outils_utilises: string[] | null
  created_at: string
}

const faux = vi.hoisted(() => ({
  historiques: {} as Record<string, Ligne[]>,
  // Lecture retenue jusqu'à ce que le test la relâche : c'est ce qui fait arriver une lecture APRÈS
  // une autre partie plus tard.
  retenues: {} as Record<string, Promise<void>>,
  muetApres: null as number | null,
  inserts: [] as Record<string, unknown>[],
  appels: [] as { nom: string; body: Record<string, unknown> }[],
  // La réponse de l'assistant attend `porteAssistant` quand le test la pose — la fenêtre pendant laquelle un second
  // envoi arrive — et porte `refusAssistant` quand il y en a un (le blocage par le plafond du cabinet, par exemple).
  porteAssistant: null as Promise<void> | null,
  refusAssistant: null as string | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'agent_conversations') throw new Error(`table inattendue : ${table}`)
      let dossier = ''
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: (colonne: string, valeur: string) => { if (colonne === 'dossier_id') dossier = valeur; return chaine },
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        insert: (ligne: Record<string, unknown>) => { faux.inserts.push(ligne); return Promise.resolve({ error: null }) },
        then: (suite: (r: unknown) => unknown) => {
          const lignes = faux.historiques[dossier] ?? []
          const servies = faux.muetApres === null ? lignes : lignes.slice(0, faux.muetApres)
          return (faux.retenues[dossier] ?? Promise.resolve())
            .then(() => ({ data: servies.slice(debut, fin + 1), error: null, count: lignes.length }))
            .then(suite)
        },
      })
      return chaine
    },
    functions: {
      invoke: async (nom: string, { body }: { body: Record<string, unknown> }) => {
        faux.appels.push({ nom, body })
        await faux.porteAssistant
        if (faux.refusAssistant) return { data: { error: faux.refusAssistant }, error: null }
        return { data: { reponse: 'Réponse de l’assistant', outils_utilises: ['lister_pieces'], usage: { tokens_entree: 10, tokens_sortie: 5 } }, error: null }
      },
    },
  },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } } }),
}))

function ligne(dossier: string, conversation: string, texte: string, minute: number): Ligne {
  return {
    id: `${dossier}-${minute}`, conversation_id: conversation, role: 'user', texte, outils_utilises: null,
    created_at: `2026-09-20T10:${String(minute).padStart(2, '0')}:00Z`,
  }
}

function Page({ dossierId, dossierNom }: { dossierId: string; dossierNom: string }) {
  return (
    <FournisseurPanneauDroit>
      <main>
        <BoutonAssistant />
        <AssistantDossier dossierId={dossierId} dossierNom={dossierNom} />
      </main>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const boutonEntete = () => screen.getByRole('button', { name: 'Assistant' })

beforeEach(() => {
  faux.historiques = {
    dA: [ligne('dA', 'fil-A', 'Question du dossier A', 1)],
    dB: [ligne('dB', 'fil-B-ancien', 'Ancienne question B', 2), ligne('dB', 'fil-B', 'Question du dossier B', 3)],
  }
  faux.retenues = {}
  faux.muetApres = null
  faux.inserts = []
  faux.appels = []
  faux.porteAssistant = null
  faux.refusAssistant = null
})

describe('Assistant — dans le panneau de droite', () => {
  it('le bouton de l’en-tête l’ouvre DANS le volet, s’enfonce, et le referme', async () => {
    render(<Page dossierId="dA" dossierNom="Dossier A" />)
    expect(boutonEntete().getAttribute('aria-pressed')).toBe('false')
    expect(volet().childElementCount).toBe(0)

    await act(async () => { fireEvent.click(boutonEntete()) })
    expect(within(volet()).getByRole('heading', { name: 'Assistant' })).toBeTruthy()
    expect(within(volet()).getByText('Dossier A')).toBeTruthy()
    expect(await within(volet()).findByText('Question du dossier A')).toBeTruthy()
    expect(boutonEntete().getAttribute('aria-pressed')).toBe('true')

    await act(async () => { fireEvent.click(boutonEntete()) })
    expect(volet().childElementCount).toBe(0)
    expect(boutonEntete().getAttribute('aria-pressed')).toBe('false')
  })

  it('la croix du volet le referme et relâche le bouton de l’en-tête', async () => {
    render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(boutonEntete()) })
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Fermer le panneau' })) })
    expect(volet().childElementCount).toBe(0)
    expect(boutonEntete().getAttribute('aria-pressed')).toBe('false')
  })

  it('la bulle mobile ouvre le MÊME volet que le bouton de l’en-tête', async () => {
    render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Ouvrir l'assistant" })) })
    expect(within(volet()).getByRole('heading', { name: 'Assistant' })).toBeTruthy()
    const bulle = screen.getByRole('button', { name: "Fermer l'assistant" })
    expect(bulle.getAttribute('aria-expanded')).toBe('true')
    expect(boutonEntete().getAttribute('aria-pressed')).toBe('true')
  })

  it('d’un dossier à l’autre, volet ouvert : le fil le plus récent du NOUVEAU dossier, rien de l’ancien', async () => {
    const { rerender } = render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(boutonEntete()) })
    expect(await within(volet()).findByText('Question du dossier A')).toBeTruthy()

    await act(async () => { rerender(<Page dossierId="dB" dossierNom="Dossier B" />) })
    expect(await within(volet()).findByText('Question du dossier B')).toBeTruthy()
    expect(within(volet()).queryByText('Question du dossier A')).toBeNull()
    expect(within(volet()).getByText('Dossier B')).toBeTruthy()
  })

  it('une lecture de l’ancien dossier arrivée APRÈS celle du nouveau ne la remplace pas', async () => {
    let relacherA: () => void = () => {}
    faux.retenues.dA = new Promise<void>((resolve) => { relacherA = resolve })
    const { rerender } = render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(boutonEntete()) })

    await act(async () => { rerender(<Page dossierId="dB" dossierNom="Dossier B" />) })
    expect(await within(volet()).findByText('Question du dossier B')).toBeTruthy()

    await act(async () => { relacherA() })
    expect(within(volet()).getByText('Question du dossier B')).toBeTruthy()
    expect(within(volet()).queryByText('Question du dossier A')).toBeNull()
  })

  it('envoyer une question l’adresse à l’assistant avec le fil affiché, et montre la réponse', async () => {
    render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(boutonEntete()) })
    await within(volet()).findByText('Question du dossier A')

    const zone = within(volet()).getByRole('textbox', { name: 'Question' })
    expect((within(volet()).getByRole('button', { name: 'Envoyer' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(zone, { target: { value: 'Et la TVA ?' } })
    await act(async () => { fireEvent.keyDown(zone, { key: 'Enter' }) })

    expect(await within(volet()).findByText('Réponse de l’assistant')).toBeTruthy()
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].nom).toBe('agent-comptable')
    expect(faux.appels[0].body).toEqual({
      dossierId: 'dA', message: 'Et la TVA ?', historique: [{ role: 'user', texte: 'Question du dossier A' }],
    })
    expect(faux.inserts.map((i) => [i.role, i.conversation_id, i.dossier_id])).toEqual([
      ['user', 'fil-A', 'dA'],
      ['assistant', 'fil-A', 'dA'],
    ])
  })

  it('un historique lu en partie le dit dans le volet', async () => {
    faux.muetApres = 0
    render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(boutonEntete()) })
    expect(await within(volet()).findByText(/L’historique des échanges n'a pas pu être lu en entier/)).toBeTruthy()
  })
})

// L'ENVOI D'UNE QUESTION NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026). `if (… loading …) return` lisait `loading` dans la
// fermeture du rendu : deux « Entrée » du même rendu le voyaient tous deux à `false`, et la question partait deux fois —
// deux appels au modèle FACTURÉS, deux lignes « user » et deux réponses comptées dans le plafond du cabinet. Le cas à TROIS
// envois est le seul à distinguer un verrou posé dans le `try`.
describe('Assistant — le verrou de l’envoi d’une question', () => {
  const versLAssistant = () => faux.appels.filter((a) => a.nom === 'agent-comptable')
  function retenirLaReponse(): () => Promise<void> {
    let ouvrir = () => {}
    faux.porteAssistant = new Promise<void>((resolve) => { ouvrir = resolve })
    return async () => {
      faux.porteAssistant = null
      await act(async () => { ouvrir() })
    }
  }
  async function zoneDeSaisie() {
    render(<Page dossierId="dA" dossierNom="Dossier A" />)
    await act(async () => { fireEvent.click(boutonEntete()) })
    await within(volet()).findByText('Question du dossier A')
    const zone = within(volet()).getByRole('textbox', { name: 'Question' })
    fireEvent.change(zone, { target: { value: 'Et la TVA ?' } })
    return zone
  }

  it('ne pose la question qu’une fois quand « Entrée » part deux fois dans le même rendu', async () => {
    const zone = await zoneDeSaisie()
    const liberer = retenirLaReponse()

    await act(async () => {
      fireEvent.keyDown(zone, { key: 'Enter' })
      fireEvent.keyDown(zone, { key: 'Enter' })
    })

    expect(versLAssistant()).toHaveLength(1)
    expect(faux.inserts.filter((i) => i.role === 'user')).toHaveLength(1)
    expect((zone as HTMLTextAreaElement).disabled).toBe(true)
    await liberer()
    expect(within(volet()).getAllByText('Réponse de l’assistant')).toHaveLength(1)
    expect(faux.inserts.filter((i) => i.role === 'assistant')).toHaveLength(1)
  })

  it('trois soumissions du même rendu ne la posent qu’une fois', async () => {
    const zone = await zoneDeSaisie()
    const formulaire = zone.closest('form')!
    const liberer = retenirLaReponse()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(versLAssistant()).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus, et le dit', async () => {
    faux.refusAssistant = 'Plafond de l’assistant atteint pour ce mois.'
    const zone = await zoneDeSaisie()

    await act(async () => { fireEvent.keyDown(zone, { key: 'Enter' }) })
    expect(within(volet()).getByText('Plafond de l’assistant atteint pour ce mois.')).toBeTruthy()
    fireEvent.change(zone, { target: { value: 'Et maintenant ?' } })
    await act(async () => { fireEvent.keyDown(zone, { key: 'Enter' }) })

    expect(versLAssistant()).toHaveLength(2)
  })
})
