import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { CotisationDeclaree, EcritureBrouillon, LigneBancaire, ModeComptable } from '../../lib/types'

// RETIRER UNE ÉCHÉANCE, ET ÉCRIRE CELLES QUE LE RELEVÉ PAIE (ligne 26.6, étape b).
//
// Une échéance rapprochée d'un mouvement s'écrit depuis le 01/10/2026 (lib/cotisationRapprochee.ts) : la
// cotisation au 646000, sa CSG-CRDS au 108000 en trésorerie, face à la banque. Cet onglet dit quel
// mouvement paie chaque échéance et si son écriture est au brouillon, écrit celles qu'un rapprochement
// d'avant a laissées sans écriture, et retire une échéance par la base — qui remet à traiter le
// mouvement qui la paie et retire son écriture. Aucun test de `src/lib` ne voit ce câblage.
const faux = vi.hoisted(() => ({
  cotisations: [] as CotisationDeclaree[],
  lignes: [] as LigneBancaire[],
  ecritures: [] as EcritureBrouillon[],
  // Lecture partielle d'une table : le serveur cesse de rendre des lignes au-delà de ce rang, en
  // annonçant le vrai total (voir lib/lectureComplete.ts).
  muetApres: {} as Record<string, number>,
  insertions: [] as { table: string; valeur: unknown }[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  // Retient la RÉPONSE de chaque lecture après le premier `rpc` : de quoi tenir le verrou pendant la
  // relecture qui suit l'écriture.
  retenirLectures: false,
  relacher: null as (() => void) | null,
  retenue: null as Promise<void> | null,
  // Retient l'appel à la base lui-même : le lot est alors EN COURS d'écriture.
  retenirRpc: false,
  relacherRpc: null as (() => void) | null,
  // Ce que « lit » la fausse extraction d'un avis d'appel : son échéancier.
  echeancesLues: [] as { date: string; montant: number; previsionnel: boolean }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIs, predicatNot } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  type ReponseRpc = { data: number | null; error: { message: string } | null }
  // Ce que font les trois fonctions de la base (supabase/schema/20261001091417_…) : le rapprochement et
  // l'écriture ensemble, le retrait des deux ensemble, et le retrait de l'échéance après eux.
  function executerRpc(nom: string, args: Record<string, unknown>): Promise<ReponseRpc> {
    faux.rpcs.push({ nom, args })
    if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
    if (nom === 'rapprocher_cotisation') {
      const id = args.p_ligne_bancaire_id as string
      const ligne = faux.lignes.find((l) => l.id === id)!
      faux.ecritures = faux.ecritures.filter((e) => !(e.piece_id == null && e.ligne_bancaire_id === id))
      faux.lignes = faux.lignes.map((l) => (l.id === id ? { ...l, statut: 'rapprochee', cotisation_id: args.p_cotisation_id as string } : l))
      faux.ecritures.push(...(args.p_ecritures as Record<string, unknown>[]).map((e, i): EcritureBrouillon => ({
        id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: id,
        date: ligne.date, compte: e.compte as string, libelle: e.libelle as string, montant: e.montant as number,
        sens: e.sens as 'debit' | 'credit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, created_at: '2026-10-01T10:00:00Z',
      })))
    } else if (nom === 'supprimer_echeance_cotisation') {
      const id = args.p_cotisation_id as string
      const paiement = faux.lignes.find((l) => l.cotisation_id === id)
      if (paiement) {
        faux.ecritures = faux.ecritures.filter((e) => !(e.piece_id == null && e.ligne_bancaire_id === paiement.id))
        faux.lignes = faux.lignes.map((l) => (l.id === paiement.id ? { ...l, statut: 'non_rapprochee', cotisation_id: null } : l))
      }
      faux.cotisations = faux.cotisations.filter((c) => c.id !== id)
    }
    if (faux.retenirLectures) faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    return Promise.resolve({ data: 1, error: null })
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        if (faux.retenirRpc) {
          faux.retenirRpc = false
          return new Promise<void>((r) => { faux.relacherRpc = r }).then(() => executerRpc(nom, args))
        }
        return executerRpc(nom, args)
      },
      from: (table: string) => {
        const c: Record<string, unknown> = {}
        let operation = 'select'
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les filtres qui décident de ce que l'écran voit sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) —
        // sauf le cadrage par dossier, que le jeu d'essai ne renseigne pas. Accepté sans effet, le filtre
        // `.not('cotisation_id', 'is', null)` retiré laisserait ce test vert.
        const predicats: Predicat[] = []
        Object.assign(c, {
          select: () => c,
          insert: (valeur: unknown) => { operation = 'insert'; faux.insertions.push({ table, valeur }); return c },
          update: () => { operation = 'update'; return c },
          delete: () => { operation = 'delete'; return c },
          eq: (colonne: string, valeur: unknown) => {
            if (colonne !== 'dossier_id') predicats.push(predicatEq(colonne, valeur))
            return c
          },
          is: (colonne: string, valeur: null) => { predicats.push(predicatIs(colonne, valeur)); return c },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
            if (operation !== 'select') return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
            const source: readonly unknown[] =
              table === 'cotisations_declarees' ? faux.cotisations
                : table === 'lignes_bancaires' ? faux.lignes
                  : table === 'ecritures_brouillon' ? faux.ecritures
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
      storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
    },
  }
})

// Doublés pour ne rien facturer : ce test porte sur l'écran, jamais sur l'OCR.
vi.mock('../../lib/extraction', () => ({
  extractPiece: () => Promise.resolve({ lecture_cotisation: { echeances: faux.echeancesLues } }),
  fichierDejaPresent: () => Promise.resolve(false),
  hashFichier: () => Promise.resolve('empreinte-de-test'),
}))

// Typés sans `as` : le compilateur confronte le jeu d'essai à la table.
function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2026-03-05',
    montant_appele: 420, montant_verse: null, montant_csg_crds: null,
    previsionnel: false, created_at: '2026-01-05T09:00:00Z', ...o,
  }
}

