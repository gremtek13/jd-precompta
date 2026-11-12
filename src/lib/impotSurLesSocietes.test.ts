import { describe, expect, it } from 'vitest'
import {
  BAREME_ARTICLE_219, SEUIL_DISPENSE_ACOMPTES, acomptesDeLExercice, arrondiALEuro, baremeDeLExercice,
  calculerImpotSurLesSocietes, echeanceDuSolde, plafondDuTauxReduit, trentiemesDeMois,
} from './impotSurLesSocietes'
import type { EntreesImpot, ImpotDeLExercice, ReferenceDesAcomptes } from './impotSurLesSocietes'

const E = (euros: number) => euros * 100

// Un exercice civil 2025, au barème confirmé, éligible au taux réduit : chaque cas ne change que ce qu'il éprouve.
const entrees = (e: Partial<EntreesImpot>): EntreesImpot => ({
  debut: '2025-01-01', fin: '2025-12-31', bareme: baremeDeLExercice('2025-01-01', '2025-12-31'),
  resultatComptable: 0, reintegrations: [], deductions: [], deficitsAReporterALOuverture: 0,
  reportEnArriere: { option: 'non' },
  tauxReduit: { regle: 'chiffre-d-affaires-et-attestation', chiffreDAffairesHt: E(500_000), capitalAtteste: true },
  creancesImputees: 0, creditsDImpotImputes: 0, acomptesVerses: 0,
  ...e,
})

function calcule(e: Partial<EntreesImpot>): ImpotDeLExercice {
  const r = calculerImpotSurLesSocietes(entrees(e))
  if ('refus' in r) throw new Error(r.refus.join(' / '))
  return r.impot
}

function refuse(e: Partial<EntreesImpot>): string[] {
  const r = calculerImpotSurLesSocietes(entrees(e))
  if (!('refus' in r)) throw new Error('aucun refus')
  return r.refus
}

describe("l'arrondi fiscal (notice 2033 : 0,50 compté pour 1)", () => {
  it('arrondit à l’euro le plus proche, en valeur absolue', () => {
    expect(arrondiALEuro(149)).toBe(100)
    expect(arrondiALEuro(150)).toBe(200)
    expect(arrondiALEuro(49)).toBe(0)
    expect(arrondiALEuro(-150)).toBe(-200)
    expect(arrondiALEuro(-149)).toBe(-100)
    expect(Object.is(arrondiALEuro(-49), 0)).toBe(true)
  })
})

describe('la durée de l’exercice et la limite du taux réduit (BOI-IS-LIQ-20-20)', () => {
  it("rend l'exemple du BOFiP : du 1er janvier au 15 septembre, 8,5 mois, 30 104 €", () => {
    expect(trentiemesDeMois('2025-01-01', '2025-09-15')).toBe(255)
    expect(plafondDuTauxReduit(BAREME_ARTICLE_219, 255)).toBe(E(30_104))
  })
  it('compte douze mois entiers pour l’année civile, bissextile ou non', () => {
    expect(trentiemesDeMois('2025-01-01', '2025-12-31')).toBe(360)
    expect(trentiemesDeMois('2024-01-01', '2024-12-31')).toBe(360)
    expect(plafondDuTauxReduit(BAREME_ARTICLE_219, 360)).toBe(E(42_500))
  })
  it('compte les jours d’un mois entamé à l’ouverture', () => {
    expect(trentiemesDeMois('2025-03-16', '2025-12-31')).toBe(9 * 30 + 16)
    expect(trentiemesDeMois('2024-02-15', '2024-02-29')).toBe(15)
  })
  it('ne lit pas une date impossible ni un exercice à l’envers', () => {
    expect(trentiemesDeMois('2025-02-29', '2025-12-31')).toBeNull()
    expect(trentiemesDeMois('2025-12-31', '2025-01-01')).toBeNull()
  })
})

