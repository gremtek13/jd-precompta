import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImmobilisationsTab from './ImmobilisationsTab'
import type { EcritureBrouillon, Immobilisation, NatureImmobilisation, Piece } from '../../lib/types'

// LE REGISTRE DES IMMOBILISATIONS, ET LES DOTATIONS QUI S'EN ÉCRIVENT (ligne 26.6, étape b).
//
// Depuis le 01/10/2026 la dotation d'un bien est celle de la règle fiscale — prorata temporis depuis la mise
// en service, le reliquat après la durée (lib/amortissements.ts) — et elle s'ÉCRIT : chaque exercice de son
// tableau d'amortissement est comparé au brouillon, et « Écrire les N » l'écrit par la fonction de la base,
// qui refait le calcul. Le retrait d'un bien passe par la base aussi, qui emporte ses dotations.
//
// Ce que ce test garde et qu'aucun test de `src/lib` ne peut garder : ce que l'écran APPELLE, avec quoi, sous
// quel verrou, et ce qu'il dit — avant le clic comme après un refus.
const faux = vi.hoisted(() => ({
  pieces: [] as Piece[],
  immobilisations: [] as Immobilisation[],
  natures: [] as NatureImmobilisation[],
  ecritures: [] as EcritureBrouillon[],
  aNouveaux: [] as { id: string; dossier_id: string; date: string }[],
  // Lecture partielle d'une table : le serveur cesse de rendre des lignes au-delà de ce rang, en annonçant le
  // vrai total (voir lib/lectureComplete.ts).
  muetApres: {} as Record<string, number>,
  // L'erreur que rend la base à une insertion — telle que supabase-js la rend : un objet NU, jamais une
  // instance d'`Error` (voir lib/messageErreur.ts).
  refusInsertion: null as Record<string, unknown> | null,
  // L'erreur que rend la base à une modification du registre.
  refusModification: null as Record<string, unknown> | null,
  inserees: [] as { table: string; valeur: Record<string, unknown> }[],
  modifiees: [] as { table: string; valeur: Record<string, unknown> }[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  // Les refus de la base, par bien.
  refusRpc: {} as Record<string, string>,
  // Retient la RÉPONSE de chaque lecture après le premier appel à la base : de quoi tenir le verrou
  // pendant la relecture qui suit l'écriture.
  retenirLectures: false,
  relacher: null as (() => void) | null,
  retenue: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  // Ce que font les deux fonctions de la base (supabase/schema/20261001152738_…) : la dotation d'un exercice
  // remplace celle qui y était écrite — une écriture vide la retire —, et le retrait d'un bien emporte ses
  // dotations.
  function executerRpc(nom: string, args: Record<string, unknown>) {
    faux.rpcs.push({ nom, args })
    const id = args.p_immobilisation_id as string
    if (faux.refusRpc[id]) return Promise.resolve({ data: null, error: { message: faux.refusRpc[id] } })
    if (nom === 'ecrire_dotation_amortissement') {
      const annee = args.p_annee as number
      faux.ecritures = faux.ecritures.filter((e) => !(e.immobilisation_id === id && e.date.startsWith(`${annee}-`)))
      faux.ecritures.push(...(args.p_ecritures as { compte: string; sens: 'debit' | 'credit'; montant: number; libelle: string }[])
        .map((e, i): EcritureBrouillon => ({
          id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null,
          date: `${annee}-12-31`, compte: e.compte, libelle: e.libelle, montant: e.montant, sens: e.sens,
          statut: 'proposee', immobilisation_id: id, created_at: '2026-10-01T10:00:00Z',
        })))
    } else if (nom === 'retirer_immobilisation') {
      faux.ecritures = faux.ecritures.filter((e) => e.immobilisation_id !== id)
      faux.immobilisations = faux.immobilisations.filter((i) => i.id !== id)
    }
    if (faux.retenirLectures) faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    return Promise.resolve({ data: 1, error: null })
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => executerRpc(nom, args),
      from: (table: string) => {
        const c: Record<string, unknown> = {}
        let operation = 'select'
        let valeur: Record<string, unknown> = {}
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les filtres qui décident de ce que l'écran voit sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) —
        // sauf le cadrage par dossier, que le jeu d'essai ne renseigne pas partout. Accepté sans effet, le
        // filtre `.not('immobilisation_id', 'is', null)` retiré laisserait ce test vert.
        const predicats: Predicat[] = []
        Object.assign(c, {
          select: () => c,
          insert: (v: Record<string, unknown>) => { operation = 'insert'; valeur = v; faux.inserees.push({ table, valeur: v }); return c },
          update: (v: Record<string, unknown>) => { operation = 'update'; valeur = v; faux.modifiees.push({ table, valeur: v }); return c },
          eq: (colonne: string, v: unknown) => {
            if (colonne !== 'dossier_id') predicats.push(predicatEq(colonne, v))
            return c
          },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          not: (colonne: string, operateur: string, v: unknown) => { predicats.push(predicatNot(colonne, operateur, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: { data: unknown[] | null; error: unknown; count: number }) => unknown) => {
            if (operation === 'insert') {
              if (!faux.refusInsertion) {
                if (table === 'natures_immobilisation') faux.natures.push({ id: `n-${faux.natures.length}`, ordre: 0, ...valeur } as NatureImmobilisation)
                if (table === 'immobilisations') faux.immobilisations.push({ id: 'i-nouveau', date_mise_en_service: null, created_at: '2026-10-01T10:00:00Z', ...valeur } as Immobilisation)
              }
              return Promise.resolve({ data: null, error: faux.refusInsertion, count: 0 }).then(suite)
            }
            if (operation === 'update') {
              if (faux.refusModification) return Promise.resolve({ data: null, error: faux.refusModification, count: 0 }).then(suite)
              if (table === 'immobilisations') {
                faux.immobilisations = faux.immobilisations.map((i) =>
                  predicats.every((p) => p(i as unknown as Record<string, unknown>)) ? { ...i, ...valeur } : i)
              }
              return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
            }
            const source: readonly unknown[] =
              table === 'pieces' ? faux.pieces
                : table === 'immobilisations' ? faux.immobilisations
                  : table === 'natures_immobilisation' ? faux.natures
                    : table === 'ecritures_brouillon' ? faux.ecritures
                      : table === 'a_nouveaux' ? faux.aNouveaux
                        : []
            const toutes = filtrer(source, predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
            return (faux.retenue ?? Promise.resolve())
              .then(() => ({ data: rendu, error: null, count: toutes.length }))
              .then(suite)
          },
        })
        return c
      },
    },
  }
})

// Typés sans `as` : le compilateur confronte chaque champ du jeu d'essai à la table.
//
// LE DÉFAUT DU BIEN DÉSIGNE SA PIÈCE ET SA NATURE, comme tout bien que cet écran crée depuis le 01/10/2026 :
// la nature y est exigée, c'est elle qui donne le compte d'amortissement. Un `piece_id` nul ne peut venir que
// d'une pièce supprimée (le seul chemin de création pose le lien), et un défaut infidèle ferait porter à chaque
// ligne la pastille « Justificatif supprimé » — même famille que le `devise: null` de ChecklistTab.
const immobilisation = (o: Partial<Immobilisation> = {}): Immobilisation => ({
  id: 'i-1', dossier_id: 'dossier-de-test', piece_id: 'piece-1', nature_id: 'n-info',
  libelle: 'Ordinateur', valeur: 12000, date_acquisition: '2025-07-01', date_mise_en_service: null, duree_annees: 5,
  created_at: '2025-07-01T09:00:00Z', ...o,
})

const NATURE_INFO: NatureImmobilisation = {
  id: 'n-info', dossier_id: null, libelle: 'Matériel informatique', duree_annees_defaut: 3, ordre: 1, compte_immobilisation: '218300',
}
const NATURE_PROPRE: NatureImmobilisation = {
  id: 'n-propre', dossier_id: 'dossier-de-test', libelle: 'Fauteuil de soins', duree_annees_defaut: 10, ordre: 2, compte_immobilisation: '215400',
}

// La dotation d'un exercice telle que la base l'écrit : le 681100 au débit, le 28 du bien au crédit, au 31
// décembre.
function dotation(annee: number, montant: number, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon[] {
  const base = {
    dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null, date: `${annee}-12-31`,
    libelle: `Dotation ${annee} — Ordinateur`, montant, statut: 'proposee' as const, immobilisation_id: 'i-1',
    created_at: '2026-01-02T09:00:00Z',
  }
  return [
    { ...base, id: `d-${annee}-1`, compte: '681100', sens: 'debit', ...o },
    { ...base, id: `d-${annee}-2`, compte: '281830', sens: 'credit', ...o },
  ]
}

function poser(immos: Immobilisation[], o: { pieces?: Piece[]; ecritures?: EcritureBrouillon[]; ouverture?: string } = {}) {
  faux.pieces = o.pieces ?? []
  faux.immobilisations = immos
  faux.natures = [NATURE_INFO, NATURE_PROPRE]
  faux.ecritures = o.ecritures ?? []
  faux.aNouveaux = o.ouverture ? [{ id: 'an-1', dossier_id: 'dossier-de-test', date: o.ouverture }] : []
  faux.muetApres = {}
  faux.refusInsertion = null
  faux.refusModification = null
  faux.inserees = []
  faux.modifiees = []
  faux.rpcs = []
  faux.refusRpc = {}
  faux.retenirLectures = false
  faux.relacher = null
  faux.retenue = null
}

const monter = (assujettiTva = false) => render(<ImmobilisationsTab dossierId="dossier-de-test" assujettiTva={assujettiTva} />)

// L'HORLOGE EST FIXÉE au 1er octobre 2026 : l'exercice en cours décide de ce qui s'écrit, et de ce que la
// carte réclame. Seule `Date` est feinte — `vi.useFakeTimers()` gèlerait aussi les minuteurs dont `findBy…`
// dépend (voir CLAUDE.md).
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T10:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const registre = () => within(screen.getByRole('table', { name: 'Registre des immobilisations' }))
const carte = () => within(screen.getByRole('table', { name: 'Dotations à écrire' }).closest('.card') as HTMLElement)
// `\s` : `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable (U+202F).
const euros = (texte: string) => new RegExp(`^${texte.replace(/ /g, '\\s')}\\s€$`)

describe('ImmobilisationsTab — la dotation du registre', () => {
  it('compte prorata temporis depuis l’acquisition : 1 200 € en 2025 pour un bien acquis le 1er juillet', async () => {
    poser([immobilisation()])
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    // Toutes années : la colonne montre l'exercice en cours, une annuité pleine.
    registre().getByRole('columnheader', { name: 'Dotation 2026' })
    registre().getByText(euros('2 400,00'))

    // L'exercice d'acquisition : six mois de dotation, plus l'annuité pleine qu'affichait la colonne d'avant.
    fireEvent.click(screen.getByRole('tab', { name: '2025' }))
    registre().getByRole('columnheader', { name: 'Dotation 2025' })
    registre().getByText(euros('1 200,00'))
    registre().getByText('à l’acquisition')
  })

  it('l’exercice choisi montre les biens acquis jusqu’à lui, chacun avec sa dotation de cet exercice', async () => {
    // Le filtre d'avant ne gardait que les biens ACQUIS l'année choisie : un bien de 2024 disparaissait de
    // 2025, alors que sa dotation 2025 part en case CH de cette année-là.
    poser([
      immobilisation({ id: 'a', libelle: 'Bureau', date_acquisition: '2024-01-01', valeur: 3000, duree_annees: 3 }),
      immobilisation({ id: 'b', libelle: 'Échographe', date_acquisition: '2026-04-01' }),
    ])
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    fireEvent.click(screen.getByRole('tab', { name: '2025' }))
    within(registre().getByText('Bureau').closest('tr')!).getByText(euros('1 000,00'))
    expect(registre().queryByText('Échographe')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '2026' }))
    within(registre().getByText('Bureau').closest('tr')!).getByText(euros('1 000,00'))
    // Neuf mois de 2026 : du 1er avril au 31 décembre.
    within(registre().getByText('Échographe').closest('tr')!).getByText(euros('1 800,00'))
  })

  it('part de la mise en service quand elle est saisie', async () => {
    poser([immobilisation({ date_acquisition: '2025-03-10', date_mise_en_service: '2025-07-01' })])
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    fireEvent.click(screen.getByRole('tab', { name: '2025' }))
    registre().getByText(euros('1 200,00'))
    registre().getByText('01/07/2025')
  })
})

describe('ImmobilisationsTab — le tableau d’amortissement', () => {
  it('déplie chaque exercice, du premier au reliquat, avec l’état de son écriture', async () => {
    poser([immobilisation()], { ecritures: dotation(2025, 1200) })
    monter()
    fireEvent.click(await screen.findByRole('button', { name: 'Tableau' }))

    const tableau = screen.getByRole('table', { name: 'Tableau d’amortissement de Ordinateur' })
    const lignes = within(tableau).getAllByRole('row').slice(1)
    expect(lignes.map((l) => l.querySelector('td')!.textContent)).toEqual(['2025', '2026', '2027', '2028', '2029', '2030'])
    // Écrite, à écrire (l'exercice en cours), à venir : chaque exercice dit où en est son écriture.
    within(lignes[0]).getByText('Écrite')
    within(lignes[1]).getByText('À écrire')
    within(lignes[2]).getByText('À venir')
    // Le reliquat : les six mois que la première annuité n'a pas comptés, en 2030.
    within(lignes[5]).getByText(euros('1 200,00'))
    within(lignes[5]).getByText(euros('0,00'))
  })

  it('un exercice repris dans les à-nouveaux le dit, et ne se demande pas', async () => {
    poser([immobilisation()], { ouverture: '2026-01-01' })
    monter()
    fireEvent.click(await screen.findByRole('button', { name: 'Tableau' }))

    const tableau = screen.getByRole('table', { name: 'Tableau d’amortissement de Ordinateur' })
    within(within(tableau).getAllByRole('row')[1]).getByText('Dans les à-nouveaux')
    // La carte ne demande que l'exercice que l'application tient.
    expect(carte().getAllByRole('row').slice(1).map((l) => l.querySelectorAll('td')[1].textContent)).toEqual(['2026 (en cours)'])
  })
})

describe('ImmobilisationsTab — les dotations à écrire', () => {
  it('écrit chaque dotation par la base, avec l’écriture que la base vérifiera', async () => {
    poser([immobilisation()])
    monter()

    await screen.findByText('Dotations aux amortissements à écrire (2)')
    fireEvent.click(screen.getByRole('button', { name: 'Écrire les 2' }))

    await waitFor(() => expect(screen.queryByText(/Dotations aux amortissements à écrire/)).toBeNull())
    expect(faux.rpcs.map((r) => [r.nom, r.args.p_immobilisation_id, r.args.p_annee])).toEqual([
      ['ecrire_dotation_amortissement', 'i-1', 2025],
      ['ecrire_dotation_amortissement', 'i-1', 2026],
    ])
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '681100', sens: 'debit', montant: 1200, libelle: 'Dotation 2025 — Ordinateur' },
      { compte: '281830', sens: 'credit', montant: 1200, libelle: 'Dotation 2025 — Ordinateur' },
    ])
  })

  it('trois clics rapprochés n’écrivent qu’une fois, et le verrou tient pendant la relecture', async () => {
    poser([immobilisation()])
    monter()
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })

    faux.retenirLectures = true
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await waitFor(() => expect(faux.relacher).not.toBeNull())
    // Un lot, pas trois : deux exercices, deux appels.
    expect(faux.rpcs).toHaveLength(2)
    // La relecture n'est pas revenue : le bouton reste grisé, et un clic de plus ne relance rien.
    expect(screen.getByRole('button', { name: 'Écriture…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { screen.getByRole('button', { name: 'Écriture…' }).click() })
    expect(faux.rpcs).toHaveLength(2)

    faux.retenirLectures = false
    await act(async () => { faux.relacher?.(); faux.retenue = null })
    await waitFor(() => expect(screen.queryByText(/Dotations aux amortissements à écrire/)).toBeNull())
  })

  it('une lecture partielle des dotations suspend l’écriture, et le dit', async () => {
    // La dotation 2025 est écrite ; lue à moitié, elle paraîtrait « à réécrire », et le lot la réécrirait.
    poser([immobilisation()], { ecritures: dotation(2025, 1200) })
    faux.muetApres = { ecritures_brouillon: 1 }
    monter()

    await screen.findByText(/n'ont pas pu être lues en entier/)
    expect(screen.getByRole('button', { name: /^Écrire/ }).hasAttribute('disabled')).toBe(true)
    screen.getByText(/Écriture suspendue/)
    await act(async () => { screen.getByRole('button', { name: /^Écrire/ }).click() })
    expect(faux.rpcs).toHaveLength(0)
  })

  it('un bien sans nature : sa dotation se dit, sans s’écrire', async () => {
    poser([immobilisation({ nature_id: null })])
    monter()

    await screen.findByText('Dotations aux amortissements à écrire (2)')
    registre().getByText('Nature à choisir')
    expect(carte().getAllByText(/Choisissez la nature de ce bien/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Écrire/ })).toBeNull()
  })

  it('une dotation qui ne suit plus le registre est à réécrire, et se remplace', async () => {
    poser([immobilisation()], { ecritures: dotation(2025, 2400) })
    monter()

    await screen.findByText('Dotations aux amortissements à écrire (2)')
    carte().getByText('À réécrire')
    fireEvent.click(screen.getByRole('button', { name: 'Écrire les 2' }))

    await waitFor(() => expect(screen.queryByText(/Dotations aux amortissements à écrire/)).toBeNull())
    expect(faux.ecritures.filter((e) => e.date === '2025-12-31').map((e) => e.montant)).toEqual([1200, 1200])
  })

  it('une dotation validée qui diverge se dit, et ne s’écrit plus', async () => {
    poser([immobilisation()], { ecritures: dotation(2025, 2400, { statut: 'validee' }) })
    monter()

    await screen.findByText('Dotations aux amortissements à écrire (2)')
    carte().getByText('Validée, ne suit plus le registre')
    fireEvent.click(screen.getByRole('button', { name: 'Écrire cette dotation' }))

    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0].args.p_annee).toBe(2026)
  })

  it('un refus de la base se dit, sans arrêter le lot', async () => {
    poser([
      immobilisation({ id: 'a', libelle: 'Véhicule' }),
      immobilisation({ id: 'b', libelle: 'Bureau', date_acquisition: '2026-01-01' }),
    ])
    faux.refusRpc = { a: 'Accès refusé à ce bien.' }
    monter()

    fireEvent.click(await screen.findByRole('button', { name: 'Écrire les 3' }))
    await screen.findByText(/Dotations écrites : 1 sur 3\. Refusées par la base : Véhicule \(2025\) : Accès refusé à ce bien\. ; Véhicule \(2026\)/)
    expect(faux.rpcs).toHaveLength(3)
  })

  it('une recherche ne fait pas disparaître une dotation à écrire', async () => {
    // « Une recherche filtre l'affichage, jamais un total » — prise par son côté le plus coûteux : une
    // dotation à écrire ne disparaît pas d'un mot tapé.
    poser([
      immobilisation({ id: 'a', libelle: 'Véhicule' }),
      immobilisation({ id: 'b', libelle: 'Bureau' }),
    ])
    monter()
    await screen.findByText('Dotations aux amortissements à écrire (4)')

    fireEvent.change(screen.getByPlaceholderText(/Rechercher un libellé/), { target: { value: 'Bureau' } })
    expect(registre().queryByText('Véhicule')).toBeNull()
    expect(carte().getAllByText('Véhicule')).toHaveLength(2)
    screen.getByText('Dotations aux amortissements à écrire (4)')
  })

  it('se tait quand tout est écrit', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la carte demande les dotations » serait satisfait par une carte toujours
    // là.
    poser([immobilisation()], { ecritures: [...dotation(2025, 1200), ...dotation(2026, 2400)] })
    monter()

    await screen.findByRole('table', { name: 'Registre des immobilisations' })
    expect(screen.queryByText(/Dotations aux amortissements à écrire/)).toBeNull()
  })

  it('ne réclame pas la dotation de l’exercice en cours, qu’elle propose pourtant', async () => {
    poser([immobilisation({ date_acquisition: '2026-02-01' })])
    monter()

    await screen.findByText('Dotations aux amortissements à écrire (1)')
    expect(screen.queryByText(/la Checklist la réclame/)).toBeNull()
    screen.getByRole('button', { name: 'Écrire cette dotation' })
  })

  it('réclame celle d’un exercice fini', async () => {
    poser([immobilisation()])
    monter()

    await screen.findByText('1 dotation manque à un exercice fini ou ne suit plus le registre : la Checklist la réclame.')
  })
})

