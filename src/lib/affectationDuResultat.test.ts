import { describe, expect, it } from 'vitest'
import {
  composerLEcritureDAffectation, jugerLAffectation, proposerLAffectation, regimeDeLaForme, reserveLegaleMinimale,
  type ComptesDeLAffectation, type ContexteDeLAffectation, type DecisionSaisie, type DossierDeLAffectation,
  type LigneDAffectation, type SoldesAvantAffectation,
} from './affectationDuResultat'

// Les cas reprennent l'exemple de la conception (§ 3.6) — une SARL au capital de 10 000 €, réserve légale existante 800 €,
// bénéfice 2026 de 30 000 €, décision du 15/05/2027 — et les bornes des textes relus le 12/11/2026 (C. com., L232-10 à
// L232-13).

const COMPTES: ComptesDeLAffectation = {
  resultat_benefice: '120000', resultat_perte: '129000', reserve_legale: '106100', reserves_statutaires: '106300',
  autres_reserves: '106800', report_a_nouveau_crediteur: '110000', report_a_nouveau_debiteur: '119000',
  dividendes_a_payer: '457000',
}

const soldes = (s: Partial<SoldesAvantAffectation> = {}): SoldesAvantAffectation => ({
  capitalAuxComptes: 1_000_000, primes: 0, ecartsDeReevaluation: 0, reserveLegale: 80_000, reservesIndisponibles: 0,
  reservesStatutaires: 0, reservesReglementees: 0, autresReserves: 0, reportCrediteur: 0, pertesAnterieures: 0,
  acomptesSurDividendes: 0, ...s,
})

const dossier = (d: Partial<DossierDeLAffectation> = {}): DossierDeLAffectation => ({
  modeComptable: 'engagement', exploitantIndividuel: false, formeJuridique: '5499', capitalCentimes: 1_000_000,
  reservesStatutairesDistribuables: true, ...d,
})

const contexte = (c: Partial<ContexteDeLAffectation> = {}): ContexteDeLAffectation => ({
  dossier: dossier(), resultatCentimes: 3_000_000, soldes: soldes(), comptes: COMPTES, aujourdHui: '2027-11-12',
  exerciceDeLaDecisionValide: false, ...c,
})

const L = (origine: LigneDAffectation['origine'], destination: LigneDAffectation['destination'], centimes: number): LigneDAffectation =>
  ({ origine, destination, centimes })

const decision = (d: Partial<DecisionSaisie> = {}): DecisionSaisie => ({
  exerciceAffecte: 2026, organe: 'assemblee', nombreDAssocies: 'plusieurs', dateDecision: '2027-05-15',
  comptesApprouves: true, dateMiseEnPaiement: '2027-06-15',
  lignes: [L('benefice', 'reserve_legale', 20_000), L('benefice', 'autres_reserves', 980_000), L('benefice', 'dividendes', 2_000_000)],
  ...d,
})

const codes = (c: ContexteDeLAffectation, d: DecisionSaisie) => jugerLAffectation(c, d).refus.map((r) => r.code)
const avertis = (c: ContexteDeLAffectation, d: DecisionSaisie) => jugerLAffectation(c, d).avertissements.map((a) => a.code)

describe('la forme juridique', () => {
  it('soumet au minimum de la réserve légale les SARL et les sociétés par actions, et elles seules', () => {
    for (const code of ['5499', '5485', '5599', '5699', '5710', '5785', '5308', '5385', '5800']) expect(regimeDeLaForme(code)).toBe('soumise')
    for (const code of ['5202', '5306', '5310', '6540', '6589', '6571']) expect(regimeDeLaForme(code)).toBe('libre')
    for (const code of ['1000', '6220', '6100', '5191', '6317', '9999']) expect(regimeDeLaForme(code)).toBe('hors_champ')
  })
})

