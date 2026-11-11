import { describe, expect, it } from 'vitest'
import { etatDeLaProposition, associable, phraseDeLEtat, type ContexteDeLaProposition } from './banqueCabinet'
import { restesAReglerDesPieces } from './controles'
import { formatMoney } from './format'
import { AUCUN_CANDIDAT } from './mouvementsDesVentes'
import { SANS_FACTURE_SOURCE } from '../test/ventesFacturees'
import { paiementsDesPieces, type PaiementsDesPieces, type PartPayeeParLaCaisse } from './rattachement'
import { justificatifPossible } from './reglesAffectation'
import { refusReglementGroupe, refusSecondPaiement, rejetAccepte } from './reglementGroupe'
import {
  effetDuPaiementAjoute, JOURS_DU_REJET, phrasesDeLEffet, piecesAuPaiementRejete, piecesDuRejet, rejetPossible, rejetPropose,
  signauxDuRejet,
} from './rejetDuPaiement'
import type { LigneBancaire, Piece } from './types'

// REJET-Q1 (tranchée le 01/11/2026 : « l'ouvrir ») : le prélèvement rejeté puis repris, rapproché de sa pièce. Données
// fictives : une prime d'assurance de 1 200 € datée du 01/12/2025, prélevée le 20/12/2025, rejetée le 28/12, reprise le
// 05/01/2026.

const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'prime', dossier_id: 'd', uploaded_by: null, source: 'upload', storage_path: 'd/prime.pdf', nom_fichier: 'prime.pdf',
  storage_hash: null, date_piece: '2025-12-01', tiers: 'Assureur fictif', montant_ht: null, montant_tva: null, montant_ttc: 1200,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
  lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
  vente_hors_des_factures: false, created_at: '2025-12-02T09:00:00Z', updated_at: '2025-12-02T09:00:00Z', ...o,
})

const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2025-12-20', libelle: 'PRLV SEPA ASSUREUR FICTIF', montant: -1200, statut: 'rapprochee',
  piece_id: 'prime', cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null,
  emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
  declaration_tva_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null, id_externe: null,
  created_at: '2025-12-21T08:00:00Z', encaissements_de_factures: false, ...o,
})

const DEBIT = ligne({ id: 'debit' })
const REJET = ligne({ id: 'rejet', date: '2025-12-28', montant: 1200, libelle: 'REJET PRLV SEPA ASSUREUR FICTIF', statut: 'non_rapprochee', piece_id: null })
const REPRISE = ligne({ id: 'reprise', date: '2026-01-05', montant: -1200, statut: 'non_rapprochee', piece_id: null })
const rapproche = (l: LigneBancaire): LigneBancaire => ({ ...l, statut: 'rapprochee', piece_id: 'prime' })

function paiements(lignes: readonly LigneBancaire[], caisse: readonly PartPayeeParLaCaisse[] = []): PaiementsDesPieces {
  return paiementsDesPieces(lignes, [], [], caisse)
}

const resume = (...montants: number[]) => montants.map((montant, i) => ({ id: `m${i}`, montant }))

describe('REJET-Q1 — la règle : le rejet que la pièce accepte (`rejetAccepte`)', () => {
  it('un crédit défait le prélèvement d’une dépense payée d’au moins son montant, jamais plus', () => {
    const prime = piece()
    expect(rejetAccepte(prime, resume(-1200), 1200)).toBe(true)
    // Un rejet partiel défait une partie de ce qu'elle a reçu.
    expect(rejetAccepte(prime, resume(-1200), 200)).toBe(true)
    // Plus que ce qu'elle a reçu : il retournerait le sens de la somme.
    expect(rejetAccepte(prime, resume(-1200), 1200.01)).toBe(false)
    // Rien reçu, net : un prélèvement déjà rejeté ne se rejette pas deux fois.
    expect(rejetAccepte(prime, resume(-1200, 1200), 1200)).toBe(false)
    expect(rejetAccepte(prime, [], 1200)).toBe(false)
    // Un mouvement de son sens n'est pas un rejet ; un mouvement de zéro euro non plus.
    expect(rejetAccepte(prime, resume(-1200), -1200)).toBe(false)
    expect(rejetAccepte(prime, resume(-1200), 0)).toBe(false)
    // Une pièce sans montant lu n'a pas de sens qui la règle.
    expect(rejetAccepte(piece({ montant_ttc: null }), resume(-1200), 1200)).toBe(false)
  })

  it('dans les deux sens : le chèque impayé d’une vente, le rejet du remboursement d’un avoir', () => {
    expect(rejetAccepte(piece({ type_piece: 'vente', montant_ttc: 500 }), resume(500), -500)).toBe(true)
    expect(rejetAccepte(piece({ type_piece: 'vente', montant_ttc: 500 }), resume(500), 500)).toBe(false)
    // Un avoir d'achat se règle par une entrée : son rejet est une sortie.
    expect(rejetAccepte(piece({ montant_ttc: -100 }), resume(100), -100)).toBe(true)
  })

  it('un paiement par la caisse compte dans ce que la pièce a reçu', () => {
    const p = paiements([], [{ operation_caisse_id: 'op', piece_id: 'prime', date: '2025-12-20', montant: -1200 }])
    expect(rejetAccepte(piece(), p.get('prime') ?? [], 1200)).toBe(true)
  })
})

