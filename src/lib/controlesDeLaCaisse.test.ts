import { describe, expect, it } from 'vitest'
import { ecritureDeLOperation, ensembleDuJour, type EtatDeLaCaisse } from './caisse'
import {
  caisseNegative, caisseNegativeDite, CAISSE_PAS_EN_BASE, detailDesOperationsAReprendre, detailDesRecettesARevoir,
  detailDesVersementsEnRecette, dossierTientUneCaisse, etatDeLaCaisseLue, journalDeLOperation, justificatifDeLaCaisse,
  libelleDitUnVersementDEspeces, motifDesOperationsDeCaisse, OPERATIONS_DE_CAISSE_ABSENTES, operationNommee, operationsDe,
  operationsDeCaisseAReprendre, operationsDeCaisseDuDossier, operationsPourLesControles, RAISON_VERSEMENT_D_ESPECES,
  recettesDeCaisseARevoir, referenceDeLaCaisse, versementsDEspecesEnRecette, versementsDEspecesHorsDesLots,
  type DossierDesControlesDeLaCaisse, type OperationsDeCaisse,
} from './controlesDeLaCaisse'
import { formaterFec, genererFec, numeroterFec } from './fec'
import { absenceFec, pisteAudit, rupturesPisteAudit } from './pisteAudit'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { AUCUN_HORS_DES_LOTS, ecartDuLot } from './mouvementsDesVentes'
import type { ModeleComptable } from './engagement'
import type { Categorie, EcritureBrouillon, EncaissementFacture, OperationCaisse, VentilationBancaire } from './types'
import { defautsDeNumerotation } from './validationExercice'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { anomaliesDgfip, colonnes, desequilibresDgfip } from '../test/fecDgfip'
import { categorie, ecriture, ligne } from '../test/revision'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE } from '../test/ventesFacturees'

// LES CONTRÔLES DE LA CAISSE (ligne 26.6, étape C3b) : la forme que le FEC et les contrôles reçoivent ; le FEC (une écriture
// par opération, au journal de son genre — CAISSE-Q3, (A) —, la pièce « Caisse du … », `anomaliesDgfip` sans faute) ; la
// piste d'audit (le brouillard du praticien, sans empreinte, jamais une rupture) ; les quatre contrôles — une opération à
// reprendre, une caisse négative, une recette à revoir (CAISSE-Q2), un versement d'espèces rangé en recette — et le
// versement hors des lots. Chacun dans ses deux états : la caisse absente (le drapeau baissé) rend ce qu'on rendait avant
// elle. Des jeux FICTIFS.

const DOSSIER = 'd-caisse'
const SANS_LETTRAGE = new Map()
const MODELE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }

const HONORAIRES = categorie({
  id: 'k-hono', dossier_id: DOSSIER, code: 'honoraires', libelle: 'Honoraires', compte_comptable: '706000',
  poste_2035: 'Recettes encaissées y compris les remboursements de frais',
})
const FOURNITURES = categorie({ id: 'k-fourn', dossier_id: DOSSIER, code: 'fournitures', libelle: 'Fournitures', compte_comptable: '606400', poste_2035: 'Achats' })
const CATEGORIES: Categorie[] = [HONORAIRES, FOURNITURES]

function operation(o: Partial<OperationCaisse>): OperationCaisse {
  return {
    id: 'o', dossier_id: DOSSIER, genre: 'recette', date: '2026-03-12', montant: 100, categorie_id: HONORAIRES.id, taux_tva: null,
    encaissements_du_jour: [], piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-12T18:00:00Z',
    cree_par: 'u-chef', retire_le: null, retire_par: null, ...o,
  }
}

const recette = (id: string, o: Partial<OperationCaisse> = {}) => operation({ id, ...o })
const apport = (id: string, o: Partial<OperationCaisse> = {}) =>
  operation({ id, genre: 'apport', categorie_id: null, encaissements_du_jour: null, ...o })
const prelevement = (id: string, o: Partial<OperationCaisse> = {}) =>
  operation({ id, genre: 'prelevement', categorie_id: null, encaissements_du_jour: null, ...o })

// L'écriture que la base compose pour une opération, au plan et au statut donnés : ses lignes, chacune désignant l'opération.
function brouillonDe(o: OperationCaisse, modele: ModeleComptable = MODELE, assujetti = false, categories: Categorie[] = CATEGORIES): EcritureBrouillon[] {
  const cat = categories.find((c) => c.id === o.categorie_id) ?? null
  return ecritureDeLOperation({
    genre: o.genre as 'recette' | 'apport' | 'prelevement', date: o.date, montant: o.montant, taux_tva: assujetti ? o.taux_tva : null,
    categorie: cat ? { libelle: cat.libelle, compte_comptable: cat.compte_comptable } : null,
  }, modele).map((l, i) => ecriture({
    id: `${o.id}-${i}`, date: o.date, compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle, operation_caisse_id: o.id,
  }))
}

const lue = (operations: OperationCaisse[]): OperationsDeCaisse => ({ etat: 'lue', dossierId: DOSSIER, operations })

function dossier(o: Partial<DossierDesControlesDeLaCaisse> = {}): DossierDesControlesDeLaCaisse {
  return {
    modele: MODELE, assujettiTva: false, categories: CATEGORIES, ecritures: [], ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' },
    frontiere: null, ...o,
  }
}

