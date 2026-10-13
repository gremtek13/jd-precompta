import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { ADRESSE_COPIEE, ADRESSE_ILLISIBLE, ceQueAccepteLAdresse, COPIE_REFUSEE, COPIER_L_ADRESSE, ENVOI_PAR_EMAIL } from '../lib/adresseCollecte'
import { motsDuCabinet } from '../lib/espaceVentes'
import { filtrer, predicatEq, type Ligne, type Predicat } from '../test/filtresPostgrest'

// « MES PIÈCES » ET L'ADRESSE DE COLLECTE DU DOSSIER (ligne 22.93) : ce que la page fait de la base. Elle lit `code_email`
// de la ligne de la société AFFICHÉE, à part de ses autres lectures, au montage, une fois ; avant le retour elle n'affirme
// rien ; lue, elle la montre dans « Déposer des fichiers » (avec ce que l'adresse accepte et un bouton qui la copie) et la
// carte des pièces jointes écartées la NOMME ; une lecture ratée ou un dossier sans code : pas d'adresse, la carte retombe sur
// « la même adresse » — jamais une adresse devinée ; une lecture plus lente que le changement de société ne s'affiche pas
// pour l'autre. Le faux client APPLIQUE le filtre `eq('id', …)` sur une table de dossiers. Ce que la carte dit : son propre
// test (PiecesJointesEcarteesClient.test.tsx).

const faux = vi.hoisted(() => ({
  dossier: 'dossier-a',
  // La table `dossiers` du faux client : une ligne par société, avec son code (ou null).
  dossiers: [] as { id: string; code_email: string | null }[],
  // Les lectures de `dossiers` reçues : ce que l'écran demande, et à quelle ligne.
  lectures: [] as { colonnes: string; filtres: [string, unknown][] }[],
  // Par société : une réponse refusée, une requête qui lève, une porte qui retient la réponse.
  refus: {} as Record<string, { message: string }>,
  leve: new Set<string>(),
  portes: {} as Record<string, Promise<void>>,
  // Les pièces jointes écartées de chaque société (la fonction de la ligne 22.9).
  ecartees: {} as Record<string, unknown[]>,
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filtres: [string, unknown][] = []
      const predicats: Predicat[] = []
      let colonnes = ''
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: (c: string) => { colonnes = c; return chaine },
        eq: (colonne: string, valeur: unknown) => { filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return chaine },
        order: () => chaine,
        range: () => chaine,
        // Les listes de « ce qu'il reste à envoyer » et des dépôts, vides et lues en entier : elles ne sont pas le sujet.
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
        // La lecture d'UNE ligne : la table des dossiers, filtrée comme PostgREST la filtre.
        maybeSingle: async () => {
          if (table !== 'dossiers') return { data: null, error: { message: `lecture inattendue : ${table}` } }
          faux.lectures.push({ colonnes, filtres: [...filtres] })
          const id = String(filtres.find(([c]) => c === 'id')?.[1])
          await faux.portes[id]
          if (faux.leve.has(id)) throw new Error('réseau coupé')
          if (faux.refus[id]) return { data: null, error: faux.refus[id] }
          const lignes = filtrer(faux.dossiers as Ligne[], predicats)
          return { data: lignes.length === 0 ? null : { code_email: lignes[0].code_email }, error: null }
        },
      })
      return chaine
    },
    rpc: (nom: string, args: { p_dossier_id: string }) => {
      const reponse = async () => {
        const data = nom === 'pieces_jointes_ecartees_du_client' ? faux.ecartees[args.p_dossier_id] ?? [] : []
        return { data, error: null, count: null, status: 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossier }),
}))

const ADRESSE_A = 'atelier-bernard-conseil-3f9a2c@precompta.jdarnis.fr'
const ADRESSE_B = 'sas-lumen-studio-7d41e0@precompta.jdarnis.fr'

