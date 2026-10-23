import { describe, expect, it } from 'vitest'
import { refusAffectation, type LigneEcritureMouvement, type MouvementBancaire } from './affectationBanque'
import { refusPaieUneDeclarationTva } from './classementsDuMouvement'
import { refusMouvementCompteDeBilan } from './compteDeBilan'
import { refusRapprochementCotisation } from './cotisationRapprochee'
import { calculerCa3, type DeclarationCa3, type DonneesTva } from './declarationTva'
import { formatMoney } from './format'
import { refusEcheanceEmprunt } from './echeanceEmprunt'
import {
  ARRONDI_MAXIMAL, REFUS_PAIEMENT_TVA_CLASSE, REFUS_VENTES_FACTUREES_EN_ATTENTE, aPayerDe, arrondiDeLaLiquidation, declarationDeLaCa3,
  declarationsDuMontant, declarationsPourLeMouvement,
  ecritureDeLaLiquidation, ecritureDuPaiementTva, idsRemboursementsTva, liquidationsDesynchronisees,
  paiementTvaPlausible, paiementsTvaDesynchronises, parametresEnregistrement, periodesEnRetard, periodesNonDeclarees,
  phraseDuPaiement, phraseDuRemboursement, raisonPaiementTvaPlausible, refusEnregistrement, refusPaiementTva,
  remboursementSousLeSeuil, seSaisitALaMain, seuilRemboursement, suiviDesDeclarations, ETAT_DE_LA_SOURCE_EN_MOTS,
  type ContexteDeDeclaration, type EcrituresDesVentesDeLaCa3, type EtatDeLaSourceDeVente,
  type DeclarationLiquidable, type DemandeDeDeclaration,
} from './liquidationTva'
import { PLAN_PAR_DEFAUT, type CleRoleComptable } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { REFUS_REGLE_EN_GROUPE, refusReglementGroupe } from './reglementGroupe'
import type { DeclarationTva, EcritureBrouillon, LigneBancaire, ModeComptable, Piece } from './types'
import {
  etatsDesVentesFacturees, LIBELLE_ETAT_SOURCE, type EncaissementDesEcritures, type EtatSourceDeVente, type EtatsDesVentes,
  type SourcesDesEcrituresDeVente,
} from './ecrituresVentesFactureesEcran'
import { brouillonDesVentes, composition, facture as factureDesEcritures, mouvementDesVentes } from '../test/dossierBascule'
import { encaissementVendu, factureVendue, ligneVendue, ventesFactureesVides } from '../test/ventesFacturees'
import { ventesFacturees } from './ventesFacturees'
import { refusVentilation } from './ventilationBanque'
import { refusVirementPersonnel } from './virementPersonnel'
import { NON_VALIDEE } from '../test/ecritures'
import { tirage } from '../test/encaissementsBatterie'
import { derniereDefinitionSql } from '../test/schema'

function declaration(o: Partial<DeclarationTva> = {}): DeclarationTva {
  return {
    id: 'q1', dossier_id: 'd1', periode_debut: '2026-01-01', periode_fin: '2026-03-31',
    tva_declaree: 79, credit_anterieur: 0, remboursement_demande: 0, date_declaration: '2026-04-15', notes: null,
    created_at: '2026-04-15T10:00:00Z', cases: null, tva_collectee: null, tva_deductible: null,
    tva_deductible_immobilisations: null, ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'm1', dossier_id: 'd1', date: '2026-04-20', libelle: 'PRLV DGFIP TVA', montant: -79,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    source_fichier: null, libelle_brut: null, created_at: '2026-04-21T09:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-03-31', compte: '445710',
    libelle: 'CA3', montant: 0, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, created_at: '2026-04-15T10:00:00Z', encaissement_id: null, facture_id: null, ...o,
  }
}

// Les écritures de l'essai de production (supabase/essais/liquidationTva.sql, 75 contrôles passés le 06/10/2026) :
// celles que `ecrire_liquidation_tva` a ACCEPTÉES, telles que l'essai les lui a passées. L'application doit composer
// exactement celles-là pour les mêmes déclarations — c'est la base qui fait foi, pas ce module.
const Q1: DeclarationLiquidable = {
  periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_collectee: 100.40, tva_deductible: 20.60,
  tva_deductible_immobilisations: 0,
  cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 0, l23: 21, l25: 0, l26: 0, l27: 0, l28: 79, l32: 79 },
}
const ECRITURE_Q1 = [
  { compte: '445710', sens: 'debit', montant: 100.40 },
  { compte: '445660', sens: 'credit', montant: 20.60 },
  { compte: '445510', sens: 'credit', montant: 79 },
  { compte: '758000', sens: 'credit', montant: 0.80 },
]
const Q2: DeclarationLiquidable = {
  periode_debut: '2026-04-01', periode_fin: '2026-06-30', tva_collectee: 50.20, tva_deductible: 399.70,
  tva_deductible_immobilisations: 0,
  cases: { l16: 50, l19: 0, l20: 400, l21: 0, l22: 0, l23: 400, l25: 350, l26: 300, l27: 50, l28: 0, l32: 0 },
}
const ECRITURE_Q2 = [
  { compte: '445710', sens: 'debit', montant: 50.20 },
  { compte: '445660', sens: 'credit', montant: 399.70 },
  { compte: '445670', sens: 'debit', montant: 50 },
  { compte: '445830', sens: 'debit', montant: 300 },
  { compte: '758000', sens: 'credit', montant: 0.50 },
]
const Q3: DeclarationLiquidable = {
  periode_debut: '2026-07-01', periode_fin: '2026-09-30', tva_collectee: 100.40, tva_deductible: 20.60,
  tva_deductible_immobilisations: 0,
  cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 50, l23: 71, l25: 0, l26: 0, l27: 0, l28: 29, l32: 29 },
}
const ECRITURE_Q3 = [
  { compte: '445710', sens: 'debit', montant: 100.40 },
  { compte: '445660', sens: 'credit', montant: 20.60 },
  { compte: '445670', sens: 'credit', montant: 50 },
  { compte: '445510', sens: 'credit', montant: 29 },
  { compte: '758000', sens: 'credit', montant: 0.80 },
]

const sansLibelle = (lignes: readonly LigneEcritureMouvement[]) => lignes.map(({ compte, sens, montant }) => ({ compte, sens, montant }))
const parCompte = <T extends { compte: string; sens: string }>(lignes: readonly T[]) =>
  [...lignes].sort((a, b) => a.compte.localeCompare(b.compte) || a.sens.localeCompare(b.sens))
const centimesAuSens = (lignes: readonly LigneEcritureMouvement[], sens: 'debit' | 'credit') =>
  lignes.filter((l) => l.sens === sens).reduce((s, l) => s + Math.round(l.montant * 100), 0)

describe('ecritureDeLaLiquidation — les écritures que la base a acceptées', () => {
  it('une période à payer : la TVA collectée au débit, la déductible et la TVA à payer au crédit, l’arrondi au 758000', () => {
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(Q1, PLAN_PAR_DEFAUT)))).toEqual(parCompte(ECRITURE_Q1))
  })

  it('une période en crédit dont une part est remboursée : le crédit reporté au 445670, le remboursement au 445830', () => {
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(Q2, PLAN_PAR_DEFAUT)))).toEqual(parCompte(ECRITURE_Q2))
  })

  it('une période qui reçoit un crédit le retire du 445670', () => {
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(Q3, PLAN_PAR_DEFAUT)))).toEqual(parCompte(ECRITURE_Q3))
  })

  it('s’équilibre, et porte le nom de sa période', () => {
    for (const d of [Q1, Q2, Q3]) {
      const lignes = ecritureDeLaLiquidation(d, PLAN_PAR_DEFAUT)
      expect(centimesAuSens(lignes, 'debit')).toBe(centimesAuSens(lignes, 'credit'))
    }
    expect(new Set(ecritureDeLaLiquidation(Q1, PLAN_PAR_DEFAUT).map((l) => l.libelle))).toEqual(new Set(['CA3 1er trimestre 2026']))
  })

  it('un arrondi qui fait payer plus que les comptes va au débit du 658000', () => {
    const d = { ...Q1, tva_collectee: 99.20 }
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(d, PLAN_PAR_DEFAUT)))).toEqual(parCompte([
      { compte: '445710', sens: 'debit', montant: 99.20 },
      { compte: '445660', sens: 'credit', montant: 20.60 },
      { compte: '445510', sens: 'credit', montant: 79 },
      { compte: '658000', sens: 'debit', montant: 0.40 },
    ]))
  })

  // LA BORNE D'UN CENTIME, écrite plutôt que tirée : un solde d'un centime garde sa ligne et son sens. Les quarante CA3
  // tirées au hasard ne l'atteignent que par chance — une sur 150 environ porte un centime au débit : deux sous le
  // générateur d'avant le 09/10/2026, aucune sous `tirage` — et c'était le seul test qui tuait `solde > 1` au lieu de
  // `solde > 0`.
  it('un arrondi d’un centime a sa ligne, au débit du 658000 comme au crédit du 758000', () => {
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation({ ...Q1, tva_collectee: 99.59 }, PLAN_PAR_DEFAUT)))).toEqual(parCompte([
      { compte: '445710', sens: 'debit', montant: 99.59 },
      { compte: '445660', sens: 'credit', montant: 20.60 },
      { compte: '445510', sens: 'credit', montant: 79 },
      { compte: '658000', sens: 'debit', montant: 0.01 },
    ]))
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation({ ...Q1, tva_collectee: 99.61 }, PLAN_PAR_DEFAUT)))).toEqual(parCompte([
      { compte: '445710', sens: 'debit', montant: 99.61 },
      { compte: '445660', sens: 'credit', montant: 20.60 },
      { compte: '445510', sens: 'credit', montant: 79 },
      { compte: '758000', sens: 'credit', montant: 0.01 },
    ]))
  })

  // Le crédit déclaré (60 €) est plus petit que celui des comptes (60,10 €) : les dix centimes perdus sont une charge.
  it('une TVA collectée négative — un avoir consenti seul — se crédite, et la déductible sur immobilisations a sa ligne', () => {
    const d: DeclarationLiquidable = {
      periode_debut: '2026-01-01', periode_fin: '2026-01-31', tva_collectee: -20, tva_deductible: 0,
      tva_deductible_immobilisations: 40.10,
      cases: { l16: 0, l19: 40, l20: 0, l21: 20, l22: 0, l23: 60, l25: 60, l26: 0, l27: 60, l28: 0, l32: 0 },
    }
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(d, PLAN_PAR_DEFAUT)))).toEqual(parCompte([
      { compte: '445710', sens: 'credit', montant: 20 },
      { compte: '445620', sens: 'credit', montant: 40.10 },
      { compte: '445670', sens: 'debit', montant: 60 },
      { compte: '658000', sens: 'debit', montant: 0.10 },
    ]))
  })

  it('rien pour une déclaration saisie à la main, ni pour une période néant', () => {
    expect(ecritureDeLaLiquidation({ ...Q1, cases: null, tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null }, PLAN_PAR_DEFAUT)).toEqual([])
    expect(ecritureDeLaLiquidation({
      ...Q1, tva_collectee: 0, tva_deductible: 0,
      cases: { l16: 0, l19: 0, l20: 0, l21: 0, l22: 0, l23: 0, l25: 0, l26: 0, l27: 0, l28: 0, l32: 0 },
    }, PLAN_PAR_DEFAUT)).toEqual([])
  })

  // Les centimes sont tenus en entiers : 0,1 + 0,2 n'y fait pas 0,30000000000000004.
  it('compose ses montants au centime, sans dérive de virgule flottante', () => {
    const d = { ...Q1, tva_collectee: 0.1 + 0.2 + 100, tva_deductible: 20.6 }
    const lignes = ecritureDeLaLiquidation(d, PLAN_PAR_DEFAUT)
    expect(lignes.find((l) => l.compte === '445710')?.montant).toBe(100.30)
    expect(lignes.find((l) => l.compte === '758000')?.montant).toBe(0.70)
  })
})