describe('la forme que les contrôles reçoivent', () => {
  const caisse = (o: Partial<typeof CAISSE_PAS_EN_BASE> = {}) => ({ ...CAISSE_PAS_EN_BASE, dossierId: DOSSIER, enBase: true, complete: true, ...o })

  it('absente, lue, pas revenue, d’un autre dossier, lue en partie', () => {
    expect(operationsDeCaisseDuDossier(null, DOSSIER)).toEqual({ etat: 'en_attente' })
    expect(operationsDeCaisseDuDossier({ ...CAISSE_PAS_EN_BASE, dossierId: DOSSIER }, DOSSIER)).toBe(OPERATIONS_DE_CAISSE_ABSENTES)
    expect(operationsDeCaisseDuDossier(caisse({ dossierId: 'autre' }), DOSSIER)).toEqual({ etat: 'en_attente' })
    expect(operationsDeCaisseDuDossier(caisse({ complete: false, motif: 'coupée' }), DOSSIER)).toEqual({ etat: 'incomplete', motif: 'coupée' })
    expect(operationsDeCaisseDuDossier(caisse({ complete: false }), DOSSIER)).toEqual({ etat: 'incomplete', motif: 'la lecture de la caisse est incomplète' })
    const r = recette('r1')
    expect(operationsDeCaisseDuDossier(caisse({ lignes: [r] }), DOSSIER)).toEqual({ etat: 'lue', dossierId: DOSSIER, operations: [r] })
  })

  it('l’écran tranche avant le FEC et les contrôles : seules l’absente et la lue y entrent', () => {
    expect(operationsPourLesControles(OPERATIONS_DE_CAISSE_ABSENTES)).toBe(OPERATIONS_DE_CAISSE_ABSENTES)
    expect(operationsPourLesControles(lue([]))).toEqual(lue([]))
    expect(operationsPourLesControles({ etat: 'en_attente' })).toBeNull()
    expect(operationsPourLesControles({ etat: 'incomplete', motif: 'x' })).toBeNull()
    expect(motifDesOperationsDeCaisse({ etat: 'incomplete', motif: 'x' })).toBe('x')
    expect(motifDesOperationsDeCaisse({ etat: 'en_attente' })).toBe('la caisse du dossier n’est pas encore lue')
    expect(motifDesOperationsDeCaisse(OPERATIONS_DE_CAISSE_ABSENTES)).toBeNull()
    expect(motifDesOperationsDeCaisse(lue([]))).toBeNull()
    expect(operationsDe(OPERATIONS_DE_CAISSE_ABSENTES)).toEqual([])
  })

  it('le dossier tient-il une caisse ? une opération vivante le dit ; ne pas savoir, c’est peut-être', () => {
    expect(dossierTientUneCaisse(OPERATIONS_DE_CAISSE_ABSENTES)).toBe('non')
    expect(dossierTientUneCaisse(lue([]))).toBe('non')
    expect(dossierTientUneCaisse(lue([recette('r1', { retire_le: '2026-03-13T10:00:00Z' })]))).toBe('non')
    expect(dossierTientUneCaisse(lue([apport('a1')]))).toBe('oui')
    expect(dossierTientUneCaisse({ etat: 'en_attente' })).toBe('peut_etre')
    expect(dossierTientUneCaisse({ etat: 'incomplete', motif: 'x' })).toBe('peut_etre')
  })
})

describe('les journaux et les pièces (CAISSE-Q3, (A))', () => {
  it('une recette aux ventes, l’apport et le prélèvement aux opérations diverses, le paiement d’une pièce nulle part ici', () => {
    expect(journalDeLOperation('recette')).toBe('VE')
    expect(journalDeLOperation('apport')).toBe('OD')
    expect(journalDeLOperation('prelevement')).toBe('OD')
    expect(journalDeLOperation('paiement')).toBeNull()
  })

  it('la pièce du jour, et le brouillard du praticien pour justificatif, sans nom', () => {
    expect(referenceDeLaCaisse('2026-03-12')).toBe('Caisse du 12/03/2026')
    expect(justificatifDeLaCaisse('2026-03-12')).toBe('Brouillard de caisse du 12/03/2026, tenu hors de l’application')
  })
})

