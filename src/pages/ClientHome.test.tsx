import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientHome from './ClientHome'
import type { ResultatDepot } from '../lib/depot'

// L'ÉCRAN OÙ LA BONNE NOUVELLE FABRIQUÉE COÛTAIT LE PLUS CHER, et le premier écran CLIENT à
// recevoir un test de rendu.
//
// Au passage d'une année, « ce qu'il reste à envoyer » repartait à zéro : `moisEcoules` vaut 0 le
// 1er janvier et cet écran ne connaissait que l'année EN COURS, donc il annonçait « Relevés
// bancaires 2027 » avec RIEN à envoyer pendant que les douze mois de 2026 étaient dus. Personne ne
// va vérifier une bonne nouvelle — et le client, lui, n'a aucun autre endroit où la démentir.
//
// CE QUE CE TEST GARDE, ET QU'AUCUN TEST DE `src/lib` NE PEUT GARDER : le CÂBLAGE.
// `exercicesAReclamer` est juste et couvert par ses propres mutations ; ce qui se joue ici est que
// cet écran-ci lise vraiment `exercices_clotures` et en tienne compte, et qu'il le fasse avec la
// MÊME année que son compte de mois (l'appariement qui avait déjà divergé une fois).
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  refusees: new Set<string>(),
  // Les dépôts partis par la prise de photo — chacun un envoi, une lecture FACTURÉE, une pièce —, la porte qui retient
  // leur réponse, et ce qu'ils rendent.
  depots: 0,
  porteDepot: null as Promise<void> | null,
  resultatDepot: { statut: 'ok', cible: { type: 'piece', id: 'p-nouvelle' } } as ResultatDepot,
  depotReel: false,
}))

// Le pipeline du dépôt (empreinte, envoi, lecture, insertion) est gardé par ses propres tests : on compte ici ce que
// l'écran lui DEMANDE.
// `depotReel` y substitue le VRAI dépôt : les bornes du seau des pièces (ligne 22.6) se jugent avant tout envoi.
vi.mock('../lib/depot', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../lib/depot')>()
  return {
    deposerFichier: async (...args: Parameters<typeof reel.deposerFichier>) => {
      faux.depots += 1
      if (faux.depotReel) return reel.deposerFichier(...args)
      await faux.porteDepot
      return faux.resultatDepot
    },
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null }),
        then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count: number }) => unknown) => {
          if (faux.refusees.has(table)) {
            return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: 0 }).then(suite)
          }
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({
            data: toutes.slice(debut, debut + (fin - debut + 1)),
            error: null,
            count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
    // La couverture du relevé (espace client, étape P7) : déduite des mêmes mouvements, refusée avec eux — ce fichier vaut
    // drapeau levé comme baissé (`COUVERTURE_EXPORTEE`, voir src/test/couvertureDuReleve.ts).
    // Et les pièces jointes écartées (ligne 22.94), que l'accueil lit à part : aucune, lue en entier — ce fichier n'est pas celui de
    // la ligne qui les signale (ClientHome.ecartees.test.tsx), et rien d'autre ne dépend de cette lecture.
    rpc: async (nom: string) => {
      const { couvertureDe } = await import('../test/couvertureDuReleve')
      if (nom === 'pieces_jointes_ecartees_du_client') return { data: [], error: null }
      if (nom !== 'couverture_du_releve') return { data: null, error: { message: `fonction inattendue : ${nom}` } }
      if (faux.refusees.has('lignes_bancaires')) return { data: null, error: { message: 'permission denied' } }
      return { data: couvertureDe(faux.parTable.lignes_bancaires ?? []), error: null }
    },
  },
}))

// Monter un `AuthProvider` complet ferait dépendre ce test d'une session Supabase — même doublure
// que `PiecesTab` (voir CLAUDE.md, « deux doublures à connaître »).
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test', prenom: null, mesSocietes: [] }),
}))

