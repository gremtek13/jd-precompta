import { describe, expect, it } from 'vitest'
import { BAREMES_RETRAITE, CAISSE_DE_LA_PROFESSION, estimerRetraite, type EntreeRetraite } from './retraiteDesLiberaux'
import { CAS_REFERENCE_RETRAITE, MOTEUR_REFERENCE_RETRAITE, type CasReferenceRetraite } from './retraiteDesLiberauxReference'
import { PLAFONDS_SECURITE_SOCIALE } from './voletSocialPamc'

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

describe('la retraite des professions libérales, contre le moteur de l’Urssaf', () => {
  it('porte une grille réelle : les deux années, les trois caisses, la création, l’ACRE, le cumul', () => {
    expect(MOTEUR_REFERENCE_RETRAITE).toBe('modele-ti 0.1.0')
    expect(CAS_REFERENCE_RETRAITE.length).toBeGreaterThanOrEqual(300)
    expect(new Set(CAS_REFERENCE_RETRAITE.map((c) => c.entree.annee))).toEqual(new Set(Object.keys(BAREMES_RETRAITE).map(Number)))
    for (const caisse of ['carpimko', 'carmf', 'carcdsf']) {
      expect(CAS_REFERENCE_RETRAITE.filter((c) => CAISSE_DE_LA_PROFESSION[c.entree.profession] === caisse).length).toBeGreaterThanOrEqual(60)
    }
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.attendu.acreAppliquee).length).toBeGreaterThanOrEqual(20)
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.attendu.plafondProratise < c.attendu.plafond).length).toBeGreaterThanOrEqual(40)
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.entree.enRetraite).length).toBeGreaterThanOrEqual(4)
    expect(CAS_REFERENCE_RETRAITE.filter((c) => c.attendu.priseEnChargeRetraiteDeBase > 0).length).toBeGreaterThanOrEqual(30)
  })

  it('rend chaque cotisation au centime, sur chaque cas', () => {
    let exceptions = 0
    for (const c of CAS_REFERENCE_RETRAITE) {
      const r = estimerRetraite(entreeDe(c))
      if (!r.disponible) throw new Error(`${c.cas} : ${r.motif}`)
      const e = r.estimation
      const a = c.attendu
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
