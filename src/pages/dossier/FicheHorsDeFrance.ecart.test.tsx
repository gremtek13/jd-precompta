import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import FicheHorsDeFrance, { type DonneesHorsDeFrance } from './FicheHorsDeFrance'
import { REFUS_ECART_PIECE, REFUS_REPRISE_PIECE } from '../../lib/regimesEreporting'
import { remplirModele } from '../../lib/encaissementsFactures'
import type { LectureFichesHorsDeFrance } from '../../lib/propositionsHorsDeFrance'
import type { Piece, PieceEcarteeEreporting, PieceHorsDeFrance, PieceHorsDeFranceTaux } from '../../lib/types'
import { ECARTS_ET_DECLARATIONS_VIDES } from '../../test/ereportingDeLaPiece'

// ÉCARTER UNE PIÈCE CANDIDATE DE L'E-REPORTING, ET LA REPRENDRE, DEPUIS LA FICHE DE LA PIÈCE (ligne 28.5, étape e5c ; les
// fonctions : étape e5a). Ce que ces cas gardent : le geste ne s'offre qu'à une CANDIDATE — un achat sans fiche qu'un
// signal d'e3 désigne — ou à une pièce déjà écartée ; rien sur une lecture des écarts absente ou partielle ; les refus des
// fonctions sont dits avant le clic, sous leurs mots ; la confirmation NOMME la pièce et le motif ; deux et trois clics du
// même rendu : un seul appel, le verrou tenu jusqu'à la relecture des écarts, relue aussi sur un refus ; une erreur de la
// base dite. Données FICTIVES.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  reponses: [] as ((v: { data: unknown; error: unknown }) => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'piece_textes_ocr') throw new Error(`Table non attendue dans ce test : ${table}`)
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
    },
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((resolve) => { faux.reponses.push(resolve) })
    },
  },
}))

// Une pièce d'achat en dollars : le signal le plus simple d'une candidate (« Le document est en USD. »).
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/facture.pdf', nom_fichier: 'facture.pdf',
    storage_hash: null, date_piece: '2027-10-02', tiers: 'Nuage Logiciel Ltd', montant_ht: null, montant_tva: null,
    montant_ttc: 110, devise: 'USD', montant_devise: 120, taux_change: null, conversion_source: null, categorie_id: null,
    sous_dossier_id: null, type_piece: 'achat', statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null,
    flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null,
    identite_nature: null, facture_id: null, vente_hors_des_factures: false, created_at: '2027-10-02T09:00:00Z', updated_at: '2027-10-02T09:00:00Z', ...o,
  }
}

function fiche(o: Partial<PieceHorsDeFrance> = {}): PieceHorsDeFrance {
  return {
    id: 'f1', dossier_id: 'd1', piece_id: 'p1', remplace_id: null, numero: 'INV-2027-0042', date_facture: '2027-10-01',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'USD', pays: 'US',
    schema_identifiant: '0227', identifiant: 'USNuage Logiciel', nature: 'services', autoliquidation: true,
    date_operation: null, periode_debut: null, periode_fin: null, cree_par: null, cree_le: '2027-10-05T08:00:00Z',
    retire_le: null, retire_par: null, ...o,
  }
}

function ligne(o: Partial<PieceHorsDeFranceTaux> = {}): PieceHorsDeFranceTaux {
  return { fiche_id: 'f1', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 120, tva: 0, motif_code: null, motif_texte: null, ...o }
}