describe('REJET-Q1 — le second paiement (`refusSecondPaiement`) ouvre le rejet, puis la reprise', () => {
  const MAUVAIS_SENS = 'Ce mouvement va dans le mauvais sens pour la pièce « Assureur fictif » : '
    + 'une dépense se règle par une sortie, une recette par une entrée, un avoir à l’inverse.'

  it('le rejet accepté passe ; un rejet de trop, ou sur une pièce qui n’a rien reçu net, garde le refus d’hier au caractère près', () => {
    expect(refusSecondPaiement(REJET, piece(), paiements([DEBIT]).get('prime') ?? [])).toBeNull()
    expect(refusSecondPaiement({ ...REJET, montant: 1300 }, piece(), paiements([DEBIT]).get('prime') ?? [])).toBe(MAUVAIS_SENS)
    expect(refusSecondPaiement(REJET, piece(), paiements([DEBIT, rapproche({ ...REJET, id: 'rejet-1' })]).get('prime') ?? []))
      .toBe(MAUVAIS_SENS)
    // Le même mouvement déjà rapproché ne compte pas dans ce que la pièce a reçu d'autre.
    expect(refusSecondPaiement(REJET, piece(), paiements([rapproche(REJET)]).get('prime') ?? [])).toBe(MAUVAIS_SENS)
  })

  it('la reprise d’une pièce aux paiements soldés passe pour son montant entier, et pas au-delà de l’écart', () => {
    const p = paiements([DEBIT, rapproche(REJET)]).get('prime') ?? []
    expect(refusSecondPaiement(REPRISE, piece(), p)).toBeNull()
    expect(refusSecondPaiement({ ...REPRISE, montant: -1205 }, piece(), p)).toBeNull()
    expect(refusSecondPaiement({ ...REPRISE, montant: -1300 }, piece(), p)).toBe(
      `Ce mouvement dépasse ce qu’il reste à régler de la pièce « Assureur fictif » (${formatMoney(1200)}) : `
      + 'une pièce ne se paie pas deux fois. Un virement qui en règle aussi d’autres se répartit par « Régler plusieurs pièces ».')
  })

  it('une pièce en devise rejetée se reprend au débit réel, qui la réalignera ; payée en partie, elle reste jugée sur ses euros', () => {
    const usd = piece({ devise: 'USD', montant_devise: 1300 })
    const rejetee = paiements([DEBIT, rapproche(REJET)]).get('prime') ?? []
    expect(refusSecondPaiement({ ...REPRISE, montant: -1290 }, usd, rejetee)).toBeNull()
    const acompte = paiements([{ ...DEBIT, montant: -100 }]).get('prime') ?? []
    expect(refusSecondPaiement({ ...REPRISE, montant: -1290 }, usd, acompte)).toMatch(/^Ce mouvement dépasse ce qu’il reste à régler/)
  })

  it('le règlement groupé ne prend pas un rejet : sa part de l’autre sens reste refusée', () => {
    const mouvement = ligne({ id: 'groupe', montant: 1000, statut: 'non_rapprochee', piece_id: null })
    const autre = piece({ id: 'autre', type_piece: 'vente', montant_ttc: 2200 })
    const refus = refusReglementGroupe(mouvement, [{ piece_id: 'prime', montant: 1200 }, { piece_id: 'autre', montant: -200 }],
      [piece(), autre], paiements([DEBIT]))
    expect(refus).toMatch(/va dans le mauvais sens/)
  })
})

