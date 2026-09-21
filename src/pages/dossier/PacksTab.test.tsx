import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PacksTab from './PacksTab'

// UNE LECTURE PLUS LENTE ÉCRIT EN DERNIER, ET L'ÉCRAN MENT SANS LE DIRE.
//
// L'aperçu d'un pack est le seul chargement du projet dont les dépendances ne sont pas `dossierId` :
// ce sont les DEUX DATES, que l'opérateur change à la main, écran ouvert, plusieurs fois de suite.
// Deux changements rapprochés lancent deux lectures qui se chevauchent, et sans annulation c'est la
// dernière ARRIVÉE qui écrit — pas la dernière demandée.
//
// ET LA COURSE PENCHE TOUJOURS DU MÊME CÔTÉ, ce qui la rend pire qu'un tirage au sort : `lireTout`
// fait d'autant plus d'allers-retours que la période est large, donc la période LARGE est la plus
// lente à revenir. Rétrécir la période est le geste courant, et c'est celui qui laisse à l'écran le
// compte et le total d'avant, sous des dates qui en annoncent une autre. L'opérateur lit un chiffre,
// génère, et le pack ne contient pas cela — sur le livrable qu'on envoie au comptable.
//
// Aucun test de `src/lib` ne peut voir ça : `lireTout` est juste, `packGenerator` est juste, c'est
// l'ORDRE D'ARRIVÉE de deux appels corrects qui produit le mensonge.

type Reponse = { data: unknown[]; count: number; error: null }

const faux = vi.hoisted(() => ({
  // Une file d'attente par période demandée : le test décide QUAND chaque lecture répond, donc dans
  // quel ordre elles arrivent. Rien ne se résout tout seul.
  enAttente: [] as { periode: string; repondre: (r: Reponse) => void }[],
  periodesDemandees: [] as string[],
  // Les packs déjà générés, que l'écran liste avec leurs deux boutons de téléchargement.
  packs: [] as unknown[],
  // Ce que le point unique d'ouverture rend. Le doublure vaut mieux qu'un vrai `window.open` ici :
  // ce test garde le CÂBLAGE (l'écran dit-il l'échec ?), le comportement du point unique étant
  // gardé à part par `apercu.test.ts`.
  apercu: { ok: true } as { ok: true } | { ok: false; message: string },
  cheminsDemandes: [] as string[],
}))

vi.mock('../../lib/apercu', () => ({
  ouvrirApercu: (_seau: string, chemin: string) => {
    faux.cheminsDemandes.push(chemin)
    return Promise.resolve(faux.apercu)
  },
}))