// Le prélèvement de l'Urssaf qui paie l'échéance `cot-1`.
const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l-1', dossier_id: 'dossier-de-test', date: '2026-03-06', montant: -420,
  libelle: 'PRLV URSSAF', libelle_brut: null, statut: 'rapprochee',
  piece_id: null, cotisation_id: 'cot-1', categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
  created_at: '2026-03-06T09:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e-1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-1', date: '2026-03-06',
  compte: '646000', libelle: 'PRLV URSSAF', montant: 420, sens: 'debit', statut: 'proposee',
  immobilisation_id: null, vehicule_id: null, created_at: '2026-03-06T10:00:00Z', ...o,
})

// L'écriture juste du prélèvement de 420 € d'une échéance sans CSG-CRDS saisie.
const ecritureJuste = (id = 'l-1', montant = 420, date = '2026-03-06') => [
  ecriture({ id: `${id}-a`, ligne_bancaire_id: id, compte: '646000', sens: 'debit', montant, date }),
  ecriture({ id: `${id}-b`, ligne_bancaire_id: id, compte: '512000', sens: 'credit', montant, date }),
]

const monter = (mode: ModeComptable = 'tresorerie') => render(<CotisationsTab dossierId="dossier-de-test" modeComptable={mode} />)

beforeEach(() => {
  faux.cotisations = []
  faux.lignes = []
  faux.ecritures = []
  faux.muetApres = {}
  faux.insertions = []
  faux.rpcs = []
  faux.erreurRpc = null
  faux.retenirLectures = false
  faux.relacher = null
  faux.retenue = null
  faux.retenirRpc = false
  faux.relacherRpc = null
  faux.echeancesLues = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function cliquerRetirer() {
  const bouton = await screen.findByRole('button', { name: 'Retirer' })
  await act(async () => { bouton.click() })
}

describe('CotisationsTab — retirer une échéance dit ce que ça défait, et passe par la base', () => {
  it('nomme le prélèvement qui la paie, dont l’écriture part avec elle', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.ecritures = ecritureJuste()
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })
    monter()

    await screen.findByText('Écrite')
    await cliquerRetirer()

    expect(message).toMatch(/^Retirer cette échéance \?\n\nLe prélèvement du 06\/03\/2026 \(420,00\s€\) qui la paie redevient à traiter, et son écriture est retirée du brouillon\.$/)
    // Annulé : rien ne part.
    expect(faux.rpcs).toEqual([])
  })

  it('dit qu’aucun mouvement ne la paie, quand le relevé est lu en entier', async () => {
    faux.cotisations = [cotisation()]
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })
    monter()

    await cliquerRetirer()
    expect(message).toContain('Aucun mouvement bancaire ne la paie.')
  })

  it('ne l’affirme pas sur un relevé lu en partie', async () => {
    // Le prélèvement existe, la lecture n'en rend rien : l'écran ne sait pas, et le dit au conditionnel.
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.muetApres.lignes_bancaires = 0
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })
    monter()

    await cliquerRetirer()
    expect(message).toContain('Si un mouvement bancaire la paie, il redevient à traiter, et son écriture est retirée du brouillon.')
    expect(message).not.toContain('Aucun mouvement')
  })

  it('retire par la base quand on confirme — jamais par une suppression directe', async () => {
    // Le garde symétrique : sans lui, « la confirmation nomme ce qu'on perd » serait satisfait par un
    // bouton qui ne retire JAMAIS. Et une suppression directe laisserait le prélèvement « rapproché » sans
    // plus rien qui le justifie, avec son écriture au brouillon.
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.ecritures = ecritureJuste()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    await screen.findByText('Écrite')
    await cliquerRetirer()

    expect(faux.rpcs).toEqual([{ nom: 'supprimer_echeance_cotisation', args: { p_cotisation_id: 'cot-1' } }])
    await screen.findByText("Aucune échéance enregistrée pour l'instant.")
    expect(faux.ecritures).toEqual([])
  })

  it('deux clics rapprochés sur « Retirer » ne retirent qu’une fois', async () => {
    // Le bouton se grise sur un état React, donc au rendu SUIVANT : deux clics du même rendu entrent tous
    // deux dans le gestionnaire. C'est le verrou qui arrête le second.
    faux.cotisations = [cotisation()]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = await screen.findByRole('button', { name: 'Retirer' })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs.filter((r) => r.nom === 'supprimer_echeance_cotisation')).toHaveLength(1)
  })

  it('dit le refus de la base au lieu de se taire', async () => {
    faux.cotisations = [cotisation()]
    faux.erreurRpc = 'L\'écriture du mouvement qui paie cette échéance est validée : l\'échéance ne se supprime plus.'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    await cliquerRetirer()
    await screen.findByText(/L’échéance n’a pas pu être retirée : L'écriture du mouvement qui paie cette échéance est validée/)
  })
})