describe('la réserve légale minimale (L232-10)', () => {
  it('un vingtième du bénéfice, plafonné au dixième restant (l’exemple de la conception)', () => {
    expect(reserveLegaleMinimale(3_000_000, 0, 80_000, 1_000_000)).toBe(20_000)
    expect(reserveLegaleMinimale(1_000_000, 0, 0, 10_000_000)).toBe(50_000)
  })
  it('rien quand la réserve atteint déjà le dixième du capital, ou le dépasse', () => {
    expect(reserveLegaleMinimale(3_000_000, 0, 100_000, 1_000_000)).toBe(0)
    expect(reserveLegaleMinimale(3_000_000, 0, 150_000, 1_000_000)).toBe(0)
  })
  it('rien quand les pertes antérieures absorbent le bénéfice, et le vingtième du reste sinon', () => {
    expect(reserveLegaleMinimale(1_000_000, 1_500_000, 0, 10_000_000)).toBe(0)
    expect(reserveLegaleMinimale(1_000_000, 1_000_000, 0, 10_000_000)).toBe(0)
    expect(reserveLegaleMinimale(1_000_000, 400_000, 0, 10_000_000)).toBe(30_000)
  })
  it('rien sur une perte, rien sous un capital nul', () => {
    expect(reserveLegaleMinimale(-500_000, 0, 0, 1_000_000)).toBe(0)
    expect(reserveLegaleMinimale(3_000_000, 0, 0, 0)).toBe(0)
  })
  it('arrondie au centime supérieur : « un vingtième au moins »', () => {
    expect(reserveLegaleMinimale(1, 0, 0, 10_000_000)).toBe(1)
    expect(reserveLegaleMinimale(20, 0, 0, 10_000_000)).toBe(1)
    expect(reserveLegaleMinimale(21, 0, 0, 10_000_000)).toBe(2)
    // Le dixième de 1 000,05 € est 100,005 € : la réserve l'atteint à 100,01 €.
    expect(reserveLegaleMinimale(3_000_000, 0, 10_000, 100_005)).toBe(1)
  })
})

describe('le jugement : l’exemple de la conception', () => {
  it('ne refuse rien et compose l’écriture au journal OD, à la date de la décision', () => {
    const j = jugerLAffectation(contexte(), decision())
    expect(j.refus).toEqual([])
    expect(j.avertissements).toEqual([])
    expect(j.calcul).toMatchObject({ reserveLegaleMinimale: 20_000, beneficeDistribuable: 2_980_000, dividendes: 2_000_000 })
    const e = composerLEcritureDAffectation(contexte(), decision())
    expect(e).toEqual({
      journal: 'OD', date: '2027-05-15', pieceDate: '2027-05-15',
      pieceRef: 'Affectation du résultat 2026 — décision du 15/05/2027', libelle: 'Affectation du résultat 2026',
      lignes: [
        { compte: '120000', sens: 'debit', centimes: 3_000_000 },
        { compte: '106100', sens: 'credit', centimes: 20_000 },
        { compte: '106800', sens: 'credit', centimes: 980_000 },
        { compte: '457000', sens: 'credit', centimes: 2_000_000 },
      ],
    })
  })
  it('l’écriture suit les comptes du plan du dossier, jamais un compte en dur', () => {
    const comptes = { ...COMPTES, resultat_benefice: '120100', dividendes_a_payer: '457100' }
    const e = composerLEcritureDAffectation(contexte({ comptes }), decision())!
    expect(e.lignes.map((l) => l.compte)).toEqual(['120100', '106100', '106800', '457100'])
  })
  it('lève plutôt que composer une décision refusée', () => {
    expect(() => composerLEcritureDAffectation(contexte(), decision({ lignes: [L('benefice', 'dividendes', 3_000_000)] })))
      .toThrow(/réserve légale/)
  })
})

