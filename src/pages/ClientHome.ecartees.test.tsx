import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientHome from './ClientHome'
import { motsDuCabinet } from '../lib/espaceVentes'
import { ACCUEIL_VERIFICATION_IMPOSSIBLE, VOIR_DANS_MES_PIECES } from '../lib/piecesJointesEcarteesClient'

// L'ACCUEIL DU CLIENT ET LES PIÈCES JOINTES ÉCARTÉES (ligne 22.94) : ce que la page fait de la base. Drapeau levé, elle lit
// `pieces_jointes_ecartees_du_client` au montage, une fois, pour la société affichée — la même lecture que « Mes pièces »
// (ClientUpload.ecartees.test.tsx), écrite une fois — et dit : rien avant la réponse, rien sur un vide lu en entier, UNE LIGNE
// (le combien, un renvoi vers « Mes pièces ») sur une liste, une ligne discrète sur une lecture manquée. Elle vit À PART du
// reste de l'accueil (sa panne n'en fausse aucune autre lecture, et la panne des autres ne la tait pas), et une réponse
// plus lente que le changement de société ne s'affiche pas pour l'autre. Drapeau baissé (l'état d'avant la bascule, gardé
// tant que son code existe) : aucun appel, aucune ligne. Ce que la ligne dit : PiecesJointesEcarteesAccueil.test.tsx.

const faux = vi.hoisted(() => ({
  drapeau: true,
  dossier: 'dossier-a',
  rpcs: [] as { nom: string; args: unknown }[],
  // Les tables que l'accueil lit pour ses propres chiffres : refusées pour la panne d'une AUTRE lecture.
  tablesRefusees: new Set<string>(),
  // Par société : la réponse de la fonction, et une porte qui la retient tant qu'on ne l'ouvre pas.
  ecartees: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  portes: {} as Record<string, Promise<void>>,
}))

vi.mock('../lib/piecesJointesEcarteesClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/piecesJointesEcarteesClient')>(),
  get ECARTEES_DU_CLIENT_EXPORTEES() { return faux.drapeau },
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: () => chaine,
        maybeSingle: () => Promise.resolve({ data: { id: 'x', nom: 'Dossier fictif' }, error: null }),
        then: (suite: (r: unknown) => unknown) => Promise.resolve(faux.tablesRefusees.has(table)
          ? { data: null, error: { message: 'permission denied' }, count: null }
          : { data: [], error: null, count: 0 }).then(suite),
      })
      return chaine
    },
    rpc: (nom: string, args: { p_dossier_id: string }) => {
      faux.rpcs.push({ nom, args })
      const reponse = async () => {
        if (nom === 'couverture_du_releve') return { data: [], error: null, count: null, status: 200, statusText: '' }
        await faux.portes[args.p_dossier_id]
        const r = faux.ecartees[args.p_dossier_id] ?? { data: [], error: null }
        return { ...r, count: null, status: r.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossier, prenom: null, mesSocietes: [], droitsParDossier: {} }),
}))

