import { describe, expect, it } from 'vitest'
import {
  confirmationDeLEnregistrement, confirmationDuRetrait, decisionDeLaSaisie, decisionEnVigueur, destinationsAdmises, eurosTapes,
  exerciceDeLaDateValide, jugerLaSaisie, parametresDeLEnregistrement, propositionDeLAffectation, refusDuRetrait, REFUS_DES_STATUTS,
  resultatDeLExercice, SAISIE_VIERGE, saisieDeLaDecision, soldesALaDate,
  type DecisionLue, type LigneDOuvertureLue, type LigneDuBrouillonLue, type LueDeLAffectation, type SaisieDeLaCarte,
} from './affectationEcran'
import { centimesDeLaSaisie } from './saisies2035'
import type { ComptesDeLAffectation } from './affectationDuResultat'
import { COUPLES_ADMIS } from './affectationDuResultat'
import { modeleDeTest } from '../test/modeles'

// L'ÉCRAN DE L'AFFECTATION, SA LOGIQUE (AFF4) : ce que la carte lit (le résultat, les soldes), la proposition, le jugement de la
// saisie TELLE QU'ELLE PART — aux mots du module, jamais recopiés —, les paramètres de la base et les mots des confirmations.
// L'exemple est celui de la conception (§ 3.6) : une SARL au capital de 10 000 €, réserve légale existante 800 €, bénéfice 2026
// de 30 000 €, décision du 15/05/2027.

const COMPTES: ComptesDeLAffectation = {
  resultat_benefice: '120000', resultat_perte: '129000', reserve_legale: '106100', reserves_statutaires: '106300',
  autres_reserves: '106800', report_a_nouveau_crediteur: '110000', report_a_nouveau_debiteur: '119000', dividendes_a_payer: '457000',
}
const AUJOURD_HUI = '2027-11-12'
const MODELE = modeleDeTest('engagement')

const ouv = (date: string, compte: string, sens: 'debit' | 'credit', montant: number): LigneDOuvertureLue => ({ date, compte, sens, montant })
const brouillon = (date: string, compte: string, sens: 'debit' | 'credit', montant: number, statut = 'validee', affectationId: string | null = null): LigneDuBrouillonLue =>
  ({ ...ouv(date, compte, sens, montant), statut, affectationId })

const lue = (l: Partial<LueDeLAffectation> = {}): LueDeLAffectation => ({
  dossierId: 'd1', annee: 2026, etat: 'lue', formeJuridique: '5499', capitalCentimes: 1_000_000, comptes: COMPTES, anneesValidees: [2026],
  brouillon: [brouillon('2026-06-30', '706000', 'credit', 30_000), brouillon('2026-07-01', '613000', 'debit', 0.5)],
  reportes: [ouv('2027-01-01', '101000', 'credit', 10_000), ouv('2027-01-01', '106100', 'credit', 800)],
  aNouveaux: [], decisions: [], ...l,
})

const saisie = (s: Partial<SaisieDeLaCarte> = {}): SaisieDeLaCarte => ({
  organe: 'assemblee', nombreDAssocies: 'plusieurs', comptesApprouves: true, dateDecision: '2027-05-15', dateMiseEnPaiement: '2027-06-15',
  statuts: 'distribuables',
  lignes: [
    { origine: 'benefice', destination: 'reserve_legale', montant: '200' },
    { origine: 'benefice', destination: 'autres_reserves', montant: '9 799,50' },
    { origine: 'benefice', destination: 'dividendes', montant: '20000' },
  ],
  ...s,
})

const decisionLue = (d: Partial<DecisionLue> = {}): DecisionLue => ({
  id: 'a1', version: 1, etat: 'en_vigueur', organe: 'assemblee', nombreDAssocies: 'plusieurs', dateDecision: '2027-05-15', comptesApprouves: true,
  dateMiseEnPaiement: null, reservesStatutairesDistribuables: true, finLe: null,
  lignes: [{ origine: 'benefice', destination: 'reserve_legale', centimes: 20_000 }, { origine: 'benefice', destination: 'report_crediteur', centimes: 2_970_000 }],
  ...d,
})

describe('le résultat de l’exercice, lu', () => {
  it('crédit moins débit des classes 6 et 7 VALIDÉES de l’année, en centimes (un bénéfice positif, une perte négative)', () => {
    expect(resultatDeLExercice(lue().brouillon, 2026)).toBe(3_000_000 - 50)
    expect(resultatDeLExercice([brouillon('2026-05-01', '613000', 'debit', 100)], 2026)).toBe(-10_000)
  })
  it('ignore une ligne non validée, d’une autre année, ou d’un compte de bilan', () => {
    const lignes = [
      brouillon('2026-05-01', '706000', 'credit', 100, 'proposee'),
      brouillon('2025-12-31', '706000', 'credit', 100),
      brouillon('2027-01-01', '706000', 'credit', 100),
      brouillon('2026-05-01', '512000', 'debit', 100),
      brouillon('2026-05-01', '706000', 'credit', 12.34),
    ]
    expect(resultatDeLExercice(lignes, 2026)).toBe(1234)
  })
})

