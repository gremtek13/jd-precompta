import { describe, expect, it } from 'vitest'
import { MOTS_DES_REFUS, type ComptesDInventaire } from './inventaire'
import { confirmationDuRetrait, regularisationsDeLExercice, type ContexteDeLInventaire, type DonneesDeLInventaire } from './inventaireEcran'
import { MOTS_DES_JUSTIFICATIFS, type JustificatifsDuDossier } from './justificatifsDeLInventaire'
import {
  ceQueLaValidationRetiendra, comptesDeLaBalancePourLaNature, exerciceDeLaRepriseALEcran, formulaireDeLaRepriseLue, formulaireDeRepriseVide,
  ouvertureDeLaBalance, pieceDeLaReprise, repriseOuverteSur, reprisesDeLExercice, soldeDit, verdictDeLaReprise,
  type FormulaireDeLaReprise, type LigneDeLaBalanceReprise,
} from './regularisationRepriseEcran'
import type { OperationInventaire } from './types'

// LA RÉGULARISATION REPRISE D'UNE BALANCE, À L'ÉCRAN (ligne 35, INV3-Q2 (A) ; lib/regularisationRepriseEcran.ts). Ce que ces cas
// gardent : la balance qui ouvre l'exercice au 1er janvier, seule, offre la reprise ; les comptes proposés sont ceux de la balance
// sous la racine de la nature, le 4084 écarté ; la saisie TELLE QU'ELLE PART à `enregistrer_operation_inventaire` (`reprise: true`,
// l'exercice que la balance clôt, la seule extourne) ; chaque refus aux mots de la base, avant le clic ; une confirmation qui
// nomme l'extourne et sa pièce « Inventaire N−1 » ; ce que la validation retiendra. Des données FICTIVES, un jour fixe.

const COMPTES: ComptesDInventaire = {
  charges_constatees_avance: '486100', produits_constates_avance: '487100', factures_non_parvenues: '408110', factures_a_etablir: '418110',
  tva_factures_non_parvenues: '445861', tva_factures_a_etablir: '445871',
}

const BALANCE: LigneDeLaBalanceReprise[] = [
  { date: '2025-01-01', compte: '512100', sens: 'debit', montant: 1000 },
  { date: '2025-01-01', compte: '486200', sens: 'debit', montant: 300 },
  { date: '2025-01-01', compte: '486300', sens: 'debit', montant: 40 },
  { date: '2025-01-01', compte: '486300', sens: 'credit', montant: 40 },
  { date: '2025-01-01', compte: '408200', sens: 'credit', montant: 120 },
  { date: '2025-01-01', compte: '408400', sens: 'credit', montant: 50 },
  { date: '2025-01-01', compte: '445862', sens: 'debit', montant: 20 },
]