describe('les refus d’entrée', () => {
  it('le champ : trésorerie, entreprise individuelle, forme absente ou hors champ, capital absent', () => {
    expect(codes(contexte({ dossier: dossier({ modeComptable: 'tresorerie' }) }), decision())).toEqual(['tresorerie'])
    expect(codes(contexte({ dossier: dossier({ exploitantIndividuel: true }) }), decision())).toEqual(['entreprise-individuelle'])
    expect(codes(contexte({ dossier: dossier({ formeJuridique: '1000', capitalCentimes: null }) }), decision())).toEqual(['entreprise-individuelle'])
    expect(codes(contexte({ dossier: dossier({ formeJuridique: null }) }), decision())).toEqual(['forme-absente'])
    expect(codes(contexte({ dossier: dossier({ formeJuridique: '6220' }) }), decision())).toEqual(['forme-hors-champ'])
    expect(codes(contexte({ dossier: dossier({ capitalCentimes: null }) }), decision())).toEqual(['capital-absent'])
    expect(codes(contexte({ dossier: dossier({ capitalCentimes: 0 }) }), decision())).toEqual(['capital-absent'])
  })
  it('un solde d’acomptes sur dividendes refuse la décision (AFF-Q8 (B))', () => {
    expect(codes(contexte({ soldes: soldes({ acomptesSurDividendes: 1 }) }), decision())).toEqual(['acomptes-sur-dividendes'])
  })
  it('un montant qui n’est pas un entier de centimes, une ligne nulle, un compte illisible', () => {
    expect(codes(contexte({ resultatCentimes: 3_000_000.5 }), decision())).toEqual(['montant-illisible'])
    expect(codes(contexte(), decision({ lignes: [...decision().lignes, L('benefice', 'report_crediteur', 0)] }))).toEqual(['montant-illisible'])
    expect(codes(contexte({ comptes: { ...COMPTES, reserve_legale: '1061' } }), decision())).toEqual(['comptes-illisibles'])
  })
  it('les dates : au plus tard à la clôture, dans le futur, dans un exercice validé, illisible', () => {
    expect(codes(contexte(), decision({ dateDecision: '2026-12-31', dateMiseEnPaiement: null }))).toEqual(['date-avant-cloture'])
    expect(codes(contexte(), decision({ dateDecision: '2027-01-01', dateMiseEnPaiement: null }))).toEqual([])
    expect(codes(contexte({ aujourdHui: '2027-05-14' }), decision())).toEqual(['date-future'])
    expect(codes(contexte({ aujourdHui: '2027-05-15' }), decision())).toEqual([])
    expect(codes(contexte({ exerciceDeLaDecisionValide: true }), decision())).toEqual(['exercice-de-la-decision-valide'])
    expect(codes(contexte(), decision({ dateDecision: '2027-02-30' }))).toEqual(['date-illisible'])
  })
  it('l’organe et le nombre d’associés se répondent', () => {
    expect(codes(contexte(), decision({ organe: 'associe_unique' }))).toEqual(['organe-et-associes'])
    expect(codes(contexte(), decision({ nombreDAssocies: 'un' }))).toEqual(['organe-et-associes'])
    expect(codes(contexte(), decision({ organe: 'associe_unique', nombreDAssocies: 'un' }))).toEqual([])
  })
})

describe('l’approbation (AFF-Q1 (A))', () => {
  it('des comptes non approuvés ne s’affectent pas : ni ligne, ni écriture', () => {
    const d = decision({ comptesApprouves: false, lignes: [], dateMiseEnPaiement: null })
    expect(codes(contexte(), d)).toEqual([])
    expect(composerLEcritureDAffectation(contexte(), d)).toBeNull()
    expect(codes(contexte(), decision({ comptesApprouves: false }))).toEqual(['non-approuves-avec-lignes'])
  })
})

describe('la répartition', () => {
  it('le résultat s’affecte en entier, dans son sens', () => {
    expect(codes(contexte(), decision({ lignes: [L('benefice', 'reserve_legale', 20_000), L('benefice', 'report_crediteur', 2_979_999)], dateMiseEnPaiement: null })))
      .toEqual(['resultat-pas-en-entier'])
    expect(codes(contexte({ resultatCentimes: -100_000 }), decision({ lignes: [L('benefice', 'report_crediteur', 100_000)], dateMiseEnPaiement: null })))
      .toContain('sens-du-resultat')
    expect(codes(contexte({ resultatCentimes: 0 }), decision({ lignes: [], dateMiseEnPaiement: null }))).toEqual([])
  })
  it('un couple que la conception n’admet pas', () => {
    const d = decision({ lignes: [...decision().lignes, L('autres_reserves', 'reserve_legale', 1)], dateMiseEnPaiement: null })
    expect(codes(contexte({ soldes: soldes({ autresReserves: 10 }) }), d)).toContain('couple-non-admis')
  })
  it('un prélèvement au-delà du solde, un apurement au-delà des pertes', () => {
    const lignes = [...decision().lignes, L('report_crediteur', 'dividendes', 50_001)]
    expect(codes(contexte({ soldes: soldes({ reportCrediteur: 50_000 }) }), decision({ lignes }))).toEqual(['prelevement-au-dela-du-solde'])
    const apure = [L('benefice', 'reserve_legale', 20_000), L('benefice', 'report_debiteur', 100_001), L('benefice', 'report_crediteur', 2_879_999)]
    expect(codes(contexte({ soldes: soldes({ pertesAnterieures: 100_000, reserveLegale: 0 }), dossier: dossier({ capitalCentimes: 200_000 }) }),
      decision({ lignes: apure, dateMiseEnPaiement: null }))).toContain('apurement-au-dela-des-pertes')
  })
})

