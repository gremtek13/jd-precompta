import { describe, expect, it } from 'vitest'
import { compteDeResultat2033, type CompteDeResultatEtabli, type RattachementsAJuger } from './compteDeResultat2033'
import {
  controlesDeLaLiasse, ligneDuCompteDImmobilisation, tableau2033C, tableau2033CALEuro, tableau2033D, tableau2033E,
  tableau2033EALEuro, type BienDuRegistre, type ProvisionDuReleve, type Saisies2033E,
} from './liasse2033'
import { bilanEtabli, ecrire, reprise } from '../test/liasse2033'
import type { BilanEtabli } from './bilan'

// LA LIASSE SE CONFRONTE À DES TABLEAUX CALCULÉS À LA MAIN : le registre, les provisions et les écritures de chaque cas
// sont posés ici, et chaque case attendue est calculée en commentaire.

const PROVISIONS_EN_256: RattachementsAJuger = { dotationsAuxProvisionsDExploitation: '256', reprisesDExploitation: '230' }

const NATURES = [
  { id: 'informatique', compte_immobilisation: '218300' },
  { id: 'vehicule', compte_immobilisation: '218200' },
  { id: 'fonds', compte_immobilisation: '207000' },
  { id: 'etablissement', compte_immobilisation: '201000' },
]

function bien(o: Partial<BienDuRegistre> & Pick<BienDuRegistre, 'id'>): BienDuRegistre {
  return { libelle: o.id, nature_id: 'informatique', valeur: 0, date_acquisition: '2026-01-01', date_mise_en_service: null, duree_annees: 5, ...o }
}

// Un ordinateur de 3 600 € acquis le 01/07/2025, sur trois ans : au 31/12/2025, 180 jours en 30/360, donc
// 3 600 × 180 ÷ 1 080 = 600 € ; au 31/12/2026, 540 jours, 1 800 € ; la dotation de 2026, 1 200 €.
// Un véhicule de 18 000 € acquis le 01/03/2026, sur cinq ans : du 1er mars au 31 décembre, 300 jours, donc
// 18 000 × 300 ÷ 1 800 = 3 000 €.
const ORDINATEUR = bien({ id: 'ordinateur', valeur: 3_600, date_acquisition: '2025-07-01', duree_annees: 3 })
const VEHICULE = bien({ id: 'vehicule', nature_id: 'vehicule', valeur: 18_000, date_acquisition: '2026-03-01', duree_annees: 5 })

// La comptabilité qui va avec : la reprise au 01/01/2026 porte l'ordinateur et son amortissement ; le véhicule s'achète
// à crédit en 2026 ; les dotations et une provision pour litige s'écrivent au 31 décembre.
const OUVERTURE = reprise('2026-01-01', [['218300', 'D', 3_600], ['281830', 'C', 600], ['512000', 'D', 2_000], ['101000', 'C', 5_000]])
const ECRITURES = [
  ...ecrire('2026-03-01', [['218200', 'D', 18_000], ['164000', 'C', 18_000]]),
  ...ecrire('2026-06-01', [['411000', 'D', 9_000], ['706000', 'C', 9_000]]),
  ...ecrire('2026-12-31', [['681100', 'D', 4_200], ['281830', 'C', 1_200], ['281820', 'C', 3_000]]),
  ...ecrire('2026-12-31', [['681500', 'D', 500], ['151100', 'C', 500]]),
]
const LITIGE: ProvisionDuReleve = {
  id: 'litige', genre: 'risques-et-charges', libelle: 'Litige prud’homal', debut: 0, dotations: 50_000, reprises: 0, fin: 50_000,
  dotationsNonDeductibles: 0,
}

function liasse(o: { registre?: BienDuRegistre[]; provisions?: ProvisionDuReleve[]; rattachements?: RattachementsAJuger } = {}) {
  const bilan: BilanEtabli = bilanEtabli({ ecritures: ECRITURES, reprise: OUVERTURE })
  const cr = compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: o.rattachements ?? PROVISIONS_EN_256 })
  if (cr.etat !== 'etabli') throw new Error(cr.motif.texte)
  const tableauC = tableau2033C({ exercice: 2026, registre: o.registre ?? [ORDINATEUR, VEHICULE], natures: NATURES })
  const tableauD = tableau2033D(o.provisions ?? [LITIGE])
  return { bilan, compteDeResultat: cr, tableauC, tableauD }
}

const lire = (cases: Map<string, number | null>, codes: string[]) => codes.map((c) => cases.get(c))