describe('le barème de l’exercice', () => {
  it('est confirmé jusqu’aux exercices clos avant le 31 décembre 2026', () => {
    expect(baremeDeLExercice('2025-01-01', '2025-12-31').etat).toBe('confirme')
    expect(baremeDeLExercice('2022-01-01', '2022-12-31').etat).toBe('confirme')
  })
  it('est à confirmer pour un exercice clos le 31 décembre 2026, et le rendu le dit', () => {
    const b = baremeDeLExercice('2026-01-01', '2026-12-31')
    expect(b.etat).toBe('a-confirmer')
    const i = calcule({ debut: '2026-01-01', fin: '2026-12-31', bareme: b, resultatComptable: E(10_000) })
    expect(i.avertissements.join(' ')).toMatch(/loi de finances pour 2027/)
  })
  it('est hors période avant 2022, et le calcul se refuse', () => {
    const b = baremeDeLExercice('2021-01-01', '2021-12-31')
    expect(b.etat).toBe('hors-periode')
    expect(refuse({ debut: '2021-01-01', fin: '2021-12-31', bareme: b }).join(' ')).toMatch(/autre barème/)
  })
})

describe("l'impôt d'un bénéfice (CGI art. 219)", () => {
  it('taxe 42 500 € à 15 % et le reste à 25 %', () => {
    const i = calcule({ resultatComptable: E(100_000) })
    expect(i.l370).toBe(E(100_000))
    expect(i.beneficeAuTauxReduit).toBe(E(42_500))
    expect(i.impotBrut).toBe(E(6_375 + 14_375))
    expect(i.echeanceDuSolde).toBe('2026-05-15')
  })
  it('applique le taux normal sans attestation du capital, sous la règle (A) de LIA-Q5, et le dit', () => {
    const i = calcule({
      resultatComptable: E(100_000),
      tauxReduit: { regle: 'chiffre-d-affaires-et-attestation', chiffreDAffairesHt: E(500_000), capitalAtteste: false },
    })
    expect(i.impotBrut).toBe(E(25_000))
    expect(i.avertissements.join(' ')).toMatch(/pas attesté/)
  })
  it('applique le taux réduit sur le seul chiffre d’affaires sous la règle (B)', () => {
    const i = calcule({
      resultatComptable: E(100_000),
      tauxReduit: { regle: 'chiffre-d-affaires-seul', chiffreDAffairesHt: E(500_000), capitalAtteste: false },
    })
    expect(i.impotBrut).toBe(E(20_750))
  })
  it('écarte le taux réduit au-delà de 10 M€ de chiffre d’affaires ramené à douze mois, pas à 10 M€ juste', () => {
    const juste = calcule({ resultatComptable: E(100_000), tauxReduit: { regle: 'chiffre-d-affaires-seul', chiffreDAffairesHt: E(10_000_000), capitalAtteste: true } })
    expect(juste.tauxReduit.applique).toBe(true)
    const au_dela = calcule({ resultatComptable: E(100_000), tauxReduit: { regle: 'chiffre-d-affaires-seul', chiffreDAffairesHt: E(10_000_000) + 1, capitalAtteste: true } })
    expect(au_dela.impotBrut).toBe(E(25_000))
    // Neuf mois à 8 M€ : 10,67 M€ ramenés à douze mois, le taux réduit tombe.
    const neufMois = calcule({
      debut: '2025-04-01', fin: '2025-12-31', resultatComptable: E(100_000),
      tauxReduit: { regle: 'chiffre-d-affaires-seul', chiffreDAffairesHt: E(8_000_000), capitalAtteste: true },
    })
    expect(neufMois.tauxReduit.applique).toBe(false)
  })
  it('proratise la limite d’un exercice de neuf mois : 31 875 €', () => {
    const i = calcule({ debut: '2025-04-01', fin: '2025-12-31', resultatComptable: E(100_000) })
    expect(i.trentiemes).toBe(270)
    expect(i.beneficeAuTauxReduit).toBe(E(31_875))
    expect(i.impotBrut).toBe(arrondiALEuro(E(31_875) * 15 / 100 + E(68_125) * 25 / 100))
  })
  it('arrondit la liquidation à l’euro : 15 % de 1 003 € font 150,45 €, soit 150 €', () => {
    expect(calcule({ resultatComptable: E(1_003) }).impotBrut).toBe(E(150))
    expect(calcule({ resultatComptable: E(1_010) }).impotBrut).toBe(E(152)) // 151,50 €, compté pour 152
  })
  it('passe par les réintégrations et les déductions saisies, l’IS réintégré en 324', () => {
    const i = calcule({
      resultatComptable: E(80_000),
      reintegrations: [{ ligne: '324', montant: E(12_000) }, { ligne: '330', montant: E(500) }],
      deductions: [{ ligne: '342', montant: E(2_500) }],
    })
    expect(i.reintegrations).toBe(E(12_500))
    expect(i.deductions).toBe(E(2_500))
    expect(i.l352).toBe(E(90_000))
  })
  it('rend un IS nul sur une perte ou un bénéfice nul', () => {
    expect(calcule({ resultatComptable: 0 }).impotBrut).toBe(0)
    const perte = calcule({ resultatComptable: -E(20_000) })
    expect(perte.impotBrut).toBe(0)
    expect(perte.l354).toBe(E(20_000))
    expect(perte.l314).toBe(E(20_000))
    expect(perte.l860).toBe(E(20_000))
    expect(perte.l870).toBe(E(20_000))
  })
})