// ── Le FEC ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('le FEC : une écriture par opération, au journal de son genre', () => {
  const R = recette('r1', { date: '2026-03-12', montant: 120 })
  const RENDUES = recette('r2', { date: '2026-03-14', montant: -20 })
  const A = apport('a1', { date: '2026-03-02', montant: 50 })
  const P = prelevement('p1', { date: '2026-03-20', montant: 30 })
  const OPS = [R, RENDUES, A, P]
  const BROUILLON = OPS.flatMap((o) => brouillonDe(o))

  it('VE pour une recette et des espèces rendues, OD pour un apport et un prélèvement ; la pièce « Caisse du … », sa date', () => {
    const n = numeroterFec(BROUILLON, [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, lue(OPS))
    expect(n.horsFec).toEqual([])
    const parOperation = new Map<string, { journals: Set<string>; numeros: Set<string>; pieces: Set<string>; dates: Set<string> }>()
    for (const l of n.lignes) {
      const id = l.ecriture.operation_caisse_id!
      const x = parOperation.get(id) ?? { journals: new Set(), numeros: new Set(), pieces: new Set(), dates: new Set() }
      x.journals.add(l.journal); x.numeros.add(`${l.journal}${l.numero}`); x.pieces.add(l.pieceRef); x.dates.add(l.pieceDate)
      parOperation.set(id, x)
    }
    expect([...parOperation.entries()].map(([id, x]) => [id, [...x.journals], x.numeros.size, [...x.pieces], [...x.dates]])).toEqual([
      ['a1', ['OD'], 1, ['Caisse du 02/03/2026'], ['2026-03-02']],
      ['r1', ['VE'], 1, ['Caisse du 12/03/2026'], ['2026-03-12']],
      ['r2', ['VE'], 1, ['Caisse du 14/03/2026'], ['2026-03-14']],
      ['p1', ['OD'], 1, ['Caisse du 20/03/2026'], ['2026-03-20']],
    ])
    // Les numéros suivent les dates dans chaque journal : VE00001 le 12, VE00002 le 14 ; OD00001 le 2, OD00002 le 20.
    expect([...new Set(n.lignes.map((l) => `${l.journal}${l.numero}|${l.ecriture.date}`))]).toEqual([
      'OD1|2026-03-02', 'VE1|2026-03-12', 'VE2|2026-03-14', 'OD2|2026-03-20',
    ])
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  it('imprimé : dix-huit colonnes, la pièce et le libellé de la base, sans faute ni déséquilibre selon l’outil de la DGFiP', () => {
    const fec = genererFec(BROUILLON, [], CATEGORIES, [], 'tresorerie', [], SANS_LETTRAGE, SANS_ECRITURE_DE_VENTE, lue(OPS))
    const rows = colonnes(fec)
    expect(rows.every((r) => r.length === 18)).toBe(true)
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
    const r1 = rows.filter((r) => r[8] === 'Caisse du 12/03/2026')
    expect(r1.map((r) => [r[0], r[1], r[2], r[3], r[4], r[9], r[10], r[11], r[12]])).toEqual([
      ['VE', 'Ventes', 'VE00001', '20260312', PLAN_PAR_DEFAUT.caisse, '20260312', 'Recettes en espèces du 12/03/2026 — Honoraires', '120,00', '0,00'],
      ['VE', 'Ventes', 'VE00001', '20260312', '706000', '20260312', 'Recettes en espèces du 12/03/2026 — Honoraires', '0,00', '120,00'],
    ])
    const a1 = rows.filter((r) => r[8] === 'Caisse du 02/03/2026')
    expect(a1.map((r) => [r[0], r[2], r[4], r[10], r[11], r[12]])).toEqual([
      ['OD', 'OD00001', PLAN_PAR_DEFAUT.caisse, 'Apport en caisse de l\'exploitant', '50,00', '0,00'],
      ['OD', 'OD00001', '108000', 'Apport en caisse de l\'exploitant', '0,00', '50,00'],
    ])
    // Aucun nom : la pièce et le libellé ne portent que la date et la nature.
    expect(rows.slice(1).every((r) => r[6] === '' && r[7] === '')).toBe(true)
  })

  it('assujetti : la TVA de la recette dans la même écriture, au journal des ventes', () => {
    const r = recette('r1', { montant: 120, taux_tva: 20 })
    const fec = genererFec(brouillonDe(r, MODELE, true), [], CATEGORIES, [], 'tresorerie', [], SANS_LETTRAGE, SANS_ECRITURE_DE_VENTE, lue([r]))
    const rows = colonnes(fec).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[4], r[11], r[12]])).toEqual([
      ['VE', 'VE00001', PLAN_PAR_DEFAUT.caisse, '120,00', '0,00'],
      ['VE', 'VE00001', '445710', '0,00', '20,00'],
      ['VE', 'VE00001', '706000', '0,00', '100,00'],
    ])
    expect(anomaliesDgfip(fec)).toEqual([])
  })

  it('un plan qui tient d’autres comptes : la caisse de son plan, son libellé du plan', () => {
    const decale: ModeleComptable = { ...MODELE, plan: { ...PLAN_PAR_DEFAUT, caisse: '531000' } }
    const fec = genererFec(brouillonDe(A, decale), [], CATEGORIES, [], 'tresorerie', [], SANS_LETTRAGE, SANS_ECRITURE_DE_VENTE, lue([A]))
    expect(colonnes(fec)[1].slice(0, 6)).toEqual(['OD', 'Opérations diverses', 'OD00001', '20260302', '531000', expect.any(String)])
    expect(anomaliesDgfip(fec)).toEqual([])
  })

  it('jamais deviné : la caisse absente, une opération que la lecture ne rend pas, un paiement de pièce — hors du fichier', () => {
    expect(numeroterFec(BROUILLON, [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES).horsFec)
      .toHaveLength(BROUILLON.length)
    expect(numeroterFec(BROUILLON, [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, lue([R])).horsFec.map((e) => e.operation_caisse_id))
      .toEqual(BROUILLON.filter((e) => e.operation_caisse_id !== 'r1').map((e) => e.operation_caisse_id))
    const paiement = operation({ id: 'pay', genre: 'paiement', categorie_id: null, encaissements_du_jour: null, piece_id: 'pc1', montant: -15 })
    const ligneSansPiece = ecriture({ id: 'pay-0', date: paiement.date, compte: '530000', sens: 'credit', montant: 15, operation_caisse_id: 'pay' })
    expect(numeroterFec([ligneSansPiece], [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, lue([paiement])).horsFec).toEqual([ligneSansPiece])
  })

  it('NEUTRE : sans ligne de caisse, la caisse absente et la caisse lue rendent le même fichier', () => {
    const autre = [
      ecriture({ id: 'x1', piece_id: 'pc', date: '2026-03-05', compte: '606400', sens: 'debit', montant: 10 }),
      ecriture({ id: 'x2', piece_id: 'pc', date: '2026-03-05', compte: '512000', sens: 'credit', montant: 10, ligne_bancaire_id: 'l1' }),
    ]
    const sans = numeroterFec(autre, [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES)
    const avec = numeroterFec(autre, [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, lue(OPS))
    expect(formaterFec(avec, SANS_LETTRAGE)).toBe(formaterFec(sans, SANS_LETTRAGE))
  })
})

// ── La piste d'audit ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('la piste d’audit : le brouillard du praticien, sans empreinte ; jamais une rupture', () => {
  const R = recette('r1', { date: '2026-03-12', montant: 120 })
  const BROUILLON = brouillonDe(R)

  it('la ligne d’une opération de caisse', () => {
    const lignes = pisteAudit(BROUILLON, [], [], [], {
      immobilisations: [], factures: [], vehicules: [], ventes: { ...SANS_VENTE_FACTUREE, exemplaires: [], transmissions: [] },
    })
    expect(lignes.map((l) => [l.compte, l.pieceFichier, l.pieceDate, l.pieceEmpreinte, l.pieceId, l.mouvementDate, l.manque])).toEqual([
      [PLAN_PAR_DEFAUT.caisse, 'Brouillard de caisse du 12/03/2026, tenu hors de l’application', '2026-03-12', null, null, null, []],
      ['706000', 'Brouillard de caisse du 12/03/2026, tenu hors de l’application', '2026-03-12', null, null, null, []],
    ])
  })

  it('ni une rupture, ni un absent du FEC ; sans l’opération, la même ligne en était une', () => {
    expect(rupturesPisteAudit(BROUILLON, new Set())).toEqual([])
    expect(absenceFec(BROUILLON, new Set()).nb).toBe(0)
    const sansOperation = BROUILLON.map((e) => ({ ...e, operation_caisse_id: null }))
    expect(rupturesPisteAudit(sansOperation, new Set())).toHaveLength(2)
    expect(absenceFec(sansOperation, new Set()).nb).toBe(2)
  })
})

// ── caisse-a-reprendre ────────────────────────────────────────────────────────────────────────────────────────────────

describe('caisse-a-reprendre : l’écriture qui manque ou ne suit plus sa composition, au plan et au statut d’aujourd’hui', () => {
  const R = recette('r1', { montant: 120, taux_tva: 20 })
  const A = apport('a1', { montant: 50 })
  const P = prelevement('p1', { montant: 30 })

  it('une écriture conforme n’est pas à reprendre, même sous un libellé d’hier (une catégorie renommée)', () => {
    const ecritures = [...brouillonDe(R), ...brouillonDe(A), ...brouillonDe(P)].map((e) => ({ ...e, libelle: 'un libellé d’hier' }))
    expect(operationsDeCaisseAReprendre([R, A, P], dossier({ ecritures }))).toEqual([])
  })

  it('l’écriture absente, puis une ligne de moins, une ligne au mauvais compte, au mauvais jour', () => {
    expect(operationsDeCaisseAReprendre([A], dossier()).map((x) => [x.operationId, x.raison])).toEqual([['a1', 'ecriture_absente']])
    const lignes = brouillonDe(A)
    expect(operationsDeCaisseAReprendre([A], dossier({ ecritures: lignes.slice(1) }))[0].raison).toBe('ecriture_perimee')
    expect(operationsDeCaisseAReprendre([A], dossier({ ecritures: [lignes[0], { ...lignes[1], compte: '455000' }] }))[0].raison).toBe('ecriture_perimee')
    expect(operationsDeCaisseAReprendre([A], dossier({ ecritures: [lignes[0], { ...lignes[1], date: '2026-03-13' }] }))[0].raison).toBe('ecriture_perimee')
  })

  it('un plan changé depuis la saisie : la caisse de son plan n’est plus celle de l’écriture', () => {
    const decale: ModeleComptable = { ...MODELE, plan: { ...PLAN_PAR_DEFAUT, caisse: '531000' } }
    expect(operationsDeCaisseAReprendre([A], dossier({ ecritures: brouillonDe(A), modele: decale })).map((x) => x.raison)).toEqual(['ecriture_perimee'])
    expect(operationsDeCaisseAReprendre([A], dossier({ ecritures: brouillonDe(A, decale), modele: decale }))).toEqual([])
  })

  it('un statut de TVA changé : la recette saisie avec sa TVA ne la porte plus ; devenu assujetti, sans taux, elle ne s’écrit plus', () => {
    // Saisie assujettie, le dossier ne l'est plus.
    expect(operationsDeCaisseAReprendre([R], dossier({ ecritures: brouillonDe(R, MODELE, true), assujettiTva: false }))[0].raison).toBe('ecriture_perimee')
    expect(operationsDeCaisseAReprendre([R], dossier({ ecritures: brouillonDe(R, MODELE, true), assujettiTva: true }))).toEqual([])
    // Saisie hors TVA, le dossier l'est devenu : la recette n'a pas de taux.
    const sansTaux = recette('r2', { montant: 80, taux_tva: null })
    expect(operationsDeCaisseAReprendre([sansTaux], dossier({ ecritures: brouillonDe(sansTaux), assujettiTva: true }))[0].raison).toBe('ne_s_ecrit_plus')
  })

  it('une catégorie qui n’est plus un produit, ou qu’aucune lecture ne rend : elle ne s’écrit plus', () => {
    const r = recette('r3', { categorie_id: FOURNITURES.id })
    expect(operationsDeCaisseAReprendre([r], dossier({ ecritures: brouillonDe(recette('r3')) }))[0].raison).toBe('ne_s_ecrit_plus')
    const inconnue = recette('r4', { categorie_id: 'k-inconnue' })
    expect(operationsDeCaisseAReprendre([inconnue], dossier())[0].raison).toBe('ne_s_ecrit_plus')
  })

  it('une opération retirée ou un paiement ne se jugent pas ; les lignes restées d’une retirée, si', () => {
    const retiree = apport('a2', { retire_le: '2026-03-13T10:00:00Z' })
    const paiement = operation({ id: 'pay', genre: 'paiement', categorie_id: null, piece_id: 'pc1', montant: -15 })
    expect(operationsDeCaisseAReprendre([retiree, paiement], dossier())).toEqual([])
    const restees = brouillonDe(apport('a2'))
    expect(operationsDeCaisseAReprendre([retiree], dossier({ ecritures: restees })).map((x) => [x.operationId, x.raison, x.operation?.id]))
      .toEqual([['a2', 'ecriture_restee', 'a2']])
    expect(operationsDeCaisseAReprendre([], dossier({ ecritures: restees })).map((x) => [x.operationId, x.raison, x.operation]))
      .toEqual([['a2', 'ecriture_restee', null]])
    // Les lignes d'un paiement (C9) portent leur pièce : elles se jugent avec elle.
    const lignePaiement = ecriture({ id: 'pay-0', piece_id: 'pc1', compte: '530000', sens: 'credit', montant: 15, operation_caisse_id: 'pay' })
    expect(operationsDeCaisseAReprendre([], dossier({ ecritures: [lignePaiement] }))).toEqual([])
    expect(operationsDeCaisseAReprendre([paiement], dossier({ ecritures: [lignePaiement] }))).toEqual([])
  })

  it('ce qu’un exercice validé a figé ne se reprend plus', () => {
    expect(operationsDeCaisseAReprendre([A], dossier({ frontiere: '2025-12-31' }))).toHaveLength(1)
    expect(operationsDeCaisseAReprendre([A], dossier({ frontiere: '2026-12-31' }))).toEqual([])
    expect(operationsDeCaisseAReprendre([apport('a2', { retire_le: 'x' })], dossier({ ecritures: brouillonDe(apport('a2')), frontiere: '2026-12-31' }))).toEqual([])
  })

  it('dans l’ordre des jours, puis des identifiants ; le détail nomme chaque opération sans nom', () => {
    const liste = operationsDeCaisseAReprendre([
      apport('b', { date: '2026-03-10' }), apport('a', { date: '2026-03-10' }), recette('c', { date: '2026-02-01', montant: -12.5 }),
    ], dossier())
    expect(liste.map((x) => x.operationId)).toEqual(['c', 'a', 'b'])
    expect(detailDesOperationsAReprendre(liste).replace(/[\u00a0\u202f]/g, ' '))
      .toBe('le 01/02/2026, espèces rendues de 12,50 € (écriture absente) ; le 10/03/2026, apport de 100,00 € (écriture absente) ; '
        + 'le 10/03/2026, apport de 100,00 € (écriture absente).')
    expect(operationNommee(prelevement('p', { montant: 30 })).replace(/[\u00a0\u202f]/g, ' ')).toBe('le 12/03/2026, prélèvement de 30,00 €')
  })
})

// ── caisse-negative ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('caisse-negative : défensif, la caisse lue jour par jour', () => {
  const etat = (operations: OperationCaisse[], o: Partial<EtatDeLaCaisse> = {}): EtatDeLaCaisse => ({
    compteCaisse: PLAN_PAR_DEFAUT.caisse, ouvertures: [], operations, mouvements: [], encaissements: [], factures: [], ...o,
  })

  it('le premier jour négatif, et son solde ; jamais une caisse qui ne l’est pas', () => {
    expect(caisseNegative(etat([apport('a', { date: '2026-03-01', montant: 50 }), prelevement('p', { date: '2026-03-05', montant: 50 })]), null)).toBeNull()
    const n = caisseNegative(etat([apport('a', { date: '2026-03-01', montant: 50 }), prelevement('p', { date: '2026-03-05', montant: 80 })]), null)
    expect(n).toEqual({ jour: '2026-03-05', centimes: -3000 })
    expect(caisseNegativeDite(n!).replace(/[\u00a0\u202f]/g, ' ')).toBe('05/03/2026 (−30,00 €)')
  })

  it('un versement de trop sur le relevé, une ouverture au crédit', () => {
    expect(caisseNegative(etat([apport('a', { date: '2026-03-01', montant: 50 })], {
      mouvements: [{ id: 'm', date: '2026-03-02', montant: 60, compte_bilan: PLAN_PAR_DEFAUT.caisse }],
    }), null)).toEqual({ jour: '2026-03-02', centimes: -1000 })
    expect(caisseNegative(etat([], { ouvertures: [{ date: '2026-01-01', compte: PLAN_PAR_DEFAUT.caisse, sens: 'credit', montant: 5 }] }), null))
      .toEqual({ jour: '2026-01-01', centimes: -500 })
  })

  it('un jour figé ne se reprend plus : le premier jour négatif après la frontière', () => {
    const e = etat([prelevement('p', { date: '2025-12-20', montant: 10 }), prelevement('q', { date: '2026-02-01', montant: 5 })])
    expect(caisseNegative(e, null)).toEqual({ jour: '2025-12-20', centimes: -1000 })
    expect(caisseNegative(e, '2025-12-31')).toEqual({ jour: '2026-02-01', centimes: -1500 })
  })

  it('les espèces des factures lues en partie : la caisse ne se rejoue pas', () => {
    expect(etatDeLaCaisseLue([], dossier({ especes: { etat: 'incomplete', motif: 'x' } }))).toBeNull()
    expect(etatDeLaCaisseLue([], dossier())?.encaissements).toEqual([])
  })
})

