import { describe, expect, it } from 'vitest'
import {
  CODES_2035E, LIGNES_2035E, SAISIES_2035E_ABSENTES, SEUIL_ANNEXE_2035E, SEUIL_CVAE_A_PAYER, cadreMonoEtablissement,
  calculer2035E, chiffreDAffaires2035E, forfaitKilometriqueDesPostes,
} from './declaration2035E'
import type { Annexe2035E, Saisies2035E } from './declaration2035E'
import { arrondirPourFormulaire, valeursDesCases } from './cases2035'
import { calculerDeclaration2035, POSTE_INDEMNITES_KM } from './declaration2035'
import type { Categorie, Piece } from './types'

// LES ATTENDUS SONT CALCULÉS À LA MAIN, depuis la notice 2035-NOT-SD 2026 (annexe 2035-E, p. 11-12) et le BOFiP
// (BOI-CVAE-BASE-20-10 § 70-80, BOI-CVAE-BASE-20-20 § 180-370) : chaque nombre attendu est écrit en clair, avec l'opération
// qui le donne. Aucun ne sort du moteur — un test qui compare le moteur à lui-même ne prouve rien.

// Les cases d'une 2035 : la même Map sert au centime et à l'euro quand les montants sont ronds.
const cases = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o))

const annexe = (
  formulaire: Record<string, number>,
  o: { cases?: Record<string, number>; forfait?: number; saisies?: Partial<Saisies2035E>; annee?: number } = {},
): Annexe2035E => calculer2035E({
  annee: o.annee ?? 2025,
  cases: cases(o.cases ?? formulaire),
  formulaire: cases(formulaire),
  forfaitKilometrique: o.forfait ?? 0,
  saisies: { ...SAISIES_2035E_ABSENTES, ...o.saisies },
})

// UNE INFIRMIÈRE EXONÉRÉE DE TVA, exercice 2025, telle que sa 2035 la porte à l'euro.
const INFIRMIERE = {
  AA: 180_000, AB: 0, AC: 2_000, AD: 178_000, AE: 50, AF: 1_200,
  BA: 3_000, BF: 9_600, BG: 1_800, BW: 0, BH: 6_500, BJ: 7_000, BM: 2_400,
  BK: 30_000, BV: 4_000, JY: 900, BS: 400, BN: 350, BB: 0, BC: 0, BD: 0, BP: 0, CH: 2_500,
}

describe('la table des lignes — fidélité au formulaire 2035-E-SD 2026', () => {
  it('porte les dix-huit lignes de la page, dans l’ordre imprimé', () => {
    // Relevé sur la page 3 de public/formulaires/2035-sd-2026.pdf, de haut en bas.
    expect(CODES_2035E).toEqual([
      'EF', 'EG', 'EH', 'EN', 'EI', 'EJ', 'EK', 'EL', 'EM', 'EO', 'EP', 'EQ', 'ER', 'EU', 'EV', 'EW', 'EX', 'JU',
    ])
  })

  it('tient les six lignes que seule une saisie remplit, et les quatre totaux', () => {
    expect(LIGNES_2035E.filter((l) => l.saisieCabinet).map((l) => l.code)).toEqual(['EN', 'EK', 'EM', 'ER', 'EU', 'EV'])
    expect(LIGNES_2035E.filter((l) => l.calculee).map((l) => l.code)).toEqual(['EI', 'EW', 'EX', 'JU'])
  })
})

describe('le chiffre d’affaires au sens de la CVAE', () => {
  it('est le montant net des recettes, moins les redevances de collaboration versées, plus les gains divers', () => {
    // 178 000 (AD, déjà net de 2 000 € de rétrocessions) − 0 (BW) + 1 200 (AF) = 179 200. Les produits financiers (AE)
    // n'en sont pas.
    expect(chiffreDAffaires2035E(cases(INFIRMIERE))).toBe(179_200)
  })

  it('retranche les redevances de collaboration : elles seules sont des rétrocessions pour la CVAE', () => {
    // Notice, renvoi (9) : un collaborateur verse 60 000 € de redevances sur 200 000 € d'honoraires. Pour la 2035 c'est
    // un loyer (BW, dans BG) ; pour la CVAE, une rétrocession. 200 000 − 60 000 = 140 000 : sous le seuil.
    expect(chiffreDAffaires2035E(cases({ AD: 200_000, BG: 60_000, BW: 60_000 }))).toBe(140_000)
  })

  it('se compte au centime', () => {
    expect(chiffreDAffaires2035E(cases({ AD: 152_499.6, AF: 0.41 }))).toBe(152_500.01)
  })
})

