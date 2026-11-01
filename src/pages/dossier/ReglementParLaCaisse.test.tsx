import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReglementParLaCaisse, { type CaisseDeLaPiece } from './ReglementParLaCaisse'
import type { DonneesDeLaCaisse } from '../../lib/caisseEcran'
import type { ModeleComptable } from '../../lib/engagement'
import type { LectureDeLaCaisseDeLaPiece } from '../../lib/paiementParLaCaisseEcran'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { PaiementsDesPieces } from '../../lib/rattachement'
import type { OperationCaisse, Piece } from '../../lib/types'
import { AvecExercicesValides } from '../../test/exercicesValides'

// « RÉGLER PAR LA CAISSE », DANS LA FICHE D'UNE PIÈCE (ligne 26.6, étape C9b). Ce que ces cas gardent : le drapeau baissé, rien ;
// rien avant le retour de la lecture ; une lecture partielle qui le dit et n'offre AUCUN geste ; le reste à régler proposé, signé
// comme le relevé ; le refus du module dit AVANT le clic, sur la saisie telle qu'elle part ; une confirmation qui NOMME ce qui part ;
// la fonction de la base seule, ses arguments ; un `{ error }` lu et dit ; la caisse relue avant que le verrou se relâche ; deux
// clics dans le même `act` : un seul appel ; le retrait d'un paiement, confirmé. La base est un faux `rpc`. Des jeux FICTIFS, un
// jour fixe : le 29/10/2026.

const drapeau = vi.hoisted(() => ({ leve: true as boolean }))
vi.mock('../../lib/paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('../../lib/paiementParLaCaisse')>()
  return { ...module, get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeau.leve } }
})

const faux = vi.hoisted(() => ({
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  refus: null as string | null,
  retenir: false,
  relacher: null as null | (() => void),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      const reponse = () => ({ data: null, error: faux.refus ? { message: faux.refus } : null })
      if (faux.retenir) return new Promise<void>((r) => { faux.relacher = r }).then(reponse)
      return Promise.resolve(reponse())
    },
  },
}))

const D = 'dossier-1'
const MODELE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const sansInsecable = (t: string) => t.split(String.fromCharCode(0xa0)).join(' ').split(String.fromCharCode(0x202f)).join(' ')

