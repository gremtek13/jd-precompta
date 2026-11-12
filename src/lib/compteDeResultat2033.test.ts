import { describe, expect, it } from 'vitest'
import {
  arrondirALEuro, CASES_ALIMENTEES_2033B, compteDeResultat2033, compteDeResultatALEuro, regleDuCompteDeResultat,
  type CompteDeResultat2033, type CompteDeResultatEtabli, type RattachementsAJuger,
} from './compteDeResultat2033'
import { bilanDeLExercice } from './bilan'
import { bilanEtabli, ecrire, SOCIETE } from '../test/liasse2033'

// LE 2033-B SE CONFRONTE À DES COMPTES DE RÉSULTAT CALCULÉS À LA MAIN, jamais au module : chaque cas pose des écritures,
// fait le calcul en commentaire, case par case, et attend des centimes écrits en toutes lettres. Le passage des comptes aux
// cases est confronté à une table RECOPIÉE ici des libellés du 2033-B-SD 2026 et des numéros du PCG de 2026, pas à la table
// du module.

const PROVISIONS_EN_256: RattachementsAJuger = { dotationsAuxProvisionsDExploitation: '256', reprisesDExploitation: '230' }
const RIEN_DE_TRANCHE: RattachementsAJuger = { dotationsAuxProvisionsDExploitation: 'a-classer', reprisesDExploitation: 'a-classer' }

function etabli(cr: CompteDeResultat2033): CompteDeResultatEtabli {
  if (cr.etat !== 'etabli') throw new Error(`compte de résultat non établi : ${cr.motif.texte}`)
  return cr
}

const nonNulles = (cr: CompteDeResultatEtabli) =>
  Object.fromEntries(CASES_ALIMENTEES_2033B.filter((c) => cr.cases[c.code].centimes !== 0).map((c) => [c.code, cr.cases[c.code].centimes]))