describe('la réserve légale refusée sous son minimum (AFF-Q3 (A))', () => {
  const avec = (rl: number) => decision({ lignes: [L('benefice', 'reserve_legale', rl), L('benefice', 'report_crediteur', 3_000_000 - rl)], dateMiseEnPaiement: null })
  it('exactement le minimum passe, un centime de moins se refuse', () => {
    expect(codes(contexte(), avec(20_000))).toEqual([])
    expect(codes(contexte(), avec(19_999))).toEqual(['reserve-legale-insuffisante'])
    expect(jugerLAffectation(contexte(), avec(19_999)).refus[0].message).toContain('L232-10')
  })
  it('une réserve déjà au dixième ne demande rien', () => {
    expect(codes(contexte({ soldes: soldes({ reserveLegale: 100_000 }) }), decision({ lignes: [L('benefice', 'report_crediteur', 3_000_000)], dateMiseEnPaiement: null })))
      .toEqual([])
  })
  it('une société en nom collectif affecte librement', () => {
    expect(codes(contexte({ dossier: dossier({ formeJuridique: '5202' }) }), decision({ lignes: [L('benefice', 'dividendes', 3_000_000)] })))
      .toEqual([])
  })
})

describe('les dividendes (AFF-Q4 (A) ; L232-11, L232-12)', () => {
  it('au-delà du bénéfice distribuable : la perte antérieure plus grande que le bénéfice', () => {
    const c = contexte({ resultatCentimes: 1_000_000, soldes: soldes({ pertesAnterieures: 1_500_000, reserveLegale: 100_000 }) })
    const j = jugerLAffectation(c, decision({ lignes: [L('benefice', 'dividendes', 1_000_000)] }))
    expect(j.refus.map((r) => r.code)).toEqual(['dividendes-au-dela-du-distribuable', 'capitaux-propres-sous-le-plancher'])
    expect(j.calcul?.beneficeDistribuable).toBe(-500_000)
    expect(j.refus[0].message).toContain('dividende fictif')
  })
  it('les réserves après le bénéfice distribuable, jamais avant (L232-11, al. 2)', () => {
    const c = contexte({ soldes: soldes({ reserveLegale: 100_000, autresReserves: 500_000 }) })
    const d = decision({ lignes: [L('benefice', 'autres_reserves', 3_000_000), L('autres_reserves', 'dividendes', 500_000)] })
    expect(codes(c, d)).toEqual(['reserves-avant-le-benefice'])
    const ok = decision({ lignes: [L('benefice', 'dividendes', 3_000_000), L('autres_reserves', 'dividendes', 500_000)] })
    expect(codes(c, ok)).toEqual([])
  })
  // Capital 10 000 €, réserve légale au dixième, autres réserves 5 000 €, pertes antérieures 3 000 €, bénéfice 1 000 € qui
  // les apure en partie : capitaux propres 14 000 €, plancher 11 000 € — 3 000 € au plus se distribuent des réserves.
  describe('le plancher des capitaux propres (L232-11, al. 3)', () => {
    const c = contexte({
      resultatCentimes: 100_000,
      soldes: soldes({ reserveLegale: 100_000, autresReserves: 500_000, pertesAnterieures: 300_000 }),
    })
    const avec = (x: number) => decision({ lignes: [L('benefice', 'report_debiteur', 100_000), L('autres_reserves', 'dividendes', x)] })
    it('une distribution exactement au plancher passe', () => {
      const j = jugerLAffectation(c, avec(300_000))
      expect(j.refus).toEqual([])
      expect(j.calcul).toMatchObject({ capitauxPropresApres: 1_100_000, plancher: 1_100_000 })
    })
    it('un centime au-delà se refuse', () => {
      expect(codes(c, avec(300_001))).toEqual(['capitaux-propres-sous-le-plancher'])
    })
    it('la proposition dit ce plafond', () => {
      expect(proposerLAffectation(c)).toMatchObject({
        lignes: [L('benefice', 'report_debiteur', 100_000)], reserveLegaleMinimale: 0, plafondDesDividendes: 300_000,
      })
    })
  })
  it('des réserves statutaires que les statuts rendent indisponibles ne se distribuent pas', () => {
    const c = contexte({ dossier: dossier({ reservesStatutairesDistribuables: false }), soldes: soldes({ reservesStatutaires: 100_000 }) })
    const d = decision({ lignes: [...decision().lignes.slice(0, 1), L('benefice', 'dividendes', 2_980_000), L('reserves_statutaires', 'dividendes', 1)] })
    expect(codes(c, d)).toContain('reserves-statutaires-indisponibles')
    expect(jugerLAffectation(c, decision()).calcul?.plancher).toBe(1_000_000 + 80_000 + 20_000 + 100_000)
  })
  it('la date de mise en paiement : jamais avant la décision, jamais sans dividende', () => {
    expect(codes(contexte(), decision({ dateMiseEnPaiement: '2027-05-14' }))).toEqual(['paiement-avant-la-decision'])
    const sans = decision({ lignes: [L('benefice', 'reserve_legale', 20_000), L('benefice', 'report_crediteur', 2_980_000)] })
    expect(codes(contexte(), sans)).toEqual(['paiement-sans-dividende'])
  })
})

