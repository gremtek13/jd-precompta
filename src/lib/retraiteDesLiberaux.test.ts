import { describe, expect, it } from 'vitest'
import {
  anneeDAffiliationALaCarmf, derniereAnneeDeLaDispense, BAREMES_RETRAITE, CAISSE_DE_LA_PROFESSION, MOTIF_EXONERATION_NON_DITE,
  estimerRetraite, type EntreeRetraite,
} from './retraiteDesLiberaux'
import { CAS_REFERENCE_RETRAITE, MOTEUR_REFERENCE_RETRAITE, type CasReferenceRetraite } from './retraiteDesLiberauxReference'
import { PLAFONDS_SECURITE_SOCIALE, estimerCotisationsUrssaf } from './voletSocialPamc'

// Nos chiffres contre ceux du moteur de l'Urssaf (outils/cotisations/oracle.mjs retraite), jamais contre les nôtres.

const entreeDe = (c: CasReferenceRetraite): EntreeRetraite => ({
  annee: c.entree.annee,
  profession: c.entree.profession,
  remplacant: false,
  revenuBrutSocial: c.entree.revenuBrutSocial,
  revenuProfessionnelPositif: true,
  recettesBrutes: c.entree.recettesBrutes,
  honorairesConventionnes: c.entree.honorairesConventionnes,
  depassements: c.entree.depassements,
  parametres: c.entree.parametres,
  cumulEmploiRetraite: CAISSE_DE_LA_PROFESSION[c.entree.profession] === 'carmf' ? c.entree.enRetraite : null,
  // Le moteur de l'Urssaf ne connaît pas la case de la dispense (RET-Q2) : l'estimation d'hier, sans elle.
  dispenseDesDebuts: { tenue: false },
  exonerationEnZonePrioritaire: { tenue: false },
})

const enCentimes = (euros: number) => Math.round(euros * 100)

// L'UNE EXCEPTION, ET SON NOMBRE. En 2026, le complémentaire de la CARPIMKO porté à son plancher (0,5 plafond) ou à son
// plafond (3 plafonds) : le moteur arrondit la cotisation sur le plafond MENSUEL puis la multiplie par douze (2 088 € et
// 12 540 €), quand la CARPIMKO publie 2 091 € et 12 544 € (carpimko.com, « selon mes revenus », relu le 10/11/2026) —
// l'arrondi à l'euro de l'annuel. L'application suit la caisse ; le test exige que l'écart soit EXACTEMENT celui-là.
const plafondDuMois = (annee: number) => PLAFONDS_SECURITE_SOCIALE[annee] / 12
function complementaireCarpimkoBorne(c: CasReferenceRetraite): { moteur: number; caisse: number } | null {
  if (c.entree.annee !== 2026 || CAISSE_DE_LA_PROFESSION[c.entree.profession] !== 'carpimko') return null
  const p = PLAFONDS_SECURITE_SOCIALE[2026]
  const borne = c.attendu.assiette < p / 2 ? 0.5 : c.attendu.assiette > 3 * p ? 3 : null
  if (borne === null) return null
  return {
    moteur: 12 * Math.round(borne * plafondDuMois(2026) * 0.087),
    caisse: Math.round(borne * p * 0.087),
  }
}
const EXCEPTIONS_ATTENDUES = 28

// LA SECONDE EXCEPTION, ET SON NOMBRE (RET2-Q3, tranchée par le cabinet le 16/11/2026 : « (A) Zéro l'année qui précède
// l'affiliation »). Un médecin dont l'activité commence en octobre, novembre ou décembre de l'exercice n'est affilié à la
// CARMF qu'au 1er janvier suivant (« Début d'exercice libéral », CARMF, édition 2026 : « Votre affiliation est prononcée au
// premier jour du trimestre civil suivant le début de l'exercice non salarié ») : la caisse n'appelle rien sur l'année du
// début, que le moteur, qui ignore l'affiliation, chiffre comme une autre. L'application suit la caisse. Le cas se reconnaît
// ICI sur la date seule — le mois du début et son année, celle de l'exercice —, jamais par la fonction du module ; le test
// exige que le moteur y compte quelque chose, nous rien, sur EXACTEMENT ces cas.
const avantLAffiliationALaCarmf = (c: CasReferenceRetraite): boolean => {
  const debut = c.entree.parametres.debutActivite
  return CAISSE_DE_LA_PROFESSION[c.entree.profession] === 'carmf'
    && Number(debut.slice(0, 4)) === c.entree.annee && Number(debut.slice(5, 7)) >= 10
}
const AVANT_L_AFFILIATION_ATTENDUS = 6

