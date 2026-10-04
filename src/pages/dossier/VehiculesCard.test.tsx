import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import type { ModeleComptable } from '../../lib/engagement'
import type { EcritureBrouillon, VehiculeDossier } from '../../lib/types'
import VehiculesCard from './VehiculesCard'
import { NON_VALIDEE } from '../../test/ecritures'

// Premier test d'ÉCRAN du dépôt. Il existe parce que les défauts qu'il vise ne sont visibles dans
// aucun test de src/lib : la logique appelée derrière était juste dans les deux cas.
//
// Depuis la ligne 26.6, étape b (lib/forfaitKilometrique.ts), la carte écrit aussi le FORFAIT KILOMÉTRIQUE de
// chaque ligne du cadre 7, par la fonction de la base, et retire un véhicule par la base, qui emporte son
// forfait. Ce que ce test garde et qu'aucun test de `src/lib` ne peut garder : ce que la carte APPELLE, avec
// quoi, sous quel verrou, et ce qu'elle dit — avant le clic comme après un refus.
//
// Le faux client Supabase est déclaré par `vi.hoisted` et non par un simple `const` : `vi.mock` est
// remonté en tête de fichier, mais les imports ESM sont évalués AVANT le corps du module — la
// fabrique du mock lirait donc une variable encore en zone morte.
const faux = vi.hoisted(() => ({
  vehicules: [] as VehiculeDossier[],
  ecritures: [] as EcritureBrouillon[],
  aNouveaux: [] as { id: string; dossier_id: string; date: string }[],
  inserts: [] as Record<string, unknown>[],
  // La promesse de l'insertion est gardée en attente : c'est l'attente réseau réelle, celle
  // pendant laquelle un second clic arrive. La résoudre tout de suite supprimerait la fenêtre
  // même que le verrou est censé fermer.
  resoudreInsert: null as null | (() => void),
  modifiees: [] as Record<string, unknown>[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  // Les refus de la base, par véhicule.
  refusRpc: {} as Record<string, string>,
  // Lecture partielle d'une table : le serveur cesse de rendre des lignes au-delà de ce rang, en annonçant le
  // vrai total (voir lib/lectureComplete.ts).
  muetApres: {} as Record<string, number>,
  // Retient la RÉPONSE de chaque lecture après un appel à la base : de quoi tenir le verrou pendant la
  // relecture qui suit l'écriture.
  retenirLectures: false,
  relacher: null as (() => void) | null,
  retenue: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  // Ce que font les deux fonctions de la base (supabase/schema/…_forfait_kilometrique_ecrit) : le forfait d'une
  // ligne du cadre 7 remplace celui qui y était écrit — une écriture vide le retire —, au 31 décembre de son
  // exercice ; et le retrait d'un véhicule emporte son forfait.
  function executerRpc(nom: string, args: Record<string, unknown>) {
    faux.rpcs.push({ nom, args })
    const id = args.p_vehicule_id as string
    if (faux.refusRpc[id]) return Promise.resolve({ data: null, error: { message: faux.refusRpc[id] } })
    const vehicule = faux.vehicules.find((v) => v.id === id)!
    if (nom === 'ecrire_forfait_kilometrique') {
      faux.ecritures = faux.ecritures.filter((e) => e.vehicule_id !== id)
      faux.ecritures.push(...(args.p_ecritures as { compte: string; sens: 'debit' | 'credit'; montant: number; libelle: string }[])
        .map((e, i): EcritureBrouillon => ({
          id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null,
          immobilisation_id: null, vehicule_id: id, ...NON_VALIDEE, date: `${vehicule.annee}-12-31`, compte: e.compte, libelle: e.libelle,
          montant: e.montant, sens: e.sens, statut: 'proposee', created_at: '2026-10-04T10:00:00Z',
        })))
    } else if (nom === 'retirer_vehicule') {
      faux.ecritures = faux.ecritures.filter((e) => e.vehicule_id !== id)
      faux.vehicules = faux.vehicules.filter((v) => v.id !== id)
    }
    if (faux.retenirLectures) faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    return Promise.resolve({ data: 1, error: null })
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => executerRpc(nom, args),
      // Une chaîne NEUVE par appel, et non une seule partagée par le module : une écriture laisserait sinon la
      // chaîne dans son mode pour tous les appels suivants.
      from: (table: string) => {
        const c: Record<string, unknown> = {}
        let operation = 'select'
        let valeur: Record<string, unknown> = {}
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les filtres qui décident de ce que la carte voit sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) :
        // accepté sans effet, le filtre `.not('vehicule_id', 'is', null)` retiré laisserait ce test vert.
        const predicats: Predicat[] = []
        Object.assign(c, {
          select: () => c,
          insert: (v: Record<string, unknown>) => {
            faux.inserts.push(v)
            return new Promise((resoudre) => { faux.resoudreInsert = () => resoudre({ data: null, error: null }) })
          },
          update: (v: Record<string, unknown>) => { operation = 'update'; valeur = v; faux.modifiees.push(v); return c },
          eq: (colonne: string, v: unknown) => {
            if (colonne !== 'dossier_id') predicats.push(predicatEq(colonne, v))
            return c
          },
          not: (colonne: string, operateur: string, v: unknown) => { predicats.push(predicatNot(colonne, operateur, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: { data: unknown[] | null; error: unknown; count: number }) => unknown) => {
            if (operation === 'update') {
              faux.vehicules = faux.vehicules.map((x) =>
                predicats.every((p) => p(x as unknown as Record<string, unknown>)) ? { ...x, ...valeur } : x)
              return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
            }
            const source: readonly unknown[] =
              table === 'vehicules' ? faux.vehicules
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

// Typé sans `as` : le compilateur confronte chaque champ du jeu d'essai à la table.
const vehicule = (o: Partial<VehiculeDossier> = {}): VehiculeDossier => ({
  id: 'v1', dossier_id: 'dossier-de-test', annee: 2025, modele: 'Peugeot 308', type: 'voiture', puissance_fiscale: 6,
  bareme: 'bnc', motorisation: 'thermique', carburant: 'diesel', km_professionnel: 12_000, inscrit_immobilisations: false,
  amortissements_a_reintegrer: null, created_at: '2026-01-05T10:00:00Z', updated_at: '2026-01-05T10:00:00Z', ...o,
})

// Le forfait tel que la base l'écrit : le 625110 au débit, le compte du dirigeant au crédit, au 31 décembre.
// 12 000 km d'une 6 CV thermique en 2025 : 12 000 × 0,374 + 1 457 = 5 945 €.
function forfait(montant: number, o: Partial<EcritureBrouillon> = {}, compte = '108000'): EcritureBrouillon[] {
  const base = {
    dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: 'v1', ...NON_VALIDEE,
    date: '2025-12-31', libelle: 'Indemnités kilométriques 2025 — Peugeot 308', montant, statut: 'proposee' as const,
    created_at: '2026-01-02T09:00:00Z',
  }
  return [
    { ...base, id: 'ik-d', compte: '625110', sens: 'debit', ...o },
    { ...base, id: 'ik-c', compte, sens: 'credit', ...o },
  ]
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '467000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

function monter(annee: number | 'toutes', modele = TRESORERIE) {
  return render(
    <AnneeProvider defaut={annee}>
      <VehiculesCard dossierId="dossier-de-test" modele={modele} />
    </AnneeProvider>,
  )
}

beforeEach(() => {
  // L'exercice en cours décide de ce que la carte réclame : l'horloge est fixée, et seule `Date` est feinte
  // (feindre les minuteurs gèlerait ceux dont `findByText` dépend).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T10:00:00'))
  Object.assign(faux, {
    vehicules: [], ecritures: [], aNouveaux: [], inserts: [], resoudreInsert: null, modifiees: [], rpcs: [], refusRpc: {},
    muetApres: {}, retenirLectures: false, relacher: null, retenue: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('VehiculesCard', () => {
  it("n'ajoute qu'un véhicule quand le bouton est cliqué deux fois de suite", async () => {
    monter(2025)
    const bouton = await screen.findByRole('button', { name: /Ajouter un véhicule sur 2025/ })

    // Les deux clics partent dans le MÊME `act`, et c'est tout l'enjeu du test. Deux
    // `fireEvent.click` de suite ne reproduisent PAS un double clic : chacun ouvre son propre `act`,
    // qui rend le composant en sortant — le second clic tombe donc sur un bouton déjà re-rendu, avec
    // un état à jour. Écrit ainsi, ce test restait vert en remettant le verrou dans un `useState`,
    // c'est-à-dire avec le défaut de production réinstallé. Vu par mutation, pas par relecture.
    await act(async () => {
      bouton.click()
      bouton.click()
    })

    expect(faux.inserts).toHaveLength(1)
    expect(faux.inserts[0]).toEqual({ dossier_id: 'dossier-de-test', annee: 2025 })

    faux.resoudreInsert?.()
    await waitFor(() => expect(screen.getByRole('button', { name: /Ajouter un véhicule/ })).toBeDefined())
  })

  it("ne propose aucun ajout tant qu'aucun exercice n'est choisi", async () => {
    monter('toutes')

    // La carte retombait sur l'année civile en cours : des kilomètres partaient alors sur un
    // exercice que personne n'avait demandé. Elle propose désormais les exercices au lieu d'en
    // choisir un — et n'écrit rien tant que le choix n'est pas fait.
    await screen.findByText(/Choisis l'exercice à renseigner/)
    expect(screen.queryByRole('button', { name: /Ajouter un véhicule/ })).toBeNull()
    expect(faux.inserts).toHaveLength(0)
  })

  it('enregistre un nombre entier de kilomètres', async () => {
    // La colonne est entière en base : « 12,5 » y serait refusé, et l'erreur reviendrait à chaque frappe.
    faux.vehicules = [vehicule()]
    monter(2025)
    const km = await screen.findByDisplayValue('12000')
    await act(async () => { fireEvent.change(km, { target: { value: '12345.7' } }) })
    expect(faux.modifiees.at(-1)).toEqual({ km_professionnel: 12345 })
  })
})

describe('retirer un véhicule : ce qui part se dit AVANT de partir', () => {
  // Le bouton « Retirer » vit dans la MÊME ligne que le champ des kilomètres qu'on vient d'éditer,
  // et il partait sans rien demander. Ces kilomètres sont saisis à la main et décident de la case
  // BJ de la 2035 : effacés par distraction, la déduction disparaît sans que personne ne la
  // cherche. C'était la seule suppression de données saisies du projet sans confirmation.
  it('ne retire rien quand la confirmation est refusée', async () => {
    faux.vehicules = [vehicule()]
    window.confirm = () => false
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('NOMME le véhicule et ses kilomètres dans la question posée', async () => {
    // « Êtes-vous sûr ? » se ferme en un clic aussi distrait que le premier : le message doit dire
    // ce qu'on perd, comme partout ailleurs dans ce projet.
    faux.vehicules = [vehicule()]
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })

    expect(question).toContain('Peugeot 308')
    expect(question).toContain('12000')
    expect(question).toContain('2025')
    // Aucun forfait n'est écrit : la question n'en parle pas.
    expect(question).not.toContain('forfait')
  })

  it('NOMME le forfait écrit qui part avec le véhicule', async () => {
    faux.vehicules = [vehicule()]
    faux.ecritures = forfait(5945)
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(question).toMatch(/Son forfait écrit au brouillon \(5\s945,00\s€\) part avec lui\./)
  })

  it('dit, sur une lecture partielle des forfaits, qu’il ne sait pas s’il en part un', async () => {
    faux.vehicules = [vehicule()]
    faux.ecritures = forfait(5945)
    faux.muetApres = { ecritures_brouillon: 1 }
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(question).toContain('la liste des forfaits n’a pas pu être lue en entier')
  })

  it('retire par la base quand la confirmation est acceptée', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « on ne retire pas sans confirmation » serait satisfait par
    // un bouton qui ne retire JAMAIS. Et c'est la base qui retire — la ligne ET son forfait.
    faux.vehicules = [vehicule()]
    faux.ecritures = forfait(5945)
    window.confirm = () => true
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_vehicule', args: { p_vehicule_id: 'v1' } }])
    await screen.findByText(/Aucun véhicule déclaré sur l'exercice 2025/)
    expect(faux.ecritures).toEqual([])
  })

  it('refuse, avant de demander, de retirer un véhicule dont le forfait est validé', async () => {
    faux.vehicules = [vehicule()]
    faux.ecritures = forfait(5945, { statut: 'validee' })
    let demande = false
    window.confirm = () => { demande = true; return true }
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    expect(demande).toBe(false)
    expect(faux.rpcs).toEqual([])
    expect(screen.getByText('Le forfait de ce véhicule est validé : il ne se retire plus.')).toBeDefined()
  })

  it('dit le refus de la base', async () => {
    faux.vehicules = [vehicule()]
    faux.refusRpc = { v1: 'Accès refusé à ce véhicule.' }
    window.confirm = () => true
    monter(2025)
    const retirer = await screen.findByRole('button', { name: /^Retirer$/ })
    await act(async () => { retirer.click() })
    await screen.findByText('Le véhicule n’a pas pu être retiré : Accès refusé à ce véhicule.')
  })
})

describe('le forfait kilométrique de chaque ligne du cadre 7', () => {
  const colonneForfait = (modele: string) =>
    screen.getByDisplayValue(modele).closest('tr')!.querySelector('[data-libelle="Forfait"]')!.textContent

  it('dit l’état du forfait de chaque véhicule de l’exercice', async () => {
    faux.vehicules = [
      vehicule(),
      vehicule({ id: 'v2', modele: 'Zoé', km_professionnel: 0 }),
      vehicule({ id: 'v3', modele: 'Clio', km_professionnel: 3000, puissance_fiscale: 4 }),
    ]
    faux.ecritures = [
      ...forfait(5945),
      // Le forfait de la Clio a été écrit sur un autre kilométrage.
      ...forfait(100, { vehicule_id: 'v3', id: 'x' }).map((e, i) => ({ ...e, id: `v3-${i}` })),
    ]
    monter(2025)
    await screen.findByDisplayValue('Peugeot 308')
    expect(colonneForfait('Peugeot 308')).toBe('Écrit')
    expect(colonneForfait('Zoé')).toBe('Rien à écrire')
    expect(colonneForfait('Clio')).toBe('À réécrire')
  })

  it('dit « dans les à-nouveaux » un exercice antérieur à l’ouverture du dossier', async () => {
    faux.vehicules = [vehicule()]
    faux.aNouveaux = [{ id: 'an1', dossier_id: 'dossier-de-test', date: '2026-01-01' }]
    monter(2025)
    await screen.findByDisplayValue('Peugeot 308')
    expect(colonneForfait('Peugeot 308')).toBe('Dans les à-nouveaux')
    expect(screen.queryByRole('button', { name: /Écrire/ })).toBeNull()
  })

  it('écrit les forfaits de TOUS les exercices par la base, au compte du dirigeant', async () => {
    // L'en-tête montre 2026 ; le forfait de 2025 est à écrire aussi, et il ne se cache pas derrière l'autre année.
    faux.vehicules = [
      vehicule(),
      vehicule({ id: 'v2', annee: 2026, modele: 'Zoé', puissance_fiscale: 5, motorisation: 'electrique', carburant: null, km_professionnel: 20_000 }),
    ]
    monter(2026)
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })
    await act(async () => { bouton.click() })

    expect(faux.rpcs).toEqual([
      {
        nom: 'ecrire_forfait_kilometrique',
        args: {
          p_vehicule_id: 'v1',
          p_ecritures: [
            { compte: '625110', sens: 'debit', montant: 5945, libelle: 'Indemnités kilométriques 2025 — Peugeot 308' },
            { compte: '108000', sens: 'credit', montant: 5945, libelle: 'Indemnités kilométriques 2025 — Peugeot 308' },
          ],
        },
      },
      {
        nom: 'ecrire_forfait_kilometrique',
        args: {
          p_vehicule_id: 'v2',
          p_ecritures: [
            { compte: '625110', sens: 'debit', montant: 10_234, libelle: 'Indemnités kilométriques 2026 — Zoé' },
            { compte: '108000', sens: 'credit', montant: 10_234, libelle: 'Indemnités kilométriques 2026 — Zoé' },
          ],
        },
      },
    ])
    // Relu, tout est écrit : la liste des forfaits à écrire disparaît, la colonne le dit.
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Forfaits à écrire' })).toBeNull())
    expect(colonneForfait('Zoé')).toBe('Écrit')
  })

  it('crédite le compte choisi pour le dirigeant en engagement', async () => {
    faux.vehicules = [vehicule()]
    monter(2025, ENGAGEMENT)
    const bouton = await screen.findByRole('button', { name: 'Écrire ce forfait' })
    await act(async () => { bouton.click() })
    const lignes = faux.rpcs[0].args.p_ecritures as { compte: string; sens: string }[]
    expect(lignes.map((l) => [l.compte, l.sens])).toEqual([['625110', 'debit'], ['455000', 'credit']])
  })

  it('retire un forfait qui n’a plus lieu d’être par une écriture vide', async () => {
    faux.vehicules = [vehicule({ km_professionnel: 0 })]
    faux.ecritures = forfait(5945)
    monter(2025)
    const bouton = await screen.findByRole('button', { name: 'Écrire ce forfait' })
    expect(screen.getByRole('table', { name: 'Forfaits à écrire' }).textContent).toContain('À retirer')
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([{ nom: 'ecrire_forfait_kilometrique', args: { p_vehicule_id: 'v1', p_ecritures: [] } }])
  })

  it('n’écrit qu’une fois sur trois clics, et tient le verrou pendant la relecture', async () => {
    faux.vehicules = [vehicule()]
    faux.retenirLectures = true
    monter(2025)
    const bouton = await screen.findByRole('button', { name: 'Écrire ce forfait' })
    await act(async () => {
      bouton.click()
      bouton.click()
      bouton.click()
    })
    expect(faux.rpcs).toHaveLength(1)
    // La relecture est retenue : le bouton reste grisé, et la ligne ne se modifie pas pendant ce temps.
    expect((screen.getByRole('button', { name: /Écriture…/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByDisplayValue('12000') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Retirer' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { screen.getByRole('button', { name: /Écriture…/ }).click() })
    expect(faux.rpcs).toHaveLength(1)
    // Et la seconde ceinture : un changement qui arriverait quand même sur la ligne n'écrit rien tant que le lot
    // tient le verrou — modifiée pendant le lot, elle verrait son forfait écrit d'après l'ancien kilométrage.
    fireEvent.change(screen.getByDisplayValue('12000'), { target: { value: '13000' } })
    expect(faux.modifiees).toEqual([])
    faux.retenirLectures = false
    await act(async () => { faux.relacher?.() })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Écri/ })).toBeNull())
    expect(faux.rpcs).toHaveLength(1)
  })

  it('dit les refus de la base sans interrompre le lot', async () => {
    faux.vehicules = [vehicule(), vehicule({ id: 'v2', modele: 'Clio', km_professionnel: 3000 })]
    faux.refusRpc = { v1: 'L’écriture proposée ne correspond pas au forfait 2025 de ce véhicule.' }
    monter(2025)
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })
    await act(async () => { bouton.click() })
    expect(faux.rpcs.map((r) => r.args.p_vehicule_id)).toEqual(['v1', 'v2'])
    await screen.findByText(
      'Forfaits écrits : 1 sur 2. Refusé par la base : Peugeot 308 (2025) : L’écriture proposée ne correspond pas au forfait 2025 de ce véhicule.',
    )
  })

  it('suspend l’écriture sur une lecture partielle, et dit pourquoi', async () => {
    faux.vehicules = [vehicule(), vehicule({ id: 'v2', modele: 'Clio', km_professionnel: 3000 })]
    faux.ecritures = forfait(5945)
    faux.muetApres = { ecritures_brouillon: 1 }
    monter(2025)
    const bouton = await screen.findByRole('button', { name: /Écrire/ })
    expect((bouton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Écriture suspendue : une lecture est partielle/)).toBeDefined()
    expect(screen.getByText(/leur écriture est suspendue jusqu’au rechargement de la page/)).toBeDefined()
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('écrit dès que les lectures sont complètes — le garde symétrique', async () => {
    faux.vehicules = [vehicule()]
    monter(2025)
    const bouton = await screen.findByRole('button', { name: 'Écrire ce forfait' })
    expect((bouton as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/Écriture suspendue/)).toBeNull()
  })

  it('dit pourquoi un forfait ne s’écrit pas, sans le proposer', async () => {
    // Le barème 2024 n'est pas renseigné : rien ne se calcule, rien ne s'écrit, et la carte le dit.
    faux.vehicules = [vehicule({ annee: 2024 })]
    monter(2024)
    const table = await screen.findByRole('table', { name: 'Forfaits à écrire' })
    expect(table.textContent).toContain('Le barème kilométrique 2024 n’est pas renseigné dans l’application.')
    // Et sur la ligne du cadre 7 elle-même, là où l'on saisit ce qui le débloquerait.
    expect(colonneForfait('Peugeot 308')).toBe('À écrireLe barème kilométrique 2024 n’est pas renseigné dans l’application.')
    expect(screen.queryByRole('button', { name: /Écrire/ })).toBeNull()
    // Un exercice révolu : la Checklist le réclame, et la carte le dit.
    expect(screen.getByText('1 forfait manque à un exercice fini ou ne suit plus le cadre 7 : la Checklist le réclame.')).toBeDefined()
  })

  it('propose le forfait de l’exercice en cours sans dire que la Checklist le réclame', async () => {
    faux.vehicules = [vehicule({ annee: 2026 })]
    monter(2026)
    await screen.findByRole('button', { name: 'Écrire ce forfait' })
    expect(screen.queryByText(/la Checklist le réclame/)).toBeNull()
  })
})
