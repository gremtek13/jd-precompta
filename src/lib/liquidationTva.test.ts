import { describe, expect, it } from 'vitest'
import { refusAffectation, type LigneEcritureMouvement, type MouvementBancaire } from './affectationBanque'
import { refusPaieUneDeclarationTva } from './classementsDuMouvement'
import { refusMouvementCompteDeBilan } from './compteDeBilan'
import { refusRapprochementCotisation } from './cotisationRapprochee'
import { calculerCa3, type DeclarationCa3, type DonneesTva } from './declarationTva'
import { refusEcheanceEmprunt } from './echeanceEmprunt'
import {
  ARRONDI_MAXIMAL, REFUS_PAIEMENT_TVA_CLASSE, aPayerDe, arrondiDeLaLiquidation, declarationsDuMontant, declarationsPourLeMouvement,
  ecritureDeLaLiquidation, ecritureDuPaiementTva, idsRemboursementsTva, liquidationsDesynchronisees,
  paiementTvaPlausible, paiementsTvaDesynchronises, parametresEnregistrement, periodesEnRetard, periodesNonDeclarees,
  raisonPaiementTvaPlausible, refusEnregistrement, refusPaiementTva, remboursementSousLeSeuil, seSaisitALaMain, seuilRemboursement,
  suiviDesDeclarations, type ContexteDeDeclaration, type DeclarationLiquidable, type DemandeDeDeclaration,
} from './liquidationTva'
import { paiementsDesPieces } from './rattachement'
import { REFUS_REGLE_EN_GROUPE, refusReglementGroupe } from './reglementGroupe'
import type { DeclarationTva, EcritureBrouillon, LigneBancaire, Piece } from './types'
import { refusVentilation } from './ventilationBanque'
import { refusVirementPersonnel } from './virementPersonnel'
import { NON_VALIDEE } from '../test/ecritures'

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
    source_fichier: null, libelle_brut: null, created_at: '2026-04-21T09:00:00Z', ...o,
  }
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-03-31', compte: '445710',
    libelle: 'CA3', montant: 0, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, ...NON_VALIDEE, created_at: '2026-04-15T10:00:00Z', ...o,
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
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(Q1)))).toEqual(parCompte(ECRITURE_Q1))
  })

  it('une période en crédit dont une part est remboursée : le crédit reporté au 445670, le remboursement au 445830', () => {
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(Q2)))).toEqual(parCompte(ECRITURE_Q2))
  })

  it('une période qui reçoit un crédit le retire du 445670', () => {
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(Q3)))).toEqual(parCompte(ECRITURE_Q3))
  })

  it('s’équilibre, et porte le nom de sa période', () => {
    for (const d of [Q1, Q2, Q3]) {
      const lignes = ecritureDeLaLiquidation(d)
      expect(centimesAuSens(lignes, 'debit')).toBe(centimesAuSens(lignes, 'credit'))
    }
    expect(new Set(ecritureDeLaLiquidation(Q1).map((l) => l.libelle))).toEqual(new Set(['CA3 1er trimestre 2026']))
  })

  it('un arrondi qui fait payer plus que les comptes va au débit du 658000', () => {
    const d = { ...Q1, tva_collectee: 99.20 }
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(d)))).toEqual(parCompte([
      { compte: '445710', sens: 'debit', montant: 99.20 },
      { compte: '445660', sens: 'credit', montant: 20.60 },
      { compte: '445510', sens: 'credit', montant: 79 },
      { compte: '658000', sens: 'debit', montant: 0.40 },
    ]))
  })

  // Le crédit déclaré (60 €) est plus petit que celui des comptes (60,10 €) : les dix centimes perdus sont une charge.
  it('une TVA collectée négative — un avoir consenti seul — se crédite, et la déductible sur immobilisations a sa ligne', () => {
    const d: DeclarationLiquidable = {
      periode_debut: '2026-01-01', periode_fin: '2026-01-31', tva_collectee: -20, tva_deductible: 0,
      tva_deductible_immobilisations: 40.10,
      cases: { l16: 0, l19: 40, l20: 0, l21: 20, l22: 0, l23: 60, l25: 60, l26: 0, l27: 60, l28: 0, l32: 0 },
    }
    expect(parCompte(sansLibelle(ecritureDeLaLiquidation(d)))).toEqual(parCompte([
      { compte: '445710', sens: 'credit', montant: 20 },
      { compte: '445620', sens: 'credit', montant: 40.10 },
      { compte: '445670', sens: 'debit', montant: 60 },
      { compte: '658000', sens: 'debit', montant: 0.10 },
    ]))
  })

  it('rien pour une déclaration saisie à la main, ni pour une période néant', () => {
    expect(ecritureDeLaLiquidation({ ...Q1, cases: null, tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null })).toEqual([])
    expect(ecritureDeLaLiquidation({
      ...Q1, tva_collectee: 0, tva_deductible: 0,
      cases: { l16: 0, l19: 0, l20: 0, l21: 0, l22: 0, l23: 0, l25: 0, l26: 0, l27: 0, l28: 0, l32: 0 },
    })).toEqual([])
  })

  // Les centimes sont tenus en entiers : 0,1 + 0,2 n'y fait pas 0,30000000000000004.
  it('compose ses montants au centime, sans dérive de virgule flottante', () => {
    const d = { ...Q1, tva_collectee: 0.1 + 0.2 + 100, tva_deductible: 20.6 }
    const lignes = ecritureDeLaLiquidation(d)
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
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2027-02-10T09:00:00Z', updated_at: '2027-02-10T09:00:00Z', ...o,
  }
}