describe('REJET-Q1 — la pièce rejetée s’offre de nouveau (`restesAReglerDesPieces`)', () => {
  it('ses paiements soldés à zéro : offerte pour son montant entier, en euros comme en devise', () => {
    const p = paiements([DEBIT, rapproche(REJET)])
    expect(restesAReglerDesPieces([piece()], p)).toEqual(new Map([['prime', 1200]]))
    expect(restesAReglerDesPieces([piece({ devise: 'USD', montant_devise: 1300 })], p)).toEqual(new Map([['prime', 1200]]))
  })

  it('le reste d’hier, au centime : payée, payée en partie, sans paiement', () => {
    expect(restesAReglerDesPieces([piece()], paiements([DEBIT]))).toEqual(new Map())
    expect(restesAReglerDesPieces([piece()], paiements([{ ...DEBIT, montant: -300 }]))).toEqual(new Map([['prime', 900]]))
    expect(restesAReglerDesPieces([piece()], paiements([]))).toEqual(new Map())
    // Un rejet partiel : la pièce est payée en partie, comme hier.
    expect(restesAReglerDesPieces([piece()], paiements([DEBIT, rapproche({ ...REJET, montant: 200 })]))).toEqual(new Map([['prime', 200]]))
    // Reprise : réglée.
    expect(restesAReglerDesPieces([piece()], paiements([DEBIT, rapproche(REJET), rapproche(REPRISE)]))).toEqual(new Map())
  })
})