describe('la retraite des professions libérales, contre le moteur de l’Urssaf', () => {
  it('porte une grille réelle : les deux années, les trois caisses, la création, l’ACRE, le cumul', () => {
    expect(MOTEUR_REFERENCE_RETRAITE).toBe('modele-ti 0.1.0')
    expect(CAS_REFERENCE_RETRAITE.length).toBeGreaterThanOrEqual(300)
    expect(new Set(CAS_REFERENCE_RETRAITE.map((c) => c.entree.annee))).toEqual(new Set(Object.keys(BAREMES_RETRAITE).map(Number)))
    for (const caisse of ['carpimko', 'carmf', 'carcdsf', 'cipav']) {
      expect(CAS_REFERENCE_RETRAITE.filter((c) => CAISSE_DE_LA_PROFESSION[c.entree.profession] === caisse).length).toBeGreaterThanOrEqual(60)
    }
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.attendu.acreAppliquee).length).toBeGreaterThanOrEqual(20)
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.attendu.plafondProratise < c.attendu.plafond).length).toBeGreaterThanOrEqual(40)
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.entree.enRetraite).length).toBeGreaterThanOrEqual(4)
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.attendu.priseEnChargeRetraiteDeBase > 0).length).toBeGreaterThanOrEqual(30)
  })

  it('rend chaque cotisation au centime, sur chaque cas', () => {
    let exceptions = 0
    let avantLAffiliation = 0
    for (const c of CAS_REFERENCE_RETRAITE) {
      const r = estimerRetraite(entreeDe(c))
      if (!r.disponible) throw new Error(`${c.cas} : ${r.motif}`)
      const e = r.estimation
      const a = c.attendu
      if (avantLAffiliationALaCarmf(c)) {
        avantLAffiliation++
        // Le moteur appelle la base, l'invalidité-décès et les PCV ; la CARMF, rien.
        expect(a.total, c.cas).toBeGreaterThan(0)
        expect(a.invaliditeDeces, c.cas).toBeGreaterThan(0)
        expect(e, c.cas).toEqual({
          caisse: 'carmf', assiette: enCentimes(a.assiette), assietteMinimale: e.assietteMinimale, retraiteDeBase: 0,
          priseEnChargeRetraiteDeBase: 0, retraiteComplementaire: 0, invaliditeDeces: 0, pcv: 0, priseEnChargePcv: 0, total: 0,
          hypotheses: ['carmf-annee-avant-l-affiliation'],
        })
        continue
      }
      const borne = complementaireCarpimkoBorne(c)
      let ecart = 0
      if (borne !== null) {
        exceptions++
        expect(a.retraiteComplementaire, c.cas).toBe(borne.moteur)
        expect(e.retraiteComplementaire, c.cas).toBe(enCentimes(borne.caisse))
        ecart = borne.caisse - borne.moteur
      } else {
        expect(e.retraiteComplementaire, c.cas).toBe(enCentimes(a.retraiteComplementaire))
      }
      expect(e.assiette, c.cas).toBe(enCentimes(a.assiette))
      expect(e.retraiteDeBase, c.cas).toBe(enCentimes(a.retraiteDeBase))
      // Les deux prises en charge, le moteur ne les arrondit pas : nous au centime le plus proche du montant exact,
      // lui en flottants (3 431,645 € lui vaut 3 431,644999…) — à un demi-centime au plus.
      expect(Math.abs(e.priseEnChargeRetraiteDeBase - a.priseEnChargeRetraiteDeBase * 100), c.cas).toBeLessThanOrEqual(0.5 + 1e-6)
      expect(e.invaliditeDeces, c.cas).toBe(enCentimes(a.invaliditeDeces))
      expect(e.pcv, c.cas).toBe(enCentimes(a.pcv))
      expect(Math.abs(e.priseEnChargePcv - a.priseEnChargePcv * 100), c.cas).toBeLessThanOrEqual(0.5 + 1e-6)
      expect(e.total, c.cas).toBe(enCentimes(a.total + ecart))
    }
    expect(exceptions).toBe(EXCEPTIONS_ATTENDUES)
    expect(avantLAffiliation).toBe(AVANT_L_AFFILIATION_ATTENDUS)
  })
})