// Un générateur déterministe : la même suite à chaque exécution.
function generateur(graine: number): () => number {
  let x = graine
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

const T1_2027 = { debut: '2027-01-01', fin: '2027-03-31' }

function ca3Aleatoire(graine: number): DeclarationCa3 {
  const alea = generateur(graine)
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
  const donnees: DonneesTva = { pieces, paiements: paiementsDesPieces(lignes, []), pieceIdsImmobilisees: new Set(['p3']), releve: [] }
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
      const p = parametresEnregistrement('d1', demande, null)
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
    releveRetenues: [], releveEcartees: [], tvaDesComptes: comptes,
  }
}

const T1 = { debut: '2026-01-01', fin: '2026-03-31' }

function contexte(o: Partial<ContexteDeDeclaration> = {}): ContexteDeDeclaration {
  return { assujettiTva: true, aujourdhui: '2026-04-15', declarations: [], ouverture: null, anneesValidees: [], ...o }
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
    const p = parametresEnregistrement('d1', demande({ ca3: credit, remboursement: 300 }), '2026-04-15')
    expect(p).toMatchObject({
      p_dossier_id: 'd1', p_periode_debut: '2026-01-01', p_periode_fin: '2026-03-31', p_tva_declaree: -350,
      p_credit_anterieur: 0, p_remboursement_demande: 300, p_date_declaration: '2026-04-15',
      p_tva_collectee: 50.20, p_tva_deductible: 399.70, p_tva_deductible_immobilisations: 0,
    })
    expect(p.p_cases).toEqual(credit.cases)
    expect(parCompte(sansLibelle(p.p_ecriture as LigneEcritureMouvement[]))).toEqual(parCompte(ECRITURE_Q2))
  })

  it('une saisie à la main : les montants tapés, sans cases, ni montants exacts, ni écriture', () => {
    const p = parametresEnregistrement('d1', demande({ ca3: null, tvaDeclaree: 120.5, credit: 20, remboursement: 0 }), null)
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
    expect(parCompte(sansLibelle(ecritureDuPaiementTva(mouvement())))).toEqual(parCompte([
      { compte: '445510', sens: 'debit', montant: 79 },
      { compte: '512000', sens: 'credit', montant: 79 },
    ]))
  })

  it('un remboursement reçu crédite le remboursement demandé', () => {
    expect(parCompte(sansLibelle(ecritureDuPaiementTva(mouvement({ montant: 300 }))))).toEqual(parCompte([
      { compte: '512000', sens: 'debit', montant: 300 },
      { compte: '445830', sens: 'credit', montant: 300 },
    ]))
  })

  it('porte le libellé complet du relevé quand l’import n’a gardé que le générique', () => {
    const lignes = ecritureDuPaiementTva(mouvement({ libelle: 'Mouvement bancaire', libelle_brut: 'PRLV SEPA DGFIP TVA 1T' }))
    expect(new Set(lignes.map((l) => l.libelle))).toEqual(new Set(['PRLV SEPA DGFIP TVA 1T']))
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
      expect(refusRapprochementCotisation(ligne, { montant_verse: null, montant_appele: 79, montant_csg_crds: null }, 'tresorerie')).toBe(phrase)
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
    expect(etat([recu({})])).toMatchObject({ rembourse: 300, etatRemboursement: 'recu' })
    expect(etat([recu({ montant: 200 })])).toMatchObject({ rembourse: 200, etatRemboursement: 'recu_en_partie' })
    expect(etat([recu({ montant: 301 })])).toMatchObject({ etatRemboursement: 'recu_en_trop' })
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

describe('declarationsPourLeMouvement', () => {
  const q4 = declaration({ id: 'q4', periode_debut: '2025-10-01', periode_fin: '2025-12-31', tva_declaree: 120 })
  const q1 = Q1_ENREGISTREE
  const q2 = Q2_ENREGISTREE

  it('pour un prélèvement : la déclaration dont le reste dû est exactement son montant, puis celles qui attendent, la plus récente d’abord', () => {
    const suivis = suiviDesDeclarations([q4, q1, q2], [])
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-07-20', montant: -120 }), suivis).map((d) => d.id)).toEqual(['q4', 'q1'])
    expect(declarationsPourLeMouvement(mouvement({ date: '2026-07-20', montant: -79 }), suivis).map((d) => d.id)).toEqual(['q1', 'q4'])
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
    expect(liquidationsDesynchronisees(juste, [Q1_ENREGISTREE], null)).toEqual([])
  })

  it('une liquidation absente, d’un autre montant, à une autre date', () => {
    expect(liquidationsDesynchronisees([], [Q1_ENREGISTREE], null)).toEqual([Q1_ENREGISTREE])
    expect(liquidationsDesynchronisees(juste.map((e) => (e.compte === '758000' ? { ...e, montant: 1.80 } : e)), [Q1_ENREGISTREE], null))
      .toEqual([Q1_ENREGISTREE])
    expect(liquidationsDesynchronisees(juste.map((e) => ({ ...e, date: '2026-04-01' })), [Q1_ENREGISTREE], null)).toEqual([Q1_ENREGISTREE])
  })

  it('une liquidation sur une déclaration saisie à la main', () => {
    const aLaMain = declaration({ id: 'q1' })
    expect(liquidationsDesynchronisees(juste, [aLaMain], null)).toEqual([aLaMain])
    expect(liquidationsDesynchronisees([], [aLaMain], null)).toEqual([])
  })

  it('ne juge plus une déclaration d’un exercice validé', () => {
    expect(liquidationsDesynchronisees([], [Q1_ENREGISTREE], '2026-12-31')).toEqual([])
  })

  it('les écritures d’une autre déclaration ne comptent pas', () => {
    expect(liquidationsDesynchronisees(juste.map((e) => ({ ...e, declaration_tva_id: 'q2' })), [Q1_ENREGISTREE], null)).toEqual([Q1_ENREGISTREE])
  })
})

describe('paiementsTvaDesynchronises — défensif', () => {
  const paie = mouvement({ statut: 'rapprochee', declaration_tva_id: 'q1' })
  const juste = [
    ecriture({ id: 'a', ligne_bancaire_id: 'm1', date: '2026-04-20', compte: '445510', sens: 'debit', montant: 79 }),
    ecriture({ id: 'b', ligne_bancaire_id: 'm1', date: '2026-04-20', compte: '512000', sens: 'credit', montant: 79 }),
  ]

  it('rien à redire d’un paiement juste', () => {
    expect(paiementsTvaDesynchronises(juste, [paie], null)).toEqual([])
  })

  it('une écriture absente ou sur un autre compte', () => {
    expect(paiementsTvaDesynchronises([], [paie], null)).toEqual([paie])
    expect(paiementsTvaDesynchronises([juste[0], { ...juste[1], compte: '445660' }], [paie], null)).toEqual([paie])
  })

  it('ni un mouvement d’un exercice validé, ni un mouvement qui ne paie aucune déclaration', () => {
    expect(paiementsTvaDesynchronises([], [paie], '2026-12-31')).toEqual([])
    expect(paiementsTvaDesynchronises([], [mouvement({ statut: 'rapprochee', categorie_id: 'k' })], null)).toEqual([])
  })
})