describe('arrondiDeLaLiquidation', () => {
  it('la TVA nette déclarée moins la TVA nette des comptes, signée : un produit en négatif, une charge en positif', () => {
    expect(arrondiDeLaLiquidation(Q1)).toBe(-0.80)
    expect(arrondiDeLaLiquidation(Q2)).toBe(-0.50)
    expect(arrondiDeLaLiquidation({ ...Q1, tva_collectee: 99.20 })).toBe(0.40)
    expect(arrondiDeLaLiquidation({ ...Q1, tva_collectee: 99.60 })).toBe(0)
  })

  it('zéro pour une déclaration saisie à la main', () => {
    expect(arrondiDeLaLiquidation({ ...Q1, cases: null })).toBe(0)
  })
})

describe('aPayerDe', () => {
  it('la ligne 32 d’une CA3, ou la TVA nette moins le crédit reçu d’une déclaration saisie à la main', () => {
    expect(aPayerDe({ cases: Q1.cases, tva_declaree: 79, credit_anterieur: 0 })).toBe(79)
    expect(aPayerDe({ cases: Q2.cases, tva_declaree: -350, credit_anterieur: 0 })).toBe(0)
    expect(aPayerDe({ cases: null, tva_declaree: 120, credit_anterieur: 20 })).toBe(100)
    expect(aPayerDe({ cases: null, tva_declaree: 120, credit_anterieur: 200 })).toBe(0)
  })
})

// ── La CA3 que l'application prépare se liquide ──────────────────────────────────────────────────────

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2027-02-10', tiers: 'Client',
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2027-02-10T09:00:00Z', updated_at: '2027-02-10T09:00:00Z', ...o,
  }
}

const T1_2027 = { debut: '2027-01-01', fin: '2027-03-31' }

// Les pièces sortent de `tirage` (src/test/encaissementsBatterie.ts) : la même suite à chaque exécution, exacte sur
// 32 bits — le congruentiel en virgule flottante d'avant le 09/10/2026 bouclait sur 10 466 valeurs.
function ca3Aleatoire(graine: number): DeclarationCa3 {
  const alea = tirage(graine)
  const pieces: Piece[] = []
  const lignes: LigneBancaire[] = []
  const taux = [20, 10, 5.5, 8.5]
  for (let i = 0; i < 12; i++) {
    const t = taux[Math.floor(alea() * taux.length)]
    const ht = Math.round(alea() * 200000) / 100
    const tva = Math.round(ht * t) / 100
    const vente = alea() < 0.5
    const avoir = alea() < 0.15
    const signe = avoir ? -1 : 1
    const id = `p${i}`
    pieces.push(piece({
      id, type_piece: vente ? 'vente' : 'achat', montant_ht: signe * ht, montant_tva: signe * tva,
      montant_ttc: signe * Math.round((ht + tva) * 100) / 100,
    }))
    lignes.push(mouvement({
      id: `l${i}`, piece_id: id, statut: 'rapprochee', date: `2027-0${1 + Math.floor(alea() * 3)}-15`,
      montant: (vente ? 1 : -1) * signe * Math.round((ht + tva) * 100) / 100,
    }))
  }
  const donnees: DonneesTva = { pieces, paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(['p3']), releve: [], ventesFacturees: ventesFactureesVides('d1') }
  return calculerCa3(donnees, T1_2027, false, Math.floor(alea() * 500), 0)
}

// Ce que `enregistrer_declaration_tva` exige d'une CA3 proposée, recopié de la migration : des lignes en euros entiers,
// positives ou nulles, qui se déduisent les unes des autres comme la notice le dit, et les montants exacts présents.
function verifieCommeLaBase(p: Record<string, unknown>): string[] {
  const fautes: string[] = []
  const cases = p.p_cases as Record<string, number>
  for (const k of ['l16', 'l19', 'l20', 'l21', 'l22', 'l23', 'l25', 'l26', 'l27', 'l28', 'l32']) {
    if (typeof cases[k] !== 'number' || cases[k] < 0 || !Number.isInteger(cases[k])) fautes.push(`${k} illisible`)
  }
  const c = cases
  if (c.l22 !== p.p_credit_anterieur) fautes.push('l22')
  if (c.l26 !== p.p_remboursement_demande) fautes.push('l26')
  if (p.p_tva_declaree !== c.l16 - c.l19 - c.l20 - c.l21) fautes.push('tva_declaree')
  if (c.l23 !== c.l19 + c.l20 + c.l21 + c.l22) fautes.push('l23')
  if (c.l25 !== Math.max(c.l23 - c.l16, 0)) fautes.push('l25')
  if (c.l28 !== Math.max(c.l16 - c.l23, 0)) fautes.push('l28')
  if (c.l32 !== c.l28) fautes.push('l32')
  if (c.l27 !== c.l25 - c.l26) fautes.push('l27')
  if ((p.p_remboursement_demande as number) > Math.max((p.p_credit_anterieur as number) - (p.p_tva_declaree as number), 0)) {
    fautes.push('remboursement')
  }
  for (const k of ['p_tva_collectee', 'p_tva_deductible', 'p_tva_deductible_immobilisations']) {
    const v = p[k] as number
    if (v == null || Math.round(v * 100) / 100 !== v) fautes.push(k)
  }
  return fautes
}

describe('la CA3 préparée par l’application se tient comme la base l’exige, et sa liquidation s’équilibre', () => {
  it('sur quarante CA3 tirées au hasard, dont des avoirs, des immobilisations et un crédit reçu', () => {
    let vues = 0
    for (let graine = 1; graine <= 40; graine++) {
      const ca3 = ca3Aleatoire(graine)
      const remboursement = ca3.cases.l25 > 0 ? Math.floor(ca3.cases.l25 / 2) : 0
      const avecRemboursement = calculerCa3Remboursee(ca3, remboursement)
      const demande: DemandeDeDeclaration = { periode: T1_2027, ca3: avecRemboursement, remboursement, tvaDeclaree: null, credit: null }
      const p = parametresEnregistrement('d1', demande, null, PLAN_PAR_DEFAUT)
      expect(verifieCommeLaBase(p), `graine ${graine}`).toEqual([])
      const lignes = p.p_ecriture as LigneEcritureMouvement[]
      expect(centimesAuSens(lignes, 'debit'), `graine ${graine}`).toBe(centimesAuSens(lignes, 'credit'))
      // Huit lignes arrondies à l'euro, à cinquante centimes près chacune : jamais plus de quatre euros.
      expect(Math.abs(arrondiDeLaLiquidation({
        periode_debut: T1_2027.debut, periode_fin: T1_2027.fin, cases: p.p_cases as Record<string, number>,
        tva_collectee: p.p_tva_collectee as number, tva_deductible: p.p_tva_deductible as number,
        tva_deductible_immobilisations: p.p_tva_deductible_immobilisations as number,
      }))).toBeLessThanOrEqual(4)
      if (lignes.length > 0) vues++
    }
    expect(vues).toBeGreaterThan(30)
  })
})

// La CA3 recalculée avec un remboursement : la ligne 26 ne change que le solde (l26, l27).
function calculerCa3Remboursee(ca3: DeclarationCa3, remboursement: number): DeclarationCa3 {
  const l26 = Math.min(ca3.cases.l25, remboursement)
  return { ...ca3, cases: { ...ca3.cases, l26, l27: ca3.cases.l25 - l26 } }
}

// ── L'enregistrement ─────────────────────────────────────────────────────────────────────────────────

function ca3(o: Partial<DeclarationCa3['cases']> = {}, comptes = { collectee: 100.40, deductible: 20.60, immobilisations: 0 }): DeclarationCa3 {
  const cases = {
    A1: 502, B5: 0, E2: 0, F8: 0, base08: 502, taxe08: 100, base09: 0, taxe09: 0, base9B: 0, taxe9B: 0, base10: 0, taxe10: 0,
    l15: 0, l16: 100, l19: 0, l20: 21, l21: 0, l22: 0, l23: 21, l25: 0, lTD: 79, l26: 0, l27: 0, l28: 79, l32: 79, ...o,
  }
  return {
    periode: { debut: '2026-01-01', fin: '2026-03-31' }, cases, netPeriode: cases.l16 - cases.l19 - cases.l20 - cases.l21,
    neant: false, retenues: [], ecartees: [], aValider: [], nonPlacees: [], achatsEnDeviseSansTva: [],
    releveRetenues: [], releveEcartees: [],
    // Aucune vente facturée dans la période (étape VF3b2) : la fabrique ne parle pas d'elles.
    exigibilitesRetenues: [], exigibilitesEcartees: [], ventesFactureesEcartees: [], exemplairesDeFacturesSources: [],
    tvaDesComptes: comptes,
  }
}

const T1 = { debut: '2026-01-01', fin: '2026-03-31' }
const T2 = { debut: '2026-04-01', fin: '2026-06-30' }

function contexte(o: Partial<ContexteDeDeclaration> = {}): ContexteDeDeclaration {
  // Un dossier qui n'a pas basculé, sauf mention contraire : rien à lire de ses ventes facturées (étape VF4c3).
  return {
    assujettiTva: true, aujourdhui: '2026-04-15', declarations: [], ouverture: null, anneesValidees: [],
    ventesFacturees: { etat: 'sans_bascule' }, ...o,
  }
}

function demande(o: Partial<DemandeDeDeclaration> = {}): DemandeDeDeclaration {
  return { periode: T1, ca3: ca3(), remboursement: 0, tvaDeclaree: null, credit: null, ...o }
}

const EN_CREDIT = { l16: 50, l20: 400, l23: 400, l25: 350, lTD: 0, l27: 350, l28: 0, l32: 0 }