describe('la retraite de la CIPAV (RET-Q1), contre le moteur', () => {
  const cipav = CAS_REFERENCE_RETRAITE.filter((c) => c.entree.profession === 'liberal_cipav')
  const p = (c: CasReferenceRetraite) => c.attendu.plafond

  it('franchit chaque borne : le plancher et le plafond de l’invalidité-décès, les deux tranches du complémentaire', () => {
    for (const [nom, borne] of [['37 %', 0.37], ['1 plafond', 1], ['1,85 plafond', 1.85], ['4 plafonds', 4]] as const) {
      expect(cipav.some((c) => c.attendu.assiette < borne * p(c)), nom).toBe(true)
      expect(cipav.some((c) => c.attendu.assiette > borne * p(c)), nom).toBe(true)
    }
    expect(cipav.filter((c) => c.attendu.acreAppliquee).length).toBeGreaterThanOrEqual(8)
    expect(cipav.filter((c) => c.attendu.plafondProratise < c.attendu.plafond).length).toBeGreaterThanOrEqual(12)
  })

  it('n’a ni PCV ni prise en charge, et suppose l’invalidité-décès due avant 68 ans', () => {
    for (const c of cipav) {
      expect(c.attendu.pcv + c.attendu.priseEnChargePcv + c.attendu.priseEnChargeRetraiteDeBase, c.cas).toBe(0)
      const r = estimerRetraite(entreeDe(c))
      if (!r.disponible) throw new Error(r.motif)
      expect(r.estimation.caisse).toBe('cipav')
      expect(r.estimation.hypotheses).toEqual(['cipav-invalidite-deces-avant-68-ans-supposee'])
    }
  })

  it('chiffre un architecte à 60 000 € en 2026 comme le moteur, poste par poste', () => {
    const c = cipav.find((x) => x.cas === '2026, 60000 €, CIPAV')!
    // Assiette 44 400 € : base 8,73 % et 1,87 % ; complémentaire 11 % sous le plafond ; invalidité-décès 0,5 %.
    expect(c.attendu).toMatchObject({ assiette: 44_400, retraiteDeBase: 3876 + 830, retraiteComplementaire: 4884, invaliditeDeces: 222, total: 9812 })
    const r = estimerRetraite(entreeDe(c))
    expect(r.disponible && r.estimation.total).toBe(981_200)
  })
})

