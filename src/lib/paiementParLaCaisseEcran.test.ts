import { afterEach, describe, expect, it, vi } from 'vitest'
import { jugerLeReglementSelon, MOTS_DU_PAIEMENT } from './paiementParLaCaisse'
import {
  confirmationDuReglement, confirmationDuRetraitDuPaiement, especesEntrent, etatDeLaCaisseDeLaFiche, montantPropose,
  paiementNomme, paiementsDeLaLecture, paiementsDeLaPiece, pieceDuPaiement, piecesPayeesEnEspeces, refusDeLaDesignationParLaCaisse,
  refusDuRetraitDuPaiement, refusDuTypeDeLaPiece, resteARegler, saisieDuReglement, suppressionRetenueParLaCaisse, verdictDuReglement,
  type LectureDeLaCaisseDeLaPiece,
} from './paiementParLaCaisseEcran'
import { dossierDeLEcran, MONTANT_ILLISIBLE, type ContexteDeLaCaisse, type DonneesDeLaCaisse } from './caisseEcran'
import type { ModeleComptable } from './engagement'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { PaiementDePiece } from './rattachement'
import type { OperationCaisse, Piece } from './types'

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, À L'ÉCRAN DU CABINET (ligne 26.6, étape C9b ; lib/paiementParLaCaisseEcran.ts). Ce module
// ne recopie aucune règle : ces cas gardent qu'il ASSEMBLE bien — la caisse de la fiche selon le drapeau et la lecture, les paiements
// d'une pièce, le reste à régler signé comme le relevé, la saisie telle qu'elle PART et le verdict de `jugerLeReglementSelon` sans
// un mot de plus ni de moins, les confirmations qui nomment, et les refus de la garde de la pièce. Le drapeau joué dans ses deux
// états par un accesseur (`vi.mock`) : le module le lit à chaque appel. Des jeux FICTIFS.

const drapeau = vi.hoisted(() => ({ leve: null as boolean | null }))
vi.mock('./paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('./paiementParLaCaisse')>()
  return { ...module, get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeau.leve ?? module.PAIEMENT_PAR_LA_CAISSE_EXPORTE } }
})
afterEach(() => { drapeau.leve = null })

const D = 'd1'
const MODELE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const CAISSE = PLAN_PAR_DEFAUT.caisse
const CTX: ContexteDeLaCaisse = { modele: MODELE, assujettiTva: false, aujourdhui: '2026-10-29', anneesValidees: [] }