describe('l’obligation : un chiffre d’affaires supérieur à 152 500 € hors taxes', () => {
  it('fixe le seuil à 152 500 € et celui de la CVAE à payer à 500 000 €', () => {
    expect(SEUIL_ANNEXE_2035E).toBe(152_500)
    expect(SEUIL_CVAE_A_PAYER).toBe(500_000)
  })

  it('n’est pas due à 152 500 € pile, l’est au centime de plus', () => {
    // « supérieur à 152 500 € hors taxes » (notice, p. 11) : strictement.
    expect(annexe({ AD: 152_500 }).obligatoire).toBe(false)
    expect(annexe({ AD: 152_500 }, { cases: { AD: 152_500.01 } }).obligatoire).toBe(true)
  })

  it('se juge au centime, même quand le formulaire arrondit à 152 500 €', () => {
    // 152 499,60 + 0,41 = 152 500,01 € de chiffre d'affaires réalisé ; le formulaire porte 152 500 et 0.
    const a = annexe({ AD: 152_500, AF: 0 }, { cases: { AD: 152_499.6, AF: 0.41 } })
    expect(a.obligatoire).toBe(true)
    expect(a.lignes.get('EF')).toBe(152_500)
  })

  it('n’est pas due pour un collaborateur que ses redevances ramènent sous le seuil', () => {
    expect(annexe({ AD: 200_000, BG: 60_000, BW: 60_000 }).obligatoire).toBe(false)
    // Sans le retrait des redevances, 200 000 € la rendraient due.
    expect(annexe({ AD: 200_000, BG: 60_000, BW: 0 }).obligatoire).toBe(true)
  })

  it('ne fait rien payer sous 500 000 € : le taux de la CVAE y est nul', () => {
    expect(annexe(INFIRMIERE).cvae).toBe('nulle')
    expect(annexe({ AD: 500_000 }).cvae).toBe('nulle')
    expect(annexe({ AD: 500_000 }, { cases: { AD: 500_000.01 } }).cvae).toBe('a_liquider')
  })
})