function poser(o: {
  lignes?: { id: string; date: string }[]
  clotures?: { annee: number }[]
  clotureRefusee?: boolean
} = {}) {
  faux.parTable = {
    dossiers: [{ id: 'dossier-de-test', nom: 'Dossier de test' }],
    pieces: [],
    documents_divers: [],
    lignes_bancaires: o.lignes ?? [],
    cotisations_declarees: [],
    exercices_clotures: o.clotures ?? [],
  }
  faux.refusees = new Set(o.clotureRefusee ? ['exercices_clotures'] : [])
}

function monter() {
  return render(<MemoryRouter><ClientHome /></MemoryRouter>)
}

describe('ClientHome — au 1er janvier, l’exercice révolu reste réclamé', () => {
  // L'HORLOGE EST FIXÉE, et c'est ce qui décide de ce que ce test garde : le défaut ne se voit qu'au
  // passage d'une année, donc lu sur l'heure courante il serait vert par hasard onze mois sur douze.
  // Seul `Date` est feint — geler les minuteurs ferait expirer chaque `findByText` (voir
  // ChecklistTab.test.tsx).
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-01-05T09:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  it('RÉCLAME 2026 EN ENTIER alors qu’aucun mois de 2027 n’est écoulé', async () => {
    poser()
    monter()

    expect(await screen.findByText('Relevés bancaires 2026')).toBeTruthy()
    expect(screen.getByText(/Mois manquants : janvier, février, mars/)).toBeTruthy()
    // Garde d'APPARIEMENT : l'année de l'exercice en cours et son compte de mois viennent du même
    // instant. C'est l'écart entre les deux qui produisait « 2026 » et « rien à envoyer ».
    expect(screen.getByText('Relevés bancaires 2027')).toBeTruthy()
    expect(screen.getByText('Aucun mois encore terminé cette année')).toBeTruthy()
  })

  it('CESSE de réclamer 2026 une fois la clôture cochée par le cabinet', async () => {
    poser({ clotures: [{ annee: 2026 }] })
    monter()

    // Garde SYMÉTRIQUE d'abord : sans elle, « 2026 a disparu » serait satisfait par un écran vide.
    expect(await screen.findByText('Relevés bancaires 2027')).toBeTruthy()
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
  })

  it('NE MONTRE PAS un exercice révolu qui n’a plus rien à envoyer', async () => {
    // Douze relevés pour 2026 : le point est satisfait, donc il n'apprend rien et disparaît. Sans ce
    // filtre, un client à jour lirait SIX points pour s'entendre dire qu'il ne reste rien.
    poser({
      lignes: Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, date: `2026-${String(i + 1).padStart(2, '0')}-15` })),
    })
    monter()

    expect(await screen.findByText('Relevés bancaires 2027')).toBeTruthy()
    expect(screen.queryAllByText('Relevés bancaires 2026')).toHaveLength(0)
  })

  it('CONTINUE de réclamer quand la liste des clôtures est illisible, ET LE DIT', async () => {
    // L'échec tombe du côté qui demande un document de trop, jamais du côté qui se tait : cesser de
    // réclamer sur une panne est indiscernable d'un dossier à jour.
    poser({ clotureRefusee: true })
    monter()

    expect(await screen.findByText('Relevés bancaires 2026')).toBeTruthy()
    // Registre CLIENT : on ne lui sert ni le mot « exercice » ni un motif technique.
    expect(screen.getByText(/déjà bouclée/)).toBeTruthy()
  })

  it('SE TAIT sur les clôtures quand la lecture a réussi', async () => {
    // Garde symétrique : une mise en garde permanente cesse d'être lue.
    poser()
    monter()

    await screen.findByText('Relevés bancaires 2026')
    expect(screen.queryAllByText(/déjà bouclée/)).toHaveLength(0)
  })
})