describe('le report en avant des déficits (CGI art. 209, I)', () => {
  it('impute tout le stock sous un million, et l’impôt peut tomber à zéro', () => {
    const i = calcule({ resultatComptable: E(60_000), deficitsAReporterALOuverture: E(200_000) })
    expect(i.l360).toBe(E(60_000))
    expect(i.l370).toBe(0)
    expect(i.impotBrut).toBe(0)
    expect(i.l983).toBe(E(60_000))
    expect(i.l984).toBe(E(140_000))
    expect(i.l870).toBe(E(140_000))
  })
  it('plafonne à un million plus la moitié du bénéfice qui l’excède', () => {
    const i = calcule({ resultatComptable: E(2_500_000), deficitsAReporterALOuverture: E(3_000_000) })
    expect(i.l360).toBe(E(1_750_000))
    expect(i.l370).toBe(E(750_000))
    expect(i.l870).toBe(E(1_250_000))
  })
  it('impute tout un stock égal au plafond, juste atteint', () => {
    const i = calcule({ resultatComptable: E(2_500_000), deficitsAReporterALOuverture: E(1_750_000) })
    expect(i.l360).toBe(E(1_750_000))
    expect(i.l870).toBe(0)
  })
  it('arrondit la moitié d’un nombre impair d’euros à l’euro inférieur, jamais au-delà de la loi', () => {
    const i = calcule({ resultatComptable: E(1_000_001), deficitsAReporterALOuverture: E(5_000_000) })
    expect(i.l360).toBe(E(1_000_000))
    expect(i.l370).toBe(E(1))
  })
  it('ne touche pas le stock sur une perte', () => {
    const i = calcule({ resultatComptable: -E(10_000), deficitsAReporterALOuverture: E(30_000) })
    expect(i.l360).toBe(0)
    expect(i.l870).toBe(E(40_000))
  })
})

describe('le report en arrière (CGI art. 220 quinquies ; BOI-IS-DEF-20-10)', () => {
  const precedent = (normal: number, reduit: number, declare = normal + reduit) => ({
    beneficeDeclare: declare, beneficeImputableAuTauxNormal: normal, beneficeImputableAuTauxReduit: reduit,
    bareme: BAREME_ARTICLE_219,
  })

  it("rend l'exemple du BOFiP : un million reporté, 978 120 € au taux normal, créance de 247 812 €, 500 000 € en avant", () => {
    const i = calcule({
      resultatComptable: -E(1_500_000),
      reportEnArriere: { option: 'oui', montantDemande: E(1_000_000), exercicePrecedent: precedent(E(978_120), E(42_500)) },
    })
    expect(i.l356).toBe(E(1_000_000))
    expect(i.creanceNee).toBe(E(247_812))
    expect(i.l372).toBe(E(500_000))
    expect(i.l860).toBe(E(500_000))
  })
  it('se limite au bénéfice de l’exercice précédent quand le déficit est plus grand', () => {
    const i = calcule({
      resultatComptable: -E(300_000),
      reportEnArriere: { option: 'oui', montantDemande: E(300_000), exercicePrecedent: precedent(E(57_500), E(42_500)) },
    })
    expect(i.l356).toBe(E(100_000))
    expect(i.creanceNee).toBe(E(14_375 + 6_375))
    expect(i.l372).toBe(E(200_000))
    expect(i.avertissements.join(' ')).toMatch(/ramené/)
  })
  it('se limite au bénéfice imputable quand une partie a été distribuée', () => {
    const i = calcule({
      resultatComptable: -E(80_000),
      reportEnArriere: { option: 'oui', montantDemande: E(80_000), exercicePrecedent: precedent(E(10_000), E(20_000), E(100_000)) },
    })
    expect(i.l356).toBe(E(30_000))
    expect(i.creanceNee).toBe(E(2_500 + 3_000))
  })
  it('ne dépasse jamais le bénéfice déclaré, même sur une saisie du bénéfice imputable plus forte', () => {
    const i = calcule({
      resultatComptable: -E(80_000),
      reportEnArriere: { option: 'oui', montantDemande: E(80_000), exercicePrecedent: precedent(E(60_000), 0, E(50_000)) },
    })
    expect(i.l356).toBe(E(50_000))
  })
  it('reporte moins que permis quand la société le choisit', () => {
    const i = calcule({
      resultatComptable: -E(50_000),
      reportEnArriere: { option: 'oui', montantDemande: E(20_000), exercicePrecedent: precedent(E(57_500), E(42_500)) },
    })
    expect(i.l356).toBe(E(20_000))
    expect(i.creanceNee).toBe(E(5_000))
    expect(i.l870).toBe(E(30_000))
  })
  it('se refuse sur un bénéfice', () => {
    expect(refuse({
      resultatComptable: E(10_000),
      reportEnArriere: { option: 'oui', montantDemande: E(1), exercicePrecedent: precedent(E(1), 0) },
    }).join(' ')).toMatch(/que sur un déficit/)
  })
})