describe('REJET-Q1 — les pièces qu’un mouvement peut défaire, et celle qu’un signal propose', () => {
  it('le paiement du même montant, de l’autre sens, peu avant : proposé, avec ses signaux', () => {
    const candidates = piecesDuRejet(REJET, [piece()], paiements([DEBIT]), new Set())
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ defait: { id: 'debit' }, signal: true })
    expect(rejetPropose(candidates)?.piece.id).toBe('prime')
    const signaux = signauxDuRejet(candidates[0], REJET)
    expect(signaux.map((s) => s.ok)).toEqual([true, true, true, false])
    expect(signaux[1].texte).toBe('8 jours après ce paiement')
    expect(signaux[3].texte).toMatch(/La banque ne relie pas deux mouvements/)
    expect(signauxDuRejet(candidates[0], { ...REJET, libelle: 'VIR ASSUREUR' })[2]).toEqual({ ok: false, texte: 'Le libellé bancaire ne dit pas de rejet' })
  })

  it('à égalité, aucune proposée ; les deux restent au choix', () => {
    const autre = piece({ id: 'autre', tiers: 'Autre assureur' })
    const lignes = [DEBIT, ligne({ id: 'debit-autre', piece_id: 'autre', date: '2025-12-22' })]
    const candidates = piecesDuRejet(REJET, [piece(), autre], paiements(lignes), new Set())
    expect(candidates.map((c) => c.piece.id)).toEqual(['autre', 'prime'])
    expect(rejetPropose(candidates)).toBeNull()
  })

  it('hors de la fenêtre : au choix, jamais en tête — et le signal dit l’écart', () => {
    const loin = new Date(Date.UTC(2025, 11, 28 - JOURS_DU_REJET - 1)).toISOString().slice(0, 10)
    const horsFenetre = piecesDuRejet(REJET, [piece()], paiements([{ ...DEBIT, date: loin }]), new Set())
    expect(horsFenetre).toMatchObject([{ piece: { id: 'prime' }, signal: false }])
    expect(rejetPropose(horsFenetre)).toBeNull()
    expect(signauxDuRejet(horsFenetre[0], REJET)[1]).toEqual({ ok: false, texte: '57 jours après ce paiement : au-delà des huit semaines d’un rejet ou d’un remboursement' })
    const auBord = new Date(Date.UTC(2025, 11, 28 - JOURS_DU_REJET)).toISOString().slice(0, 10)
    expect(rejetPropose(piecesDuRejet(REJET, [piece()], paiements([{ ...DEBIT, date: auBord }]), new Set()))?.piece.id).toBe('prime')
  })

  // LA RESTRICTION (relecture de la session, 02/11/2026) : seule une pièce dont un paiement RAPPROCHÉ SEUL a le montant
  // opposé au centime, daté au plus tard le jour du mouvement, est offerte. La première version offrait au rejet d'une
  // recette de 20,37 € toute pièce payée d'au moins ce montant.
  it('rien d’autre ne s’offre : un autre montant, un rejet partiel, un paiement postérieur, une part groupée, la caisse', () => {
    const offertes = (lignes: LigneBancaire[], rejet = REJET, caisse: PartPayeeParLaCaisse[] = [], groupe = false) => {
      const p = paiementsDesPieces(lignes, groupe ? [{ ligne_bancaire_id: 'vir', piece_id: 'prime', montant: -1200 }] : [], [], caisse)
      return piecesDuRejet(rejet, [piece()], p, new Set()).length
    }
    expect(offertes([DEBIT], { ...REJET, montant: 20.37 })).toBe(0)
    expect(offertes([DEBIT], { ...REJET, montant: 200 })).toBe(0)
    expect(offertes([{ ...DEBIT, date: '2025-12-29' }])).toBe(0)
    expect(offertes([ligne({ id: 'vir', piece_id: null, reglement_groupe: true, montant: -1500 })], REJET, [], true)).toBe(0)
    expect(offertes([], REJET, [{ operation_caisse_id: 'op', piece_id: 'prime', date: '2025-12-20', montant: -1200 }])).toBe(0)
    // Mille pièces payées, de 20 à 1 019 € : le rejet de 20,37 € n'en trouve aucune, celui de 420 € une seule.
    const pieces = Array.from({ length: 1000 }, (_, i) => piece({ id: `p${i}`, montant_ttc: 20 + i }))
    const lignes = pieces.map((p, i) => ligne({ id: `d${i}`, piece_id: p.id, montant: -(20 + i) }))
    const tous = paiements(lignes)
    expect(piecesDuRejet({ ...REJET, montant: 20.37 }, pieces, tous, new Set())).toEqual([])
    expect(piecesDuRejet({ ...REJET, montant: 420 }, pieces, tous, new Set()).map((c) => c.piece.id)).toEqual(['p400'])
  })

  it('jamais une pièce exclue, ni une pièce sans paiement net à défaire, ni sur un mouvement de zéro euro', () => {
    expect(piecesDuRejet(REJET, [piece()], paiements([DEBIT]), new Set(['prime']))).toEqual([])
    expect(piecesDuRejet(REJET, [piece()], paiements([]), new Set())).toEqual([])
    expect(piecesDuRejet({ ...REJET, montant: 0 }, [piece()], paiements([DEBIT]), new Set())).toEqual([])
    expect(piecesDuRejet(REJET, [piece()], paiements([DEBIT, rapproche({ ...REJET, id: 'rejet-0' })]), new Set())).toEqual([])
  })

  it('aucun lot des règles ne prend un rejet : `justificatifPossible` le retient', () => {
    const justificatifs = {
      pieces: [piece()], piecesRapprochees: new Set(['prime']), restesARegler: new Map<string, number>(), cotisations: [],
      cotisationsRapprochees: new Set<string>(), ventes: AUCUN_CANDIDAT, facturesSources: SANS_FACTURE_SOURCE,
    }
    expect(justificatifPossible(REJET, { ...justificatifs, paiements: paiements([DEBIT]) }))
      .toBe('Un paiement du même montant, de l’autre sens, est rapproché d’une pièce : ce mouvement en est peut-être le rejet.')
    expect(rejetPossible(REJET, [piece()], paiements([DEBIT]))).toBe(true)
    // Sans signal, le lot n'est pas retenu par ce motif.
    expect(justificatifPossible({ ...REJET, montant: 999 }, { ...justificatifs, paiements: paiements([DEBIT]) })).toBeNull()
    expect(justificatifPossible(REJET, { ...justificatifs, paiements: new Map() })).toBeNull()
  })
})

