import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExemplaireDeLaFacture, { type CeQueLaFicheSait, type DonneesExemplaire } from './ExemplaireDeLaFacture'
import {
  argumentsDeLaDeclaration, argumentsDeLaDesignation, argumentsDuRetraitDeLaDeclaration, argumentsDuRetraitDeLaDesignation,
  REFUS_DECLARATION, REFUS_DESIGNATION, REFUS_DESIGNATION_JUMELLE, REFUS_RETRAIT_DECLARATION, REFUS_RETRAIT_DESIGNATION,
  REFUS_RETRAIT_DESIGNATION_JUMELLE,
} from '../../lib/exemplairesDesFactures'
import { remplirModele } from '../../lib/encaissementsFactures'
import { formatMoney } from '../../lib/format'
import type { FactureProposee } from '../../lib/exemplairesDesFacturesLecture'
import {
  CONTEXTE_D_UN_DOSSIER_NON_BASCULE, type ContexteLu, type EquipeLue, type LectureDeCeQueLaPieceEst, type LectureDuJournal,
  type LigneDuJournal,
} from '../../lib/marquesDeLaPiece'
import type { Piece } from '../../lib/types'

// CE QUE CETTE PIÈCE EST, DANS LA FICHE D'UNE PIÈCE DE VENTE (ligne 28.6 : étapes VF1b et VF6c). Ce que ces cas gardent, et
// qu'aucun test de `src/lib` ne voit parce que tout vit dans le câblage : rien n'est offert sur une liste pas encore revenue,
// lue en partie, ou quand on ne sait pas si la pièce est figée ; le refus de la base dit AVANT le clic, sous ses mots ; la
// confirmation NOMME la pièce et la facture ; un seul appel pour plusieurs clics, et le verrou tenu jusqu'après la relecture de
// la pièce ; une erreur de la base dite, et le verrou relâché ; dans un dossier basculé, la déclaration, son retrait, le
// remplacement d'un seul geste (VF6-Q1) ; le journal, et ce qui est resté ailleurs (VF6B-Q1).
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
    vente_hors_des_factures: false, created_at: '2026-03-14T09:00:00Z', updated_at: '2026-03-14T09:00:00Z', ...o,
  }
}

const JOURNAL_VIDE: LectureDuJournal = { etat: 'lu', lignes: [], nomsDesAutresDossiers: new Map() }
function lecture(
  contexte: Partial<ContexteLu> = {}, journal: LectureDuJournal | null = JOURNAL_VIDE, equipe: EquipeLue | null = null,
): LectureDeCeQueLaPieceEst {
  return { pour: 'p1', contexte: { etat: 'lu', contexte: { ...CONTEXTE_D_UN_DOSSIER_NON_BASCULE, ...contexte } }, journal, equipe }
}
const BASCULE: Partial<ContexteLu> = { dossierBascule: true }

const relirePiece = vi.fn<(id: string) => Promise<string | null>>()
const relireLesFactures = vi.fn<() => Promise<void>>()
const apresUnGeste = vi.fn<() => Promise<string | null>>()
const relire = vi.fn<() => Promise<void>>()
let confirmation: ReturnType<typeof vi.spyOn>

function donnees(o: Partial<DonneesExemplaire> = {}): DonneesExemplaire {
  return {
    factures: { lignes: FACTURES, complete: true, motif: null },
    relireLesFactures, anneeFigeante: null, gelIncomplet: null, relirePiece, ...o,
  }
}

function monter(
  p: Piece, o: Partial<DonneesExemplaire> = {}, autresPieces: readonly string[] | null = null,
  sait: Partial<CeQueLaFicheSait> = {},
) {
  const ceQuElleEst: CeQueLaFicheSait = { lecture: lecture(), relire, apresUnGeste, moi: 'u1', ...sait }
  return render(<ExemplaireDeLaFacture dossierId={D} piece={p} donnees={donnees(o)} ceQuElleEst={ceQuElleEst} autresPieces={autresPieces} />)
}
const monterBascule = (p: Piece, contexte: Partial<ContexteLu> = {}, o: Partial<DonneesExemplaire> = {}) =>
  monter(p, o, null, { lecture: lecture({ ...BASCULE, ...contexte }) })

