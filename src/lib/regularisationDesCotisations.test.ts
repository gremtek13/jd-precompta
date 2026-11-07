import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  NATURES, ORGANISMES, descriptionDite, estimerLaRegularisation, lireLaDescription, saisieDeLaDescription,
  type EntreeRegularisation,
} from './regularisationDesCotisations'
import { estimerCotisationsUrssaf, type EstimationCotisations, type ResultatEstimation } from './voletSocialPamc'
import { formatMoney } from './format'
import type { CotisationDeclaree } from './types'

// Des montants construits à la main : les définitives sont un total posé, jamais recalculé ici (le calcul est celui de
// lib/voletSocialPamc.ts, éprouvé contre le moteur de l'Urssaf) ; les échéances, des appels ronds dont la somme se lit.
const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261107170000_regularisation_des_cotisations.sql', import.meta.url), 'utf8')

const definitivesDe = (total: number): ResultatEstimation => ({
  disponible: true,
  estimation: {
    plafond: 0, abattement: 0, assiette: 0, csgCrdsDeductible: 0, csgCrdsNonDeductible: 0, maladie: 0, priseEnChargeMaladie: 0,
    priseEnChargeAllocationsFamiliales: 0, contributionAdditionnelle: 0, indemnitesJournalieres: 0, allocationsFamiliales: 0,
    curps: 0, formationProfessionnelle: 0, total,
  } satisfies EstimationCotisations,
})

let n = 0
const echeance = (e: Partial<CotisationDeclaree>): CotisationDeclaree => ({
  id: `c${String(++n).padStart(3, '0')}`, dossier_id: 'd', echeance: '2026-01-05', montant_appele: 0, montant_verse: null,
  montant_csg_crds: null, created_at: '2026-01-01T00:00:00Z', previsionnel: false, paiement_personnel_le: null,
  organisme: null, annee_payee: null, nature: null, ...e,
})
// Douze provisionnelles de 400 € de l'Urssaf pour 2026 (4 800 €), le 5 de chaque mois.
const douzeProvisionnelles = () => Array.from({ length: 12 }, (_, i) => echeance({
  echeance: `2026-${String(i + 1).padStart(2, '0')}-05`, montant_appele: 400, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle',
}))
const entree = (e: Partial<EntreeRegularisation>): EntreeRegularisation => ({
  annee: 2026, definitives: definitivesDe(6000), echeances: douzeProvisionnelles(), exerciceValide: true, aujourdhui: '2027-02-15', ...e,
})
const estimee = (e: Partial<EntreeRegularisation>) => {
  const r = estimerLaRegularisation(entree(e))
  if (r.etat !== 'estimee') throw new Error(`attendue estimée : ${r.manques.join(' | ')}`)
  return r
}
const manques = (e: Partial<EntreeRegularisation>) => {
  const r = estimerLaRegularisation(entree(e))
  if (r.etat !== 'inconnue') throw new Error('attendue inconnue')
  return r.manques
}

describe('les listes fermées, confrontées à la migration', () => {
  it('les douze organismes et les trois natures sont ceux des contraintes, dans leur ordre', () => {
    const liste = (nom: string) => {
      const m = new RegExp(`${nom} check \\((?:organisme|nature) in \\(([^)]*)\\)`).exec(MIGRATION)
      return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : []
    }
    expect(liste('cotisations_declarees_organisme_liste')).toEqual([...ORGANISMES])
    expect(liste('cotisations_declarees_nature_liste')).toEqual([...NATURES])
    expect(MIGRATION).toContain('annee_payee >= extract(year from echeance)::integer - 5 and annee_payee <= extract(year from echeance)::integer + 1')
    expect(MIGRATION).toContain("nature is distinct from 'regularisation' or annee_payee is null or annee_payee <= extract(year from echeance)::integer")
  })
})