vi.mock('../../lib/supabase', () => {
  // Le faux client honore `range` et annonce un `count` : sans l'un la chaîne de `lireTout` casse,
  // sans l'autre TOUTE lecture se déclare incomplète et le test passerait pour une raison fausse
  // (CLAUDE.md — le coût récurrent de `lireTout`, à payer une fois par faux client).
  const chaine = (table: string) => {
    const etat = { debut: '', fin: '', estSansDate: false }
    const self: Record<string, unknown> = {}
    for (const methode of ['select', 'eq', 'order', 'is', 'gte', 'lte', 'range']) {
      self[methode] = (...args: unknown[]) => {
        if (methode === 'gte') etat.debut = String(args[1])
        if (methode === 'lte') etat.fin = String(args[1])
        if (methode === 'is') etat.estSansDate = true
        return self
      }
    }
    self.then = (resolve: (r: Reponse) => void) => {
      if (table === 'packs') return resolve({ data: faux.packs, count: faux.packs.length, error: null })
      // Les pièces sans date ne dépendent d'aucune période : elles répondent tout de suite, pour
      // que le test n'ait à ordonner QUE les deux lectures qui courent l'une contre l'autre.
      if (etat.estSansDate) return resolve({ data: [], count: 0, error: null })
      const periode = `${etat.debut}→${etat.fin}`
      faux.periodesDemandees.push(periode)
      faux.enAttente.push({ periode, repondre: resolve })
      return undefined
    }
    return self
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

/** Fait répondre la lecture d'une période donnée, avec N pièces validées à 100 € chacune. */
async function repondre(periode: string, nbValidees: number) {
  const attente = faux.enAttente.find((a) => a.periode === periode)
  if (!attente) throw new Error(`aucune lecture en attente pour ${periode} — demandées : ${faux.periodesDemandees.join(', ')}`)
  faux.enAttente = faux.enAttente.filter((a) => a !== attente)
  const data = Array.from({ length: nbValidees }, () => ({ statut: 'validee', montant_ttc: 100 }))
  await act(async () => { attente.repondre({ data, count: nbValidees, error: null }) })
}

function changerPeriode(debut: string, fin: string) {
  fireEvent.change(document.querySelector('#debut')!, { target: { value: debut } })
  fireEvent.change(document.querySelector('#fin')!, { target: { value: fin } })
}

beforeEach(() => {
  faux.enAttente = []
  faux.periodesDemandees = []
  faux.packs = []
  faux.apercu = { ok: true }
  faux.cheminsDemandes = []
})

describe('PacksTab — l’aperçu suit la période affichée, pas la lecture la plus lente', () => {
  it('ignore une lecture périmée qui revient après la plus récente', async () => {
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    // La période LARGE est demandée, puis rétrécie avant d'avoir répondu — le geste courant.
    changerPeriode('2026-01-01', '2026-12-31')
    await act(async () => {})
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})

    // La période étroite répond d'abord (elle a moins de pages à lire), la large ensuite : c'est
    // exactement l'ordre que `lireTout` produit, et c'est lui qui rendait l'écran faux.
    await repondre('2026-07-01→2026-07-31', 4)
    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()

    await repondre('2026-01-01→2026-12-31', 22)

    // L'écran doit TOUJOURS montrer la période affichée. Sans annulation, il affiche ici 22.
    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()
    expect(screen.queryAllByText(/22 pièce\(s\) validée\(s\)/)).toHaveLength(0)
  })

  it('accepte bien la lecture de la période affichée — sinon il ne montrerait jamais rien', async () => {
    // Le cas symétrique, sans lequel « l'écran n'affiche pas 22 » serait satisfait par un écran qui
    // n'affiche JAMAIS rien : « zéro faute » et « aveugle » se ressemblent trop (CLAUDE.md).
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})
    await repondre('2026-07-01→2026-07-31', 7)

    expect(screen.getByText(/7 pièce\(s\) validée\(s\)/)).toBeTruthy()
  })

  it('laisse la dernière période écrire quand c’est elle qui revient en dernier', async () => {
    // L'ordre NORMAL : la plus récente arrive en dernier et doit s'imposer. Un garde qui refuserait
    // tout ce qui arrive après un changement casserait l'écran au lieu de le réparer.
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    changerPeriode('2026-01-01', '2026-12-31')
    await act(async () => {})
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})

    await repondre('2026-01-01→2026-12-31', 22)
    await repondre('2026-07-01→2026-07-31', 4)

    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()
  })
})

// UN BOUTON DE TÉLÉCHARGEMENT NE FAIT JAMAIS RIEN EN SILENCE.
//
// `download` LISAIT son erreur puis faisait `return` : le clic ne produisait ni onglet, ni message,
// sur le livrable qu'on envoie au comptable. C'est mot pour mot le défaut corrigé la veille sur
// l'export d'`InformationsTab`, resté entier sur l'autre chemin de téléchargement du MÊME fichier.
describe('PacksTab — le téléchargement d’un pack', () => {
  function poserUnPack() {
    faux.packs = [{
      id: 'pk1', dossier_id: 'd1', periode_debut: '2026-07-01', periode_fin: '2026-07-31',
      nb_pieces: 4, total_ttc: 400, storage_path_zip: 'd1/p/pack.zip',
      storage_path_excel: 'd1/p/recap.xlsx', created_at: '2026-08-01T09:00:00Z',
    }]
  }

  it('DIT pourquoi quand l’ouverture échoue, au lieu de ne rien faire', async () => {
    poserUnPack()
    faux.apercu = { ok: false, message: "L'ouverture a été bloquée par le navigateur." }
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    const zip = screen.getByRole('button', { name: 'ZIP' })
    await act(async () => { zip.click() })

    expect(faux.cheminsDemandes).toEqual(['d1/p/pack.zip'])
    expect(screen.getByText(/bloquée par le navigateur/)).toBeTruthy()
  })

  it('ne se plaint pas quand l’ouverture réussit', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran dit l'échec » serait satisfait par un écran qui se
    // plaint toujours, y compris sur le téléchargement qui vient de partir.
    poserUnPack()
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    const excel = screen.getByRole('button', { name: 'Excel' })
    await act(async () => { excel.click() })

    expect(faux.cheminsDemandes).toEqual(['d1/p/recap.xlsx'])
    expect(screen.queryAllByText(/bloquée par le navigateur/)).toHaveLength(0)
  })
})