describe('les lignes, depuis la 2035 déposée', () => {
  it('remplit l’annexe de l’infirmière, ligne par ligne', () => {
    // A. EF = AD − BW = 178 000 ; EG = AF = 1 200 ; EH = EN = 0 ; EI = 179 200.
    // B. EJ = BA = 3 000 ; EL = BH = 6 500 ; EM = 0 (aucun loyer tenu pour déductible) ; EO = BJ − forfait = 7 000 − 6 300
    //    = 700 ; EP = BM = 2 400 ; EK = EQ = ER = EU = EV = 0 ; EW = 3 000 + 6 500 + 700 + 2 400 = 12 600.
    // C. EX = 179 200 − 12 600 = 166 600.
    // D. AJ = EF + EG = 179 200 ; plafond = 80 % = 143 360 ; JU = min(166 600, 143 360) = 143 360.
    const a = annexe(INFIRMIERE, { forfait: 6_300 })
    expect(Object.fromEntries(a.lignes)).toEqual({
      EF: 178_000, EG: 1_200, EH: 0, EN: 0, EI: 179_200,
      EJ: 3_000, EK: 0, EL: 6_500, EM: 0, EO: 700, EP: 2_400, EQ: 0, ER: 0, EU: 0, EV: 0, EW: 12_600,
      EX: 166_600, JU: 143_360, AJ: 179_200,
    })
    expect(a.obligatoire).toBe(true)
    expect(a.plafond).toBe(143_360)
    expect(a.plafonnee).toBe(true)
    // Les loyers et locations de la 2035 (9 600 + 1 800) ne sont pas déduits, et l'annexe dit combien.
    expect(a.loyersEtLocations).toBe(11_400)
    expect(a.loyersNonDeduits).toBe(11_400)
    expect(a.forfaitKilometrique).toBe(6_300)
    // Elle ne verse aucune redevance de collaboration : BW = 0.
    expect(a.redevancesDeCollaboration).toBe(0)
    expect(a.incoherences).toEqual([])
  })

  it('n’emporte ni les salaires, ni les impôts, ni les charges personnelles, ni les frais financiers, ni les amortissements', () => {
    // Seules BA, BH, BF/BG, BJ et BM entrent dans le total 2 (notice, p. 11 : la liste des dépenses déductibles).
    const a = annexe({ AD: 200_000, BB: 40_000, BC: 18_000, BD: 3_000, JY: 900, BS: 400, BV: 4_000, BK: 30_000, BN: 350, BP: 100, CH: 2_500 })
    expect(a.lignes.get('EW')).toBe(0)
    expect(a.lignes.get('EX')).toBe(200_000)
  })

  it('laisse EH et EQ à zéro, même quand la 2035 porte de la TVA en BD', () => {
    // Elles ne servent qu'à une comptabilité « TVA incluse » (renvoi (1) de l'annexe) ; celle de l'application est hors
    // taxes, et la TVA reversée au Trésor n'est pas une dépense déductible de la valeur ajoutée (BOI-CVAE-BASE-20-20 § 310).
    const a = annexe({ AD: 160_000, BD: 5_000 })
    expect(a.lignes.get('EH')).toBe(0)
    expect(a.lignes.get('EQ')).toBe(0)
    expect(a.lignes.get('EW')).toBe(0)
  })

  it('retire de EF les redevances de collaboration, et ne les compte pas une seconde fois dans les loyers', () => {
    // AD 200 000, BG 30 000 dont BW 30 000 : EF = 170 000, et le reste des locations, BF + BG − BW, vaut zéro.
    const a = annexe({ AD: 200_000, BG: 30_000, BW: 30_000 })
    expect(a.lignes.get('EF')).toBe(170_000)
    expect(a.loyersEtLocations).toBe(0)
    expect(a.lignes.get('EM')).toBe(0)
    // Et l'annexe dit qu'elle les a retranchées.
    expect(a.redevancesDeCollaboration).toBe(30_000)
  })

  it('porte en EM la part des loyers que le cabinet dit déductible, et le reste reste dit', () => {
    // 1 800 € de location courte (six mois au plus) sur 11 400 € : EM = 1 800, non déduits 9 600 ;
    // EW = 3 000 + 6 500 + 1 800 + 700 + 2 400 = 14 400 ; EX = 179 200 − 14 400 = 164 800.
    const a = annexe(INFIRMIERE, { forfait: 6_300, saisies: { loyersDeductibles: 1_800 } })
    expect(a.lignes.get('EM')).toBe(1_800)
    expect(a.loyersNonDeduits).toBe(9_600)
    expect(a.lignes.get('EW')).toBe(14_400)
    expect(a.lignes.get('EX')).toBe(164_800)
  })

  it('reçoit les autres saisies du cabinet à leur ligne, une variation de stock négative diminuant les charges', () => {
    // EN 500 → EI = 178 000 + 1 200 + 500 = 179 700. EK −300 (le stock a monté), ER 120, EU 1 000, EV 200 :
    // EW = 3 000 − 300 + 6 500 + 0 + 700 + 2 400 + 0 + 120 + 1 000 + 200 = 13 620 ; EX = 179 700 − 13 620 = 166 080.
    // Le chiffre d'affaires de référence n'inclut pas la plus-value : AJ = 179 200.
    const a = annexe(INFIRMIERE, {
      forfait: 6_300,
      saisies: { plusValues: 500, variationDeStock: -300, taxesSurLeChiffreDAffaires: 120, dotationsBiensMisADisposition: 1_000, moinsValues: 200 },
    })
    expect(a.lignes.get('EN')).toBe(500)
    expect(a.lignes.get('EI')).toBe(179_700)
    expect(a.lignes.get('EK')).toBe(-300)
    expect(a.lignes.get('ER')).toBe(120)
    expect(a.lignes.get('EU')).toBe(1_000)
    expect(a.lignes.get('EV')).toBe(200)
    expect(a.lignes.get('EW')).toBe(13_620)
    expect(a.lignes.get('EX')).toBe(166_080)
    expect(a.lignes.get('AJ')).toBe(179_200)
  })

  it('retire le forfait kilométrique à l’euro, et garde les autres frais de déplacement', () => {
    // BJ 4 000,40 € s'imprime 4 000 ; le forfait 2 660,49 € s'arrondit à 2 660 : EO = 4 000 − 2 660 = 1 340.
    const a = annexe({ AD: 160_000, BJ: 4_000 }, { cases: { AD: 160_000, BJ: 4_000.4 }, forfait: 2_660.49 })
    expect(a.lignes.get('EO')).toBe(1_340)
    expect(a.forfaitKilometrique).toBe(2_660)
  })

  it('lit les lignes dans le formulaire à l’euro, pas dans les cases au centime', () => {
    // AA 160 000,60 € et AC 0,40 € : au centime, AD = 160 000,20, qui s'arrondirait à 160 000. Le formulaire arrondit les
    // lignes saisies AVANT de calculer AD (AA → 160 001, AC → 0) et porte AD = 160 001 : c'est lui que la 2035-E reprend,
    // EF = 160 001 — un EF tiré des cases au centime, même arrondi, dirait 160 000. BA 999,60 € s'imprime 1 000.
    const a = annexe({ AD: 160_001, BA: 1_000 }, { cases: { AD: 160_000.2, BA: 999.6 } })
    expect(a.lignes.get('EF')).toBe(160_001)
    expect(a.lignes.get('EJ')).toBe(1_000)
    // Le seuil, lui, se juge au centime : 160 000,20 €.
    expect(a.chiffreDAffaires).toBe(160_000.2)
  })
})