describe('REJET-Q1 — ce que le geste change à la 2035 (`effetDuPaiementAjoute`), par les moteurs', () => {
  it('le rejet : la pièce, sans paiement net, compte à la date de sa facture et passe « à régler »', () => {
    const effet = effetDuPaiementAjoute(piece(), paiements([DEBIT]).get('prime') ?? [], REJET, 'tresorerie', false)
    expect(effet).toMatchObject({
      mode: 'tresorerie', montantRetenu: 1200, avant: { etat: 'payee' }, apres: { etat: 'a_regler', reste: 1200 },
      parExercice: [{ annee: 2025, avant: 1200, apres: 1200 }],
      datesApres: [{ date: '2025-12-01', montant: 1200, sansPaiement: true }],
    })
    const phrases = phrasesDeLEffet(effet, piece())
    expect(phrases[0]).toBe(`2035 de 2025 : inchangée — la pièce y compte pour ${formatMoney(1200)}.`)
    expect(phrases[1]).toBe(`Après ce geste, la 2035 la compte : ${formatMoney(1200)} le 01/12/2025, date de sa facture, faute de paiement net connu.`)
    expect(phrases[2]).toBe(`La pièce passe de « payée » à « à régler » (${formatMoney(1200)}, aucun paiement net).`)
    expect(phrases[3]).toMatch(/^Jusqu’à la reprise, la 2035 la dit « sans paiement connu »/)
  })

  it('la reprise en janvier : 1 200 € de moins en 2025, 1 200 € de plus en 2026 — chaque paiement à sa date', () => {
    const effet = effetDuPaiementAjoute(piece(), paiements([DEBIT, rapproche(REJET)]).get('prime') ?? [], REPRISE, 'tresorerie', false)
    expect(effet).toMatchObject({
      avant: { etat: 'a_regler', reste: 1200 }, apres: { etat: 'payee' },
      parExercice: [{ annee: 2025, avant: 1200, apres: 0 }, { annee: 2026, avant: 0, apres: 1200 }],
      datesApres: [
        { date: '2025-12-20', montant: 1200, sansPaiement: false },
        { date: '2025-12-28', montant: -1200, sansPaiement: false },
        { date: '2026-01-05', montant: 1200, sansPaiement: false },
      ],
    })
    const phrases = phrasesDeLEffet(effet, piece())
    expect(phrases[0]).toBe(`2035 de 2025 : la pièce y compte pour ${formatMoney(0)} au lieu de ${formatMoney(1200)} (${formatMoney(1200)} de moins).`)
    expect(phrases[1]).toBe(`2035 de 2026 : la pièce y compte pour ${formatMoney(1200)} au lieu de ${formatMoney(0)} (${formatMoney(1200)} de plus).`)
    expect(phrases[3]).toBe(`La pièce passe de « à régler » (${formatMoney(1200)}, aucun paiement net) à « payée ».`)
  })

  it('une pièce sans date, sans paiement net : la 2035 ne la compte nulle part, comme le moteur', () => {
    const sansDate = piece({ date_piece: null })
    const effet = effetDuPaiementAjoute(sansDate, paiements([DEBIT]).get('prime') ?? [], REJET, 'tresorerie', false)
    expect(effet).toMatchObject({ parExercice: [{ annee: 2025, avant: 1200, apres: 0 }], datesApres: [] })
  })

  it('un rejet partiel : la pièce payée en partie, son reste à la date de la facture', () => {
    const effet = effetDuPaiementAjoute(piece(), paiements([DEBIT]).get('prime') ?? [], { ...REJET, montant: 200 }, 'tresorerie', false)
    expect(effet).toMatchObject({ apres: { etat: 'payee_en_partie', reste: 200 }, parExercice: [{ annee: 2025, avant: 1200, apres: 1200 }] })
  })

  it('le montant retenu du dossier : le HT d’un assujetti ; en engagement, seul l’état change ; une pièce à valider se dit', () => {
    const ht = effetDuPaiementAjoute(piece({ montant_ht: 1000, montant_tva: 200 }), paiements([DEBIT]).get('prime') ?? [], REJET, 'tresorerie', true)
    expect(ht).toMatchObject({ montantRetenu: 1000, parExercice: [{ annee: 2025, avant: 1000, apres: 1000 }] })
    const engagement = effetDuPaiementAjoute(piece(), paiements([DEBIT]).get('prime') ?? [], REJET, 'engagement', false)
    expect(engagement).toEqual({ mode: 'engagement', avant: { etat: 'payee' }, apres: { etat: 'a_regler', reste: 1200 } })
    expect(phrasesDeLEffet(engagement, piece())[0]).toMatch(/^En engagement, la pièce compte à la date de sa facture/)
    const aValider = piece({ statut: 'a_valider' })
    expect(phrasesDeLEffet(effetDuPaiementAjoute(aValider, paiements([DEBIT]).get('prime') ?? [], REJET, 'tresorerie', false), aValider))
      .toContain('Pièce à valider : la 2035 ne la compte qu’une fois validée.')
  })
})