describe('les soldes à la date de la décision (ce que la base lit aussi)', () => {
  const sources = (s: Partial<Parameters<typeof soldesALaDate>[0]> = {}) => ({ reportes: [], aNouveaux: [], brouillon: [], ...s })
  it('l’ouverture du 1er janvier de l’année de la date, puis ce que le brouillon y a écrit jusqu’à la décision incluse', () => {
    const s = soldesALaDate(sources({
      reportes: [ouv('2027-01-01', '101000', 'credit', 10_000), ouv('2027-01-01', '106100', 'credit', 800), ouv('2026-01-01', '106100', 'credit', 999)],
      aNouveaux: [ouv('2027-01-01', '110000', 'credit', 50), ouv('2027-05-16', '110000', 'credit', 70)],
      brouillon: [brouillon('2027-05-15', '106100', 'credit', 20, 'proposee'), brouillon('2027-05-16', '106100', 'credit', 5)],
    }), '2027-05-15', null)
    expect(s.capitalAuxComptes).toBe(1_000_000)
    expect(s.reserveLegale).toBe(80_000 + 2_000)
    expect(s.reportCrediteur).toBe(5_000)
  })
  it('classe chaque racine : 1068 et 106 non ventilé aux autres réserves, 119 en pertes antérieures, 1209 en acomptes', () => {
    const s = soldesALaDate(sources({
      reportes: [
        ouv('2027-01-01', '104000', 'credit', 1), ouv('2027-01-01', '105000', 'credit', 2), ouv('2027-01-01', '106200', 'credit', 3),
        ouv('2027-01-01', '106300', 'credit', 4), ouv('2027-01-01', '106400', 'credit', 5), ouv('2027-01-01', '106800', 'credit', 6),
        ouv('2027-01-01', '106000', 'credit', 7), ouv('2027-01-01', '119000', 'debit', 8), ouv('2027-01-01', '120900', 'debit', 9),
        ouv('2027-01-01', '109000', 'credit', 10),
      ],
    }), '2027-05-15', null)
    expect(s).toMatchObject({
      primes: 100, ecartsDeReevaluation: 200, reservesIndisponibles: 300, reservesStatutaires: 400, reservesReglementees: 500,
      autresReserves: 1300, pertesAnterieures: 800, acomptesSurDividendes: 900, capitalAuxComptes: 1000,
    })
  })
  it('écarte la décision qu’on remplace, et jamais une ligne que nulle décision ne cite (AFF4-Q1 : comme `affectation_soldes`)', () => {
    const brouillonDesSoldes = [
      brouillon('2027-03-01', '110000', 'credit', 100, 'proposee', 'a1'),
      brouillon('2027-03-02', '110000', 'credit', 7, 'validee', null),
    ]
    expect(soldesALaDate(sources({ brouillon: brouillonDesSoldes }), '2027-05-15', 'a1').reportCrediteur).toBe(700)
    expect(soldesALaDate(sources({ brouillon: brouillonDesSoldes }), '2027-05-15', null).reportCrediteur).toBe(10_700)
    expect(soldesALaDate(sources({ brouillon: brouillonDesSoldes }), '2027-05-15', 'autre').reportCrediteur).toBe(10_700)
  })
})

describe('la proposition', () => {
  it('l’exemple de la conception : la réserve légale plafonnée au dixième restant (200 €), le reste au report à nouveau', () => {
    const { proposition } = propositionDeLAffectation(lue(), MODELE, saisie(), AUJOURD_HUI)
    expect(proposition?.reserveLegaleMinimale).toBe(20_000)
    expect(proposition?.lignes).toEqual([
      { origine: 'benefice', destination: 'reserve_legale', centimes: 20_000 },
      { origine: 'benefice', destination: 'report_crediteur', centimes: 2_999_950 - 20_000 },
    ])
  })
  it('se calcule à la date saisie quand elle suit la clôture, sinon au 1er janvier qui suit l’exercice, et le dit', () => {
    expect(propositionDeLAffectation(lue(), MODELE, saisie({ dateDecision: '2027-05-15' }), AUJOURD_HUI).auJour).toBe('2027-05-15')
    expect(propositionDeLAffectation(lue(), MODELE, saisie({ dateDecision: '' }), AUJOURD_HUI).auJour).toBe('2027-01-01')
    expect(propositionDeLAffectation(lue(), MODELE, saisie({ dateDecision: '2026-12-31' }), AUJOURD_HUI).auJour).toBe('2027-01-01')
    expect(propositionDeLAffectation(lue(), MODELE, saisie({ dateDecision: 'pas une date' }), AUJOURD_HUI).auJour).toBe('2027-01-01')
  })
  it('nulle hors du champ : un dossier en trésorerie, une forme absente', () => {
    expect(propositionDeLAffectation(lue(), modeleDeTest('tresorerie'), saisie(), AUJOURD_HUI).proposition).toBeNull()
    expect(propositionDeLAffectation(lue({ formeJuridique: null }), MODELE, saisie(), AUJOURD_HUI).proposition).toBeNull()
  })
})