// LA TROISIÈME CLÉ EN `ON DELETE SET NULL` DE `pieces`. Supprimer une pièce immobilisée détache son
// immobilisation sans un mot, et le registre affichait la dotation comme si de rien n'était — alors que
// `calculerDeclaration2035` la totalise en case CH d'une 2035 signée.
describe('ImmobilisationsTab — une immobilisation dont le justificatif a été supprimé', () => {
  it('le dit sur la ligne', async () => {
    poser([immobilisation({ piece_id: null })])
    monter()

    await screen.findByText('Justificatif supprimé')
  })

  // GARDE SYMÉTRIQUE, et appuyée sur le DÉFAUT de la fabrique : sans cela, remettre ce défaut à `null`
  // laissait les autres tests verts, aucun n'assertant rien sur la pastille.
  it('se tait sur une immobilisation qui désigne bien sa pièce', async () => {
    poser([immobilisation()])
    monter()

    await screen.findByRole('table', { name: 'Registre des immobilisations' })
    expect(screen.queryAllByText('Justificatif supprimé')).toHaveLength(0)
  })
})

// LE RETRAIT PASSE PAR LA BASE, ET LA CONFIRMATION NOMME CE QUI PART. « La pièce redevient une charge courante
// ordinaire » suppose qu'il RESTE une pièce ; sur une immobilisation dont le justificatif a été supprimé, la
// phrase rassure à l'envers — rien ne redevient une charge. Et depuis que la dotation s'écrit, les dotations
// du bien partent avec lui : la confirmation le dit.
describe('ImmobilisationsTab — retirer un bien', () => {
  function cliquerRetirer(libelle: string) {
    const ligne = registre().getByText(libelle).closest('tr')!
    fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer' }))
  }

  it('annonce le retour en charge courante quand le justificatif est là', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la confirmation dit le cas détaché » serait satisfait par un écran qui
    // annoncerait TOUJOURS la disparition de la dépense.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    poser([immobilisation()])
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    cliquerRetirer('Ordinateur')
    expect(confirm.mock.calls[0][0]).toMatch(/redevient une charge courante ordinaire/)
    expect(faux.rpcs).toHaveLength(0)
  })

  it('dit que la dépense ne sera plus comptée nulle part quand le justificatif a été supprimé', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    poser([immobilisation({ piece_id: null })])
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    cliquerRetirer('Ordinateur')
    const message = String(confirm.mock.calls[0][0])
    expect(message).toMatch(/justificatif a déjà été supprimé/)
    expect(message).toMatch(/plus comptée nulle part/)
    // Et surtout : la phrase FAUSSE ne doit plus être là — un message qui dirait les deux rassurerait encore.
    expect(message).not.toMatch(/redevient une charge courante ordinaire/)
  })

  it('retire le bien par la base, ses dotations écrites avec lui, et le dit avant', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    poser([immobilisation()], { ecritures: dotation(2025, 1200) })
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    cliquerRetirer('Ordinateur')
    expect(String(confirm.mock.calls[0][0])).toMatch(/Ses dotations écrites au brouillon \(2025\) partent avec lui\./)
    await screen.findByText("Aucune immobilisation enregistrée pour l'instant.")
    expect(faux.rpcs).toEqual([{ nom: 'retirer_immobilisation', args: { p_immobilisation_id: 'i-1' } }])
    expect(faux.ecritures).toHaveLength(0)
  })

  it('ne cite pas d’exercices sur une lecture partielle des dotations', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    poser([immobilisation()], { ecritures: [...dotation(2025, 1200), ...dotation(2026, 2400)] })
    faux.muetApres = { ecritures_brouillon: 2 }
    monter()
    await screen.findByText(/n'ont pas pu être lues en entier/)

    cliquerRetirer('Ordinateur')
    const message = String(confirm.mock.calls[0][0])
    expect(message).toMatch(/leur liste n’a pas pu être lue en entier/)
    expect(message).not.toMatch(/\(2025\)/)
  })

  it('refuse avant de demander quand une dotation est validée', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    poser([immobilisation()], { ecritures: dotation(2025, 1200, { statut: 'validee' }) })
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    cliquerRetirer('Ordinateur')
    await screen.findByText('Une dotation de ce bien est validée : il ne se retire plus.')
    expect(confirm).not.toHaveBeenCalled()
    expect(faux.rpcs).toHaveLength(0)
  })

  // Trois clics rapprochés ne retirent qu'une fois : le deuxième retrait ne trouverait plus le bien, et
  // dirait un échec sur un retrait réussi. Le verrou est le même que celui de l'écriture des dotations.
  it('trois clics rapprochés ne retirent qu’une fois', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    poser([immobilisation()])
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    const bouton = within(registre().getByText('Ordinateur').closest('tr')!).getByRole('button', { name: 'Retirer' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await screen.findByText("Aucune immobilisation enregistrée pour l'instant.")
    expect(faux.rpcs).toEqual([{ nom: 'retirer_immobilisation', args: { p_immobilisation_id: 'i-1' } }])
  })

  it('dit le refus de la base', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    poser([immobilisation()])
    faux.refusRpc = { 'i-1': 'Accès refusé à ce bien.' }
    monter()
    await screen.findByRole('table', { name: 'Registre des immobilisations' })

    cliquerRetirer('Ordinateur')
    await screen.findByText('Le bien n’a pas pu être retiré : Accès refusé à ce bien.')
    registre().getByText('Ordinateur')
  })
})