describe('la valeur ajoutée assujettie (JU)', () => {
  it('se déclare zéro quand la valeur ajoutée est négative', () => {
    // 160 000 − 200 000 = −40 000 : EX la garde, JU porte zéro (notice 1330-CVAE, cadre A2).
    const a = annexe({ AD: 160_000, BA: 200_000 })
    expect(a.lignes.get('EX')).toBe(-40_000)
    expect(a.lignes.get('JU')).toBe(0)
    expect(a.plafonnee).toBe(false)
  })

  it('reste la valeur ajoutée elle-même sous 80 % du chiffre d’affaires', () => {
    // 200 000 − 50 000 = 150 000, sous 80 % × 200 000 = 160 000.
    const a = annexe({ AD: 200_000, BH: 50_000 })
    expect(a.lignes.get('JU')).toBe(150_000)
    expect(a.plafonnee).toBe(false)
  })

  it('s’arrête au plafond à l’euro inférieur', () => {
    // 80 % × 152 501 = 122 000,80 : JU = 122 000, jamais 122 001, qui excéderait le plafond.
    const a = annexe({ AD: 152_501 })
    expect(a.plafond).toBe(122_000)
    expect(a.lignes.get('JU')).toBe(122_000)
  })

  it('passe à 85 % au-delà de 7,6 millions d’euros de chiffre d’affaires, et reste à 80 % à 7,6 millions pile', () => {
    expect(annexe({ AD: 7_600_000 }).plafond).toBe(6_080_000)
    // 85 % × 8 000 000 = 6 800 000.
    expect(annexe({ AD: 8_000_000 }).plafond).toBe(6_800_000)
    expect(annexe({ AD: 8_000_000 }).lignes.get('JU')).toBe(6_800_000)
  })
})

describe('les incohérences se disent, elles ne se corrigent pas', () => {
  it('signale des loyers déduits au-delà de ce que la 2035 porte', () => {
    const a = annexe(INFIRMIERE, { saisies: { loyersDeductibles: 12_000 } })
    expect(a.incoherences.map((i) => i.code)).toEqual(['EM'])
    // Le montant saisi reste porté : c'est au cabinet de le reprendre.
    expect(a.lignes.get('EM')).toBe(12_000)
  })

  it('signale des loyers déduits négatifs', () => {
    expect(annexe(INFIRMIERE, { saisies: { loyersDeductibles: -1 } }).incoherences.map((i) => i.code)).toEqual(['EM'])
  })

  it('signale une ligne de frais de déplacement que le forfait fait passer sous zéro', () => {
    // BJ 5 000, forfait 6 000 : EO = −1 000.
    const a = annexe({ AD: 160_000, BJ: 5_000 }, { forfait: 6_000 })
    expect(a.lignes.get('EO')).toBe(-1_000)
    expect(a.incoherences.map((i) => i.code)).toEqual(['EO'])
  })
})