describe('le jugement de la saisie telle qu’elle part', () => {
  const brut = { resultat: 3_000_000 - 50 }
  // Le résultat du jeu d'essai est de 29 999,50 € (une charge de 0,50 € au débit) : la saisie du cas l'affecte en entier.
  const entiere = saisie()

  it('une saisie qui affecte tout le résultat s’enregistre, et son écriture est composée par le module', () => {
    const j = jugerLaSaisie(lue(), MODELE, entiere, AUJOURD_HUI)
    expect(j.jugement.refus).toEqual([])
    expect(j.refusDeLaCarte).toBeNull()
    expect(j.enregistrable).toBe(true)
    expect(j.ecriture?.lignes).toEqual([
      { compte: '120000', sens: 'debit', centimes: brut.resultat },
      { compte: '106100', sens: 'credit', centimes: 20_000 },
      { compte: '106800', sens: 'credit', centimes: 979_950 },
      { compte: '457000', sens: 'credit', centimes: 2_000_000 },
    ])
    expect(j.ecriture?.pieceRef).toBe('Affectation du résultat 2026 — décision du 15/05/2027')
  })
  it('dit le refus du module, à ses mots, avant tout clic : une réserve légale trop basse', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie({ lignes: [
      { origine: 'benefice', destination: 'reserve_legale', montant: '100' },
      { origine: 'benefice', destination: 'report_crediteur', montant: '29 899,50' },
    ], dateMiseEnPaiement: '' }), AUJOURD_HUI)
    expect(j.jugement.refus.map((r) => r.code)).toEqual(['reserve-legale-insuffisante'])
    expect(j.jugement.refus[0].message).toContain('La réserve légale doit recevoir au moins')
    expect(j.enregistrable).toBe(false)
    expect(j.ecriture).toBeNull()
  })
  it('un montant illisible part en refus du module, jamais en zéro ; un montant vide est une ligne qui n’est pas positive', () => {
    for (const montant of ['abc', '12,345', '']) {
      const j = jugerLaSaisie(lue(), MODELE, saisie({ lignes: [{ origine: 'benefice', destination: 'report_crediteur', montant }] }), AUJOURD_HUI)
      expect(j.jugement.refus.map((r) => r.code), montant).toEqual(['montant-illisible'])
      expect(j.enregistrable).toBe(false)
    }
    const nul = decisionDeLaSaisie(saisie({ lignes: [{ origine: 'benefice', destination: 'report_crediteur', montant: 'abc' }] }), 2026)
    expect(Number.isNaN(nul.lignes[0].centimes)).toBe(true)
  })
  it('une date illisible, ou à la clôture, se refuse ; une date dans un exercice validé aussi', () => {
    expect(jugerLaSaisie(lue(), MODELE, saisie({ dateDecision: '' }), AUJOURD_HUI).jugement.refus.map((r) => r.code)).toEqual(['date-illisible'])
    expect(jugerLaSaisie(lue(), MODELE, saisie({ dateDecision: '2026-12-31' }), AUJOURD_HUI).jugement.refus.map((r) => r.code)).toContain('date-avant-cloture')
    const j = jugerLaSaisie(lue({ anneesValidees: [2026, 2027] }), MODELE, entiere, AUJOURD_HUI)
    expect(j.jugement.refus.map((r) => r.code)).toEqual(['exercice-de-la-decision-valide'])
  })
  it('des comptes non approuvés sans ligne ne composent aucune écriture et s’enregistrent', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie({ comptesApprouves: false, lignes: [], dateMiseEnPaiement: '' }), AUJOURD_HUI)
    expect(j.jugement.refus).toEqual([])
    expect(j.enregistrable).toBe(true)
    expect(j.ecriture).toBeNull()
  })
  it('un choix des statuts non fait se refuse, au mot de la carte, et rien ne se compose', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie({ statuts: '' }), AUJOURD_HUI)
    expect(j.refusDeLaCarte).toBe(REFUS_DES_STATUTS)
    expect(j.enregistrable).toBe(false)
    expect(j.ecriture).toBeNull()
  })
  it('un dossier en trésorerie, une entreprise individuelle ou une forme absente se refusent en premier', () => {
    expect(jugerLaSaisie(lue(), modeleDeTest('tresorerie'), entiere, AUJOURD_HUI).jugement.refus.map((r) => r.code)).toEqual(['tresorerie'])
    expect(jugerLaSaisie(lue({ formeJuridique: '1000' }), MODELE, entiere, AUJOURD_HUI).jugement.refus.map((r) => r.code)).toEqual(['entreprise-individuelle'])
    expect(jugerLaSaisie(lue({ formeJuridique: null }), MODELE, entiere, AUJOURD_HUI).jugement.refus.map((r) => r.code)).toEqual(['forme-absente'])
    expect(jugerLaSaisie(lue({ capitalCentimes: null }), MODELE, entiere, AUJOURD_HUI).jugement.refus.map((r) => r.code)).toEqual(['capital-absent'])
  })
  it('l’associé unique et un seul associé vont ensemble, aux mots du module', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie({ organe: 'associe_unique' }), AUJOURD_HUI)
    expect(j.jugement.refus.map((r) => r.code)).toEqual(['organe-et-associes'])
  })
  it('remplacer une décision écarte la sienne des soldes : sa réserve légale n’est pas comptée deux fois', () => {
    const avecLaDecision = lue({
      decisions: [decisionLue()],
      brouillon: [...lue().brouillon, brouillon('2027-05-15', '120000', 'debit', 29_999.5, 'proposee', 'a1'),
        brouillon('2027-05-15', '106100', 'credit', 200, 'proposee', 'a1'), brouillon('2027-05-15', '110000', 'credit', 29_799.5, 'proposee', 'a1')],
    })
    const j = jugerLaSaisie(avecLaDecision, MODELE, entiere, AUJOURD_HUI)
    expect(j.contexte.soldes.reserveLegale).toBe(80_000)
    expect(j.contexte.soldes.reportCrediteur).toBe(0)
    expect(j.jugement.refus).toEqual([])
  })
})