describe('CotisationsTab — la colonne Paiement', () => {
  it('dit le prélèvement qui paie l’échéance, et que son écriture est au brouillon', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.ecritures = ecritureJuste()
    monter()

    await screen.findByText('Prélevée le 06/03/2026')
    expect(screen.getByText('Écrite')).toBeTruthy()
    expect(screen.queryByText(/dont l’écriture manque/)).toBeNull()
  })

  it('« Sans écriture » sur un rapprochement d’avant, « À réécrire » sur une écriture qui ne suit plus', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05', montant_csg_crds: 40 }),
    ]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    // L'écriture du second est d'avant la saisie de sa CSG-CRDS : tout au 646000.
    faux.ecritures = ecritureJuste('l-2', 420, '2026-04-06')
    monter()

    await screen.findByText('Sans écriture')
    expect(screen.getByText('À réécrire')).toBeTruthy()
    expect(screen.getByText('2 échéances payées dont l’écriture manque ou n’est plus à jour')).toBeTruthy()
  })

  it('« Ne s’écrit pas » sur un encaissement rapproché d’un appel, avec sa raison, et hors du lot', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne({ montant: 420 })]
    monter()

    await screen.findByText('Ne s’écrit pas')
    expect(screen.getByText(/Ce mouvement est un encaissement : il ne paie pas un appel de cotisation\./)).toBeTruthy()
    expect(screen.getByText('Remboursée le 06/03/2026')).toBeTruthy()
    // Il n'est pas à écrire : « Écrire » échouerait.
    expect(screen.queryByRole('button', { name: /^Écrire/ })).toBeNull()
    // Et il ne paie rien : le versé ne le reprend pas.
    expect(screen.queryByText('(relevé)')).toBeNull()
  })

  it('ne dit rien du paiement sur un relevé lu en partie', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.muetApres.lignes_bancaires = 0
    monter()

    await screen.findByRole('button', { name: 'Retirer' })
    expect(screen.queryByText(/Prélevée le/)).toBeNull()
    expect(screen.queryByText('Sans écriture')).toBeNull()
  })

  it('sur un relevé lu en partie, un paiement LU ne se dit pas non plus, et l’écriture se suspend', async () => {
    // La lecture rend le prélèvement de la première échéance et s'arrête avant celui de la seconde : ce
    // qu'on a lu peut être juste, mais ce qu'on n'a pas lu paraîtrait impayé. On ne dit rien du paiement,
    // on n'écrit rien, et le bandeau dit pourquoi.
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    faux.muetApres.lignes_bancaires = 1
    monter()

    const bouton = await screen.findByRole('button', { name: 'Écrire cette échéance' })
    expect(screen.queryByText(/Prélevée le/)).toBeNull()
    expect(screen.getByText(/Les cotisations, leurs justificatifs et leurs paiements n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Suspendu : la lecture est partielle/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('ne lit que les mouvements rapprochés d’une échéance', async () => {
    // Un mouvement rapproché d'une PIÈCE n'est pas un paiement d'échéance : le filtre de la lecture
    // l'écarte. Accepté sans effet, il ferait paraître l'échéance payée.
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne({ id: 'piece', cotisation_id: null, piece_id: 'p-1' })]
    monter()

    await screen.findByRole('button', { name: 'Retirer' })
    expect(screen.queryByText(/Prélevée le/)).toBeNull()
  })

  it('la recherche trouve une échéance par la date de son prélèvement', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-09' })]
    faux.ecritures = [...ecritureJuste('l-1'), ...ecritureJuste('l-2', 420, '2026-04-09')]
    monter()

    await screen.findByText('Prélevée le 09/04/2026')
    const champ = screen.getByRole('searchbox', { name: 'Rechercher une échéance, un montant…' })
    await act(async () => { fireEvent.change(champ, { target: { value: '09/04/2026' } }) })
    expect(screen.getByText('Prélevée le 09/04/2026')).toBeTruthy()
    expect(screen.queryByText('Prélevée le 06/03/2026')).toBeNull()
  })

  it('le versé est celui du relevé quand rien n’est saisi, et le total le compte', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', montant_verse: null }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05', montant_verse: 400 }),
    ]
    faux.lignes = [ligne({ id: 'l-1', montant: -418.5 })]
    faux.ecritures = ecritureJuste('l-1', 418.5)
    monter()

    await screen.findByText('(relevé)')
    // Total versé : 418,50 (relevé) + 400 (saisi) ; reste : 840 − 818,50.
    const valeur = (libelle: string) => screen.getByText(libelle).parentElement?.querySelector('strong')?.textContent
    expect(valeur('Total versé')).toMatch(/^818,50\s€$/)
    expect(valeur('Reste à verser')).toMatch(/^21,50\s€$/)
  })
})

