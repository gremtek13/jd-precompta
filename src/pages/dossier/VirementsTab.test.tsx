import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VirementsTab from './VirementsTab'
import type { ModeleComptable } from '../../lib/engagement'
import type { EcritureBrouillon, LigneBancaire } from '../../lib/types'
import { NON_VALIDEE } from '../../test/ecritures'
import { AvecExercicesValides } from '../../test/exercicesValides'

// LE « TOTAL PRÉLEVÉ » SOMMAIT DES VALEURS ABSOLUES.
//
// Le bouton « Virement personnel » de l'onglet Banque n'est borné par AUCUN signe — et c'est le seul
// qui nomme la situation d'un mouvement venu du compte personnel de l'exploitant. Un apport marqué
// ainsi faisait donc MONTER le total, sous un libellé qui dit l'inverse : 1 000 € sortis et 300 €
// entrés affichaient « Total prélevé 1 300,00 € » au lieu de 700.
//
// LATENT, et mesuré : les 3 lignes marquées en base sont toutes des sorties, donc le total est juste
// aujourd'hui. Ce qui le rend digne d'être corrigé est qu'il ne PEUT pas se voir une fois arrivé —
// un total faux a exactement l'air d'un total, et la ligne fautive est noyée dans une liste.
//
// ET UN VIREMENT PERSONNEL S'ÉCRIT DEPUIS LE 29/09/2026 (lib/virementPersonnel.ts) : ceux marqués avant
// n'ont pas d'écriture, et cet écran les montre et les écrit — par la fonction de la base, sous un
// verrou, jamais sur une lecture partielle.
const faux = vi.hoisted(() => ({
  lignes: [] as LigneBancaire[],
  ecritures: [] as EcritureBrouillon[],
  // Lecture partielle d'une table : le serveur cesse de rendre des lignes au-delà de ce rang, en
  // annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  // Retient la RÉPONSE de chaque appel à la base après le premier `rpc` : de quoi tenir le verrou
  // pendant la relecture qui suit l'écriture.
  retenirLectures: false,
  relacher: null as (() => void) | null,
  retenue: null as Promise<void> | null,
  // Retient l'appel à la base lui-même : le lot est alors EN COURS d'écriture.
  retenirRpc: false,
  relacherRpc: null as (() => void) | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  type ReponseRpc = { data: number | null; error: { message: string } | null }
  function executerRpc(nom: string, args: Record<string, unknown>): Promise<ReponseRpc> {
    faux.rpcs.push({ nom, args })
    if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
    const id = args.p_ligne_bancaire_id as string
    // Ce que font les deux fonctions de la base (supabase/schema/20260929150010_…) : le classement
    // et l'écriture ensemble, le retrait des deux ensemble.
    faux.ecritures = faux.ecritures.filter((e) => !(e.piece_id == null && e.ligne_bancaire_id === id))
    if (nom === 'classer_virement_personnel') {
      const ligne = faux.lignes.find((l) => l.id === id)!
      faux.lignes = faux.lignes.map((l) => (l.id === id ? { ...l, statut: 'ignoree', prelevement_personnel: true } : l))
      faux.ecritures.push(...(args.p_ecritures as Record<string, unknown>[]).map((e, i): EcritureBrouillon => ({
        id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: id,
        date: ligne.date, compte: e.compte as string, libelle: e.libelle as string, montant: e.montant as number,
        sens: e.sens as 'debit' | 'credit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2026-09-29T10:00:00Z',
      })))
    } else {
      faux.lignes = faux.lignes.map((l) => (l.id === id ? { ...l, statut: 'non_rapprochee', prelevement_personnel: false } : l))
    }
    if (faux.retenirLectures) faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    return Promise.resolve({ data: 2, error: null })
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
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les filtres qui décident de ce que l'écran voit sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) —
        // sauf le cadrage par dossier, que le jeu d'essai ne renseigne pas.
        const predicats: Predicat[] = []
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => {
            if (colonne !== 'dossier_id') predicats.push(predicatEq(colonne, valeur))
            return c
          },
          is: (colonne: string, valeur: null) => { predicats.push((l) => l[colonne] === valeur); return c },
          order: () => c,
          // `count` est ANNONCÉ : un faux client qui l'omet fait déclarer INCOMPLÈTE toute lecture de
          // `lireTout`, et l'écran rend alors son bandeau à la place de la liste — le test serait vert
          // pour une raison qui n'est pas la sienne. C'est le coût récurrent de `lireTout`, et il se
          // paie une fois par faux client.
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
            const source: readonly (EcritureBrouillon | LigneBancaire)[] = table === 'ecritures_brouillon' ? faux.ecritures : faux.lignes
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

// Typé `Partial<LigneBancaire> => LigneBancaire` SANS `as` : le compilateur vérifie alors chaque
// champ contre la table, exhaustivement. C'est ce qui a sorti `created_at` du jeu d'essai de
// BanqueTab, absent depuis toujours.
const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -1000,
  libelle: 'VIREMENT COMPTE PERSO', libelle_brut: null, statut: 'ignoree',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: true, source_fichier: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
  created_at: '2025-06-02T09:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e-1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-1', date: '2025-06-02',
  compte: '108000', libelle: 'VIREMENT COMPTE PERSO', montant: 1000, sens: 'debit', statut: 'proposee',
  immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2025-06-02T10:00:00Z', ...o,
})

// L'écriture juste d'un prélèvement de 1 000 € en trésorerie : le compte de l'exploitant au débit.
const ecritureJuste = (id: string, montant = 1000, date = '2025-06-02') => [
  ecriture({ id: `${id}-a`, ligne_bancaire_id: id, compte: '108000', sens: 'debit', montant, date }),
  ecriture({ id: `${id}-b`, ligne_bancaire_id: id, compte: '512000', sens: 'credit', montant, date }),
]

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// `valides` : les exercices validés que la page du dossier fournit à ses onglets (DossierDetail).
const monter = (modele: ModeleComptable = TRESORERIE, valides: readonly number[] = []) => render(
  <AvecExercicesValides annees={valides}><VirementsTab dossierId="dossier-de-test" modele={modele} /></AvecExercicesValides>,
)
// `\s` : `formatMoney` sépare les milliers par une espace fine insécable (U+202F).
const MONTANT = (texte: string) => new RegExp(`^${texte.replace(/ /g, '\\s')}$`)

beforeEach(() => {
  faux.lignes = []
  faux.ecritures = []
  faux.muetApres = {}
  faux.rpcs = []
  faux.erreurRpc = null
  faux.retenirLectures = false
  faux.relacher = null
  faux.retenue = null
  faux.retenirRpc = false
  faux.relacherRpc = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VirementsTab — le total prélevé', () => {
  it('additionne les sorties, en valeur absolue', async () => {
    faux.lignes = [ligne({ id: 'a', montant: -1000 }), ligne({ id: 'b', montant: -500 })]
    monter()

    await screen.findByText(MONTANT('1 500,00 €'))
  })

  it('n’ajoute PAS un mouvement entrant au total, et le NOMME', async () => {
    faux.lignes = [ligne({ id: 'a', montant: -1000 }), ligne({ id: 'b', montant: 300 })]
    monter()

    // Le défaut : 1 300,00 € — la somme des valeurs absolues, sous un libellé « Total prélevé ».
    await screen.findByText(MONTANT('1 000,00 €'))
    expect(screen.queryAllByText(MONTANT('1 300,00 €'))).toHaveLength(0)
    // Et l'apport n'est pas simplement écarté en silence : il est dit, avec son montant.
    const mention = screen.getByText(/mouvement\(s\) ENTRANT\(s\)/)
    expect(mention.textContent).toMatch(/300,00/)
  })

  it('se tait quand tous les mouvements sont des sorties', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran nomme les entrées » serait satisfait par un écran qui
    // affiche TOUJOURS cette mise en garde — et une mise en garde permanente cesse d'être lue, puis
    // emporte ses voisines dans son discrédit.
    faux.lignes = [ligne({ id: 'a', montant: -1000 })]
    faux.ecritures = ecritureJuste('a')
    monter()

    // Ancré sur la ligne elle-même : sans ancre, un écran encore en chargement rendrait le test vert
    // pour une raison fausse.
    await screen.findByText('VIREMENT COMPTE PERSO')
    expect(screen.queryAllByText(/mouvement\(s\) ENTRANT\(s\)/)).toHaveLength(0)
  })
})

describe('VirementsTab — les virements personnels sans écriture', () => {
  it('montre ceux qui n’en ont pas, et les écrit sur le compte de l’exploitant', async () => {
    faux.lignes = [
      ligne({ id: 'ancien', montant: -1000, date: '2025-06-02' }),
      ligne({ id: 'ecrit', montant: -500, date: '2025-07-02', libelle: 'VIR PERSO JUILLET' }),
    ]
    faux.ecritures = ecritureJuste('ecrit', 500, '2025-07-02')
    monter()

    await screen.findByText('1 virement personnel sans son écriture')
    expect(screen.getByText('Sans écriture')).toBeTruthy()
    expect(screen.getByText('Compte 108000')).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Écrire ce virement' }).click() })

    // UN appel, pour le seul virement sans écriture, avec l'écriture que le classement produit.
    expect(faux.rpcs).toEqual([{
      nom: 'classer_virement_personnel',
      args: {
        p_ligne_bancaire_id: 'ancien',
        p_ecritures: [
          { compte: '108000', sens: 'debit', montant: 1000, libelle: 'VIREMENT COMPTE PERSO' },
          { compte: '512000', sens: 'credit', montant: 1000, libelle: 'VIREMENT COMPTE PERSO' },
        ],
      },
    }])
    // Relue, la liste n'en porte plus : la carte disparaît, et les deux virements ont leur écriture.
    await waitFor(() => expect(screen.queryByText(/sans (son|leur) écriture/)).toBeNull())
    expect(screen.getAllByText('Compte 108000')).toHaveLength(2)
  })

  it('en engagement, sur le compte choisi pour le dirigeant', async () => {
    faux.lignes = [ligne({ id: 'apport', montant: 2000, libelle: 'VIR APPORT' })]
    monter(ENGAGEMENT)

    await screen.findByText('1 virement personnel sans son écriture')
    await act(async () => { screen.getByRole('button', { name: 'Écrire ce virement' }).click() })

    // Un apport CRÉDITE le compte du dirigeant.
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '455000', sens: 'credit', montant: 2000, libelle: 'VIR APPORT' },
      { compte: '512000', sens: 'debit', montant: 2000, libelle: 'VIR APPORT' },
    ])
    await screen.findByText('Compte 455000')
  })

  it('une écriture sur un autre compte est à réécrire', async () => {
    faux.lignes = [ligne({ id: 'a' })]
    faux.ecritures = [
      ecriture({ id: 'x', ligne_bancaire_id: 'a', compte: '455000', sens: 'debit' }),
      ecriture({ id: 'y', ligne_bancaire_id: 'a', compte: '512000', sens: 'credit' }),
    ]
    monter()

    await screen.findByText('À réécrire')
    expect(screen.getByText('1 virement personnel sans son écriture')).toBeTruthy()
  })

  it('se tait quand chaque virement a son écriture', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la carte montre les virements sans écriture » serait satisfait par
    // une carte toujours affichée.
    faux.lignes = [ligne({ id: 'a' })]
    faux.ecritures = ecritureJuste('a')
    monter()

    await screen.findByText('Compte 108000')
    expect(screen.queryByText(/sans (son|leur) écriture/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Écrire/ })).toBeNull()
  })

  it('suspend l’écriture quand les écritures ne sont lues qu’en partie', async () => {
    faux.lignes = [ligne({ id: 'a' })]
    // L'écriture existe ; lue en partie, elle manque, et le virement PARAÎT sans écriture.
    faux.ecritures = ecritureJuste('a')
    faux.muetApres.ecritures_brouillon = 0
    monter()

    const bouton = await screen.findByRole('button', { name: 'Écrire ce virement' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Suspendu : la lecture est partielle/)).toBeTruthy()
    // La colonne ne l'affirme pas non plus.
    expect(screen.queryByText('Sans écriture')).toBeNull()
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('suspend l’écriture quand les virements ne sont lus qu’en partie', async () => {
    faux.lignes = [ligne({ id: 'a' }), ligne({ id: 'b', date: '2025-07-02' })]
    faux.muetApres.lignes_bancaires = 1
    monter()

    const bouton = await screen.findByRole('button', { name: 'Écrire ce virement' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Suspendu : la lecture est partielle/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('ne donne pas une liste qu’il n’a pas pu lire pour vide', async () => {
    faux.lignes = [ligne({ id: 'a' })]
    faux.muetApres.lignes_bancaires = 0
    monter()

    await screen.findByText('Les virements personnels n’ont pas pu être lus.')
    expect(screen.queryByText('Aucun virement personnel marqué pour l\'instant.')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Écrire/ })).toBeNull()
  })

  it('trois clics rapprochés n’écrivent qu’une fois, et le verrou tient pendant la relecture', async () => {
    faux.lignes = [ligne({ id: 'a' }), ligne({ id: 'b', date: '2025-07-02' })]
    monter()
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })

    faux.retenirLectures = true
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await waitFor(() => expect(faux.relacher).not.toBeNull())
    // Un lot, pas trois : deux virements, deux appels.
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['a', 'b'])
    // La relecture n'est pas revenue : le bouton reste grisé, et un clic de plus ne relance rien.
    expect(screen.getByRole('button', { name: 'Écriture…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { screen.getByRole('button', { name: 'Écriture…' }).click() })
    expect(faux.rpcs).toHaveLength(2)

    faux.retenirLectures = false
    await act(async () => { faux.relacher?.(); faux.retenue = null })
    await waitFor(() => expect(screen.queryByText(/sans (son|leur) écriture/)).toBeNull())
  })

  it('« Retirer » attend la fin du lot : retiré pendant, un virement serait reclassé par le lot', async () => {
    faux.lignes = [ligne({ id: 'a' }), ligne({ id: 'b', date: '2025-07-02' })]
    monter()
    const bouton = await screen.findByRole('button', { name: 'Écrire les 2' })

    faux.retenirRpc = true
    await act(async () => { bouton.click() })
    const retirer = screen.getAllByRole('button', { name: 'Retirer' })
    expect(retirer.every((b) => b.hasAttribute('disabled'))).toBe(true)
    await act(async () => { retirer[0].click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual([])

    await act(async () => { faux.relacherRpc?.() })
    await waitFor(() => expect(screen.queryByText(/sans (son|leur) écriture/)).toBeNull())
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['classer_virement_personnel', 'classer_virement_personnel'])
  })

  it('un refus de la base se dit, et la liste est relue', async () => {
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    faux.lignes = [ligne({ id: 'a' })]
    faux.erreurRpc = 'L’écriture de ce mouvement est validée : elle ne se remplace plus.'
    monter()

    const ecrire = await screen.findByRole('button', { name: 'Écrire ce virement' })
    await act(async () => { ecrire.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalled())
    expect(alerte.mock.calls[0][0]).toMatch(/0 virement\(s\) écrit\(s\) sur 1/)
    expect(alerte.mock.calls[0][0]).toMatch(/elle ne se remplace plus/)
    // Le bouton revient : un nouvel essai reste possible.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Écrire ce virement' }).hasAttribute('disabled')).toBe(false))
  })
})

describe('VirementsTab — retirer un virement', () => {
  it('passe par la base, qui retire l’écriture avec le classement', async () => {
    faux.lignes = [ligne({ id: 'a' })]
    faux.ecritures = ecritureJuste('a')
    monter()

    const retirer = await screen.findByRole('button', { name: 'Retirer' })
    await act(async () => { retirer.click() })

    expect(faux.rpcs).toEqual([{ nom: 'retirer_virement_personnel', args: { p_ligne_bancaire_id: 'a' } }])
    await screen.findByText('Aucun virement personnel marqué pour l\'instant.')
    expect(faux.ecritures).toEqual([])
  })

  it('un refus se dit au lieu de laisser croire le virement retiré', async () => {
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    faux.lignes = [ligne({ id: 'a' })]
    faux.ecritures = ecritureJuste('a')
    faux.erreurRpc = 'L’écriture de ce mouvement est validée : elle ne se retire plus.'
    monter()

    const retirer = await screen.findByRole('button', { name: 'Retirer' })
    await act(async () => { retirer.click() })

    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/elle ne se retire plus/)))
    expect(screen.getByText('VIREMENT COMPTE PERSO')).toBeTruthy()
  })

  // LIGNE 26.6 (d) : un virement daté d'un exercice validé ne se retire plus — la base le refuse. Sa ligne le dit, au
  // lieu d'un bouton qui n'aboutirait qu'à un refus ; celle d'après la frontière garde le sien.
  it('un virement d’un exercice validé ne se retire plus, et sa ligne le dit', async () => {
    faux.lignes = [ligne({ id: 'fige', date: '2025-12-31' }), ligne({ id: 'ouvert', date: '2026-01-02', libelle: 'VIREMENT OUVERT' })]
    faux.ecritures = [...ecritureJuste('fige', 1000, '2025-12-31'), ...ecritureJuste('ouvert', 1000, '2026-01-02')]
    monter(TRESORERIE, [2025])

    const fige = (await screen.findByText('VIREMENT COMPTE PERSO')).closest('tr')!
    expect(within(fige).queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect(within(fige).getByText('Figé').getAttribute('title')).toBe('L\'exercice 2025 est validé : ce virement ne se retire plus.')
    const ouvert = screen.getByText('VIREMENT OUVERT').closest('tr')!
    expect(within(ouvert).getByRole('button', { name: 'Retirer' })).toBeTruthy()
  })

  // Un virement figé SANS son écriture — classé avant que le classement s'écrive, avant l'ouverture d'un dossier
  // repris : la base n'y écrit plus. Le lot ne le compte pas — il échouerait sur lui —, et sa ligne dit pourtant
  // qu'il n'a pas d'écriture, sans badge qui appellerait un geste.
  it('un virement d’un exercice validé sans écriture ne se réclame pas, et sa ligne le dit', async () => {
    faux.lignes = [
      ligne({ id: 'fige', date: '2025-12-31' }),
      ligne({ id: 'ouvert', date: '2026-01-02', libelle: 'VIREMENT OUVERT' }),
    ]
    monter(TRESORERIE, [2025])

    await screen.findByText('1 virement personnel sans son écriture')
    const fige = screen.getByText('VIREMENT COMPTE PERSO').closest('tr')!
    const etat = within(fige).getByText('Sans écriture')
    expect(etat.className).toBe('muted')
    expect(etat.getAttribute('title')).toBe('L\'exercice 2025 est validé : ce virement ne s’écrit plus.')
    const ouvert = screen.getByText('VIREMENT OUVERT').closest('tr')!
    expect(within(ouvert).getByText('Sans écriture').className).toMatch(/badge-warning/)

    await act(async () => { screen.getByRole('button', { name: 'Écrire ce virement' }).click() })
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['ouvert'])
  })
})