describe('ImmobilisationsTab — modifier un bien', () => {
  async function ouvrir() {
    await screen.findByRole('table', { name: 'Registre des immobilisations' })
    fireEvent.click(registre().getByRole('button', { name: 'Modifier' }))
    return within(screen.getByRole('form', { name: 'Modifier Ordinateur' }))
  }

  it('refuse une mise en service antérieure à l’acquisition, sans rien écrire', async () => {
    poser([immobilisation()])
    monter()
    const formulaire = await ouvrir()

    fireEvent.change(formulaire.getByLabelText('Mise en service'), { target: { value: '2025-06-01' } })
    fireEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }))
    await screen.findByText('La mise en service ne précède pas l’acquisition : le bien serait amorti avant d’exister.')
    expect(faux.modifiees).toHaveLength(0)
  })

  it('enregistre le bien, et sa dotation déjà écrite devient à réécrire', async () => {
    poser([immobilisation()], { ecritures: [...dotation(2025, 1200), ...dotation(2026, 2400)] })
    monter()
    const formulaire = await ouvrir()

    fireEvent.change(formulaire.getByLabelText('Mise en service'), { target: { value: '2025-10-01' } })
    fireEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }))

    await screen.findByText('Dotations aux amortissements à écrire (1)')
    expect(faux.modifiees).toEqual([{
      table: 'immobilisations',
      valeur: {
        libelle: 'Ordinateur', nature_id: 'n-info', valeur: 12000, date_acquisition: '2025-07-01',
        date_mise_en_service: '2025-10-01', duree_annees: 5,
      },
    }])
    // Trois mois de 2025 au lieu de six : la dotation écrite ne suit plus, et rien ne l'a réécrite.
    carte().getByText('À réécrire')
    carte().getByText(euros('600,00'))
    expect(faux.rpcs).toHaveLength(0)
  })

  // UNE MISE EN SERVICE EFFACÉE S'ÉCRIT ABSENTE, pas en texte vide : la base refuserait '' pour une date, et
  // l'amortissement doit repartir de l'acquisition.
  it('écrit une mise en service effacée comme absente', async () => {
    poser([immobilisation({ date_mise_en_service: '2025-10-01' })])
    monter()
    const formulaire = await ouvrir()

    fireEvent.change(formulaire.getByLabelText('Mise en service'), { target: { value: '' } })
    fireEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(faux.modifiees).toHaveLength(1))
    expect(faux.modifiees[0].valeur.date_mise_en_service).toBeNull()
  })

  // Le refus de la base se DIT, et le formulaire reste ouvert sur la saisie : le bien n'a pas changé, et
  // fermer le formulaire sans un mot ferait croire le contraire.
  it('dit le refus de la base, et garde la saisie', async () => {
    poser([immobilisation()])
    faux.refusModification = { message: 'la valeur doit être au centime' }
    monter()
    const formulaire = await ouvrir()

    fireEvent.change(formulaire.getByLabelText('Durée (années)'), { target: { value: '4' } })
    fireEvent.click(formulaire.getByRole('button', { name: 'Enregistrer' }))
    await screen.findByText('Le bien n’a pas pu être modifié : la valeur doit être au centime')
    expect(screen.getByRole('form', { name: 'Modifier Ordinateur' })).toBeDefined()
  })
})