describe('refusEnregistrement — les refus de la base, dans son ordre', () => {
  it('rien à redire d’une période terminée, préparée par le calcul, sur un dossier assujetti', () => {
    expect(refusEnregistrement(demande(), contexte())).toBeNull()
  })

  it('un dossier non assujetti', () => {
    expect(refusEnregistrement(demande(), contexte({ assujettiTva: false })))
      .toBe('Ce dossier n’est pas assujetti à la TVA : il n’a pas de déclaration à enregistrer.')
  })

  it('une période qui ne va pas du premier jour d’un mois au dernier, dans une même année', () => {
    const phrase = 'Une période de TVA va du premier jour d’un mois au dernier jour d’un mois, dans une même année.'
    for (const periode of [
      { debut: '2026-01-02', fin: '2026-03-31' }, { debut: '2026-01-01', fin: '2026-03-30' },
      { debut: '2025-12-01', fin: '2026-01-31' }, { debut: '2026-04-01', fin: '2026-03-31' },
    ]) {
      expect(refusEnregistrement(demande({ periode }), contexte()), periode.debut).toBe(phrase)
    }
    expect(refusEnregistrement(demande({ periode: { debut: '2026-02-01', fin: '2026-02-28' } }), contexte())).toBeNull()
  })

  it('une période qui n’est pas terminée — le dernier jour compris', () => {
    const phrase = 'La période n’est pas terminée : sa déclaration s’enregistre une fois déposée.'
    expect(refusEnregistrement(demande(), contexte({ aujourdhui: '2026-03-31' }))).toBe(phrase)
    expect(refusEnregistrement(demande(), contexte({ aujourdhui: '2026-04-01' }))).toBeNull()
  })

  it('une période qui en chevauche une déjà enregistrée', () => {
    const phrase = 'Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci : retirez-la d’abord.'
    expect(refusEnregistrement(demande(), contexte({ declarations: [{ periode_debut: '2026-03-01', periode_fin: '2026-03-31' }] }))).toBe(phrase)
    expect(refusEnregistrement(demande(), contexte({ declarations: [{ periode_debut: '2026-04-01', periode_fin: '2026-06-30' }] }))).toBeNull()
  })

  it('une saisie à la main sans TVA nette ou avec un crédit négatif', () => {
    const phrase = 'La TVA nette de la période et le crédit reporté (ligne 22, positif ou nul) sont à renseigner.'
    const aLaMain = { ca3: null, tvaDeclaree: 120, credit: 0, remboursement: 0 }
    const avant = contexte({ ouverture: '2026-07-01' })
    expect(refusEnregistrement(demande({ ...aLaMain, tvaDeclaree: null }), avant)).toBe(phrase)
    expect(refusEnregistrement(demande({ ...aLaMain, credit: -1 }), avant)).toBe(phrase)
    expect(refusEnregistrement(demande(aLaMain), avant)).toBeNull()
  })

  it('un remboursement négatif, en centimes, ou au-delà du crédit de la période', () => {
    const credit = { ca3: ca3(EN_CREDIT, { collectee: 50.20, deductible: 399.70, immobilisations: 0 }) }
    expect(refusEnregistrement(demande({ ...credit, remboursement: -1 }), contexte()))
      .toBe('Le remboursement demandé (ligne 26) est un montant positif ou nul.')
    expect(refusEnregistrement(demande({ ...credit, remboursement: 100.5 }), contexte()))
      .toBe('Le remboursement demandé (ligne 26) se demande en euros entiers.')
    expect(refusEnregistrement(demande({ ...credit, remboursement: 351 }), contexte()))
      .toBe('Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période (ligne 25).')
    expect(refusEnregistrement(demande({ ...credit, remboursement: 350 }), contexte())).toBeNull()
    // Une période à payer n'a pas de crédit à rembourser.
    expect(refusEnregistrement(demande({ remboursement: 1 }), contexte()))
      .toBe('Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période (ligne 25).')
  })

  it('le crédit reçu compte dans la borne : la ligne 22 de la CA3', () => {
    const recu = ca3({ l22: 30, l23: 51, l25: 0, lTD: 49, l28: 49, l32: 49 })
    expect(refusEnregistrement(demande({ ca3: recu, remboursement: 1 }), contexte()))
      .toBe('Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période (ligne 25).')
    const credit = ca3({ l16: 100, l22: 130, l23: 151, l25: 51, lTD: 0, l26: 51, l27: 0, l28: 0, l32: 0 })
    expect(refusEnregistrement(demande({ ca3: credit, remboursement: 51 }), contexte())).toBeNull()
  })

  it('une saisie à la main ailleurs qu’avant l’ouverture, un calcul avant elle', () => {
    const aLaMain = { ca3: null, tvaDeclaree: 120, credit: 0, remboursement: 0 }
    const phraseMain = 'Une déclaration s’enregistre telle que l’application l’a préparée : seule une période antérieure à '
      + 'l’ouverture du dossier, dont la TVA est dans les à-nouveaux, se saisit à la main.'
    expect(refusEnregistrement(demande(aLaMain), contexte())).toBe(phraseMain)
    expect(refusEnregistrement(demande(aLaMain), contexte({ ouverture: '2026-01-01' }))).toBe(phraseMain)
    expect(refusEnregistrement(demande(), contexte({ ouverture: '2027-01-01' })))
      .toBe('Cette période précède l’ouverture du dossier : sa TVA est dans les à-nouveaux, et sa déclaration se saisit '
        + 'à la main, sans liquidation.')
    expect(refusEnregistrement(demande(), contexte({ ouverture: '2026-01-01' }))).toBeNull()
  })

  it('une période d’un exercice validé — ou figé par la validation d’un exercice suivant', () => {
    expect(refusEnregistrement(demande(), contexte({ anneesValidees: [2026] })))
      .toBe('L\'exercice 2026 est validé : une déclaration de TVA ne s’y enregistre plus.')
    const aLaMain = { ca3: null, tvaDeclaree: 120, credit: 0, remboursement: 0 }
    expect(refusEnregistrement(demande(aLaMain), contexte({ ouverture: '2027-01-01', anneesValidees: [2027] })))
      .toBe('L\'exercice 2026 est figé par la validation de l\'exercice 2027 : une déclaration de TVA ne s’y enregistre plus.')
    expect(refusEnregistrement(demande(), contexte({ anneesValidees: [2025] }))).toBeNull()
  })

  it('une liquidation dont l’écart dépasse un arrondi', () => {
    const faux = ca3({}, { collectee: 120.40, deductible: 20.60, immobilisations: 0 })
    expect(refusEnregistrement(demande({ ca3: faux }), contexte())).toMatch(/^La liquidation ne s’équilibre pas : un écart de 20,80\s€ entre/)
    const limite = ca3({}, { collectee: 110, deductible: 21, immobilisations: 0 })
    expect(Math.abs(arrondiDeLaLiquidation({
      periode_debut: T1.debut, periode_fin: T1.fin, cases: { ...limite.cases }, tva_collectee: 110, tva_deductible: 21,
      tva_deductible_immobilisations: 0,
    }))).toBe(ARRONDI_MAXIMAL)
    expect(refusEnregistrement(demande({ ca3: limite }), contexte())).toBeNull()
  })
})

describe('seSaisitALaMain', () => {
  it('une période qui finit avant l’ouverture, et elle seule', () => {
    expect(seSaisitALaMain({ fin: '2025-12-31' }, '2026-01-01')).toBe(true)
    expect(seSaisitALaMain({ fin: '2026-03-31' }, '2026-01-01')).toBe(false)
    expect(seSaisitALaMain({ fin: '2025-12-31' }, null)).toBe(false)
  })
})

describe('parametresEnregistrement', () => {
  it('une CA3 préparée : sa TVA nette, sa ligne 22, sa ligne 26, ses cases, ses montants exacts et sa liquidation', () => {
    const credit = ca3({ ...EN_CREDIT, l26: 300, l27: 50 }, { collectee: 50.20, deductible: 399.70, immobilisations: 0 })
    const p = parametresEnregistrement('d1', demande({ ca3: credit, remboursement: 300 }), '2026-04-15', PLAN_PAR_DEFAUT)
    expect(p).toMatchObject({
      p_dossier_id: 'd1', p_periode_debut: '2026-01-01', p_periode_fin: '2026-03-31', p_tva_declaree: -350,
      p_credit_anterieur: 0, p_remboursement_demande: 300, p_date_declaration: '2026-04-15',
      p_tva_collectee: 50.20, p_tva_deductible: 399.70, p_tva_deductible_immobilisations: 0,
    })
    expect(p.p_cases).toEqual(credit.cases)
    expect(parCompte(sansLibelle(p.p_ecriture as LigneEcritureMouvement[]))).toEqual(parCompte(ECRITURE_Q2))
  })

  it('une saisie à la main : les montants tapés, sans cases, ni montants exacts, ni écriture', () => {
    const p = parametresEnregistrement('d1', demande({ ca3: null, tvaDeclaree: 120.5, credit: 20, remboursement: 0 }), null, PLAN_PAR_DEFAUT)
    expect(p).toEqual({
      p_dossier_id: 'd1', p_periode_debut: '2026-01-01', p_periode_fin: '2026-03-31', p_tva_declaree: 120.5,
      p_credit_anterieur: 20, p_remboursement_demande: 0, p_date_declaration: null, p_cases: null,
      p_tva_collectee: null, p_tva_deductible: null, p_tva_deductible_immobilisations: null, p_ecriture: [],
    })
  })
})

describe('seuilRemboursement — 760 € en cours d’année, 150 € au 31 décembre', () => {
  it('signale une demande plus petite, jamais un remboursement nul', () => {
    expect(seuilRemboursement('2026-03-31')).toBe(760)
    expect(seuilRemboursement('2026-12-31')).toBe(150)
    expect(remboursementSousLeSeuil('2026-03-31', 759)).toBe(true)
    expect(remboursementSousLeSeuil('2026-03-31', 760)).toBe(false)
    expect(remboursementSousLeSeuil('2026-12-31', 149)).toBe(true)
    expect(remboursementSousLeSeuil('2026-12-31', 150)).toBe(false)
    expect(remboursementSousLeSeuil('2026-03-31', 0)).toBe(false)
  })
})

// ── Le paiement et le remboursement ──────────────────────────────────────────────────────────────────

describe('ecritureDuPaiementTva', () => {
  it('un prélèvement débite la TVA à décaisser face à la banque — l’écriture que la base a acceptée', () => {
    expect(parCompte(sansLibelle(ecritureDuPaiementTva(mouvement(), PLAN_PAR_DEFAUT)))).toEqual(parCompte([
      { compte: '445510', sens: 'debit', montant: 79 },
      { compte: '512000', sens: 'credit', montant: 79 },
    ]))
  })

  it('un remboursement reçu crédite le remboursement demandé', () => {
    expect(parCompte(sansLibelle(ecritureDuPaiementTva(mouvement({ montant: 300 }), PLAN_PAR_DEFAUT)))).toEqual(parCompte([
      { compte: '512000', sens: 'debit', montant: 300 },
      { compte: '445830', sens: 'credit', montant: 300 },
    ]))
  })

  it('porte le libellé complet du relevé quand l’import n’a gardé que le générique', () => {
    const lignes = ecritureDuPaiementTva(mouvement({ libelle: 'Mouvement bancaire', libelle_brut: 'PRLV SEPA DGFIP TVA 1T' }), PLAN_PAR_DEFAUT)
    expect(new Set(lignes.map((l) => l.libelle))).toEqual(new Set(['PRLV SEPA DGFIP TVA 1T']))
  })
})