describe('REJET-Q1 — les autres lecteurs', () => {
  it('la liste des pièces dit « Paiement rejeté » d’une pièce aux paiements soldés, pas d’une autre', () => {
    expect(piecesAuPaiementRejete(paiements([DEBIT, rapproche(REJET)]))).toEqual(new Set(['prime']))
    expect(piecesAuPaiementRejete(paiements([DEBIT]))).toEqual(new Set())
    expect(piecesAuPaiementRejete(paiements([DEBIT, rapproche(REJET), rapproche(REPRISE)]))).toEqual(new Set())
  })

  it('la pièce proposée par le client : le rejet s’associe, la reprise aussi — jamais « déjà rapprochée » ni « payée en partie »', () => {
    const contexte = (o: Partial<ContexteDeLaProposition>): ContexteDeLaProposition => ({
      ligne: { statut: 'non_rapprochee', piece_id: null, prelevement_personnel: false, reglement_groupe: false },
      figeePar: null, piecesDuReglement: [], pieces: [piece()], piecesLuesEnEntier: true, piecesFigees: new Set(),
      horsRapprochement: new Set(['prime']), restesARegler: new Map(), paiementsDeLaPiece: [], refusSecondPaiement: null,
      rejetAccepte: false, exemplairesDesSources: new Map(), ...o,
    })
    const rejet = etatDeLaProposition({ piece_id: 'prime' }, contexte({ rejetAccepte: true, paiementsDeLaPiece: [{ date: '2025-12-20', montant: -1200 }] }))
    expect(rejet).toEqual({ etat: 'rejet_de_la_piece' })
    expect(associable(rejet)).toBe(true)
    expect(phraseDeLEtat(rejet)).toMatch(/comme son rejet/)
    expect(etatDeLaProposition({ piece_id: 'prime' }, contexte({ paiementsDeLaPiece: [{ date: '2025-12-20', montant: -1200 }] })).etat)
      .toBe('piece_rapprochee_ailleurs')
    const reprise = etatDeLaProposition({ piece_id: 'prime' }, contexte({
      restesARegler: new Map([['prime', 1200]]),
      paiementsDeLaPiece: [{ date: '2025-12-20', montant: -1200 }, { date: '2025-12-28', montant: 1200 }],
    }))
    expect(reprise).toEqual({ etat: 'reprise_d_un_rejet', reste: 1200, refus: null })
    expect(associable(reprise)).toBe(true)
    expect(phraseDeLEtat(reprise)).toBe(`Le paiement de cette pièce a été rejeté : ce mouvement en serait la reprise (${formatMoney(1200)}).`)
    expect(associable({ etat: 'reprise_d_un_rejet', reste: 1200, refus: 'Non.' })).toBe(false)
  })
})

// UN MOUVEMENT SE RAPPROCHE DANS SON COMPTE (lot MCB3, lib/virementsInternes.ts) : la banque rejette un prélèvement sur le
// compte qui l'a payé. Sans compte d'un côté ou de l'autre (la migration `comptes_bancaires` pas appliquée), rien ne change.
describe('MCB3 — le rejet ne défait qu’un paiement de son compte', () => {
  it('le paiement d’un autre compte du dossier ne se propose pas ; celui du même compte, si', () => {
    const debitA = { ...DEBIT, compte_bancaire_id: 'A' }
    const p = paiements([debitA])
    expect(piecesDuRejet({ ...REJET, compte_bancaire_id: 'B' }, [piece()], p, new Set())).toEqual([])
    expect(rejetPossible({ ...REJET, compte_bancaire_id: 'B' }, [piece()], p)).toBe(false)
    expect(piecesDuRejet({ ...REJET, compte_bancaire_id: 'A' }, [piece()], p, new Set()).map((c) => c.piece.id)).toEqual(['prime'])
    expect(rejetPossible({ ...REJET, compte_bancaire_id: 'A' }, [piece()], p)).toBe(true)
  })

  it('sans compte, comme hier — et le paiement ne porte la clé que si la ligne la porte', () => {
    expect(Object.keys(paiements([DEBIT]).get('prime')![0])).not.toContain('compte_bancaire_id')
    expect(piecesDuRejet(REJET, [piece()], paiements([{ ...DEBIT, compte_bancaire_id: 'A' }]), new Set())).toHaveLength(1)
    expect(piecesDuRejet({ ...REJET, compte_bancaire_id: 'B' }, [piece()], paiements([DEBIT]), new Set())).toHaveLength(1)
  })
})