describe('les imputations, le solde et la contribution sociale', () => {
  it('impute créances et crédits, puis déduit les acomptes : à payer ou à restituer', () => {
    const i = calcule({ resultatComptable: E(100_000), creancesImputees: E(750), creditsDImpotImputes: E(1_000), acomptesVerses: E(15_000) })
    expect(i.impotNet).toBe(E(19_000))
    expect(i.solde).toBe(E(4_000))
    const trop = calcule({ resultatComptable: E(100_000), acomptesVerses: E(25_000) })
    expect(trop.solde).toBe(-E(4_250))
  })
  it('refuse des imputations plus fortes que l’impôt (un IS net négatif)', () => {
    expect(refuse({ resultatComptable: E(10_000), creditsDImpotImputes: E(1_501) }).join(' ')).toMatch(/dépassent l’impôt/)
    expect(calcule({ resultatComptable: E(10_000), creditsDImpotImputes: E(1_500) }).impotNet).toBe(0)
  })
  it('dit la contribution sociale nulle sous l’abattement, non calculée au-delà', () => {
    expect(calcule({ resultatComptable: E(100_000) }).contributionSociale.etat).toBe('nulle')
    expect(calcule({ resultatComptable: E(4_000_000) }).contributionSociale.etat).toBe('non-calculee')
  })
})

describe('les refus des entrées', () => {
  it('refuse un montant avec des centimes, un montant négatif, un exercice décalé', () => {
    expect(refuse({ resultatComptable: 12_345 }).join(' ')).toMatch(/sans centimes/)
    expect(refuse({ reintegrations: [{ ligne: '316', montant: -E(1) }] }).join(' ')).toMatch(/316 ne peut pas être négatif/)
    expect(refuse({ deficitsAReporterALOuverture: -E(1) }).join(' ')).toMatch(/négatif/)
    expect(refuse({ acomptesVerses: -1 }).join(' ')).toMatch(/acomptes/)
    expect(refuse({ debut: '2025-01-01', fin: '2025-06-30', bareme: baremeDeLExercice('2025-01-01', '2025-06-30') }).join(' ')).toMatch(/31 décembre/)
    expect(refuse({ debut: '2023-01-01', fin: '2025-12-31' }).join(' ')).toMatch(/vingt-quatre mois/)
  })
  it('dit le solde au 15 mai d’un exercice clos le 31 décembre, et rien d’autre', () => {
    expect(echeanceDuSolde('2026-12-31')).toBe('2027-05-15')
    expect(echeanceDuSolde('2026-09-30')).toBeNull()
  })
})