describe('ImmobilisationsTab — natures et comptes', () => {
  it('montre le compte de chaque nature et celui qui s’en déduit', async () => {
    poser([])
    monter()

    const natures = within(await screen.findByRole('table', { name: 'Natures' }))
    const info = within(natures.getByText('Matériel informatique').closest('tr')!)
    info.getByText('218300 → 281830')
    info.getByText('Partagée par le cabinet')
    const propre = within(natures.getByText('Fauteuil de soins').closest('tr')!)
    propre.getByText('215400 → 281540')
    propre.getByText('Propre au dossier')
  })

  it('refuse un compte qui n’est pas d’immobilisation, puis ajoute la nature au dossier', async () => {
    poser([])
    monter()
    fireEvent.click(await screen.findByRole('button', { name: '+ Nature' }))
    const formulaire = within(screen.getByRole('form', { name: 'Ajouter une nature' }))

    fireEvent.change(formulaire.getByLabelText('Nom'), { target: { value: 'Matériel médical' } })
    fireEvent.change(formulaire.getByLabelText('Durée usuelle (années)'), { target: { value: '7' } })
    fireEvent.change(formulaire.getByLabelText('Compte d’immobilisation'), { target: { value: '606000' } })
    fireEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }))
    await screen.findByText(/Le compte d’une nature est un compte d’immobilisation de six chiffres/)
    expect(faux.inserees).toHaveLength(0)

    fireEvent.change(formulaire.getByLabelText('Compte d’immobilisation'), { target: { value: '215400' } })
    fireEvent.click(formulaire.getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(faux.inserees).toHaveLength(1))
    expect(faux.inserees[0]).toEqual({
      table: 'natures_immobilisation',
      valeur: { dossier_id: 'dossier-de-test', libelle: 'Matériel médical', duree_annees_defaut: 7, compte_immobilisation: '215400' },
    })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Ajouter une nature' })).toBeNull())
  })

  // Trois envois rapprochés — trois clics, ou « Entrée » trois fois dans un champ — n'ajoutent qu'une nature :
  // le bouton n'est pas grisé pendant l'envoi, c'est le verrou qui tient.
  it('trois envois rapprochés n’ajoutent qu’une nature', async () => {
    poser([])
    monter()
    fireEvent.click(await screen.findByRole('button', { name: '+ Nature' }))
    const formulaire = within(screen.getByRole('form', { name: 'Ajouter une nature' }))
    fireEvent.change(formulaire.getByLabelText('Nom'), { target: { value: 'Matériel médical' } })
    fireEvent.change(formulaire.getByLabelText('Compte d’immobilisation'), { target: { value: '215400' } })

    const bouton = formulaire.getByRole('button', { name: 'Ajouter' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Ajouter une nature' })).toBeNull())
    expect(faux.inserees).toHaveLength(1)
  })
})