// ── recettes-de-caisse-a-revoir (CAISSE-Q2, (A)) ──────────────────────────────────────────────────────────────────────

describe('recettes-de-caisse-a-revoir : l’ensemble reconnu des espèces de son jour n’est plus celui que la caisse compte', () => {
  const FACTURE = { id: 'f1', numero: 'F2026-0012', source_de_la_vente: true }
  const AUTRE = { id: 'f2', numero: 'F2026-0013', source_de_la_vente: false }
  const encaissement = (o: Partial<EncaissementFacture>) => ({
    id: 'e1', facture_id: 'f1', date_encaissement: '2026-03-12', montant: 120, moyen: 'especes' as const, ligne_bancaire_id: null,
    annule_id: null, retire_le: null, ...o,
  })
  const etat = (operations: OperationCaisse[], encaissements: ReturnType<typeof encaissement>[]): EtatDeLaCaisse => ({
    compteCaisse: PLAN_PAR_DEFAUT.caisse, ouvertures: [], operations, mouvements: [], encaissements, factures: [FACTURE, AUTRE],
  })

  it('reconnu tel quel : rien à revoir', () => {
    const r = recette('r1', { encaissements_du_jour: ['e1'] })
    expect(recettesDeCaisseARevoir([r], etat([r], [encaissement({})]), null)).toEqual([])
  })

  it('un encaissement enregistré depuis, retiré depuis, rattaché à un crédit depuis : à revoir', () => {
    const sans = recette('r1', { encaissements_du_jour: [] })
    const avec = recette('r1', { encaissements_du_jour: ['e1'] })
    expect(recettesDeCaisseARevoir([sans], etat([sans], [encaissement({})]), null).map((x) => [x.operation.id, x.reconnus, x.attendus]))
      .toEqual([['r1', [], ['e1']]])
    expect(recettesDeCaisseARevoir([avec], etat([avec], [encaissement({ retire_le: '2026-03-13T10:00:00Z' })]), null)).toHaveLength(1)
    expect(recettesDeCaisseARevoir([avec], etat([avec], [encaissement({ ligne_bancaire_id: 'm1' })]), null)).toHaveLength(1)
    const e = etat([sans], [encaissement({})])
    expect(detailDesRecettesARevoir(recettesDeCaisseARevoir([sans], e, null), e).replace(/[\u00a0\u202f]/g, ' '))
      .toBe('le 12/03/2026, recette de 100,00 € (F2026-0012).')
  })

  it('ni une facture qui n’est pas source, ni un autre moyen, ni un autre jour, ni une recette retirée, ni ce que la frontière fige', () => {
    const sans = recette('r1', { encaissements_du_jour: [] })
    expect(recettesDeCaisseARevoir([sans], etat([sans], [encaissement({ facture_id: 'f2' })]), null)).toEqual([])
    expect(recettesDeCaisseARevoir([sans], etat([sans], [encaissement({ moyen: 'cheque' })]), null)).toEqual([])
    expect(recettesDeCaisseARevoir([sans], etat([sans], [encaissement({ date_encaissement: '2026-03-13' })]), null)).toEqual([])
    const retiree = recette('r1', { encaissements_du_jour: [], retire_le: '2026-03-13T10:00:00Z' })
    expect(recettesDeCaisseARevoir([retiree], etat([retiree], [encaissement({})]), null)).toEqual([])
    expect(recettesDeCaisseARevoir([sans], etat([sans], [encaissement({})]), '2026-12-31')).toEqual([])
    // Le même ensemble que la saisie (lib/caisse.ts) : la règle n'est pas recopiée.
    expect(ensembleDuJour(etat([], [encaissement({})]), '2026-03-12')).toEqual(['e1'])
  })
})