describe('les paramètres de la base', () => {
  it('`enregistrer_affectation` : la décision aux clés de la base, les lignes dans l’ordre de la saisie, l’écriture composée', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie(), AUJOURD_HUI)
    const p = parametresDeLEnregistrement('d1', 2026, null, j)
    expect(p.p_decision).toEqual({
      organe: 'assemblee', nombre_d_associes: 'plusieurs', date_decision: '2027-05-15', comptes_approuves: true,
      date_mise_en_paiement: '2027-06-15', reserves_statutaires_distribuables: true,
    })
    expect(p.p_lignes).toEqual([
      { origine: 'benefice', destination: 'reserve_legale', centimes: 20_000 },
      { origine: 'benefice', destination: 'autres_reserves', centimes: 979_950 },
      { origine: 'benefice', destination: 'dividendes', centimes: 2_000_000 },
    ])
    expect(p.p_ecriture).toBe(j.ecriture)
    expect([p.p_dossier_id, p.p_exercice, p.p_version_lue]).toEqual(['d1', 2026, null])
    expect(parametresDeLEnregistrement('d1', 2026, 3, j).p_version_lue).toBe(3)
  })
  it('la décision « non approuvée » part sans ligne, sans paiement et sans écriture (nulle, jamais absente)', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie({ comptesApprouves: false, lignes: [], dateMiseEnPaiement: '' }), AUJOURD_HUI)
    const p = parametresDeLEnregistrement('d1', 2026, null, j)
    expect(p.p_lignes).toEqual([])
    expect(p.p_ecriture).toBeNull()
    expect(p.p_decision.date_mise_en_paiement).toBeNull()
  })
})