function ecart(o: Partial<PieceEcarteeEreporting> = {}): PieceEcarteeEreporting {
  return {
    id: 'x1', dossier_id: 'd1', piece_id: 'p1', motif: 'Fournisseur établi en France, facturé en dollars par erreur.',
    cree_par: 'u1', cree_le: '2027-10-20T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

const VIDE: LectureFichesHorsDeFrance = { fiches: [], taux: [], motif: null }
const lue = (lignes: PieceEcarteeEreporting[]) => ({ lignes, complete: true, motif: null })

function message(cle: (typeof REFUS_ECART_PIECE)[number]['cle']) {
  return remplirModele((REFUS_ECART_PIECE.find((r) => r.cle === cle) as { modele: string }).modele, [])
}
function messageReprise(cle: (typeof REFUS_REPRISE_PIECE)[number]['cle']) {
  return remplirModele((REFUS_REPRISE_PIECE.find((r) => r.cle === cle) as { modele: string }).modele, [])
}

interface Montage {
  piece?: Partial<Piece>
  donnees?: Partial<DonneesHorsDeFrance>
  surModifiee?: (m: boolean) => void
}

let confirmations: string[] = []

async function monter(o: Montage = {}) {
  const relire = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const relireEcarts = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const donnees: DonneesHorsDeFrance = {
    lecture: VIDE, relire, anneeFigeante: null, gelIncomplet: null, pieces: [], ...ECARTS_ET_DECLARATIONS_VIDES, relireEcarts,
    ...o.donnees,
  }
  const vue = render(
    <FicheHorsDeFrance dossierId="d1" piece={piece(o.piece)} pieceModifiee={false} donnees={donnees} sansTexteLu={false} onModifiee={o.surModifiee} />,
  )
  await act(async () => {})
  return { ...vue, donnees, relireEcarts }
}

const bouton = (nom: string | RegExp) => screen.queryByRole('button', { name: nom })
const motif = () => screen.getByLabelText('Ce que la vérification a établi') as HTMLTextAreaElement
const saisirLeMotif = async (valeur: string) => { await act(async () => { fireEvent.change(motif(), { target: { value: valeur } }) }) }
const repondre = async (reponse: { data: unknown; error: unknown } = { data: {}, error: null }) => {
  await act(async () => { faux.reponses.shift()?.(reponse) })
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-10-25T10:00:00Z'))
})
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  faux.appels = []
  faux.reponses = []
  confirmations = []
  vi.spyOn(window, 'confirm').mockImplementation((t?: string) => { confirmations.push(t ?? ''); return true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('qui peut être écarté', () => {
  it('une candidate — un achat en dollars sans fiche —, dès que les écarts sont lus en entier', async () => {
    await monter({ donnees: { ecarts: lue([]) } })
    expect(bouton('Écarter de l’e-reporting…')).toBeTruthy()
  })

  it('pas une pièce qu’aucun signal ne désigne : un achat en euros, sans texte', async () => {
    await monter({ piece: { devise: 'EUR', montant_devise: null, montant_ttc: 120 }, donnees: { ecarts: lue([]) } })
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
  })

  it('pas une pièce qui a une fiche — courante ou retirée : c’est sa fiche qui se retire', async () => {
    await monter({ donnees: { ecarts: lue([]), lecture: { fiches: [fiche()], taux: [ligne()], motif: null } } })
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
    cleanup()
    await monter({ donnees: { ecarts: lue([]), lecture: { fiches: [fiche({ retire_le: '2027-10-06T10:00:00Z', retire_par: 'u1' })], taux: [ligne()], motif: null } } })
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
  })

  it('pas une pièce qui n’est pas un achat', async () => {
    await monter({ piece: { type_piece: 'vente' }, donnees: { ecarts: lue([]) } })
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
  })

  it('rien avant la lecture des écarts', async () => {
    await monter({ donnees: { ecarts: null } })
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
    expect(screen.queryByText(/Écartée de l’e-reporting/)).toBeNull()
    expect(screen.queryByText(/pièces écartées/)).toBeNull()
  })

  it('une lecture partielle des écarts : la candidate le dit, ne s’écarte ni ne se reprend d’ici', async () => {
    await monter({ donnees: { ecarts: { lignes: [ecart()], complete: false, motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' } } })
    expect(screen.getByText(/Les pièces écartées de l’e-reporting n’ont pas pu être lues en entier \(1 ligne\(s\) lue\(s\) sur 2 annoncée\(s\)\) : cette pièce ne s’écarte ni ne se reprend d’ici\./)).toBeTruthy()
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
    expect(bouton('Reprendre la pièce')).toBeNull()
    // Et elle ne dit pas non plus qu’elle est écartée, ni qu’elle ne l’est pas.
    expect(screen.queryByText(/Écartée de l’e-reporting/)).toBeNull()
  })

  it('une lecture partielle ne dit rien d’une pièce qui n’est pas candidate', async () => {
    await monter({ piece: { devise: 'EUR', montant_devise: null, montant_ttc: 120 }, donnees: { ecarts: { lignes: [], complete: false, motif: 'x' } } })
    expect(screen.queryByText(/pièces écartées/)).toBeNull()
  })

  it('une lecture partielle ne commande pas non plus la reprise d’une pièce qui a une fiche : l’écart qu’elle a lu ne se dit ni ne se reprend', async () => {
    await monter({
      donnees: { lecture: { fiches: [fiche()], taux: [ligne()], motif: null }, ecarts: { lignes: [ecart()], complete: false, motif: 'x' } },
    })
    expect(screen.queryByText(/Écartée de l’e-reporting/)).toBeNull()
    expect(bouton('Reprendre la pièce')).toBeNull()
  })

  it('un écart retiré ne compte plus : la pièce est de nouveau à écarter', async () => {
    await monter({ donnees: { ecarts: lue([ecart({ retire_le: '2027-10-21T10:00:00Z', retire_par: 'u1' })]) } })
    expect(screen.queryByText(/Écartée de l’e-reporting/)).toBeNull()
    expect(bouton('Écarter de l’e-reporting…')).toBeTruthy()
  })

  it('l’écart d’une autre pièce ne la regarde pas', async () => {
    await monter({ donnees: { ecarts: lue([ecart({ piece_id: 'autre' })]) } })
    expect(screen.queryByText(/Écartée de l’e-reporting/)).toBeNull()
    expect(bouton('Écarter de l’e-reporting…')).toBeTruthy()
  })
})

describe('écarter', () => {
  async function ouvrirLaSaisie() {
    const vue = await monter({ donnees: { ecarts: lue([]) } })
    await act(async () => { fireEvent.click(bouton('Écarter de l’e-reporting…') as HTMLElement) })
    return vue
  }

  it('s’ouvre sur un motif VIDE : l’application ne devine pas ce que la vérification a établi', async () => {
    await ouvrirLaSaisie()
    expect(motif().value).toBe('')
    expect(screen.getByText(/Cette pièce ressemble à un achat à un fournisseur établi hors de France, et la période l’attend\./)).toBeTruthy()
  })

  it('dit le motif absent AVANT le clic, sans alarme, et grise le bouton', async () => {
    await ouvrirLaSaisie()
    expect(screen.getByText(message('motif_absent')).className).toBe('muted')
    expect((bouton('Écarter la pièce') as HTMLButtonElement).disabled).toBe(true)
    await saisirLeMotif('     ')
    expect(screen.getByText(message('motif_absent'))).toBeTruthy()
    expect((bouton('Écarter la pièce') as HTMLButtonElement).disabled).toBe(true)
  })

  it('dit le motif de plus de 2 000 caractères, en erreur', async () => {
    await ouvrirLaSaisie()
    await saisirLeMotif('x'.repeat(2001))
    expect(screen.getByText(message('motif_trop_long')).className).toBe('fiche-hdf-refus')
    expect((bouton('Écarter la pièce') as HTMLButtonElement).disabled).toBe(true)
    await saisirLeMotif('x'.repeat(2000))
    expect(screen.queryByText(message('motif_trop_long'))).toBeNull()
    expect((bouton('Écarter la pièce') as HTMLButtonElement).disabled).toBe(false)
  })

  it('la confirmation nomme la pièce et le motif ; la base reçoit le dossier, la pièce et le motif sans ses blancs de bord', async () => {
    const { relireEcarts } = await ouvrirLaSaisie()
    await saisirLeMotif('  Fournisseur établi en France.  ')
    await act(async () => { fireEvent.click(bouton('Écarter la pièce') as HTMLElement) })
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]).toContain('Écarter la pièce « Nuage Logiciel Ltd » de l’e-reporting ?')
    expect(confirmations[0]).toContain('Motif : Fournisseur établi en France.')
    expect(faux.appels).toEqual([{ nom: 'ecarter_piece_ereporting', args: { p_dossier_id: 'd1', p_piece_id: 'p1', p_motif: 'Fournisseur établi en France.' } }])
    await repondre()
    // Les écarts sont relus, et la saisie se referme.
    expect(relireEcarts).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Ce que la vérification a établi')).toBeNull()
  })

  it('un confirm refusé n’écrit rien', async () => {
    await ouvrirLaSaisie()
    await saisirLeMotif('Fournisseur établi en France.')
    vi.spyOn(window, 'confirm').mockImplementation(() => false)
    await act(async () => { fireEvent.click(bouton('Écarter la pièce') as HTMLElement) })
    expect(faux.appels).toEqual([])
    expect((bouton('Écarter la pièce') as HTMLButtonElement).disabled).toBe(false)
  })

  it('deux puis trois clics du même rendu : un seul appel, et le verrou tient jusqu’à la relecture des écarts', async () => {
    let finDeLaRelecture = () => {}
    const relireEcarts = vi.fn<() => Promise<void>>(() => new Promise<void>((r) => { finDeLaRelecture = r }))
    await monter({ donnees: { ecarts: lue([]), relireEcarts } })
    await act(async () => { fireEvent.click(bouton('Écarter de l’e-reporting…') as HTMLElement) })
    await saisirLeMotif('Fournisseur établi en France.')
    const b = bouton('Écarter la pièce') as HTMLElement
    await act(async () => { fireEvent.click(b); fireEvent.click(b); fireEvent.click(b) })
    expect(faux.appels).toHaveLength(1)
    expect(confirmations).toHaveLength(1)
    // L’appel revient ; la relecture des écarts n’est pas revenue : le verrou tient, rien d’autre ne part.
    await repondre()
    expect(relireEcarts).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.click(b) })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { finDeLaRelecture() })
    expect(faux.appels).toHaveLength(1)
  })

  it('refusé par la base : l’erreur se dit, les écarts sont relus, la saisie reste, le verrou est relâché', async () => {
    const { relireEcarts } = await ouvrirLaSaisie()
    await saisirLeMotif('Fournisseur établi en France.')
    await act(async () => { fireEvent.click(bouton('Écarter la pièce') as HTMLElement) })
    await repondre({ data: null, error: { message: message('deja_ecartee') } })
    expect(screen.getByText(message('deja_ecartee'), { selector: 'p.error-text' })).toBeTruthy()
    expect(relireEcarts).toHaveBeenCalledTimes(1)
    expect(motif().value).toBe('Fournisseur établi en France.')
    // Un nouvel essai part.
    await act(async () => { fireEvent.click(bouton('Écarter la pièce') as HTMLElement) })
    expect(faux.appels).toHaveLength(2)
  })

  it('Abandonner referme la saisie sans rien écrire', async () => {
    await ouvrirLaSaisie()
    await saisirLeMotif('Un motif commencé.')
    await act(async () => { fireEvent.click(bouton('Abandonner') as HTMLElement) })
    expect(screen.queryByLabelText('Ce que la vérification a établi')).toBeNull()
    expect(bouton('Écarter de l’e-reporting…')).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('un motif commencé est une saisie non enregistrée : la garde du volet la protège', async () => {
    const surModifiee = vi.fn()
    await monter({ donnees: { ecarts: lue([]) }, surModifiee })
    expect(surModifiee).toHaveBeenLastCalledWith(false)
    await act(async () => { fireEvent.click(bouton('Écarter de l’e-reporting…') as HTMLElement) })
    expect(surModifiee).toHaveBeenLastCalledWith(false)
    await saisirLeMotif('Un motif commencé.')
    expect(surModifiee).toHaveBeenLastCalledWith(true)
    await saisirLeMotif('')
    expect(surModifiee).toHaveBeenLastCalledWith(false)
  })
})

describe('reprendre', () => {
  it('une pièce écartée : la date, le motif, et ce que cela change — la période ne l’attend plus', async () => {
    await monter({ donnees: { ecarts: lue([ecart()]) } })
    const p = screen.getByText(/Écartée de l’e-reporting/).closest('p') as HTMLElement
    expect(p.textContent).toBe('Écartée de l’e-reporting le 20/10/2027 : « Fournisseur établi en France, facturé en dollars par erreur. ». La période ne l’attend plus.')
    expect(bouton('Écarter de l’e-reporting…')).toBeNull()
    expect(bouton('Reprendre la pièce')).toBeTruthy()
  })

  it('une pièce écartée qui a une fiche : c’est la fiche qui compte, l’écart est sans effet — et se reprend', async () => {
    await monter({ donnees: { ecarts: lue([ecart()]), lecture: { fiches: [fiche()], taux: [ligne()], motif: null } } })
    const p = screen.getByText(/Écartée de l’e-reporting/).closest('p') as HTMLElement
    expect(p.textContent).toContain('Cette pièce a une fiche : c’est elle qui compte, l’écart est sans effet tant qu’elle existe.')
    expect(p.textContent).not.toContain('La période ne l’attend plus.')
    expect(bouton('Reprendre la pièce')).toBeTruthy()
  })

  it('la confirmation nomme la pièce ; la base reçoit le dossier et l’écart ; les écarts sont relus', async () => {
    const { relireEcarts } = await monter({ donnees: { ecarts: lue([ecart()]) } })
    await act(async () => { fireEvent.click(bouton('Reprendre la pièce') as HTMLElement) })
    expect(confirmations[0]).toContain('Reprendre la pièce « Nuage Logiciel Ltd » ?')
    expect(confirmations[0]).toContain('de nouveau à vérifier')
    expect(faux.appels).toEqual([{ nom: 'reprendre_piece_ereporting', args: { p_dossier_id: 'd1', p_ecart_id: 'x1' } }])
    await repondre()
    expect(relireEcarts).toHaveBeenCalledTimes(1)
  })

  it('deux puis trois clics du même rendu : un seul appel', async () => {
    await monter({ donnees: { ecarts: lue([ecart()]) } })
    const b = bouton('Reprendre la pièce') as HTMLElement
    await act(async () => { fireEvent.click(b); fireEvent.click(b); fireEvent.click(b) })
    expect(faux.appels).toHaveLength(1)
    expect(confirmations).toHaveLength(1)
  })

  it('refusée par la base : l’erreur se dit, les écarts sont relus, le verrou est relâché', async () => {
    const { relireEcarts } = await monter({ donnees: { ecarts: lue([ecart()]) } })
    await act(async () => { fireEvent.click(bouton('Reprendre la pièce') as HTMLElement) })
    await repondre({ data: null, error: { message: messageReprise('deja_retire') } })
    expect(screen.getByText(messageReprise('deja_retire'), { selector: 'p.error-text' })).toBeTruthy()
    expect(relireEcarts).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.click(bouton('Reprendre la pièce') as HTMLElement) })
    expect(faux.appels).toHaveLength(2)
  })

  it('un confirm refusé n’écrit rien', async () => {
    await monter({ donnees: { ecarts: lue([ecart()]) } })
    vi.spyOn(window, 'confirm').mockImplementation(() => false)
    await act(async () => { fireEvent.click(bouton('Reprendre la pièce') as HTMLElement) })
    expect(faux.appels).toEqual([])
  })

  it('le verrou est celui de la fiche : un geste de la fiche, ou de l’écart, ne part pas pendant un autre', async () => {
    await monter({ donnees: { ecarts: lue([ecart()]) } })
    await act(async () => { fireEvent.click(bouton('Reprendre la pièce') as HTMLElement) })
    expect(faux.appels).toHaveLength(1)
    // Pendant l’appel, le bouton de la saisie d’une fiche est grisé.
    expect((bouton('Saisir la fiche') as HTMLButtonElement).disabled).toBe(true)
    expect((bouton(/Reprise…/) as HTMLButtonElement).disabled).toBe(true)
  })
})