describe('CotisationsTab — écrire les échéances payées', () => {
  it('écrit celles qui n’ont pas leur écriture, en trésorerie avec la CSG-CRDS au 108000', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', montant_csg_crds: 40.5 }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05' }),
    ]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    faux.ecritures = ecritureJuste('l-2', 420, '2026-04-06')
    monter()

    await screen.findByText('1 échéance payée dont l’écriture manque ou n’est plus à jour')
    expect(screen.getByText(/Le bouton écrit chacune au compte 646000, sa CSG-CRDS au 108000, face à\s+la banque\./)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Écrire cette échéance' }).click() })

    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_cotisation',
      args: {
        p_ligne_bancaire_id: 'l-1',
        p_cotisation_id: 'cot-1',
        p_ecritures: [
          { compte: '512000', sens: 'credit', montant: 420, libelle: 'PRLV URSSAF' },
          { compte: '646000', sens: 'debit', montant: 379.5, libelle: 'PRLV URSSAF' },
          { compte: '108000', sens: 'debit', montant: 40.5, libelle: 'PRLV URSSAF' },
        ],
      },
    }])
    // Relue, la liste n'en porte plus : la carte disparaît, et les deux échéances sont écrites.
    await waitFor(() => expect(screen.queryByText(/dont l’écriture manque/)).toBeNull())
    expect(screen.getAllByText('Écrite')).toHaveLength(2)
  })

  it('en engagement, la CSG-CRDS reste au 646000', async () => {
    faux.cotisations = [cotisation({ montant_csg_crds: 40.5 })]
    faux.lignes = [ligne()]
    monter('engagement')

    const bouton = await screen.findByRole('button', { name: 'Écrire cette échéance' })
    // La carte dit ce que le bouton écrit : rien au 108000 dans ce modèle.
    expect(screen.getByText(/Le bouton écrit chacune au compte 646000, face à\s+la banque\./)).toBeTruthy()
    expect(screen.queryByText(/sa CSG-CRDS au 108000/)).toBeNull()
    await act(async () => { bouton.click() })
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '512000', sens: 'credit', montant: 420, libelle: 'PRLV URSSAF' },
      { compte: '646000', sens: 'debit', montant: 420, libelle: 'PRLV URSSAF' },
    ])
  })

  it('un échec n’interrompt pas le lot, et se dit', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    faux.erreurRpc = 'L\'écriture de ce mouvement est validée : elle ne se remplace plus.'
    let alerte = ''
    vi.spyOn(window, 'alert').mockImplementation((m?: string) => { alerte = m ?? '' })
    monter()

    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })
    await act(async () => { bouton.click() })
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['l-1', 'l-2'])
    expect(alerte).toBe('0 échéance(s) écrite(s) sur 2. 2 n’ont pas pu l’être : L\'écriture de ce mouvement est validée : elle ne se remplace plus.')
  })

  it('suspend l’écriture quand les écritures ne sont lues qu’en partie', async () => {
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    // L'écriture existe ; lue en partie, elle manque, et l'échéance PARAÎT sans écriture.
    faux.ecritures = ecritureJuste()
    faux.muetApres.ecritures_brouillon = 0
    monter()

    const bouton = await screen.findByRole('button', { name: 'Écrire cette échéance' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Suspendu : la lecture est partielle/)).toBeTruthy()
    // La colonne ne l'affirme pas non plus, et le bandeau dit lesquelles n'ont pas été lues.
    expect(screen.queryByText('Sans écriture')).toBeNull()
    expect(screen.getByText(/Les écritures des échéances payées n'ont pas pu être lues en entier/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('suspend l’écriture quand les échéances ne sont lues qu’en partie', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    faux.muetApres.cotisations_declarees = 1
    monter()

    const bouton = await screen.findByRole('button', { name: 'Écrire cette échéance' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('se tait quand chaque échéance payée a son écriture', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la carte montre les échéances à écrire » serait satisfait par une
    // carte toujours affichée.
    faux.cotisations = [cotisation()]
    faux.lignes = [ligne()]
    faux.ecritures = ecritureJuste()
    monter()

    await screen.findByText('Écrite')
    expect(screen.queryByText(/dont l’écriture manque/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Écrire/ })).toBeNull()
  })

  it('trois clics rapprochés n’écrivent qu’une fois, et le verrou tient pendant la relecture', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    monter()
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })

    faux.retenirLectures = true
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await waitFor(() => expect(faux.relacher).not.toBeNull())
    // Un lot, pas trois : deux échéances, deux appels.
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['l-1', 'l-2'])
    // La relecture n'est pas revenue : le bouton reste grisé, et un clic de plus ne relance rien.
    expect(screen.getByRole('button', { name: 'Écriture…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { screen.getByRole('button', { name: 'Écriture…' }).click() })
    expect(faux.rpcs).toHaveLength(2)

    faux.retenirLectures = false
    await act(async () => { faux.relacher?.(); faux.retenue = null })
    await waitFor(() => expect(screen.queryByText(/dont l’écriture manque/)).toBeNull())
  })

  it('« Retirer » attend la fin du lot : retirée pendant, une échéance serait réécrite par le lot', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ id: 'l-1' }), ligne({ id: 'l-2', cotisation_id: 'cot-2', date: '2026-04-06' })]
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })

    faux.retenirRpc = true
    await act(async () => { bouton.click() })
    const retirer = screen.getAllByRole('button', { name: 'Retirer' })
    expect(retirer.every((b) => b.hasAttribute('disabled'))).toBe(true)
    await act(async () => { retirer[0].click() })
    expect(confirmation).not.toHaveBeenCalled()

    await act(async () => { faux.relacherRpc?.() })
    await waitFor(() => expect(screen.queryByText(/dont l’écriture manque/)).toBeNull())
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['rapprocher_cotisation', 'rapprocher_cotisation'])
  })
})

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. La création d'un échéancier lu sur un avis d'appel
// écarte les échéances déjà enregistrées — celles qu'on a LUES. Sur une liste tronquée, une échéance
// déjà créée l'était une seconde fois, et la cotisation comptait double dans la 2035 (case BK).
describe('CotisationsTab — créer l’échéancier lu sur un avis d’appel', () => {
  async function deposerAvis() {
    faux.echeancesLues = [
      { date: '2026-03-05', montant: 420, previsionnel: false },
      { date: '2026-04-05', montant: 420, previsionnel: false },
    ]
    monter()
    const champ = document.querySelector('input[type=file][accept=".pdf,.jpg,.jpeg,.png"]') as HTMLInputElement
    await screen.findByText(/Ajouter une échéance/)
    const fichier = new File(['%PDF'], 'avis-urssaf.pdf', { type: 'application/pdf' })
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Créer ces 2 échéance\(s\)/ })
  }

  it('se suspend sur des échéances lues à moitié, et ne crée rien', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1', echeance: '2026-03-05' })]
    // L'échéance du 05/03 est en base, mais la lecture n'en rend rien : elle paraîtrait nouvelle.
    faux.muetApres.cotisations_declarees = 0
    const bouton = await deposerAvis()

    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Création suspendue/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'cotisations_declarees')).toHaveLength(0)
  })

  it('crée, sur une lecture complète, la seule échéance qui manque', async () => {
    // Le garde symétrique : sans lui, « la création se suspend » serait satisfait par un bouton qui
    // ne crée JAMAIS.
    faux.cotisations = [cotisation({ id: 'cot-1', echeance: '2026-03-05' })]
    const bouton = await deposerAvis()
    expect(screen.queryByText(/Création suspendue/)).toBeNull()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    await act(async () => { bouton.click() })

    const creees = faux.insertions.filter((i) => i.table === 'cotisations_declarees')
    expect(creees).toHaveLength(1)
    expect(creees[0].valeur).toEqual([expect.objectContaining({ echeance: '2026-04-05', montant_appele: 420 })])
  })

  it("trois clics rapprochés ne créent l'échéancier qu'une fois", async () => {
    faux.cotisations = [cotisation({ id: 'cot-1', echeance: '2026-03-05' })]
    const bouton = await deposerAvis()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions.filter((i) => i.table === 'cotisations_declarees')).toHaveLength(1)
  })
})