const ctx = (o: Partial<ContexteDeLInventaire> = {}): ContexteDeLInventaire => ({
  mode: 'engagement', assujettiTva: true, exercice: 2025, anneesValidees: [], aujourdhui: '2026-11-13', ...o,
})
const DONNEES: Pick<DonneesDeLInventaire, 'comptes'> = { comptes: COMPTES }
const saisie = (o: Partial<FormulaireDeLaReprise> = {}): FormulaireDeLaReprise => ({
  ...formulaireDeRepriseVide('cca'), compteRegularisation: '486200', compteResultat: '616100', montant: '300,00', objet: 'Assurance reprise', ...o,
})
const JUSTIFICATIFS: JustificatifsDuDossier = {
  pieces: [{ id: 'pa', dossier_id: 'd', nom_fichier: 'assurance.pdf', date_piece: '2024-07-01', tiers: null, montant_ttc: 600, type_piece: 'achat', statut: 'validee' }],
  factures: [],
}
const operation = (p: Partial<OperationInventaire> & Pick<OperationInventaire, 'id'>): OperationInventaire => ({
  dossier_id: 'd', exercice: 2024, nature: 'cca', compte_resultat: '616100', compte_regularisation: '486200', montant_centimes: 30_000, tva_centimes: 0,
  periode_debut: null, periode_fin: null, objet: 'Assurance reprise', piece_citee_id: null, reprise: true, provision_id: null, version: 3,
  cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

describe('la balance qui ouvre l’exercice', () => {
  it('l’ouverture est la première date ; seule une balance au 1er janvier de l’exercice offre la reprise', () => {
    expect(ouvertureDeLaBalance(BALANCE)).toBe('2025-01-01')
    expect(ouvertureDeLaBalance([])).toBeNull()
    expect(repriseOuverteSur(2025, '2025-01-01')).toBe(true)
    expect(repriseOuverteSur(2026, '2025-01-01')).toBe(false)
    expect(repriseOuverteSur(2025, '2025-03-01')).toBe(false)
    expect(repriseOuverteSur(2025, null)).toBe(false)
    expect(pieceDeLaReprise(2025)).toBe('Inventaire 2024')
  })

  it('les comptes proposés : ceux de la balance sous la racine de la nature, leur solde repris, le 4084 écarté', () => {
    expect(comptesDeLaBalancePourLaNature(BALANCE, 'cca')).toEqual([{ compte: '486200', soldeCentimes: 30000 }, { compte: '486300', soldeCentimes: 0 }])
    expect(comptesDeLaBalancePourLaNature(BALANCE, 'fnp')).toEqual([{ compte: '408200', soldeCentimes: -12000 }])
    expect(comptesDeLaBalancePourLaNature(BALANCE, 'pca')).toEqual([])
    expect(soldeDit(30000)).toMatch(/^300,00\s€ au débit$/)
    expect(soldeDit(-12000)).toMatch(/^120,00\s€ au crédit$/)
    expect(soldeDit(0)).toBe('soldé')
  })

  it('l’exercice jugé est celui que la balance clôt, figé dès qu’il ou un suivant est validé', () => {
    expect(exerciceDeLaRepriseALEcran(ctx(), '2025-01-01')).toEqual({ exercice: 2024, valide: false, anneeEnCours: 2026, ouverture: '2025-01-01' })
    expect(exerciceDeLaRepriseALEcran(ctx({ anneesValidees: [2025] }), '2025-01-01').valide).toBe(true)
  })
})

describe('le verdict, sur la saisie telle qu’elle part', () => {
  it('permis : la seule extourne au 1er janvier, `reprise: true` et l’exercice que la balance clôt, une confirmation qui nomme tout', () => {
    const v = verdictDeLaReprise(saisie({ pieceCitee: 'pa' }), ctx(), DONNEES, '2025-01-01', null, JUSTIFICATIFS)
    if (v.etat !== 'permis') throw new Error(JSON.stringify(v))
    expect(v.appel).toEqual({
      operation: {
        id: null, exercice: 2024, nature: 'cca', compte_resultat: '616100', compte_regularisation: '486200', montant_centimes: 30000,
        tva_centimes: 0, objet: 'Assurance reprise', periode_debut: null, periode_fin: null, piece_citee_id: 'pa', reprise: true,
      },
      ecritures: [{
        date: '2025-01-01', journal: 'OD', libelle: expect.stringMatching(/^Extourne — CCA 31\/12\/2024 — .*Assurance reprise$/),
        lignes: [{ compte: '486200', sens: 'credit', centimes: 30000 }, { compte: '616100', sens: 'debit', centimes: 30000 }],
      }],
      versionLue: null,
    })
    expect(v.confirmation).toContain('seule l’extourne au 01/01/2025 s’écrit')
    expect(v.confirmation).toContain('« Inventaire 2024 »')
    expect(v.confirmation).toContain('Pièce citée : « assurance.pdf »')
    expect(v.confirmation).not.toContain('31/12/2024 :')
  })

  it('une facture non parvenue reprise d’un assujetti : sa TVA d’attente au compte du plan, extournée avec elle', () => {
    const v = verdictDeLaReprise(saisie({ nature: 'fnp', compteRegularisation: '408200', compteResultat: '622600', montant: '100', tva: '20' }), ctx(), DONNEES, '2025-01-01', null, null)
    if (v.etat !== 'permis') throw new Error(JSON.stringify(v))
    expect(v.extourne.lignes).toEqual([
      { compte: '622600', sens: 'credit', centimes: 10000 }, { compte: '445861', sens: 'credit', centimes: 2000 }, { compte: '408200', sens: 'debit', centimes: 12000 },
    ])
    expect(v.appel.operation).toMatchObject({ tva_centimes: 2000, reprise: true })
  })

  it('un remplacement retient la version qu’il remplace, et son identifiant', () => {
    const remplace = operation({ id: 'r1' })
    const v = verdictDeLaReprise(formulaireDeLaRepriseLue(remplace), ctx(), DONNEES, '2025-01-01', remplace, null)
    if (v.etat !== 'permis') throw new Error(JSON.stringify(v))
    expect(v.appel.versionLue).toBe(3)
    expect(v.appel.operation.id).toBe('r1')
    expect(v.confirmation).toContain('Remplacer cette régularisation reprise')
  })

  it('les refus, aux mots de la base et dans son ordre', () => {
    const refus = (f: FormulaireDeLaReprise, c = ctx(), ouverture: string | null = '2025-01-01', j: JustificatifsDuDossier | null = null) => {
      const v = verdictDeLaReprise(f, c, DONNEES, ouverture, null, j)
      return v.etat === 'refuse' ? v.refus : []
    }
    expect(refus(saisie(), ctx({ mode: 'tresorerie' }))).toEqual([MOTS_DES_REFUS.tresorerie])
    expect(refus(saisie(), ctx({ anneesValidees: [2024] }))).toEqual([MOTS_DES_REFUS.exerciceFige])
    expect(refus(saisie(), ctx(), '2025-03-01')).toEqual([MOTS_DES_REFUS.repriseHorsDeLOuverture])
    expect(refus(saisie(), ctx({ exercice: 2026 }))).toEqual([MOTS_DES_REFUS.repriseHorsDeLOuverture])
    expect(refus(saisie({ compteRegularisation: '' }))).toEqual([MOTS_DES_REFUS.compteDeLaReprise])
    expect(refus(saisie({ nature: 'fnp', compteRegularisation: '408400', compteResultat: '622600' }))).toEqual([MOTS_DES_REFUS.compteDeLaReprise])
    expect(refus(saisie({ compteResultat: '706000' }))).toEqual([MOTS_DES_REFUS.compteDeCharge])
    expect(refus(saisie({ montant: 'abc', objet: '' }))).toEqual([MOTS_DES_REFUS.montant, MOTS_DES_REFUS.objet])
    expect(refus(saisie({ pieceCitee: 'inconnue' }), ctx(), '2025-01-01', JUSTIFICATIFS)).toEqual([MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier])
    // Un exonéré : la TVA ne s'offre pas, rien ne part en TVA.
    const v = verdictDeLaReprise(saisie({ nature: 'fnp', compteRegularisation: '408200', compteResultat: '622600', tva: '20' }), ctx({ assujettiTva: false }), DONNEES, '2025-01-01', null, null)
    expect(v.etat === 'permis' && v.appel.operation.tva_centimes).toBe(0)
  })
})

describe('ce que la section montre', () => {
  it('les reprises de l’exercice affiché sont celles de l’exercice que la balance clôt ; la liste ordinaire ne les montre jamais', () => {
    const ops = [operation({ id: 'r1' }), operation({ id: 'o1', reprise: false }), operation({ id: 'r0', exercice: 2023 })]
    expect(reprisesDeLExercice(ops, 2025).map((o) => o.id)).toEqual(['r1'])
    expect(regularisationsDeLExercice(ops, 2024).map((o) => o.id)).toEqual(['o1'])
  })

  it('le retrait d’une reprise nomme sa seule extourne', () => {
    expect(confirmationDuRetrait(operation({ id: 'r1' }))).toMatch(/^Retirer la régularisation reprise « Assurance reprise » .*486200.*Son extourne au 01\/01\/2025 est retirée/)
  })

  it('ce que la validation retiendra : chaque compte repris que les extournes enregistrées ne soldent pas, avant comme après', () => {
    const r1 = operation({ id: 'r1' })
    const avant = ceQueLaValidationRetiendra(BALANCE, { operations: [r1], lignes: [] }, 2025)
    expect(avant.map((c) => c.compte)).toEqual(['408200', '445862', '486200'])
    const lignes = [
      { date: '2025-01-01', compte: '486200', sens: 'credit' as const, montant: 300, operation_inventaire_id: 'r1' },
      { date: '2025-01-01', compte: '616100', sens: 'debit' as const, montant: 300, operation_inventaire_id: 'r1' },
    ]
    expect(ceQueLaValidationRetiendra(BALANCE, { operations: [r1], lignes }, 2025).map((c) => c.compte)).toEqual(['408200', '445862'])
  })
})