describe('ce que l’estimation de la retraite refuse ou suppose', () => {
  const base: EntreeRetraite = {
    annee: 2026,
    profession: 'auxiliaire_medical',
    remplacant: false,
    revenuBrutSocial: 60_000,
    revenuProfessionnelPositif: true,
    recettesBrutes: 80_000,
    honorairesConventionnes: 80_000,
    depassements: 0,
    parametres: { tenus: true, debutActivite: '2015-01-01', acre: null, tauxDentiste: null },
    cumulEmploiRetraite: null,
    dispenseDesDebuts: { tenue: false },
    exonerationEnZonePrioritaire: { tenue: false },
  }

  it('se tait quand le volet de l’Urssaf se tait, pour la même raison', () => {
    const r = estimerRetraite({ ...base, profession: null })
    expect(r).toEqual({ disponible: false, motif: 'Choisissez la profession pour estimer les cotisations.' })
  })

  it('refuse une année sans barème', () => {
    const r = estimerRetraite({ ...base, annee: 2027 })
    expect(r.disponible).toBe(false)
  })

  it('demande au médecin s’il cumule retraite et activité, sans défaut', () => {
    const r = estimerRetraite({ ...base, profession: 'medecin_secteur_1' })
    expect(r.disponible).toBe(false)
    if (!r.disponible) expect(r.motif).toMatch(/cumule sa retraite/)
  })

  it('dit ce que la CARCDSF accorde sur demande, et que l’estimation suppose demandé', () => {
    const r = estimerRetraite({ ...base, profession: 'chirurgien_dentiste', revenuBrutSocial: 8_000, parametres: { tenus: true, debutActivite: '2015-01-01', acre: null, tauxDentiste: 0.35 } })
    expect(r.disponible && r.estimation.hypotheses).toEqual([
      'carcdsf-reduction-du-forfait-supposee-demandee',
      'carcdsf-exoneration-des-pcv-supposee-demandee',
    ])
    const haut = estimerRetraite({ ...base, profession: 'sage_femme', revenuBrutSocial: 100_000 })
    expect(haut.disponible && haut.estimation.hypotheses).toEqual([])
  })

  it('dit le complémentaire de la CARMF compté dû les deux premières années, que le moteur ne dispense jamais', () => {
    const medecin = { ...base, profession: 'medecin_secteur_1' as const, cumulEmploiRetraite: false }
    const debut = estimerRetraite({ ...medecin, parametres: { tenus: true, debutActivite: '2025-01-02', acre: false, tauxDentiste: null } })
    expect(debut.disponible && debut.estimation.hypotheses).toEqual(['carmf-debut-d-activite-complementaire-suppose-du'])
    const installe = estimerRetraite({ ...medecin, parametres: { tenus: true, debutActivite: '2025-01-01', acre: false, tauxDentiste: null } })
    expect(installe.disponible && installe.estimation.hypotheses).toEqual([])
  })
})

// LA DISPENSE DU COMPLÉMENTAIRE DE LA CARMF DES DÉBUTS (RET-Q2) : la case dite par le cabinet, lue dans les deux premières
// années civiles d'affiliation seulement (l'affiliation au premier jour du trimestre civil qui suit le début, CARMF 2026).
describe('la dispense du complémentaire de la CARMF des débuts (RET-Q2)', () => {
  const medecin = (debutActivite: string, annee: number, dispenseDesDebuts: EntreeRetraite['dispenseDesDebuts']): EntreeRetraite => ({
    annee, profession: 'medecin_secteur_1', remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true,
    recettesBrutes: 80_000, honorairesConventionnes: 80_000, depassements: null,
    parametres: { tenus: true, debutActivite, acre: false, tauxDentiste: null }, cumulEmploiRetraite: false, dispenseDesDebuts,
    exonerationEnZonePrioritaire: { tenue: false },
  })
  const estimee = (e: EntreeRetraite) => {
    const r = estimerRetraite(e)
    if (!r.disponible) throw new Error(r.motif)
    return r.estimation
  }

  it('la dernière année : la seconde année civile d’affiliation, l’affiliation au trimestre qui suit le début', () => {
    expect(derniereAnneeDeLaDispense('2025-01-01')).toBe(2026)
    expect(derniereAnneeDeLaDispense('2025-09-30')).toBe(2026)
    expect(derniereAnneeDeLaDispense('2025-10-01')).toBe(2027)
    expect(derniereAnneeDeLaDispense('2025-12-31')).toBe(2027)
    expect(derniereAnneeDeLaDispense('2025-13-01')).toBeNull()
    expect(derniereAnneeDeLaDispense('01/10/2025')).toBeNull()
  })

  it('non tenue : l’estimation d’hier, le complémentaire compté dû et dit les deux premières années', () => {
    const e = estimee(medecin('2025-03-10', 2025, { tenue: false }))
    expect(e.retraiteComplementaire).toBeGreaterThan(0)
    expect(e.hypotheses).toContain('carmf-debut-d-activite-complementaire-suppose-du')
  })

  it('tenue, dans la fenêtre : non dite, l’estimation se tait ; dite oui, le complémentaire n’est pas compté ; non, il l’est', () => {
    const tait = estimerRetraite(medecin('2024-11-15', 2025, { tenue: true, dispense: null }))
    expect(tait.disponible).toBe(false)
    if (!tait.disponible) expect(tait.motif).toMatch(/^Dites si la CARMF dispense le médecin du complémentaire en 2025/)
    const oui = estimee(medecin('2024-11-15', 2025, { tenue: true, dispense: true }))
    const non = estimee(medecin('2024-11-15', 2025, { tenue: true, dispense: false }))
    expect(oui.retraiteComplementaire).toBe(0)
    expect(oui.hypotheses).toContain('carmf-complementaire-dispense')
    expect(non.retraiteComplementaire).toBeGreaterThan(0)
    expect(non.hypotheses).not.toContain('carmf-complementaire-dispense')
    expect(non.hypotheses).not.toContain('carmf-debut-d-activite-complementaire-suppose-du')
    expect(non.total - oui.total).toBe(Math.round(non.retraiteComplementaire / 100) * 100)
    // Le reste ne bouge pas.
    expect(oui.retraiteDeBase).toBe(non.retraiteDeBase)
    expect(oui.invaliditeDeces).toBe(non.invaliditeDeces)
  })

  it('tenue, hors de la fenêtre : la règle ne joue plus, la case ne se lit pas', () => {
    // Un début au 15/11/2023 : affilié au 1er janvier 2024, la dispense ne joue plus en 2026.
    expect(derniereAnneeDeLaDispense('2023-11-15')).toBe(2025)
    const apres = estimee(medecin('2023-11-15', 2026, { tenue: true, dispense: null }))
    expect(apres.retraiteComplementaire).toBeGreaterThan(0)
    expect(apres.hypotheses).not.toContain('carmf-complementaire-dispense')
    expect(estimee(medecin('2023-11-15', 2026, { tenue: true, dispense: true })).retraiteComplementaire)
      .toBe(apres.retraiteComplementaire)
  })

  it('tenue sans les paramètres : l’entrée se contredit, l’estimation se tait', () => {
    const r = estimerRetraite({ ...medecin('2024-11-15', 2025, { tenue: true, dispense: true }), parametres: { tenus: false } })
    expect(r.disponible).toBe(false)
  })

  it('les autres caisses ne lisent pas la case', () => {
    const infirmiere = estimerRetraite({ ...medecin('2024-11-15', 2025, { tenue: true, dispense: null }), profession: 'auxiliaire_medical', cumulEmploiRetraite: null })
    expect(infirmiere.disponible).toBe(true)
  })
})


