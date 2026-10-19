import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExemplaireDeLaFacture, { type DonneesExemplaire } from './ExemplaireDeLaFacture'
import { argumentsDeLaDesignation, argumentsDuRetraitDeLaDesignation, REFUS_DESIGNATION, REFUS_RETRAIT_DESIGNATION } from '../../lib/exemplairesDesFactures'
import { remplirModele } from '../../lib/encaissementsFactures'
import { formatMoney } from '../../lib/format'
import type { FactureProposee } from '../../lib/exemplairesDesFacturesLecture'
import type { Piece } from '../../lib/types'

// L'EXEMPLAIRE D'UNE FACTURE ÉMISE, DANS LA FICHE D'UNE PIÈCE DE VENTE (ligne 28.6, étape VF1b). Ce que ces cas gardent, et
// qu'aucun test de `src/lib` ne voit parce que tout vit dans le câblage : rien n'est offert sur une liste pas encore revenue,
// lue en partie, ou quand on ne sait pas si la pièce est figée ; le refus de la base dit AVANT le clic, sous ses mots ; la
// confirmation NOMME la facture ; un seul appel pour plusieurs clics, et le verrou tenu jusqu'après la relecture de la pièce ;
// une erreur de la base dite, et le verrou relâché ; aucun geste sur une pièce qui n'est pas une vente.
// Les fonctions de la base sont doublées : leur texte est confronté par exemplairesDesFactures.test.ts. Données FICTIVES.
const faux = vi.hoisted(() => ({
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  reponse: { error: null } as { error: { message: string } | null },
  // L'appel à la base reste EN ATTENTE jusqu'à ce que le cas le libère.
  retenirRpc: false,
  libererRpc: null as null | (() => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      if (faux.retenirRpc) return new Promise((resolve) => { faux.libererRpc = () => resolve(faux.reponse) })
      return Promise.resolve(faux.reponse)
    },
  },
}))

const D = 'd1'
const facture = (o: Partial<FactureProposee> = {}): FactureProposee => ({
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  tiers_nom: 'CLIENT FICTIF SAS', montant_ttc: 1200, source_de_la_vente: false, ...o,
})
const FACTURES = [facture(), facture({ id: 'a1', type: 'avoir', numero: 'A2026-0001', date_emission: '2026-04-02', montant_ttc: -300 })]

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: D, uploaded_by: null, source: 'upload',
    storage_path: 'd1/vente-0007.pdf', nom_fichier: 'vente-0007.pdf', storage_hash: null,
    date_piece: '2026-03-14', tiers: 'CLIENT FICTIF SAS', montant_ht: 1000, montant_tva: 200,
    montant_ttc: 1200, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'a_valider', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2026-03-14T09:00:00Z', updated_at: '2026-03-14T09:00:00Z', ...o,
  }
}

const relirePiece = vi.fn<(id: string) => Promise<string | null>>()
const relireLesFactures = vi.fn<() => Promise<void>>()
let confirmation: ReturnType<typeof vi.spyOn>

function donnees(o: Partial<DonneesExemplaire> = {}): DonneesExemplaire {
  return {
    factures: { lignes: FACTURES, complete: true, motif: null },
    relireLesFactures, anneeFigeante: null, gelIncomplet: null, relirePiece, ...o,
  }
}

function monter(p: Piece, o: Partial<DonneesExemplaire> = {}, autresPieces: readonly string[] | null = null) {
  return render(<ExemplaireDeLaFacture dossierId={D} piece={p} donnees={donnees(o)} autresPieces={autresPieces} />)
}