describe('la perte (AFF-Q7 (A))', () => {
  const c = contexte({ resultatCentimes: -400_000, soldes: soldes({ autresReserves: 300_000 }) })
  it('au report à nouveau débiteur, ou sur les réserves disponibles : le 129 au crédit', () => {
    const d = decision({ lignes: [L('perte', 'autres_reserves', 300_000), L('perte', 'report_debiteur', 100_000)], dateMiseEnPaiement: null })
    expect(codes(c, d)).toEqual([])
    expect(composerLEcritureDAffectation(c, d)?.lignes).toEqual([
      { compte: '106800', sens: 'debit', centimes: 300_000 },
      { compte: '119000', sens: 'debit', centimes: 100_000 },
      { compte: '129000', sens: 'credit', centimes: 400_000 },
    ])
  })
  it('jamais au-delà du solde de la réserve', () => {
    const d = decision({ lignes: [L('perte', 'autres_reserves', 300_001), L('perte', 'report_debiteur', 99_999)], dateMiseEnPaiement: null })
    expect(codes(c, d)).toEqual(['prelevement-au-dela-du-solde'])
  })
  it('jamais sur la réserve légale', () => {
    const d = decision({ lignes: [L('perte', 'reserve_legale', 400_000)], dateMiseEnPaiement: null })
    expect(codes(c, d)).toContain('couple-non-admis')
  })
  it('la proposition la porte au report à nouveau débiteur', () => {
    expect(proposerLAffectation(c)?.lignes).toEqual([L('perte', 'report_debiteur', 400_000)])
  })
})

describe('les avertissements, jamais bloquants', () => {
  it('six mois après la clôture', () => {
    expect(avertis(contexte(), decision({ dateDecision: '2027-06-30', dateMiseEnPaiement: null }))).not.toContain('approbation-tardive')
    expect(avertis(contexte(), decision({ dateDecision: '2027-07-01', dateMiseEnPaiement: null }))).toContain('approbation-tardive')
  })
  it('la mise en paiement au-delà de neuf mois, ou non datée', () => {
    expect(avertis(contexte(), decision({ dateMiseEnPaiement: '2027-09-30' }))).toEqual([])
    expect(avertis(contexte(), decision({ dateMiseEnPaiement: '2027-10-01' }))).toEqual(['paiement-tardif'])
    expect(avertis(contexte(), decision({ dateMiseEnPaiement: null }))).toEqual(['paiement-non-date'])
  })
  it('le capital du dossier qui diffère du 101, et les capitaux propres sous la moitié du capital', () => {
    expect(avertis(contexte({ soldes: soldes({ capitalAuxComptes: 500_000 }) }), decision())).toContain('capital-different-du-101')
    const c = contexte({ resultatCentimes: -100_000, soldes: soldes({ pertesAnterieures: 500_000 }) })
    const d = decision({ lignes: [L('perte', 'report_debiteur', 100_000)], dateMiseEnPaiement: null })
    expect(codes(c, d)).toEqual([])
    expect(avertis(c, d)).toEqual(['capitaux-propres-sous-la-moitie'])
  })
})

describe('la proposition', () => {
  it('la réserve légale minimale, puis le reste au report à nouveau, aucun dividende', () => {
    expect(proposerLAffectation(contexte())).toEqual({
      lignes: [L('benefice', 'reserve_legale', 20_000), L('benefice', 'report_crediteur', 2_980_000)],
      reserveLegaleMinimale: 20_000, beneficeDistribuable: 2_980_000, plafondDesDividendes: 2_980_000,
    })
  })
  it('jamais hors du champ', () => {
    expect(proposerLAffectation(contexte({ dossier: dossier({ modeComptable: 'tresorerie' }) }))).toBeNull()
    expect(proposerLAffectation(contexte({ dossier: dossier({ capitalCentimes: null }) }))).toBeNull()
  })
  it('ce qu’elle propose, le jugement l’accepte', () => {
    for (const c of [contexte(), contexte({ resultatCentimes: -1 }), contexte({ resultatCentimes: 0 }),
      contexte({ soldes: soldes({ pertesAnterieures: 1_000_000 }) }), contexte({ soldes: soldes({ pertesAnterieures: 5_000_000 }) })]) {
      const p = proposerLAffectation(c)!
      expect(codes(c, decision({ lignes: p.lignes, dateMiseEnPaiement: null }))).toEqual([])
    }
  })
})