describe('la saisie des trois champs', () => {
  const lire = (organisme: string, annee: string, nature: string, date = '2026-03-05') => lireLaDescription({ organisme, annee, nature }, date)
  it('rien de dit : trois nuls, une échéance d’hier', () => {
    expect(lire('', '', '')).toEqual({ valeurs: { organisme: null, annee_payee: null, nature: null } })
    expect(saisieDeLaDescription({})).toEqual({ organisme: '', annee: '', nature: '' })
  })
  it('les bornes de l’année payée : cinq ans avant, un an après', () => {
    expect(lire('urssaf', '2021', 'regularisation')).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2021, nature: 'regularisation' } })
    expect(lire('carmf', '2027', 'provisionnelle')).toEqual({ valeurs: { organisme: 'carmf', annee_payee: 2027, nature: 'provisionnelle' } })
    expect(lire('urssaf', '2020', '')).toEqual({ refus: 'L’année payée d’une échéance de 2026 va de 2021 à 2027.' })
    expect(lire('urssaf', '2028', '')).toEqual({ refus: 'L’année payée d’une échéance de 2026 va de 2021 à 2027.' })
    expect(lire('urssaf', '26', '')).toEqual({ refus: 'L’année payée s’écrit en quatre chiffres.' })
    // Sans date lisible, les bornes attendent la date (la saisie la refuse d'elle-même).
    expect(lire('urssaf', '2020', '', '')).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2020, nature: null } })
  })
  it('une régularisation suit son année ; la même année se dit (une cessation)', () => {
    expect(lire('urssaf', '2027', 'regularisation')).toEqual({ refus: 'Une régularisation de 2027 ne s’appelle pas en 2026 : elle suit son année.' })
    expect(lire('urssaf', '2026', 'regularisation')).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2026, nature: 'regularisation' } })
  })
  it('hors des listes, refusé ; la casse compte, comme en base', () => {
    expect(lire('URSSAF', '', '')).toEqual({ refus: 'L’organisme n’est pas de la liste.' })
    expect(lire('', '', 'definitive')).toEqual({ refus: 'La nature n’est pas de la liste.' })
  })
  it('la description dite en mots', () => {
    expect(descriptionDite({ organisme: 'carpimko', annee_payee: 2026, nature: 'provisionnelle' })).toBe('CARPIMKO, provisionnelle, 2026')
    expect(descriptionDite({ organisme: null, annee_payee: null, nature: null })).toBe('non décrite')
  })
})