function retenir(dossier: string): () => void {
  let ouvrir = () => {}
  faux.portes[dossier] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ')
const appelsEcartees = () => faux.rpcs.filter((r) => r.nom === 'pieces_jointes_ecartees_du_client')
const LIGNE = 'Pièces jointes reçues par e-mail et non déposées'

beforeEach(() => {
  faux.drapeau = true
  faux.dossier = 'dossier-a'
  faux.rpcs = []
  faux.tablesRefusees = new Set()
  faux.ecartees = {}
  faux.portes = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

async function monter() {
  const rendu = render(<MemoryRouter><ClientHome /></MemoryRouter>)
  // L'accueil lu : les chiffres ont remplacé les squelettes.
  await screen.findByText('Ce qu\'il reste à envoyer')
  return rendu
}

describe('ClientHome — drapeau levé : la ligne des pièces jointes écartées', () => {
  it('lit la fonction au montage, UNE fois, pour la société affichée ; rien avant la réponse, la ligne après', async () => {
    faux.ecartees['dossier-a'] = {
      data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }, { jour: '2026-10-11', raison: 'depot', octets: null }],
      error: null,
    }
    const ouvrir = retenir('dossier-a')
    await monter()
    expect(appelsEcartees()).toEqual([{ nom: 'pieces_jointes_ecartees_du_client', args: { p_dossier_id: 'dossier-a' } }])
    // Avant le retour : rien d'affirmé — ni ligne, ni attente, ni « aucune » —, et le reste de l'accueil est là.
    expect(screen.queryByRole('region', { name: LIGNE })).toBeNull()
    expect(texte()).not.toMatch(/pièces jointes reçues par e-mail/i)
    expect(screen.getByText('Mes pièces')).toBeTruthy()

    await act(async () => { ouvrir() })
    const ligne = await screen.findByRole('region', { name: LIGNE })
    expect(ligne.textContent).toBe(`2 pièces jointes reçues par e-mail n’ont pas été déposées${VOIR_DANS_MES_PIECES}`)
    expect(screen.getByRole('link', { name: VOIR_DANS_MES_PIECES }).getAttribute('href')).toBe('/mes-pieces')
    // Ni la raison, ni le jour, ni le poids : la carte de « Mes pièces » les dit.
    expect(ligne.textContent).not.toMatch(/format|échoué|\d{2}\/\d{2}|Ko|poids/)
    expect(appelsEcartees()).toHaveLength(1)
    expect(motsDuCabinet(ligne.textContent ?? '')).toEqual([])
  })

  it('une seule pièce jointe : la phrase au singulier', async () => {
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'vide', octets: 0 }], error: null }
    await monter()
    const ligne = await screen.findByRole('region', { name: LIGNE })
    expect(ligne.textContent).toContain('1 pièce jointe reçue par e-mail n’a pas été déposée')
  })

  it('elle est placée AVANT les tuiles et ne remplace aucune d’elles', async () => {
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }], error: null }
    await monter()
    const ligne = await screen.findByRole('region', { name: LIGNE })
    const tuiles = document.querySelector('.tuiles')
    expect(tuiles).not.toBeNull()
    expect(ligne.compareDocumentPosition(tuiles as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const libelle of ['Prendre une photo', 'Mes pièces', 'Mes informations', 'Ma simulation']) {
      expect(screen.getByText(libelle)).toBeTruthy()
    }
    expect(document.querySelectorAll('.tuile')).toHaveLength(4)
  })

  it('lue en entier et vide : rien — ni ligne, ni « aucune »', async () => {
    faux.ecartees['dossier-a'] = { data: [], error: null }
    await monter()
    await waitFor(() => expect(appelsEcartees()).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('region', { name: LIGNE })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Vérification des pièces jointes reçues par e-mail' })).toBeNull()
    expect(texte()).not.toMatch(/pièces jointes reçues par e-mail/i)
  })

  it.each([
    ['refusée', { data: null, error: { message: 'Accès refusé à ce dossier.' } }, 'lecture refusée : Accès refusé à ce dossier.'],
    ['illisible', { data: { jour: '2026-10-12' }, error: null }, 'réponse illisible'],
  ])('%s : une ligne discrète qui dit que la vérification n’a pas pu se faire — jamais le silence d’une liste vide', async (_nom, reponse, motif) => {
    faux.ecartees['dossier-a'] = reponse
    await monter()
    const bloc = await screen.findByRole('region', { name: 'Vérification des pièces jointes reçues par e-mail' })
    expect(screen.getByText(ACCUEIL_VERIFICATION_IMPOSSIBLE).getAttribute('title')).toBe(motif)
    expect(bloc.textContent).toContain(VOIR_DANS_MES_PIECES)
    expect(screen.queryByRole('region', { name: LIGNE })).toBeNull()
  })

  it('la lecture vit À PART : la panne des listes de l’accueil ne la tait pas, la sienne n’en fausse aucune', async () => {
    // Les pièces refusées : le bandeau de l'accueil parle, et la ligne des pièces jointes écartées se dit quand même.
    faux.tablesRefusees = new Set(['pieces'])
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }], error: null }
    const { unmount } = await monter()
    expect(await screen.findByRole('region', { name: LIGNE })).toBeTruthy()
    expect(screen.getByText(/Tes envois n'ont pas pu être affichés en entier\./)).toBeTruthy()
    unmount()

    // Et l'inverse : la lecture des pièces jointes refusée n'ajoute aucun bandeau « Tes envois », ni ne vide les chiffres.
    faux.tablesRefusees = new Set()
    faux.rpcs = []
    faux.ecartees['dossier-a'] = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    await monter()
    await screen.findByRole('region', { name: 'Vérification des pièces jointes reçues par e-mail' })
    expect(screen.queryByText(/Tes envois n'ont pas pu être affichés/)).toBeNull()
    expect(screen.getByText('Mes derniers envois')).toBeTruthy()
  })

  it('une réponse plus lente que le changement de société ne s’affiche pas pour l’autre', async () => {
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }], error: null }
    faux.ecartees['dossier-b'] = { data: [{ jour: '2026-10-01', raison: 'vide', octets: 0 }, { jour: '2026-10-02', raison: 'vide', octets: 0 }, { jour: '2026-10-03', raison: 'vide', octets: 0 }], error: null }
    const ouvrirA = retenir('dossier-a')
    const ouvrirB = retenir('dossier-b')
    const { rerender } = await monter()
    faux.dossier = 'dossier-b'
    rerender(<MemoryRouter><ClientHome /></MemoryRouter>)
    await waitFor(() => expect(appelsEcartees().map((a) => (a.args as { p_dossier_id: string }).p_dossier_id)).toEqual(['dossier-a', 'dossier-b']))
    // La première société répond la première : la seconde attend toujours la sienne — rien n'est dit.
    await act(async () => { ouvrirA() })
    expect(screen.queryByRole('region', { name: LIGNE })).toBeNull()
    await act(async () => { ouvrirB() })
    const ligne = await screen.findByRole('region', { name: LIGNE })
    expect(ligne.textContent).toContain('3 pièces jointes reçues par e-mail n’ont pas été déposées')
  })
})

describe('ClientHome — drapeau baissé : la fonction n’est pas en base', () => {
  it('aucun appel, aucune ligne, aucune vérification impossible', async () => {
    faux.drapeau = false
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }], error: null }
    await monter()
    await act(async () => { await Promise.resolve() })
    expect(appelsEcartees()).toEqual([])
    expect(screen.queryByRole('region', { name: LIGNE })).toBeNull()
    expect(texte()).not.toMatch(/pièces jointes reçues par e-mail/i)
  })
})