// Une société commerciale, un exercice : des ventes de marchandises et de services, des achats, un stock final, des
// salaires, la CFE, des intérêts, une amende, l'IS.
const ANNEE = [
  ...ecrire('2026-01-02', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
  ...ecrire('2026-02-10', [['411000', 'D', 6_000], ['707000', 'C', 4_000], ['706000', 'C', 1_000], ['445710', 'C', 1_000]]),
  ...ecrire('2026-03-01', [['607000', 'D', 2_500], ['445660', 'D', 500], ['401000', 'C', 3_000]]),
  ...ecrire('2026-03-05', [['601000', 'D', 300], ['401000', 'C', 300]]),
  ...ecrire('2026-04-01', [['613200', 'D', 800], ['512000', 'C', 800]]),
  ...ecrire('2026-05-01', [['641000', 'D', 900], ['645000', 'D', 400], ['512000', 'C', 1_300]]),
  ...ecrire('2026-06-01', [['635110', 'D', 200], ['512000', 'C', 200]]),
  ...ecrire('2026-06-15', [['661100', 'D', 50], ['512000', 'C', 50]]),
  ...ecrire('2026-07-01', [['512000', 'D', 30], ['768000', 'C', 30]]),
  ...ecrire('2026-08-01', [['671200', 'D', 100], ['512000', 'C', 100]]),
  ...ecrire('2026-09-01', [['512000', 'D', 70], ['758000', 'C', 70]]),
  ...ecrire('2026-12-31', [['370000', 'D', 600], ['603700', 'C', 600]]),
  ...ecrire('2026-12-31', [['695000', 'D', 120], ['444000', 'C', 120]]),
]

describe('compteDeResultat2033 — des comptes de résultat calculés à la main', () => {
  it('une société à l’IS : chaque case, les totaux, 310 égal au résultat du bilan', () => {
    const bilan = bilanEtabli({ ecritures: ANNEE })
    const cr = etabli(compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 }))
    // Produits : 210 = 707 4 000 ; 218 = 706 1 000 ; 230 = 758 70. Charges : 234 = 607 2 500 ; 236 = 6037 −600 (le stock
    // final, en diminution des charges) ; 238 = 601 300 ; 242 = 6132 800 ; 244 = 63511 200 ; 250 = 641 900 ;
    // 252 = 645 400. 280 = 768 30 ; 294 = 6611 50 ; 300 = 6712 100 ; 306 = 695 120.
    expect(nonNulles(cr)).toEqual({
      210: 400_000, 218: 100_000, 230: 7_000, 234: 250_000, 236: -60_000, 238: 30_000, 242: 80_000, 244: 20_000,
      250: 90_000, 252: 40_000, 280: 3_000, 294: 5_000, 300: 10_000, 306: 12_000,
    })
    // 232 = 4 000 + 1 000 + 70 = 5 070. 264 = 2 500 − 600 + 300 + 800 + 200 + 900 + 400 = 4 500. 270 = 570.
    // 310 = 5 070 + 30 + 0 − 4 500 − 50 − 100 − 120 = 330 ; le bilan : produits 5 100, charges 4 770 = 330.
    expect(cr.totaux).toEqual({ 232: 507_000, 264: 450_000, 270: 57_000, 310: 33_000, 312: 33_000, 314: 0 })
    expect(bilan.resultat).toBe(33_000)
    expect(cr.aClasser).toEqual([])
    expect(cr.resultatAClasser).toBe(0)
    expect(cr.cases['242'].contributions).toEqual([{ compte: '613200', libelle: expect.any(String), centimes: 80_000 }])
    expect(cr.points.map((p) => p.code)).toEqual(['dont-a-saisir'])
    expect(cr.dontASaisir.map((d) => d.code)).toEqual(['209', '215', '217', '243', '380', '255', '259', '260', '347', '348'])
    expect(cr.propositions).toEqual([])
  })

  it('à l’IR, l’impôt sur les bénéfices est à classer : 306 ne concerne que l’IS', () => {
    const bilan = bilanEtabli({ ecritures: ANNEE })
    const cr = etabli(compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'ir', rattachements: PROVISIONS_EN_256 }))
    expect(cr.cases['306'].centimes).toBe(0)
    // 310 sans l'impôt : 330 + 120 = 450, quand le bilan dit 330 ; l'écart est le compte à classer, 120 de charge.
    expect(cr.totaux['310']).toBe(45_000)
    expect(cr.aClasser.map((a) => [a.compte, a.solde])).toEqual([['695000', 12_000]])
    expect(cr.resultatAClasser).toBe(-12_000)
    expect(cr.aClasser[0].raison).toMatch(/personnes morales soumises à l’impôt sur les sociétés/)
    expect(cr.points.find((p) => p.code === 'compte-a-classer')?.severite).toBe('erreur')
  })

  it('un dossier en trésorerie n’a pas de 2033-B : la 2035 n’est jamais touchée', () => {
    const bilan = bilanEtabli({ ecritures: ANNEE })
    const cr = compteDeResultat2033({ bilan, mode: 'tresorerie', imposition: 'ir', rattachements: PROVISIONS_EN_256 })
    expect(cr).toMatchObject({ etat: 'non-etabli', motif: { code: 'tresorerie' } })
  })

  it('un bilan qui ne s’établit pas ne donne pas de compte de résultat', () => {
    // L'exercice 2027 attend la validation de 2026, que rien n'a validé : son ouverture est en attente.
    const bilan = bilanDeLExercice({
      exercice: 2027, ecritures: ANNEE, categories: [], reprise: [], reportes: [], anneesValidees: [], pieces: [],
      modele: SOCIETE, aujourdHui: '2028-03-15',
    })
    expect(bilan.etat).toBe('non-etabli')
    const cr = compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 })
    expect(cr).toMatchObject({ etat: 'non-etabli', motif: { code: 'bilan-non-etabli' } })
  })

  it('les rattachements que rien ne tranche suivent le choix du cabinet, ou restent à classer', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
      ...ecrire('2026-12-31', [['681500', 'D', 400], ['151100', 'C', 400]]),
      ...ecrire('2026-12-31', [['151800', 'D', 0.5], ['781500', 'C', 0.5]]),
    ]
    const bilan = bilanEtabli({ ecritures })
    const juge = etabli(compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 }))
    expect(nonNulles(juge)).toEqual({ 230: 50, 256: 40_000 })
    const en262 = etabli(compteDeResultat2033({
      bilan, mode: 'engagement', imposition: 'is', rattachements: { ...PROVISIONS_EN_256, dotationsAuxProvisionsDExploitation: '262' },
    }))
    expect(nonNulles(en262)).toEqual({ 230: 50, 262: 40_000 })
    const attente = etabli(compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: RIEN_DE_TRANCHE }))
    expect(nonNulles(attente)).toEqual({})
    expect(attente.aClasser.map((a) => a.compte)).toEqual(['681500', '781500'])
    // −400 + 0,50 : le résultat hors des cases.
    expect(attente.resultatAClasser).toBe(-39_950)
  })

  it('un compte qui ne dit pas sa case est à classer, avec sa raison ; une case négative se signale', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
      ...ecrire('2026-03-01', [['603000', 'D', 10], ['709000', 'D', 20], ['791000', 'C', 30]]),
      ...ecrire('2026-04-01', [['709700', 'D', 15], ['707000', 'C', 5], ['512000', 'C', 10]]),
      ...ecrire('2026-05-01', [['646000', 'D', 300], ['512000', 'C', 300]]),
    ]
    const bilan = bilanEtabli({ ecritures })
    const cr = etabli(compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'ir', rattachements: PROVISIONS_EN_256 }))
    expect(cr.aClasser.map((a) => a.compte)).toEqual(['603000', '709000', '791000'])
    expect(cr.aClasser.find((a) => a.compte === '791000')?.raison).toMatch(/supprimé la technique des transferts de charges/)
    // 210 = 707 5 − 7097 15 = −10 : un rabais plus fort que la vente.
    expect(cr.cases['210'].centimes).toBe(-1_000)
    expect(cr.points.map((p) => p.code)).toEqual(['compte-a-classer', 'case-negative', 'dont-a-saisir'])
    expect(cr.propositions).toEqual([{ code: '380', centimes: 30_000, comptes: ['646000'], texte: expect.any(String) }])
    // Le résultat hors des cases : −10 − 20 + 30 = 0, et 310 égale le bilan.
    expect(cr.resultatAClasser).toBe(0)
    expect(cr.totaux['310']).toBe(bilan.resultat)
  })

  it('un exercice qui n’est pas clos le dit', () => {
    const bilan = bilanEtabli({ ecritures: ANNEE, aujourdHui: '2026-11-12' })
    const cr = etabli(compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 }))
    expect(cr.provisoire).toBe(true)
    expect(cr.points[0].code).toBe('provisoire')
  })
})