describe('2033-C, cadres I et II, depuis le registre', () => {
  it('le début, les augmentations et la fin de chaque ligne ; un bien sans ligne se dit', () => {
    const t = tableau2033C({
      exercice: 2026, natures: NATURES,
      registre: [
        ORDINATEUR, VEHICULE,
        bien({ id: 'frais', nature_id: 'etablissement', valeur: 1_000 }),
        bien({ id: 'sans-nature', nature_id: null, valeur: 500 }),
        bien({ id: 'futur', valeur: 9_999, date_acquisition: '2027-01-10' }),
      ],
    })
    // Cadre I : autres corporelles 3 600 au début ; matériel de transport 18 000 d'augmentation ; total 3 600, 18 000, 0,
    // 21 600. Cadre II : autres corporelles 600, 1 200, fin 1 800 ; transport 0, 3 000, 3 000 ; total 600, 4 200, 0, 4 800.
    expect(lire(t.cases, ['470', '472', '474', '476', '460', '462', '464', '466', '490', '492', '494', '496']))
      .toEqual([360_000, 0, 0, 360_000, 0, 1_800_000, 0, 1_800_000, 360_000, 1_800_000, 0, 2_160_000])
    expect(lire(t.cases, ['560', '562', '564', '566', '550', '552', '556', '570', '572', '574', '576']))
      .toEqual([60_000, 120_000, 0, 180_000, 0, 300_000, 300_000, 60_000, 420_000, 0, 480_000])
    expect(t.biensHorsTableau.map((b) => b.id)).toEqual(['frais', 'sans-nature'])
    expect(t.biens.map((b) => b.id)).toEqual(['ordinateur', 'vehicule'])
  })

  it('un bien acquis le 1er janvier est une augmentation de l’exercice, celui du 31 décembre précédent son début', () => {
    const t = tableau2033C({
      exercice: 2026, natures: NATURES,
      registre: [bien({ id: 'veille', valeur: 100, date_acquisition: '2025-12-31' }), bien({ id: 'jour', valeur: 200, date_acquisition: '2026-01-01' })],
    })
    expect(lire(t.cases, ['470', '472'])).toEqual([10_000, 20_000])
  })

  it('la ligne d’un bien se lit au compte de sa nature, comme le 2033-A', () => {
    expect([
      '206000', '207000', '205000', '211000', '212000', '213100', '214000', '215400', '218100', '218200', '218300', '218400', '218800',
    ].map(ligneDuCompteDImmobilisation)).toEqual([
      'fonds-commercial', 'fonds-commercial', 'autres-incorporelles', 'terrains', 'terrains', 'constructions', 'constructions',
      'installations-techniques', 'installations-generales', 'materiel-de-transport', 'autres-corporelles', 'autres-corporelles',
      'autres-corporelles',
    ])
    expect(ligneDuCompteDImmobilisation('201000')).toHaveProperty('aClasser')
    expect(ligneDuCompteDImmobilisation('216000')).toHaveProperty('aClasser')
  })

  it('à l’euro, chaque montant s’arrondit seul et les fins se recalculent', () => {
    const t = tableau2033C({
      exercice: 2026, natures: NATURES,
      registre: [bien({ id: 'a', valeur: 100.5, date_acquisition: '2025-01-01' }), bien({ id: 'b', valeur: 100.5, date_acquisition: '2026-06-01' })],
    })
    // 470 = 100,50 → 101 ; 472 = 100,50 → 101 ; 476 = 202 (et non 201, l'arrondi de 201,00).
    const e = tableau2033CALEuro(t)
    expect([e.get('470'), e.get('472'), e.get('476'), e.get('496')]).toEqual([101, 101, 202, 202])
  })
})