// L'EXONÉRATION DES COTISATIONS DE RETRAITE 2025 D'UN MÉDECIN EN CUMUL EXERÇANT EN ZONE D'INTERVENTION PRIORITAIRE (RET2-Q2) :
// la case dite par le cabinet, lue en 2025 seulement, pour un médecin dont le cumul est dit « oui » (loi n° 2025-199, art. 6).
describe('l’exonération de 2025 en zone d’intervention prioritaire (RET2-Q2)', () => {
  const medecin = (annee: number, cumul: boolean | null, exonerationEnZonePrioritaire: EntreeRetraite['exonerationEnZonePrioritaire'],
    debutActivite = '2010-01-01'): EntreeRetraite => ({
    annee, profession: 'medecin_secteur_1', remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true,
    recettesBrutes: 80_000, honorairesConventionnes: 80_000, depassements: null,
    parametres: { tenus: true, debutActivite, acre: false, tauxDentiste: null }, cumulEmploiRetraite: cumul,
    dispenseDesDebuts: { tenue: true, dispense: null }, exonerationEnZonePrioritaire,
  })
  const estimee = (e: EntreeRetraite) => {
    const r = estimerRetraite(e)
    if (!r.disponible) throw new Error(r.motif)
    return r.estimation
  }

  it('non tenue (le drapeau baissé) : l’estimation d’hier, les cotisations comptées dues', () => {
    const e = estimee(medecin(2025, true, { tenue: false }))
    expect(e.retraiteDeBase).toBeGreaterThan(0)
    expect(e.retraiteComplementaire).toBeGreaterThan(0)
    expect(e.pcv).toBeGreaterThan(0)
    expect(e.invaliditeDeces).toBe(0)
    expect(e.hypotheses).not.toContain('carmf-exoneration-en-zone-prioritaire')
  })

  it('tenue, en 2025, le cumul dit : non dite, l’estimation se tait ; dite oui, rien n’est dû ; non, l’estimation d’hier', () => {
    const tait = estimerRetraite(medecin(2025, true, { tenue: true, exoneration: null }))
    expect(tait).toEqual({ disponible: false, motif: MOTIF_EXONERATION_NON_DITE })
    const oui = estimee(medecin(2025, true, { tenue: true, exoneration: true }))
    const non = estimee(medecin(2025, true, { tenue: true, exoneration: false }))
    const hier = estimee(medecin(2025, true, { tenue: false }))
    expect(non).toEqual(hier)
    expect(oui).toEqual({
      ...hier, retraiteDeBase: 0, priseEnChargeRetraiteDeBase: 0, retraiteComplementaire: 0, invaliditeDeces: 0, pcv: 0,
      priseEnChargePcv: 0, total: 0, hypotheses: ['carmf-exoneration-en-zone-prioritaire'],
    })
    expect(oui.assiette).toBe(hier.assiette)
  })

  it('exonéré, la dispense des débuts ne se demande plus : rien n’est dû au complémentaire', () => {
    // Un début au 15/11/2024 : la dispense des débuts se lirait en 2025, non dite elle tairait l'estimation.
    expect(estimerRetraite({ ...medecin(2025, true, { tenue: true, exoneration: false }, '2024-11-15') }).disponible).toBe(false)
    expect(estimee(medecin(2025, true, { tenue: true, exoneration: true }, '2024-11-15')).total).toBe(0)
  })

  it('hors de 2025, sans le cumul, ou pour une autre profession, la case ne se lit pas', () => {
    expect(estimee(medecin(2026, true, { tenue: true, exoneration: true }))).toEqual(estimee(medecin(2026, true, { tenue: false })))
    expect(estimee(medecin(2026, true, { tenue: true, exoneration: null })).total).toBeGreaterThan(0)
    expect(estimee(medecin(2025, false, { tenue: true, exoneration: null }))).toEqual(estimee(medecin(2025, false, { tenue: false })))
    const infirmiere = estimerRetraite({ ...medecin(2025, null, { tenue: true, exoneration: null }), profession: 'auxiliaire_medical' })
    expect(infirmiere.disponible).toBe(true)
  })
})