// LA COMPOSITION DE LA BASE, RÔLE PAR RÔLE (ligne 43, étape PC2). `liquidation_attendue`, `ecrire_liquidation_tva` et
// `rapprocher_declaration_tva` lisent leurs comptes dans le plan du dossier, par la CLÉ de leur rôle ; ce module les écrit
// sous les constantes, qui sont les défauts de ces clés. Chaque solde de la base est rapporté ici à son rôle, évalué sur
// une déclaration dont chaque ligne vaut autre chose, et comparé à `ecritureDeLaLiquidation` : un rôle échangé d'un seul
// côté — le crédit pour le remboursement, la TVA déductible pour celle des immobilisations — se verrait ici.
describe('la liquidation et le paiement de la base, rôle par rôle', () => {
  const sansApostrophes = (s: string) => s.replace(/''/g, "'")
  const attendue = derniereDefinitionSql('liquidation_attendue')

  it('liquidation_attendue : chaque solde au compte que ce module lui donne', () => {
    const d = declaration({
      cases: { l22: 1, l26: 3, l27: 7, l28: 80 }, tva_collectee: 100.40, tva_deductible: 20.60, tva_deductible_immobilisations: 10.30,
    })
    // La valeur de chaque expression de la base sur cette déclaration ; une expression inconnue lève.
    const valeurs: Record<string, number> = {
      collectee: 100.40, '-deductible': -20.60, '-immobilisations': -10.30, 'l27 - l22': 6, '-l28': -80, l26: 3,
    }
    const lignes = [...attendue.matchAll(/select public\.compte_du_role\(dossier_id, '(\w+)'\)(?: as compte)?, (.+?)(?: as solde)? from d/g)]
    expect(lignes.map((m) => m[1])).toEqual([
      'tva_collectee', 'tva_deductible', 'tva_immobilisations', 'credit_tva_a_reporter', 'tva_a_decaisser', 'remboursement_tva_demande',
    ])
    const soldes = lignes.map(([, role, expression]) => {
      if (!(expression in valeurs)) throw new Error(`expression inconnue : ${expression}`)
      return { compte: PLAN_PAR_DEFAUT[role as CleRoleComptable], solde: valeurs[expression] }
    })
    // L'arrondi : en charge quand il est positif, en produit sinon — la règle de la base.
    expect(attendue).toContain("case when a.solde > 0 then public.compte_du_role(d.dossier_id, 'arrondi_charge')\n"
      + "                          else public.compte_du_role(d.dossier_id, 'arrondi_produit') end")
    const arrondi = Math.round(-soldes.reduce((s, x) => s + x.solde, 0) * 100) / 100
    soldes.push({ compte: arrondi > 0 ? PLAN_PAR_DEFAUT.arrondi_charge : PLAN_PAR_DEFAUT.arrondi_produit, solde: arrondi })
    const deLaBase = soldes.filter((x) => x.solde !== 0)
      .map((x) => ({ compte: x.compte, sens: x.solde > 0 ? 'debit' : 'credit', montant: Math.round(Math.abs(x.solde) * 100) / 100 }))
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(d, PLAN_PAR_DEFAUT)))).toEqual(parCompte(deLaBase))
  })

  it('ecrire_liquidation_tva : l’écart se lit aux deux comptes d’arrondi du plan, au-delà du même seuil', () => {
    const sql = derniereDefinitionSql('ecrire_liquidation_tva')
    expect(sql).toContain("v_compte_arrondi_charge := public.compte_du_role(v_declaration.dossier_id, 'arrondi_charge');")
    expect(sql).toContain("v_compte_arrondi_produit := public.compte_du_role(v_declaration.dossier_id, 'arrondi_produit');")
    expect(sql).toContain('where compte in (v_compte_arrondi_charge, v_compte_arrondi_produit);')
    expect(sql).toContain(`if v_arrondi > ${ARRONDI_MAXIMAL} then`)
  })

  it('rapprocher_declaration_tva : un prélèvement à la TVA à décaisser, un remboursement au remboursement demandé, face à la banque', () => {
    const sql = sansApostrophes(derniereDefinitionSql('rapprocher_declaration_tva'))
    expect(sql).toContain("v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');")
    expect(sql).toContain("v_compte := public.compte_du_role(v_ligne.dossier_id,\n"
      + "    case when v_ligne.montant < 0 then 'tva_a_decaisser' else 'remboursement_tva_demande' end);")
    expect(sql).toContain("select v_banque as compte, case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,")
    expect(sql).toContain("select v_compte, case when v_ligne.montant > 0 then 'credit' else 'debit' end, abs(v_ligne.montant)")
    const compteDe = (montant: number) => ecritureDuPaiementTva(mouvement({ montant }), PLAN_PAR_DEFAUT).find((l) => l.compte !== PLAN_PAR_DEFAUT.banque)?.compte
    expect(compteDe(-79)).toBe(PLAN_PAR_DEFAUT.tva_a_decaisser)
    expect(compteDe(300)).toBe(PLAN_PAR_DEFAUT.remboursement_tva_demande)
  })
})

const Q1_ENREGISTREE = declaration({ cases: Q1.cases, tva_collectee: 100.40, tva_deductible: 20.60, tva_deductible_immobilisations: 0 })
const Q2_ENREGISTREE = declaration({
  id: 'q2', periode_debut: '2026-04-01', periode_fin: '2026-06-30', tva_declaree: -350, remboursement_demande: 300,
  cases: Q2.cases, tva_collectee: 50.20, tva_deductible: 399.70, tva_deductible_immobilisations: 0,
})

describe('refusPaiementTva — les refus de la base, dans son ordre', () => {
  it('rien à redire d’un prélèvement après la période, sur une déclaration à payer', () => {
    expect(refusPaiementTva(mouvement(), Q1_ENREGISTREE)).toBeNull()
    expect(refusPaiementTva(mouvement({ montant: 300, date: '2026-08-10' }), Q2_ENREGISTREE)).toBeNull()
  })

  it('un mouvement réglé en groupe, classé autrement, écrit sur un compte de bilan, ou de zéro euro', () => {
    expect(refusPaiementTva(mouvement({ reglement_groupe: true, statut: 'rapprochee' }), Q1_ENREGISTREE)).toBe(REFUS_REGLE_EN_GROUPE)
    for (const o of [
      { piece_id: 'p' }, { cotisation_id: 'c' }, { categorie_id: 'k' }, { emprunt_id: 'e' }, { ventilee: true },
      { prelevement_personnel: true },
    ] as Partial<LigneBancaire>[]) {
      expect(refusPaiementTva(mouvement(o), Q1_ENREGISTREE), JSON.stringify(o)).toBe(REFUS_PAIEMENT_TVA_CLASSE)
    }
    expect(refusPaiementTva(mouvement({ compte_bilan: '580000', statut: 'rapprochee' }), Q1_ENREGISTREE))
      .toBe('Ce mouvement est écrit sur le compte 580000 (Virements internes) : annule d’abord ce classement.')
    expect(refusPaiementTva(mouvement({ montant: 0 }), Q1_ENREGISTREE)).toBe('Un mouvement de zéro euro n’a rien à écrire.')
  })

  it('un mouvement qui paie déjà une déclaration n’est pas refusé : le rapprochement le remplace', () => {
    expect(refusPaiementTva(mouvement({ declaration_tva_id: 'autre', statut: 'rapprochee' }), Q1_ENREGISTREE)).toBeNull()
  })

  it('un paiement qui ne suit pas la période — le dernier jour compris', () => {
    expect(refusPaiementTva(mouvement({ date: '2026-03-31' }), Q1_ENREGISTREE))
      .toBe('Un paiement de TVA suit la période qu’il règle : ce mouvement est du 31/03/2026, la période se termine le 31/03/2026.')
    expect(refusPaiementTva(mouvement({ date: '2026-04-01' }), Q1_ENREGISTREE)).toBeNull()
  })

  it('un prélèvement sur une déclaration sans TVA à payer, un encaissement sans remboursement demandé', () => {
    expect(refusPaiementTva(mouvement({ date: '2026-07-20' }), Q2_ENREGISTREE)).toBe('Cette déclaration n’a pas de TVA à payer.')
    expect(refusPaiementTva(mouvement({ montant: 300 }), Q1_ENREGISTREE))
      .toBe('Aucun remboursement de crédit n’a été demandé sur cette déclaration (ligne 26).')
  })

  it('une déclaration saisie à la main fait payer sa TVA nette moins le crédit reçu', () => {
    const aLaMain = declaration({ periode_debut: '2025-10-01', periode_fin: '2025-12-31', tva_declaree: 120, credit_anterieur: 0 })
    expect(refusPaiementTva(mouvement({ date: '2026-01-20' }), aLaMain)).toBeNull()
    expect(refusPaiementTva(mouvement({ date: '2026-01-20' }), { ...aLaMain, credit_anterieur: 120 }))
      .toBe('Cette déclaration n’a pas de TVA à payer.')
  })
})

describe('les autres classements refusent un mouvement qui paie une déclaration de TVA', () => {
  const paie: MouvementBancaire = mouvement({ statut: 'rapprochee', declaration_tva_id: 'q1' })
  const rembourse: MouvementBancaire = mouvement({ statut: 'rapprochee', declaration_tva_id: 'q2', montant: 300 })
  const phrasePaie = 'Ce mouvement paie une déclaration de TVA : annule d’abord ce rapprochement.'
  const phraseRembourse = 'Ce mouvement est le remboursement d’un crédit de TVA : annule d’abord ce rapprochement.'

  it('la phrase dit un paiement ou un remboursement', () => {
    expect(refusPaieUneDeclarationTva(paie)).toBe(phrasePaie)
    expect(refusPaieUneDeclarationTva(rembourse)).toBe(phraseRembourse)
    expect(refusPaieUneDeclarationTva({ declaration_tva_id: null, montant: -79 })).toBeNull()
  })

  // La base les refuserait par sa contrainte d'un seul rapprochement, avec le nom de la contrainte pour toute raison :
  // chaque classement le dit avant le clic.
  it('affecter, classer en virement personnel, ventiler, régler en groupe, rapprocher d’un emprunt ou d’une cotisation, écrire sur un compte de bilan', () => {
    const categorie = { id: 'cat', libelle: 'Impôts et taxes', compte_comptable: '635100' }
    for (const [ligne, phrase] of [[paie, phrasePaie], [rembourse, phraseRembourse]] as const) {
      expect(refusAffectation(ligne, categorie, true, null)).toBe(phrase)
      expect(refusVirementPersonnel(ligne)).toBe(phrase)
      expect(refusVentilation(ligne, [], [categorie], true)).toBe(phrase)
      expect(refusReglementGroupe(ligne, [], [], new Map())).toBe(phrase)
      expect(refusEcheanceEmprunt(ligne)).toBe(phrase)
      expect(refusRapprochementCotisation(ligne, { montant_verse: null, montant_appele: 79, montant_csg_crds: null, paiement_personnel_le: null }, 'tresorerie')).toBe(phrase)
      expect(refusMouvementCompteDeBilan(ligne)).toBe(phrase)
    }
  })
})

