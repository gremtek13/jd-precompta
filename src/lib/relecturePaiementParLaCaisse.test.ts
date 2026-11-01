import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculerDeclaration2035 } from './declaration2035'
import { concordance2035 } from './concordance2035'
import { COMPTE_BANQUE } from './comptes'
import { ecritureDeLOperation } from './caisse'
import type { ContexteDeLaCaisse, DonneesDeLaCaisse } from './caisseEcran'
import { OPERATIONS_DE_CAISSE_ABSENTES, type OperationsDeCaisse } from './controlesDeLaCaisse'
import { analyserEcritures, lignesPourPiece, type LigneAGenerer } from './ecritures'
import type { ModeleComptable } from './engagement'
import { CHAMPS_BNC_NON_EXPORTES, numeroterFec } from './fec'
import { verdictDuReglement } from './paiementParLaCaisseEcran'
import { paiementsParLaCaisseSelon } from './paiementParLaCaisse'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { prealablesDeValidation, type DonneesDeValidation } from './prealablesValidation'
import { paiementsDesPieces } from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { piecesPayeesEnPartie } from './controles'
import type { Categorie, EcritureBrouillon, LigneBancaire, OperationCaisse, Piece } from './types'
import { defautsDeNumerotation } from './validationExercice'
import { NON_VALIDEE } from '../test/ecritures'
import { SANS_FACTURE_SOURCE, SANS_EXEMPLAIRE, SANS_ECRITURE_DE_VENTE, ventesFactureesVides } from '../test/ventesFacturees'