// « PRENDRE UNE PHOTO » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026). `disabled={capturing}` ne prend effet qu'au rendu
// suivant, et chaque dépôt partait avec son propre ensemble d'empreintes (`new Set()`) : deux envois du même rendu
// passaient tous deux la vérification en base, et le même reçu entrait deux fois — deux pièces, et deux lectures
// FACTURÉES. `pieces` n'a pas d'index unique sur l'empreinte (voir lib/depot.ts). Le cas à TROIS envois est le seul à
// distinguer un verrou posé dans le `try`.
describe('ClientHome — le verrou de la prise de photo', () => {
  beforeEach(() => {
    poser()
    faux.depots = 0
    faux.porteDepot = null
    faux.resultatDepot = { statut: 'ok', cible: { type: 'piece', id: 'p-nouvelle' } }
  })
  afterEach(() => { faux.porteDepot = null })

  function retenirLeDepot(): () => Promise<void> {
    let ouvrir = () => {}
    faux.porteDepot = new Promise<void>((resolve) => { ouvrir = resolve })
    return async () => {
      faux.porteDepot = null
      await act(async () => { ouvrir() })
    }
  }
  const champ = () => document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement
  const photo = () => new File(['jpeg'], 'recu.jpg', { type: 'image/jpeg' })

  it('ne dépose qu’une fois quand la photo arrive deux fois dans le même rendu', async () => {
    monter()
    await screen.findByText('Prendre une photo')
    const liberer = retenirLeDepot()

    await act(async () => {
      fireEvent.change(champ(), { target: { files: [photo()] } })
      fireEvent.change(champ(), { target: { files: [photo()] } })
    })

    expect(faux.depots).toBe(1)
    expect(champ().disabled).toBe(true)
    expect(screen.getByText('Analyse en cours…')).toBeTruthy()
    await liberer()
  })

  it('trois envois dans le même rendu ne déposent qu’une fois', async () => {
    monter()
    await screen.findByText('Prendre une photo')
    const liberer = retenirLeDepot()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.change(champ(), { target: { files: [photo()] } }) })

    expect(faux.depots).toBe(1)
    await liberer()
  })

  it('relâche le verrou sur un dépôt refusé, et le dit', async () => {
    faux.resultatDepot = { statut: 'erreur', message: 'envoi refusé' }
    monter()
    await screen.findByText('Prendre une photo')

    await act(async () => { fireEvent.change(champ(), { target: { files: [photo()] } }) })
    expect(screen.getByText('recu.jpg : envoi refusé.')).toBeTruthy()
    await act(async () => { fireEvent.change(champ(), { target: { files: [photo()] } }) })

    expect(faux.depots).toBe(2)
  })
})

// LES BORNES DU SEAU DES PIÈCES (ligne 22.6), jouées par le VRAI dépôt : `accept="image/*"` laisse choisir, depuis un
// ordinateur, une image que le seau n'admet pas (HEIC, GIF, SVG…) ou une photo trop lourde. Le refus se dit avant tout
// envoi — le faux client de ce fichier n'a pas de stockage —, et l'accueil reste où il est.
describe('ClientHome — les bornes du seau', () => {
  beforeEach(() => {
    poser()
    faux.depots = 0
    faux.depotReel = true
  })
  afterEach(() => { faux.depotReel = false })
  const champ = () => document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement

  it('une image que le seau n’admet pas : refusée, dite, et l’écran ne part pas vers « Mes pièces »', async () => {
    const { container } = monter()
    await screen.findByText('Prendre une photo')
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'dessin.svg', { type: 'image/svg+xml' })

    await act(async () => { fireEvent.change(champ(), { target: { files: [svg] } }) })

    expect(container.querySelector('.error-text')?.textContent)
      .toBe('dessin.svg : format non pris en charge (une pièce se dépose en PDF, JPEG, PNG ou CSV).')
    expect(screen.getByText('Prendre une photo')).toBeTruthy()
  })

  it('une photo trop lourde : son poids et la borne', async () => {
    const { container } = monter()
    await screen.findByText('Prendre une photo')
    const lourde = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'IMG_0001.jpg', { type: 'image/jpeg' })
    Object.defineProperty(lourde, 'size', { value: 31 * 1024 * 1024 })

    await act(async () => { fireEvent.change(champ(), { target: { files: [lourde] } }) })

    expect(container.querySelector('.error-text')?.textContent)
      .toBe('IMG_0001.jpg : il pèse 31 Mo, au-delà des 20 Mo qu’une pièce peut peser.')
  })
})