// LES CANDIDATES À L'IMMOBILISATION. Un message qui ne pouvait pas s'afficher : la pièce déjà immobilisée se
// heurte à la contrainte unique sur `piece_id`, et la phrase prévue vivait derrière `err instanceof Error` —
// or l'erreur arrive en objet Postgrest NU.
describe('ImmobilisationsTab — enregistrer une candidate', () => {
  const candidate: Piece = {
    id: 'piece-2', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2025-04-02', tiers: 'MATÉRIEL MÉDICAL', montant_ht: 1500, montant_tva: 300,
    montant_ttc: 1800, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-04-02T09:00:00Z', updated_at: '2025-04-02T09:00:00Z',
  }

  async function choisirNature() {
    fireEvent.change(await screen.findByLabelText('Nature de MATÉRIEL MÉDICAL'), { target: { value: 'n-propre' } })
  }

  it('demande la nature avant d’enregistrer : c’est elle qui donne le compte d’amortissement', async () => {
    poser([], { pieces: [candidate] })
    monter()

    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer comme immobilisation' }))
    await screen.findByText('Choisissez la nature du bien : c’est elle qui donne son compte d’amortissement.')
    expect(faux.inserees).toHaveLength(0)
  })

  it('le dit en clair, à la place du message de Postgres', async () => {
    poser([], { pieces: [candidate] })
    faux.refusInsertion = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "immobilisations_piece_id_unique"',
      details: 'Key (piece_id)=(piece-2) already exists.',
      hint: null,
    }
    monter()
    await choisirNature()

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer comme immobilisation' }))
    await screen.findByText('Cette pièce a déjà été enregistrée comme immobilisation.')
    expect(screen.queryByText(/duplicate key value/)).toBeNull()
  })

  // LA VALEUR QUI S'AMORTIT (voir lib/montantRetenu.ts) : hors taxes pour un assujetti, qui récupère la TVA,
  // TVA comprise pour un dossier exonéré, pour qui elle fait partie du prix.
  it.each([
    [false, 1800],
    [true, 1500],
  ])('assujetti : %s — la pièce est enregistrée pour %s €', async (assujetti, valeur) => {
    poser([], { pieces: [candidate] })
    monter(assujetti)
    // Ce que l'écran affiche est ce qu'il enregistre.
    const ligne = (await screen.findByText('MATÉRIEL MÉDICAL')).closest('tr')!
    expect(within(ligne).getByText(new RegExp(`^${valeur.toLocaleString('fr-FR').replace(/\s/g, '\\s')},00\\s€$`))).toBeTruthy()
    await choisirNature()
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer comme immobilisation' }))
    await waitFor(() => expect(faux.inserees).toHaveLength(1))
    expect(faux.inserees[0].valeur.valeur).toBe(valeur)
    expect(faux.inserees[0].valeur.nature_id).toBe('n-propre')
  })

  // Le seuil se juge sur la même valeur : 450 € hors taxes, 540 € TTC.
  it.each([
    [true, false],
    [false, true],
  ])('assujetti : %s — une pièce de 450 € HT / 540 € TTC est proposée : %s', async (assujetti, proposee) => {
    poser([], { pieces: [{ ...candidate, montant_ht: 450, montant_tva: 90, montant_ttc: 540 }] })
    monter(assujetti)
    // L'ancre n'apparaît qu'une fois le chargement fini : sans elle, l'absence ne prouverait rien.
    await screen.findByText("Aucune immobilisation enregistrée pour l'instant.")
    expect(screen.queryAllByText('MATÉRIEL MÉDICAL').length > 0).toBe(proposee)
  })

  it('laisse passer telle quelle une autre erreur', async () => {
    // Le garde symétrique : sans lui, un refus de droits se lirait « déjà enregistrée ».
    poser([], { pieces: [candidate] })
    faux.refusInsertion = { code: '42501', message: 'new row violates row-level security policy for table "immobilisations"', details: null, hint: null }
    monter()
    await choisirNature()

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer comme immobilisation' }))
    await screen.findByText(/row-level security/)
    expect(screen.queryByText('Cette pièce a déjà été enregistrée comme immobilisation.')).toBeNull()
  })
})