// ── Ce qui se suit ───────────────────────────────────────────────────────────────────────────────────

describe('suiviDesDeclarations — ce que chaque déclaration fait payer, et ce que le relevé en porte', () => {
  const paiement = (o: Partial<LigneBancaire>) => mouvement({ statut: 'rapprochee', declaration_tva_id: 'q1', ...o })

  it('à payer, payée, en partie, en trop', () => {
    const etat = (lignes: LigneBancaire[]) => suiviDesDeclarations([Q1_ENREGISTREE], lignes)[0]
    expect(etat([])).toMatchObject({ aPayer: 79, paye: 0, etatPaiement: 'a_payer', etatRemboursement: 'sans_objet' })
    expect(etat([paiement({})])).toMatchObject({ paye: 79, etatPaiement: 'payee' })
    expect(etat([paiement({ montant: -40 })])).toMatchObject({ paye: 40, etatPaiement: 'payee_en_partie' })
    expect(etat([paiement({ montant: -40 }), paiement({ id: 'm2', montant: -39 })])).toMatchObject({ paye: 79, etatPaiement: 'payee' })
    expect(etat([paiement({ montant: -85.5 })])).toMatchObject({ paye: 85.5, etatPaiement: 'payee_en_trop' })
  })

  it('un mouvement ne compte que rapproché de CETTE déclaration', () => {
    const suivi = suiviDesDeclarations([Q1_ENREGISTREE], [
      mouvement({ declaration_tva_id: 'q1', statut: 'non_rapprochee' }),
      paiement({ id: 'm2', declaration_tva_id: 'q2' }),
    ])[0]
    expect(suivi).toMatchObject({ paye: 0, etatPaiement: 'a_payer', mouvements: [] })
  })

  it('un remboursement attendu, reçu, en partie ; rien à payer sur une période en crédit', () => {
    const etat = (lignes: LigneBancaire[]) => suiviDesDeclarations([Q2_ENREGISTREE], lignes)[0]
    const recu = (o: Partial<LigneBancaire>) => mouvement({ statut: 'rapprochee', declaration_tva_id: 'q2', montant: 300, date: '2026-08-10', ...o })
    expect(etat([])).toMatchObject({ aPayer: 0, etatPaiement: 'rien_a_payer', remboursementDemande: 300, etatRemboursement: 'attendu' })
    // Reçu, un remboursement ne compte pas comme un paiement : compté, il dirait la déclaration « payée de trop ».
    expect(etat([recu({})])).toMatchObject({ rembourse: 300, etatRemboursement: 'recu', paye: 0, etatPaiement: 'rien_a_payer' })
    expect(etat([recu({ montant: 200 })])).toMatchObject({ rembourse: 200, etatRemboursement: 'recu_en_partie' })
    expect(etat([recu({ montant: 301 })])).toMatchObject({ etatRemboursement: 'recu_en_trop' })
  })

  // DÉFENSIF : la base refuse de rapprocher un prélèvement d'une déclaration qui n'a rien à payer, et un encaissement
  // d'une déclaration sans remboursement demandé. Si l'un passait quand même, l'argent versé ne doit pas disparaître sous
  // « rien à payer » : il est dit de trop.
  it('un paiement sur une déclaration sans rien à payer, un remboursement sans rien de demandé : de trop, jamais tus', () => {
    const credit = suiviDesDeclarations([Q2_ENREGISTREE], [paiement({ declaration_tva_id: 'q2', date: '2026-08-10', montant: -50 })])[0]
    expect(credit).toMatchObject({ aPayer: 0, paye: 50, etatPaiement: 'payee_en_trop' })
    const aPayer = suiviDesDeclarations([Q1_ENREGISTREE], [paiement({ montant: 20 })])[0]
    expect(aPayer).toMatchObject({ remboursementDemande: 0, rembourse: 20, etatRemboursement: 'recu_en_trop' })
  })

  it('compte en centimes, et range les mouvements dans l’ordre du relevé', () => {
    const suivi = suiviDesDeclarations([Q1_ENREGISTREE], [
      paiement({ id: 'b', date: '2026-05-02', montant: -0.1 }),
      paiement({ id: 'a', date: '2026-04-20', montant: -78.7 }),
      paiement({ id: 'c', date: '2026-05-02', montant: -0.2 }),
    ])[0]
    expect(suivi.paye).toBe(79)
    expect(suivi.etatPaiement).toBe('payee')
    expect(suivi.mouvements.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('phraseDuPaiement, phraseDuRemboursement — ce que l’historique et la fiche d’un mouvement en disent', () => {
  it('chaque état, et le trop-payé pour ce qui dépasse, pas pour le total', () => {
    const suivi = (lignes: LigneBancaire[], d = Q1_ENREGISTREE) => suiviDesDeclarations([d], lignes)[0]
    const paiement = (o: Partial<LigneBancaire>) => mouvement({ statut: 'rapprochee', declaration_tva_id: 'q1', ...o })
    expect(phraseDuPaiement(suivi([]))).toBe(`${formatMoney(79)} à payer`)
    expect(phraseDuPaiement(suivi([paiement({})]))).toBe('payée')
    expect(phraseDuPaiement(suivi([paiement({ montant: -40 })]))).toBe(`payée ${formatMoney(40)} sur ${formatMoney(79)}`)
    expect(phraseDuPaiement(suivi([paiement({ montant: -85.5 })]))).toBe(`payée ${formatMoney(6.5)} de trop`)
    expect(phraseDuPaiement(suivi([], Q2_ENREGISTREE))).toBe('rien à payer')
    const recu = (o: Partial<LigneBancaire>) => mouvement({ statut: 'rapprochee', declaration_tva_id: 'q2', montant: 300, date: '2026-08-10', ...o })
    expect(phraseDuRemboursement(suivi([]))).toBeNull()
    expect(phraseDuRemboursement(suivi([], Q2_ENREGISTREE))).toBe(`remboursement de ${formatMoney(300)} attendu`)
    expect(phraseDuRemboursement(suivi([recu({})], Q2_ENREGISTREE))).toBe('remboursement reçu')
    expect(phraseDuRemboursement(suivi([recu({ montant: 200 })], Q2_ENREGISTREE))).toBe(`remboursé ${formatMoney(200)} sur ${formatMoney(300)}`)
    expect(phraseDuRemboursement(suivi([recu({ montant: 301.2 })], Q2_ENREGISTREE))).toBe(`remboursé ${formatMoney(1.2)} de trop`)
  })
})

describe('declarationsPourLeMouvement', () => {
  const q4 = declaration({ id: 'q4', periode_debut: '2025-10-01', periode_fin: '2025-12-31', tva_declaree: 120 })
  const q1 = Q1_ENREGISTREE
  const q2 = Q2_ENREGISTREE

  it('pour un prélèvement : la déclaration dont le reste dû est exactement son montant, puis celles qui attendent, la plus récente d’abord', () => {
    const suivis = suiviDesDeclarations([q4, q1, q2], [])
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-07-20', montant: -120 }), suivis).map((d) => d.id)).toEqual(['q4', 'q1'])
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-07-20', montant: -79 }), suivis).map((d) => d.id)).toEqual(['q1', 'q4'])
    // Un acompte qui ne règle exactement aucune des deux : elles attendent toutes deux, la plus récente d'abord.
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-07-20', montant: -50 }), suivis).map((d) => d.id)).toEqual(['q1', 'q4'])
  })

  it('seulement celles dont la période est finie avant lui', () => {
    const suivis = suiviDesDeclarations([q4, q1], [])
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-03-31', montant: -79 }), suivis).map((d) => d.id)).toEqual(['q4'])
  })

  it('pour un encaissement : celles qui ont demandé un remboursement', () => {
    const suivis = suiviDesDeclarations([q4, q1, q2], [])
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-08-10', montant: 300 }), suivis).map((d) => d.id)).toEqual(['q2'])
  })

  it('une déclaration déjà payée reste proposée en dernier — une majoration —, et un mouvement déjà rapproché compte comme non payé', () => {
    const paye = mouvement({ id: 'deja', statut: 'rapprochee', declaration_tva_id: 'q1', date: '2026-04-20' })
    const suivis = suiviDesDeclarations([q4, q1], [paye])
    expect(declarationsPourLeMouvement(mouvement({ id: 'autre', date: '2026-07-20', montant: -79 }), suivis).map((d) => d.id)).toEqual(['q4', 'q1'])
    expect(declarationsPourLeMouvement(paye, suivis).map((d) => d.id)).toEqual(['q1', 'q4'])
  })

  it('rien pour un mouvement de zéro euro', () => {
    expect(declarationsPourLeMouvement(mouvement({ montant: 0 }), suiviDesDeclarations([q1], []))).toEqual([])
  })
})

describe('paiementTvaPlausible — ce que les règles d’affectation ne rangent pas en lot', () => {
  const suivis = suiviDesDeclarations([Q1_ENREGISTREE, Q2_ENREGISTREE], [])

  it('le montant exact du reste dû, après la période', () => {
    expect(paiementTvaPlausible(mouvement({ montant: -79 }), suivis)).toBe(true)
    expect(paiementTvaPlausible(mouvement({ montant: 300, date: '2026-08-10' }), suivis)).toBe(true)
  })

  it('ni un autre montant, ni avant la fin de la période, ni une déclaration déjà payée', () => {
    expect(paiementTvaPlausible(mouvement({ montant: -80 }), suivis)).toBe(false)
    expect(paiementTvaPlausible(mouvement({ montant: -79, date: '2026-03-31' }), suivis)).toBe(false)
    const paye = suiviDesDeclarations([Q1_ENREGISTREE], [mouvement({ id: 'x', statut: 'rapprochee', declaration_tva_id: 'q1' })])
    expect(paiementTvaPlausible(mouvement({ id: 'y', montant: -79 }), paye)).toBe(false)
    expect(paiementTvaPlausible(mouvement({ montant: 0 }), suivis)).toBe(false)
  })
})

describe('declarationsDuMontant — la déclaration que la fiche d’un mouvement propose', () => {
  const q4 = declaration({ id: 'q4', periode_debut: '2025-10-01', periode_fin: '2025-12-31', tva_declaree: 79 })

  it('celles dont le mouvement règle exactement le reste, la plus récente d’abord', () => {
    const suivis = suiviDesDeclarations([q4, Q1_ENREGISTREE, Q2_ENREGISTREE], [])
    expect(declarationsDuMontant(mouvement({ montant: -79 }), suivis).map((d) => d.id)).toEqual(['q1', 'q4'])
    expect(declarationsDuMontant(mouvement({ montant: -79, date: '2026-02-10' }), suivis).map((d) => d.id)).toEqual(['q4'])
    expect(declarationsDuMontant(mouvement({ montant: 300, date: '2026-08-10' }), suivis).map((d) => d.id)).toEqual(['q2'])
    expect(declarationsDuMontant(mouvement({ montant: -78.99 }), suivis)).toEqual([])
  })

  it('le reste, pas le montant déclaré : un acompte en laisse un autre, et un mouvement déjà rapproché ne se compte pas', () => {
    const acompte = mouvement({ id: 'a', statut: 'rapprochee', declaration_tva_id: 'q1', montant: -40 })
    const suivis = suiviDesDeclarations([Q1_ENREGISTREE], [acompte])
    expect(declarationsDuMontant(mouvement({ id: 'solde', montant: -39 }), suivis).map((d) => d.id)).toEqual(['q1'])
    expect(declarationsDuMontant(mouvement({ id: 'solde', montant: -79 }), suivis)).toEqual([])
    expect(declarationsDuMontant(acompte, suivis)).toEqual([])
    const paye = mouvement({ id: 'p', statut: 'rapprochee', declaration_tva_id: 'q1', montant: -79 })
    expect(declarationsDuMontant(paye, suiviDesDeclarations([Q1_ENREGISTREE], [paye])).map((d) => d.id)).toEqual(['q1'])
  })

  it('un remboursement ne règle pas une TVA à payer, ni un prélèvement un remboursement, ni zéro euro rien', () => {
    const suivis = suiviDesDeclarations([Q1_ENREGISTREE, Q2_ENREGISTREE], [])
    expect(declarationsDuMontant(mouvement({ montant: 79 }), suivis)).toEqual([])
    expect(declarationsDuMontant(mouvement({ montant: -300, date: '2026-08-10' }), suivis)).toEqual([])
    expect(declarationsDuMontant(mouvement({ montant: 0 }), suivis)).toEqual([])
  })
})

describe('raisonPaiementTvaPlausible — ce que la carte des règles dit d’un mouvement écarté du lot', () => {
  it('nomme la déclaration et dit pourquoi il ne s’affecte pas', () => {
    const suivis = suiviDesDeclarations([Q1_ENREGISTREE, Q2_ENREGISTREE], [])
    expect(raisonPaiementTvaPlausible(mouvement({ montant: -79 }), suivis)).toBe(
      'Il ressemble au paiement de la TVA du 1er trimestre 2026 : à rapprocher de sa déclaration, pas à affecter — la TVA compterait en charge.',
    )
    expect(raisonPaiementTvaPlausible(mouvement({ montant: 300, date: '2026-08-10' }), suivis)).toBe(
      'Il ressemble au remboursement du crédit de TVA du 2e trimestre 2026 : à rapprocher de sa déclaration, pas à affecter — il compterait en recette.',
    )
    expect(raisonPaiementTvaPlausible(mouvement({ montant: -80 }), suivis)).toBeNull()
  })

  it('un mois se dit avec sa préposition', () => {
    const octobre = declaration({ id: 'oct', periode_debut: '2025-10-01', periode_fin: '2025-10-31', tva_declaree: 120 })
    expect(raisonPaiementTvaPlausible(mouvement({ montant: -120, date: '2025-11-20' }), suiviDesDeclarations([octobre], [])))
      .toBe('Il ressemble au paiement de la TVA d’octobre 2025 : à rapprocher de sa déclaration, pas à affecter — la TVA compterait en charge.')
  })
})

describe('idsRemboursementsTva', () => {
  it('les remboursements reçus, pas les paiements', () => {
    expect([...idsRemboursementsTva([
      mouvement({ id: 'a', statut: 'rapprochee', declaration_tva_id: 'q2', montant: 300 }),
      mouvement({ id: 'b', statut: 'rapprochee', declaration_tva_id: 'q1', montant: -79 }),
      mouvement({ id: 'c', statut: 'non_rapprochee', declaration_tva_id: null, montant: 300 }),
    ])]).toEqual(['a'])
  })
})

describe('periodesNonDeclarees', () => {
  const d = (debut: string, fin: string) => ({ periode_debut: debut, periode_fin: fin })

  it('les périodes terminées qu’aucune déclaration ne couvre', () => {
    expect(periodesNonDeclarees([d('2026-01-01', '2026-03-31')], 2026, 'trimestrielle', '2026-10-15', null).map((p) => p.libelle))
      .toEqual(['2e trimestre 2026', '3e trimestre 2026'])
  })

  it('pas la période en cours, ni celles qui précèdent l’ouverture', () => {
    expect(periodesNonDeclarees([], 2026, 'trimestrielle', '2026-09-30', '2026-04-01').map((p) => p.libelle))
      .toEqual(['2e trimestre 2026'])
  })

  it('une période dont un mois manque, même si les autres sont déclarés à part', () => {
    expect(periodesNonDeclarees([d('2026-01-01', '2026-01-31'), d('2026-02-01', '2026-02-28')], 2026, 'trimestrielle', '2026-04-15', null)
      .map((p) => p.libelle)).toEqual(['1er trimestre 2026'])
    expect(periodesNonDeclarees([d('2026-01-01', '2026-03-31')], 2026, 'mensuelle', '2026-04-15', null)).toEqual([])
  })

  it('une année entièrement déclarée par une déclaration saisie à la main', () => {
    expect(periodesNonDeclarees([d('2025-01-01', '2025-12-31')], 2025, 'mensuelle', '2026-04-15', null)).toEqual([])
  })
})

// La Checklist ne réclame une CA3 qu'une fois son échéance passée — le mois qui suit sa période —, sur les exercices
// où le dossier a une activité, hors des exercices validés.
describe('periodesEnRetard', () => {
  const d = (debut: string, fin: string) => ({ periode_debut: debut, periode_fin: fin })
  const libelles = (p: { libelle: string }[]) => p.map((x) => x.libelle)

  it('pas la période qui vient de finir : sa CA3 se dépose dans le mois qui suit', () => {
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026], '2026-10-01', null, null)))
      .toEqual(['1er trimestre 2026', '2e trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026], '2026-11-01', null, null)))
      .toEqual(['1er trimestre 2026', '2e trimestre 2026', '3e trimestre 2026'])
  })

  it('en janvier, la limite est le 1er décembre de l’année d’avant', () => {
    expect(libelles(periodesEnRetard([], 'mensuelle', [2026], '2027-01-01', null, null)).slice(-2))
      .toEqual(['octobre 2026', 'novembre 2026'])
  })

  it('les exercices où le dossier a une activité, dans l’ordre, chacun une fois', () => {
    expect(libelles(periodesEnRetard([d('2025-01-01', '2025-12-31')], 'trimestrielle', [2026, 2025, 2026], '2026-08-01', null, null)))
      .toEqual(['1er trimestre 2026', '2e trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2024], '2026-08-01', null, null))).toHaveLength(4)
    // Les années données dans le désordre se rendent dans l'ordre : la plus ancienne d'abord.
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026, 2025], '2026-05-01', null, null))).toEqual([
      '1er trimestre 2025', '2e trimestre 2025', '3e trimestre 2025', '4e trimestre 2025', '1er trimestre 2026',
    ])
  })

  it('ni avant l’ouverture, ni dans un exercice validé', () => {
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2025, 2026], '2026-08-01', '2025-07-01', '2025-12-31')))
      .toEqual(['1er trimestre 2026', '2e trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2025], '2026-08-01', '2025-07-01', null)))
      .toEqual(['3e trimestre 2025', '4e trimestre 2025'])
  })
})