// L'ANNÉE DU DÉBUT QUI PRÉCÈDE L'AFFILIATION À LA CARMF (RET2-Q3, tranchée le 16/11/2026 : « (A) Zéro l'année qui précède
// l'affiliation ») : la CARMF affilie au premier jour du trimestre civil qui suit le début (« Début d'exercice libéral »,
// édition 2026) ; un début en octobre, novembre ou décembre ne lui doit rien sur l'année du début.
describe('l’année du début qui précède l’affiliation à la CARMF (RET2-Q3)', () => {
  const medecin = (debutActivite: string, annee = 2026, autres: Partial<EntreeRetraite> = {}): EntreeRetraite => ({
    annee, profession: 'medecin_secteur_1', remplacant: false, revenuBrutSocial: 6_000, revenuProfessionnelPositif: true,
    recettesBrutes: 8_000, honorairesConventionnes: 8_000, depassements: null,
    parametres: { tenus: true, debutActivite, acre: false, tauxDentiste: null }, cumulEmploiRetraite: false,
    dispenseDesDebuts: { tenue: true, dispense: false }, exonerationEnZonePrioritaire: { tenue: false }, ...autres,
  })
  const estimee = (e: EntreeRetraite) => {
    const r = estimerRetraite(e)
    if (!r.disponible) throw new Error(r.motif)
    return r.estimation
  }
  const RIEN = {
    retraiteDeBase: 0, priseEnChargeRetraiteDeBase: 0, retraiteComplementaire: 0, invaliditeDeces: 0, pcv: 0, priseEnChargePcv: 0,
    total: 0, hypotheses: ['carmf-annee-avant-l-affiliation'],
  }

  it('l’année d’affiliation : le trimestre civil qui suit le début, le 1er octobre compris', () => {
    expect(anneeDAffiliationALaCarmf('2026-01-01')).toBe(2026)
    expect(anneeDAffiliationALaCarmf('2026-09-30')).toBe(2026)
    expect(anneeDAffiliationALaCarmf('2026-10-01')).toBe(2027)
    expect(anneeDAffiliationALaCarmf('2026-12-31')).toBe(2027)
    expect(anneeDAffiliationALaCarmf('2026-00-10')).toBeNull()
    expect(anneeDAffiliationALaCarmf('15/11/2026')).toBeNull()
    // La dispense des débuts en dépend toujours : ses deux premières années civiles d'affiliation.
    expect(derniereAnneeDeLaDispense('2026-10-01')).toBe(2028)
  })

  it('un médecin installé le 15 novembre ne doit rien à la CARMF sur l’année du début, et l’estimation le dit', () => {
    const e = estimee(medecin('2026-11-15'))
    expect(e).toMatchObject({ caisse: 'carmf', ...RIEN })
    // L'assiette reste dite : celle de l'Urssaf, dont les cotisations sont dues dès le début.
    const urssaf = estimerCotisationsUrssaf(medecin('2026-11-15'))
    if (!urssaf.disponible) throw new Error(urssaf.motif)
    expect(e.assiette).toBe(Math.round(urssaf.estimation.assiette * 100))
    expect(urssaf.estimation.total).toBeGreaterThan(0)
  })

  it('les bornes : un début au 30 septembre s’affilie le 1er octobre et cotise ; du 1er octobre au 31 décembre, rien', () => {
    const septembre = estimee(medecin('2026-09-30'))
    expect(septembre.total).toBeGreaterThan(0)
    expect(septembre.invaliditeDeces).toBeGreaterThan(0)
    expect(septembre.hypotheses).not.toContain('carmf-annee-avant-l-affiliation')
    for (const d of ['2026-10-01', '2026-10-15', '2026-12-31']) expect(estimee(medecin(d)), d).toMatchObject(RIEN)
    // Le secteur 2 aussi : c'est la caisse qui n'appelle rien.
    expect(estimee(medecin('2026-11-15', 2026, { profession: 'medecin_secteur_2' }))).toMatchObject(RIEN)
  })

  it('ne demande ni le cumul, ni la dispense, ni l’exonération, qui n’y changeraient rien', () => {
    const rien = medecin('2025-11-15', 2025, {
      cumulEmploiRetraite: null, dispenseDesDebuts: { tenue: true, dispense: null },
      exonerationEnZonePrioritaire: { tenue: true, exoneration: null },
    })
    expect(estimee(rien)).toMatchObject(RIEN)
    expect(estimee({ ...rien, cumulEmploiRetraite: true })).toMatchObject(RIEN)
    expect(estimee({ ...rien, dispenseDesDebuts: { tenue: false } })).toMatchObject(RIEN)
  })

  it('l’année qui suit, la première d’affiliation, l’estimation d’hier : la dispense se demande, le reste se compte', () => {
    const tait = estimerRetraite(medecin('2025-11-15', 2026, { dispenseDesDebuts: { tenue: true, dispense: null } }))
    expect(tait.disponible).toBe(false)
    if (!tait.disponible) expect(tait.motif).toMatch(/^Dites si la CARMF dispense le médecin du complémentaire en 2026/)
    const e = estimee(medecin('2025-11-15', 2026))
    expect(e.retraiteDeBase).toBeGreaterThan(0)
    expect(e.hypotheses).not.toContain('carmf-annee-avant-l-affiliation')
  })

  it('les autres caisses, et un médecin sans début d’activité lu, gardent l’estimation d’hier', () => {
    for (const profession of ['auxiliaire_medical', 'sage_femme', 'liberal_cipav'] as const) {
      const e = estimee(medecin('2026-11-15', 2026, { profession, cumulEmploiRetraite: null }))
      expect(e.total, profession).toBeGreaterThan(0)
      expect(e.hypotheses, profession).not.toContain('carmf-annee-avant-l-affiliation')
    }
    const dentiste = estimee(medecin('2026-11-15', 2026, {
      profession: 'chirurgien_dentiste', cumulEmploiRetraite: null,
      parametres: { tenus: true, debutActivite: '2026-11-15', acre: false, tauxDentiste: 0.35 },
    }))
    expect(dentiste.total).toBeGreaterThan(0)
    const sansParametres = estimee(medecin('2026-11-15', 2026, { parametres: { tenus: false }, dispenseDesDebuts: { tenue: false } }))
    expect(sansParametres.total).toBeGreaterThan(0)
  })
})