describe('les acomptes (CGI art. 1668 ; ann. III art. 359 ; BOI-IS-DECLA-20-10)', () => {
  const ref = (beneficeEuros: number, tauxReduitApplicable = true, debut = '2024-01-01', fin = '2024-12-31'): ReferenceDesAcomptes =>
    ({ etat: 'connue', debut, fin, beneficeImposable: E(beneficeEuros), tauxReduitApplicable })
  const acomptes = (avantDernier: ReferenceDesAcomptes, dernier: ReferenceDesAcomptes, premierExercice = false) => {
    const r = acomptesDeLExercice({ annee: 2026, premierExercice, avantDernier, dernier, bareme: BAREME_ARTICLE_219 })
    if ('refus' in r) throw new Error(r.refus)
    return r
  }

  it('un quart sur l’avant-dernier exercice, régularisé au deuxième, puis un quart du dernier', () => {
    // N−2 : 100 000 € → IS 20 750 € ; N−1 : 140 000 € → IS 30 750 €.
    const r = acomptes(ref(100_000), ref(140_000, true, '2025-01-01', '2025-12-31'))
    expect(r.acomptes.map((a) => [a.date, a.montant])).toEqual([
      ['2026-03-15', 518_750], ['2026-06-15', E(15_375) - 518_750], ['2026-09-15', 768_750], ['2026-12-15', 768_750],
    ])
    expect(r.acomptes.reduce((s, a) => s + a.montant, 0)).toBe(E(30_750))
  })
  it('ne rend jamais un deuxième acompte négatif : l’excédent du premier revient au solde', () => {
    // N−2 : 100 000 € → 20 750 € ; N−1 : 40 000 € → 6 000 €.
    const r = acomptes(ref(100_000), ref(40_000))
    expect(r.acomptes[1].montant).toBe(0)
    expect(r.excedentDuPremierAcompte).toBe(518_750 - E(3_000))
    expect(r.acomptes.every((a) => a.montant >= 0)).toBe(true)
  })
  it('dispense sous 3 000 € d’impôt de référence, 3 000 € compris', () => {
    // 20 000 € au taux réduit : 3 000 € tout juste.
    const r = acomptes(ref(20_000), ref(20_000))
    expect(r.impotDeReferenceDernier).toBe(SEUIL_DISPENSE_ACOMPTES)
    expect(r.acomptes.map((a) => a.etat)).toEqual(['dispense', 'dispense', 'dispense', 'dispense'])
    const auDessus = acomptes(ref(20_000), ref(20_007))
    expect(auDessus.acomptes[1]).toMatchObject({ etat: 'du', montant: 150_050 })
  })
  it('aucun acompte au premier exercice', () => {
    const r = acomptes({ etat: 'aucun-exercice' }, { etat: 'aucun-exercice' }, true)
    expect(r.acomptes.every((a) => a.etat === 'aucun' && a.montant === 0)).toBe(true)
  })
  it('au deuxième exercice, rien au 15 mars et tout se régularise au 15 juin', () => {
    const r = acomptes({ etat: 'aucun-exercice' }, ref(100_000))
    expect(r.acomptes[0].etat).toBe('aucun')
    expect(r.acomptes[1].montant).toBe(E(20_750) / 2)
  })
  it('ramène un exercice de référence de six mois à douze', () => {
    const r = acomptes({ etat: 'aucun-exercice' }, ref(50_000, true, '2025-07-01', '2025-12-31'))
    expect(r.impotDeReferenceDernier).toBe(E(20_750))
  })
  it('dit « non calculable » une référence à saisir, jamais zéro', () => {
    const r = acomptes({ etat: 'a-saisir' }, ref(100_000))
    expect(r.acomptes[0].etat).toBe('non-calculable')
    expect(r.acomptes[1].etat).toBe('non-calculable')
    expect(r.acomptes[2]).toMatchObject({ etat: 'du', montant: E(20_750) / 4 })
    const tout = acomptes(ref(100_000), { etat: 'a-saisir' })
    expect(tout.acomptes.slice(1).every((a) => a.etat === 'non-calculable')).toBe(true)
  })
  it('refuse un dernier exercice absent hors du premier exercice', () => {
    const r = acomptesDeLExercice({ annee: 2026, premierExercice: false, avantDernier: { etat: 'aucun-exercice' }, dernier: { etat: 'aucun-exercice' }, bareme: BAREME_ARTICLE_219 })
    expect('refus' in r).toBe(true)
  })
})