describe('le forfait kilométrique des postes', () => {
  it('est la dépense du poste « Indemnités kilométriques », au centime', () => {
    expect(forfaitKilometriqueDesPostes([
      { poste: POSTE_INDEMNITES_KM, nature: 'depense', montant: 2_660.4 },
      { poste: 'Frais de déplacement', nature: 'depense', montant: 340 },
      { poste: POSTE_INDEMNITES_KM, nature: 'recette', montant: 99 },
    ])).toBe(2_660.4)
  })

  it('vaut zéro sans véhicule au barème', () => {
    expect(forfaitKilometriqueDesPostes([{ poste: 'Achats', nature: 'depense', montant: 10 }])).toBe(0)
  })
})

describe('le cadre réservé aux mono-établissements', () => {
  it('porterait le chiffre d’affaires de référence et l’année civile', () => {
    expect(cadreMonoEtablissement(annexe(INFIRMIERE))).toEqual({ chiffreDeReference: 179_200, du: '2025-01-01', au: '2025-12-31' })
  })
})

// DE BOUT EN BOUT : pièces → moteur de la 2035 → cases → formulaire à l'euro → 2035-E. Le câblage que l'écran fera.
describe('de bout en bout depuis les pièces', () => {
  const categorie = (o: Partial<Categorie>): Categorie => ({
    id: 'c', dossier_id: null, code: 'autre', libelle: 'Autre', ordre: 1, compte_comptable: null, poste_2035: null, ...o,
  })
  const piece = (o: Partial<Piece>): Piece => ({
    id: 'p', dossier_id: 'd', uploaded_by: null, source: 'upload', storage_path: 'd/p.pdf', nom_fichier: 'p.pdf', storage_hash: null,
    date_piece: '2025-03-10', tiers: null, montant_ht: null, montant_tva: null, montant_ttc: null, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut: 'validee',
    notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    created_at: '2025-03-10T09:00:00Z', updated_at: '2025-03-10T09:00:00Z', ...o,
  })
  const categories = [
    categorie({ id: 'c-recettes', compte_comptable: '706000', poste_2035: 'Recettes' }),
    categorie({ id: 'c-achats', compte_comptable: '606100', poste_2035: 'Achats' }),
    categorie({ id: 'c-loyer', compte_comptable: '613200', poste_2035: 'Loyers et charges locatives' }),
  ]

  it('tire l’annexe d’un dossier exonéré de TVA, TVA comprise dans ses dépenses', () => {
    // Exonéré : les montants retenus sont TTC. AA = 160 000 ; BA = 1 000,40 → 1 000 ; BF = 9 600.
    // Chiffre d'affaires 160 000 > 152 500 : due. EF = 160 000 ; EJ = 1 000 ; EM = 0 (loyer non déduit) ;
    // EW = 1 000 ; EX = 159 000 ; AJ = 160 000 ; plafond 128 000 ; JU = 128 000.
    const d = calculerDeclaration2035(2025, [
      piece({ id: 'v', type_piece: 'vente', categorie_id: 'c-recettes', montant_ttc: 160_000 }),
      piece({ id: 'a', categorie_id: 'c-achats', montant_ttc: 1_000.4 }),
      piece({ id: 'l', categorie_id: 'c-loyer', montant_ttc: 9_600 }),
    ], categories, [], [], [], false, new Map(), [], [])
    const { valeurs } = valeursDesCases(d)
    const a = calculer2035E({
      annee: 2025, cases: valeurs, formulaire: arrondirPourFormulaire(valeurs, 2025),
      forfaitKilometrique: forfaitKilometriqueDesPostes([...d.recettes, ...d.depenses]), saisies: SAISIES_2035E_ABSENTES,
    })
    expect(a.obligatoire).toBe(true)
    expect(a.chiffreDAffaires).toBe(160_000)
    expect([a.lignes.get('EF'), a.lignes.get('EJ'), a.lignes.get('EM'), a.lignes.get('EW'), a.lignes.get('EX'), a.lignes.get('JU')])
      .toEqual([160_000, 1_000, 0, 1_000, 159_000, 128_000])
    expect(a.loyersNonDeduits).toBe(9_600)
  })
})