// ── Le versement d'espèces (§ 4 a) ────────────────────────────────────────────────────────────────────────────────────

describe('le versement d’espèces : un libellé, symptôme et jamais preuve', () => {
  const libelle = (l: string) => libelleDitUnVersementDEspeces({ libelle: l, libelle_brut: null })

  it('les libellés que les banques écrivent', () => {
    for (const l of ['VERSEMENT ESPECES', 'Versement espèces 12/03', 'VRST ESP 0042', 'VERS. ESP.', 'DEPOT D\'ESPECES', 'Dépôt espèces',
      'REMISE ESPECES', 'REM ESP GUICHET', 'VERSEMENT EN ESPECES', 'VRS ESPECE', 'DEP ESP AGENCE']) {
      expect(libelle(l), l).toBe(true)
    }
    expect(libelleDitUnVersementDEspeces({ libelle: 'Mouvement bancaire', libelle_brut: 'VRST ESP 12' })).toBe(true)
  })

  it('ni une remise de chèques, ni un virement, ni un retrait d’espèces, ni un mot qui commence comme espèces', () => {
    for (const l of ['REMISE CHEQUES', 'VIR SEPA ASSURANCE MALADIE', 'RETRAIT DAB', 'VERSEMENT CPAM', 'DEPOT ESPACE PRO', 'ESPECES', 'PRLV ESPACE']) {
      expect(libelle(l), l).toBe(false)
    }
    expect(libelleDitUnVersementDEspeces({ libelle: null as unknown as string, libelle_brut: null })).toBe(false)
  })

  const VERSEMENT = ligne({ id: 'v1', date: '2026-03-14', montant: 400, libelle: 'VERSEMENT ESPECES', statut: 'non_rapprochee' })
  const RETRAIT = ligne({ id: 'v2', date: '2026-03-14', montant: -40, libelle: 'VERSEMENT ESPECES', statut: 'non_rapprochee' })
  const CPAM = ligne({ id: 'v3', date: '2026-03-14', montant: 70, libelle: 'VIR CPAM', statut: 'non_rapprochee' })

  it('hors des lots : un crédit ainsi libellé, dans un dossier qui tient une caisse — ou peut-être', () => {
    const avec = versementsDEspecesHorsDesLots(AUCUN_HORS_DES_LOTS, lue([apport('a1')]), [VERSEMENT, RETRAIT, CPAM])
    expect([...avec]).toEqual([['v1', RAISON_VERSEMENT_D_ESPECES]])
    expect([...versementsDEspecesHorsDesLots(AUCUN_HORS_DES_LOTS, { etat: 'incomplete', motif: 'x' }, [VERSEMENT])]).toEqual([['v1', RAISON_VERSEMENT_D_ESPECES]])
    expect([...versementsDEspecesHorsDesLots(AUCUN_HORS_DES_LOTS, { etat: 'en_attente' }, [VERSEMENT])]).toEqual([['v1', RAISON_VERSEMENT_D_ESPECES]])
    // Un mouvement qu'un autre motif écarte garde le sien.
    const deja = new Map([['v1', 'les mots de la garde G2']])
    expect([...versementsDEspecesHorsDesLots(deja, lue([apport('a1')]), [VERSEMENT])]).toEqual([['v1', 'les mots de la garde G2']])
  })

  it('NEUTRE : la caisse absente, ou sans opération vivante, rend la carte telle quelle — le même objet', () => {
    const hors = new Map([['x', 'y']])
    expect(versementsDEspecesHorsDesLots(hors, OPERATIONS_DE_CAISSE_ABSENTES, [VERSEMENT])).toBe(hors)
    expect(versementsDEspecesHorsDesLots(hors, lue([]), [VERSEMENT])).toBe(hors)
    expect(versementsDEspecesHorsDesLots(hors, lue([apport('a', { retire_le: 'x' })]), [VERSEMENT])).toBe(hors)
    expect(versementsDEspecesHorsDesLots(hors, lue([apport('a')]), [CPAM, RETRAIT])).toBe(hors)
  })

  it('la carte d’un lot le dit à part, et rend la phrase d’hier sans lui', () => {
    const hors = new Map([['v1', RAISON_VERSEMENT_D_ESPECES], ['g', 'les mots de la garde G2']])
    expect(ecartDuLot([{ id: 'v1' }], hors)?.resume).toBe('1 mouvement écarté : 1 a un libellé de versement d’espèces, à classer sur la caisse depuis sa fiche.')
    expect(ecartDuLot([{ id: 'v1' }, { id: 'g' }], hors)?.resume)
      .toBe('2 mouvements écartés : 1 a un libellé de versement d’espèces, à classer sur la caisse depuis sa fiche ; 1 autre porte des '
        + 'encaissements de factures, ou une vente facturée le justifie peut-être.')
    expect(ecartDuLot([{ id: 'v1' }, { id: 'v2' }, { id: 'g' }, { id: 'h' }], new Map([...hors, ['v2', RAISON_VERSEMENT_D_ESPECES], ['h', 'x']]))?.resume)
      .toBe('4 mouvements écartés : 2 ont un libellé de versement d’espèces, à classer sur la caisse depuis leur fiche ; 2 autres portent '
        + 'des encaissements de factures, ou une vente facturée les justifie peut-être.')
    expect(ecartDuLot([{ id: 'g' }], hors)?.resume).toBe('1 mouvement écarté : il porte des encaissements de factures.')
  })

  it('rangé en recette : affecté à un produit ou ventilé avec une part de produit ; ni une charge, ni un débit, ni ce qui est figé', () => {
    const affecte = { ...VERSEMENT, statut: 'rapprochee' as const, categorie_id: HONORAIRES.id }
    const enCharge = { ...VERSEMENT, id: 'v4', statut: 'rapprochee' as const, categorie_id: FOURNITURES.id }
    const debit = { ...RETRAIT, statut: 'rapprochee' as const, categorie_id: HONORAIRES.id }
    const ventile = { ...VERSEMENT, id: 'v5', statut: 'rapprochee' as const, ventilee: true }
    const nonLibelle = { ...CPAM, statut: 'rapprochee' as const, categorie_id: HONORAIRES.id }
    const ventilations: VentilationBancaire[] = [
      { id: 'vt1', dossier_id: DOSSIER, ligne_bancaire_id: 'v5', categorie_id: HONORAIRES.id, part_personnelle: false, montant: 300, taux_tva: null, created_at: 'x' },
      { id: 'vt2', dossier_id: DOSSIER, ligne_bancaire_id: 'v5', categorie_id: FOURNITURES.id, part_personnelle: false, montant: 100, taux_tva: null, created_at: 'x' },
    ]
    const lignes = [affecte, enCharge, debit, ventile, nonLibelle]
    expect(versementsDEspecesEnRecette(lignes, ventilations, CATEGORIES, false, null).map((l) => l.id)).toEqual(['v1', 'v5'])
    expect(versementsDEspecesEnRecette(lignes, ventilations, CATEGORIES, false, '2026-12-31')).toEqual([])
    expect(detailDesVersementsEnRecette([affecte]).replace(/[\u00a0\u202f]/g, ' ')).toBe('le 14/03/2026, 400,00 € (VERSEMENT ESPECES).')
  })
})

