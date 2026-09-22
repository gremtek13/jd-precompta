import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientHome from './ClientHome'

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
}))

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