// ── Les contrôles du brouillon ───────────────────────────────────────────────────────────────────────

describe('liquidationsDesynchronisees — défensif', () => {
  const liquidation = (lignes: { compte: string; sens: 'debit' | 'credit'; montant: number }[], o: Partial<EcritureBrouillon> = {}) =>
    lignes.map((l, i) => ecriture({ id: `e${i}`, declaration_tva_id: 'q1', ...l, ...o }))
  const juste = liquidation(ECRITURE_Q1 as { compte: string; sens: 'debit' | 'credit'; montant: number }[])

  it('rien à redire d’une liquidation juste', () => {
    expect(liquidationsDesynchronisees(juste, [Q1_ENREGISTREE], null, PLAN_PAR_DEFAUT)).toEqual([])
  })

  it('une liquidation absente, d’un autre montant, à une autre date', () => {
    expect(liquidationsDesynchronisees([], [Q1_ENREGISTREE], null, PLAN_PAR_DEFAUT)).toEqual([Q1_ENREGISTREE])
    expect(liquidationsDesynchronisees(juste.map((e) => (e.compte === '758000' ? { ...e, montant: 1.80 } : e)), [Q1_ENREGISTREE], null, PLAN_PAR_DEFAUT))
      .toEqual([Q1_ENREGISTREE])
    expect(liquidationsDesynchronisees(juste.map((e) => ({ ...e, date: '2026-04-01' })), [Q1_ENREGISTREE], null, PLAN_PAR_DEFAUT)).toEqual([Q1_ENREGISTREE])
  })

  it('une liquidation sur une déclaration saisie à la main', () => {
    const aLaMain = declaration({ id: 'q1' })
    expect(liquidationsDesynchronisees(juste, [aLaMain], null, PLAN_PAR_DEFAUT)).toEqual([aLaMain])
    expect(liquidationsDesynchronisees([], [aLaMain], null, PLAN_PAR_DEFAUT)).toEqual([])
  })

  it('ne juge plus une déclaration d’un exercice validé', () => {
    expect(liquidationsDesynchronisees([], [Q1_ENREGISTREE], '2026-12-31', PLAN_PAR_DEFAUT)).toEqual([])
  })

  it('les écritures d’une autre déclaration ne comptent pas', () => {
    expect(liquidationsDesynchronisees(juste.map((e) => ({ ...e, declaration_tva_id: 'q2' })), [Q1_ENREGISTREE], null, PLAN_PAR_DEFAUT)).toEqual([Q1_ENREGISTREE])
  })
})

describe('paiementsTvaDesynchronises — défensif', () => {
  const paie = mouvement({ statut: 'rapprochee', declaration_tva_id: 'q1' })
  const juste = [
    ecriture({ id: 'a', ligne_bancaire_id: 'm1', date: '2026-04-20', compte: '445510', sens: 'debit', montant: 79 }),
    ecriture({ id: 'b', ligne_bancaire_id: 'm1', date: '2026-04-20', compte: '512000', sens: 'credit', montant: 79 }),
  ]

  it('rien à redire d’un paiement juste', () => {
    expect(paiementsTvaDesynchronises(juste, [paie], null, PLAN_PAR_DEFAUT)).toEqual([])
  })

  it('une écriture absente ou sur un autre compte', () => {
    expect(paiementsTvaDesynchronises([], [paie], null, PLAN_PAR_DEFAUT)).toEqual([paie])
    expect(paiementsTvaDesynchronises([juste[0], { ...juste[1], compte: '445660' }], [paie], null, PLAN_PAR_DEFAUT)).toEqual([paie])
  })

  it('ni un mouvement d’un exercice validé, ni un mouvement qui ne paie aucune déclaration', () => {
    expect(paiementsTvaDesynchronises([], [paie], '2026-12-31', PLAN_PAR_DEFAUT)).toEqual([])
    expect(paiementsTvaDesynchronises([], [mouvement({ statut: 'rapprochee', categorie_id: 'k' })], null, PLAN_PAR_DEFAUT)).toEqual([])
  })
})