describe('la régularisation estimée de 2026', () => {
  it('définitives moins les provisionnelles de l’Urssaf pour 2026 : due en 2027', () => {
    const r = estimee({})
    expect([r.definitives, r.appelees, r.regularisation, r.sens, r.payableEn, r.comptees.length]).toEqual([6000, 4800, 1200, 'due', 2027, 12])
    expect(r.reserves).toEqual([])
  })
  it('la régularisation de 2025 appelée en 2026, une caisse de retraite, une autre année : rien de compté', () => {
    const r = estimee({
      echeances: [
        ...douzeProvisionnelles(),
        echeance({ echeance: '2026-10-05', montant_appele: 300, organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' }),
        echeance({ echeance: '2026-04-05', montant_appele: 900, organisme: 'carpimko' }),
        echeance({ echeance: '2026-12-20', montant_appele: 410, organisme: 'urssaf', annee_payee: 2027, nature: 'provisionnelle' }),
        echeance({ echeance: '2025-12-05', montant_appele: 380 }),
      ],
    })
    expect([r.appelees, r.regularisation]).toEqual([4800, 1200])
  })
  it('un acompte à valoir sur 2026 la paie aussi ; une provisionnelle de 2026 appelée en 2027 se compte', () => {
    const r = estimee({
      echeances: [
        ...douzeProvisionnelles(),
        echeance({ echeance: '2026-06-15', montant_appele: 500, organisme: 'urssaf', annee_payee: 2026, nature: 'acompte' }),
        echeance({ echeance: '2027-01-05', montant_appele: 100, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' }),
      ],
    })
    expect([r.appelees, r.regularisation, r.sens]).toEqual([5400, 600, 'due'])
  })
  it('appelé au-delà des définitives : remboursée ; à égalité : nulle ; au centime', () => {
    expect([estimee({ definitives: definitivesDe(4000) }).regularisation, estimee({ definitives: definitivesDe(4000) }).sens]).toEqual([-800, 'remboursee'])
    expect(estimee({ definitives: definitivesDe(4800) }).sens).toBe('nulle')
    const auCentime = estimee({ echeances: [echeance({ echeance: '2026-02-05', montant_appele: 0.1, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' }),
      echeance({ echeance: '2026-05-05', montant_appele: 0.2, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })] })
    expect([auCentime.appelees, auCentime.regularisation]).toEqual([0.3, 5999.7])
  })
  it('les montants APPELÉS, pas les versés', () => {
    const verse = douzeProvisionnelles().map((c) => ({ ...c, montant_verse: 1 }))
    expect(estimee({ echeances: verse }).appelees).toBe(4800)
  })
  it('les définitives sont le total du moteur, tel quel', () => {
    const definitives = estimerCotisationsUrssaf({
      annee: 2026, profession: 'auxiliaire_medical', remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true,
      recettesBrutes: 90_000, honorairesConventionnes: 85_000, depassements: 0,
    })
    if (!definitives.disponible) throw new Error(definitives.motif)
    expect(estimee({ definitives }).definitives).toBe(definitives.estimation.total)
  })
  it('ce qui peut bouger se dit à côté du chiffre : la 2035 pas validée, la régularisation déjà appelée', () => {
    expect(estimee({ exerciceValide: false }).reserves).toEqual(['La 2035 de 2026 n’est pas validée : l’estimation suit ses chiffres d’aujourd’hui.'])
    const r = estimee({ echeances: [...douzeProvisionnelles(),
      echeance({ echeance: '2027-10-05', montant_appele: 900, organisme: 'urssaf', annee_payee: 2026, nature: 'regularisation' })] })
    expect([r.appelees, r.dejaAppelee]).toEqual([4800, 900])
    expect(r.reserves).toEqual([`L’Urssaf a déjà appelé ${formatMoney(900)} de régularisation de 2026 : son avis l’emporte sur l’estimation.`])
  })
})

describe('ce qu’elle ne sait pas, elle le dit, sans chiffre', () => {
  it('l’année pas finie : le revenu n’est pas arrêté', () => {
    expect(manques({ aujourdhui: '2026-12-31' })).toEqual(['L’année 2026 n’est pas finie : ni son revenu ni les appels de l’Urssaf pour 2026 ne sont arrêtés.'])
    expect(estimerLaRegularisation(entree({ aujourdhui: '2027-01-01' })).etat).toBe('estimee')
  })
  it('les définitives indisponibles : le motif du moteur', () => {
    expect(manques({ definitives: { disponible: false, motif: 'Choisissez la profession pour estimer les cotisations.' } }))
      .toEqual(['Les cotisations définitives ne s’estiment pas : Choisissez la profession pour estimer les cotisations.'])
  })
  it('une échéance qui pourrait payer 2026 à l’Urssaf sans les trois champs : nommée, et pas de chiffre', () => {
    const avec = (e: Partial<CotisationDeclaree>) => manques({ echeances: [...douzeProvisionnelles(), echeance({ montant_appele: 812, ...e })] })
    expect(avec({ echeance: '2026-10-05' })).toEqual([`L’échéance du 05/10/2026 (${formatMoney(812)}) ne dit pas qui l’appelle : décris-la dans l’onglet Cotisations.`])
    expect(avec({ echeance: '2027-01-05', annee_payee: 2026, nature: 'provisionnelle' })).toEqual([`L’échéance du 05/01/2027 (${formatMoney(812)}) ne dit pas qui l’appelle : décris-la dans l’onglet Cotisations.`])
    expect(avec({ echeance: '2026-10-05', organisme: 'urssaf' })).toEqual([`L’échéance du 05/10/2026 (${formatMoney(812)}) ne dit pas l’année qu’elle paie : décris-la dans l’onglet Cotisations.`])
    expect(avec({ echeance: '2026-10-05', organisme: 'urssaf', annee_payee: 2026 })).toEqual([`L’échéance du 05/10/2026 (${formatMoney(812)}) ne dit pas sa nature : décris-la dans l’onglet Cotisations.`])
    // Une échéance d'une autre année que rien ne rattache à 2026 ne se lit pas : l'estimation reste.
    expect(estimerLaRegularisation(entree({ echeances: [...douzeProvisionnelles(), echeance({ echeance: '2027-01-05' })] })).etat).toBe('estimee')
  })
  it('un appel manque : aucune provisionnelle, ou une encore prévisionnelle', () => {
    expect(manques({ echeances: [] })).toEqual(['Aucune provisionnelle de l’Urssaf n’est saisie pour 2026 : l’appelé manque.'])
    const prevue = douzeProvisionnelles().map((c, i) => (i === 11 ? { ...c, previsionnel: true } : c))
    expect(manques({ echeances: prevue })).toEqual(['L’échéance du 05/12/2026 est encore prévisionnelle : l’appel de l’Urssaf n’est pas là.'])
  })
  it('une échéance lue sans les colonnes (la migration pas appliquée) se dit non décrite, jamais comptée', () => {
    const sansColonnes = douzeProvisionnelles().map(({ organisme: _o, annee_payee: _a, nature: _n, ...reste }) => reste as CotisationDeclaree)
    expect(manques({ echeances: sansColonnes })).toHaveLength(12)
  })
})