// ── Au hasard ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// UN TIRAGE (src/test/encaissementsBatterie.ts) : des caisses au hasard — genres, montants, signes, taux, dates, plans —,
// écrites comme la base les écrit. À chaque fois : le FEC fait une écriture par opération, au journal de son genre, sans
// faute ni déséquilibre pour l'outil de la DGFiP, sans défaut de numérotation ; aucune opération n'est à reprendre ; et une
// ligne déplacée fait reprendre son opération, elle seule.
describe('au hasard', () => {
  it('200 caisses tirées : le FEC et « à reprendre » tiennent', () => {
    const suivant = tirage(20261031)
    const TAUX = [0, 5.5, 8.5, 10, 20]
    const GENRES = ['recette', 'recette', 'recette', 'apport', 'prelevement'] as const
    for (let cas = 0; cas < 200; cas++) {
      const assujetti = suivant() < 0.5
      const modele: ModeleComptable = suivant() < 0.3 ? { ...MODELE, plan: { ...PLAN_PAR_DEFAUT, caisse: '531000' } } : MODELE
      const ops: OperationCaisse[] = []
      const n = 1 + entierTire(suivant, 15)
      for (let i = 0; i < n; i++) {
        const genre = GENRES[entierTire(suivant, GENRES.length)]
        const centimes = (1 + entierTire(suivant, 500_000)) * (genre === 'recette' && suivant() < 0.15 ? -1 : 1)
        ops.push(operation({
          id: `c${cas}-o${String(i).padStart(2, '0')}`, genre, montant: centimes / 100,
          date: `2026-0${1 + entierTire(suivant, 9)}-${String(1 + entierTire(suivant, 28)).padStart(2, '0')}`,
          categorie_id: genre === 'recette' ? HONORAIRES.id : null, encaissements_du_jour: genre === 'recette' ? [] : null,
          taux_tva: genre === 'recette' && assujetti ? TAUX[entierTire(suivant, TAUX.length)] : null,
        }))
      }
      const brouillon = ops.flatMap((o) => brouillonDe(o, modele, assujetti))
      const numerotation = numeroterFec(brouillon, [], CATEGORIES, [], 'tresorerie', [], SANS_ECRITURE_DE_VENTE, lue(ops))
      if (numerotation.horsFec.length > 0) throw new Error(`cas ${cas} : ${numerotation.horsFec.length} ligne(s) hors du FEC`)
      const ecritures = new Map<string, Set<string>>()
      for (const l of numerotation.lignes) {
        const op = ops.find((o) => o.id === l.ecriture.operation_caisse_id)!
        if (l.journal !== journalDeLOperation(op.genre)) throw new Error(`cas ${cas} : ${op.genre} au journal ${l.journal}`)
        if (l.pieceRef !== referenceDeLaCaisse(op.date) || l.pieceDate !== op.date) throw new Error(`cas ${cas} : pièce ${l.pieceRef}`)
        ecritures.set(op.id, (ecritures.get(op.id) ?? new Set()).add(`${l.journal}${l.numero}`))
      }
      if (ecritures.size !== ops.length || [...ecritures.values()].some((s) => s.size !== 1)) throw new Error(`cas ${cas} : une écriture par opération`)
      if (defautsDeNumerotation(numerotation).length > 0) throw new Error(`cas ${cas} : ${JSON.stringify(defautsDeNumerotation(numerotation))}`)
      const fec = formaterFec(numerotation, SANS_LETTRAGE)
      if (anomaliesDgfip(fec).length > 0 || desequilibresDgfip(fec).length > 0) throw new Error(`cas ${cas} : ${anomaliesDgfip(fec)} ${desequilibresDgfip(fec)}`)
      const d = dossier({ ecritures: brouillon, modele, assujettiTva: assujetti })
      if (operationsDeCaisseAReprendre(ops, d).length > 0) throw new Error(`cas ${cas} : à reprendre sur une écriture conforme`)
      // Une ligne déplacée d'un jour : son opération seule est à reprendre.
      const i = entierTire(suivant, brouillon.length)
      const deplacee = brouillon.map((e, j) => (j === i ? { ...e, date: e.date === '2026-01-01' ? '2026-01-02' : '2026-01-01' } : e))
      const aReprendre = operationsDeCaisseAReprendre(ops, { ...d, ecritures: deplacee })
      if (aReprendre.length !== 1 || aReprendre[0].operationId !== brouillon[i].operation_caisse_id) {
        throw new Error(`cas ${cas} : ${JSON.stringify(aReprendre.map((x) => x.operationId))} au lieu de ${brouillon[i].operation_caisse_id}`)
      }
    }
  })
})