function operation(o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse {
  return {
    dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 100, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}
function donnees(o: Partial<DonneesDeLaCaisse> = {}): DonneesDeLaCaisse {
  return { operations: [], ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' }, categories: [], piecesPayees: [], ...o }
}
// Les espaces insécables du format monétaire (U+00A0, U+202F), ramenés à l'espace : le texte se compare à la lettre.
const sansInsecable = (t: string) => t.split(String.fromCharCode(0xa0)).join(' ').split(String.fromCharCode(0x202f)).join(' ')
const lue = (d: DonneesDeLaCaisse, dossierId = D): LectureDeLaCaisseDeLaPiece => ({ dossierId, etat: 'lue', donnees: d })

type PieceDeTest = Pick<Piece, 'id' | 'dossier_id' | 'type_piece' | 'statut' | 'montant_ttc' | 'facture_id' | 'devise' | 'nom_fichier'>
const ACHAT: PieceDeTest = { id: 'p1', dossier_id: D, type_piece: 'achat', statut: 'validee', montant_ttc: 120, facture_id: null, devise: 'EUR', nom_fichier: 'fournitures.pdf' }
const VENTE: PieceDeTest = { ...ACHAT, id: 'p2', type_piece: 'vente', montant_ttc: 80, nom_fichier: 'note.pdf' }
// 200 € d'apport le 1er mars : de quoi payer.
const APPORT = operation({ id: 'ap', genre: 'apport', date: '2026-03-01', montant: 200 })
const PAYE = operation({ id: 'pa', genre: 'paiement', date: '2026-03-05', montant: -50, piece_id: 'p1' })

describe('la caisse de la fiche, selon le drapeau et la lecture', () => {
  it('le drapeau BAISSÉ : absente, quelle que soit la lecture — aucun paiement, aucune lecture attendue', () => {
    drapeau.leve = false
    expect(etatDeLaCaisseDeLaFiche(lue(donnees({ operations: [APPORT, PAYE] })), D)).toEqual({ etat: 'absente' })
    expect(etatDeLaCaisseDeLaFiche(null, D)).toEqual({ etat: 'absente' })
    expect(paiementsDeLaLecture(lue(donnees({ operations: [APPORT, PAYE] })), D)).toEqual([])
    expect(paiementsDeLaLecture(null, D)).toEqual([])
  })

  it('levé : en attente sans lecture ou pour un autre dossier ; incomplète dite ; absente si la table ne l’est pas ; sinon lue', () => {
    drapeau.leve = true
    expect(etatDeLaCaisseDeLaFiche(null, D)).toEqual({ etat: 'en_attente' })
    expect(etatDeLaCaisseDeLaFiche(lue(donnees(), 'autre'), D)).toEqual({ etat: 'en_attente' })
    expect(etatDeLaCaisseDeLaFiche({ dossierId: D, etat: 'incomplete', motif: 'coupée' }, D)).toEqual({ etat: 'incomplete', motif: 'coupée' })
    expect(etatDeLaCaisseDeLaFiche({ dossierId: D, etat: 'absente' }, D)).toEqual({ etat: 'absente' })
    expect(etatDeLaCaisseDeLaFiche(lue(donnees()), D).etat).toBe('lue')
  })

  it('levé : les paiements vivants seulement ; nuls sur une lecture partielle ou pas revenue — jamais « aucun »', () => {
    drapeau.leve = true
    const retire = operation({ id: 'pr', genre: 'paiement', date: '2026-03-06', montant: -10, piece_id: 'p1', retire_le: '2026-03-07T00:00:00Z' })
    expect(paiementsDeLaLecture(lue(donnees({ operations: [APPORT, PAYE, retire] })), D))
      .toEqual([{ operation_caisse_id: 'pa', piece_id: 'p1', date: '2026-03-05', montant: -50 }])
    expect(paiementsDeLaLecture(null, D)).toBeNull()
    expect(paiementsDeLaLecture({ dossierId: D, etat: 'incomplete', motif: 'x' }, D)).toBeNull()
    expect(paiementsDeLaLecture(lue(donnees(), 'autre'), D)).toBeNull()
    expect(paiementsDeLaLecture({ dossierId: D, etat: 'absente' }, D)).toEqual([])
    expect([...piecesPayeesEnEspeces([{ operation_caisse_id: 'pa', piece_id: 'p1', date: '2026-03-05', montant: -50 }])]).toEqual(['p1'])
  })
})

describe('les paiements d’une pièce, et ce qui en reste à régler', () => {
  it('les paiements qui la citent, retirés compris, dans l’ordre des jours ; nommés sans tiers', () => {
    const autre = operation({ id: 'px', genre: 'paiement', date: '2026-03-02', montant: -5, piece_id: 'p9' })
    const premier = operation({ id: 'pb', genre: 'paiement', date: '2026-03-02', montant: -20, piece_id: 'p1', retire_le: '2026-03-03T00:00:00Z' })
    expect(paiementsDeLaPiece('p1', [PAYE, APPORT, autre, premier]).map((o) => o.id)).toEqual(['pb', 'pa'])
    expect(paiementNomme(PAYE)).toMatch(/^le paiement en espèces du 05\/03\/2026 de 50,00.€$/)
    expect(paiementNomme({ date: '2026-03-05', montant: 30 })).toMatch(/^l’encaissement en espèces du 05\/03\/2026 de 30,00.€$/)
  })

  it('le reste : le montant moins le total SIGNÉ de tous les paiements ; inconnu sur une lecture partielle, une devise, un montant non lu', () => {
    const paiements: PaiementDePiece[] = [
      { id: 'm1', date: '2026-03-01', montant: -40, origine: 'rapprochement' },
      { operation_caisse_id: 'pa', date: '2026-03-05', montant: -50, origine: 'caisse' },
    ]
    expect(resteARegler(ACHAT, paiements)).toBe(3000)
    expect(resteARegler(ACHAT, [])).toBe(12000)
    expect(resteARegler(ACHAT, null)).toBeNull()
    expect(resteARegler({ ...ACHAT, devise: 'USD' }, [])).toBeNull()
    expect(resteARegler({ ...ACHAT, montant_ttc: null }, [])).toBeNull()
    expect(resteARegler(ACHAT, [{ id: 'm', date: '2026-03-01', montant: -150, origine: 'rapprochement' }])).toBe(0)
  })

  it('le montant proposé est signé comme le relevé : négatif quand les espèces sortent, l’inverse pour un avoir ; rien sans reste', () => {
    expect(montantPropose(ACHAT, [])).toBe('-120,00')
    expect(montantPropose(VENTE, [])).toBe('80,00')
    expect(montantPropose({ ...ACHAT, montant_ttc: -15.5 }, [])).toBe('15,50')
    expect(montantPropose({ ...VENTE, montant_ttc: -15.05 }, [])).toBe('-15,05')
    expect(montantPropose(ACHAT, null)).toBe('')
    expect(montantPropose(ACHAT, [{ id: 'm', date: '2026-03-01', montant: -120, origine: 'rapprochement' }])).toBe('')
    expect([especesEntrent(ACHAT), especesEntrent(VENTE)]).toEqual([false, true])
  })
})

describe('la pièce telle que la fonction la lit', () => {
  it('l’enregistrée, et la facture qu’elle désigne lue en entier ; sinon illisible, sans rien deviner', () => {
    expect(pieceDuPaiement(ACHAT, null)).toEqual({ piece: { id: 'p1', type_piece: 'achat', statut: 'validee', montant_ttc: 120, exemplaire: null } })
    const designee = { ...VENTE, facture_id: 'f1' }
    const f = { id: 'f1', numero: 'F-1', source_de_la_vente: true }
    expect(pieceDuPaiement(designee, { lignes: [f], complete: true, motif: null }))
      .toMatchObject({ piece: { exemplaire: { numero: 'F-1', source_de_la_vente: true } } })
    expect(pieceDuPaiement(designee, null)).toEqual({ illisible: 'les factures émises du dossier ne sont pas encore lues' })
    expect(pieceDuPaiement(designee, { lignes: [f], complete: false, motif: 'coupée' })).toEqual({ illisible: 'les factures émises du dossier : coupée' })
    expect(pieceDuPaiement(designee, { lignes: [], complete: true, motif: null }))
      .toEqual({ illisible: 'la facture dont cette pièce est l’exemplaire n’est pas dans les factures lues' })
  })
})

describe('le verdict avant le clic, sur la saisie telle qu’elle part', () => {
  const d = donnees({ operations: [APPORT] })
  const piece = { id: 'p1', type_piece: 'achat' as const, statut: 'validee' as const, montant_ttc: 120, exemplaire: null }

  it('le drapeau baissé : absent, sans rien juger', () => {
    drapeau.leve = false
    expect(verdictDuReglement({ date: '2026-03-05', montant: '-50' }, CTX, d, piece)).toEqual({ etat: 'absent' })
  })

  it('levé : vide sans date ni montant, illisible, puis le refus du module sous ses mots, au caractère près', () => {
    drapeau.leve = true
    expect(verdictDuReglement({ date: '', montant: '-50' }, CTX, d, piece)).toEqual({ etat: 'vide' })
    expect(verdictDuReglement({ date: '2026-03-05', montant: ' ' }, CTX, d, piece)).toEqual({ etat: 'vide' })
    expect(verdictDuReglement({ date: '2026-03-05', montant: 'douze' }, CTX, d, piece)).toEqual({ etat: 'illisible', message: MONTANT_ILLISIBLE })
    // Le sens : une pièce d'achat fait sortir des espèces.
    expect(verdictDuReglement({ date: '2026-03-05', montant: '50' }, CTX, d, piece)).toEqual({ etat: 'refuse', message: MOTS_DU_PAIEMENT.sens.gabarit })
    // Exactement le refus de `jugerLeReglementSelon`, sur la saisie qui part.
    for (const f of [{ date: '2026-03-05', montant: '-300' }, { date: '2027-01-01', montant: '-10' }, { date: '2026-03-05', montant: '-130' }]) {
      const v = verdictDuReglement(f, CTX, d, piece)
      const j = jugerLeReglementSelon(true, saisieDuReglement(f, 'p1'), dossierDeLEcran(CTX, d), [piece], 'x')
      expect(v).toEqual({ etat: 'refuse', message: j.etat === 'refuse' ? j.refus.message : 'pas un refus' })
    }
  })

  it('levé : permis — la saisie qui part (la pièce, la date, le montant lu), l’opération écrite et la caisse de son jour', () => {
    drapeau.leve = true
    const v = verdictDuReglement({ date: '2026-03-05', montant: '-50,00' }, CTX, d, piece)
    expect(v).toMatchObject({ etat: 'permis', saisie: { piece_id: 'p1', date: '2026-03-05', montant: -50 }, soldeDuJour: 15000 })
    if (v.etat !== 'permis') return
    expect(v.operation).toMatchObject({ genre: 'paiement', piece_id: 'p1', date: '2026-03-05', montant: -50, origine: 'cabinet' })
    const texte = sansInsecable(confirmationDuReglement('fournitures.pdf', v, CAISSE))
    expect(texte).toBe(`Régler la pièce « fournitures.pdf » par la caisse : le paiement en espèces du 05/03/2026 de 50,00 € ? `
      + `La caisse du 05/03/2026 passera à 150,00 €. Sa contrepartie au compte de la caisse (${CAISSE}) s’écrit avec les écritures `
      + 'de la pièce : déjà générées, elles seront à régénérer (Écritures).')
  })

  it('une saisie sans date part sans date ; un montant illisible part nul', () => {
    expect(saisieDuReglement({ date: '', montant: 'x' }, 'p1')).toEqual({ piece_id: 'p1', date: null, montant: null })
  })
})

describe('le retrait d’un paiement', () => {
  it('le refus de la fonction de la caisse ; la confirmation nomme le paiement, sa contrepartie, la caisse du jour', () => {
    drapeau.leve = true
    const d = donnees({ operations: [APPORT, PAYE] })
    expect(refusDuRetraitDuPaiement('pa', CTX, d)).toBeNull()
    expect(refusDuRetraitDuPaiement('inconnue', CTX, d)).not.toBeNull()
    expect(refusDuRetraitDuPaiement('pa', { ...CTX, anneesValidees: [2026] }, d)).toMatch(/validé/)
    expect(sansInsecable(confirmationDuRetraitDuPaiement(PAYE, CTX, d))).toBe(
      'Retirer le paiement en espèces du 05/03/2026 de 50,00 € ? La pièce n’est plus payée par la caisse ce jour-là ; la '
      + 'contrepartie de ses écritures est retirée avec lui (rien ne se supprime : le paiement reste dans l’historique), et la '
      + 'caisse du 05/03/2026 passera à 200,00 €.')
    // Retirer l'encaissement en espèces d'une vente qu'un prélèvement a suivi : la caisse passerait sous zéro.
    const encaisse = operation({ id: 'pv', genre: 'paiement', date: '2026-03-02', montant: 80, piece_id: 'p2' })
    const sortie = operation({ id: 'pl', genre: 'prelevement', date: '2026-03-03', montant: 250 })
    expect(refusDuRetraitDuPaiement('pv', CTX, donnees({ operations: [APPORT, encaisse, sortie] }))).toMatch(/^Retirer ce paiement de 80,00 €/)
  })
})

describe('la pièce qu’un paiement cite', () => {
  const ops = [PAYE]
  it('le type : une pièce payée reste d’achat ou de vente, sous les mots de la garde ; rien si le type ne change pas', () => {
    expect(refusDuTypeDeLaPiece(ACHAT, 'achat', ops)).toBeNull()
    expect(refusDuTypeDeLaPiece(ACHAT, 'vente', ops)).toBeNull()
    expect(refusDuTypeDeLaPiece(ACHAT, 'note_frais', ops)).toBe(MOTS_DU_PAIEMENT.piece_change_de_type.gabarit)
    expect(refusDuTypeDeLaPiece(ACHAT, 'autre', [{ ...PAYE, retire_le: '2026-03-06T00:00:00Z' }])).toBeNull()
  })

  it('la désignation : une facture SOURCE, refusée sous ses mots et son numéro ; une autre, non', () => {
    const vente = { ...VENTE, id: 'p1' }
    expect(refusDeLaDesignationParLaCaisse(vente, { id: 'f1', numero: 'F-1', source_de_la_vente: true }, ops))
      .toBe(MOTS_DU_PAIEMENT.piece_devient_exemplaire.gabarit.replace('%', 'F-1'))
    expect(refusDeLaDesignationParLaCaisse(vente, { id: 'f2', numero: 'F-2', source_de_la_vente: false }, ops)).toBeNull()
    expect(refusDeLaDesignationParLaCaisse(vente, null, ops)).toBeNull()
  })

  it('la suppression : retenue par tout paiement qui la cite, retiré ou non ; libre sans', () => {
    expect(suppressionRetenueParLaCaisse('p1', ops)).toMatch(/^Cette pièce est payée par la caisse : elle ne se supprime pas/)
    expect(suppressionRetenueParLaCaisse('p1', [{ ...PAYE, retire_le: '2026-03-06T00:00:00Z' }])).toMatch(/^Un paiement de la caisse, retiré, cite cette pièce/)
    expect(suppressionRetenueParLaCaisse('p9', ops)).toBeNull()
  })
})
