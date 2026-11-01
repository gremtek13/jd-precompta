import { afterEach, describe, expect, it, vi } from 'vitest'
import { valeursDesCases } from './cases2035'
import type { EtatDeLaCaisse } from './caisse'
import { OPERATIONS_DE_CAISSE_ABSENTES, type OperationsDeCaisse } from './controlesDeLaCaisse'
import { calculerDeclaration2035 } from './declaration2035'
import { calculerCa3 } from './declarationTva'
import {
  analyserEcritures, ecrituresAGenerer, ecrituresSansObjet, ligneContrepartieCaisse, lignesPourPiece, type LigneAGenerer,
  type PieceAComptabiliser,
} from './ecritures'
import type { ModeleComptable } from './engagement'
import { CHAMPS_BNC_NON_EXPORTES, genererFec, type EntreesDesChampsBnc } from './fec'
import { partsDesReglementsALaDate } from './champsBncDuFec'
import { lettrages } from './lettrage'
import {
  contrepartieDuPaiement, PAIEMENT_PAR_LA_CAISSE_EXPORTE, paiementsParLaCaisse, paiementsParLaCaisseDuDossierSelon,
  paiementsParLaCaisseSelon, refusDeLaContrepartie,
} from './paiementParLaCaisse'
import { partsDuReleve } from './partsDuReleve'
import { absenceFec, pisteAudit, rupturesPisteAudit } from './pisteAudit'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import {
  AUCUN_PAIEMENT_PAR_LA_CAISSE, cleDuPaiement, paiementsDesPieces, rattachements, type PaiementsDesPieces, type PartPayeeParLaCaisse,
} from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { piecesPayeesEnTrop, refusSecondPaiement, resteARegler } from './reglementGroupe'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { Categorie, EcritureBrouillon, LigneBancaire, OperationCaisse, Piece } from './types'
import { colonnes, desequilibresDgfip } from '../test/fecDgfip'
import { NON_VALIDEE } from '../test/ecritures'
import { tirage } from '../test/encaissementsBatterie'
import { SANS_ECRITURE_DE_VENTE, SANS_EXEMPLAIRE, SANS_FACTURE_SOURCE, SANS_VENTE_FACTUREE, ventesFactureesVides } from '../test/ventesFacturees'

// LE DRAPEAU, ÉCRIT : un accesseur sous `vi.mock`, BAISSÉ par défaut — l'état d'aujourd'hui, quelle que soit la valeur du module,
// que la migration lèvera — et `paiementsParLaCaisse`, la dérivation selon le drapeau, qui le suit (son corps lit la constante
// du module, que l'accesseur ne touche pas). `null` : la valeur du module ; le cas « la dérivation suit la constante du
// module » garde que le vrai `paiementsParLaCaisse` est bien `paiementsParLaCaisseSelon` sous elle.
const drapeau = vi.hoisted(() => ({ leve: false as boolean | null }))
vi.mock('./paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('./paiementParLaCaisse')>()
  return {
    ...module,
    get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeau.leve ?? module.PAIEMENT_PAR_LA_CAISSE_EXPORTE },
    paiementsParLaCaisse: (operations: Parameters<typeof module.paiementsParLaCaisse>[0]) =>
      module.paiementsParLaCaisseSelon(drapeau.leve ?? module.PAIEMENT_PAR_LA_CAISSE_EXPORTE, operations),
  }
})
afterEach(() => { drapeau.leve = false })

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, DANS LES MOTEURS (ligne 26.6, étape C9a ; CAISSE-Q4, (B)). Une opération de genre
// `paiement` qui cite sa pièce est un paiement de cette pièce, à SA date et de son montant, comme un mouvement du relevé :
// la 2035 la compte ce jour-là (CGI, art. 93, 1), la CA3 rend sa TVA exigible ou déductible à cette date, la situation la
// date de même, et sa contrepartie s'écrit au compte de la caisse du plan, au journal de sa pièce. Le drapeau
// `PAIEMENT_PAR_LA_CAISSE_EXPORTE` BAISSÉ, aucun paiement par la caisse n'entre dans les moteurs, et rien ne change au
// caractère près. Toutes les données sont fictives.

const D = 'd-caisse'
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