const choix = () => screen.getByLabelText('Facture dont cette pièce est l’exemplaire') as HTMLSelectElement
const designer = () => screen.getByRole('button', { name: 'Désigner comme exemplaire' }) as HTMLButtonElement
const defaire = () => screen.getByRole('button', { name: 'Défaire la désignation' }) as HTMLButtonElement
const aucunGeste = () => {
  expect(screen.queryByRole('button', { name: 'Désigner comme exemplaire' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Défaire la désignation' })).toBeNull()
  expect(screen.queryByLabelText('Facture dont cette pièce est l’exemplaire')).toBeNull()
}

beforeEach(() => {
  faux.rpcs = []
  faux.reponse = { error: null }
  faux.retenirRpc = false
  faux.libererRpc = null
  relirePiece.mockReset().mockResolvedValue(null)
  relireLesFactures.mockReset().mockResolvedValue(undefined)
  confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ExemplaireDeLaFacture — ce qui n’est jamais offert', () => {
  it('une pièce qui n’est pas une vente et que rien ne désigne n’a pas de section', () => {
    for (const type_piece of ['achat', 'note_frais', 'autre'] as const) {
      const { container } = monter(piece({ type_piece }))
      expect(container.textContent, type_piece).toBe('')
      cleanup()
    }
  })

  it('factures pas encore revenues : la lecture se dit, aucun geste', () => {
    monter(piece(), { factures: null })
    expect(screen.getByText('Lecture des factures émises du dossier…')).toBeTruthy()
    aucunGeste()
  })

  it('factures lues en partie : le motif se dit, la lecture se refait sur un clic, aucun geste', async () => {
    monter(piece(), { factures: { lignes: FACTURES, complete: false, motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' } })
    expect(screen.getByText(/^Les factures émises du dossier n’ont pas pu être lues en entier \(1 ligne\(s\) lue\(s\) sur 2 annoncée\(s\)\)/)).toBeTruthy()
    aucunGeste()
    await act(async () => { screen.getByRole('button', { name: 'Relire les factures' }).click() })
    expect(relireLesFactures).toHaveBeenCalledTimes(1)
    expect(faux.rpcs).toEqual([])
  })

  it('factures refusées : la même chose, même pour une pièce déjà désignée', () => {
    monter(piece({ facture_id: 'f1' }), { factures: { lignes: [], complete: false, motif: 'lecture interrompue après 0 ligne(s) : accès refusé' } })
    expect(screen.getByText(/accès refusé/)).toBeTruthy()
    aucunGeste()
  })

  it('écritures validées lues en partie : on ne sait pas si la pièce est figée, aucun geste ni refus inventé', () => {
    monter(piece(), { gelIncomplet: '1 ligne(s) lue(s) sur 3 annoncée(s)' })
    expect(screen.getByText(/faute de savoir si un exercice validé fige cette pièce, sa désignation ne se pose ni ne se défait d’ici/)).toBeTruthy()
    aucunGeste()
    cleanup()
    monter(piece({ facture_id: 'f1' }), { gelIncomplet: '1 ligne(s) lue(s) sur 3 annoncée(s)' })
    expect(screen.getByText(/faute de savoir si un exercice validé fige cette pièce/)).toBeTruthy()
    aucunGeste()
  })

  it('une pièce figée par un exercice validé le dit sous les mots de la base, avant tout clic, sans rien proposer', () => {
    const attendu = remplirModele(REFUS_DESIGNATION.find((r) => r.cle === 'piece_figee')?.modele ?? '', ['2025'])
    monter(piece(), { anneeFigeante: 2025 })
    expect(attendu).toBe("Cette pièce porte une écriture validée de l'exercice 2025 : sa désignation ne change plus.")
    expect(screen.getByText(attendu)).toBeTruthy()
    aucunGeste()
  })

  it('une pièce désignée et figée : le retrait est refusé avant le clic, sous les mots de la base', () => {
    const attendu = remplirModele(REFUS_RETRAIT_DESIGNATION.find((r) => r.cle === 'piece_figee')?.modele ?? '', ['2025'])
    monter(piece({ facture_id: 'f1' }), { anneeFigeante: 2025 })
    expect(screen.getByText(attendu)).toBeTruthy()
    expect(screen.getByText(/Cette pièce est désignée comme l’exemplaire de la facture F2026-0007\./)).toBeTruthy()
    aucunGeste()
  })

  it('un dossier sans facture validée : rien à désigner, et c’est dit d’une liste lue en entier', () => {
    monter(piece(), { factures: { lignes: [], complete: true, motif: null } })
    expect(screen.getByText('Ce dossier n’a aucune facture émise validée : il n’y a rien à désigner.')).toBeTruthy()
    aucunGeste()
  })

  it('une pièce désignée à une facture que la liste lue ne contient pas : le numéro n’est pas inventé, la désignation ne se défait pas', () => {
    monter(piece({ facture_id: 'f-inconnue' }))
    expect(screen.getByText(/désignée comme l’exemplaire d’une facture émise que la liste lue ne contient pas/)).toBeTruthy()
    aucunGeste()
  })
})

describe('ExemplaireDeLaFacture — désigner', () => {
  it('le choix liste les factures et les avoirs validés, sans en choisir aucun d’avance ; rien ne part sans choix', () => {
    monter(piece())
    expect([...choix().options].map((o) => o.textContent)).toEqual([
      '— Choisir la facture —',
      `Facture F2026-0007 — 14/03/2026 — CLIENT FICTIF SAS — ${formatMoney(1200)}`,
      `Avoir A2026-0001 — 02/04/2026 — CLIENT FICTIF SAS — ${formatMoney(-300)}`,
    ])
    expect(choix().value).toBe('')
    expect(designer().disabled).toBe(true)
    fireEvent.click(designer())
    expect(faux.rpcs).toEqual([])
  })

  it('la confirmation NOMME la pièce et la facture (numéro, client, montant TTC), puis un seul appel, aux arguments de la base', async () => {
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain('la facture F2026-0007')
    expect(texte).toContain('CLIENT FICTIF SAS')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
    expect(faux.rpcs).toEqual([{ nom: 'designer_exemplaire_facture', args: argumentsDeLaDesignation(D, 'p1', 'f1') }])
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1', p_facture_id: 'f1' })
    // La pièce est relue, puis le choix est vidé.
    expect(relirePiece).toHaveBeenCalledWith('p1')
    expect(choix().value).toBe('')
  })

  it('un avoir se désigne comme une facture, et la confirmation le nomme avoir', async () => {
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'a1' } })
    await act(async () => { designer().click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('l’avoir A2026-0001')
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1', p_facture_id: 'a1' })
  })

  it('refusée à la confirmation, rien ne part et rien n’est relu', async () => {
    confirmation.mockReturnValue(false)
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(faux.rpcs).toEqual([])
    expect(relirePiece).not.toHaveBeenCalled()
    expect(choix().value).toBe('f1')
  })

  it('trois clics dans le même rendu : un seul appel, et le verrou tient jusqu’après la relecture de la pièce', async () => {
    let finDeLaRelecture: (v: string | null) => void = () => {}
    relirePiece.mockReturnValue(new Promise((resolve) => { finDeLaRelecture = resolve }))
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    const bouton = designer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(confirmation).toHaveBeenCalledTimes(1)
    // L'appel est revenu, la relecture n'est pas revenue : le verrou tient, et le bouton se dit occupé.
    expect(relirePiece).toHaveBeenCalledTimes(1)
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Désignation…' })).toBeTruthy()
    // Relue, il se relâche : un nouveau choix peut partir.
    await act(async () => { finDeLaRelecture(null) })
    fireEvent.change(choix(), { target: { value: 'a1' } })
    relirePiece.mockResolvedValue(null)
    await act(async () => { designer().click() })
    expect(faux.rpcs).toHaveLength(2)
  })

  it('l’appel en attente : un second clic ne part pas non plus', async () => {
    faux.retenirRpc = true
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    await act(async () => { screen.getByRole('button', { name: 'Désignation…' }).click() })
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { faux.libererRpc?.() })
    expect(relirePiece).toHaveBeenCalledTimes(1)
  })

  it('un refus de la base se dit avec sa raison, la pièce est relue, et le verrou est relâché', async () => {
    faux.reponse = { error: { message: 'Cette pièce porte une écriture validée de l’exercice 2025 : sa désignation ne change plus.' } }
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(screen.getByText('Cette pièce porte une écriture validée de l’exercice 2025 : sa désignation ne change plus.')).toBeTruthy()
    expect(relirePiece).toHaveBeenCalledTimes(1)
    // Le choix n’est pas vidé sur un refus : le cabinet voit ce qui a été refusé, et le verrou est relâché.
    expect(choix().value).toBe('f1')
    await act(async () => { designer().click() })
    expect(faux.rpcs).toHaveLength(2)
  })

  it('la relecture de la pièce échoue : l’écran le dit, n’offre plus aucun geste, et la relit sur un clic', async () => {
    relirePiece.mockResolvedValueOnce('lecture refusée par la base')
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(screen.getAllByText(/La pièce n’a pas pu être relue après le dernier geste \(lecture refusée par la base\)/).length).toBeGreaterThan(0)
    aucunGeste()
    await act(async () => { screen.getByRole('button', { name: 'Relire la pièce' }).click() })
    expect(relirePiece).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/n’a pas pu être relue/)).toBeNull()
    expect(designer()).toBeTruthy()
  })
})

describe('ExemplaireDeLaFacture — défaire', () => {
  it('une pièce désignée dit sa facture (numéro, client, montant) et offre de défaire', () => {
    monter(piece({ facture_id: 'f1' }))
    expect(screen.getByText('F2026-0007')).toBeTruthy()
    expect(screen.getByText(/CLIENT FICTIF SAS, .* TTC, émise le 14\/03\/2026/).textContent).toContain(`${formatMoney(1200)} TTC`)
    expect(screen.getByText('Cette pièce est désignée comme l’exemplaire de la facture F2026-0007.')).toBeTruthy()
    expect(screen.queryByLabelText('Facture dont cette pièce est l’exemplaire')).toBeNull()
    expect(defaire()).toBeTruthy()
  })

  it('un avoir désigné se dit avoir', () => {
    monter(piece({ facture_id: 'a1' }))
    expect(screen.getByText('Cette pièce est désignée comme l’exemplaire de l’avoir A2026-0001.')).toBeTruthy()
  })

  it('la confirmation nomme la facture et dit que défaire ne change rien à ce qui se compte ; un seul appel aux arguments de la base', async () => {
    monter(piece({ facture_id: 'f1' }))
    await act(async () => { defaire().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('« vente-0007.pdf »')
    expect(texte).toContain('la facture F2026-0007')
    expect(texte).toContain('CLIENT FICTIF SAS')
    expect(texte).toContain(`${formatMoney(1200)} TTC`)
    expect(texte).toContain('Défaire ne change rien à ce qui se compte.')
    expect(texte).not.toContain('NE RETIRE PAS')
    expect(faux.rpcs).toEqual([{ nom: 'defaire_exemplaire_facture', args: argumentsDuRetraitDeLaDesignation(D, 'p1') }])
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1' })
    expect(relirePiece).toHaveBeenCalledWith('p1')
  })

  it('une vente comptée deux fois : la confirmation dit que défaire ne retire PAS le double compte, et nomme l’autre pièce', async () => {
    monter(piece({ facture_id: 'f1' }), {}, ['facture-0007.xml'])
    await act(async () => { defaire().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('« facture-0007.xml »')
    expect(texte).toContain('peut faire taire « Comptée deux fois »')
    expect(texte).toContain('NE RETIRE PAS le double compte : les deux pièces continuent de compter la vente')
    expect(texte).toContain('Il n’en faut garder qu’une par facture.')
  })

  it('refusée à la confirmation, rien ne part', async () => {
    confirmation.mockReturnValue(false)
    monter(piece({ facture_id: 'f1' }))
    await act(async () => { defaire().click() })
    expect(faux.rpcs).toEqual([])
    expect(relirePiece).not.toHaveBeenCalled()
  })

  it('trois clics dans le même rendu : un seul appel', async () => {
    monter(piece({ facture_id: 'f1' }))
    const bouton = defaire()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(confirmation).toHaveBeenCalledTimes(1)
  })

  it('un refus de la base se dit avec sa raison, la pièce est relue, le verrou relâché', async () => {
    faux.reponse = { error: { message: 'Cette pièce n’est l’exemplaire d’aucune facture.' } }
    monter(piece({ facture_id: 'f1' }))
    await act(async () => { defaire().click() })
    expect(screen.getByText('Cette pièce n’est l’exemplaire d’aucune facture.')).toBeTruthy()
    expect(relirePiece).toHaveBeenCalledTimes(1)
    await act(async () => { defaire().click() })
    expect(faux.rpcs).toHaveLength(2)
  })
})

// CE QUI SE COMPTE DÉPEND DE LA FACTURE (étape VF3b3). Les phrases sont dans le module (exemplairesDesFacturesEcran.test.ts) ;
// ce qui se joue ici est le CÂBLAGE : que l'écran passe à la confirmation la facture CHOISIE, telle que la liste lue la porte
// (`source_de_la_vente`), et montre le paragraphe des deux cas avant tout choix. Une facture source et une autre, côte à côte.
describe('ExemplaireDeLaFacture — ce qui se compte, selon la facture', () => {
  const SOURCE = facture({ id: 'fs', numero: 'F2026-0042', source_de_la_vente: true })
  const lues = { factures: { lignes: [...FACTURES, SOURCE], complete: true, motif: null } }

  it('avant tout choix, le paragraphe dit les deux cas', () => {
    monter(piece(), lues)
    expect(screen.getByText(/Pour une facture source de sa vente, la pièce désignée cesse de compter dans la 2035, la CA3, la situation intermédiaire et l’estimation/)).toBeTruthy()
    expect(screen.getByText(/Pour une autre facture, désigner ne change rien à ce qui se compte\./)).toBeTruthy()
    expect(screen.queryByText(/Désigner ne change rien à ce qui se compte aujourd’hui/)).toBeNull()
  })

  it('la facture source choisie : la confirmation dit que la pièce cessera de compter', async () => {
    monter(piece(), lues)
    fireEvent.change(choix(), { target: { value: 'fs' } })
    await act(async () => { designer().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('La facture F2026-0042 est la source de sa vente')
    expect(texte).toContain('la pièce cessera de compter')
    expect(texte).not.toContain('ne change rien')
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1', p_facture_id: 'fs' })
  })

  it('l’autre facture choisie, sur la même liste : rien ne change', async () => {
    monter(piece(), lues)
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('Désigner ne change rien à ce qui se compte aujourd’hui.')
    expect(texte).not.toContain('source')
  })

  it('l’exemplaire d’une facture source : la fiche dit qu’il ne compte pas, et défaire dit la vente comptée deux fois', async () => {
    monter(piece({ facture_id: 'fs' }), lues)
    expect(screen.getByText(/La facture F2026-0042 est la source de sa vente : cette pièce ne compte pas/)).toBeTruthy()
    await act(async () => { defaire().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('EN PLUS de la facture — la vente sera comptée deux fois.')
    expect(texte).not.toContain('ne change rien')
    // La base ne refuse rien de plus : confirmé, le retrait part.
    expect(faux.rpcs).toEqual([{ nom: 'defaire_exemplaire_facture', args: argumentsDuRetraitDeLaDesignation(D, 'p1') }])
  })

  it('l’exemplaire d’une facture qui n’est pas source : la fiche n’en dit rien de plus, et défaire ne change rien', async () => {
    monter(piece({ facture_id: 'f1' }), lues)
    expect(screen.getByText('Cette pièce est désignée comme l’exemplaire de la facture F2026-0007.')).toBeTruthy()
    expect(screen.queryByText(/ne compte pas/)).toBeNull()
    await act(async () => { defaire().click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('Défaire ne change rien à ce qui se compte.')
  })
})