function retenir(dossier: string): () => void {
  let ouvrir = () => {}
  faux.portes[dossier] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

// Les blancs ordinaires seulement : `\s` prendrait aussi les espaces insécables, qui tiennent un poids à son unité.
const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ')
const BLOC = () => document.querySelector('.adresse-collecte-client')

beforeEach(() => {
  faux.dossier = 'dossier-a'
  faux.dossiers = [
    { id: 'dossier-a', code_email: 'atelier-bernard-conseil-3f9a2c' },
    { id: 'dossier-b', code_email: 'sas-lumen-studio-7d41e0' },
    { id: 'dossier-sans-code', code_email: null },
  ]
  faux.lectures = []
  faux.refus = {}
  faux.leve = new Set()
  faux.portes = {}
  faux.ecartees = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

async function monter() {
  const rendu = render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Mes dépôts' })
  return rendu
}

describe('ClientUpload — la lecture de l’adresse de collecte de la société affichée', () => {
  it('lit `code_email` de la ligne du dossier affiché, une fois, sans rien dire avant son retour', async () => {
    const ouvrir = retenir('dossier-a')
    await monter()
    expect(faux.lectures).toEqual([{ colonnes: 'code_email', filtres: [['id', 'dossier-a']] }])
    // Avant le retour : ni adresse, ni bloc, ni erreur — une lecture qui n'est pas revenue n'affirme rien.
    expect(BLOC()).toBeNull()
    expect(texte()).not.toContain('@')
    expect(screen.queryByText(ADRESSE_ILLISIBLE)).toBeNull()

    await act(async () => { ouvrir() })
    await waitFor(() => expect(BLOC()).not.toBeNull())
    expect(faux.lectures).toHaveLength(1)
  })

  it('« Déposer des fichiers » dit qu’on peut envoyer par e-mail, à l’adresse, ce qu’elle accepte, et offre de la copier', async () => {
    await monter()
    const bloc = await waitFor(() => {
      const b = BLOC()
      if (!b) throw new Error('le bloc de l’adresse n’est pas là')
      return b as HTMLElement
    })
    // Dans la section « Déposer des fichiers », après ses boutons, et nulle part ailleurs.
    const titre = screen.getByRole('heading', { name: 'Déposer des fichiers' })
    expect(titre.nextElementSibling?.contains(bloc)).toBe(true)
    expect(within(bloc).getByText(ENVOI_PAR_EMAIL)).toBeTruthy()
    expect(within(bloc).getByText(ADRESSE_A).tagName).toBe('CODE')
    // (lu en `textContent` : « 20 Mo » tient son unité par une espace insécable, que `getByText` ramène à une espace.)
    expect(bloc.textContent).toContain(ceQueAccepteLAdresse())
    expect(within(bloc).getByRole('button', { name: COPIER_L_ADRESSE })).toBeTruthy()
    expect(screen.getAllByText(ADRESSE_A)).toHaveLength(1)
    // Les mots du client : tutoiement, aucun onglet, jamais « le client ».
    expect(motsDuCabinet(bloc.textContent ?? '')).toEqual([])
    expect(bloc.textContent ?? '').not.toMatch(/\bclients?\b/i)
  })

  it('la carte des pièces jointes écartées NOMME l’adresse lue, à la place de « la même adresse »', async () => {
    faux.ecartees['dossier-a'] = [{ jour: '2026-10-12', raison: 'format', octets: 4120 }]
    await monter()
    await waitFor(() => expect(BLOC()).not.toBeNull())
    const carte = await screen.findByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    expect(carte.textContent).toContain(`ou par e-mail, à ${ADRESSE_A}.`)
    expect(carte.textContent).not.toContain('la même adresse')
    // L'adresse est lue une fois pour la carte ET le bloc : une seule lecture de la ligne.
    expect(faux.lectures).toHaveLength(1)
  })

  it('tant que l’adresse n’est pas revenue, la carte garde « la même adresse » ; elle la nomme au retour', async () => {
    faux.ecartees['dossier-a'] = [{ jour: '2026-10-12', raison: 'format', octets: 4120 }]
    const ouvrir = retenir('dossier-a')
    await monter()
    const carte = await screen.findByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    expect(carte.textContent).toContain('ou par e-mail, à la même adresse.')
    await act(async () => { ouvrir() })
    await waitFor(() => expect(carte.textContent).toContain(`à ${ADRESSE_A}.`))
  })

  it('une lecture refusée : pas d’adresse, la raison dite au client, la carte garde « la même adresse »', async () => {
    faux.refus['dossier-a'] = { message: 'permission denied for table dossiers' }
    faux.ecartees['dossier-a'] = [{ jour: '2026-10-12', raison: 'format', octets: 4120 }]
    await monter()
    const dit = await screen.findByText(ADRESSE_ILLISIBLE)
    expect(dit.getAttribute('title')).toBe('lecture refusée : permission denied for table dossiers')
    expect(BLOC()).toBeNull()
    expect(texte()).not.toContain('@')
    const carte = await screen.findByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    expect(carte.textContent).toContain('ou par e-mail, à la même adresse.')
  })

  it('une requête qui lève tombe du même côté : jamais une adresse', async () => {
    faux.leve.add('dossier-a')
    await monter()
    const dit = await screen.findByText(ADRESSE_ILLISIBLE)
    expect(dit.getAttribute('title')).toBe('lecture impossible : réseau coupé')
    expect(BLOC()).toBeNull()
    expect(texte()).not.toContain('@')
  })

  it('un dossier introuvable (la RLS ne rend rien) se dit aussi, sans adresse', async () => {
    faux.dossier = 'dossier-inconnu'
    await monter()
    const dit = await screen.findByText(ADRESSE_ILLISIBLE)
    expect(dit.getAttribute('title')).toBe('dossier introuvable')
    expect(BLOC()).toBeNull()
  })

  it('un dossier sans code : ni adresse, ni bloc, ni erreur — et la carte garde « la même adresse »', async () => {
    faux.dossier = 'dossier-sans-code'
    faux.ecartees['dossier-sans-code'] = [{ jour: '2026-10-12', raison: 'format', octets: 4120 }]
    await monter()
    const carte = await screen.findByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    await waitFor(() => expect(faux.lectures).toHaveLength(1))
    // La lecture est revenue (la carte et la fonction aussi) : rien n'est apparu pour autant.
    await act(async () => { await Promise.resolve() })
    expect(BLOC()).toBeNull()
    expect(screen.queryByText(ADRESSE_ILLISIBLE)).toBeNull()
    expect(texte()).not.toContain('@')
    expect(carte.textContent).toContain('ou par e-mail, à la même adresse.')
  })
})

describe('ClientUpload — une lecture plus lente que le changement de société ne s’affiche pas pour l’autre', () => {
  it('la réponse de la société quittée, arrivée en dernier, n’écrit rien ; l’adresse de la société affichée reste la sienne', async () => {
    const ouvrirA = retenir('dossier-a')
    const { rerender } = await monter()
    faux.dossier = 'dossier-b'
    rerender(<MemoryRouter><ClientUpload /></MemoryRouter>)
    await waitFor(() => expect(faux.lectures.map((l) => l.filtres[0][1])).toEqual(['dossier-a', 'dossier-b']))
    await waitFor(() => expect(screen.getByText(ADRESSE_B)).toBeTruthy())
    await act(async () => { ouvrirA() })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(ADRESSE_A)).toBeNull()
    expect(screen.getByText(ADRESSE_B)).toBeTruthy()
  })

  it('la société nouvelle n’affiche pas l’adresse de la précédente pendant sa propre lecture', async () => {
    const { rerender } = await monter()
    await waitFor(() => expect(screen.getByText(ADRESSE_A)).toBeTruthy())
    const ouvrirB = retenir('dossier-b')
    faux.dossier = 'dossier-b'
    rerender(<MemoryRouter><ClientUpload /></MemoryRouter>)
    // La lecture de B n'est pas revenue : rien n'est affirmé, et surtout pas l'adresse de A.
    await waitFor(() => expect(faux.lectures).toHaveLength(2))
    expect(screen.queryByText(ADRESSE_A)).toBeNull()
    expect(BLOC()).toBeNull()
    await act(async () => { ouvrirB() })
    await waitFor(() => expect(screen.getByText(ADRESSE_B)).toBeTruthy())
    expect(screen.queryByText(ADRESSE_A)).toBeNull()
  })
})

describe('ClientUpload — « Copier l’adresse » : le « copié ✓ » deux secondes, et son minuteur part avec l’écran', () => {
  let ecrire: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ecrire = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: ecrire } })
  })

  // Montée avec les vrais minuteurs (la recherche d'un élément en dépend), puis seuls les minuteurs simulés.
  async function prete() {
    const rendu = await monter()
    await waitFor(() => expect(BLOC()).not.toBeNull())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    return rendu
  }

  it('copie l’adresse lue, le dit, et le dit deux secondes', async () => {
    await prete()
    await act(async () => { screen.getByRole('button', { name: COPIER_L_ADRESSE }).click() })
    expect(ecrire).toHaveBeenCalledWith(ADRESSE_A)
    expect(screen.getByRole('button', { name: ADRESSE_COPIEE })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(1999) })
    expect(screen.getByRole('button', { name: ADRESSE_COPIEE })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: COPIER_L_ADRESSE })).toBeTruthy()
  })

  it('le minuteur part avec l’écran : armé pendant le « copié ✓ », plus aucun après le démontage', async () => {
    const { unmount } = await prete()
    await act(async () => { screen.getByRole('button', { name: COPIER_L_ADRESSE }).click() })
    // Le garde voit bien le minuteur armé : sans cette ligne, « zéro après le démontage » passerait aussi pour un écran
    // qui n'en arme aucun.
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('deux copies rapprochées ne laissent qu’un minuteur', async () => {
    await prete()
    await act(async () => { screen.getByRole('button', { name: COPIER_L_ADRESSE }).click() })
    await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => { screen.getByRole('button', { name: ADRESSE_COPIEE }).click() })
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByRole('button', { name: ADRESSE_COPIEE })).toBeTruthy()
  })

  it('une copie encore en vol au démontage n’arme aucun minuteur', async () => {
    let finir = () => {}
    ecrire.mockImplementation(() => new Promise<void>((resolve) => { finir = resolve }))
    const { unmount } = await prete()
    await act(async () => { screen.getByRole('button', { name: COPIER_L_ADRESSE }).click() })
    unmount()
    await act(async () => { finir() })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un presse-papiers refusé se dit, sans erreur non gérée : l’adresse reste affichée, à copier à la main', async () => {
    ecrire.mockRejectedValue(new Error('NotAllowedError'))
    await prete()
    await act(async () => { screen.getByRole('button', { name: COPIER_L_ADRESSE }).click() })
    expect(screen.getByRole('status').textContent).toBe(COPIE_REFUSEE)
    expect(screen.getByRole('button', { name: COPIER_L_ADRESSE })).toBeTruthy()
    expect(screen.getByText(ADRESSE_A)).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
    // Une copie qui réussit ensuite efface le refus.
    ecrire.mockResolvedValue(undefined)
    await act(async () => { screen.getByRole('button', { name: COPIER_L_ADRESSE }).click() })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: ADRESSE_COPIEE })).toBeTruthy()
  })
})