const choix = () => screen.getByRole('combobox') as HTMLSelectElement
const designer = () => screen.getByRole('button', { name: /^Désigner (comme exemplaire|cette facture à la place)$/ }) as HTMLButtonElement
const defaire = () => screen.getByRole('button', { name: 'Défaire la désignation' }) as HTMLButtonElement
const declarer = () => screen.getByRole('button', { name: 'Déclarer vente hors des factures de l’application' }) as HTMLButtonElement
const retirer = () => screen.getByRole('button', { name: 'Retirer la déclaration' }) as HTMLButtonElement
const GESTES = /^(Désigner|Défaire|Déclarer|Retirer la déclaration)/
const aucunGeste = () => {
  expect(screen.queryAllByRole('button').filter((b) => GESTES.test(b.textContent ?? ''))).toEqual([])
  expect(screen.queryByRole('combobox')).toBeNull()
}
const message = (liste: readonly { cle: string; modele: string }[], cle: string, ...valeurs: string[]) =>
  remplirModele(liste.find((r) => r.cle === cle)?.modele ?? `(${cle} introuvable)`, valeurs)

beforeEach(() => {
  faux.rpcs = []
  faux.reponse = { error: null }
  faux.retenirRpc = false
  faux.libererRpc = null
  relirePiece.mockReset().mockResolvedValue(null)
  relireLesFactures.mockReset().mockResolvedValue(undefined)
  apresUnGeste.mockReset().mockResolvedValue(null)
  relire.mockReset().mockResolvedValue(undefined)
  confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Ce que cette pièce est — ce qui n’est jamais offert', () => {
  it('une pièce qui n’est pas une vente et que rien ne marque n’a pas de section', () => {
    for (const type_piece of ['achat', 'note_frais', 'autre'] as const) {
      const { container } = monter(piece({ type_piece }))
      expect(container.textContent, type_piece).toBe('')
      cleanup()
    }
  })

  it('une pièce déclarée qui n’est plus une vente garde sa section : la marque se dit', () => {
    monter(piece({ type_piece: 'achat', vente_hors_des_factures: true }))
    expect(screen.getByText(/Cette pièce est déclarée vente hors des factures de l’application/)).toBeTruthy()
  })

  it('factures pas encore revenues : la lecture se dit, aucun geste', () => {
    monter(piece(), { factures: null })
    expect(screen.getByText('Lecture des factures émises du dossier…')).toBeTruthy()
    aucunGeste()
  })

  it('ce que la pièce est, pas encore lu — ou lu pour une autre pièce : la lecture se dit, aucun geste, rien d’affirmé', () => {
    monter(piece(), {}, null, { lecture: null })
    expect(screen.getByText('Lecture de ce que la pièce est et de son journal…')).toBeTruthy()
    aucunGeste()
    expect(document.body.textContent).not.toMatch(/Aucun|aucune/)
    cleanup()
    monter(piece(), {}, null, { lecture: { ...lecture(), pour: 'p2' } })
    expect(screen.getByText('Lecture de ce que la pièce est et de son journal…')).toBeTruthy()
    aucunGeste()
  })

  it('ce que la pièce est, lu en partie : le motif se dit, aucun geste, et la lecture se refait sur un clic', async () => {
    monter(piece(), {}, null, { lecture: { ...lecture(), contexte: { etat: 'incomplet', motif: 'les écritures : refusée' } } })
    expect(screen.getByText(/n’a pas pu être lu en entier \(les écritures : refusée\) : elle ne se désigne, ne se déclare ni ne se défait d’ici/)).toBeTruthy()
    aucunGeste()
    await act(async () => { screen.getByRole('button', { name: 'Relire' }).click() })
    expect(relire).toHaveBeenCalledTimes(1)
    expect(faux.rpcs).toEqual([])
  })

  it('factures lues en partie : le motif se dit, la lecture se refait sur un clic, aucun geste', async () => {
    monter(piece(), { factures: { lignes: FACTURES, complete: false, motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' } })
    expect(screen.getByText(/^Les factures émises du dossier n’ont pas pu être lues en entier \(1 ligne\(s\) lue\(s\) sur 2 annoncée\(s\)\)/)).toBeTruthy()
    aucunGeste()
    await act(async () => { screen.getByRole('button', { name: 'Relire les factures' }).click() })
    expect(relireLesFactures).toHaveBeenCalledTimes(1)
    expect(faux.rpcs).toEqual([])
  })

  it('factures refusées : la même chose, même pour une pièce déjà désignée ou déclarée', () => {
    for (const p of [piece({ facture_id: 'f1' }), piece({ vente_hors_des_factures: true })]) {
      monter(p, { factures: { lignes: [], complete: false, motif: 'lecture interrompue après 0 ligne(s) : accès refusé' } })
      expect(screen.getByText(/accès refusé/)).toBeTruthy()
      aucunGeste()
      cleanup()
    }
  })

  it('écritures validées lues en partie : on ne sait pas si la pièce est figée, aucun geste ni refus inventé', () => {
    for (const p of [piece(), piece({ facture_id: 'f1' })]) {
      monter(p, { gelIncomplet: '1 ligne(s) lue(s) sur 3 annoncée(s)' })
      expect(screen.getByText(/faute de savoir si un exercice validé fige cette pièce, sa marque ne change pas d’ici/)).toBeTruthy()
      aucunGeste()
      cleanup()
    }
    monterBascule(piece({ vente_hors_des_factures: true }), {}, { gelIncomplet: 'refusée' })
    aucunGeste()
  })

  it('une pièce figée par un exercice validé le dit sous les mots de la base, avant tout clic, sans rien proposer', () => {
    const attendu = message(REFUS_DESIGNATION, 'piece_figee', '2025')
    monter(piece(), { anneeFigeante: 2025 })
    expect(attendu).toBe("Cette pièce porte une écriture validée de l'exercice 2025 : sa désignation ne change plus.")
    expect(screen.getByText(attendu)).toBeTruthy()
    aucunGeste()
  })

  it('une pièce désignée et figée : le retrait est refusé avant le clic, sous les mots de la base', () => {
    const attendu = message(REFUS_RETRAIT_DESIGNATION, 'piece_figee', '2025')
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

  it('une pièce désignée à une facture que la liste lue ne contient pas : le numéro n’est pas inventé, sa marque ne change pas d’ici', () => {
    monter(piece({ facture_id: 'f-inconnue' }))
    expect(screen.getByText(/désignée comme l’exemplaire d’une facture émise que la liste lue ne contient pas/)).toBeTruthy()
    aucunGeste()
  })

  it('hors d’un dossier basculé, la déclaration n’est pas offerte, et son refus ne se dit pas', () => {
    monter(piece())
    expect(screen.queryByRole('button', { name: /Déclarer/ })).toBeNull()
    expect(screen.queryByText(/ne se déclare hors des factures de l’application que dans un dossier/)).toBeNull()
  })
})

describe('Ce que cette pièce est — désigner', () => {
  it('le choix liste les factures et les avoirs validés, sans en choisir aucun d’avance ; rien ne part sans choix', () => {
    monter(piece())
    expect(screen.getByLabelText('Facture dont cette pièce est l’exemplaire')).toBe(choix())
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
    expect(texte).not.toContain('remplacée d’un seul geste')
    expect(faux.rpcs).toEqual([{ nom: 'designer_exemplaire_facture', args: argumentsDeLaDesignation(D, 'p1', 'f1') }])
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1', p_facture_id: 'f1' })
    // La pièce est relue (sa marque, sa ligne, ce qu'elle est), puis le choix est vidé.
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
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
    expect(apresUnGeste).not.toHaveBeenCalled()
    expect(choix().value).toBe('f1')
  })

  it('deux, puis trois clics dans le même rendu : un seul appel, et le verrou tient jusqu’après la relecture de la pièce', async () => {
    let finDeLaRelecture: (v: string | null) => void = () => {}
    apresUnGeste.mockReturnValue(new Promise((resolve) => { finDeLaRelecture = resolve }))
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    const bouton = designer()
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(confirmation).toHaveBeenCalledTimes(1)
    // L'appel est revenu, la relecture n'est pas revenue : le verrou tient, et le bouton se dit occupé.
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Désignation…' })).toBeTruthy()
    // Relue, il se relâche : un nouveau choix peut partir.
    await act(async () => { finDeLaRelecture(null) })
    fireEvent.change(choix(), { target: { value: 'a1' } })
    apresUnGeste.mockResolvedValue(null)
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
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
  })

  it('un refus de la base se dit avec sa raison, la pièce est relue, et le verrou est relâché', async () => {
    faux.reponse = { error: { message: 'Cette pièce porte une écriture validée de l’exercice 2025 : sa désignation ne change plus.' } }
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(screen.getByText('Cette pièce porte une écriture validée de l’exercice 2025 : sa désignation ne change plus.')).toBeTruthy()
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
    // Le choix n’est pas vidé sur un refus : le cabinet voit ce qui a été refusé, et le verrou est relâché.
    expect(choix().value).toBe('f1')
    await act(async () => { designer().click() })
    expect(faux.rpcs).toHaveLength(2)
  })

  it('la relecture de la pièce échoue : l’écran le dit, n’offre plus aucun geste, et la relit sur un clic', async () => {
    apresUnGeste.mockResolvedValueOnce('lecture refusée par la base')
    monter(piece())
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(screen.getAllByText(/La pièce n’a pas pu être relue après le dernier geste \(lecture refusée par la base\)/).length).toBeGreaterThan(0)
    aucunGeste()
    await act(async () => { screen.getByRole('button', { name: 'Relire la pièce' }).click() })
    expect(apresUnGeste).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/n’a pas pu être relue/)).toBeNull()
    expect(designer()).toBeTruthy()
  })
})

describe('Ce que cette pièce est — défaire', () => {
  it('une pièce désignée dit sa facture (numéro, client, montant) et offre de défaire, et d’en désigner une autre', () => {
    monter(piece({ facture_id: 'f1' }))
    expect(screen.getByText('F2026-0007')).toBeTruthy()
    expect(screen.getByText(/CLIENT FICTIF SAS, .* TTC, émise le 14\/03\/2026/).textContent).toContain(`${formatMoney(1200)} TTC`)
    expect(screen.getByText('Cette pièce est désignée comme l’exemplaire de la facture F2026-0007.')).toBeTruthy()
    expect(screen.getByLabelText('Désigner une autre facture à la place')).toBe(choix())
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
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
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
    expect(apresUnGeste).not.toHaveBeenCalled()
  })

  it('deux, puis trois clics dans le même rendu : un seul appel', async () => {
    faux.retenirRpc = true
    monter(piece({ facture_id: 'f1' }))
    const bouton = defaire()
    await act(async () => { bouton.click(); bouton.click() })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(confirmation).toHaveBeenCalledTimes(1)
    await act(async () => { faux.libererRpc?.() })
  })

  it('un refus de la base se dit avec sa raison, la pièce est relue, le verrou relâché', async () => {
    faux.reponse = { error: { message: 'Cette pièce n’est l’exemplaire d’aucune facture.' } }
    monter(piece({ facture_id: 'f1' }))
    await act(async () => { defaire().click() })
    expect(screen.getByText('Cette pièce n’est l’exemplaire d’aucune facture.')).toBeTruthy()
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
    await act(async () => { defaire().click() })
    expect(faux.rpcs).toHaveLength(2)
  })
})

// CE QUI SE COMPTE DÉPEND DE LA FACTURE (étape VF3b3). Les phrases sont dans le module (exemplairesDesFacturesEcran.test.ts) ;
// ce qui se joue ici est le CÂBLAGE : que l'écran passe à la confirmation la facture CHOISIE, telle que la liste lue la porte
// (`source_de_la_vente`), et montre le paragraphe des deux cas avant tout choix. Une facture source et une autre, côte à côte.
describe('Ce que cette pièce est — ce qui se compte, selon la facture', () => {
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

// LE REMPLACEMENT D'UN SEUL GESTE (VF6-Q1) : la confirmation nomme ce que la pièce quitte ; la base remplace, une seule
// fonction part. Dans les deux sortes de dossiers.
describe('Ce que cette pièce est — remplacer une désignation', () => {
  for (const [nom, monterIci] of [['hors d’un dossier basculé', monter], ['dans un dossier basculé', monterBascule]] as const) {
    it(`${nom} : désigner une autre facture nomme la facture quittée, et un seul appel part`, async () => {
      monterIci(piece({ facture_id: 'f1' }))
      fireEvent.change(choix(), { target: { value: 'a1' } })
      await act(async () => { designer().click() })
      const texte = String(confirmation.mock.calls[0][0])
      expect(texte).toContain('comme l’exemplaire de l’avoir A2026-0001')
      expect(texte).toContain('Elle ne sera plus l’exemplaire de la facture F2026-0007')
      expect(texte).toContain('la désignation est remplacée d’un seul geste')
      expect(faux.rpcs).toEqual([{ nom: 'designer_exemplaire_facture', args: argumentsDeLaDesignation(D, 'p1', 'a1') }])
    })

    it(`${nom} : la même facture choisie, le refus de la base se dit avant le clic`, () => {
      monterIci(piece({ facture_id: 'f1' }))
      fireEvent.change(choix(), { target: { value: 'f1' } })
      expect(screen.getByText(message(REFUS_DESIGNATION_JUMELLE, 'deja_cette_facture', 'F2026-0007'))).toBeTruthy()
      expect(designer().disabled).toBe(true)
      fireEvent.click(designer())
      expect(faux.rpcs).toEqual([])
    })
  }

  it('le bouton dit le remplacement', () => {
    monter(piece({ facture_id: 'f1' }))
    expect(screen.getByRole('button', { name: 'Désigner cette facture à la place' })).toBeTruthy()
  })
})

describe('Ce que cette pièce est — dans un dossier basculé', () => {
  it('le paragraphe dit les deux marques que la validation attend, et la déclaration est offerte', () => {
    monterBascule(piece())
    expect(screen.getByText(/une pièce de vente se valide désignée exemplaire de sa facture, ou déclarée vente hors des factures de l’application/)).toBeTruthy()
    expect(screen.queryByText(/Pour une autre facture, désigner ne change rien/)).toBeNull()
    expect(declarer().disabled).toBe(false)
  })

  it('déclarer : la confirmation NOMME la pièce et dit ce qui se compte ; un seul appel aux arguments de la base ; relue', async () => {
    monterBascule(piece())
    await act(async () => { declarer().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('Déclarer la pièce « vente-0007.pdf » vente hors des factures de l’application ?')
    expect(texte).toContain('et si c’était le PDF d’une facture de l’application, la vente compterait deux fois')
    expect(faux.rpcs).toEqual([{ nom: 'declarer_vente_hors_des_factures', args: argumentsDeLaDeclaration(D, 'p1') }])
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1' })
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
  })

  it('déclarer une pièce désignée : la désignation remplacée, la facture nommée', async () => {
    monterBascule(piece({ facture_id: 'f1' }))
    await act(async () => { declarer().click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('Elle ne sera plus l’exemplaire de la facture F2026-0007')
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['declarer_vente_hors_des_factures'])
  })

  it('déclarer : refusée à la confirmation, rien ne part ; deux puis trois clics, un seul appel ; un refus de la base dit', async () => {
    confirmation.mockReturnValue(false)
    monterBascule(piece())
    await act(async () => { declarer().click() })
    expect(faux.rpcs).toEqual([])
    cleanup()
    confirmation.mockReturnValue(true)
    faux.retenirRpc = true
    monterBascule(piece())
    const bouton = declarer()
    await act(async () => { bouton.click(); bouton.click() })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Déclaration…' })).toBeTruthy()
    faux.reponse = { error: { message: 'Cette pièce est déjà déclarée vente hors des factures de l’application.' } }
    await act(async () => { faux.libererRpc?.() })
    expect(screen.getByText('Cette pièce est déjà déclarée vente hors des factures de l’application.')).toBeTruthy()
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
  })

  it('le pont qui prouve une facture : le refus de la déclaration la NOMME avant le clic ; aucune facture choisie d’avance ; une autre refusée', () => {
    monterBascule(piece(), { pont: { genre: 'une', factureId: 'f1' } })
    expect(screen.getByText(message(REFUS_DECLARATION, 'pont_une_facture', 'F2026-0007'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déclarer/ })).toBeNull()
    expect(choix().value).toBe('')
    fireEvent.change(choix(), { target: { value: 'a1' } })
    expect(screen.getByText(message(REFUS_DESIGNATION_JUMELLE, 'pont_autre_facture', 'F2026-0007'))).toBeTruthy()
    expect(designer().disabled).toBe(true)
    fireEvent.change(choix(), { target: { value: 'f1' } })
    expect(designer().disabled).toBe(false)
  })

  it('désignée à la facture que le pont prouve : ni la déclaration ni son refus — la pièce est ce que le pont dit', () => {
    monterBascule(piece({ facture_id: 'f1' }), { pont: { genre: 'une', factureId: 'f1' } })
    expect(screen.getByText('Cette pièce est désignée comme l’exemplaire de la facture F2026-0007.')).toBeTruthy()
    expect(screen.queryByText(message(REFUS_DECLARATION, 'pont_une_facture', 'F2026-0007'))).toBeNull()
    expect(screen.queryByRole('button', { name: /Déclarer/ })).toBeNull()
    expect(defaire()).toBeTruthy()
  })

  it('des preuves qui se contredisent : ni déclarée, ni désignée, et la base le dit avant le clic (VF6-Q5)', () => {
    monterBascule(piece(), { pont: { genre: 'contraires' } })
    expect(screen.getByText(message(REFUS_DECLARATION, 'preuves_contraires'))).toBeTruthy()
    fireEvent.change(choix(), { target: { value: 'f1' } })
    expect(screen.getByText(message(REFUS_DESIGNATION_JUMELLE, 'preuves_contraires'))).toBeTruthy()
    expect(designer().disabled).toBe(true)
  })

  it('l’exemplaire d’une facture source ne se lie à rien (G4) : une pièce rapprochée ne s’y désigne pas, dit avant le clic', () => {
    const SOURCE = facture({ id: 'fs', numero: 'F2026-0042', source_de_la_vente: true })
    monterBascule(piece(), { liens: { rapprochee: true, reglee: false, ecrite: false, lettree: false } },
      { factures: { lignes: [...FACTURES, SOURCE], complete: true, motif: null } })
    fireEvent.change(choix(), { target: { value: 'fs' } })
    expect(screen.getByText(message(REFUS_DESIGNATION_JUMELLE, 'rapprochee', 'F2026-0042'))).toBeTruthy()
    expect(designer().disabled).toBe(true)
    // Une facture qui n'est pas source s'y désigne : G4 ne la regarde pas.
    fireEvent.change(choix(), { target: { value: 'f1' } })
    expect(designer().disabled).toBe(false)
  })

  it('le virement mixte classé (VF5H-Q1) : une pièce désignée ne quitte pas sa facture d’avant, dit avant le clic', () => {
    monterBascule(piece({ facture_id: 'f1' }), { facturesDuVirementMixte: new Set(['f1']) })
    expect(screen.getByText(message(REFUS_RETRAIT_DESIGNATION_JUMELLE, 'virement_mixte', 'F2026-0007'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Défaire la désignation' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Déclarer/ })).toBeNull()
  })

  it('une pièce désignée VALIDÉE ne se défait pas (VF6-Q1) : le refus dit de désigner l’autre facture, ou de la déclarer', async () => {
    monterBascule(piece({ facture_id: 'f1', statut: 'validee' }))
    expect(screen.getByText(message(REFUS_RETRAIT_DESIGNATION_JUMELLE, 'validee_dans_un_dossier_bascule'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Défaire la désignation' })).toBeNull()
    // Elle se REMPLACE : par une autre facture, ou par la déclaration.
    expect(screen.getByRole('button', { name: 'Désigner cette facture à la place' })).toBeTruthy()
    await act(async () => { declarer().click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['declarer_vente_hors_des_factures'])
  })

  it('une pièce désignée à valider se défait, et la confirmation dit qu’elle ne se validera qu’à nouveau marquée', async () => {
    monterBascule(piece({ facture_id: 'f1' }))
    await act(async () => { defaire().click() })
    const texte = String(confirmation.mock.calls[0][0])
    expect(texte).toContain('Elle est à valider, et ne compte pas encore.')
    expect(faux.rpcs).toEqual([{ nom: 'defaire_exemplaire_facture', args: argumentsDuRetraitDeLaDesignation(D, 'p1') }])
  })

  it('une pièce déclarée : la marque se dit, elle se remplace par une désignation, et la déclaration se retire', async () => {
    monterBascule(piece({ vente_hors_des_factures: true }))
    expect(screen.getByText(/Cette pièce est déclarée vente hors des factures de l’application : aucune facture validée/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Déclarer/ })).toBeNull()
    expect(retirer()).toBeTruthy()
    fireEvent.change(choix(), { target: { value: 'f1' } })
    await act(async () => { designer().click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('Elle ne sera plus déclarée vente hors des factures de l’application')
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['designer_exemplaire_facture'])
  })

  it('retirer la déclaration : la confirmation nomme la pièce ; un seul appel aux arguments de la base ; deux puis trois clics', async () => {
    faux.retenirRpc = true
    monterBascule(piece({ vente_hors_des_factures: true }))
    const bouton = retirer()
    await act(async () => { bouton.click(); bouton.click() })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(String(confirmation.mock.calls[0][0])).toContain('Retirer la déclaration : la pièce « vente-0007.pdf »')
    expect(faux.rpcs).toEqual([{ nom: 'retirer_declaration_hors_des_factures', args: argumentsDuRetraitDeLaDeclaration(D, 'p1') }])
    expect(faux.rpcs[0].args).toEqual({ p_dossier_id: D, p_piece_id: 'p1' })
    await act(async () => { faux.libererRpc?.() })
    expect(apresUnGeste).toHaveBeenCalledTimes(1)
  })

  it('retirer : refusée à la confirmation, rien ne part ; un refus de la base dit, le verrou relâché', async () => {
    confirmation.mockReturnValue(false)
    monterBascule(piece({ vente_hors_des_factures: true }))
    await act(async () => { retirer().click() })
    expect(faux.rpcs).toEqual([])
    confirmation.mockReturnValue(true)
    faux.reponse = { error: { message: 'refus fictif de la base' } }
    await act(async () => { retirer().click() })
    expect(screen.getByText('refus fictif de la base')).toBeTruthy()
    await act(async () => { retirer().click() })
    expect(faux.rpcs).toHaveLength(2)
  })

  it('une pièce déclarée VALIDÉE ne perd pas sa déclaration : le refus se dit, sans bouton', () => {
    monterBascule(piece({ vente_hors_des_factures: true, statut: 'validee' }))
    expect(screen.getByText(message(REFUS_RETRAIT_DECLARATION, 'validee_dans_un_dossier_bascule'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retirer la déclaration' })).toBeNull()
  })

  it('une pièce déclarée figée : ni le retrait ni le remplacement', () => {
    monterBascule(piece({ vente_hors_des_factures: true }), {}, { anneeFigeante: 2025 })
    expect(screen.getByText(message(REFUS_RETRAIT_DECLARATION, 'piece_figee', '2025'))).toBeTruthy()
    aucunGeste()
  })

  it('une pièce déclarée hors d’un dossier basculé : la déclaration n’y dit rien, et se retire', async () => {
    monter(piece({ vente_hors_des_factures: true }))
    expect(screen.getByText(/la déclaration n’y change rien/)).toBeTruthy()
    await act(async () => { retirer().click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('la déclaration n’y disait rien')
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['retirer_declaration_hors_des_factures'])
  })
})

describe('Ce que cette pièce est — le journal', () => {
  const ligne = (o: Partial<LigneDuJournal> & Pick<LigneDuJournal, 'id'>): LigneDuJournal => ({
    dossier_id: D, piece_id: 'p1', geste: 'designation', facture_id: 'f1', auteur_id: 'u1', fait_le: '2026-10-24T10:00:00Z', ...o,
  })
  const equipe: EquipeLue = { etat: 'lue', courriels: new Map([['u2', 'collegue@cabinet-fictif.fr']]) }
  const journal = (lignes: LigneDuJournal[], noms: ReadonlyMap<string, string> | null = new Map()): LectureDuJournal =>
    ({ etat: 'lu', lignes, nomsDesAutresDossiers: noms })

  it('lu en entier et vide : il le dit', () => {
    monter(piece())
    expect(screen.getByText('Aucun geste de ce dossier n’est inscrit au journal de cette pièce.')).toBeTruthy()
  })

  it('chaque geste, dans l’ordre, qui l’a fait — « vous », une adresse lue, « un autre compte » — et quand', () => {
    monter(piece({ facture_id: 'a1' }), {}, null, {
      lecture: lecture({}, journal([
        // Des instants qui tombent le 24 octobre dans les quatre fuseaux de `test:fuseaux` (Auckland à +13 h, New York à −4 h) :
        // le jour d'un geste est celui de qui le regarde.
        ligne({ id: 'j3', geste: 'designation', facture_id: 'a1', auteur_id: 'u9', fait_le: '2026-10-24T09:00:00Z' }),
        ligne({ id: 'j1', auteur_id: 'u1', fait_le: '2026-10-24T08:00:00Z' }),
        ligne({ id: 'j2', geste: 'retrait_designation', auteur_id: 'u2', fait_le: '2026-10-24T09:00:00Z' }),
      ]), equipe),
    })
    const items = [...document.querySelectorAll('[aria-label="Journal de la pièce"] li')].map((l) => l.textContent)
    expect(items).toEqual([
      'Désignée exemplaire de la facture F2026-0007 — par vous, le 24/10/2026',
      'N’est plus l’exemplaire de la facture F2026-0007 — par collegue@cabinet-fictif.fr, le 24/10/2026',
      'Désignée exemplaire de l’avoir A2026-0001 — par un autre compte, le 24/10/2026',
    ])
    expect(screen.getByText('collegue@cabinet-fictif.fr').className).toBe('courriel')
  })

  it('l’équipe lue en partie : les auteurs ne se nomment pas, et c’est dit', () => {
    monter(piece(), {}, null, {
      lecture: lecture({}, journal([ligne({ id: 'j1', auteur_id: 'u2' })]), { etat: 'incomplete', motif: 'refusée' }),
    })
    expect(screen.getByText(/par un autre compte/)).toBeTruthy()
    expect(screen.getByText(/La liste de l’équipe n’a pas pu être lue en entier \(refusée\) : les auteurs ne se nomment pas\./)).toBeTruthy()
  })

  it('des gestes restés dans le dossier d’où la pièce vient (VF6B-Q1) : dits, le dossier nommé ; son nom illisible, « un autre dossier »', () => {
    const lignes = [ligne({ id: 'x1', dossier_id: 'ancien' }), ligne({ id: 'x2', dossier_id: 'ancien', geste: 'retrait_designation' })]
    monter(piece(), {}, null, { lecture: lecture({}, journal(lignes, new Map([['ancien', 'Ancien dossier']]))) })
    expect(screen.getByText(/^2 gestes du journal de cette pièce sont restés dans le dossier « Ancien dossier », d’où elle vient/)).toBeTruthy()
    expect(screen.getByText('Aucun geste de ce dossier n’est inscrit au journal de cette pièce.')).toBeTruthy()
    expect(document.querySelectorAll('[aria-label="Journal de la pièce"] li')).toHaveLength(0)
    cleanup()
    monter(piece(), {}, null, { lecture: lecture({}, journal(lignes, null)) })
    expect(screen.getByText(/sont restés dans un autre dossier, d’où elle vient/)).toBeTruthy()
  })

  it('illisible : il le dit, et n’affirme rien — ni le vide, ni l’absence d’un journal ailleurs ; les gestes restent offerts', () => {
    monter(piece(), {}, null, { lecture: lecture({}, { etat: 'incomplet', motif: 'accès refusé' }) })
    expect(screen.getByText(/Le journal de cette pièce n’a pas pu être lu en entier \(accès refusé\) : on ne sait pas qui l’a désignée ou déclarée/)).toBeTruthy()
    expect(screen.queryByText(/Aucun geste/)).toBeNull()
    expect(screen.queryByText(/^(Un geste|\d+ gestes) du journal de cette pièce/)).toBeNull()
    // Le journal ne commande aucun geste : la désignation reste offerte.
    expect(designer()).toBeTruthy()
  })
})