describe('2033-D, cadre I, depuis les provisions passées en paramètre', () => {
  it('chaque genre à sa ligne, le total, et le cadre C reporté en 780', () => {
    const t = tableau2033D([
      LITIGE,
      { id: 'client', genre: 'depreciation-clients', libelle: 'Client Delta', debut: 20_000, dotations: 5_000, reprises: 8_000, fin: 17_000, dotationsNonDeductibles: 0 },
      { id: 'stock', genre: 'depreciation-stocks', libelle: 'Pertes futures sur stocks', debut: 0, dotations: 3_000, reprises: 0, fin: 3_000, dotationsNonDeductibles: 3_000 },
    ])
    expect(lire(t.cases, ['620', '622', '624', '626', '650', '652', '654', '656', '640', '646'])).toEqual([0, 50_000, 0, 50_000, 20_000, 5_000, 8_000, 17_000, 0, 3_000])
    // 680 = 20 000 ; 682 = 50 000 + 5 000 + 3 000 = 58 000 ; 684 = 8 000 ; 686 = 70 000. 780 = 3 000.
    expect(lire(t.cases, ['600', '606', '680', '682', '684', '686', '780'])).toEqual([0, 0, 20_000, 58_000, 8_000, 70_000, 3_000])
    expect(t.nonDeductibles).toEqual([{ libelle: 'Pertes futures sur stocks', centimes: 3_000 }])
    expect(t.incoherences).toEqual([])
  })

  it('une provision dont la fin ne suit pas ses mouvements, ou une part non déductible trop forte, se dit', () => {
    const t = tableau2033D([{ ...LITIGE, fin: 40_000, dotationsNonDeductibles: 60_000 }])
    expect(t.incoherences.map((i) => i.texte)).toEqual([
      expect.stringMatching(/font 500,00.*pas les 400,00/),
      expect.stringMatching(/600,00.*non déductibles, pour 500,00/),
    ])
    expect(() => tableau2033D([{ ...LITIGE, debut: -1 }])).toThrow(/centimes entiers positifs/)
  })

  it('la première ligne du cadre C est imprimée (les congés à payer) ; au-delà des six lignes libres, la septième porte le reste', () => {
    // LIA6 : la ligne 1 du formulaire 2026 porte « Indemnités pour congés à payer… » ; les provisions vont de 2 à 7.
    const huit = Array.from({ length: 8 }, (_, i): ProvisionDuReleve => ({ ...LITIGE, id: `p${i}`, libelle: `P${i}`, dotations: 100, fin: 100, dotationsNonDeductibles: 100 }))
    expect(lire(tableau2033D(huit).cases, ['C1', 'C2', 'C6', 'C7', '780'])).toEqual([0, 100, 100, 300, 800])
    expect(lire(tableau2033D([{ ...LITIGE, dotationsNonDeductibles: 700 }]).cases, ['C1', 'C2', '780'])).toEqual([0, 700, 700])
  })
})

describe('2033-E, la valeur ajoutée', () => {
  const SAISIES_VIDES: Saisies2033E = { 119: null, 143: null, 153: null, 310: null, 133: null, 128: null, 135: null, 150: null }
  const SAISIES_NULLES: Saisies2033E = { 119: 0, 143: 0, 153: 0, 310: 50_000, 133: 0, 128: 0, 135: 0, 150: 0 }

  function compteDeResultat(): CompteDeResultatEtabli {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
      ...ecrire('2026-02-01', [['411000', 'D', 20_000], ['707000', 'C', 12_000], ['706000', 'C', 8_000]]),
      ...ecrire('2026-02-15', [['709700', 'D', 500], ['411000', 'C', 500]]),
      ...ecrire('2026-03-01', [['512000', 'D', 1_300], ['751000', 'C', 300], ['758000', 'C', 400], ['740000', 'C', 600]]),
      ...ecrire('2026-04-01', [['607000', 'D', 6_000], ['606100', 'D', 400], ['401000', 'C', 6_400]]),
      ...ecrire('2026-05-01', [['613200', 'D', 1_200], ['616000', 'D', 300], ['622600', 'D', 700], ['512000', 'C', 2_200]]),
      ...ecrire('2026-06-01', [['635110', 'D', 250], ['651000', 'D', 100], ['512000', 'C', 350]]),
      ...ecrire('2026-12-31', [['370000', 'D', 800], ['603700', 'C', 800]]),
    ]
    const cr = compteDeResultat2033({ bilan: bilanEtabli({ ecritures }), mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 })
    if (cr.etat !== 'etabli') throw new Error(cr.motif.texte)
    return cr
  }

  it('les lignes tirées des comptes, et les totaux nuls tant qu’une saisie manque', () => {
    const t = tableau2033E(compteDeResultat(), SAISIES_VIDES)
    // 108 = 12 000 + 8 000 − 500 = 19 500 ; 118 = 751 300 ; 115 = 758 400 ; 113 = 74 600 ; 111 = 6037 créditeur 800 ;
    // 121 = 607 6 000 + 6061 400 = 6 400 ; 145 = 0 ; 125 = 616 300 + 6226 700 = 1 000 (le 6132 va aux loyers) ; 148 = 651 100.
    expect(lire(t.cases, ['108', '118', '115', '113', '111', '121', '145', '125', '148']))
      .toEqual([1_950_000, 30_000, 40_000, 60_000, 80_000, 640_000, 0, 100_000, 10_000])
    expect(lire(t.cases, ['106', '144', '152', '137'])).toEqual([null, null, null, null])
    expect(t.aSaisir).toEqual(['119', '143', '153', '310', '133', '128', '135', '150'])
    expect(t.propositions).toEqual([{ code: '310', centimes: 120_000, texte: expect.stringMatching(/plus de six mois/) }])
  })

  it('les saisies faites, les totaux se calculent, au centime puis à l’euro', () => {
    const t = tableau2033E(compteDeResultat(), SAISIES_NULLES)
    // 106 = 19 500 + 300 = 19 800 ; 144 = 400 + 600 + 800 = 1 800 ; 152 = 6 400 + 1 000 + 500 (loyers saisis) + 100 = 8 000 ;
    // 137 = 19 800 + 1 800 − 8 000 = 13 600.
    expect(lire(t.cases, ['106', '144', '152', '137'])).toEqual([1_980_000, 180_000, 800_000, 1_360_000])
    expect(t.propositions).toEqual([])
    expect(tableau2033EALEuro(t).get('137')).toBe(13_600)
    expect(() => tableau2033E(compteDeResultat(), { ...SAISIES_NULLES, 133: 1.5 })).toThrow(/centimes entiers/)
  })
})