const categorie = (o: Partial<Categorie>): Categorie => ({
  id: 'c-achats', dossier_id: D, code: 'achats', libelle: 'Achats fictifs', ordre: 1, compte_comptable: '606100', poste_2035: 'Achats', ...o,
})
const CATEGORIES: Categorie[] = [
  categorie({}),
  categorie({ id: 'c-honoraires', code: 'honoraires', libelle: 'Honoraires fictifs', compte_comptable: '706200', poste_2035: 'Recettes' }),
]
const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p-achat', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/fictif.pdf`, nom_fichier: 'fictif.pdf',
  storage_hash: null, date_piece: '2025-12-20', tiers: 'Fournisseur fictif', montant_ht: null, montant_tva: null, montant_ttc: 300,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c-achats', sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
  lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
  vente_hors_des_factures: false, created_at: '2025-12-21T09:00:00Z', updated_at: '2025-12-21T09:00:00Z', ...o,
})
const mouvement = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'm-1', dossier_id: D, date: '2025-12-28', libelle: 'MOUVEMENT FICTIF', montant: -70, statut: 'rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
  emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
  prelevement_personnel: false, source_fichier: null, libelle_brut: null, id_externe: null, created_at: '2025-12-29T08:00:00Z',
  encaissements_de_factures: false, ...o,
})
const operation = (o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse => ({
  dossier_id: D, genre: 'paiement', date: '2026-01-05', montant: -300, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
  piece_id: 'p-achat', origine: 'cabinet', remplace_id: null, cree_le: '2026-01-05T18:00:00Z', cree_par: 'u-cabinet', retire_le: null,
  retire_par: null, ...o,
})
let n = 0
const enBase = (lignes: readonly LigneAGenerer[]): EcritureBrouillon[] => lignes.map((l) => ({
  id: `e${++n}`, dossier_id: l.dossier_id, piece_id: l.piece_id, ligne_bancaire_id: l.ligne_bancaire_id ?? null,
  operation_caisse_id: l.operation_caisse_id ?? null, date: l.date, compte: l.compte, libelle: l.libelle, montant: l.montant,
  sens: l.sens, statut: 'proposee', created_at: '2026-01-06T09:00:00Z', immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, encaissement_id: null, facture_id: null,
}))
// Les paiements par la caisse de ces opérations, tels qu'ils seront le drapeau levé.
const parLaCaisse = (ops: readonly OperationCaisse[]): PartPayeeParLaCaisse[] => paiementsParLaCaisseSelon(true, ops)
const paiements = (lignes: readonly LigneBancaire[], ops: readonly OperationCaisse[]): PaiementsDesPieces =>
  paiementsDesPieces(lignes, [], [], parLaCaisse(ops))
const declaration = (annee: number, pieces: Piece[], p: PaiementsDesPieces, lignes: readonly LigneBancaire[] = [], assujetti = false) =>
  calculerDeclaration2035(
    annee, pieces, CATEGORIES, [], [], [], assujetti, p, partsDuReleve(lignes, CATEGORIES, [], assujetti), [], PLAN_PAR_DEFAUT,
    ventesFactureesVides(D), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
  )
const cases = (annee: number, pieces: Piece[], p: PaiementsDesPieces) => valeursDesCases(declaration(annee, pieces, p)).valeurs
const etatDeLaCaisse = (ops: readonly OperationCaisse[], plan: PlanComptable = PLAN_PAR_DEFAUT): EtatDeLaCaisse => ({
  compteCaisse: plan.caisse, ouvertures: [], operations: ops, mouvements: [], encaissements: [], factures: [],
})

describe('les paiements par la caisse que les moteurs reçoivent, et le drapeau', () => {
  const ops: OperationCaisse[] = [
    operation({ id: 'oc-z', date: '2026-02-01', montant: -40, piece_id: 'p2' }),
    operation({ id: 'oc-a', date: '2026-01-05' }),
    operation({ id: 'oc-recette', genre: 'recette', montant: 80, piece_id: null, categorie_id: 'c-honoraires' }),
    operation({ id: 'oc-apport', genre: 'apport', montant: 50, piece_id: null }),
    operation({ id: 'oc-retire', retire_le: '2026-01-06T10:00:00Z', retire_par: 'u-cabinet' }),
    operation({ id: 'oc-ancien', date: '2026-01-04' }),
    operation({ id: 'oc-nouveau', date: '2026-01-04', remplace_id: 'oc-ancien', montant: -10, piece_id: 'p3' }),
    operation({ id: 'oc-sans-piece', piece_id: null }),
    // Défensif : une opération d'un autre genre qui citerait une pièce — la base ne l'écrit pas — n'en est pas un paiement.
    operation({ id: 'oc-apport-cite', genre: 'apport', montant: 20, piece_id: 'p9' }),
  ]

  it('le drapeau est BAISSÉ : la migration `paiement_par_la_caisse` n’est pas en base, aucun paiement n’entre', () => {
    drapeau.leve = false
    expect(PAIEMENT_PAR_LA_CAISSE_EXPORTE).toBe(false)
    expect(paiementsParLaCaisse(ops)).toEqual([])
    expect(paiementsParLaCaisseSelon(false, ops)).toEqual([])
  })

  it('le drapeau LEVÉ : la migration en base, la dérivation selon le drapeau rend les paiements vivants', () => {
    drapeau.leve = true
    expect(PAIEMENT_PAR_LA_CAISSE_EXPORTE).toBe(true)
    expect(paiementsParLaCaisse(ops)).toEqual(paiementsParLaCaisseSelon(true, ops))
    expect(paiementsParLaCaisse(ops)).toHaveLength(3)
  })

  it('la dérivation du module suit la constante du module, dans l’état qu’elle a', async () => {
    const vrai = await vi.importActual<typeof import('./paiementParLaCaisse')>('./paiementParLaCaisse')
    expect(vrai.paiementsParLaCaisse(ops)).toEqual(vrai.paiementsParLaCaisseSelon(vrai.PAIEMENT_PAR_LA_CAISSE_EXPORTE, ops))
    expect(vrai.paiementsParLaCaisse(ops)).toEqual(vrai.PAIEMENT_PAR_LA_CAISSE_EXPORTE ? paiementsParLaCaisseSelon(true, ops) : [])
  })

  it('levé : les paiements vivants qui citent une pièce, triés par date puis par opération', () => {
    expect(paiementsParLaCaisseSelon(true, ops)).toEqual([
      { operation_caisse_id: 'oc-nouveau', piece_id: 'p3', date: '2026-01-04', montant: -10 },
      { operation_caisse_id: 'oc-a', piece_id: 'p-achat', date: '2026-01-05', montant: -300 },
      { operation_caisse_id: 'oc-z', piece_id: 'p2', date: '2026-02-01', montant: -40 },
    ])
    expect(paiementsParLaCaisseSelon(true, [...ops].reverse())).toEqual(paiementsParLaCaisseSelon(true, ops))
  })

  it('selon la lecture de la caisse : nuls tant qu’elle n’est pas revenue entière pour ce dossier, aucun le drapeau baissé', () => {
    const lue = { dossierId: D, enBase: true, lignes: ops, complete: true, motif: null }
    const partielle = { ...lue, complete: false, motif: 'tronquée' }
    const absente = { ...lue, enBase: false, lignes: [], complete: false }
    expect(paiementsParLaCaisseDuDossierSelon(true, lue, D)).toEqual(paiementsParLaCaisseSelon(true, ops))
    expect(paiementsParLaCaisseDuDossierSelon(true, null, D)).toBeNull()
    expect(paiementsParLaCaisseDuDossierSelon(true, lue, 'un-autre')).toBeNull()
    expect(paiementsParLaCaisseDuDossierSelon(true, partielle, D)).toBeNull()
    expect(paiementsParLaCaisseDuDossierSelon(true, absente, D)).toEqual([])
    for (const l of [lue, null, partielle, absente]) expect(paiementsParLaCaisseDuDossierSelon(false, l, D)).toEqual([])
  })

  it('un paiement par la caisse : origine `caisse`, son opération, AUCUN mouvement ; le relevé d’abord à date égale', () => {
    const lignes = [mouvement({ id: 'm-b', date: '2026-01-05', montant: -100, piece_id: 'p-achat' })]
    const liste = paiements(lignes, [operation({ id: 'oc-a', date: '2026-01-05', montant: -200 })]).get('p-achat')!
    expect(liste).toEqual([
      { id: 'm-b', date: '2026-01-05', montant: -100, origine: 'rapprochement' },
      { operation_caisse_id: 'oc-a', date: '2026-01-05', montant: -200, origine: 'caisse' },
    ])
    expect(liste.map(cleDuPaiement)).toEqual(['m-b', 'caisse:oc-a'])
    expect('id' in liste[1]).toBe(false)
  })
})

// LA NEUTRALITÉ : le drapeau baissé, une caisse qui porte même des paiements — que la base d'aujourd'hui n'écrit pas — ne
// change rien à ce que les moteurs rendent, au caractère près ; levé, une caisse qui n'en porte aucun non plus.
describe('la neutralité, au caractère près', () => {
  const rng = tirage(20261101)
  const ent = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
  const dossiers = Array.from({ length: 150 }, (_, k) => {
    const pieces = Array.from({ length: ent(1, 5) }, (_, i) => piece({
      id: `p${k}-${i}`, type_piece: rng() < 0.3 ? 'vente' : 'achat', categorie_id: rng() < 0.3 ? 'c-honoraires' : 'c-achats',
      date_piece: `202${ent(5, 6)}-${String(ent(1, 12)).padStart(2, '0')}-1${ent(0, 9)}`, montant_ttc: ent(1, 90_000) / 100,
      ...(rng() < 0.5 ? { montant_ht: null, montant_tva: null } : {}),
    }))
    const lignes = pieces.flatMap((p, i) => (rng() < 0.6 ? [mouvement({
      id: `m${k}-${i}`, piece_id: p.id, date: `202${ent(5, 6)}-0${ent(1, 9)}-2${ent(0, 8)}`,
      montant: (p.type_piece === 'vente' ? 1 : -1) * Math.abs(p.montant_ttc ?? 0) * (rng() < 0.2 ? 0.5 : 1),
    })] : []))
    // La caisse du dossier : des recettes, des apports, et des paiements de ses pièces que la base d'aujourd'hui n'écrirait pas.
    const ops = pieces.flatMap((p, i) => [
      operation({ id: `oc${k}-${i}`, piece_id: p.id, date: `2026-0${ent(1, 9)}-0${ent(1, 9)}`, montant: -ent(100, 9000) / 100 }),
      operation({ id: `or${k}-${i}`, genre: 'recette', piece_id: null, categorie_id: 'c-honoraires', montant: ent(100, 9000) / 100 }),
    ])
    return { pieces, lignes, ops }
  })
  const sorties = (pieces: Piece[], lignes: LigneBancaire[], caisse: readonly PartPayeeParLaCaisse[]) => {
    const p = paiementsDesPieces(lignes, [], [], caisse)
    const aComptabiliser: PieceAComptabiliser[] = pieces.map((x) => ({ piece: x, compte: x.categorie_id === 'c-honoraires' ? '706200' : '606100', immobilisation: false }))
    const brouillon = enBase(pieces.flatMap((x) => lignesPourPiece(D, x, aComptabiliser.find((a) => a.piece.id === x.id)!, true, p.get(x.id) ?? [], TRESORERIE)))
    return JSON.stringify({
      paiements: [...p.entries()],
      d2025: declaration(2025, pieces, p, lignes), d2026: declaration(2026, pieces, p, lignes, true),
      ca3: calculerCa3({ pieces, paiements: p, pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventesFactureesVides(D), caisse: CAISSE_ABSENTE },
        { debut: '2026-01-01', fin: '2026-12-31' }, false, 0, 0),
      situation: calculerSituationIntermediaire(pieces, CATEGORIES, [], [], '2026-01-01', '2026-06-30', true, p, 'tresorerie', [],
        ventesFactureesVides(D), PLAN_PAR_DEFAUT, { etat: 'sans_bascule' }, CAISSE_ABSENTE),
      brouillon: brouillon.map(({ id: _id, ...l }) => l),
      analyse: analyserEcritures(brouillon, aComptabiliser, true, p, TRESORERIE, null, SANS_EXEMPLAIRE),
      fec: genererFec(brouillon, pieces, CATEGORIES, [], 'tresorerie', lignes, new Map(), SANS_ECRITURE_DE_VENTE,
        OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES),
      enTrop: piecesPayeesEnTrop(pieces, p),
    })
  }

  it('le drapeau baissé : une caisse qui porte des paiements rend ce que rend une caisse sans paiement', () => {
    drapeau.leve = false
    let paiementsVus = 0
    for (const { pieces, lignes, ops } of dossiers) {
      paiementsVus += ops.filter((o) => o.genre === 'paiement').length
      expect(sorties(pieces, lignes, paiementsParLaCaisse(ops))).toBe(sorties(pieces, lignes, AUCUN_PAIEMENT_PAR_LA_CAISSE))
    }
    // Le plancher : la batterie porte bien des paiements, que seul le drapeau écarte.
    expect(paiementsVus).toBeGreaterThan(200)
  })

  it('le drapeau levé : une caisse sans paiement de pièce — des recettes, des apports — ne change rien non plus', () => {
    for (const { pieces, lignes, ops } of dossiers) {
      const sansPaiement = ops.filter((o) => o.genre !== 'paiement')
      expect(sorties(pieces, lignes, paiementsParLaCaisseSelon(true, sansPaiement))).toBe(sorties(pieces, lignes, AUCUN_PAIEMENT_PAR_LA_CAISSE))
    }
  })

  it('et le témoin : levé sur la même caisse, les sorties changent', () => {
    const { pieces, lignes, ops } = dossiers[0]
    expect(sorties(pieces, lignes, paiementsParLaCaisseSelon(true, ops))).not.toBe(sorties(pieces, lignes, AUCUN_PAIEMENT_PAR_LA_CAISSE))
  })
})

describe('la 2035 compte la pièce à la date de son paiement par la caisse (CGI, art. 93, 1)', () => {
  const achat = piece()
  const op = operation({ id: 'oc-1' })

  it('un achat de décembre payé en espèces en janvier : dans la 2035 de janvier, à sa case (BA), plus « sans paiement »', () => {
    const sans = paiements([], [])
    expect(cases(2025, [achat], sans).get('BA')).toBe(300)
    expect(declaration(2025, [achat], sans).sansPaiementConnu.map((x) => x.piece.id)).toEqual(['p-achat'])
    const avec = paiements([], [op])
    expect(cases(2025, [achat], avec).get('BA')).toBe(0)
    expect(cases(2026, [achat], avec).get('BA')).toBe(300)
    expect(declaration(2026, [achat], avec).sansPaiementConnu).toEqual([])
  })

  it('une pièce de vente encaissée en espèces : la recette (AA) à la date des espèces', () => {
    const vente = piece({ id: 'p-vente', type_piece: 'vente', categorie_id: 'c-honoraires', montant_ttc: 90 })
    const p = paiements([], [operation({ id: 'oc-v', piece_id: 'p-vente', montant: 90, date: '2026-01-03' })])
    expect(cases(2025, [vente], p).get('AA')).toBe(0)
    expect(cases(2026, [vente], p).get('AA')).toBe(90)
  })

  it('payée en partie par la banque en décembre et en partie par la caisse en janvier : chaque exercice sa part', () => {
    const lignes = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2025-12-28', montant: -120 })]
    const p = paiements(lignes, [operation({ id: 'oc-1', montant: -180 })])
    expect(rattachements(achat, p.get('p-achat')!, 'tresorerie')).toEqual([
      { date: '2025-12-28', part: 0.4, source: 'paiement' }, { date: '2026-01-05', part: 0.6, source: 'paiement' },
    ])
    expect(cases(2025, [achat], p).get('BA')).toBe(120)
    expect(cases(2026, [achat], p).get('BA')).toBe(180)
  })

  it('payée en trop : la caisse s’ajoute à la banque, et l’excédent se dit', () => {
    const lignes = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2025-12-28', montant: -200 })]
    const p = paiements(lignes, [operation({ id: 'oc-1', montant: -150 })])
    expect(piecesPayeesEnTrop([achat], p).map((x) => [x.piece.id, x.paye, x.enTrop])).toEqual([['p-achat', 350, 50]])
    expect(piecesPayeesEnTrop([achat], paiements(lignes, []))).toEqual([])
  })

  it('en engagement, la pièce reste à sa facture : la caisse ne date rien', () => {
    expect(rattachements(achat, paiements([], [op]).get('p-achat')!, 'engagement')).toEqual([{ date: '2025-12-20', part: 1, source: 'facture' }])
  })
})

describe('la CA3 et la situation suivent la date des espèces', () => {
  const achat = piece({ date_piece: '2026-01-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  const vente = piece({ id: 'p-vente', type_piece: 'vente', categorie_id: 'c-honoraires', date_piece: '2026-01-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  const ca3 = (pieces: Piece[], p: PaiementsDesPieces, mois: string) => calculerCa3({
    pieces, paiements: p, pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventesFactureesVides(D), caisse: CAISSE_ABSENTE,
  }, { debut: `${mois}-01`, fin: `${mois}-28` }, false, 0, 0).cases

  it('la TVA d’un achat payé en espèces le 10 février se déduit en février, pas en janvier', () => {
    const p = paiements([], [operation({ id: 'oc-1', date: '2026-02-10', montant: -120 })])
    expect(ca3([achat], p, '2026-01').l20).toBe(0)
    expect(ca3([achat], p, '2026-02').l20).toBe(20)
  })

  it('la TVA d’une vente encaissée en espèces : exigible au jour des espèces', () => {
    const p = paiements([], [operation({ id: 'oc-v', piece_id: 'p-vente', date: '2026-02-10', montant: 120 })])
    expect(ca3([vente], p, '2026-01')).toMatchObject({ base08: 0, taxe08: 0 })
    expect(ca3([vente], p, '2026-02')).toMatchObject({ base08: 100, taxe08: 20 })
  })

  it('payée moitié banque en janvier, moitié caisse en février : chaque mois la TVA de sa part', () => {
    const lignes = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2026-01-25', montant: -60 })]
    const p = paiements(lignes, [operation({ id: 'oc-1', date: '2026-02-10', montant: -60 })])
    expect(ca3([achat], p, '2026-01').l20).toBe(10)
    expect(ca3([achat], p, '2026-02').l20).toBe(10)
  })

  it('la situation intermédiaire : la charge dans la période du paiement en espèces', () => {
    const p = paiements([], [operation({ id: 'oc-1', date: '2026-07-02', montant: -120 })])
    const situation = (debut: string, fin: string) => calculerSituationIntermediaire([achat], CATEGORIES, [], [], debut, fin, true, p,
      'tresorerie', [], ventesFactureesVides(D), PLAN_PAR_DEFAUT, { etat: 'sans_bascule' }, CAISSE_ABSENTE).charges
    expect(situation('2026-01-01', '2026-06-30')).toBe(0)
    expect(situation('2026-07-01', '2026-12-31')).toBe(100)
  })
})

describe('la contrepartie de caisse, au compte de la caisse du plan', () => {
  const achat = piece({ date_piece: '2026-01-02', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  const cible: PieceAComptabiliser = { piece: achat, compte: '606100', immobilisation: false }
  const op = operation({ id: 'oc-1', date: '2026-01-05', montant: -120 })

  it('celle que la garde du brouillon admet, et que `contrepartieDuPaiement` redit', () => {
    for (const plan of [PLAN_PAR_DEFAUT, PLAN_DECALE]) {
      for (const o of [op, operation({ id: 'oc-v', piece_id: 'p-achat', montant: 40 })]) {
        const ligne = ligneContrepartieCaisse(D, achat, { operation_caisse_id: o.id, date: o.date, montant: o.montant }, plan)!
        expect(ligne).toMatchObject(contrepartieDuPaiement(o, plan.caisse)!)
        expect(ligne).toMatchObject({ dossier_id: D, statut: 'proposee', libelle: 'Fournisseur fictif' })
        expect(ligne.ligne_bancaire_id).toBeUndefined()
        expect(refusDeLaContrepartie({ ...ligne, operation_caisse_id: ligne.operation_caisse_id! }, etatDeLaCaisse([o], plan), [])).toBeNull()
      }
    }
    expect(ligneContrepartieCaisse(D, achat, { operation_caisse_id: 'oc-0', date: '2026-01-05', montant: 0 }, PLAN_PAR_DEFAUT)).toBeNull()
  })

  it('la génération : la charge à la date des espèces, la TVA, la caisse au crédit — équilibrée', () => {
    const lignes = lignesPourPiece(D, achat, cible, true, paiements([], [op]).get('p-achat')!, TRESORERIE)
    expect(lignes.map((l) => [l.date, l.compte, l.sens, l.montant, l.ligne_bancaire_id ?? null, l.operation_caisse_id ?? null])).toEqual([
      ['2026-01-05', '606100', 'debit', 100, null, null],
      ['2026-01-05', '445660', 'debit', 20, null, null],
      ['2026-01-05', '530000', 'credit', 120, null, 'oc-1'],
    ])
    const brouillon = enBase(lignes)
    const analyse = analyserEcritures(brouillon, [cible], true, paiements([], [op]), TRESORERIE, null, SANS_EXEMPLAIRE)
    expect(analyse).toEqual({ nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [] })
    const generation = ecrituresAGenerer(D, [cible], [], true, paiements([], [op]), TRESORERIE, null)
    expect(generation.lignes).toEqual(lignes)
  })

  it('payée en partie par la banque et en partie par la caisse le même jour : une contrepartie par moyen', () => {
    const lignesBanque = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2026-01-05', montant: -70 })]
    const p = paiements(lignesBanque, [operation({ id: 'oc-1', date: '2026-01-05', montant: -50 })])
    const lignes = lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, TRESORERIE)
    expect(lignes.filter((l) => l.compte === '512000').map((l) => [l.sens, l.montant, l.ligne_bancaire_id])).toEqual([['credit', 70, 'm-1']])
    expect(lignes.filter((l) => l.compte === '530000').map((l) => [l.sens, l.montant, l.operation_caisse_id])).toEqual([['credit', 50, 'oc-1']])
    expect(analyserEcritures(enBase(lignes), [cible], true, p, TRESORERIE, null, SANS_EXEMPLAIRE).piecesDesynchronisees).toEqual([])
  })

  it('« à régénérer » quand la caisse ne suit plus : la ligne absente, un autre compte, un paiement retiré, un autre montant', () => {
    const p = paiements([], [op])
    const juste = enBase(lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, TRESORERIE))
    const desync = (brouillon: EcritureBrouillon[], q: PaiementsDesPieces = p) =>
      analyserEcritures(brouillon, [cible], true, q, TRESORERIE, null, SANS_EXEMPLAIRE).piecesDesynchronisees.map((x) => x.id)
    expect(desync(juste)).toEqual([])
    expect(desync(juste.filter((e) => e.compte !== '530000'))).toEqual(['p-achat'])
    expect(desync(juste.map((e) => (e.compte === '530000' ? { ...e, compte: '531000' } : e)))).toEqual(['p-achat'])
    expect(desync(juste, paiements([], []))).toEqual(['p-achat'])
    expect(desync(juste, paiements([], [{ ...op, montant: -100 }]))).toEqual(['p-achat'])
    // Sous un plan décalé, la caisse du plan, et elle seule.
    const decale: ModeleComptable = { ...TRESORERIE, plan: PLAN_DECALE }
    const sousDecale = enBase(lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, decale))
    expect(sousDecale.find((e) => e.operation_caisse_id)?.compte).toBe(PLAN_DECALE.caisse)
    expect(analyserEcritures(juste, [cible], true, p, decale, null, SANS_EXEMPLAIRE).piecesDesynchronisees.map((x) => x.id)).toEqual(['p-achat'])
  })

  it('une pièce que la frontière coupe : sa part ouverte se compare opération pour opération', () => {
    // Payée par la banque en 2025 (figé), par la caisse en 2026 : la ligne de caisse qui cite une AUTRE opération, du même
    // jour et du même montant, ne suit pas son paiement.
    const lignes = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2025-12-30', montant: -60 })]
    const coupee = piece({ date_piece: '2025-12-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const c: PieceAComptabiliser = { piece: coupee, compte: '606100', immobilisation: false }
    const p = paiements(lignes, [operation({ id: 'oc-1', date: '2026-01-05', montant: -60 })])
    const juste = enBase(lignesPourPiece(D, coupee, c, true, p.get('p-achat')!, TRESORERIE))
    const desync = (b: EcritureBrouillon[]) =>
      analyserEcritures(b, [c], true, p, TRESORERIE, '2025-12-31', SANS_EXEMPLAIRE).piecesDesynchronisees.map((x) => x.id)
    expect(desync(juste)).toEqual([])
    expect(desync(juste.map((e) => (e.operation_caisse_id ? { ...e, operation_caisse_id: 'oc-autre' } : e)))).toEqual(['p-achat'])
  })

  it('une écriture COMPLÈTE : la caisse est une contrepartie, et un déséquilibre se dit', () => {
    const p = paiements([], [op])
    const juste = enBase(lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, TRESORERIE))
    const fausse = juste.map((e) => (e.compte === '530000' ? { ...e, montant: 100 } : e))
    const analyse = analyserEcritures(fausse, [cible], true, p, TRESORERIE, null, SANS_EXEMPLAIRE)
    expect(analyse.groupesDesequilibres.map((g) => [g.pieceId, Math.round(g.solde * 100)])).toEqual([['p-achat', 2000]])
  })

  it('en engagement, le relevé seul règle : un paiement par la caisse n’écrit aucun règlement, et rien n’est « à régénérer »', () => {
    const p = paiements([], [op])
    const lignes = lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, ENGAGEMENT)
    expect(lignes).toEqual(lignesPourPiece(D, achat, cible, true, [], ENGAGEMENT))
    expect(analyserEcritures(enBase(lignes), [cible], true, p, ENGAGEMENT, null, SANS_EXEMPLAIRE).piecesDesynchronisees).toEqual([])
  })

  it('une pièce qui ne s’écrit plus : sa caisse n’est pas comptée « en trop », comme la banque', () => {
    const p = paiements([], [op])
    const brouillon = enBase(lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, TRESORERIE))
    const [sansObjet] = ecrituresSansObjet(brouillon, [{ ...achat, categorie_id: null }], CATEGORIES, new Map(), null, PLAN_PAR_DEFAUT, SANS_FACTURE_SOURCE)
    expect([sansObjet.motif, sansObjet.nbLignes, sansObjet.montant]).toEqual(['sans_categorie', 2, 120])
  })

  it('le lettrage : en trésorerie, rien ne se lettre, la caisse non plus', () => {
    const brouillon = enBase(lignesPourPiece(D, achat, cible, true, paiements([], [op]).get('p-achat')!, TRESORERIE))
    expect(lettrages(brouillon, [achat], [], 'tresorerie', SANS_VENTE_FACTUREE).size).toBe(0)
  })
})

describe('le reste à régler et le second paiement comptent la caisse', () => {
  const achat = piece({ montant_ttc: 100 })
  const p = paiements([], [operation({ id: 'oc-1', montant: -80 })]).get('p-achat')!

  it('le reste : la pièce moins ce que la caisse a payé ; régler de nouveau un mouvement n’écarte jamais la caisse', () => {
    expect(resteARegler(achat, p, null)).toBe(20)
    expect(resteARegler(achat, p, 'm-quelconque')).toBe(20)
  })

  it('un mouvement qui dépasse ce que la caisse laisse se refuse ; celui qui le solde passe', () => {
    expect(refusSecondPaiement({ id: 'm-2', montant: -30 }, achat, p)).toMatch(/dépasse ce qu’il reste à régler/)
    expect(refusSecondPaiement({ id: 'm-2', montant: -20 }, achat, p)).toBeNull()
  })
})

describe('le FEC et la piste d’audit : le paiement par la caisse au journal de sa pièce', () => {
  const achat = piece({ date_piece: '2026-01-02', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  const cible: PieceAComptabiliser = { piece: achat, compte: '606100', immobilisation: false }
  const caisseLue = (ops: OperationCaisse[]): OperationsDeCaisse => ({ etat: 'lue', dossierId: D, operations: ops })
  const entrees = (p: PaiementsDesPieces): EntreesDesChampsBnc => ({
    choix: { sansReglement: 'vides' }, paiements: p, registre: [], factures: [], cotisations: [], ventilations: [], acquisitions: new Map(),
    plan: PLAN_PAR_DEFAUT,
  })
  const fec = (brouillon: EcritureBrouillon[], lignes: LigneBancaire[], ops: OperationCaisse[], champs: Parameters<typeof genererFec>[9]) =>
    genererFec(brouillon, [achat], CATEGORIES, [], 'tresorerie', lignes, new Map(), SANS_ECRITURE_DE_VENTE, caisseLue(ops), champs)

  it('payée par la caisse seule : une écriture au journal des achats, la caisse au crédit, DateRglt le jour des espèces, « Espèces »', () => {
    const ops = [operation({ id: 'oc-1', date: '2026-01-05', montant: -120 })]
    const p = paiements([], ops)
    const brouillon = enBase(lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, TRESORERIE))
    const sans = colonnes(fec(brouillon, [], ops, CHAMPS_BNC_NON_EXPORTES)).slice(1)
    expect(sans.map((r) => [r[0], r[2], r[4], r[11], r[12]])).toEqual([
      ['AC', 'AC00001', '445660', '20,00', '0,00'], ['AC', 'AC00001', '606100', '100,00', '0,00'], ['AC', 'AC00001', '530000', '0,00', '120,00'],
    ])
    const f = fec(brouillon, [], ops, { etat: 'exportes', entrees: entrees(p) })
    expect(new Set(colonnes(f).slice(1).map((r) => `${r[2]} ${r[18]} ${r[19]}`))).toEqual(new Set(['AC00001 20260105 Espèces']))
    expect(desequilibresDgfip(f)).toEqual([])
  })

  it('les règlements d’une date : la caisse porte son opération, sous sa clé, jamais un mouvement', () => {
    const lignes = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2026-01-05', montant: -72 })]
    const p = paiements(lignes, [operation({ id: 'oc-1', date: '2026-01-05', montant: -48 })])
    expect(partsDesReglementsALaDate(achat, p.get('p-achat')!, '2026-01-05', []).map((x) => [x.cle, x.mouvements, x.part])).toEqual([
      ['releve', ['m-1'], 0.6], ['caisse', ['caisse:oc-1'], 0.4],
    ])
  })

  it('payée le même jour par la banque et par la caisse : deux écritures, « Banque » et « Espèces », chacune équilibrée', () => {
    const lignes = [mouvement({ id: 'm-1', piece_id: 'p-achat', date: '2026-01-05', montant: -72 })]
    const ops = [operation({ id: 'oc-1', date: '2026-01-05', montant: -48 })]
    const p = paiements(lignes, ops)
    const brouillon = enBase(lignesPourPiece(D, achat, cible, true, p.get('p-achat')!, TRESORERIE))
    const f = fec(brouillon, lignes, ops, { etat: 'exportes', entrees: entrees(p) })
    expect(colonnes(f).slice(1).map((r) => [r[2], r[4], r[11], r[12], r[19]])).toEqual([
      ['AC00001', '445660', '12,00', '0,00', 'Banque'], ['AC00001', '606100', '60,00', '0,00', 'Banque'], ['AC00001', '512000', '0,00', '72,00', 'Banque'],
      ['AC00002', '445660', '8,00', '0,00', 'Espèces'], ['AC00002', '606100', '40,00', '0,00', 'Espèces'], ['AC00002', '530000', '0,00', '48,00', 'Espèces'],
    ])
    expect(desequilibresDgfip(f)).toEqual([])
  })

  it('la piste d’audit : la pièce pour justificatif, le paiement par la caisse pour opération réelle — sans nom, sans relevé', () => {
    const ops = [operation({ id: 'oc-1', date: '2026-01-05', montant: -120 })]
    const brouillon = enBase(lignesPourPiece(D, achat, cible, true, paiements([], ops).get('p-achat')!, TRESORERIE))
    const registre = { immobilisations: [], factures: [], vehicules: [], ventes: SANS_VENTE_FACTUREE }
    const [ligneCaisse] = pisteAudit(brouillon, [achat], [], [], { ...registre, caisse: caisseLue(ops) }).filter((l) => l.compte === '530000')
    expect(ligneCaisse).toMatchObject({
      pieceId: 'p-achat', pieceFichier: 'fictif.pdf', mouvementDate: '2026-01-05', mouvementMontant: -120, manque: [],
      mouvementLibelle: 'Paiement en espèces par la caisse, saisi par le cabinet — Brouillard de caisse du 05/01/2026, tenu hors de l’application',
    })
    const parLeClient = pisteAudit(brouillon, [achat], [], [], { ...registre, caisse: caisseLue([{ ...ops[0], origine: 'client' }]) })
    expect(parLeClient.find((l) => l.compte === '530000')?.mouvementLibelle).toMatch(/^Paiement en espèces par la caisse, saisi par le client — /)
    const horsDuJeu = pisteAudit(brouillon, [achat], [], [], { ...registre, caisse: OPERATIONS_DE_CAISSE_ABSENTES }).find((l) => l.compte === '530000')
    expect(horsDuJeu?.manque).toEqual(['opération de caisse hors du jeu chargé'])
    expect(rupturesPisteAudit(brouillon, new Set())).toEqual([])
    expect(absenceFec(brouillon, new Set()).nb).toBe(0)
  })
})