describe('le retrait, le remplacement et leurs mots', () => {
  it('le retrait se refuse avant le clic quand l’exercice de la date est validé, aux mots de la base', () => {
    expect(refusDuRetrait(lue(), decisionLue())).toBeNull()
    expect(refusDuRetrait(lue({ anneesValidees: [2026, 2027] }), decisionLue())).toBe('L’exercice qui contient le 15/05/2027 est validé : une écriture n’y entre plus.')
  })
  it('se refuse aussi quand une ligne de son écriture n’est plus proposée', () => {
    const l = lue({ brouillon: [brouillon('2027-05-15', '106100', 'credit', 200, 'validee', 'a1')] })
    expect(refusDuRetrait(l, decisionLue())).toContain('est validé')
    expect(refusDuRetrait(lue({ brouillon: [brouillon('2027-05-15', '106100', 'credit', 200, 'proposee', 'a1')] }), decisionLue())).toBeNull()
  })
  it('une confirmation nomme l’exercice, la décision, la répartition, l’écriture et la version remplacée', () => {
    const j = jugerLaSaisie(lue(), MODELE, saisie(), AUJOURD_HUI)
    const neuve = confirmationDeLEnregistrement(2026, j, null)
    expect(neuve).toContain('Enregistrer la décision du 15/05/2027 sur l’exercice 2026 ?')
    expect(neuve).toContain('Assemblée générale — comptes approuvés.')
    expect(neuve).toContain('Le bénéfice → la réserve légale : 200,00')
    expect(neuve).toContain('Écriture au journal OD, datée du 15/05/2027, dans l’exercice 2027 :')
    expect(neuve).toContain('Débit 120000')
    expect(neuve).toContain('Crédit 457000')
    expect(neuve).not.toContain('Remplace')
    const remplacee = confirmationDeLEnregistrement(2026, j, decisionLue({ version: 2 }))
    expect(remplacee).toContain('Remplacer la décision du 15/05/2027')
    expect(remplacee).toContain('Remplace la version 2 (décision du 15/05/2027) et réécrit son écriture')
    const non = confirmationDeLEnregistrement(2026, jugerLaSaisie(lue(), MODELE, saisie({ comptesApprouves: false, lignes: [], dateMiseEnPaiement: '' }), AUJOURD_HUI), null)
    expect(non).toContain('comptes non approuvés : aucune affectation, aucune écriture')
    expect(non).not.toContain('Écriture au journal')
  })
  it('la confirmation d’un retrait nomme la décision et son écriture', () => {
    const t = confirmationDuRetrait(2026, decisionLue({ version: 4 }))
    expect(t).toContain('Retirer la décision du 15/05/2027 (version 4) de l’exercice 2026 ?')
    expect(t).toContain('Son écriture du 15/05/2027 (journal OD) est retirée des Écritures.')
    expect(confirmationDuRetrait(2026, decisionLue({ comptesApprouves: false, lignes: [] }))).toContain('Elle n’a pas d’écriture.')
  })
})

describe('la saisie d’une décision lue, et les petits mots', () => {
  it('une décision lue se retape à l’identique : ses euros tapés se relisent au centime', () => {
    const d = decisionLue({ dateMiseEnPaiement: '2027-06-15' })
    const s = saisieDeLaDecision(d)
    expect(s.statuts).toBe('distribuables')
    expect(s.dateMiseEnPaiement).toBe('2027-06-15')
    expect(decisionDeLaSaisie(s, 2026).lignes).toEqual(d.lignes)
    for (const c of [5, 100, 123_456, 99, 2_970_000]) expect(centimesDeLaSaisie(eurosTapes(c))).toBe(c)
    expect(saisieDeLaDecision(decisionLue({ reservesStatutairesDistribuables: false })).statuts).toBe('indisponibles')
  })
  it('la décision en vigueur est la seule en vigueur ; une saisie vierge n’a ni date, ni ligne, ni choix de statuts', () => {
    expect(decisionEnVigueur(lue({ decisions: [decisionLue({ id: 'v1', etat: 'remplacee' }), decisionLue({ id: 'v2', version: 2 })] }))?.id).toBe('v2')
    expect(decisionEnVigueur(lue({ decisions: [decisionLue({ etat: 'retiree' })] }))).toBeNull()
    expect(SAISIE_VIERGE).toMatchObject({ dateDecision: '', lignes: [], statuts: '' })
  })
  it('les destinations offertes sont celles que le module admet', () => {
    for (const o of Object.keys(COUPLES_ADMIS) as (keyof typeof COUPLES_ADMIS)[]) expect(destinationsAdmises(o)).toBe(COUPLES_ADMIS[o])
  })
  it('l’exercice d’une date est validé quand son année est au plus celle de la frontière', () => {
    expect(exerciceDeLaDateValide('2027-05-15', [2026])).toBe(false)
    expect(exerciceDeLaDateValide('2027-05-15', [2025, 2027])).toBe(true)
    expect(exerciceDeLaDateValide('2026-05-15', [2027])).toBe(true)
    expect(exerciceDeLaDateValide('', [2027])).toBe(false)
    expect(exerciceDeLaDateValide('2027-05-15', [])).toBe(false)
  })
})