describe('regleDuCompteDeResultat — confrontée à une table recopiée du 2033-B-SD 2026 et du PCG de 2026', () => {
  const TABLE: [compte: string, attendu: string][] = [
    ['707000', '210'], ['709700', '210'],
    ['701000', '214'], ['702000', '214'], ['703000', '214'], ['709100', '214'], ['709300', '214'],
    ['704000', '218'], ['705000', '218'], ['706000', '218'], ['708500', '218'], ['709400', '218'], ['709600', '218'],
    ['713300', '222'], ['713500', '222'], ['721000', '224'], ['722000', '224'], ['740000', '226'],
    ['751000', '230'], ['757000', '230'], ['758000', '230'],
    ['607000', '234'], ['609700', '234'], ['603700', '236'],
    ['601000', '238'], ['602200', '238'], ['609100', '238'], ['603100', '240'], ['603200', '240'],
    ['604000', '242'], ['606100', '242'], ['609600', '242'], ['611000', '242'], ['613200', '242'], ['622600', '242'],
    ['627000', '242'], ['635110', '244'], ['637000', '244'],
    ['641000', '250'], ['644000', '250'], ['648000', '250'], ['645000', '252'], ['646000', '252'], ['647000', '252'],
    ['681100', '254'], ['681200', '254'], ['681600', '256'], ['681700', '256'],
    ['651000', '262'], ['657000', '262'], ['658000', '262'],
    ['761000', '280'], ['768000', '280'], ['786000', '280'], ['771000', '290'], ['775000', '290'], ['787000', '290'],
    ['661100', '294'], ['666000', '294'], ['686000', '294'], ['671200', '300'], ['675000', '300'], ['687000', '300'],
    ['695000', '306'], ['699000', '306'],
  ]
  it.each(TABLE)('%s va en case %s', (compte, attendu) => {
    expect(regleDuCompteDeResultat(compte, 'is', PROVISIONS_EN_256)).toEqual({ case: attendu })
  })

  it.each(['603000', '608000', '609000', '609800', '691000', '709000', '709800', '710000', '791000', '797000', '600000', '642000', '680000', '690000'])(
    '%s est à classer',
    (compte) => {
      expect(regleDuCompteDeResultat(compte, 'is', PROVISIONS_EN_256)).toHaveProperty('aClasser')
    },
  )
})

describe('l’arrondi à l’euro, à la case seulement', () => {
  it('la fraction égale à 0,50 € compte pour un euro, un négatif comme sa valeur absolue', () => {
    expect([150, 149, 50, 49, 0, -49, -50, -149, -150, 123_456_789].map(arrondirALEuro))
      .toEqual([2, 1, 1, 0, 0, 0, -1, -1, -2, 1_234_568])
    expect(() => arrondirALEuro(10.5)).toThrow(/centimes entiers/)
  })

  it('les cases alimentées s’arrondissent seules, les totaux se recalculent sur elles', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
      ...ecrire('2026-02-01', [['411000', 'D', 201], ['707000', 'C', 100.5], ['706000', 'C', 100.5]]),
      ...ecrire('2026-03-01', [['606100', 'D', 0.4], ['512000', 'C', 0.4]]),
    ]
    const cr = etabli(compteDeResultat2033({ bilan: bilanEtabli({ ecritures }), mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 }))
    // Au centime : 232 = 201,00, 264 = 0,40, 310 = 200,60. À l'euro : 210 = 101, 218 = 101, 232 = 202 (et non 201) ;
    // 242 = 0 ; 310 = 202.
    expect(cr.totaux['310']).toBe(20_060)
    const euros = compteDeResultatALEuro(cr)
    expect([euros.get('210'), euros.get('218'), euros.get('232'), euros.get('242'), euros.get('264'), euros.get('310'), euros.get('312'), euros.get('314')])
      .toEqual([101, 101, 202, 0, 0, 202, 202, 0])
  })
})