// RELECTURE INDÉPENDANTE DU PAIEMENT D'UNE PIÈCE PAR LA CAISSE (ligne 26.6, lots C8, C9a et C9b ; CAISSE-Q4, (B)), AVANT QUE
// LE DRAPEAU NE SE LÈVE. Chaque `it.fails` prouve un défaut confirmé, le drapeau `PAIEMENT_PAR_LA_CAISSE_EXPORTE` LEVÉ (l'état
// du jour de la migration) : le test dit ce qui DEVRAIT être, et échoue aujourd'hui. Les cas ordinaires qui l'entourent sont
// ses témoins : ils montrent que le jeu d'essai est juste, et que seul le paiement par la caisse fait la différence. Des
// données FICTIVES. L'essai de la base qui les accompagne (validation, centime, pièce à valider) est rejoué sur une réplique,
// jamais en production.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('./paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('./paiementParLaCaisse')>()
  return {
    ...module,
    get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeau.leve },
    paiementsParLaCaisse: (operations: Parameters<typeof module.paiementsParLaCaisse>[0]) =>
      module.paiementsParLaCaisseSelon(drapeau.leve, operations),
  }
})
afterEach(() => { drapeau.leve = true })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
const ACHATS: Categorie = {
  id: 'c-achats', dossier_id: null, code: 'achats', libelle: 'Achats', ordre: 1, compte_comptable: '606100', poste_2035: 'Achats',
}
const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${id}.pdf`, nom_fichier: `${id}.pdf`,
  storage_hash: null, date_piece: '2025-03-10', tiers: 'Fournisseur', montant_ht: null, montant_tva: null, montant_ttc: 120,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c-achats',
  sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null,
  flux_id: null, lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
  facture_id: null, vente_hors_des_factures: false, created_at: '2025-03-10T09:00:00Z', updated_at: '2025-03-10T09:00:00Z', ...o,
})
const ligne = (id: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id, dossier_id: 'd1', date: '2025-03-12', libelle: 'PRLV FOURNISSEUR', montant: -120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve-2025.pdf', libelle_brut: null,
  created_at: '2025-04-01T09:00:00Z', encaissements_de_factures: false, ...o,
})
const ecriture = (id: string, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-12', compte: '606100', libelle: 'Fournisseur',
  montant: 120, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
  cotisation_id: null, ...NON_VALIDEE, created_at: '2025-04-01T09:00:00Z', encaissement_id: null, facture_id: null, ...o,
})
const operation = (o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse => ({
  dossier_id: 'd1', genre: 'apport', date: '2025-01-02', montant: 100, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
  piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2025-01-02T18:00:00Z', cree_par: null, retire_le: null,
  retire_par: null, ...o,
})
// L'écriture que la base compose pour un apport ou un prélèvement, telle qu'elle arrive au brouillon.
const lignesDeLOperation = (o: OperationCaisse): EcritureBrouillon[] => ecritureDeLOperation({
  genre: o.genre as 'apport', date: o.date, montant: o.montant, taux_tva: null, categorie: null,
}, TRESORERIE).map((l, i) => ecriture(`${o.id}-${i}`, {
  piece_id: null, date: o.date, compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle, operation_caisse_id: o.id,
}))
const caisseLue = (operations: OperationCaisse[]): OperationsDeCaisse => ({ etat: 'lue', dossierId: 'd1', operations })
let n = 0
const auBrouillon = (lignes: readonly LigneAGenerer[]): EcritureBrouillon[] => lignes.map((l) => ecriture(`g${++n}`, {
  piece_id: l.piece_id, ligne_bancaire_id: l.ligne_bancaire_id ?? null, operation_caisse_id: l.operation_caisse_id ?? null,
  date: l.date, compte: l.compte, libelle: l.libelle, montant: l.montant, sens: l.sens,
}))
const solde = (lignes: readonly Pick<EcritureBrouillon, 'sens' | 'montant'>[]) =>
  lignes.reduce((s, l) => s + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100), 0)

// ── Le dossier de 2025 que la validation juge : celui des préalables (lib/prealablesValidation.test.ts), et sa caisse ──────
const P1 = piece('p1')
const L1 = ligne('l1', { piece_id: 'p1' })
const E1 = ecriture('e1')
const E2 = ecriture('e2', { compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l1' })
type Surcharges = Partial<Omit<DonneesDeValidation, 'declaration' | 'concordance'>>
function donnees(o: Surcharges = {}): DonneesDeValidation {
  const base: Omit<DonneesDeValidation, 'declaration' | 'concordance'> = {
    annee: 2025, anneeCourante: 2026, aujourdHui: '2026-03-15', modele: TRESORERIE, assujettiTva: false,
    anneesValidees: [], lectureIncomplete: null, piecesValidees: [P1], piecesAValider: [], categories: [ACHATS],
    immobilisations: [], natures: [], ecritures: [E1, E2], lignes: [L1], ventilations: [], reglements: [], encaissees: [], cotisations: [],
    vehicules: [], emprunts: [], aNouveaux: [], soldesReportes: [], declarationsTva: [], periodiciteTva: 'trimestrielle', relevesIncoherents: [],
    doublonsTexte: [], facturesEmises: [], transmissions: [], facturesSources: SANS_FACTURE_SOURCE,
    etatsDesVentes: { etat: 'sans_objet' }, ventesDeLaChecklist: { etat: 'sans_objet' }, operationsDeCaisse: OPERATIONS_DE_CAISSE_ABSENTES, ...o,
  }
  // La 2035 comme Clôture la calcule, la caisse comprise : ses paiements datent les pièces qu'ils règlent.
  const operations = base.operationsDeCaisse?.etat === 'lue' ? base.operationsDeCaisse.operations : []
  const paiements = paiementsDesPieces(base.lignes, base.reglements, base.encaissees, paiementsParLaCaisseSelon(drapeau.leve, operations))
  const declaration = calculerDeclaration2035(
    base.annee, [...base.piecesValidees], [...base.categories], [...base.immobilisations], [], [...base.vehicules],
    base.assujettiTva, paiements, [], base.declarationsTva, PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
    { etat: 'sans_bascule' }, CAISSE_ABSENTE,
  )
  const concordance = concordance2035(
    declaration, base.ecritures,
    { piecesValidees: new Set(base.piecesValidees.map((p) => p.id)), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: new Set() },
    null,
  )
  return { ...base, declaration, concordance }
}
const bloquants = (d: DonneesDeValidation) => prealablesDeValidation(d).prealables.filter((p) => p.bloquant).map((p) => p.id)

// ══ DÉFAUT 1 — UNE PIÈCE ENCORE À VALIDER, PAYÉE PAR LA CAISSE DANS L'EXERCICE, NE RETIENT PAS SA VALIDATION ══════════════
// La conception reprise (§ 8, « Les préalables de la validation ») le demandait : « `pieces-a-valider` attrape la pièce à
// valider qu'un paiement cite ». Le préalable ne juge que la DATE DE LA PIÈCE (`dansLaPeriodeTenue(p.date_piece)`) : une facture
// de décembre 2024 (exercice déjà validé, ou arrivée après), ou un acompte payé en décembre pour une facture datée de janvier,
// payée en espèces dans l'exercice, laisse l'exercice se valider. Ses espèces sont sorties de la caisse (le journal et la base les
// comptent), mais ni sa charge ni sa contrepartie ne sont au brouillon, ni sa dépense dans la 2035 : le 53 reporté au 1er janvier
// dépasse la caisse du montant du paiement, et rien ne le rattrape ensuite — la pièce validée après coup s'écrirait à la date du
// paiement, figée (« aucune écriture ne s'y passe plus »), et le paiement ne se retire plus. L'essai de la base le joue (dossier
// Z : « reporté : debit 100.00 / la caisse : 20 », puis les deux refus de la frontière).
describe('défaut 1 — la pièce à valider qu’un paiement par la caisse de l’exercice cite', () => {
  const APPORT = operation({ id: 'oc-apport', date: '2025-01-02', montant: 100 })
  // La facture de décembre 2024 arrivée après la validation de 2024 (déposée le 03/02/2025) ; l'acompte de décembre 2025 d'une
  // facture datée du 10/01/2026 (déposée le 12/01/2026).
  const DE_2024 = piece('pz', { statut: 'a_valider', date_piece: '2024-12-20', montant_ttc: 80, created_at: '2025-02-03T09:00:00Z' })
  const DE_2026 = piece('pz', { statut: 'a_valider', date_piece: '2026-01-10', montant_ttc: 80, created_at: '2026-01-12T09:00:00Z' })
  const avecLeJeu = (pieceAValider: Piece, paiement: OperationCaisse | null, anneesValidees: number[]) => donnees({
    anneesValidees,
    piecesAValider: [pieceAValider],
    operationsDeCaisse: caisseLue(paiement ? [APPORT, paiement] : [APPORT]),
    ecritures: [E1, E2, ...lignesDeLOperation(APPORT)],
  })

  it('témoin : sans le paiement, chaque jeu est validable ; datée de l’exercice, la pièce à valider retient la validation', () => {
    expect(bloquants(avecLeJeu(DE_2024, null, [2024]))).toEqual([])
    expect(bloquants(avecLeJeu(DE_2026, null, []))).toEqual([])
    expect(bloquants(avecLeJeu({ ...DE_2024, date_piece: '2025-01-03' }, null, [2024]))).toEqual(['pieces-a-valider'])
  })

  it('témoin : la 2035 de 2025 ne compte pas la pièce à valider, et les écritures de 2025 n’en portent rien', () => {
    const paiement = operation({ id: 'oc-pz', genre: 'paiement', piece_id: 'pz', date: '2025-01-05', montant: -80 })
    const d = avecLeJeu(DE_2024, paiement, [2024])
    expect(d.declaration!.totalDepenses).toBe(120)
    expect(d.ecritures.filter((e) => e.piece_id === 'pz')).toEqual([])
  })

  it.fails('PROUVE : payée 80 € par la caisse le 05/01/2025, la facture de 2024 encore à valider laisse valider 2025 sans sa dépense ni sa contrepartie', () => {
    const paiement = operation({ id: 'oc-pz', genre: 'paiement', piece_id: 'pz', date: '2025-01-05', montant: -80 })
    expect(bloquants(avecLeJeu(DE_2024, paiement, [2024])).length).toBeGreaterThan(0)
  })

  it.fails('PROUVE : de même pour l’acompte payé en espèces le 28/12/2025 d’une facture datée du 10/01/2026, encore à valider', () => {
    const paiement = operation({ id: 'oc-pz', genre: 'paiement', piece_id: 'pz', date: '2025-12-28', montant: -80 })
    expect(bloquants(avecLeJeu(DE_2026, paiement, [])).length).toBeGreaterThan(0)
  })
})

// ══ DÉFAUT 2 — UN PAIEMENT PAR LA CAISSE DANS LE SEUIL D'ALIGNEMENT, MAIS PAS AU CENTIME, LAISSE UNE ÉCRITURE QUI NE S'ÉQUILIBRE
// JAMAIS ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// La banque fait foi sous un seuil (décision du cabinet du 23/09/2026) : un rapprochement aligne la pièce sur le TOTAL de ses
// paiements (`reglerPieceSurBanque`, la caisse comprise parmi les « autres », BanqueTab `reglerSiLibre`), parce qu'« une pièce de
// 40 € payée 20 + 19,99 gardait un centime que rien n'écrit, qui déséquilibrait son écriture et faisait refuser la validation de
// son exercice, sans qu'aucun geste puisse le réparer » (lib/reglementBanque.ts). Le chemin de la caisse ne l'aligne pas : la
// fiche accepte 39,99 € pour une pièce de 40,00 € (`verdictDuReglement` : permis, aucun mot), la base aussi (le plafond est le
// montant de la pièce), `partsDesPaiements` tient la pièce pour réglée (reste 0,01 ≤ seuil), la génération écrit la charge
// ENTIÈRE (40,00) face à 39,99 de caisse — et « Régénérer » réécrit la même chose. L'onglet Écritures ne le voit pas (tolérance
// de 2 centimes), « payée en partie » non plus ; la numérotation de la validation le refuse au centime, comme la base
// (essai, dossier Y : « Une écriture n'est pas équilibrée au centime. »). La 2035 compte 40,00 de dépense pour 39,99 sortis.
describe('défaut 2 — un paiement par la caisse d’un centime de moins que la pièce', () => {
  const PIECE = piece('pc', { date_piece: '2026-03-10', montant_ttc: 40 })
  const APPORT = operation({ id: 'oc-apport', date: '2026-03-01', montant: 100 })
  const ctx: ContexteDeLaCaisse = { modele: TRESORERIE, assujettiTva: false, aujourdhui: '2026-03-15', anneesValidees: [] }
  const donneesDeLaCaisse: DonneesDeLaCaisse = {
    operations: [APPORT], ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' }, categories: [], piecesPayees: [],
  }
  const ecrituresApres = (montant: number) => {
    const paiement = operation({ id: 'oc-pc', genre: 'paiement', piece_id: 'pc', date: '2026-03-12', montant })
    const p = paiementsDesPieces([], [], [], paiementsParLaCaisseSelon(true, [APPORT, paiement]))
    return { paiement, p, lignes: lignesPourPiece('d1', PIECE, { compte: '606100', immobilisation: false }, false, p.get('pc') ?? [], TRESORERIE) }
  }

  it('témoin : la fiche accepte 39,99 € ; payée de 40,00 € juste, l’écriture s’équilibre', () => {
    const verdict = verdictDuReglement({ date: '2026-03-12', montant: '-39,99' }, ctx, donneesDeLaCaisse,
      { id: 'pc', type_piece: 'achat', statut: 'validee', montant_ttc: 40, exemplaire: null })
    expect(verdict.etat).toBe('permis')
    expect(solde(ecrituresApres(-40).lignes)).toBe(0)
  })

  it('témoin : 39,99 € — l’onglet Écritures et « payée en partie » se taisent, la numérotation de la validation le refuse', () => {
    const { p, lignes } = ecrituresApres(-39.99)
    const brouillon = auBrouillon(lignes)
    expect(analyserEcritures(brouillon, [{ piece: PIECE, compte: '606100', immobilisation: false }], false, p, TRESORERIE, null, SANS_EXEMPLAIRE)
      .groupesDesequilibres).toEqual([])
    expect(piecesPayeesEnPartie([PIECE], p, 'tresorerie')).toEqual([])
    const defauts = defautsDeNumerotation(numeroterFec(brouillon, [PIECE], [ACHATS], [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE,
      caisseLue([APPORT]), CHAMPS_BNC_NON_EXPORTES))
    expect(defauts.map((d) => d.type)).toEqual(['desequilibre'])
  })

  it.fails('PROUVE : un paiement par la caisse que la fiche accepte (39,99 € pour 40,00 €) laisse une écriture équilibrée au centime', () => {
    expect(solde(ecrituresApres(-39.99).lignes)).toBe(0)
  })
})