// LES VENTES FACTURÉES, À LA LIQUIDATION (ligne 28.6, chantier EC-Q3 ; étape VF3b2, puis VF4c3). La CA3 compte la TVA d'une
// facture source (lib/declarationTva.ts) ; ses écritures la portent au 445710, et la liquidation la solde — quand elles sont
// au brouillon telles que leurs sources les commandent. Ce qui se mesure ici, sur un dossier basculé : la CA3 du VRAI calcul,
// sur les ventes du VRAI module ; le brouillon que la fonction de VF4b écrit pour la VRAIE composition ; l'état de chaque
// source tel que l'onglet Écritures le calcule (lib/ecrituresVentesFactureesEcran.ts). Rien n'est écrit à la main.
// Données FICTIVES.
describe('refusEnregistrement — une période qui compte une vente facturée s’enregistre quand ses écritures sont à jour', () => {
  // Une vente de 1 000 € HT payée en février 2026, par sa pièce : 200 € de TVA, écrite au 445710.
  const pieces = [piece({ id: 'p1', date_piece: '2026-02-05', created_at: '2026-02-05T09:00:00Z' })]
  const lignes = [mouvement({ id: 'm-p1', piece_id: 'p1', statut: 'rapprochee', date: '2026-02-20', montant: 1200 })]
  // Une facture source de services du 1er mars 2026, encaissée pour `ttc` euros à `taux` %, le `date` (sans mouvement cité :
  // un virement, au 511 jusqu'au crédit).
  const sourcesDe = (ttc: number, o: {
    taux?: number; date?: string; moyen?: EncaissementDesEcritures['moyen']; emission?: string; retire?: boolean
  } = {}): SourcesDesEcrituresDeVente => {
    const taux = o.taux ?? 20
    const { encaissement, part } = encaissementVendu({
      id: 'e1', date_encaissement: o.date ?? '2026-03-10', montant: ttc, moyen: o.moyen ?? 'virement',
      retire_le: o.retire ? '2026-03-20T10:00:00Z' : null,
    }, taux)
    return {
      dossierId: 'd1', factures: [factureDesEcritures({ id: 'f1', date_emission: o.emission ?? '2026-03-01', montant_ttc: ttc })],
      lignes: [ligneVendue('f1', Math.round((ttc * 10000) / (100 + taux)) / 100, taux)],
      encaissements: [{ ...encaissement, compte_contrepartie: null, cree_par: null }], parts: [part], mouvements: [], exemplaires: [],
    }
  }
  const ventesDe = (s: SourcesDesEcrituresDeVente) => ventesFacturees({
    dossierId: s.dossierId, factures: s.factures, lignes: s.lignes, encaissements: s.encaissements, parts: s.parts,
  })
  const ca3De = (s: SourcesDesEcrituresDeVente, periode = T1) => calculerCa3(
    { pieces, paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventesDe(s) },
    periode, false, 0, 0,
  )
  const ecrit = (s: SourcesDesEcrituresDeVente, mode: ModeComptable = 'tresorerie') => brouillonDesVentes(composition(s, mode, PLAN_PAR_DEFAUT))
  const lues = (s: SourcesDesEcrituresDeVente, brouillon: EcritureBrouillon[], mode: ModeComptable = 'tresorerie'): ContexteDeDeclaration['ventesFacturees'] => ({
    etat: 'lue',
    etats: etatsDesVentesFacturees({ sources: s, brouillon, mode, plan: PLAN_PAR_DEFAUT, anneesValidees: [], ventesParLesFactures: true }),
  })
  // La TVA que le brouillon porte au 445710 dans une période, en centimes : celle que la liquidation retire.
  const au445710 = (brouillon: readonly EcritureBrouillon[], periode: { debut: string; fin: string }) => brouillon
    .filter((l) => l.compte === '445710' && l.date >= periode.debut && l.date <= periode.fin)
    .reduce((t, l) => t + Math.round(l.montant * 100) * (l.sens === 'credit' ? 1 : -1), 0)

  it('écrites, la liquidation retire du 445710 exactement ce qu’elles y portent : l’arrondi n’est que l’arrondi', () => {
    // 30 € TTC encaissés : 5 € de TVA, que l'écriture de l'encaissement porte au 445710 le 10 mars.
    const s = sourcesDe(30)
    const c = ca3De(s)
    expect(c.cases).toMatchObject({ base08: 1025, taxe08: 205, l16: 205, l28: 205 })
    expect(c.tvaDesComptes.collectee).toBe(205)
    expect(au445710(ecrit(s), T1)).toBe(500)
    const liquidee = declarationDeLaCa3(c, T1)
    expect(arrondiDeLaLiquidation(liquidee)).toBe(0)
    expect(ecritureDeLaLiquidation(liquidee, PLAN_PAR_DEFAUT).map(({ compte, sens, montant }) => [compte, sens, montant])).toEqual([
      ['445710', 'debit', 205], ['445510', 'credit', 205],
    ])
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(s, ecrit(s)) }))).toBeNull()
  })

  it('au-delà de dix euros aussi : 200 € de TVA, au centime', () => {
    const s = sourcesDe(1200)
    const c = ca3De(s)
    expect(c.tvaDesComptes.collectee).toBe(400)
    expect(arrondiDeLaLiquidation(declarationDeLaCa3(c, T1))).toBe(0)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(s, ecrit(s)) }))).toBeNull()
  })

  it('pas encore écrite : refusée, sous des mots qui nomment la source, son état et la section où l’écrire', () => {
    const s = sourcesDe(1200)
    const refus = refusEnregistrement(demande({ ca3: ca3De(s) }), contexte({ ventesFacturees: lues(s, []) }))
    expect(refus).toBe(
      'La liquidation attend les écritures des ventes facturées de la période : l’encaissement du 10/03/2026 de la facture '
      + `F2025-0001 (Client fictif, virement, ${formatMoney(1200)}) (à écrire). Sans elles, elle solderait au compte de la TVA `
      + 'collectée une TVA qu’aucune écriture à jour n’y porte. Elles se passent depuis la section « Ventes facturées » de '
      + 'l’onglet Écritures.',
    )
  })

  it('une écriture périmée : « à réécrire » ; l’écriture d’un encaissement retiré, datée dans la période : « à retirer »', () => {
    const s = sourcesDe(1200)
    const perimee = ecrit(s).map((l) => (l.compte === '445710' ? { ...l, montant: 199.99 } : l))
    expect(refusEnregistrement(demande({ ca3: ca3De(s) }), contexte({ ventesFacturees: lues(s, perimee) }))).toMatch(/\(à réécrire\)\./)
    // Retiré après avoir été écrit : la CA3 ne le compte plus, mais le 445710 porte encore sa TVA.
    const retire = sourcesDe(1200, { retire: true })
    const c = ca3De(retire)
    expect(c.exigibilitesRetenues).toEqual([])
    expect(au445710(ecrit(s), T1)).toBe(20_000)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(retire, ecrit(s)) }))).toMatch(/\(à retirer\)\./)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(retire, []) }))).toBeNull()
  })

  it('un encaissement par compensation dont le compte n’est pas choisi : « ne s’écrit pas », refusée', () => {
    const s = sourcesDe(1200, { moyen: 'compensation' })
    expect(refusEnregistrement(demande({ ca3: ca3De(s) }), contexte({ ventesFacturees: lues(s, []) }))).toMatch(/\(ne s’écrit pas\)\./)
  })

  it('une régularisation — une contre-passation — écrite : la liquidation se tient', () => {
    const e = encaissementVendu({ id: 'e1', date_encaissement: '2025-12-10', montant: 120 })
    const cp = encaissementVendu({ id: 'c1', date_encaissement: '2026-02-10', montant: -120, annule_id: 'e1' })
    const s: SourcesDesEcrituresDeVente = {
      dossierId: 'd1', factures: [factureDesEcritures({ id: 'f1', date_emission: '2025-12-01' })], lignes: [ligneVendue('f1', 100, 20)],
      encaissements: [e, cp].map((x) => ({ ...x.encaissement, compte_contrepartie: null, cree_par: null })), parts: [e.part, cp.part], mouvements: [],
      exemplaires: [],
    }
    const c = ca3De(s)
    expect(c.exigibilitesRetenues.map((x) => x.ligne)).toEqual(['B5'])
    expect(c.tvaDesComptes.collectee).toBe(180)
    expect(au445710(ecrit(s), T1)).toBe(-2000)
    expect(arrondiDeLaLiquidation(declarationDeLaCa3(c, T1))).toBe(0)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(s, ecrit(s)) }))).toBeNull()
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(s, []) }))).toMatch(/la contre-passation du 10\/02\/2026/)
  })

  it('en engagement, la TVA en attente (445800) n’entre pas dans la TVA collectée avant son exigibilité', () => {
    // Facturée le 1er mars, encaissée le 10 avril : au premier trimestre, la facture écrit 200 € au 445800, rien au 445710.
    const s = sourcesDe(1200, { date: '2026-04-10' })
    const brouillon = ecrit(s, 'engagement')
    expect(brouillon.filter((l) => l.date === '2026-03-01').map((l) => [l.compte, l.sens, l.montant]).sort())
      .toEqual([['411000', 'debit', 1200], ['445800', 'credit', 200], ['706000', 'credit', 1000]])
    const q1 = ca3De(s, T1)
    expect(q1.exigibilitesRetenues).toEqual([])
    expect(q1.tvaDesComptes.collectee).toBe(200)
    expect(au445710(brouillon, T1)).toBe(0)
    // La facture est une source de la période : à jour, rien ne retient la liquidation ; pas écrite, elle la retient.
    expect(refusEnregistrement(demande({ ca3: q1 }), contexte({ ventesFacturees: lues(s, brouillon, 'engagement') }))).toBeNull()
    expect(refusEnregistrement(demande({ ca3: q1 }), contexte({ ventesFacturees: lues(s, [], 'engagement') }))).toMatch(/la facture F2025-0001 \(Client fictif\) \(à écrire\)/)
    // Au deuxième trimestre, l'encaissement la fait passer du 445800 au 445710 : c'est elle que la CA3 compte, et la liquidation retire.
    const q2 = ca3De(s, T2)
    expect(q2.tvaDesComptes.collectee).toBe(200)
    expect(au445710(brouillon, T2)).toBe(20_000)
    expect(brouillon.filter((l) => l.date === '2026-04-10' && l.compte === '445800').map((l) => [l.sens, l.montant])).toEqual([['debit', 200]])
    expect(refusEnregistrement(demande({ periode: T2, ca3: q2 }), contexte({ aujourdhui: '2026-07-15', ventesFacturees: lues(s, brouillon, 'engagement') }))).toBeNull()
  })

  it('une exigibilité écartée de la CA3 (2,1 %) : son écriture porte sa TVA au 445710, aucune ligne ne la déclare — le refus reste', () => {
    const s = sourcesDe(102.1, { taux: 2.1 })
    const c = ca3De(s)
    expect(c.exigibilitesRetenues).toEqual([])
    expect(c.exigibilitesEcartees.map((x) => x.motif)).toEqual(['taux_a_placer'])
    expect(au445710(ecrit(s), T1)).toBe(210)
    expect(c.tvaDesComptes.collectee).toBe(202.1)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(s, ecrit(s)) }))).toBe(
      `Cette période compte la TVA d’une vente facturée à un taux qu’aucune ligne de la déclaration ne range (F2025-0001 (Client fictif) à 2,1 %, ${formatMoney(2.1)} de TVA) : `
      + 'son écriture la porte au compte de la TVA collectée, et la liquidation la solderait sans qu’elle soit déclarée. '
      + 'Cette déclaration se dépose et se liquide hors de l’application.',
    )
  })

  it('les écritures pas lues en entier : refusée, côté fermé — même une période qu’aucune vente facturée ne touche', () => {
    const s = sourcesDe(1200)
    const c = ca3De(s)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: { etat: 'en_attente' } }))).toBe(REFUS_VENTES_FACTUREES_EN_ATTENTE)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: { etat: 'incomplete', motif: 'le brouillon : lecture incomplète' } })))
      .toBe('Les écritures des ventes facturées n’ont pas pu être lues en entier (le brouillon : lecture incomplète) : la liquidation ne se décide pas sur une lecture partielle. Recharge la page.')
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: { etat: 'lue', etats: { etat: 'incoherent', motif: 'une ligne' } } })))
      .toMatch(/^Les écritures des ventes facturées ne se tiennent pas avec leurs sources \(une ligne\)/)
    const sansVente = ca3De(sourcesDe(1200, { date: '2026-04-10' }))
    expect(refusEnregistrement(demande({ ca3: sansVente }), contexte({ ventesFacturees: { etat: 'en_attente' } }))).toBe(REFUS_VENTES_FACTUREES_EN_ATTENTE)
  })

  it('une période sans vente facturée s’enregistre comme hier, même quand le dossier en compte ailleurs', () => {
    // La facture source est encaissée au deuxième trimestre : le premier n'en porte rien, et ses écritures n'y sont pas datées.
    const s = sourcesDe(1200, { date: '2026-04-10' })
    const c = ca3De(s)
    expect(c).toEqual(calculerCa3(
      { pieces, paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventesFactureesVides('d1') },
      T1, false, 0, 0,
    ))
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: lues(s, []) }))).toBeNull()
    // Un dossier qui n'a pas basculé n'a rien à lire.
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ ventesFacturees: { etat: 'sans_bascule' } }))).toBeNull()
    // Une facture source ÉCARTÉE par le module (sans date qu'on puisse lui donner) ne retient pas une période.
    const ecartee = ventesFacturees({ dossierId: 'd1', factures: [factureVendue({ id: 'f1' })], lignes: [], encaissements: [], parts: [] })
    const avecEcartee = calculerCa3(
      { pieces, paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ecartee }, T1, false, 0, 0,
    )
    expect(avecEcartee.ventesFactureesEcartees).toHaveLength(1)
    expect(refusEnregistrement(demande({ ca3: avecEcartee }), contexte({ ventesFacturees: { etat: 'sans_bascule' } }))).toBeNull()
  })

  it('chaque exigibilité retrouve SA source : l’autre encaissement de la facture, hors de la période, ne la retient pas', () => {
    // 600 € encaissés en mars, écrits ; 600 € en avril, pas encore : le premier trimestre s'enregistre, le deuxième attend.
    const deux = ['2026-03-10', '2026-04-10'].map((date, i) => encaissementVendu({ id: `e${i + 1}`, date_encaissement: date, montant: 600 }))
    const s: SourcesDesEcrituresDeVente = {
      ...sourcesDe(1200), encaissements: deux.map((x) => ({ ...x.encaissement, compte_contrepartie: null, cree_par: null })), parts: deux.map((x) => x.part),
    }
    const brouillon = ecrit(s).filter((l) => l.encaissement_id !== 'e2')
    expect(refusEnregistrement(demande({ ca3: ca3De(s) }), contexte({ ventesFacturees: lues(s, brouillon) }))).toBeNull()
    expect(refusEnregistrement(demande({ periode: T2, ca3: ca3De(s, T2) }), contexte({ aujourdhui: '2026-07-15', ventesFacturees: lues(s, brouillon) })))
      .toMatch(/l’encaissement du 10\/04\/2026 .*\(à écrire\)/)
  })

  it('le mouvement que des encaissements classent ne retient pas la liquidation : son écriture ne touche aucun compte de TVA', () => {
    // Un chèque remis le 10 mars, crédité le 12 : l'encaissement passe au 511, le mouvement solde le 511 par la banque.
    const m = mouvementDesVentes({ id: 'm-cheque', dossier_id: 'd1', date: '2026-03-12', montant: 1200, libelle: 'REMISE CHEQUE FICTIVE' })
    const base = sourcesDe(1200, { moyen: 'cheque' })
    const s: SourcesDesEcrituresDeVente = {
      ...base, encaissements: base.encaissements.map((e) => ({ ...e, ligne_bancaire_id: 'm-cheque' })), mouvements: [m],
    }
    const sansLeMouvement = ecrit(s).filter((l) => l.encaissement_id != null)
    const ventes = lues(s, sansLeMouvement)
    expect(ventes.etat === 'lue' && ventes.etats.etat === 'lus' && ventes.etats.sources.map((x) => [x.source.genre, x.etat])).toEqual([
      ['encaissement', 'a_jour'], ['mouvement', 'a_ecrire'],
    ])
    expect(refusEnregistrement(demande({ ca3: ca3De(s) }), contexte({ ventesFacturees: ventes }))).toBeNull()
  })

  it('une exigibilité dont l’état des écritures ne liste pas la source : refusée, sans la prêter à une autre source', () => {
    // Un bien livré le 1er février, et son avoir du 10 avril : l'avoir rend au deuxième trimestre une TVA négative.
    const biens = { nature_operation: 'biens' as const }
    const s: SourcesDesEcrituresDeVente = {
      dossierId: 'd1',
      factures: [
        factureDesEcritures({ id: 'f1', date_emission: '2026-02-01', montant_ttc: 120, ...biens }),
        factureDesEcritures({ id: 'a1', type: 'avoir', numero: 'A2026-0001', facture_origine_id: 'f1', date_emission: '2026-04-10', montant_ttc: -120, ...biens }),
      ],
      lignes: [ligneVendue('f1', 100, 20), { ...ligneVendue('a1', 100, 20), quantite: -1 }],
      encaissements: [], parts: [], mouvements: [], exemplaires: [],
    }
    const c = ca3De(s, T2)
    expect(c.exigibilitesRetenues.map((r) => [r.exigibilite.origine, r.ligne])).toEqual([['avoir', 'B5']])
    const ventes = lues(s, ecrit(s))
    expect(refusEnregistrement(demande({ periode: T2, ca3: c }), contexte({ aujourdhui: '2026-07-15', ventesFacturees: ventes }))).toBeNull()
    // Le même état, sans la ligne de l'avoir : la facture, à jour, ne répond pas pour lui.
    if (ventes.etat !== 'lue' || ventes.etats.etat !== 'lus') throw new Error('états non lus')
    const sansLAvoir: ContexteDeDeclaration['ventesFacturees'] = {
      etat: 'lue', etats: { ...ventes.etats, sources: ventes.etats.sources.filter((x) => x.source.genre !== 'avoir') },
    }
    expect(refusEnregistrement(demande({ periode: T2, ca3: c }), contexte({ aujourdhui: '2026-07-15', ventesFacturees: sansLAvoir })))
      .toMatch(/une source de la facture F2025-0001 que l’état des écritures ne liste pas/)
  })

  it('la forme que la liquidation lit est celle que l’écran calcule, et ses mots sont les siens', () => {
    // Le compilateur confronte les deux formes, dans les deux sens : l'état d'une source, et l'état de toutes.
    const versLaLiquidation = (e: EtatSourceDeVente): EtatDeLaSourceDeVente => e
    const versLEcran = (e: EtatDeLaSourceDeVente): EtatSourceDeVente => e
    expect(versLEcran(versLaLiquidation('a_jour'))).toBe('a_jour')
    const s = sourcesDe(1200)
    const etats: EtatsDesVentes = etatsDesVentesFacturees({
      sources: s, brouillon: [], mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, anneesValidees: [], ventesParLesFactures: true,
    })
    const lue: EcrituresDesVentesDeLaCa3 = { etat: 'lue', etats }
    expect(lue.etat).toBe('lue')
    // Les mots : la même table, clé pour clé.
    expect(ETAT_DE_LA_SOURCE_EN_MOTS).toEqual(LIBELLE_ETAT_SOURCE)
  })

  it('un dossier qui ne se dit pas basculé et dont la CA3 compte une facture source : les lectures ne se tiennent pas', () => {
    expect(refusEnregistrement(demande({ ca3: ca3De(sourcesDe(1200)) }), contexte({ ventesFacturees: { etat: 'sans_bascule' } })))
      .toMatch(/alors que le dossier ne se dit pas basculé : les lectures ne se tiennent pas/)
  })

  it('dans l’ordre : un exercice validé l’emporte, puis les ventes facturées, puis l’équilibre de la liquidation', () => {
    const s = sourcesDe(1200)
    const c = ca3De(s)
    expect(refusEnregistrement(demande({ ca3: c }), contexte({ anneesValidees: [2026], ventesFacturees: lues(s, []) })))
      .toBe('L\'exercice 2026 est validé : une déclaration de TVA ne s’y enregistre plus.')
    expect(refusEnregistrement(demande({ ca3: c, remboursement: 1.5 }), contexte({ ventesFacturees: lues(s, []) })))
      .toBe('Le remboursement demandé (ligne 26) se demande en euros entiers.')
    // Les ventes facturées avant l'équilibre : une TVA de comptes faussée à la main, et la source pas écrite — c'est elle
    // qu'on dit.
    const faussee = { ...c, tvaDesComptes: { ...c.tvaDesComptes, collectee: 0 } }
    expect(refusEnregistrement(demande({ ca3: faussee }), contexte({ ventesFacturees: lues(s, []) }))).toMatch(/^La liquidation attend les écritures/)
    expect(refusEnregistrement(demande({ ca3: faussee }), contexte({ ventesFacturees: lues(s, ecrit(s)) }))).toMatch(/n’est pas un arrondi/)
    // Une saisie à la main ne porte pas de CA3 : la règle ne la concerne pas.
    expect(refusEnregistrement(demande({ ca3: null, tvaDeclaree: 120, credit: 0, remboursement: 0 }), contexte({ ouverture: '2026-07-01', ventesFacturees: { etat: 'en_attente' } }))).toBeNull()
  })
})
