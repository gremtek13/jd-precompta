import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RetourBanque from './RetourBanque'

// LE RETOUR DE LA BANQUE (connexion bancaire, ligne 24). Le code d'autorisation ne sert qu'UNE fois et ne
// vit que quelques minutes : ce test monte l'écran en MODE STRICT, où React monte, démonte et remonte
// chaque composant — c'est ce qui ferait partir le code deux fois, et le second échouer sur un code déjà
// consommé, alors que la connexion vient d'aboutir. Et un simple drapeau « déjà lancé » laisserait le
// second montage attendre une réponse que seul le premier, démonté, aurait reçue.

type Reponse = { data: unknown; error: unknown }

const faux = vi.hoisted(() => ({
  invocations: [] as Record<string, unknown>[],
  resoudre: null as null | ((v: Reponse) => void),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (nom: string, options: { body: Record<string, unknown> }) => {
        if (nom !== 'banque-connexion') throw new Error(`Fonction non attendue : ${nom}`)
        faux.invocations.push(options.body)
        return new Promise((resolve) => { faux.resoudre = resolve })
      },
    },
  },
}))

const ETAT = '6f1c2f3e-7a5b-4c1d-9e8f-0a1b2c3d4e5f'

function Destination() {
  const location = useLocation()
  const type = useNavigationType()
  return <p>{`Arrivé sur ${location.pathname} (${type})`}</p>
}

function monter(adresse: string) {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[adresse]}>
        <Routes>
          <Route path="/retour-banque" element={<RetourBanque />} />
          <Route path="/dossiers/:id/:tab" element={<Destination />} />
          <Route path="/dossiers" element={<p>Liste des dossiers</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
}

const reussite = (o: Record<string, unknown> = {}): Reponse => ({
  data: { dossierId: 'dossier-de-test', renouvellement: false, compte_repris: false, avertissement: null, ...o },
  error: null,
})

beforeEach(() => {
  faux.invocations = []
  faux.resoudre = null
})

describe('le retour de la banque', () => {
  it('remet le code UNE fois, même monté deux fois, puis rejoint l’onglet Banque en remplaçant la page', async () => {
    monter(`/retour-banque?code=code-de-la-banque&state=${ETAT}`)
    expect(screen.getByText(/Enregistrement de l’accord de la banque/)).toBeTruthy()
    expect(faux.invocations).toEqual([{ action: 'finaliser', code: 'code-de-la-banque', state: ETAT }])
    await act(async () => { faux.resoudre!(reussite()) })
    // REPLACE : le code d'autorisation ne reste pas à portée du bouton « précédent ».
    expect(screen.getByText('Arrivé sur /dossiers/dossier-de-test/banque (REPLACE)')).toBeTruthy()
    expect(faux.invocations).toHaveLength(1)
  })

  it('un avertissement se dit avant de rejoindre l’onglet, au lieu d’être emporté par la navigation', async () => {
    monter(`/retour-banque?code=c&state=${ETAT}`)
    await act(async () => {
      faux.resoudre!(reussite({ renouvellement: true, compte_repris: true, avertissement: "L'accord précédent n'a pas pu être refermé chez la banque : il expirera de lui-même." }))
    })
    expect(screen.getByText('La banque est connectée.')).toBeTruthy()
    expect(screen.getByText(/L'accord précédent n'a pas pu être refermé/)).toBeTruthy()
    expect(screen.queryByText(/Arrivé sur/)).toBeNull()
    await act(async () => { screen.getByRole('link', { name: 'Continuer vers l’onglet Banque' }).click() })
    expect(screen.getByText('Arrivé sur /dossiers/dossier-de-test/banque (REPLACE)')).toBeTruthy()
  })

  it('un renouvellement qui perd le compte importé le dit', async () => {
    monter(`/retour-banque?code=c&state=${ETAT}`)
    await act(async () => { faux.resoudre!(reussite({ renouvellement: true, compte_repris: false })) })
    expect(screen.getByText(/n'ouvre plus le compte que tu importais/)).toBeTruthy()
  })

  it('une première connexion sans compte repris ne dit rien de plus — le garde symétrique', async () => {
    monter(`/retour-banque?code=c&state=${ETAT}`)
    await act(async () => { faux.resoudre!(reussite({ renouvellement: false, compte_repris: false })) })
    expect(screen.getByText(/Arrivé sur \/dossiers\/dossier-de-test\/banque/)).toBeTruthy()
  })

  it('un refus de la fonction se dit, sans navigation', async () => {
    monter(`/retour-banque?code=c&state=${ETAT}`)
    await act(async () => {
      faux.resoudre!({
        data: null,
        error: { context: new Response(JSON.stringify({ error: "Cette demande de connexion n'existe plus." }), { status: 404 }) },
      })
    })
    expect(screen.getByText("Cette demande de connexion n'existe plus.")).toBeTruthy()
    expect(screen.queryByText(/Arrivé sur/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Retour aux dossiers' })).toBeTruthy()
  })

  it('l’erreur rendue par la banque n’appelle rien, et dit son code', () => {
    monter(`/retour-banque?error=access_denied&state=${ETAT}`)
    expect(faux.invocations).toEqual([])
    expect(screen.getByText(/La banque n'a pas donné accès aux comptes : la connexion n'a pas abouti \(access_denied\)/)).toBeTruthy()
  })

  it('un texte fabriqué dans l’adresse ne s’affiche pas', () => {
    monter(`/retour-banque?error=${encodeURIComponent('Appelez le 08 00 00 00 00 pour débloquer')}&state=${ETAT}`)
    expect(faux.invocations).toEqual([])
    expect(screen.getByText(/La banque n'a pas donné accès aux comptes/)).toBeTruthy()
    expect(screen.queryByText(/Appelez/)).toBeNull()
  })

  it('une adresse sans réponse de banque n’appelle rien', () => {
    monter('/retour-banque')
    expect(faux.invocations).toEqual([])
    expect(screen.getByText(/ne porte pas de réponse de banque/)).toBeTruthy()
  })
})