function operation(o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse {
  return {
    dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 200, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}
function donnees(o: Partial<DonneesDeLaCaisse> = {}): DonneesDeLaCaisse {
  return {
    operations: [operation({ id: 'ap' })], ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' }, categories: [], piecesPayees: [], ...o,
  }
}
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/f.pdf`, nom_fichier: 'fournitures.pdf', storage_hash: null,
    date_piece: '2026-03-04', tiers: 'PAPETERIE FICTIVE', montant_ht: null, montant_tva: null, montant_ttc: 120, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null,
    confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-03-04T08:00:00Z', updated_at: '2026-03-04T08:00:00Z', ...o,
  } as Piece
}

let lecture: LectureDeLaCaisseDeLaPiece | null
let relire: ReturnType<typeof vi.fn<() => Promise<void>>>
let confirmation: ReturnType<typeof vi.spyOn>

function caisse(o: Partial<CaisseDeLaPiece> = {}): CaisseDeLaPiece {
  return { lecture, modele: MODELE, assujettiTva: false, paiements: new Map() as PaiementsDesPieces, relire, ...o }
}
function monter(p: Piece = piece(), c: Partial<CaisseDeLaPiece> = {}) {
  return render(
    <AvecExercicesValides>
      <ReglementParLaCaisse dossierId={D} piece={p} factures={{ lignes: [], complete: true, motif: null }} caisse={caisse(c)} />
    </AvecExercicesValides>,
  )
}
const bouton = () => screen.getByRole('button', { name: 'Régler par la caisse' }) as HTMLButtonElement
const champ = (nom: RegExp) => screen.getByLabelText(nom) as HTMLInputElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'))
  drapeau.leve = true
  faux.rpcs = []
  faux.refus = null
  faux.retenir = false
  lecture = { dossierId: D, etat: 'lue', donnees: donnees() }
  relire = vi.fn(async () => {})
  confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  vi.useRealTimers()
  confirmation.mockRestore()
})

describe('Payée en espèces — ce qui ne s’offre pas', () => {
  it('le drapeau baissé : la section ne se monte pas, quelle que soit la caisse lue', () => {
    drapeau.leve = false
    const { container } = monter()
    expect(container.textContent).toBe('')
  })

  it('rien avant le retour de la lecture : « Lecture… », aucun champ ni bouton', () => {
    lecture = null
    monter()
    expect(screen.getByText('Lecture de la caisse du dossier…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByLabelText(/Jour du paiement/)).toBeNull()
  })

  it('la lecture d’un AUTRE dossier compte pour rien : en attente', () => {
    lecture = { dossierId: 'autre', etat: 'lue', donnees: donnees() }
    monter()
    expect(screen.getByText('Lecture de la caisse du dossier…')).toBeTruthy()
  })

  it('une caisse lue en partie : le motif dit, aucun geste', () => {
    lecture = { dossierId: D, etat: 'incomplete', motif: 'les opérations de la caisse : lecture interrompue' }
    monter(piece(), {})
    expect(screen.getByText(/n’a pas pu être lue en entier \(les opérations de la caisse : lecture interrompue\)/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('un dossier en engagement, ou une pièce ni d’achat ni de vente sans paiement : aucune section', () => {
    const { container, unmount } = monter(piece(), { modele: { ...MODELE, mode: 'engagement' } })
    expect(container.textContent).toBe('')
    unmount()
    const autre = monter(piece({ type_piece: 'note_frais' }))
    expect(autre.container.textContent).toBe('')
  })

  it('une désignation que la lecture ne rend pas : dit, sans formulaire', () => {
    render(
      <AvecExercicesValides>
        <ReglementParLaCaisse dossierId={D} piece={piece({ type_piece: 'vente', facture_id: 'f9' })} factures={{ lignes: [], complete: true, motif: null }} caisse={caisse()} />
      </AvecExercicesValides>,
    )
    expect(screen.getByText(/la facture dont cette pièce est l’exemplaire n’est pas dans les factures lues/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Régler par la caisse' })).toBeNull()
  })
})

describe('Régler par la caisse', () => {
  it('le reste à régler proposé, signé comme le relevé ; inconnu sur des paiements lus en partie : le champ attend', () => {
    const { unmount } = monter(piece(), { paiements: new Map([['p1', [{ id: 'm', date: '2026-03-01', montant: -20, origine: 'rapprochement' as const }]]]) })
    expect(champ(/Montant/).value).toBe('-100,00')
    expect(screen.getByText(/Le montant proposé est ce qu’il reste à régler/)).toBeTruthy()
    unmount()
    monter(piece(), { paiements: null })
    expect(champ(/Montant/).value).toBe('')
  })

  it('le refus du module se dit AVANT le clic, sur la saisie telle qu’elle part, et rien ne part', async () => {
    monter(piece({ montant_ttc: 300 }))
    fireEvent.change(champ(/Jour du paiement/), { target: { value: '2026-03-05' } })
    fireEvent.change(champ(/Montant/), { target: { value: '50' } })
    expect(screen.getByRole('alert').textContent).toMatch(/^Ce paiement ne va pas dans le sens de sa pièce/)
    expect(bouton().disabled).toBe(true)
    // La caisse jamais négative, à l'appel : 200 € d'apport, 250 € payés d'une pièce de 300 €.
    fireEvent.change(champ(/Montant/), { target: { value: '-250' } })
    expect(screen.getByRole('alert').textContent).toMatch(/^Ce paiement de 250,00 € rendrait la caisse négative le 05\/03\/2026/)
    await act(async () => { fireEvent.click(bouton()) })
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.rpcs).toEqual([])
  })

  it('la confirmation NOMME ce qui part, puis la fonction seule, ses arguments, et la caisse relue', async () => {
    monter()
    fireEvent.change(champ(/Jour du paiement/), { target: { value: '2026-03-05' } })
    expect(bouton().disabled).toBe(false)
    await act(async () => { fireEvent.click(bouton()) })
    expect(sansInsecable(String(confirmation.mock.calls[0][0]))).toBe(
      'Régler la pièce « fournitures.pdf » par la caisse : le paiement en espèces du 05/03/2026 de 120,00 € ? La caisse du '
      + `05/03/2026 passera à 80,00 €. Sa contrepartie au compte de la caisse (${PLAN_PAR_DEFAUT.caisse}) s’écrit avec les `
      + 'écritures de la pièce : déjà générées, elles seront à régénérer (Écritures).')
    expect(confirmation.mock.calls[0][0]).not.toContain('PAPETERIE')
    expect(faux.rpcs).toEqual([{ nom: 'regler_piece_par_la_caisse', args: { p_dossier_id: D, p_piece_id: 'p1', p_date: '2026-03-05', p_montant: -120 } }])
    expect(relire).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toMatch(/^Réglée par la caisse : le paiement en espèces du 05\/03\/2026/)
    expect(champ(/Jour du paiement/).value).toBe('')
  })

  it('refusée à la confirmation : rien ne part, rien n’est relu', async () => {
    confirmation.mockReturnValue(false)
    monter()
    fireEvent.change(champ(/Jour du paiement/), { target: { value: '2026-03-05' } })
    await act(async () => { fireEvent.click(bouton()) })
    expect(faux.rpcs).toEqual([])
    expect(relire).not.toHaveBeenCalled()
  })

  it('le refus de la base se dit par `messageErreur`, et la caisse est relue quand même', async () => {
    faux.refus = 'Cette pièce n\'est pas une pièce de ce dossier : relis ses pièces.'
    monter()
    fireEvent.change(champ(/Jour du paiement/), { target: { value: '2026-03-05' } })
    await act(async () => { fireEvent.click(bouton()) })
    expect(screen.getByRole('alert').textContent).toBe('Le paiement n’a pas été enregistré : Cette pièce n\'est pas une pièce de ce dossier : relis ses pièces.')
    expect(relire).toHaveBeenCalledTimes(1)
  })

  it('deux clics dans le même `act` : un seul appel ; le verrou tient jusqu’après la relecture', async () => {
    faux.retenir = true
    let relache: () => void = () => {}
    relire.mockImplementation(() => new Promise<void>((r) => { relache = r }))
    monter()
    fireEvent.change(champ(/Jour du paiement/), { target: { value: '2026-03-05' } })
    act(() => { fireEvent.click(bouton()); fireEvent.click(bouton()) })
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Écriture…' })).toBeTruthy()
    await act(async () => { faux.relacher?.() })
    await waitFor(() => expect(relire).toHaveBeenCalledTimes(1))
    // La base a répondu, la relecture pas encore : toujours verrouillé.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Écriture…' })) })
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { relache() })
    expect(screen.queryByRole('button', { name: 'Écriture…' })).toBeNull()
  })
})

describe('les paiements de la pièce, et leur retrait', () => {
  const paye = operation({ id: 'pa', genre: 'paiement', date: '2026-03-05', montant: -50, piece_id: 'p1' })
  const retire = operation({ id: 'pr', genre: 'paiement', date: '2026-03-02', montant: -10, piece_id: 'p1', retire_le: '2026-03-03T08:00:00Z' })

  it('chacun, son jour et ses espèces, jamais un tiers ; un retiré le dit, sans geste', () => {
    lecture = { dossierId: D, etat: 'lue', donnees: donnees({ operations: [operation({ id: 'ap' }), paye, retire] }) }
    monter()
    const items = screen.getAllByRole('listitem').map((li) => sansInsecable(li.textContent ?? ''))
    expect(items).toEqual([
      'Le paiement en espèces du 02/03/2026 de 10,00 € Retiré',
      'Le paiement en espèces du 05/03/2026 de 50,00 € Retirer',
    ])
    expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(1)
  })

  it('le retrait : confirmé — la confirmation nomme ce qui part —, la fonction de la caisse, puis la relecture', async () => {
    lecture = { dossierId: D, etat: 'lue', donnees: donnees({ operations: [operation({ id: 'ap' }), paye] }) }
    monter()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })) })
    expect(sansInsecable(String(confirmation.mock.calls[0][0]))).toMatch(/^Retirer le paiement en espèces du 05\/03\/2026 de 50,00 € \?.*passera à 200,00 €\.$/)
    expect(faux.rpcs).toEqual([{ nom: 'retirer_operation_caisse', args: { p_dossier_id: D, p_operation_id: 'pa' } }])
    expect(relire).toHaveBeenCalledTimes(1)
  })

  it('un retrait que la caisse refuserait se dit avant le clic, et le bouton reste grisé', async () => {
    const encaisse = operation({ id: 'pv', genre: 'paiement', date: '2026-03-02', montant: 80, piece_id: 'p1' })
    const sortie = operation({ id: 'pl', genre: 'prelevement', date: '2026-03-03', montant: 250 })
    lecture = { dossierId: D, etat: 'lue', donnees: donnees({ operations: [operation({ id: 'ap' }), encaisse, sortie] }) }
    monter(piece({ type_piece: 'vente', montant_ttc: 80 }))
    const retirer = screen.getByRole('button', { name: 'Retirer' }) as HTMLButtonElement
    expect(retirer.disabled).toBe(true)
    expect(screen.getByText(/Retirer ce paiement de 80,00 € rendrait la caisse négative/)).toBeTruthy()
    await act(async () => { fireEvent.click(retirer) })
    expect(faux.rpcs).toEqual([])
  })
})