describe('les contrôles de cohérence du § 3.6', () => {
  it('une liasse qui tient : aucun contrôle n’échoue', () => {
    const l = liasse()
    // 310 = 9 000 − 4 200 − 500 = 4 300, le résultat du bilan. Le registre : 21 600 de corporelles brutes, 4 800
    // d'amortissements ; le bilan : 218300 3 600 + 218200 18 000, 281830 600 + 1 200 et 281820 3 000. Le relevé des
    // provisions : 500 en 686 ; le bilan : 151100 500.
    expect(l.compteDeResultat.totaux['310']).toBe(430_000)
    expect(controlesDeLaLiasse(l)).toEqual([])
  })

  it('un bien absent du registre : le brut et les amortissements du 2033-C ne sont plus ceux du bilan', () => {
    const echecs = controlesDeLaLiasse(liasse({ registre: [ORDINATEUR] }))
    expect(echecs.map((c) => [c.code, c.numero, c.ecart])).toEqual([
      ['immobilisations-au-bilan', 3, -1_800_000],
      ['amortissements-au-bilan', 3, -300_000],
    ])
  })

  it('une provision oubliée, une autre incohérente, un bien sans ligne', () => {
    const echecs = controlesDeLaLiasse(liasse({
      registre: [ORDINATEUR, VEHICULE, bien({ id: 'sans-nature', nature_id: null, valeur: 0 })],
      provisions: [{ ...LITIGE, fin: 40_000 }],
    }))
    expect(echecs.map((c) => [c.code, c.ecart])).toEqual([
      ['biens-hors-tableau', 0],
      // 686 se calcule des mouvements (500), quoi que dise la fin saisie : il tient au bilan, et l'incohérence se dit.
      ['provisions-incoherentes', 0],
    ])
    const sansProvision = controlesDeLaLiasse(liasse({ provisions: [] }))
    expect(sansProvision.map((c) => [c.code, c.ecart])).toEqual([['provisions-au-bilan', -50_000]])
  })

  it('une dépréciation d’immobilisation va au 2033-D, jamais au cadre II du 2033-C', () => {
    // 291830 corrige le 218300 : la colonne 2 du 2033-A la porte avec les amortissements, le cadre II ne compte que les 28.
    const l = liasse({ provisions: [LITIGE, { ...LITIGE, id: 'pc', genre: 'depreciation-immobilisations', libelle: 'Ordinateur', dotations: 10_000, fin: 10_000 }] })
    const bilan = bilanEtabli({ ecritures: [...ECRITURES, ...ecrire('2026-12-31', [['681600', 'D', 100], ['291830', 'C', 100]])], reprise: OUVERTURE })
    const cr = compteDeResultat2033({ bilan, mode: 'engagement', imposition: 'is', rattachements: PROVISIONS_EN_256 })
    if (cr.etat !== 'etabli') throw new Error(cr.motif.texte)
    expect(controlesDeLaLiasse({ ...l, bilan, compteDeResultat: cr })).toEqual([])
  })

  it('un rattachement que le cabinet n’a pas fait : 310 n’est plus le résultat du bilan, et le compte est à classer', () => {
    const echecs = controlesDeLaLiasse(liasse({ rattachements: { dotationsAuxProvisionsDExploitation: 'a-classer', reprisesDExploitation: '230' } }))
    expect(echecs.map((c) => [c.code, c.numero, c.ecart])).toEqual([
      ['resultat-au-bilan', 1, 50_000],
      ['comptes-a-classer', 8, -50_000],
    ])
    expect(echecs[0].texte).toMatch(/case 310, 4.800,00.*case 136, 4.300,00.*500,00.€ d’écart/)
  })
})
